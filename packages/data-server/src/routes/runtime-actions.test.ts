import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, EMPTY_PRESENTATION, generateForm, recordToken } from '@formancy/data-core'
import type {
  ActionAdapter,
  ActionOutcome,
  ActionRequest,
  ColumnMeta,
  DatabaseAdapter,
  DiscoveryScope,
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
  RoutineParameter,
} from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { actionDeadlineSetting, DEFAULT_ACTION_DEADLINE_MS } from '../action-deadline.js'
import { createDataServer } from '../app.js'
import type { AuditSink, RuntimeAuditEvent } from '../audit.js'
import { recordReference } from '../audit.js'
import type { BundleV2 } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'

/*
 * `POST /v1/forms/:id/actions/:action/run` (0161), and the actions `GET
 * /v1/forms/:id` offers, over fake ports. What the database does with a run
 * is the adapters' suites' business, against real servers (0003, 0160);
 * what is under test here is what the route decides before and after the
 * one run it sends: who may run it, before any statement; what drift
 * stops; the answers' field errors; one run per write id; a full pool
 * refused with nothing sent; and what the trail and the log say -- never
 * an answer.
 */

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
const TEXT: NormalizedType = { kind: 'text', maxLength: null, lengthUnit: 'code-points', fixedLength: false }
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
const ORDER_TABLE: ObjectMeta = {
  ref: ref('order'),
  kind: 'table',
  comment: null,
  columns: [
    col('id', 1, INT64, { generated: 'identity-always' }),
    col('tenant_id', 2, INT32),
    col('amount', 3, INT32),
    col('note', 4, TEXT, { nullable: true }),
    col('version', 5, INT32, { hasDefault: true }),
  ],
  primaryKey: { name: 'pk_order', columns: ['id'] },
  uniqueKeys: [],
  foreignKeys: [],
  checks: [],
  rowSecurity: 'none',
  access: { delete: true },
  referencedBy: [],
}

/** A PostgreSQL parameter of a built-in type by its oid, as discovery records one. */
const parameter = (name: string, typeId: string, databaseType: string, type: NormalizedType): RoutineParameter => ({
  name,
  mode: 'in',
  typeId,
  databaseType,
  type,
  hasDefault: false,
})
const routine = (name: string, signature: string, parameters: RoutineParameter[]): RoutineMeta => ({
  ref: { schema: 'sales', name, signature },
  kind: 'function',
  parameters,
  effects: 'writes',
  returns: 'void',
  result: null,
  reach: 'account',
  executable: true,
})
/** Closes an order: its key, a note and a due date asked of the person, its amount as stored, who closed it and the tenant. */
const CLOSE_ORDER = routine('close_order', 'pg_catalog.int8, pg_catalog.text, pg_catalog.date, pg_catalog.int4, pg_catalog.text, pg_catalog.int4', [
  parameter('p_order', '20', 'bigint', INT64),
  parameter('p_note', '25', 'text', TEXT),
  parameter('p_due', '1082', 'date', { kind: 'date' }),
  parameter('p_amount', '23', 'integer', INT32),
  parameter('p_actor', '25', 'text', TEXT),
  parameter('p_tenant', '23', 'integer', INT32),
])
/** Ships an order, by its key alone. */
const SHIP_ORDER = routine('ship_order', 'pg_catalog.int8', [parameter('p_order', '20', 'bigint', INT64)])

const SNAPSHOT = createSnapshot({
  kind: 'postgres',
  serverVersion: '17.0',
  account: { user: 'writer', login: 'writer' },
  scope: { schemas: ['sales'], routines: true },
  gaps: [],
  objects: [ORDER_TABLE],
  routines: [CLOSE_ORDER, SHIP_ORDER],
})

