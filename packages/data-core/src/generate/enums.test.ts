import { createFormEngine } from '@formancy/core'
import type { FieldDef, FormSchema } from '@formancy/spec'
import { schemaHash } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import { describe, expect, test } from 'vitest'
import { codecFor } from '../codecs/codec.js'
import { isKeyValue } from '../lookup/values.js'
import type { ColumnMeta, MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import { validatePolicy } from '../policy/validate.js'
import { columnFilter, filterOffer } from '../records/filter.js'
import { createSnapshot } from '../snapshot.js'
import { givenStart } from './defaults.js'
import { generateForm } from './generate.js'
import type { FieldBinding, GenerationRequest } from './types.js'

/*
 * An enum column is a select of exactly its labels (0170), in the order the
 * type gives them -- `pg_enum.enumsortorder`, the order PostgreSQL sorts
 * and compares them in -- each its own option's text. What is decided
 * here is data-core's: the select, its order, what a nullable one takes,
 * what an enum no select can write is, what its codec, its default, its
 * starting value, its filter and its key take; and that a snapshot taken
 * before 0170, where such a column is unsupported, reads, fingerprints and
 * generates exactly as it did. What PostgreSQL spells is held against a
 * real server (`packages/data-postgres/src/states*.integration.test.ts`).
 */

const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
const TEXT: NormalizedType = { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false }
const enumOf = (name: string, labels: string[], schema = 'states'): NormalizedType => ({ kind: 'enum', name: { schema, name }, labels })
const ORDER_STATE = enumOf('order_state', ['draft', 'placed', 'shipped'])
/** Out of the alphabet's order: the type's order is low, high, urgent. */
const PRIORITY = enumOf('priority', ['low', 'high', 'urgent'])

const ACCESS = { select: true, insert: true, update: true }
const column = (name: string, ordinal: number, databaseType: string, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name,
  ordinal,
  databaseType,
  type,
  nullable: true,
  hasDefault: false,
  defaultExpression: null,
  generated: 'none',
  comment: null,
  access: ACCESS,
  ...extra,
})
const ID = column('id', 1, 'bigint', INT64, { nullable: false, generated: 'identity-always', access: { select: true, insert: false, update: false } })

function ticket(columns: ColumnMeta[]): ObjectMeta {
  return {
    ref: { schema: 'states', name: 'ticket' },
    kind: 'table',
    comment: null,
    columns: [ID, ...columns],
    primaryKey: { name: 'ticket_pkey', columns: ['id'] },
    uniqueKeys: [],
    foreignKeys: [],
    checks: [],
    rowSecurity: 'none',
    access: { delete: true },
    referencedBy: [],
  }
}

const snapshotOf = (objects: ObjectMeta[]): MetadataSnapshot =>
  createSnapshot({ kind: 'postgres', serverVersion: '17.11', account: { user: 'owner', login: 'owner' }, scope: { schemas: ['states'] }, objects, gaps: [] })

const REQUEST: GenerationRequest = { connection: 'erp', root: { schema: 'states', name: 'ticket' }, formId: 'ticket', title: 'Ticket', lookups: [] }

/** The form over `columns`, held to what publishing asks: the released validator takes it, and the engine opens it -- which it refuses where a default is no option. */
function generated(columns: ColumnMeta[]) {
  const result = generateForm(snapshotOf([ticket(columns)]), REQUEST)
  const checked = validateSchema(result.form)
  expect(checked.valid ? [] : checked.errors).toEqual([])
  createFormEngine({ schema: result.form, capabilities: { now: () => 0, today: () => '2026-11-20', random: () => 0.5 } })
  return result
}

const field = (form: FormSchema, key: string): FieldDef | undefined => form.model.fields.find((candidate) => candidate.key === key)
const options = (values: readonly string[]) => values.map((value) => ({ value, label: value }))
type ColumnBinding = Extract<FieldBinding, { kind: 'column' }>
const binding = (fields: readonly FieldBinding[], key: string): ColumnBinding => {
  const found = fields.find((candidate) => candidate.field === key)
  if (found?.kind !== 'column') throw new Error(`no column field ${key}`)
  return found
}

