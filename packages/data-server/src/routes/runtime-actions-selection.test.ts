import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, DUPLICATE_RECORD, EMPTY_PRESENTATION, generateForm, LIST_PAGE_SIZE, recordToken } from '@formancy/data-core'
import type {
  ActionAdapter,
  ActionOutcome,
  ActionRequest,
  ColumnMeta,
  DatabaseAdapter,
  DescribedAction,
  DescribedTable,
  FormPolicy,
  GenerationRequest,
  LookupAdapter,
  NormalizedType,
  ObjectMeta,
  ObjectRef,
  RecordAdapter,
  RoutineMeta,
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
 * `POST /v1/forms/:id/actions/:action/run` over a selection (0165), over
 * fake ports. What the database does with a selection -- the records
 * locked in key order, all or nothing, two keys its collation makes one
 * -- is the adapters' suites' business, against real servers (0003);
 * what is under test here is what the route decides around the one run it
 * sends: a page of records at most, before any statement; one record named
 * twice, before the run; which records a refusal is about, by the tokens
 * sent; and what the trail names -- every record, by its keyed hash, and
 * their count. Every case was watched failing on 2026-11-17, its rule
 * taken out and put back.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
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
const ORDER_TABLE: ObjectMeta = {
  ref: { schema: 'sales', name: 'order' },
  kind: 'table',
  comment: null,
  columns: [col('id', 1, INT64, { generated: 'identity-always' }), col('tenant_id', 2, INT32), col('version', 3, INT32, { hasDefault: true })],
  primaryKey: { name: 'pk_order', columns: ['id'] },
  uniqueKeys: [],
  foreignKeys: [],
  checks: [],
  rowSecurity: 'none',
  access: { delete: true },
  referencedBy: [],
}
/** Ships an order, by its key alone. */
const SHIP_ORDER: RoutineMeta = {
  ref: { schema: 'sales', name: 'ship_order', signature: 'pg_catalog.int8' },
  kind: 'function',
  parameters: [{ name: 'p_order', mode: 'in', typeId: '20', databaseType: 'bigint', type: INT64, hasDefault: false }],
  effects: 'writes',
  returns: 'void',
  result: null,
  reach: 'account',
  executable: true,
}
const SNAPSHOT = createSnapshot({
  kind: 'postgres',
  serverVersion: '17.0',
  account: { user: 'writer', login: 'writer' },
  scope: { schemas: ['sales'], routines: true },
  gaps: [],
  objects: [ORDER_TABLE],
  routines: [SHIP_ORDER],
})

const parameters = [{ parameter: 'p_order', from: { key: 'id' } }]
/** `ship` over the open record, and `ship-all` over a selection of the page: one routine, two scopes. */
const REQUEST: GenerationRequest = {
  connection: 'erp',
  root: { schema: 'sales', name: 'order' },
  formId: 'order',
  title: 'Order',
  lookups: [],
  pinned: [],
  versionColumn: 'version',
  actions: [
    { name: 'ship', routine: SHIP_ORDER.ref, scope: 'record', parameters },
    { name: 'ship-all', routine: SHIP_ORDER.ref, scope: 'selection', parameters },
  ],
}

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'clerk' ? { ok: true, identity: { actor: { id: 'clerk', roles: ['clerk'] }, attributes: { tenant: '1' } } } : { ok: false, reason: 'bad' }

const KEY = 'an-audit-key-the-operator-keeps-secret'
const DEFINITION = 'the definition the fake catalog described'
/** The token of order `id`. */
const token = (id: number): string => {
  const encoded = recordToken(['id'], { id: String(id) })
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}
/** `count` orders of the page, by their tokens, each at version 3: orders 1 to `count`. */
const page = (count: number) => Array.from({ length: count }, (_, index) => ({ record: token(index + 1), version: '3' }))

let described: number
let runs: ActionRequest[]
/** What the fake run answers; undefined is done, each record by its key in the order sent. */
let outcome: ((request: ActionRequest) => Promise<ActionOutcome>) | undefined
let opened: number
let events: RuntimeAuditEvent[]
let directory: string
let store: ConfigurationStore
let app: FastifyInstance

function registry(): ConnectionRegistry {
  const unsent = async (): Promise<never> => {
    throw new Error('an action asks nothing of the records port but the form’s description')
  }
  const now = (table: ObjectRef): DescribedTable => ({ ...(describedOf(SNAPSHOT, table) as Omit<DescribedTable, 'definition'>), definition: DEFINITION })
  const records = {
    describe: async (table: ObjectRef) => ({ ok: true, described: now(table) }),
    read: unsent,
    list: unsent,
    insert: unsent,
    update: unsent,
    supersede: unsent,
    delete: unsent,
    save: unsent,
  }
  const actions: ActionAdapter = {
    describe: async (table): Promise<DescribedAction> => {
      described += 1
      const { executable: _executable, ...routine } = SHIP_ORDER
      return { ok: true, table: now(table), routine: { ...routine, definition: DEFINITION } }
    },
    run: async (request) => {
      runs.push(request)
      if (outcome !== undefined) return outcome(request)
      return { ok: true, records: request.records.map((record) => ({ id: String(record.key[0]?.value) })) }
    },
  }
  const adapter = { kind: 'postgres', ping: async () => ({}), discover: async () => SNAPSHOT, close: async () => {} } as unknown as DatabaseAdapter
  const open = { adapter, lookups: {} as LookupAdapter, records: records as unknown as RecordAdapter, actions, actionPool: 10 }
  const opens = async (id: string) => {
    opened += 1
    return id === 'erp' ? open : undefined
  }
  return { ids: () => ['erp'], scope: () => ({ schemas: ['sales'] }), open: opens, close: async () => {} }
}

function bundle(): BundleV2 {
  const { form, bindings } = generateForm(SNAPSHOT, REQUEST)
  if ((bindings.actions ?? []).length !== 2) throw new Error('the generator did not bind both actions')
  const read = { read: ['clerk'], write: [] }
  const policy: FormPolicy = {
    version: 1,
    operations: { read: ['clerk'], create: [], update: [] },
    fields: Object.fromEntries(bindings.fields.map((binding) => [binding.field, read])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: {},
    actions: { ship: { roles: ['clerk'] }, 'ship-all': { roles: ['clerk'] } },
  }
  return { format: 2, connection: 'erp', generation: REQUEST, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot: SNAPSHOT }
}

/** The server, its trail keyed by `key`, or by no key at all for `null`. */
async function start(key: string | null = KEY): Promise<FastifyInstance> {
  const sink: AuditSink = (event) => {
    if (event.plane === 'runtime') events.push(event)
  }
  return createDataServer({
    verifyIdentity,
    runtime: {
      registry: registry(),
      store,
      actionDeadlineMs: 4321,
      audit: { sink, ...(key === null ? {} : { key }), now: () => '2026-11-17T12:00:00.000Z' },
    },
  })
}

beforeEach(async () => {
  described = 0
  runs = []
  outcome = undefined
  opened = 0
  events = []
  directory = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-selection-'))
  store = createFileConfigurationStore(directory)
  await store.publish('order', null, bundle())
  app = await start()
})

afterEach(async () => {
  await app.close()
  await rm(directory, { recursive: true, force: true })
})

const run = (records: unknown, action = 'ship-all') =>
  app.inject({
    method: 'POST',
    url: `/v1/forms/order/actions/${action}/run`,
    headers: { authorization: 'Bearer clerk' },
    payload: { records, answers: {} } as Record<string, unknown>,
  })
const asked = () => ({ described, runs: runs.length })

describe('a run over a selection', () => {
  // The form offers the selection action as one, so a page draws it over
  // the grid and never in a record's header; a run of a page of records is
  // described once, sent once with every record in the order sent, and
  // answered with each token. Watched failing with the server's reading of
  // a generation request taking `record` alone: the stored form was
  // `corrupt-bundle`, and GET offered nothing ("Cannot read properties of
  // undefined (reading 'map')").
  test('is offered as a selection, and a page of records is sent once and answered with every token', async () => {
    const form = await app.inject({ method: 'GET', url: '/v1/forms/order', headers: { authorization: 'Bearer clerk' } })
    expect(form.json<{ actions: Array<{ name: string; scope: string }> }>().actions.map(({ name, scope }) => [name, scope])).toEqual([
      ['ship', 'record'],
      ['ship-all', 'selection'],
    ])
    const records = page(LIST_PAGE_SIZE).reverse()
    const response = await run(records)
    expect([response.statusCode, response.json()]).toEqual([200, { records: records.map(({ record }) => record) }])
    expect(asked()).toEqual({ described: 1, runs: 1 })
    expect(runs[0]?.records.map((record) => record.key[0]?.value)).toEqual(records.map(({ record }) => record.slice('k1:'.length)))
  })

  // A selection is rows of the one page a list shows: one more is refused
  // before the connection is opened -- whose first opening pings the
  // database -- and before anything is described or sent, and so is none.
  // Watched failing with the bound taken out of readRunBody, the planner's
  // own still refusing it, after a description: "expected { described: 1,
  // runs: +0, opened: 1 } to deeply equal { described: +0, runs: +0,
  // opened: +0 }".
  test('is refused 400 past a page, before any statement', async () => {
    for (const records of [page(LIST_PAGE_SIZE + 1), []]) {
      const response = await run(records)
      expect([response.statusCode, response.json().code]).toEqual([400, 'invalid-request'])
    }
    expect({ ...asked(), opened }).toEqual({ described: 0, runs: 0, opened: 0 })
  })

  // An action over the open record runs over one record, whatever the
  // body says: two are refused and nothing is sent. Watched failing with
  // the planner reading every action as a selection: "expected [ 200,
  // undefined ] to deeply equal [ 400, 'invalid-request' ]".
  test('of the open record’s action over two records is refused, nothing sent', async () => {
    const response = await run(page(2), 'ship')
    expect([response.statusCode, response.json().code]).toEqual([400, 'invalid-request'])
    expect(runs).toEqual([])
  })

  // Two tokens of one key are refused before the run, in the words a
  // person reads, naming both by the tokens sent. Watched failing with the
  // planner's positions left out of the answer: "expected [ 400, …(1) ] to
  // deeply equal [ 400, …(1) ]", its records [].
  test('naming one record twice is 400 duplicate-record naming both, nothing sent', async () => {
    const [first, second] = page(2) as [{ record: string; version: string }, { record: string; version: string }]
    const response = await run([first, second, { ...first, version: '4' }])
    expect([response.statusCode, response.json()]).toEqual([
      400,
      { code: 'duplicate-record', message: DUPLICATE_RECORD, records: [first.record, first.record] },
    ])
    expect(runs).toEqual([])
  })

  // A refusal the adapter names records for is answered naming them by the
  // tokens sent, so a page knows which of a selection to read again: two
  // stale of three, and two keys the database's collation makes one row,
  // found by the adapter once both were locked. Watched failing with the
  // adapter's positions unread: "expected [ 409, { code: 'stale', …(2) } ]
  // to deeply equal [ 409, { code: 'stale', …(2) } ]", its records [].
  test('refused over some of its records names them by the tokens sent', async () => {
    const records = page(3)
    outcome = async () => ({ ok: false, code: 'stale', message: 'm', records: [2, 0] })
    const stale = await run(records)
    expect([stale.statusCode, stale.json()]).toEqual([
      409,
      { code: 'stale', message: expect.stringContaining('Nothing was done.'), records: [records[2]?.record, records[0]?.record] },
    ])
    outcome = async () => ({ ok: false, code: 'duplicate-record', message: 'm', records: [0, 1] })
    const duplicate = await run(records)
    expect([duplicate.statusCode, duplicate.json()]).toEqual([
      400,
      { code: 'duplicate-record', message: DUPLICATE_RECORD, records: [records[0]?.record, records[1]?.record] },
    ])
  })

  // The open record's action is answered in the one shape too: a 409 or a
  // 404 about its record carries `records`, its one token, so a client
  // reads every refusal about records one way whichever action it ran
  // (`ActionRecordsRefusal`). Without it a client holding the shape would
  // find no record named, and a page that reads `records` to know what to
  // read again would read nothing for the open record's action.
  test('of the open record’s action, refused about its record, names it too', async () => {
    const [one] = page(1) as [{ record: string; version: string }]
    outcome = async () => ({ ok: false, code: 'stale', message: 'm', records: [0] })
    const stale = await run([one], 'ship')
    expect([stale.statusCode, stale.json()]).toEqual([409, { code: 'stale', message: expect.stringContaining('Nothing was done.'), records: [one.record] }])
    outcome = async () => ({ ok: false, code: 'not-found', message: 'm', records: [0] })
    const gone = await run([one], 'ship')
    expect([gone.statusCode, gone.json()]).toEqual([404, { code: 'not-found', message: 'No such record. Nothing was done.', records: [one.record] }])
  })
})

describe('what a run over a selection leaves behind', () => {
  // One event naming every record addressed by its keyed hash, in the
  // order sent, and their count, the action by its name and no record of
  // its own: fifty updates leave fifty hashed records, and one run over
  // the same fifty answers "who shipped order 7" as well. The open
  // record's action keeps its one record and no `records`. Watched failing
  // with the trail naming the first record alone, as the open record's
  // does: "expected [ { …(12) }, { …(12) } ] to deeply equal [ { …(13) }, {
  // …(12) } ]".
  test('is one event naming every record by its keyed hash, and their count', async () => {
    const records = page(3)
    await run(records)
    await run(page(1), 'ship')
    const base = { at: '2026-11-17T12:00:00.000Z', plane: 'runtime', actor: 'clerk', operation: 'action', form: 'order', formVersion: 1, moved: null }
    expect(events).toEqual([
      {
        ...base,
        status: 200,
        outcome: 'ok',
        action: 'ship-all',
        record: null,
        rows: 3,
        records: records.map(({ record }) => recordReference(KEY, record)),
      },
      { ...base, status: 200, outcome: 'ok', action: 'ship', record: recordReference(KEY, token(1)), rows: null },
    ])
  })

  // Without an audit key no hash resists a guess at a small key, so the
  // trail names no record rather than one that only looks redacted -- and
  // still says how many. Watched failing with each record named under no
  // key as what recordReference gives it: "expected [ { record: null, …(2)
  // } ] to deeply equal [ { record: null, …(2) } ]", its records [ '', ''
  // ].
  test('names no record without an audit key, and still their count', async () => {
    await app.close()
    app = await start(null)
    await run(page(2))
    expect(events.map(({ record, records, rows }) => ({ record, records, rows }))).toEqual([{ record: null, records: null, rows: 2 }])
  })
})
