import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, EMPTY_PRESENTATION, generateForm, recordToken } from '@formancy/data-core'
import type {
  ActionAdapter,
  ColumnMeta,
  DatabaseAdapter,
  DescribedTable,
  FormPolicy,
  GenerationRequest,
  ListRequest,
  LookupAdapter,
  NormalizedType,
  ObjectMeta,
  ObjectRef,
  RecordAdapter,
  RecordValue,
  SaveOutcome,
  SaveRequest,
} from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AuditSink, RuntimeAuditEvent } from '../audit.js'
import { recordReference } from '../audit.js'
import type { BundleV2 } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'

/*
 * `POST /v1/forms/:id/records/save` (0155) over fake ports. What the
 * database does with a save is the adapters' suites' business, against
 * real servers (0003); what is under test here is what the route decides
 * before and after the one call it makes: each rule of the body, the
 * children, the policy and the plan in order, what reaches the port, how
 * each answer is worded and placed, what a write id does, and what the
 * trail says -- and what the menu, the form route and the per-row routes
 * say of a record whose rows are saved with it.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const NOTE: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const ROWVERSION: NormalizedType = { kind: 'rowversion' }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name,
  ordinal,
  databaseType: type.kind,
  type,
  nullable: false,
  hasDefault: false,
  defaultExpression: null,
  generated: 'none',
  comment: null,
  access: { select: true, insert: true, update: true },
  ...extra,
})
const ref = (name: string): ObjectRef => ({ schema: 'sales', name })
const table = (name: string, columns: ColumnMeta[], extra: Partial<ObjectMeta> = {}): ObjectMeta => ({
  ref: ref(name),
  kind: 'table',
  comment: null,
  columns,
  primaryKey: { name: `pk_${name}`, columns: ['id'] },
  uniqueKeys: [],
  foreignKeys: [],
  checks: [],
  rowSecurity: 'none',
  access: { delete: true },
  referencedBy: [],
  ...extra,
})
/** A key of the lines that refers to a table, as that table's snapshot lists it. */
const inbound = (name: string, columns: string[]) => ({
  table: ref('order_line'),
  name,
  columns,
  referencedColumns: ['id'],
  onDelete: 'no-action' as const,
  onUpdate: 'no-action' as const,
  enforced: true,
})
const fk = (name: string, columns: string[], target: string) => ({
  name,
  columns,
  references: { table: ref(target), columns: ['id'] },
  onUpdate: 'no-action' as const,
  onDelete: 'no-action' as const,
  enforced: true,
  validated: true,
})

/** An order numbered by the database, its tenant and notes; a product; and an order's lines, keyed by order and number, each with a product. */
const SNAPSHOT = createSnapshot({
  kind: 'sqlserver',
  serverVersion: '16.0',
  account: { user: 'dbo', login: 'sa' },
  scope: { schemas: ['sales'] },
  gaps: [],
  objects: [
    table(
      'order',
      [
        col('id', 1, INT32, { generated: 'identity-always' }),
        col('tenant_id', 2, INT32),
        col('notes', 3, NOTE, { nullable: true }),
        col('row_version', 4, ROWVERSION, { generated: 'rowversion' }),
      ],
      { referencedBy: [inbound('fk_line_order', ['order_id'])] },
    ),
    table('product', [col('id', 1, INT32), col('name', 2, NOTE)], { referencedBy: [inbound('fk_line_product', ['product_id'])] }),
    table(
      'order_line',
      [
        col('order_id', 1, INT32),
        col('line_no', 2, INT32),
        col('quantity', 3, INT32),
        col('product_id', 4, INT32, { nullable: true }),
        col('row_version', 5, ROWVERSION, { generated: 'rowversion' }),
      ],
      {
        primaryKey: { name: 'pk_order_line', columns: ['order_id', 'line_no'] },
        foreignKeys: [fk('fk_line_order', ['order_id'], 'order'), fk('fk_line_product', ['product_id'], 'product')],
      },
    ),
  ],
})

const ORDER_REQUEST: GenerationRequest = {
  connection: 'erp',
  root: ref('order'),
  formId: 'order',
  title: 'Order',
  lookups: [],
  pinned: ['tenant_id'],
  touchColumn: 'notes',
}
/** An order holds one to three lines, saved with it. */
const LINE_REQUEST: GenerationRequest = {
  connection: 'erp',
  root: ref('order_line'),
  formId: 'order-line',
  title: 'Order line',
  lookups: [
    { foreignKey: 'fk_line_order', display: ['notes'], together: { min: 1, max: 3 } },
    { foreignKey: 'fk_line_product', display: ['name'] },
  ],
  pinned: [],
}