const REQUEST: GenerationRequest = {
  connection: 'erp',
  root: ref('order'),
  formId: 'order',
  title: 'Order',
  lookups: [],
  pinned: [],
  versionColumn: 'version',
  actions: [
    {
      name: 'close',
      routine: CLOSE_ORDER.ref,
      scope: 'record',
      parameters: [
        { parameter: 'p_order', from: { key: 'id' } },
        { parameter: 'p_note', from: { input: 'note' } },
        { parameter: 'p_due', from: { input: 'due' } },
        { parameter: 'p_amount', from: { field: 'amount' } },
        { parameter: 'p_actor', from: { actor: 'id' } },
        { parameter: 'p_tenant', from: { attribute: 'tenant' } },
      ],
    },
    { name: 'ship', routine: SHIP_ORDER.ref, scope: 'record', parameters: [{ parameter: 'p_order', from: { key: 'id' } }] },
  ],
}

const roles: Record<string, string[]> = { clerk: ['clerk'], auditor: ['auditor'], admin: ['data-admin'] }
const verifyIdentity: IdentityVerifier = async (token) => {
  const held = roles[token]
  return held === undefined ? { ok: false, reason: 'bad' } : { ok: true, identity: { actor: { id: token, roles: held }, attributes: { tenant: '1' } } }
}

const KEY = 'an-audit-key-the-operator-keeps-secret'
const WRITE_ID = '0123456789abcdef0123456789abcdef'
const DEADLINE_MS = 4321
const DEFINITION = 'the definition the fake catalog described'
const ORDER = (() => {
  const token = recordToken(['id'], { id: '7' })
  if (!token.ok) throw new Error(token.message)
  return token.token
})()
/** A note no log line, no trail and no stored answer of a refusal may carry: what a person typed. */
const TYPED = 'the-words-a-person-typed-9f3c'
const ANSWERS = { note: TYPED, due: '2026-12-01' }
const RUN = { records: [{ record: ORDER, version: '3' }], answers: ANSWERS }

let described: number
let runs: ActionRequest[]
/** What the fake run answers; undefined is done, the record by its key. */
let outcome: ((request: ActionRequest) => Promise<ActionOutcome>) | undefined
/** The root as the fake catalog describes it now; undefined is as published. */
let root: ((table: DescribedTable) => DescribedTable) | undefined
let pool: number
let events: RuntimeAuditEvent[]
/** Every scope the fake catalog was discovered with. */
let scopes: DiscoveryScope[]
let lines: Array<Record<string, unknown>>
let directory: string
let store: ConfigurationStore
let app: FastifyInstance

function registry(): ConnectionRegistry {
  const unsent = async (): Promise<never> => {
    throw new Error('an action asks nothing of the records port but the form’s description')
  }
  /** The root as the catalog describes it now: what GET decides over, and what a run is described with. */
  const now = (table: ObjectRef): DescribedTable =>
    (root ?? ((same) => same))({ ...(describedOf(SNAPSHOT, table) as Omit<DescribedTable, 'definition'>), definition: DEFINITION })
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
    describe: async (table, called): Promise<DescribedAction> => {
      described += 1
      const found = SNAPSHOT.routines?.find((candidate) => candidate.ref.name === called.name) as RoutineMeta
      const { executable: _executable, ...routineFacts } = found
      return { ok: true, table: now(table), routine: { ...routineFacts, definition: DEFINITION } }
    },
    run: async (request, deadlineMs) => {
      runs.push({ ...request, deadline: deadlineMs } as ActionRequest)
      return outcome === undefined ? { ok: true, records: [{ id: '7' }] } : outcome(request)
    },
  }
  const discover = async (scope: DiscoveryScope) => {
    scopes.push(scope)
    return SNAPSHOT
  }
  const adapter = { kind: 'postgres', ping: async () => ({}), discover, close: async () => {} } as unknown as DatabaseAdapter
  const open = { adapter, lookups: {} as LookupAdapter, records: records as unknown as RecordAdapter, actions, actionPool: pool }
  return { ids: () => ['erp'], scope: () => ({ schemas: ['sales'] }), open: async (id) => (id === 'erp' ? open : undefined), close: async () => {} }
}

