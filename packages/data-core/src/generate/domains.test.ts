import { describe, expect, test } from 'vitest'
import type { CheckMeta, ColumnMeta, DomainMeta, NormalizedType, ObjectMeta } from '../metadata.js'
import { createSnapshot } from '../snapshot.js'
import { readCheckList, readDomainList } from './check-lists.js'
import { generateForm } from './generate.js'
import { listedFor } from './listed.js'
import type { FieldBinding } from './types.js'

/*
 * A column of a PostgreSQL domain whose check lists its values is a select
 * of them (0170), read as a table's check is (0152): the domain's check as
 * `pg_get_expr` deparses a domain's constraint, its value written `VALUE`,
 * over the base type the domain chain ends in. One list in all, the
 * table's and every domain's of the chain together, enforced and
 * validated, is a select; anything else is the base type's control, and a
 * list not drawn says why. What PostgreSQL spells for each is held against
 * a real server (`packages/data-postgres/src/states.integration.test.ts`).
 */

const VARCHAR10: NormalizedType = { kind: 'text', maxLength: 10, lengthUnit: 'code-points', fixedLength: false }
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }

/** `colour as varchar(10) check (value in ('red', 'green', 'blue'))`, as PostgreSQL 17.11 deparses it. */
const COLOUR_LIST = "((VALUE)::text = ANY ((ARRAY['red'::character varying, 'green'::character varying, 'blue'::character varying])::text[]))"

const check = (name: string, expression: string, extra: Partial<CheckMeta> = {}): CheckMeta => ({ name, expression, enforced: true, validated: true, ...extra })
const domain = (name: string, checks: CheckMeta[] = []): DomainMeta => ({ ref: { schema: 'states', name }, checks })

function column(name: string, type: NormalizedType, domains: DomainMeta[], extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name,
    ordinal: 2,
    databaseType: `states.${domains[0]?.ref.name ?? 'none'}`,
    type,
    nullable: true,
    hasDefault: false,
    defaultExpression: null,
    generated: 'none',
    comment: null,
    access: { select: true, insert: true, update: true },
    domains,
    ...extra,
  }
}

function ticket(columns: ColumnMeta[], checks: CheckMeta[] = []): ObjectMeta {
  const id: ColumnMeta = {
    name: 'id',
    ordinal: 1,
    databaseType: 'integer',
    type: INT32,
    nullable: false,
    hasDefault: false,
    defaultExpression: null,
    generated: 'identity-always',
    comment: null,
    access: { select: true, insert: false, update: false },
  }
  return {
    ref: { schema: 'states', name: 'ticket' },
    kind: 'table',
    comment: null,
    columns: [id, ...columns.map((entry, index) => ({ ...entry, ordinal: index + 2 }))],
    primaryKey: { name: 'ticket_pkey', columns: ['id'] },
    uniqueKeys: [],
    foreignKeys: [],
    checks,
    rowSecurity: 'none',
  }
}

const generated = (root: ObjectMeta) =>
  generateForm(
    createSnapshot({
      kind: 'postgres',
      serverVersion: '17.11',
      account: { user: 'owner', login: 'owner' },
      scope: { schemas: ['states'] },
      objects: [root],
      gaps: [],
    }),
    { connection: 'erp', root: root.ref, formId: 'ticket', title: 'Ticket', lookups: [] },
  )
const colourOf = (fields: readonly FieldBinding[]) => fields.find((binding) => binding.field === 'colour')