describe('a snapshot taken before 0170', () => {
  /*
   * What PostgreSQL discovery made of an enum, a domain and an array of an
   * enum before 0170: each unsupported, spelled as format_type spells it,
   * with no domains -- the shape every stored bundle's snapshot and every
   * captured snapshot holds. The fingerprint and the generated form's hash
   * were computed by this release's predecessor (a26567b) over exactly this
   * input on 2026-11-20, and are pinned: a bundle is published, drafted and
   * imported only while its base and bindings are what the generator
   * produces from its own snapshot (0030), so a byte either moved would
   * refuse every such bundle. Watched failing with `createSnapshot` writing
   * `domains` onto every column, set to undefined where it has none: the
   * fingerprint moved.
   */
  const BEFORE = (): Omit<MetadataSnapshot, 'fingerprint'> => ({
    kind: 'postgres',
    serverVersion: '17.11',
    account: { user: 'owner', login: 'owner' },
    scope: { schemas: ['states'] },
    objects: [
      ticket([
        column(
          'state',
          2,
          'states.ticket_state',
          { kind: 'unsupported' },
          { nullable: false, hasDefault: true, defaultExpression: "'open'::states.ticket_state" },
        ),
        column('priority', 3, 'states.priority', { kind: 'unsupported' }),
        column('tags', 4, 'states.ticket_state[]', { kind: 'unsupported' }),
        column('title', 5, 'text', TEXT),
      ]),
    ],
    gaps: [],
  })

  test('reads, fingerprints and generates exactly as before', () => {
    const snapshot = createSnapshot(BEFORE())
    expect(snapshot.fingerprint).toBe('0aa8242dbc2599e872a74160adcfe9ef23e3a304ea9302b3574b79876b631704')
    expect(snapshot.objects[0]?.columns.some((entry) => Object.hasOwn(entry, 'domains'))).toBe(false)
    const result = generateForm(snapshot, { connection: 'erp', root: { schema: 'states', name: 'ticket' }, formId: 'ticket', title: 'Ticket', lookups: [] })
    expect(schemaHash(result)).toBe('d41f067c6b70126ae2de1014efb54a380c7f19909119aaff20cd3dc9a66e1218')
    expect(result.notes.filter((note) => note.kind === 'excluded').map((note) => note.message)).toEqual([
      'states.ticket_state: no tested codec exists for this type.',
      'states.priority: no tested codec exists for this type.',
      'states.ticket_state[]: no tested codec exists for this type.',
    ])
  })
})

describe('an enum column is a select of its labels', () => {
  // The type's order, not the alphabet's: low, high, urgent is how the
  // engine sorts and compares them, and how whoever made the type meant
  // them read. Watched failing with the labels sorted by codepoint, as
  // 0152 orders a check's list: high came first.
  test('in the order the type gives them, each its own text', () => {
    const { form, bindings, notes } = generated([column('priority', 2, 'states.priority', PRIORITY)])
    expect(field(form, 'priority')).toEqual({ key: 'priority', label: 'Priority', type: 'select', options: options(['low', 'high', 'urgent']) })
    expect(binding(bindings.fields, 'priority')).toMatchObject({ type: PRIORITY, nullable: true, writes: { create: true, update: true } })
    expect(binding(bindings.fields, 'priority').listed).toBeUndefined()
    expect(notes.filter((note) => note.subject === 'priority').map((note) => note.message)).toEqual([
      'A select of the labels of its type, “low”, “high” and “urgent”, in the order the type gives them, from states.priority; label from the column name.',
    ])
  })

  // NOT NULL with no default is required; a nullable one is not, and its
  // select's empty choice is NULL (0095), which the codec takes.
  test('a NOT NULL one with no default is required, and a nullable one takes no answer', () => {
    const { form } = generated([column('state', 2, 'states.order_state', ORDER_STATE, { nullable: false }), column('priority', 3, 'states.priority', PRIORITY)])
    expect(field(form, 'state')).toMatchObject({ type: 'select', required: true })
    expect(field(form, 'priority')?.required).toBeUndefined()
    expect(codecFor(column('priority', 3, 'states.priority', PRIORITY)).parse(null)).toEqual({ ok: true, value: null })
    expect(codecFor(column('state', 2, 'states.order_state', ORDER_STATE, { nullable: false })).parse(null)).toMatchObject({ ok: false, code: 'required' })
  })

  // Labels are text a person typed into DDL: a quote, a comma, blanks and
  // letters past ASCII are each one option, as the type holds it.
  test('a label with a quote, a comma, blanks or letters past ASCII is one option as the type holds it', () => {
    const awkward = enumOf('awkward', ["it's", 'a, b', ' spaced ', 'Zürich'])
    const { form } = generated([column('awkward', 2, 'states.awkward', awkward)])
    expect(field(form, 'awkward')).toMatchObject({ type: 'select', options: options(["it's", 'a, b', ' spaced ', 'Zürich']) })
    expect(codecFor(column('awkward', 2, 'states.awkward', awkward)).parse(' spaced ')).toEqual({ ok: true, value: ' spaced ' })
  })

  // An empty label is one a select cannot tell from no answer, and an enum
  // of no labels holds nothing but NULL: neither is a field that writes.
  // Shown, never written, with the reason. Watched failing with the labels
  // taken as they are: the released validator refused the select's empty
  // option ("Must not be empty").
  test('an empty label, or none at all, is shown and never written', () => {
    const blank = enumOf('blank', ['', 'x'])
    const none = enumOf('nothing', [])
    const { form, bindings, notes } = generated([column('blank', 2, 'states.blank', blank), column('nothing', 3, 'states.nothing', none)])
    expect(field(form, 'blank')).toMatchObject({ type: 'text' })
    expect(binding(bindings.fields, 'blank').writes).toEqual({ create: false, update: false })
    expect(notes).toContainEqual({
      subject: 'blank',
      kind: 'read-only',
      message: 'Shown, never written: states.blank has an empty label, which a select cannot tell from no answer.',
    })
    expect(notes).toContainEqual({
      subject: 'nothing',
      kind: 'read-only',
      message: 'Shown, never written: states.nothing has no labels, so nothing but NULL can be written.',
    })
  })

  // The engine refuses any other text with 22P02; the codec refuses it
  // first, so a request from a client other than the engine is a field
  // error, not the database's. Watched failing with any string taken.
  test('its codec takes a label and nothing else', () => {
    const codec = codecFor(column('state', 2, 'states.order_state', ORDER_STATE))
    expect(codec.parse('placed')).toEqual({ ok: true, value: 'placed' })
    expect(codec.parse('Placed')).toMatchObject({ ok: false, code: 'not-a-label' })
    expect(codec.parse(' placed')).toMatchObject({ ok: false, code: 'not-a-label' })
    expect(codec.parse(1)).toMatchObject({ ok: false, code: 'not-a-label' })
  })

  // Generation is deterministic (0009): two runs over the same snapshot are the same bytes.
  test('two runs give the same select', () => {
    const columns = () => [column('priority', 2, 'states.priority', PRIORITY)]
    expect(JSON.stringify(generated(columns()))).toBe(JSON.stringify(generated(columns())))
  })
})