function bundle(): BundleV2 {
  const { form, bindings } = generateForm(SNAPSHOT, REQUEST)
  const names = (bindings.actions ?? []).map((action) => action.name)
  if (names.join() !== 'close,ship') throw new Error(`the generator bound ${names.join() || 'nothing'}`)
  const read = { read: ['clerk', 'auditor'], write: [] }
  const policy: FormPolicy = {
    version: 1,
    operations: { read: ['clerk', 'auditor'], create: [], update: [] },
    fields: Object.fromEntries(bindings.fields.map((binding) => [binding.field, read])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: {},
    actions: { close: { roles: ['clerk'] }, ship: { roles: ['clerk'] } },
  }
  return { format: 2, connection: 'erp', generation: REQUEST, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot: SNAPSHOT }
}

async function start(): Promise<FastifyInstance> {
  const sink: AuditSink = (event) => {
    if (event.plane === 'runtime') events.push(event)
  }
  return createDataServer({
    verifyIdentity,
    logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) } },
    runtime: { registry: registry(), store, actionDeadlineMs: DEADLINE_MS, audit: { sink, key: KEY, now: () => '2026-11-17T12:00:00.000Z' } },
  })
}

beforeEach(async () => {
  described = 0
  runs = []
  outcome = undefined
  root = undefined
  pool = 10
  events = []
  scopes = []
  lines = []
  directory = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-actions-'))
  store = createFileConfigurationStore(directory)
  await store.publish('order', null, bundle())
  app = await start()
})

afterEach(async () => {
  await app.close()
  await rm(directory, { recursive: true, force: true })
})

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const run = (payload: unknown, token = 'clerk', headers: Record<string, string> = {}, action = 'close') =>
  app.inject({
    method: 'POST',
    url: `/v1/forms/order/actions/${action}/run`,
    headers: { ...as(token), ...headers },
    payload: payload as Record<string, unknown>,
  })
const offered = async (token = 'clerk'): Promise<string[]> => {
  const response = await app.inject({ method: 'GET', url: '/v1/forms/order', headers: as(token) })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ actions: Array<{ name: string }> }>().actions.map((action) => action.name)
}
/** The adapter as the route left it: how many descriptions and runs it was asked for. */
const asked = () => ({ described, runs: runs.length })