const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
const R = (...roles: string[]) => ({ read: roles, write: [] as string[] })
const RW = (...roles: string[]) => ({ read: roles, write: roles })
/** Clerks do everything; editors save an order and its lines but delete none; intake creates orders and never sees a line; an auditor reads. */
const ORDER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'editor', 'auditor', 'intake'], create: ['clerk', 'editor', 'intake'], update: ['clerk', 'editor'] },
  fields: { id: R('clerk', 'editor', 'auditor', 'intake'), tenant_id: R('clerk', 'editor', 'auditor'), notes: RW('clerk', 'editor', 'intake') },
  rowFilters: TENANT,
  lookups: {},
}
/** Every line field: read by all who read lines, written by clerks and editors. */
const LINE_FIELD = { read: ['clerk', 'editor', 'auditor'], write: ['clerk', 'editor'] }
const LINE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'editor', 'auditor'], create: ['clerk', 'editor'], update: ['clerk', 'editor'], delete: ['clerk'] },
  fields: { order: LINE_FIELD, line_no: LINE_FIELD, quantity: LINE_FIELD, product: LINE_FIELD },
  rowFilters: [],
  lookups: { order: TENANT, product: [] },
  through: ['order'],
}

const roles: Record<string, string[]> = { clerk: ['clerk'], editor: ['editor'], auditor: ['auditor'], intake: ['intake'] }
const verifyIdentity: IdentityVerifier = async (token) => {
  const held = roles[token]
  return held === undefined ? { ok: false, reason: 'bad' } : { ok: true, identity: { actor: { id: token, roles: held }, attributes: { tenant: '1' } } }
}

const V1 = '00000000000007d1'
const V2 = '00000000000007d2'
const DEFINITION = 'the definition the fake catalog described'
const KEY = 'an-audit-key-the-operator-keeps-secret'
const WRITE_ID = '0123456789abcdef0123456789abcdef'
const DEADLINE_MS = 777
const ORDER = 'k1:7'
const lineToken = (no: number): string => {
  const token = recordToken(['order_id', 'line_no'], { order_id: '7', line_no: String(no) })
  if (!token.ok) throw new Error(token.message)
  return token.token
}
const LINE_1 = lineToken(1)
const LINE_2 = lineToken(2)

const describedAs = (target: ObjectRef): DescribedTable => ({
  ...(describedOf(SNAPSHOT, target) as Omit<DescribedTable, 'definition'>),
  definition: DEFINITION,
})
const valuesOf = (values: readonly RecordValue[]) => Object.fromEntries(values.map((entry) => [entry.name, entry.value]))

/** What the fake transaction stores: every row as its step left it, the record read back. */
function stored(request: SaveRequest): SaveOutcome {
  return {
    ok: true,
    record: { values: { id: '7', tenant_id: '1', notes: 'as stored' }, version: V2 },
    children: request.children.map((child) => ({
      rows: [
        ...child.deletes.map((one) => ({ deleted: { values: { order_id: '7', ...valuesOf(one.key) }, version: V1 } })),
        ...child.updates.map((one) => ({ values: { order_id: '7', product_id: null, ...valuesOf(one.key), ...valuesOf(one.set) }, version: V2 })),
        ...child.creates.map((one) => ({ values: { order_id: '7', product_id: null, ...valuesOf(one.values) }, version: V2 })),
      ],
    })),
  }
}

let saves: SaveRequest[]
let lists: ListRequest[]
let reads: number
let describes: number
let writes: string[]
/** What the fake transaction answers; undefined is every change stored. */
let outcome: ((request: SaveRequest) => SaveOutcome) | undefined
/** The products a membership check says are not options. */
let rejected: string[]
let events: RuntimeAuditEvent[]
let root: string
let store: ConfigurationStore
let app: FastifyInstance