describe("an enum's default and starting value", () => {
  const state = (defaultExpression: string) =>
    generated([column('state', 2, 'states.order_state', ORDER_STATE, { nullable: false, hasDefault: true, defaultExpression })])

  // pg_get_expr spells an enum constant cast to its type, qualified where
  // the session's search_path does not find it and quoted where its name
  // needs it (format_type). Each is the label itself. Watched failing with
  // the enum left out of the readers: every field started empty.
  test.each([
    ["'placed'::states.order_state", 'placed'],
    ["'placed'::order_state", 'placed'],
  ])('%s starts the field at its label', (expression, label) => {
    expect(field(state(expression).form, 'state')?.default).toBe(label)
  })

  test('a label with a quote in a quoted type name starts the field', () => {
    const odd = enumOf('Ticket Kind', ["it's", 'idea'], 'Odd States')
    const { form } = generated([
      column('kind', 2, '"Odd States"."Ticket Kind"', odd, { hasDefault: true, defaultExpression: `'it''s'::"Odd States"."Ticket Kind"` }),
    ])
    expect(field(form, 'kind')?.default).toBe("it's")
  })

  // A cast to another name is not this type's constant, whatever it says,
  // and a backslash means what standard_conforming_strings says, which the
  // snapshot does not: none is read, and the database fills it.
  test.each([["'placed'::other_state"], ["'placed'::other.order_state"], ["('placed'::text)::states.order_state"], ["'pla\\ced'::states.order_state"]])(
    '%s is no default',
    (expression) => {
      expect(field(state(expression).form, 'state')?.default).toBeUndefined()
    },
  )

  // A date's or a uuid's default is cast to a type too, and read as no
  // constant, as before 0170: only an enum column reads a cast to its own
  // type as a label, so no other field's start or note moves.
  test("another kind's default cast to its type is no constant, as before", () => {
    const { form, notes } = generated([
      column('opened', 2, 'date', { kind: 'date' }, { hasDefault: true, defaultExpression: "'2026-10-08'::date" }),
      column('title', 3, 'text', TEXT, { hasDefault: true, defaultExpression: "'placed'::states.order_state" }),
    ])
    expect(field(form, 'opened')?.default).toBeUndefined()
    expect(field(form, 'title')?.default).toBeUndefined()
    expect(notes.filter((note) => note.message.startsWith('Starts'))).toEqual([])
  })

  // An administrator's starting value is read as the column's default is (0150).
  test('a starting value is one of its labels or refused', () => {
    const { form, bindings } = generated([column('state', 2, 'states.order_state', ORDER_STATE)])
    const state = binding(bindings.fields, 'state')
    expect(givenStart(state, field(form, 'state') as FieldDef, 'shipped')).toEqual({ ok: true, answer: 'shipped' })
    expect(givenStart(state, field(form, 'state') as FieldDef, 'lost')).toEqual({ ok: false, reason: 'expected one of the labels of states.order_state' })
  })
})

