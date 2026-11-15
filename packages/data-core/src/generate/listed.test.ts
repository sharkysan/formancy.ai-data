import { createFormEngine } from '@formancy/core'
import type { FieldDef, FormSchema } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import type { DatabaseKind } from '../adapter.js'
import type { CheckMeta, ColumnMeta, NormalizedType, ObjectMeta } from '../metadata.js'
import { canonicalValue, columnAnswer, formValue, storedValue } from '../records/answers.js'
import { createSnapshot } from '../snapshot.js'
import { givenStart } from './defaults.js'
import { generateForm } from './generate.js'
import { listedFor } from './listed.js'
import type { FieldBinding, GenerationRequest } from './types.js'

/*
 * A column whose values one check lists is a select of exactly them (0152).
 * The spellings are each engine's (check-lists.test.ts); what is decided
 * here is what a list means for a column -- a select, nothing, or a note
 * saying why not -- and what the select does downstream: its answers are
 * the column's canonical text, a whole number's too, they round-trip
 * through the planner and the codec, and a default or a starting value is
 * one of them or none.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
const VARCHAR = (maxLength: number, lengthUnit: 'utf16-code-units' | 'code-page-bytes' | 'code-points' = 'code-page-bytes'): NormalizedType => ({
  kind: 'text',
  maxLength,
  lengthUnit,
  fixedLength: false,
})
const CHAR2: NormalizedType = { kind: 'text', maxLength: 2, lengthUnit: 'code-points', fixedLength: true }

/** ck_order_status as each engine's catalog spells it, which the captured snapshots hold. */
const STATUS_LIST: Record<DatabaseKind, string> = {
  postgres: "((status)::text = ANY ((ARRAY['draft'::character varying, 'placed'::character varying, 'shipped'::character varying])::text[]))",
  sqlserver: "([status]='shipped' OR [status]='placed' OR [status]='draft')",
}

let ordinal = 0
function col(name: string, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  ordinal += 1
  return {
    name,
    ordinal,
    databaseType: type.kind === 'text' ? `varchar(${String(type.maxLength)})` : 'int',
    type,
    nullable: false,
    hasDefault: false,
    defaultExpression: null,
    generated: 'none',
    comment: null,
    access: { select: true, insert: true, update: true },
    ...extra,
  }
}

const check = (name: string, expression: string | null, extra: Partial<CheckMeta> = {}): CheckMeta => ({
  name,
  expression,
  enforced: true,
  validated: true,
  ...extra,
})

function table(columns: ColumnMeta[], checks: CheckMeta[]): ObjectMeta {
  return {
    ref: { schema: 'sales', name: 'ticket' },
    kind: 'table',
    comment: null,
    columns: [col('id', INT32, { generated: 'identity-always', access: { select: true, insert: false, update: false } }), ...columns],
    primaryKey: { name: 'pk_ticket', columns: ['id'] },
    uniqueKeys: [],
    foreignKeys: [],
    checks,
    rowSecurity: 'none',
  }
}

const REQUEST: GenerationRequest = { connection: 'erp', root: { schema: 'sales', name: 'ticket' }, formId: 'ticket', title: 'Ticket', lookups: [] }

/** The form over `root`, held to what publishing asks: the released validator takes it, and the engine opens it -- which it refuses where a default is no option. */
function generated(kind: DatabaseKind, root: ObjectMeta) {
  const snapshot = createSnapshot({
    kind,
    serverVersion: 'x',
    account: { user: 'owner', login: 'owner' },
    scope: { schemas: ['sales'] },
    objects: [root],
    gaps: [],
  })
  const result = generateForm(snapshot, REQUEST)
  const checked = validateSchema(result.form)
  expect(checked.valid ? [] : checked.errors).toEqual([])
  createFormEngine({ schema: result.form, capabilities: { now: () => 0, today: () => '2026-11-15', random: () => 0.5 } })
  return result
}

const field = (form: FormSchema, key: string): FieldDef => {
  const found = form.model.fields.find((candidate) => candidate.key === key)
  if (found === undefined) throw new Error(`no field ${key}`)
  return found
}