describe("a domain check's spelling", () => {
  // A table's check with VALUE where the column stands, and nothing else:
  // VALUE in capitals and never quoted, which a column cannot be spelled as.
  // Watched failing with the table's reader asked: no domain's list was read.
  test.each([
    [COLOUR_LIST, ['red', 'green', 'blue']],
    ["(VALUE = ANY (ARRAY['a'::text, 'b'::text]))", ['a', 'b']],
    ['(VALUE = ANY (ARRAY[1, 2, 3]))', ['1', '2', '3']],
    ["(VALUE = 'only'::text)", ['only']],
    ["((VALUE = 'a'::text) OR (VALUE = 'b'::text))", ['a', 'b']],
    ["(VALUE = ANY (ARRAY['it''s'::text, 'a, b'::text, ' spaced '::text, 'Zürich'::text]))", ["it's", 'a, b', ' spaced ', 'Zürich']],
  ])('%s lists its values', (expression, values) => {
    expect(readDomainList(expression)?.map((literal) => literal.text)).toEqual(values)
  })

  // A column's name, VALUE quoted -- a column called so --, lower case, a
  // comparison, or the table's spelling of a column are no list of a
  // domain's value; and VALUE is no column of a table's check. Watched
  // failing with a quoted name read as the value: a check over a column
  // called VALUE was a domain's list.
  test.each([
    ["(colour = ANY (ARRAY['a'::text]))"],
    ['("VALUE" = ANY (ARRAY[1, 2]))'],
    ['(value = ANY (ARRAY[1, 2]))'],
    ['(VALUE > 0)'],
    ["(VALUE <> ''::text)"],
    ['(VALUES = ANY (ARRAY[1, 2]))'],
    ["((VALUE)::text = ANY ((ARRAY['a'::states.order_state])::text[]))"],
  ])('%s is no list', (expression) => {
    expect(readDomainList(expression)).toBeNull()
  })

  test("VALUE is no column of a table's check", () => {
    expect(readCheckList('postgres', '(VALUE = ANY (ARRAY[1, 2]))')).toBeNull()
    expect(readCheckList('postgres', '("VALUE" = ANY (ARRAY[1, 2]))')).toEqual({
      column: 'VALUE',
      literals: [
        { kind: 'number', text: '1' },
        { kind: 'number', text: '2' },
      ],
    })
  })
})

describe('a column of a domain whose check lists its values', () => {
  // The domain's list is the column's, over the base type the chain ends
  // in, and the binding says whose check it is. Watched failing with the
  // domains left unread: colour was a text box.
  test('is a select of them, from the domain', () => {
    const { form, bindings, notes } = generated(ticket([column('colour', VARCHAR10, [domain('colour', [check('colour_check', COLOUR_LIST)])])]))
    expect(form.model.fields.find((field) => field.key === 'colour')).toMatchObject({
      type: 'select',
      options: ['blue', 'green', 'red'].map((value) => ({ value, label: value })),
    })
    expect(colourOf(bindings.fields)).toMatchObject({
      listed: { check: 'colour_check', domain: { schema: 'states', name: 'colour' }, values: ['blue', 'green', 'red'] },
    })
    expect(notes.filter((note) => note.subject === 'colour').map((note) => note.message)).toEqual([
      'A select of the values colour_check of states.colour lists, “blue”, “green” and “red”, each offered as the column holds it, from states.colour; label from the column name.',
    ])
  })

  // A domain over a domain: the inner one's list holds every value the
  // outer one is made of, at any depth of the chain.
  test('a list of a domain the column is declared over is its own', () => {
    const chain = [domain('tone'), domain('colour', [check('colour_check', COLOUR_LIST)])]
    expect(listedFor('postgres', ticket([]), column('tone', VARCHAR10, chain))).toEqual({
      kind: 'select',
      check: 'colour_check',
      domain: { schema: 'states', name: 'colour' },
      values: ['blue', 'green', 'red'],
    })
  })

  // A list added NOT VALID may have rows before it that it does not list;
  // two lists, a domain's and the table's or two domains', are not
  // intersected. The base type's control, with a note naming the domain.
  // Watched failing with the domain's check state ignored: a NOT VALID
  // domain list was a select.
  test.each([
    [
      'added NOT VALID',
      [domain('colour', [check('colour_check', COLOUR_LIST, { validated: false })])],
      [],
      'Not a select of the values colour_check of states.colour lists: it was not validated, so a row from before it may hold a value it does not list, which a select could not show.',
    ],
    [
      "beside the table's",
      [domain('colour', [check('colour_check', COLOUR_LIST)])],
      [check('ck_ticket_colour', "((colour)::text = ANY ((ARRAY['red'::character varying])::text[]))")],
      'Not a select of the values ck_ticket_colour lists: ck_ticket_colour and colour_check of states.colour each list its values, and a select is drawn from one check.',
    ],
    [
      'beside another domain of the chain',
      [
        domain('tone', [check('tone_check', "((VALUE)::text = ANY ((ARRAY['red'::character varying])::text[]))")]),
        domain('colour', [check('colour_check', COLOUR_LIST)]),
      ],
      [],
      'Not a select of the values tone_check of states.tone lists: tone_check of states.tone and colour_check of states.colour each list its values, and a select is drawn from one check.',
    ],
  ])('a list %s is no select, and says why', (_case, domains, checks, message) => {
    const { form, bindings, notes } = generated(ticket([column('colour', VARCHAR10, domains)], checks))
    expect(form.model.fields.find((field) => field.key === 'colour')).toMatchObject({ type: 'text', maxLength: 10 })
    expect(colourOf(bindings.fields)).not.toHaveProperty('listed')
    expect(notes).toContainEqual({ subject: 'colour', kind: 'inferred', message })
  })

  // A domain's check that is no list -- `value <> ''` -- is the database's
  // to hold, as a table's is (0152): the base type's control, said nowhere.
  test('a check of a domain that is no list leaves the base type its control', () => {
    const text: NormalizedType = { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false }
    const { form, notes } = generated(ticket([column('code', text, [domain('code', [check('code_check', "(VALUE <> ''::text)")])])]))
    expect(form.model.fields.find((field) => field.key === 'code')).toMatchObject({ type: 'textarea' })
    expect(notes.filter((note) => note.subject === 'code' && note.message.startsWith('Not a select'))).toEqual([])
  })

  // A default the domain's list does not name is none, said naming the
  // domain, as a table's check is named (0152); one it names starts the
  // field. Watched failing with the check named alone: "colour_check
  // lists", which check of which domain not said.
  test("a default the domain's list names starts the field, and one it does not is none, said", () => {
    const listedDefault = (expression: string) =>
      generated(
        ticket([column('colour', VARCHAR10, [domain('colour', [check('colour_check', COLOUR_LIST)])], { hasDefault: true, defaultExpression: expression })]),
      )
    expect(listedDefault("'red'::character varying").form.model.fields.find((field) => field.key === 'colour')?.default).toBe('red')
    expect(listedDefault("'black'::character varying").notes).toContainEqual({
      subject: 'colour',
      kind: 'inferred',
      message:
        "Starts empty: the column's default, “black”, is not an answer the field takes (it is not one of the values colour_check of states.colour lists), so the database fills it when a create leaves the field out.",
    })
  })

  // A whole number's list is offered by value, as a table's is.
  test("a whole number's list is offered by value", () => {
    const listed = listedFor('postgres', ticket([]), column('size', INT32, [domain('size', [check('size_check', '(VALUE = ANY (ARRAY[10, 2, 3]))')])]))
    expect(listed).toMatchObject({ kind: 'select', values: ['2', '3', '10'] })
  })

  // SQL Server has no domain; a snapshot of it never carries one, and one
  // that did would be read as nothing rather than in PostgreSQL's spelling.
  test("on SQL Server, a column's domains are never read", () => {
    expect(listedFor('sqlserver', ticket([]), column('colour', VARCHAR10, [domain('colour', [check('colour_check', COLOUR_LIST)])]))).toEqual({ kind: 'none' })
  })
})