function registry(): ConnectionRegistry {
  const written = (what: string) => async () => {
    writes.push(what)
    throw new Error(`a save never ${what}s alone`)
  }
  const records: RecordAdapter = {
    describe: async (target) => {
      describes += 1
      return { ok: true, described: describedAs(target) }
    },
    read: async (request) => {
      reads += 1
      return { ok: true, described: describedAs(request.target.table), record: { values: { id: '7', tenant_id: '1', notes: 'before' }, version: V1 } }
    },
    list: async (request) => {
      lists.push(request)
      const line = (no: string) => ({ values: { order_id: '7', line_no: no, quantity: '2', product_id: null }, version: V1 })
      return { ok: true, described: describedAs(request.target.table), rows: [line('1'), line('2')], after: null }
    },
    insert: written('insert'),
    update: written('update'),
    supersede: written('supersede'),
    delete: written('delete'),
    save: async (request) => {
      saves.push(request)
      return (outcome ?? stored)(request)
    },
  }
  const lookups: LookupAdapter = {
    search: async () => ({ rows: [], hasMore: false, omitted: 0 }),
    resolve: async () => [],
    rejects: async (_config, tokens) => tokens.filter((token) => rejected.includes(token)),
  }
  const adapter = { kind: 'sqlserver', ping: async () => ({}), discover: async () => SNAPSHOT, close: async () => {} } as unknown as DatabaseAdapter
  return {
    ids: () => ['erp'],
    scope: () => ({ schemas: ['sales'] }),
    open: async (id) => (id === 'erp' ? { adapter, lookups, records, actions: {} as ActionAdapter } : undefined),
    close: async () => {},
  }
}

function bundleOf(request: GenerationRequest, policy: FormPolicy): BundleV2 {
  const { form, bindings } = generateForm(SNAPSHOT, request)
  return { format: 2, connection: 'erp', generation: request, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot: SNAPSHOT }
}