type ColumnBinding = Extract<FieldBinding, { kind: 'column' }>
const binding = (fields: readonly FieldBinding[], key: string): ColumnBinding => {
  const found = fields.find((candidate) => candidate.field === key)
  if (found?.kind !== 'column') throw new Error(`no column field ${key}`)
  return found
}

const options = (values: readonly string[]) => values.map((value) => ({ value, label: value }))

describe('what a list means for one column', () => {
  // The same model on both engines is one form: SQL Server writes the list
  // back to front, so a select in catalog order would differ from
  // PostgreSQL's for the same DDL, and the fixture's order form would be two
  // forms. Watched failing with the values kept in catalog order: SQL Server's
  // select offered shipped first.
  test.each(['postgres', 'sqlserver'] as const)('ck_order_status as %s spells it is one select of draft, placed and shipped', (kind) => {
    const { form, bindings, notes } = generated(kind, table([col('status', VARCHAR(20))], [check('ck_order_status', STATUS_LIST[kind])]))
    expect(field(form, 'status')).toEqual({ key: 'status', label: 'Status', type: 'select', options: options(['draft', 'placed', 'shipped']), required: true })
    expect(binding(bindings.fields, 'status').listed).toEqual({ check: 'ck_order_status', values: ['draft', 'placed', 'shipped'] })
    expect(notes.filter((note) => note.subject === 'status').map((note) => note.message)).toEqual([
      'A select of the values ck_order_status lists, “draft”, “placed” and “shipped”, each offered as the column holds it, from varchar(20); label from the column name.',
    ])
  })

  // Codepoint order is not a number's: 10 before 2 would read as a mistake.
  test("a whole number's values are offered by their value, as canonical text", () => {
    const listed = listedFor('postgres', table([col('priority', INT32)], []), col('priority', INT32))
    expect(listed).toEqual({ kind: 'none' })
    const root = table([col('priority', INT32)], [check('ck_priority', "(priority = ANY (ARRAY[10, 2, '-1'::integer]))")])
    expect(listedFor('postgres', root, root.columns[1] as ColumnMeta)).toEqual({ kind: 'select', check: 'ck_priority', values: ['-1', '2', '10'] })
  })

  // A value stored twice is one option: char(2) pads 'A' and 'A ' alike and
  // reads both back as 'A', and an IN list may name one value twice.
  test('a value the list names twice, or that reads back alike, is one option', () => {
    const root = table([col('code', CHAR2)], [check('ck_code', "(code = ANY (ARRAY['B'::bpchar, 'A'::bpchar, 'A '::bpchar, 'B'::bpchar]))")])
    expect(listedFor('postgres', root, root.columns[1] as ColumnMeta)).toEqual({ kind: 'select', check: 'ck_code', values: ['A', 'B'] })
  })

  // Each of these is a select a person could not trust: a row may hold a
  // value it does not show, or it shows one the database refuses. Each is
  // the control it was, with a note -- watched failing with the check's state
  // ignored: a NOT VALID list was a select.
  test.each([
    [
      'not validated',
      [check('ck_status', STATUS_LIST.postgres, { validated: false })],
      'it was not validated, so a row from before it may hold a value it does not list, which a select could not show',
    ],
    [
      'not enforced',
      [check('ck_status', STATUS_LIST.postgres, { enforced: false, validated: false })],
      'the database does not enforce it, so a row may hold a value it does not list',
    ],
    [
      'listed twice',
      [check('ck_status', STATUS_LIST.postgres), check('ck_status_again', "((status)::text = 'draft'::text)")],
      'ck_status and ck_status_again each list its values, and a select is drawn from one check',
    ],
    [
      'beside a check it cannot read',
      [check('ck_status', STATUS_LIST.postgres), check('ck_hidden', null)],
      'ck_hidden cannot be read by this connection, and may refuse a value it lists',
    ],
    [
      'with a value the column cannot hold',
      [check('ck_status', "((status)::text = ANY ((ARRAY['draft'::character varying, 'far too long for a varchar(20)'::character varying])::text[]))")],
      '“far too long for a varchar(20)” is not a value the column holds: at most 20 characters',
    ],
    [
      'with an empty value',
      [check('ck_status', "((status)::text = ANY ((ARRAY['draft'::character varying, ''::character varying])::text[]))")],
      'one of its values is empty, which a select cannot tell from no answer',
    ],
  ])('a list %s is no select, and says why', (_case, checks, reason) => {
    const { form, bindings, notes } = generated('postgres', table([col('status', VARCHAR(20))], checks))
    expect(field(form, 'status')).toMatchObject({ type: 'text', maxLength: 20 })
    expect(binding(bindings.fields, 'status').listed).toBeUndefined()
    const [first] = checks
    expect(notes).toContainEqual({ subject: 'status', kind: 'inferred', message: `Not a select of the values ${first?.name ?? ''} lists: ${reason}.` })
  })

  // A list of another kind than the column's, or over a kind no select is
  // drawn for, is read as none, as a spelling not read is: the same DDL
  // says nothing on one engine, so it says nothing on the other.
  test.each([
    ['a number on a text column', 'sqlserver', col('status', VARCHAR(20)), '([status]=(1) OR [status]=(2))'],
    ['text on a whole-number column', 'sqlserver', col('priority', INT32), "([priority]='1' OR [priority]='2')"],
    ['a decimal column', 'sqlserver', col('amount', { kind: 'decimal', precision: 10, scale: 2 }), '([amount]=(1) OR [amount]=(2))'],
    ['a yes or no', 'sqlserver', col('flag', { kind: 'boolean' }), '([flag]=(1))'],
    ['text past ASCII without N', 'sqlserver', col('city', VARCHAR(20, 'utf16-code-units')), "([city]='Zürich' OR [city]='Bern')"],
    ['an N literal past ASCII on a varchar', 'sqlserver', col('city', VARCHAR(20, 'code-page-bytes')), "([city]=N'Zürich' OR [city]=N'Bern')"],
    ['a list over another column', 'postgres', col('status', VARCHAR(20)), "((other)::text = 'a'::text)"],
  ] as const)('%s is no list, and says nothing', (_case, kind, column, expression) => {
    const root = table([column], [check('ck_listed', expression)])
    expect(listedFor(kind, root, root.columns[1] as ColumnMeta)).toEqual({ kind: 'none' })
  })

  // SQL Server writes an N literal as the text it spells only into an
  // nvarchar (0149); ASCII reads alike in every code page.
  test('an N literal past ASCII on an nvarchar, and ASCII on any text, are read', () => {
    const city = col('city', VARCHAR(20, 'utf16-code-units'))
    const root = table([city], [check('ck_city', "([city]=N'Zürich' OR [city]=N'Bern')")])
    expect(listedFor('sqlserver', root, root.columns[1] as ColumnMeta)).toEqual({ kind: 'select', check: 'ck_city', values: ['Bern', 'Zürich'] })
  })
})