describe('an enum in a filter and a key', () => {
  // Equality with a label, typed as text, and nothing else: the engine
  // compares labels in the type's order, which a range typed as text would
  // not say, and has no LIKE. Watched failing with a range offered: a
  // range from high to urgent planned, which PostgreSQL would read in the
  // type's order and a person in the alphabet's.
  test('its filter offers equality with a label', () => {
    const priority = column('priority', 2, 'states.priority', PRIORITY)
    expect(filterOffer(priority)).toEqual({ operators: ['equals', 'null', 'not-null'], input: 'text', days: null })
    expect(columnFilter(priority, { op: 'equals', value: 'high' }, 'priority')).toEqual({
      ok: true,
      filter: { op: 'equals', column: 'priority', type: PRIORITY, value: 'high' },
    })
    expect(columnFilter(priority, { op: 'equals', value: 'High' }, 'priority')).toEqual({
      ok: false,
      message: 'A value given for priority is not one it can hold.',
    })
    expect(columnFilter(priority, { op: 'range', from: 'high', to: null }, 'priority')).toEqual({ ok: false, message: 'priority offers no range condition.' })
  })

  // A token, a row filter or a lookup key is bound cast to the enum: a value
  // that is no label would fail the whole statement with 22P02, where one
  // token is the problem (0028).
  test('a key value is one of its labels, exactly', () => {
    expect(isKeyValue(ORDER_STATE as Extract<NormalizedType, { kind: 'enum' }>, 'draft')).toBe(true)
    expect(isKeyValue(ORDER_STATE as Extract<NormalizedType, { kind: 'enum' }>, 'Draft')).toBe(false)
    expect(isKeyValue(ORDER_STATE as Extract<NormalizedType, { kind: 'enum' }>, '')).toBe(false)
  })
})

describe('an enum as a state field', () => {
  // A state field over an enum keeps its moves (0127): each state one of
  // the type's labels, as a move to text the column cannot hold names no
  // record. Watched failing with the state field held to text and whole
  // numbers alone: the enum's moves were refused outright.
  test('its moves are between labels of the type, and a move to anything else is refused', () => {
    const columns = [
      column('state', 2, 'states.order_state', ORDER_STATE, { nullable: false, hasDefault: true, defaultExpression: "'draft'::states.order_state" }),
      column('version', 3, 'bigint', INT64, { nullable: false, hasDefault: true, defaultExpression: '1' }),
    ]
    const { bindings } = generateForm(snapshotOf([ticket(columns)]), { ...REQUEST, versionColumn: 'version' })
    const clerk = { read: ['clerk'], write: ['clerk'] }
    const policy = (to: string): FormPolicy => ({
      version: 1,
      operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
      fields: { id: { read: ['clerk'], write: [] }, state: clerk },
      rowFilters: [],
      lookups: {},
      transitions: { field: 'state', moves: [{ from: 'draft', to, roles: ['clerk'] }] },
    })
    expect(validatePolicy(policy('placed'), bindings)).toEqual({ ok: true })
    expect(validatePolicy(policy('Placed'), bindings)).toMatchObject({
      ok: false,
      problems: ['transitions.moves[0].to is not spelled as state holds its values'],
    })
  })
})

describe('an enum no catalog could have produced', () => {
  // pg_enum holds a label once per type, and a select offering one twice
  // could not say which was chosen.
  test.each([
    ['a label twice', { kind: 'enum', name: { schema: 'states', name: 'order_state' }, labels: ['draft', 'draft'] }, /holds a label twice/],
    ['no name', { kind: 'enum', name: { schema: '', name: 'order_state' }, labels: ['draft'] }, /names no type/],
    ['labels that are not text', { kind: 'enum', name: { schema: 'states', name: 'order_state' }, labels: [1] }, /not a list of text/],
  ])('%s is refused', (_case, type, message) => {
    expect(() => snapshotOf([ticket([column('state', 2, 'states.order_state', type as unknown as NormalizedType)])])).toThrow(message)
  })
})