describe('a run of an action over the open record', () => {
  // The one run reaches the port planned over the description, under the
  // server's deadline, and is answered with the record's token as the
  // statement read its key. Watched failing with the route's deadline left
  // at the default: the run carried 15000.
  test('is described once, run once under the server’s deadline, and answered with the record’s token', async () => {
    const response = await run(RUN)
    expect([response.statusCode, response.json()]).toEqual([200, { records: [ORDER] }])
    expect(asked()).toEqual({ described: 1, runs: 1 })
    expect(runs[0]).toMatchObject({ action: 'close', records: [{ expectedVersion: '3' }], deadline: DEADLINE_MS })
  })

  // Who may run it is the policy's, asked before the connection is opened
  // and before any statement (0159): an auditor reads the order and may
  // not run close, and an action the form does not bind is nobody's. The
  // auditor is offered neither action. Watched failing with the policy
  // asked after the description: the auditor's refused run had described
  // the root and the routine.
  test('is refused 403 before any statement to a person the policy does not let run it', async () => {
    const denied = await run(RUN, 'auditor')
    expect([denied.statusCode, denied.json().code]).toEqual([403, 'operation-denied'])
    const unbound = await run(RUN, 'clerk', {}, 'reopen')
    expect([unbound.statusCode, unbound.json()]).toEqual([403, { code: 'operation-unavailable', message: 'This form offers no such action.' }])
    expect(asked()).toEqual({ described: 0, runs: 0 })
    expect(await offered('auditor')).toEqual([])
    expect(await offered('clerk')).toEqual(['close', 'ship'])
  })

  // An action drift stops is not offered, and a run of it is refused with
  // the planner's sentence and never sent (0041): here the amount close
  // passes to an integer parameter is a bigint now, which the parameter
  // cannot hold, while ship, which passes the key alone, still runs and
  // the form still reads. Watched failing with GET offering every runnable
  // action whatever the verdict: close was offered.
  test('stopped by drift, is absent from the form and refused at its run', async () => {
    root = (table) => ({ ...table, columns: table.columns.map((column) => (column.name === 'amount' ? { ...column, type: INT64 } : column)) })
    expect(await offered()).toEqual(['ship'])
    const refused = await run(RUN)
    expect([refused.statusCode, refused.json().code]).toEqual([409, 'drift'])
    expect(asked()).toEqual({ described: 1, runs: 0 })
    const shipped = await run({ records: RUN.records, answers: {} }, 'clerk', {}, 'ship')
    expect(shipped.statusCode, shipped.body).toBe(200)
  })

  // Every answer goes through its parameter's codec, and every error is
  // the person's to fix at once, by the dialog's field: a note that is not
  // text and a due date that is not one, nothing sent. Watched failing
  // with the plan's field errors answered as a refusal without them: the
  // 422 carried none.
  test('is refused 422 with each answer’s error by its dialog field', async () => {
    const response = await run({ records: RUN.records, answers: { note: 7, due: 'next week' } })
    expect(response.statusCode, response.body).toBe(422)
    expect(response.json()).toMatchObject({ code: 'invalid-values', fieldErrors: [{ field: 'note' }, { field: 'due' }] })
    expect(asked()).toEqual({ described: 1, runs: 0 })
  })

  // One write id, one run. The same run sent again with it is answered
  // with the first answer and asks the database nothing; another body with
  // it is 400, since answering it with the first answer would say it ran
  // something never sent; and the trail says which was which. Watched
  // failing with the route running without `sendOnce`: the port ran twice.
  test('is answered once per write id, and the same id with another body is 400', async () => {
    const id = { 'formancy-write-id': WRITE_ID }
    const first = await run(RUN, 'clerk', id)
    const again = await run(RUN, 'clerk', id)
    expect([first.statusCode, again.statusCode]).toEqual([200, 200])
    expect(again.json()).toEqual(first.json())
    expect(asked()).toEqual({ described: 1, runs: 1 })
    const other = await run({ ...RUN, answers: { ...ANSWERS, note: 'other' } }, 'clerk', id)
    expect([other.statusCode, other.json().code]).toEqual([400, 'invalid-request'])
    expect(asked()).toEqual({ described: 1, runs: 1 })
    expect(events.map(({ outcome: said }) => said)).toEqual(['ok', 'repeated', 'invalid-request'])
  })

  // A run holds a connection of the actions' pool from its description to
  // its answer. With every connection running one, the next is 503 before
  // anything is sent -- no deadline spent in the pool's queue -- and once
  // one answers, the next runs. Watched failing with the count taken out:
  // the second run was described and sent while the first held the pool,
  // "expected [ 200, undefined ] to deeply equal [ 503, 'unavailable' ]".
  test('is 503 with nothing sent while every connection of the actions’ pool runs one', async () => {
    await app.close()
    pool = 1
    app = await start()
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    // The first run holds its connection until released; any other answers at once.
    outcome = async () => {
      if (runs.length === 1) await held
      return { ok: true, records: [{ id: '7' }] }
    }
    const first = run(RUN)
    try {
      await expect.poll(() => runs.length).toBe(1)
      const second = await run(RUN)
      expect([second.statusCode, second.json().code]).toEqual([503, 'unavailable'])
      expect(asked()).toEqual({ described: 1, runs: 1 })
    } finally {
      release()
    }
    expect((await first).statusCode).toBe(200)
    const third = await run(RUN)
    expect(third.statusCode, third.body).toBe(200)
    expect(asked()).toEqual({ described: 2, runs: 2 })
  })

  // A lost answer is unknown, never sent again, and names what was
  // addressed: the action and each record with the version sent, which a
  // run moves, so running it again from them is refused as changed if it
  // ran. Watched failing with the adapter's unknown outcome answered as
  // any failure: the 502 was a 500.
  test('whose answer was lost is 502, naming the action and the records with their versions', async () => {
    outcome = async () => ({ ok: false, code: 'unknown-outcome', message: 'the connection was lost after the run was sent' })
    const response = await run(RUN)
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({
      code: 'unknown-outcome',
      message: expect.stringContaining('It may have run.'),
      operation: 'action',
      action: 'close',
      records: [{ record: ORDER, version: '3' }],
    })
    expect(asked()).toEqual({ described: 1, runs: 1 })
  })

  // Each code a run fails with is answered as 0160's table says, in the
  // server's words and never the database's, but for the deployment's own
  // refusal (0156). Watched failing with action-timeout answered as
  // unavailable: "expected [ 503, 'unavailable' ] to deeply equal [ 503,
  // 'action-timeout' ]", the person not told the database stopped it.
  test('that did not commit is answered by its code, in the server’s words', async () => {
    const answers: Array<[ActionOutcome, number, string, string | undefined]> = [
      [{ ok: false, code: 'not-found', message: 'm' }, 404, 'not-found', undefined],
      [{ ok: false, code: 'stale', message: 'm' }, 409, 'stale', undefined],
      [{ ok: false, code: 'version-ended', message: 'm' }, 409, 'version-ended', undefined],
      [{ ok: false, code: 'schema-changed', message: 'm' }, 409, 'schema-changed', undefined],
      [{ ok: false, code: 'permission-denied', message: 'm' }, 403, 'permission-denied', undefined],
      [{ ok: false, code: 'declined', message: 'm', reason: 'This order cannot be closed now.' }, 422, 'declined', 'This order cannot be closed now.'],
      [{ ok: false, code: 'declined', message: 'm' }, 422, 'refused', undefined],
      [{ ok: false, code: 'refused', message: 'the database said this' }, 422, 'refused', undefined],
      [{ ok: false, code: 'unavailable', message: 'm' }, 503, 'unavailable', undefined],
      [{ ok: false, code: 'action-timeout', message: 'm' }, 503, 'action-timeout', undefined],
    ]
    for (const [failed, status, code, message] of answers) {
      outcome = async () => failed
      const response = await run(RUN)
      expect([response.statusCode, response.json().code], failed.ok ? 'done' : failed.code).toEqual([status, code])
      const said = response.json().message as string
      if (message !== undefined) expect(said).toBe(message)
      else expect(said).toMatch(/Nothing was done\.|nothing was done\./)
      expect(said).not.toContain('the database said this')
    }
  })
})