describe('a select of listed values downstream', () => {
  // A whole number's answer in a select is text: the engine compares it with
  // option values, which are text, so a record read back as the number 2
  // would be refused. Watched failing with the whole-number shape kept for a
  // listed integer: formValue gave the number 2, and the engine refused it.
  test('a whole number round-trips as its canonical text through the planner and the codec', () => {
    const root = table(
      [col('priority', INT32), col('big', INT64)],
      [check('ck_priority', '([priority]=(3) OR [priority]=(2) OR [priority]=(-1))'), check('ck_big', '([big]=(9007199254740993) OR [big]=(0))')],
    )
    const { form, bindings } = generated('sqlserver', root)
    expect(field(form, 'priority')).toMatchObject({ type: 'select', options: options(['-1', '2', '3']) })
    expect(field(form, 'big')).toMatchObject({ type: 'select', options: options(['0', '9007199254740993']) })
    const priority = binding(bindings.fields, 'priority')
    const big = binding(bindings.fields, 'big')
    expect(formValue(priority, '2')).toBe('2')
    expect(formValue(big, '9007199254740993')).toBe('9007199254740993')
    expect(canonicalValue(priority, '-1')).toBe('-1')
    expect(storedValue(priority, '2')).toEqual({ ok: true, value: '2' })
    expect(columnAnswer(priority, root.columns[1] as ColumnMeta, '3', new Map())).toEqual({ ok: true, values: [{ name: 'priority', type: INT32, value: '3' }] })
    expect(columnAnswer(big, root.columns[2] as ColumnMeta, '9007199254740993', new Map())).toEqual({
      ok: true,
      values: [{ name: 'big', type: INT64, value: '9007199254740993' }],
    })
    // The engine, as the server replays it, holds a record's answer as one of the options, and refuses the number: a select answers text.
    const engine = createFormEngine({ schema: form, mode: 'server', capabilities: { now: () => 0, today: () => '2026-11-15', random: () => 0.5 } })
    engine.setValue(['priority'], formValue(priority, '2'))
    engine.setValue(['big'], formValue(big, '9007199254740993'))
    expect(Object.values(engine.validate().errors).flat()).toEqual([])
    engine.setValue(['priority'], 2)
    expect(engine.validate().errors['priority']).toEqual(['type'])
  })

  // A nullable listed column takes no answer, as its CHECK does: the
  // select's empty choice is NULL, and the field is not required.
  test('a nullable column is a select that is not required, and takes no answer', () => {
    const root = table([col('status', VARCHAR(20), { nullable: true })], [check('ck_order_status', STATUS_LIST.postgres)])
    const { form, bindings } = generated('postgres', root)
    expect(field(form, 'status')).toEqual({ key: 'status', label: 'Status', type: 'select', options: options(['draft', 'placed', 'shipped']) })
    expect(columnAnswer(binding(bindings.fields, 'status'), root.columns[1] as ColumnMeta, null, new Map())).toEqual({
      ok: true,
      values: [{ name: 'status', type: VARCHAR(20), value: null }],
    })
  })

  // The engine refuses to open a form whose default no option offers (formancy.ai
  // 0197), so a default the list leaves out is none, said; one it lists starts
  // the field. Watched failing with the options left unasked: the engine refused
  // to open the form.
  test('a default the list names starts the field; one it does not is none, said', () => {
    const listedDefault = generated(
      'postgres',
      table(
        [col('status', VARCHAR(20), { hasDefault: true, defaultExpression: "'draft'::character varying" })],
        [check('ck_order_status', STATUS_LIST.postgres)],
      ),
    )
    expect(field(listedDefault.form, 'status').default).toBe('draft')
    const unlisted = generated(
      'postgres',
      table(
        [col('status', VARCHAR(20), { hasDefault: true, defaultExpression: "'new'::character varying" })],
        [check('ck_order_status', STATUS_LIST.postgres)],
      ),
    )
    expect(field(unlisted.form, 'status').default).toBeUndefined()
    expect(unlisted.notes).toContainEqual({
      subject: 'status',
      kind: 'inferred',
      message:
        "Starts empty: the column's default, “new”, is not an answer the field takes (it is not one of the values ck_order_status lists), so the database fills it when a create leaves the field out.",
    })
  })

  // An administrator's starting value is read as the column's default is (0150).
  test('a starting value is one of the values or refused', () => {
    const { form, bindings } = generated('sqlserver', table([col('status', VARCHAR(20))], [check('ck_order_status', STATUS_LIST.sqlserver)]))
    const status = binding(bindings.fields, 'status')
    expect(givenStart(status, field(form, 'status'), 'placed')).toEqual({ ok: true, answer: 'placed' })
    expect(givenStart(status, field(form, 'status'), 'lost')).toEqual({ ok: false, reason: 'it is not one of the values ck_order_status lists' })
  })

  // Generation is deterministic (0009): two runs over the same snapshot are the same bytes.
  test('two runs give the same select', () => {
    const root = (): ObjectMeta => {
      ordinal = 0
      return table([col('status', VARCHAR(20))], [check('ck_order_status', STATUS_LIST.sqlserver)])
    }
    expect(JSON.stringify(generated('sqlserver', root()))).toBe(JSON.stringify(generated('sqlserver', root())))
  })
})