beforeEach(async () => {
  saves = []
  lists = []
  reads = 0
  describes = 0
  writes = []
  outcome = undefined
  rejected = []
  events = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-save-'))
  store = createFileConfigurationStore(root)
  await store.publish('order', null, bundleOf(ORDER_REQUEST, ORDER_POLICY))
  await store.publish('order-line', null, bundleOf(LINE_REQUEST, LINE_POLICY))
  // The lines again, as a plain child: the same table, through the same lookup, not saved with the order.
  await store.publish(
    'plain-line',
    null,
    bundleOf(
      {
        ...LINE_REQUEST,
        formId: 'plain-line',
        lookups: [
          { foreignKey: 'fk_line_order', display: ['notes'] },
          { foreignKey: 'fk_line_product', display: ['name'] },
        ],
      },
      LINE_POLICY,
    ),
  )
  const sink: AuditSink = (event) => {
    if (event.plane === 'runtime') events.push(event)
  }
  app = await createDataServer({
    verifyIdentity,
    runtime: { registry: registry(), store, saveDeadlineMs: DEADLINE_MS, audit: { sink, key: KEY, now: () => '2026-11-16T12:00:00.000Z' } },
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const save = (payload: unknown, token = 'clerk', headers: Record<string, string> = {}, form = 'order') =>
  app.inject({ method: 'POST', url: `/v1/forms/${form}/records/save`, headers: { ...as(token), ...headers }, payload: payload as Record<string, unknown> })
const lines = (...changes: unknown[]) => [{ form: 'order-line', field: 'order', changes }]
const NEW_ORDER = { record: { create: { answers: { notes: 'new' } } }, rows: lines({ create: { ref: 'a', answers: { line_no: 1, quantity: 2 } } }) }
const SAVED_ORDER = (changes: unknown[], answers: Record<string, unknown> = {}) => ({
  record: { update: { record: ORDER, version: V1, answers } },
  rows: lines(...changes),
})
/** Nothing of the database was asked or told. */
const untouched = () => ({ describes, reads, lists: lists.length, saves: saves.length, writes })
const NOTHING = { describes: 0, reads: 0, lists: 0, saves: 0, writes: [] }

describe('a save of a new record with its rows', () => {
  // What reaches the port is one request, planned from the record's table
  // and the child's table each described once: the order's insert, the
  // lines' `within`, their creates and their count, the read-back and the
  // configured deadline; and the answer is the order read back and each
  // line as stored, with the ref the page sent, in the order sent. Watched
  // failing with the route's deadline left at the default: the request
  // carried 1900.
  test('sends one request with every step, and answers the record and each row by its ref', async () => {
    const body = {
      record: { create: { answers: { notes: 'new' } } },
      rows: lines({ create: { ref: 'a', answers: { line_no: 1, quantity: 2 } } }, { create: { ref: 'b', answers: { line_no: 2, quantity: 3 } } }),
    }
    const response = await save(body)
    expect(response.statusCode, response.body).toBe(200)
    expect(untouched()).toEqual({ describes: 2, reads: 0, lists: 0, saves: 1, writes: [] })
    const [sent] = saves as [SaveRequest]
    expect(sent.record.kind).toBe('insert')
    expect(sent.deadlineMs).toBe(DEADLINE_MS)
    expect(sent.children).toHaveLength(1)
    expect(sent.children[0]).toMatchObject({ table: ref('order_line'), deletes: [], updates: [], count: { min: 1, max: 3 } })
    expect(sent.children[0]?.within).not.toBeNull()
    expect(sent.children[0]?.creates.map((create) => valuesOf(create.values)['line_no'])).toEqual(['1', '2'])
    expect(response.json()).toMatchObject({
      record: { record: ORDER, version: V2, answers: { notes: 'as stored' } },
      rows: [
        {
          form: 'order-line',
          field: 'order',
          changes: [
            { ref: 'a', row: { record: LINE_1 } },
            { ref: 'b', row: { record: LINE_2 } },
          ],
        },
      ],
    })
  })

  // An order that must hold a line is refused before anything is written
  // when the save creates none -- and when it leaves the child out
  // altogether, which nothing else would notice. The order's table is
  // described first, as for every new record's save, and nothing else is
  // asked: a child named with no change is read not at all. Watched failing
  // with the record's required children not handed to the planner: the
  // order was sent with no line.
  test('is refused too-few-rows, before anything is written, when it creates fewer rows than its record must hold', async () => {
    for (const body of [
      { record: { create: { answers: { notes: 'x' } } }, rows: [] },
      { record: { create: { answers: { notes: 'x' } } }, rows: lines() },
    ]) {
      const response = await save(body)
      expect([response.statusCode, response.json()], JSON.stringify(body)).toEqual([
        422,
        {
          code: 'too-few-rows',
          message: 'order-line holds at least 1 row of this record; it would hold 0.',
          at: { form: 'order-line', field: 'order' },
          rows: { form: 'order-line', field: 'order', min: 1, max: 3, held: 0 },
        },
      ])
    }
    expect(untouched()).toEqual({ describes: 2, reads: 0, lists: 0, saves: 0, writes: [] })
  })
})

describe('a save over a saved record', () => {
  // The order is read once, its lines listed once with `max + 1` rows by the
  // order's key, and the request carries a delete, an update and a create
  // in the planner's order; with no answer of the order changed, its step
  // is the touch. The answer is each change in the order sent: an update's
  // row, a delete's token, a create's row by its ref. Watched failing with
  // the answer's changes matched to the request's steps by position: the
  // delete was answered with the update's row.
  test('reads the record once, lists its rows once, and answers each change in the order sent', async () => {
    const response = await save(
      SAVED_ORDER([
        { update: { record: LINE_1, version: V1, answers: { quantity: 5 } } },
        { create: { ref: 'n', answers: { line_no: 3, quantity: 1 } } },
        { delete: { record: LINE_2, version: V1 } },
      ]),
    )
    expect(response.statusCode, response.body).toBe(200)
    expect(untouched()).toEqual({ describes: 0, reads: 1, lists: 1, saves: 1, writes: [] })
    expect(lists[0]).toMatchObject({ limit: 4, equal: [{ name: 'order_id', value: '7' }] })
    const [sent] = saves as [SaveRequest]
    expect(sent.record.kind).toBe('touch')
    expect(sent.children[0]).toMatchObject({ deletes: [{ expectedVersion: V1 }], updates: [{ expectedVersion: V1 }], creates: [{}] })
    expect(response.json().rows).toEqual([
      {
        form: 'order-line',
        field: 'order',
        changes: [
          { row: expect.objectContaining({ record: LINE_1, version: V2 }) },
          { ref: 'n', row: expect.objectContaining({ record: lineToken(3), version: V2 }) },
          { deleted: LINE_2 },
        ],
      },
    ])
  })

  // A row the order's list does not hold -- another order's, or one this
  // person may not read -- is not found at its part, before anything is
  // written: never forbidden, which would say it exists (0012).
  test('answers a row its record does not hold not found, at the row, before anything is written', async () => {
    const other = lineToken(9)
    const response = await save(SAVED_ORDER([{ update: { record: other, version: V1, answers: { quantity: 5 } } }]))
    expect([response.statusCode, response.json()]).toEqual([
      404,
      { code: 'not-found', message: 'No such row of this record.', at: { form: 'order-line', field: 'order', record: other } },
    ])
    expect(saves).toEqual([])
  })
})

describe('the rules before anything is read (§5)', () => {
  // Rule 1: a body that is not a save is 400, and nothing is asked of the
  // store or the database: a record of two kinds, a ref no page mints, one
  // ref twice, one row twice, a child twice, and a save that changes
  // nothing. Watched failing with the duplicate ref let through: the save
  // reached the port with two creates under one ref.
  test('rule 1: a body that is not one save is 400, nothing read', async () => {
    const bad: unknown[] = [
      { record: { create: { answers: {} }, update: { record: ORDER, version: V1, answers: {} } }, rows: [] },
      { record: { create: { answers: {} } } },
      { record: { create: { answers: {} } }, rows: lines({ create: { ref: 'a b', answers: {} } }) },
      { record: { create: { answers: {} } }, rows: lines({ create: { ref: 'a', answers: {} } }, { create: { ref: 'a', answers: {} } }) },
      SAVED_ORDER([{ update: { record: LINE_1, version: V1, answers: {} } }, { delete: { record: LINE_1, version: V1 } }]),
      { record: { create: { answers: {} } }, rows: [...lines(), ...lines()] },
      { record: { create: { answers: {} } }, rows: lines({ delete: { record: LINE_1 } }) },
    ]
    for (const body of bad) {
      const response = await save(body)
      expect([response.statusCode, response.json().code], JSON.stringify(body)).toEqual([400, 'invalid-request'])
    }
    const nothing = await save(SAVED_ORDER([]))
    expect([nothing.statusCode, nothing.json().code]).toEqual([400, 'nothing-to-update'])
    expect(untouched()).toEqual(NOTHING)
  })

  // Rule 2: a child is one the menu names under this form for this person,
  // saved with it, through that field -- not a plain child of the same
  // table, a form that is no child, or a field it is not saved through.
  // Watched failing with the child's `together` not asked: the plain
  // child's lines reached the planner.
  test('rule 2: a form that is not this one’s together child, through that field, is 400', async () => {
    for (const [form, field] of [
      ['plain-line', 'order'],
      ['order-line', 'product'],
      ['nope', 'order'],
    ]) {
      const response = await save({ record: { create: { answers: {} } }, rows: [{ form, field, changes: [] }] })
      expect([response.statusCode, response.json()]).toEqual([
        400,
        { code: 'invalid-request', message: `${form as string} is not saved with this form's records through ${field as string}.` },
      ])
    }
    expect(untouched()).toEqual(NOTHING)
  })

  // Rule 3: every part's operation is asked of its own form's policy before
  // anything is read, and the first refusal answers alone, at its part: an
  // auditor's create of the order, an editor's delete of a line. Nobody the
  // policy refuses is told a field error. Watched failing with the
  // children's operations left to the planner: the editor's save read the
  // order and listed its lines first.
  test('rule 3: a policy refusal anywhere answers alone, at its part, before any read', async () => {
    const auditor = await save(NEW_ORDER, 'auditor')
    expect([auditor.statusCode, auditor.json()]).toEqual([403, { code: 'operation-denied', message: expect.any(String), at: { record: true } }])
    const editor = await save(SAVED_ORDER([{ delete: { record: LINE_2, version: V1 } }], { notes: 'x'.repeat(500) }), 'editor')
    expect([editor.statusCode, editor.json()]).toEqual([
      403,
      { code: 'operation-denied', message: expect.any(String), at: { form: 'order-line', field: 'order' } },
    ])
    expect(untouched()).toEqual(NOTHING)
  })

  // A new record a together child requires rows of is saved only by a
  // person who could make that save, where the menu offers its create:
  // intake may create orders and never sees a line, so its save of an order
  // with no rows is refused before anything is read, naming no child. The
  // planner's too-few-rows would name the line form, its field and its
  // bounds to somebody who may not read them (0045). Watched failing with
  // the check taken out: 422 too-few-rows naming order-line, after the
  // order's table was described.
  test('a new record whose rows the person could not save with it is 403 before any read, naming no child', async () => {
    const response = await save({ record: { create: { answers: { notes: 'x' } } }, rows: [] }, 'intake')
    expect([response.statusCode, response.json()]).toEqual([
      403,
      { code: 'operation-unavailable', message: 'A record of this form is created with the rows saved with it, in one save.', at: { record: true } },
    ])
    expect(response.body).not.toContain('order-line')
    expect(untouched()).toEqual(NOTHING)
  })

  // Rule 4: the field that names the record is the server's. A new row
  // that sends it is over-posting at its ref; a row's update may send the
  // record's own token back, which is dropped, and nothing else. Watched
  // failing with a new row's answer for it let through, and with another
  // value on an update dropped rather than refused: each line was saved,
  // 200; and with every row read as behind its version: the moved value was
  // dropped as an echo, and the update reached the port. With the field
  // passed to the update as sent it still passes: the route drops the echo
  // first, and the update's own check refuses a field written on create
  // only.
  test('rule 4: the field that names the record is the server’s', async () => {
    const created = await save({ ...NEW_ORDER, rows: lines({ create: { ref: 'a', answers: { order: ORDER, line_no: 1, quantity: 2 } } }) })
    expect([created.statusCode, created.json()]).toMatchObject([403, { code: 'over-posting', at: { form: 'order-line', field: 'order', ref: 'a' } }])
    const moved = await save(SAVED_ORDER([{ update: { record: LINE_1, version: V1, answers: { order: 'k1:8', quantity: 5 } } }]))
    expect([moved.statusCode, moved.json()]).toMatchObject([403, { code: 'over-posting', at: { form: 'order-line', field: 'order', record: LINE_1 } }])
    expect(saves).toEqual([])
    const echoed = await save(SAVED_ORDER([{ update: { record: LINE_1, version: V1, answers: { order: ORDER, quantity: 5 } } }]))
    expect(echoed.statusCode, echoed.body).toBe(200)
    expect(saves[0]?.children[0]?.updates[0]?.set.map((entry) => entry.name)).toEqual(['quantity'])
  })

  // Rule 5: one write id, one adapter call. The same body sent again with
  // it is answered with the first answer and asks nothing; another body
  // with it is 400, since answering it with the first answer would say
  // "saved" of something never sent. Watched failing with the save route
  // sending without `sendOnce`: the port was called twice.
  test('rule 5: one adapter call per write id, and the same id with another body is 400', async () => {
    const id = { 'formancy-write-id': WRITE_ID }
    const first = await save(NEW_ORDER, 'clerk', id)
    const again = await save(NEW_ORDER, 'clerk', id)
    expect([first.statusCode, again.statusCode]).toEqual([200, 200])
    expect(again.json()).toEqual(first.json())
    expect(saves).toHaveLength(1)
    const other = await save({ ...NEW_ORDER, record: { create: { answers: { notes: 'other' } } } }, 'clerk', id)
    expect([other.statusCode, other.json().code]).toEqual([400, 'invalid-request'])
    expect(saves).toHaveLength(1)
    expect(events.map(({ outcome }) => outcome)).toEqual(['ok', 'repeated', 'invalid-request'])
  })
})

describe('what a save is answered with', () => {
  // Every part's field errors at once, each in its own form's field keys at
  // its part, so a person fixes them all with one more press. Watched
  // failing with the record's errors answered alone.
  test('every part’s field errors at once', async () => {
    const response = await save({
      record: { create: { answers: { notes: 'x'.repeat(500) } } },
      rows: lines({ create: { ref: 'a', answers: { line_no: 'one', quantity: 2 } } }),
    })
    expect(response.statusCode, response.body).toBe(422)
    expect(response.json()).toMatchObject({
      code: 'invalid-values',
      parts: [
        { at: { record: true }, fieldErrors: [{ field: 'notes' }] },
        { at: { form: 'order-line', field: 'order', ref: 'a' }, fieldErrors: [{ field: 'line_no' }] },
      ],
    })
    expect(saves).toEqual([])
  })

  // A selection that is not an option is a field error at its row, every
  // row's at once, nothing sent. Watched failing with the plan's checks
  // left unasked: the save was sent with the product the check refuses,
  // and answered 200.
  test('a selection the membership check refuses, at its row', async () => {
    rejected = ['k1:5']
    const response = await save({ ...NEW_ORDER, rows: lines({ create: { ref: 'a', answers: { line_no: 1, quantity: 2, product: 'k1:5' } } }) })
    expect([response.statusCode, response.json()]).toEqual([
      422,
      {
        code: 'invalid-values',
        message: 'A selection is not one of the options.',
        parts: [{ at: { form: 'order-line', field: 'order', ref: 'a' }, fieldErrors: [expect.objectContaining({ field: 'product', code: 'not-an-option' })] }],
      },
    ])
    expect(saves).toEqual([])
  })

  // The transaction's refusals, at the step that refused: a stale line in
  // the save's words, which never say "nothing was saved" (a resend another
  // process answers stale may have been stored); a line's unique key as a
  // field error on that line; a count past its bound with what it held;
  // `within` as the child's rejected selection; and the save past its
  // deadline as unavailable, naming the deadline. Watched failing with
  // every step's failure answered without its part: no `at`.
  test('the transaction’s refusal, at its step', async () => {
    const body = SAVED_ORDER([
      { update: { record: LINE_1, version: V1, answers: { quantity: 5 } } },
      { create: { ref: 'n', answers: { line_no: 3, quantity: 1 } } },
    ])
    const answered = async (failed: SaveOutcome) => {
      outcome = () => failed
      const response = await save(body)
      return [response.statusCode, response.json()]
    }
    expect(await answered({ ok: false, at: { child: 0, update: 0 }, failure: { ok: false, code: 'stale', message: 'driver words' } })).toEqual([
      409,
      {
        code: 'stale',
        message: 'This record or its rows changed since they were read. Reload them, review the changes, and save again.',
        at: { form: 'order-line', field: 'order', record: LINE_1 },
      },
    ])
    expect(
      await answered({ ok: false, at: { child: 0, create: 0 }, failure: { ok: false, code: 'unique-violation', message: 'x', column: 'line_no' } }),
    ).toEqual([
      422,
      {
        code: 'unique-violation',
        message: 'Another record already has this value.',
        fieldErrors: [{ field: 'line_no', code: 'unique-violation', message: 'Another record already has this value.' }],
        at: { form: 'order-line', field: 'order', ref: 'n' },
      },
    ])
    expect(await answered({ ok: false, at: { child: 0, count: true }, held: 4 })).toEqual([
      422,
      {
        code: 'too-many-rows',
        message: 'order-line holds at most 3 rows of this record; this save would leave it 4.',
        at: { form: 'order-line', field: 'order' },
        rows: { form: 'order-line', field: 'order', min: 1, max: 3, held: 4 },
      },
    ])
    expect(await answered({ ok: false, at: { child: 0, within: true }, rejected: true })).toEqual([
      422,
      {
        code: 'invalid-values',
        message: 'The record is not one these rows may reference.',
        parts: [{ at: { form: 'order-line', field: 'order' }, fieldErrors: [expect.objectContaining({ field: 'order', code: 'not-an-option' })] }],
      },
    ])
    expect(await answered({ ok: false, at: 'save', failure: { ok: false, code: 'unavailable', message: 'driver words' } })).toEqual([
      503,
      {
        code: 'unavailable',
        message: `The database could not complete this save now, or not within the ${String(DEADLINE_MS)} ms the server allows, and it was rolled back. Nothing was saved.`,
      },
    ])
  })

  // A lost answer is 502, naming what was addressed: over a saved record
  // its token and the version sent, which every save moves, so saving again
  // with it is stored at most once; a new record whose key the database
  // numbers, none. Sent once, never again. Watched failing with the
  // version left out of the 502: `version` was null over a saved order.
  test('a lost answer is 502 naming the record and the version sent, sent once', async () => {
    outcome = () => ({ ok: false, at: 'save', failure: { ok: false, code: 'unknown-outcome', message: 'the connection was lost' } })
    const update = await save(SAVED_ORDER([{ create: { ref: 'n', answers: { line_no: 3, quantity: 1 } } }]))
    expect([update.statusCode, update.json()]).toMatchObject([502, { code: 'unknown-outcome', operation: 'save', record: ORDER, version: V1 }])
    const create = await save(NEW_ORDER)
    expect([create.statusCode, create.json()]).toMatchObject([502, { code: 'unknown-outcome', operation: 'save', record: null, version: null }])
    expect(saves).toHaveLength(2)
  })

  // One event per save: `save`, the order's keyed hash, the number of row
  // changes the body carried, and nothing else of them -- no child form,
  // ref, line token or value. Watched failing with `rows` read for exports
  // alone: the save's event said null.
  test('the audit is one event with no value and a rows count', async () => {
    const response = await save(
      SAVED_ORDER(
        [{ update: { record: LINE_1, version: V1, answers: { quantity: 5 } } }, { create: { ref: 'secret-ref', answers: { line_no: 3, quantity: 1 } } }],
        {
          notes: 'a value nobody logs',
        },
      ),
    )
    expect(response.statusCode, response.body).toBe(200)
    expect(events).toEqual([
      {
        at: '2026-11-16T12:00:00.000Z',
        plane: 'runtime',
        actor: 'clerk',
        operation: 'save',
        form: 'order',
        formVersion: 1,
        status: 200,
        outcome: 'ok',
        record: recordReference(KEY, ORDER),
        rows: 2,
        moved: null,
      },
    ])
    const written = JSON.stringify(events)
    for (const text of ['secret-ref', LINE_1, 'a value nobody logs', 'order-line']) expect(written).not.toContain(text)
  })
})

describe('the record and its rows on the other routes', () => {
  // A line is created and deleted only with its order: alone, the line
  // form's create and delete are refused and nothing is written, and its
  // update stays (open question 3 (b)). The planner refuses each over the
  // line's table as described, as it refuses a write a form does not offer
  // at all, so each describes it once and asks nothing else. Watched
  // failing with the planners asking `offers()`: the line's create reached
  // the port.
  test('a per-row create or delete of a together child is 403', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/forms/order-line/records/create',
      headers: as('clerk'),
      payload: { answers: { order: ORDER, line_no: 4, quantity: 1 } },
    })
    expect([create.statusCode, create.json().code]).toEqual([403, 'operation-unavailable'])
    const remove = await app.inject({
      method: 'POST',
      url: '/v1/forms/order-line/records/delete',
      headers: as('clerk'),
      payload: { record: LINE_1, version: V1 },
    })
    expect([remove.statusCode, remove.json().code]).toEqual([403, 'operation-unavailable'])
    expect(untouched()).toEqual({ describes: 2, reads: 0, lists: 0, saves: 0, writes: [] })
  })

  // An order that must hold a line is never created alone, whoever asks,
  // and the refusal names no child the person may not read; it is decided
  // before the order's table is described. Watched failing with the create
  // route not asking `rowsRequired`: the insert was sent.
  test('a plain create of a record whose rows are required is 403, before any statement', async () => {
    for (const token of ['clerk', 'intake']) {
      const response = await app.inject({ method: 'POST', url: '/v1/forms/order/records/create', headers: as(token), payload: { answers: { notes: 'alone' } } })
      expect([response.statusCode, response.json()]).toEqual([
        403,
        { code: 'operation-unavailable', message: 'A record of this form is created with the rows saved with it, in one save.' },
      ])
    }
    expect(untouched()).toEqual(NOTHING)
  })

  // The form route offers the order's create exactly where the menu does:
  // to a clerk, who can make the save, and not to intake, who never sees a
  // line. The line form says it is saved with its order, and offers no
  // create alone. Watched failing with the form route asking
  // `grantedOperations` alone: intake was offered the create.
  test('the form route offers the create the menu does, and the child says it is saved with its record', async () => {
    const opened = async (form: string, token: string) => (await app.inject({ method: 'GET', url: `/v1/forms/${form}`, headers: as(token) })).json()
    expect((await opened('order', 'clerk')).operations).toEqual(['read', 'create', 'update'])
    expect((await opened('order', 'intake')).operations).toEqual(['read'])
    const line = await opened('order-line', 'clerk')
    expect([line.operations, line.together]).toEqual([['read', 'update'], { field: 'order', min: 1, max: 3 }])
    expect((await opened('order', 'clerk')).together).toBeNull()
    const menu = (await app.inject({ method: 'GET', url: '/v1/forms', headers: as('intake') })).json()
    expect(menu.forms.find((entry: { id: string }) => entry.id === 'order').operations).toEqual(['read'])
  })

  // A store that cannot list its forms cannot say which children require
  // rows of a record, so nothing is created on a guess: a plain create of
  // any form -- the plain lines', which no together child requires rows
  // of, as the order's -- and a save, with rows and without, are 503 with
  // nothing described or sent, and the form route offers no create.
  // Watched failing with each null branch, one at a time, read as no child
  // required: the plain line's create reached the insert; the save of an
  // order with no rows was answered 200, the order stored with no line, and
  // the save with a line 400 naming a child the store had not listed; and
  // the form route offered the clerk the plain lines' create.
  test('a store that cannot list its forms refuses every plain create and every save, and offers no create', async () => {
    const failing: ConfigurationStore = {
      ...store,
      list: async () => {
        throw new Error('the store cannot list its forms')
      },
    }
    const unlisted = await createDataServer({ verifyIdentity, runtime: { registry: registry(), store: failing, saveDeadlineMs: DEADLINE_MS } })
    try {
      const sent = (url: string, payload: Record<string, unknown>) => unlisted.inject({ method: 'POST', url, headers: as('clerk'), payload })
      const UNREAD = { code: 'unavailable', message: 'The forms this one is saved with cannot be read now. Nothing was saved.' }
      for (const [url, payload] of [
        ['/v1/forms/plain-line/records/create', { answers: { order: ORDER, line_no: 4, quantity: 1 } }],
        ['/v1/forms/order/records/create', { answers: { notes: 'alone' } }],
        ['/v1/forms/order/records/save', NEW_ORDER],
        ['/v1/forms/order/records/save', { record: { create: { answers: { notes: 'alone' } } }, rows: [] }],
      ] as const) {
        const response = await sent(url, payload)
        expect([response.statusCode, response.json()], url).toEqual([503, UNREAD])
      }
      expect(untouched()).toEqual(NOTHING)
      const listed = (await app.inject({ method: 'GET', url: '/v1/forms/plain-line', headers: as('clerk') })).json().operations as string[]
      expect(listed).toContain('create')
      const opened = await unlisted.inject({ method: 'GET', url: '/v1/forms/plain-line', headers: as('clerk') })
      expect(opened.statusCode, opened.body).toBe(200)
      expect(opened.json().operations).toEqual(listed.filter((operation) => operation !== 'create'))
    } finally {
      await unlisted.close()
    }
  })
})