describe('domains no catalog could have produced', () => {
  // A domain in a chain once, each a name with a list of checks, each with its flags.
  test.each([
    ['an empty chain', [], /not a list of at least one/],
    ['a domain twice', [domain('colour'), domain('colour')], /names domain states.colour twice/],
    [
      'a check with no flags',
      [{ ref: { schema: 'states', name: 'colour' }, checks: [{ name: 'colour_check', expression: COLOUR_LIST }] }],
      /not one the contract names/,
    ],
    ['a domain with no name', [{ ref: { schema: 'states', name: '' }, checks: [] }], /names no type/],
  ])('%s is refused', (_case, domains, message) => {
    const root = ticket([column('colour', VARCHAR10, domains as DomainMeta[])])
    expect(() =>
      createSnapshot({
        kind: 'postgres',
        serverVersion: '17.11',
        account: { user: 'owner', login: 'owner' },
        scope: { schemas: ['states'] },
        objects: [root],
        gaps: [],
      }),
    ).toThrow(message)
  })

  // A domain's checks are sorted by name, as a table's are, so the order a
  // query returned them in is not the fingerprint's.
  test("a domain's checks are in the snapshot by name", () => {
    const root = ticket([column('colour', VARCHAR10, [domain('colour', [check('z_check', COLOUR_LIST), check('a_check', COLOUR_LIST)])])])
    const made = createSnapshot({
      kind: 'postgres',
      serverVersion: '17.11',
      account: { user: 'owner', login: 'owner' },
      scope: { schemas: ['states'] },
      objects: [root],
      gaps: [],
    })
    expect(made.objects[0]?.columns[1]?.domains?.[0]?.checks.map((entry) => entry.name)).toEqual(['a_check', 'z_check'])
  })
})