describe('what a run leaves behind', () => {
  // The trail names the operation `action`, the action by its name -- the
  // form's configuration -- and the record by its keyed hash, and holds no
  // answer, input or field value, nor a declined run's reason: its outcome
  // is the code alone. An action the form does not bind leaves no name the
  // URL alone said. Watched failing with the trail naming the action from
  // the URL: the unbound run's event carried "reopen".
  test('is one audit event naming the action and the record’s hash, and no value', async () => {
    await run(RUN)
    outcome = async () => ({ ok: false, code: 'declined', message: 'm', reason: `Refused: ${TYPED}` })
    await run(RUN)
    await run(RUN, 'clerk', {}, 'reopen')
    const base = {
      at: '2026-11-17T12:00:00.000Z',
      plane: 'runtime',
      actor: 'clerk',
      operation: 'action',
      form: 'order',
      formVersion: 1,
      record: recordReference(KEY, ORDER),
      rows: null,
      moved: null,
    }
    expect(events).toEqual([
      { ...base, status: 200, outcome: 'ok', action: 'close' },
      { ...base, status: 422, outcome: 'declined', action: 'close' },
      { ...base, status: 403, outcome: 'operation-unavailable' },
    ])
    expect(JSON.stringify(events)).not.toContain(TYPED)
  })

  // Nothing a person typed reaches the server's log, whatever became of
  // the run: done, declined in the deployment's words that repeat it,
  // refused by the codecs, stopped by drift, or lost. Watched failing with
  // the declined reason logged beside its code: the line carried the note.
  test('leaves no input, answer or declined reason in the log', async () => {
    await run(RUN)
    outcome = async () => ({ ok: false, code: 'declined', message: 'm', reason: `Refused: ${TYPED}` })
    await run(RUN)
    outcome = async () => ({ ok: false, code: 'unknown-outcome', message: 'the connection was lost after the run was sent' })
    await run(RUN)
    await run({ records: RUN.records, answers: { note: TYPED, due: TYPED } })
    root = (table) => ({ ...table, columns: table.columns.map((column) => (column.name === 'amount' ? { ...column, type: INT64 } : column)) })
    await run(RUN)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.filter((line) => JSON.stringify(line).includes(TYPED))).toEqual([])
    expect(lines.some((line) => line['msg'] === 'an action was sent and its answer lost; it is not run again')).toBe(true)
  })
})

describe('a form published with actions', () => {
  // An action is named in the request, and a bundle whose bindings bind
  // one its request does not name, as it names it, is a hand edit and is
  // never served; nor is a format-1 bundle, which keeps no request to name
  // one in. Watched failing with the request's actions left uncompared:
  // the edited bundle was served, its actions offered.
  test('is served only where its request names each action as its bindings bind it, in format 2', async () => {
    const good = bundle()
    const { actions: _named, ...unnamed } = good.generation
    const retargeted = {
      ...good.generation,
      actions: [{ ...(REQUEST.actions?.[0] as NonNullable<GenerationRequest['actions']>[number]), routine: SHIP_ORDER.ref }],
    }
    const { format: _two, generation: _generation, base: _base, presentation: _presentation, ...parts } = good
    for (const [id, edited] of [
      ['unnamed', { ...good, generation: unnamed }],
      ['retargeted', { ...good, generation: retargeted }],
      ['format-one', { ...parts, format: 1 }],
    ] as const) {
      await store.publish(id, null, edited)
      const response = await app.inject({ method: 'GET', url: `/v1/forms/${id}`, headers: as('clerk') })
      expect([response.statusCode, response.json().code], id).toEqual([500, 'corrupt-bundle'])
    }
    expect(lines.filter((line) => line['msg'] === 'a published bundle failed validation').map((line) => line['problems'])).toEqual([
      [
        'generation: the bindings bind action close, which it does not name as they bind it',
        'generation: the bindings bind action ship, which it does not name as they bind it',
      ],
      [
        'generation: the bindings bind action close, which it does not name as they bind it',
        'generation: the bindings bind action ship, which it does not name as they bind it',
      ],
      ['format 1 keeps no generation request, which is where an action is named (0161): publish format 2'],
    ])
  })

  // A proposal whose request names an action is discovered with the
  // routines in scope, which a snapshot records only when asked (0158),
  // and every other as it always was; a request whose actions are of no
  // shape this release reads is refused before anything is discovered.
  // Watched failing with the proposal discovered as every other: its scope
  // asked for no routine, so a real catalog's snapshot would record none
  // and the generator bind no action; and with a scope other than
  // `record` read as one: the generator's 422 in place of the reading's 400.
  test('is proposed from a discovery that asks for the routines, and only then', async () => {
    const admin = await createDataServer({ verifyIdentity, admin: { registry: registry(), store, adminRoles: ['data-admin'], audit: { sink: () => {} } } })
    try {
      const propose = (body: unknown) =>
        admin.inject({ method: 'POST', url: '/v1/form-proposals', headers: as('admin'), payload: body as Record<string, unknown> })
      const proposed = await propose(REQUEST)
      expect(proposed.statusCode, proposed.body).toBe(200)
      expect(proposed.json<{ bindings: { actions?: Array<{ name: string }> } }>().bindings.actions?.map((action) => action.name)).toEqual(['close', 'ship'])
      const { actions: _actions, ...plain } = REQUEST
      expect((await propose(plain)).statusCode).toBe(200)
      expect(scopes).toEqual([{ schemas: ['sales'], routines: true }, { schemas: ['sales'] }])
      for (const actions of [
        [{ ...REQUEST.actions?.[1], scope: 'selection' }],
        [{ ...REQUEST.actions?.[1], parameters: [{ parameter: 'p_order', from: { column: 'id' } }] }],
        'close',
      ]) {
        expect((await propose({ ...REQUEST, actions })).statusCode, JSON.stringify(actions)).toBe(400)
      }
      expect(scopes).toHaveLength(2)
    } finally {
      await admin.close()
    }
  })

  // A form discovered with routines is discovered with them again
  // wherever a version of it is compared with the database: drift review,
  // a regeneration, a restore and an import's gate -- the last of which is
  // also a draft's under review. Without them every action would be found
  // unknown and blocking, a regeneration would bind none, and no version
  // with an action could pass the gate. Watched failing with each of the
  // four discovering as every other, in turn: its scope asked for no
  // routine.
  test('is discovered with its routines by review, a regeneration, a restore and an import', async () => {
    const admin = await createDataServer({ verifyIdentity, admin: { registry: registry(), store, adminRoles: ['data-admin'], audit: { sink: () => {} } } })
    try {
      const post = (url: string, body: unknown = {}) => admin.inject({ method: 'POST', url, headers: as('admin'), payload: body as Record<string, unknown> })
      expect((await post('/v1/forms/order/drift')).statusCode).toBe(200)
      expect((await post('/v1/forms/order/regenerations')).statusCode).toBe(200)
      expect((await post('/v1/forms/order/restorations', { version: 1, expectedBase: 1 })).statusCode).toBe(201)
      const imported = await post('/v1/forms/order/imports', { expectedBase: 2, bundle: bundle() })
      expect(imported.statusCode, imported.body).toBe(201)
      expect(scopes).toEqual(Array.from({ length: 4 }, () => ({ schemas: ['sales'], routines: true })))
    } finally {
      await admin.close()
    }
  })
})

describe('FORMANCY_DATA_ACTION_DEADLINE_MS', () => {
  // Unset is 15 s; a whole number of milliseconds is taken; anything else
  // stops the server with a sentence naming the setting and quoting what
  // was written, never a secret -- and an embedder's option is held to
  // the same rule, so no server is built whose every run is refused or
  // whose statement timeout is a fraction. Watched failing with the
  // option unchecked: the server was built with a deadline of 0.
  test('is 15 s unset, a whole number of milliseconds otherwise, and refused at start', async () => {
    expect(actionDeadlineSetting(undefined)).toEqual({ ok: true, ms: DEFAULT_ACTION_DEADLINE_MS })
    expect(DEFAULT_ACTION_DEADLINE_MS).toBe(15_000)
    expect(actionDeadlineSetting('2500')).toEqual({ ok: true, ms: 2500 })
    for (const written of ['0', '-1', '1.5', '1e3', ' 5', 'abc', '', '2147483648']) {
      expect(actionDeadlineSetting(written), written).toEqual({
        ok: false,
        problem: `FORMANCY_DATA_ACTION_DEADLINE_MS is a whole number of milliseconds from 1 to 2147483647; it is ${JSON.stringify(written)}.`,
      })
    }
    for (const actionDeadlineMs of [0, 1.5, Number.NaN, 2_147_483_648]) {
      await expect(createDataServer({ verifyIdentity, runtime: { registry: registry(), store, actionDeadlineMs } })).rejects.toThrow(
        'runtime.actionDeadlineMs is a whole number of milliseconds',
      )
    }
  })
})
