import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, DUPLICATE_RECORD, generateForm, WRITE_REFUSED } from '@formancy/data-core'
import type {
  ActionAdapter,
  ColumnMeta,
  DatabaseAdapter,
  Described,
  DescribedTable,
  FormPolicy,
  LookupAdapter,
  NormalizedType,
  ObjectMeta,
  ObjectRef,
  RecordAdapter,
  RecordOutcome,
  UpdateRequest,
} from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AuditSink, RuntimeAuditEvent } from '../audit.js'
import { recordReference } from '../audit.js'
import type { PublishedBundle } from '../bundle.js'
import { validateBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'

/*
 * `POST /v1/forms/:id/records/update-chosen` and what `GET /v1/forms/:id`
 * says of it (0175), over fake ports. What the database does with each
 * update is the adapter suites' business and e2e-bulk's, against real
 * servers (0003); what is under test here is what the route decides around
 * the single update it runs for each record: who may send one, what is
 * decided once for the request -- the answers, each selection's membership
 * -- what reaches the port and in which order, what each record's outcome
 * is, when it stops sending, what a write id does, and what the trail
 * says. runtime-bulk.test.ts holds the same of a delete of chosen records.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const text = (maxLength: number): NormalizedType => ({ kind: 'text', maxLength, lengthUnit: 'utf16-code-units', fixedLength: false })
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
  ...extra,
})

/** A ticket: a key the database numbers, a tenant, a title, a status, a note, the person it is assigned to, and a rowversion. */
const TICKET = table(
  'ticket',
  [
    col('id', 1, INT32, { generated: 'identity-always' }),
    col('tenant_id', 2, INT32),
    col('title', 3, text(100), { nullable: true }),
    col('status', 4, text(20)),
    col('note', 5, text(200), { nullable: true }),
    col('assignee_id', 6, INT32, { nullable: true }),
    col('row_version', 7, ROWVERSION, { generated: 'rowversion' }),
  ],
  {
    foreignKeys: [
      {
        name: 'fk_ticket_assignee',
        columns: ['assignee_id'],
        references: { table: ref('assignee'), columns: ['id'] },
        onDelete: 'no-action',
        onUpdate: 'no-action',
        enforced: true,
        validated: true,
      },
    ],
  },
)
const ASSIGNEE = table('assignee', [col('id', 1, INT32), col('tenant_id', 2, INT32), col('name', 3, text(100))])
const SNAPSHOT = createSnapshot({
  kind: 'sqlserver',
  serverVersion: '16.0',
  account: { user: 'dbo', login: 'sa' },
  scope: { schemas: ['sales'] },
  gaps: [],
  objects: [TICKET, ASSIGNEE],
})

const READS = { read: ['clerk', 'sweeper', 'auditor'], write: [] }
const WRITES = { read: ['clerk', 'sweeper', 'auditor'], write: ['clerk', 'sweeper'] }
const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
/** Clerks and a sweeper update tickets of their tenant one at a time, open to closed and back; an auditor reads them. No grant over chosen records. */
const ONE_AT_A_TIME: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'sweeper', 'auditor'], create: [], update: ['clerk', 'sweeper'] },
  fields: { id: READS, tenant_id: READS, title: WRITES, status: WRITES, note: WRITES, assignee: WRITES },
  rowFilters: TENANT,
  lookups: { assignee: TENANT },
  transitions: {
    field: 'status',
    moves: [
      { from: 'open', to: 'closed', roles: ['clerk', 'sweeper'] },
      { from: 'closed', to: 'archived', roles: ['clerk', 'sweeper'] },
    ],
  },
}
/** The same, and clerks alone change the chosen ones of a page together, in their status, note and assignee -- never their title. */
const POLICY: FormPolicy = { ...ONE_AT_A_TIME, bulk: { update: { roles: ['clerk'], fields: ['note', 'status', 'assignee'] } } }

const identities: Record<string, { roles: string[]; attributes: Record<string, string> }> = {
  clerk: { roles: ['clerk'], attributes: { tenant: '1' } },
  sweeper: { roles: ['sweeper'], attributes: { tenant: '1' } },
  auditor: { roles: ['auditor'], attributes: { tenant: '1' } },
  'clerk-untenanted': { roles: ['clerk'], attributes: {} },
}
const verifyIdentity: IdentityVerifier = async (token) => {
  const found = identities[token]
  return found === undefined ? { ok: false, reason: 'bad' } : { ok: true, identity: { actor: { id: token, roles: found.roles }, attributes: found.attributes } }
}

const VERSION = '00000000000007d1'
const NEXT = '00000000000007d2'
const DEFINITION = 'the definition the fake catalog described'
const KEY = 'an-audit-key-the-operator-keeps-secret'
const WRITE_ID = '0123456789abcdef0123456789abcdef'

const described: DescribedTable = { ...(describedOf(SNAPSHOT, ref('ticket')) as Omit<DescribedTable, 'definition'>), definition: DEFINITION }
/** The ticket's key gone: a record can no longer be addressed by it. */
const KEY_GONE: DescribedTable = { ...described, primaryKey: null }

interface Row {
  status: string
  note: string | null
  assignee: string | null
  version: string
}

let updates: UpdateRequest[]
/** Each call of the fake ports, in the order made: a description, a read or an update by its key's value, or a membership check by its field. */
let calls: string[]
/** The rows the fake database holds, by key; a key not named is an open ticket at VERSION, and one in `gone` is no row. */
let rows: Map<string, Row>
let gone: Set<string>
/** What the fake update answers for a record instead of writing it, by its key's value. */
let outcomes: Map<string, RecordOutcome>
/** The tokens the fake lookup rejects. */
let rejected: Set<string>
let lag: number
let throwsAt: string | null
/** What the fake catalog says to each description, a read's included, in turn; once used up, the published snapshot's. */
let catalog: Described[]
let events: RuntimeAuditEvent[]
let lines: Array<Record<string, unknown>>
let root: string
let store: ConfigurationStore
let app: FastifyInstance

const held = (id: string): Row => rows.get(id) ?? { status: 'open', note: null, assignee: null, version: VERSION }
const valuesOf = (id: string, row: Row) => ({ id, tenant_id: '1', title: null, status: row.status, note: row.note, assignee_id: row.assignee })

function registry(): ConnectionRegistry {
  const refused = (what: string) => async () => {
    throw new Error(`a change of chosen records never ${what}`)
  }
  const records: RecordAdapter = {
    describe: async () => {
      calls.push('describe')
      return catalog.shift() ?? { ok: true, described }
    },
    read: async (request) => {
      const id = String(request.key[0]?.value ?? '')
      calls.push(`read ${id}`)
      const table = catalog.shift() ?? { ok: true, described }
      if (!table.ok) return table
      const row = held(id)
      return { ok: true, described: table.described, record: gone.has(id) ? null : { values: valuesOf(id, row), version: row.version } }
    },
    list: refused('lists'),
    insert: refused('inserts'),
    update: async (request) => {
      const id = String(request.key[0]?.value ?? '')
      updates.push(request)
      calls.push(`update ${id}`)
      if (lag > 0) await new Promise((resolve) => setTimeout(resolve, lag))
      if (id === throwsAt) throw new Error(`the fake adapter threw at ${id}, in words no answer may carry`)
      const said = outcomes.get(id)
      if (said !== undefined) return said
      if (gone.has(id)) return { ok: false, code: 'not-found', message: 'm' }
      const row = held(id)
      if (row.version !== request.expectedVersion) return { ok: false, code: 'stale', message: 'm' }
      const set = new Map(request.set.map((value) => [value.name, value.value]))
      const next: Row = {
        status: set.has('status') ? String(set.get('status')) : row.status,
        note: set.has('note') ? (set.get('note') as string | null) : row.note,
        assignee: set.has('assignee_id') ? (set.get('assignee_id') as string | null) : row.assignee,
        version: NEXT,
      }
      rows.set(id, next)
      return { ok: true, values: valuesOf(id, next), version: NEXT }
    },
    supersede: refused('changes from a date'),
    save: refused('saves a record with its rows'),
    delete: refused('deletes'),
  }
  const lookups: LookupAdapter = {
    search: async () => ({ rows: [], hasMore: false, omitted: 0 }),
    resolve: async () => [],
    rejects: async (_config, tokens) => {
      calls.push(`rejects ${tokens.join(' ')}`)
      return tokens.filter((token) => rejected.has(token))
    },
  }
  const adapter = {
    kind: 'sqlserver',
    ping: async () => ({ kind: 'sqlserver', version: '16.0', product: 'sqlserver', major: 16, compatibility: 160 }),
    discover: async () => SNAPSHOT,
    close: async () => {},
  } as DatabaseAdapter
  return {
    ids: () => ['erp'],
    scope: () => ({ schemas: ['sales'] }),
    open: async (id) => (id === 'erp' ? { adapter, lookups, records, actions: {} as ActionAdapter, actionPool: 0 } : undefined),
    close: async () => {},
  }
}

function bundleOf(policy: FormPolicy): PublishedBundle {
  const generated = generateForm(SNAPSHOT, {
    connection: 'erp',
    root: ref('ticket'),
    formId: 'ticket',
    title: 'Ticket',
    lookups: [{ foreignKey: 'fk_ticket_assignee', display: ['name'] }],
  })
  return { format: 1, connection: 'erp', form: generated.form, bindings: generated.bindings, policy, snapshot: SNAPSHOT }
}

async function server(bulkDeadlineMs?: number): Promise<FastifyInstance> {
  const sink: AuditSink = (event) => {
    if (event.plane === 'runtime') events.push(event)
  }
  return createDataServer({
    verifyIdentity,
    logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) } },
    runtime: {
      registry: registry(),
      store,
      audit: { sink, key: KEY, now: () => '2026-11-22T12:00:00.000Z' },
      ...(bulkDeadlineMs === undefined ? {} : { bulkDeadlineMs }),
    },
  })
}

beforeEach(async () => {
  updates = []
  calls = []
  rows = new Map()
  gone = new Set()
  outcomes = new Map()
  rejected = new Set()
  lag = 0
  throwsAt = null
  catalog = []
  events = []
  lines = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-bulk-update-'))
  store = createFileConfigurationStore(root)
  await store.publish('ticket', null, bundleOf(POLICY))
  await store.publish('one-at-a-time', null, bundleOf(ONE_AT_A_TIME))
  app = await server()
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const chosen = (ids: readonly number[], version = VERSION) => ids.map((id) => ({ record: `k1:${String(id)}`, version }))
const changeChosen = (form: string, payload: unknown, token = 'clerk', headers: Record<string, string> = {}, on: FastifyInstance = app) =>
  on.inject({
    method: 'POST',
    url: `/v1/forms/${form}/records/update-chosen`,
    headers: { ...as(token), ...headers },
    payload: payload as Record<string, unknown>,
  })
const changeOne = (record: string, answers: Record<string, unknown>, version = VERSION) =>
  app.inject({ method: 'POST', url: '/v1/forms/ticket/records/update', headers: as('clerk'), payload: { record, version, answers } })
const opened = (form: string, token = 'clerk') => app.inject({ method: 'GET', url: `/v1/forms/${form}`, headers: as(token) })
const statuses = (body: { records: Array<{ sent: boolean; status?: number }> }) => body.records.map((outcome) => (outcome.sent ? outcome.status : 'not sent'))

describe('changing chosen records', () => {
  // The answers are the same for every record, so each selection is
  // checked once, before any record is read -- never once per record --
  // and then each record is a single update: read, then updated over that
  // read's description, one after another in the order sent, never sorted.
  // Watched failing with nothing vouched for the records' updates: the
  // lookup was asked again between every read and its update.
  test('checks each selection once, then reads and updates each record in the order sent', async () => {
    const response = await changeChosen('ticket', { records: chosen([9, 3, 7]), answers: { note: 'swept', assignee: 'k1:5' } })
    expect(response.statusCode, response.body).toBe(200)
    expect(calls).toEqual(['rejects k1:5', 'read 9', 'update 9', 'read 3', 'update 3', 'read 7', 'update 7'])
    expect(updates[0]).toMatchObject({
      key: [{ name: 'id', type: INT32, value: '9' }],
      set: [
        { name: 'note', value: 'swept' },
        { name: 'assignee_id', value: '5' },
      ],
      expectedVersion: VERSION,
      filters: { kind: 'restricted', equal: [{ column: 'tenant_id', type: INT32, value: '1' }] },
      definition: DEFINITION,
    })
    expect(response.json()).toEqual({
      records: [9, 3, 7].map((id) => ({
        sent: true,
        status: 200,
        body: {
          record: `k1:${String(id)}`,
          version: NEXT,
          answers: { id, tenant_id: 1, title: null, status: 'open', note: 'swept', assignee: 'k1:5' },
        },
      })),
    })
  })

  // A record's outcome is what `POST …/records/update` answers for it
  // alone, status and body, whatever the port said -- so a page reads it
  // as it reads a single save's. Each case is asked of both routes, the
  // fake database put back between them, and compared. Watched failing
  // with the bulk route wording a refused move itself.
  test('answers each record exactly as the single update answers it', async () => {
    const start = () => {
      rows = new Map([
        ['2', { status: 'open', note: null, assignee: null, version: NEXT }],
        ['5', { status: 'archived', note: null, assignee: null, version: VERSION }],
      ])
      gone = new Set(['3'])
      outcomes = new Map<string, RecordOutcome>([
        ['4', { ok: false, code: 'declined', reason: 'Closed tickets keep their note.', message: 'm' }],
        ['6', { ok: false, code: 'refused', message: 'm' }],
        ['7', { ok: false, code: 'check-violation', constraint: 'ck_ticket_note', message: 'm' }],
        ['8', { ok: false, code: 'permission-denied', message: 'm' }],
      ])
    }
    const answers = { status: 'closed', note: 'swept' }
    start()
    const together = await changeChosen('ticket', { records: chosen([1, 2, 3, 4, 5, 6, 7, 8]), answers })
    const alone = []
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
      start()
      const one = await changeOne(`k1:${String(id)}`, answers)
      alone.push({ sent: true, status: one.statusCode, body: one.json<unknown>() })
    }
    expect(together.json()).toEqual({ records: alone })
    // A record deleted since its page read it is not read, so a move of its
    // state field cannot be checked: refused `transition-denied` before its
    // update is sent, as its update alone is (0127).
    expect(statuses(together.json())).toEqual([200, 409, 403, 422, 403, 422, 422, 403])
  })

  // What is the same for every record is refused once, for the request,
  // before any record is read or any statement sent but the checks it
  // needs: a value no codec takes, every field's error at once; a field
  // the grant does not list, though the clerk sets it one record at a
  // time; and a selection the lookup does not offer, checked once.
  // Watched failing with the answers left to each record's plan: the
  // first record was read before the request was refused, and the 422
  // came inside a 200, once per record.
  test('refuses answers no codec takes, a field outside the grant, and a selection not among the options, before any record is read', async () => {
    const invalid = await changeChosen('ticket', { records: chosen([1, 2]), answers: { status: 'x'.repeat(21), note: 5 } })
    expect([invalid.statusCode, invalid.json()]).toEqual([
      422,
      {
        code: 'invalid-values',
        message: 'status, note cannot be written',
        fieldErrors: [expect.objectContaining({ field: 'status' }), expect.objectContaining({ field: 'note' })],
      },
    ])
    const outside = await changeChosen('ticket', { records: chosen([1, 2]), answers: { title: 'x', note: 'y' } })
    expect([outside.statusCode, outside.json()]).toEqual([
      403,
      { code: 'over-posting', message: 'title is not changed in chosen records together with this form' },
    ])
    expect((await changeChosen('ticket', { records: chosen([1]), answers: {} })).json()).toMatchObject({ code: 'nothing-to-update' })
    expect(calls).toEqual([])
    rejected = new Set(['k1:5'])
    const unoffered = await changeChosen('ticket', { records: chosen([1, 2, 3]), answers: { assignee: 'k1:5' } })
    expect([unoffered.statusCode, unoffered.json()]).toEqual([
      422,
      {
        code: 'invalid-values',
        message: 'A selection is not one of the options.',
        fieldErrors: [{ field: 'assignee', code: 'not-an-option', message: 'This is not one of the options this form offers.' }],
      },
    ])
    expect(calls).toEqual(['rejects k1:5'])
  })

  // A refusal about one record -- stale, a move its own state does not
  // allow -- is that record's: the records after it are still sent. An
  // answer lost, or a database out of reach, leaves the connection in
  // doubt: that record is answered as a single update would be, and
  // nothing more is sent. Watched failing with the loop going on past an
  // unknown outcome: the fifth record was updated over a connection whose
  // last answer nobody heard.
  test('goes on past a record refused, and stops at the first unknown outcome or unavailable', async () => {
    rows = new Map([
      ['2', { status: 'open', note: null, assignee: null, version: NEXT }],
      ['3', { status: 'archived', note: null, assignee: null, version: VERSION }],
    ])
    outcomes = new Map<string, RecordOutcome>([['4', { ok: false, code: 'unknown-outcome', message: 'lost' }]])
    const lost = await changeChosen('ticket', { records: chosen([1, 2, 3, 4, 5]), answers: { status: 'closed' } })
    expect(statuses(lost.json())).toEqual([200, 409, 403, 502, 'not sent'])
    expect(lost.json<{ records: Array<{ body?: unknown }> }>().records[3]?.body).toEqual({
      code: 'unknown-outcome',
      operation: 'update',
      record: 'k1:4',
      version: VERSION,
      message: expect.any(String),
    })
    expect(updates.map((request) => request.key[0]?.value)).toEqual(['1', '2', '4'])
    updates = []
    outcomes = new Map<string, RecordOutcome>([['6', { ok: false, code: 'unavailable', message: 'm' }]])
    const unreached = await changeChosen('ticket', { records: chosen([6, 7]), answers: { note: 'x' } })
    expect(statuses(unreached.json())).toEqual([503, 'not sent'])
    expect(updates.map((request) => request.key[0]?.value)).toEqual(['6'])
  })

  // The deadline is checked before each record and never during one, and
  // counted from the start of the sending, the request's checks inside it.
  // Watched failing with the deadline unchecked for a change: all three
  // were updated.
  test('checks the deadline before each record, and answers the rest not sent once it has passed', async () => {
    const hurried = await server(30)
    try {
      lag = 60
      const response = await changeChosen('ticket', { records: chosen([1, 2, 3]), answers: { note: 'x' } }, 'clerk', {}, hurried)
      expect(statuses(response.json())).toEqual([200, 'not sent', 'not sent'])
      expect(lines.filter((line) => line['msg'] === 'a request over chosen records passed its deadline; the records after it were not sent')).toEqual([
        expect.objectContaining({ level: 40, form: 'ticket', sent: 1, unsent: 2, deadlineMs: 30 }),
      ])
    } finally {
      await hurried.close()
    }
  })

  // Who may send one is asked before any statement, the lookup's check
  // included: the sweeper, who updates one record at a time; the auditor;
  // a form whose policy grants nobody; a context that cannot scope an
  // update. Watched failing with authorizeBulk asked for a delete: the
  // clerk was refused a change the grant gives them.
  test('is 403 with no statement for a person the change grant does not let through', async () => {
    const body = { records: chosen([1]), answers: { assignee: 'k1:5' } }
    expect((await changeChosen('ticket', body)).statusCode).toBe(200)
    calls = []
    expect((await changeChosen('ticket', body, 'sweeper')).json()).toEqual({
      code: 'operation-denied',
      message: 'no role of this actor may change chosen records together with this form',
    })
    expect((await changeChosen('ticket', body, 'auditor')).statusCode).toBe(403)
    expect((await changeChosen('one-at-a-time', body)).json()).toMatchObject({ code: 'operation-denied' })
    expect((await changeChosen('ticket', body, 'clerk-untenanted')).json()).toMatchObject({ code: 'missing-attribute' })
    expect(calls).toEqual([])
  })

  // What the browser sent is checked first: a body that is not one to a
  // page of records with answers, and a write id that is not one, are 400
  // and nothing is sent; a record named twice would be updated, then
  // refused stale about a record its person chose: 400 `duplicate-record`.
  // Watched failing with the change's body read by the delete's reader:
  // a body without answers was taken, and answered 500.
  test('answers a body without answers, a write id that is not one, and a record named twice 400, sending nothing', async () => {
    expect((await changeChosen('ticket', { records: chosen([1]) })).json()).toEqual({
      code: 'invalid-request',
      message: 'Expected { records: [{ record, version }], answers }.',
    })
    expect((await changeChosen('ticket', { records: chosen([1]), answers: { note: 'x' } }, 'clerk', { 'formancy-write-id': 'short' })).json()).toMatchObject({
      code: 'invalid-request',
    })
    const twice = await changeChosen('ticket', { records: chosen([1, 2, 1]), answers: { note: 'x' } })
    expect([twice.statusCode, twice.json()]).toEqual([400, { code: 'duplicate-record', message: DUPLICATE_RECORD, records: ['k1:1', 'k1:1'] }])
    expect(calls).toEqual([])
  })

  // A form the database no longer fits as published is refused once, at
  // the first record, with the update's sentence, nothing written; drift
  // found by a later record's read is that record's. Watched failing with
  // the first record's drift kept as its outcome: the request answered
  // 200 with three drift refusals.
  test('answers a form drift stops once, 409, at the first record, and drift found later as that record’s', async () => {
    catalog = [{ ok: true, described: KEY_GONE }]
    const first = await changeChosen('ticket', { records: chosen([1, 2, 3]), answers: { note: 'x' } })
    expect([first.statusCode, first.json()]).toEqual([409, { code: 'drift', message: WRITE_REFUSED }])
    expect(calls).toEqual(['read 1'])
    catalog = [
      { ok: true, described },
      { ok: true, described: KEY_GONE },
    ]
    const later = await changeChosen('ticket', { records: chosen([1, 2, 3]), answers: { note: 'x' } })
    expect(statuses(later.json())).toEqual([200, 409, 200])
  })

  // A record whose update throws is that record's 500 in the change's own
  // words, never the error's, and the request stops there; the records
  // before it keep their outcomes. Watched failing with the delete's
  // words: the person was told the record "may have been deleted".
  test('answers a record whose update throws 500 in its own words, and sends nothing after', async () => {
    throwsAt = '2'
    const response = await changeChosen('ticket', { records: chosen([1, 2, 3]), answers: { note: 'x' } })
    expect(response.json<{ records: unknown[] }>().records.slice(1)).toEqual([
      {
        sent: true,
        status: 500,
        body: { code: 'internal', message: "This record's change failed in the server, and it may have been changed; the operator's log says why." },
      },
      { sent: false },
    ])
    expect(lines.filter((line) => line['msg'] === 'a change of a chosen record failed in the server; the records after it were not sent')).toHaveLength(1)
    expect(response.body).not.toContain('no answer may carry')
  })

  // A sending that arrives again with its write id is answered with the
  // first sending's answer and asks the database nothing: no check, no
  // read, no update. Watched failing with the write id not handed to
  // sendOnce: the resend checked, read and updated both records again,
  // and was answered stale.
  test('answers a write id once, asking nothing again', async () => {
    const id = { 'formancy-write-id': WRITE_ID }
    const body = { records: chosen([1, 2]), answers: { assignee: 'k1:5' } }
    const first = await changeChosen('ticket', body, 'clerk', id)
    const asked = [...calls]
    const again = await changeChosen('ticket', body, 'clerk', id)
    expect(again.json()).toEqual(first.json())
    expect(calls).toEqual(asked)
    expect((await changeChosen('ticket', { ...body, answers: { note: 'x' } }, 'clerk', id)).json()).toMatchObject({
      code: 'invalid-request',
      message: expect.stringMatching(/different write/),
    })
  })

  // One event per request, as a delete of chosen records has: the
  // operation `update-chosen`, every record by its keyed hash, their
  // count, and what became of each by its code -- a refused move
  // `transition-denied`, a declined record `declined`, its reason nowhere
  // in the trail or the log -- and no `moved`, which says one write's.
  // Watched failing with each record's update setting the trail's
  // `moved`: the event said the request moved the state field.
  test('audits one event per request, naming every record by its hash and what became of each by its code', async () => {
    rows = new Map([['2', { status: 'archived', note: null, assignee: null, version: VERSION }]])
    outcomes = new Map<string, RecordOutcome>([['3', { ok: false, code: 'declined', reason: 'Ticket 3 is kept by order of Ms Example.', message: 'm' }]])
    await changeChosen('ticket', { records: chosen([1, 2, 3]), answers: { status: 'closed' } })
    await changeChosen('ticket', { records: chosen([4]), answers: { status: 'closed' } }, 'sweeper')
    const hashes = (ids: number[]) => ids.map((each) => recordReference(KEY, `k1:${String(each)}`))
    expect(
      events.map(({ operation, status, outcome, record, rows: count, records, outcomes: each, moved }) => ({
        operation,
        status,
        outcome,
        record,
        count,
        records,
        each,
        moved,
      })),
    ).toEqual([
      {
        operation: 'update-chosen',
        status: 200,
        outcome: 'ok',
        record: null,
        count: 3,
        records: hashes([1, 2, 3]),
        each: ['done', 'transition-denied', 'declined'],
        moved: null,
      },
      { operation: 'update-chosen', status: 403, outcome: 'operation-denied', record: null, count: 1, records: hashes([4]), each: null, moved: null },
    ])
    expect(JSON.stringify([events, lines])).not.toContain('Ms Example')
  })
})

describe('GET /v1/forms/:id and changing chosen records', () => {
  // A page offers a change of chosen records, in the fields this says,
  // where the grant names a role of theirs and the update is offered them
  // now -- by the policy and by the database as it is -- the fields in the
  // form's order. Watched failing with `update` read from the grant alone:
  // the drifted form offered a change it would refuse.
  test('names the fields a person may change chosen records in, exactly where the grant and the update both hold', async () => {
    expect((await opened('ticket')).json()).toMatchObject({ operations: ['read', 'update'], bulk: { delete: false, update: ['status', 'note', 'assignee'] } })
    expect((await opened('ticket', 'sweeper')).json()).toMatchObject({ operations: ['read', 'update'], bulk: { delete: false, update: null } })
    expect((await opened('ticket', 'auditor')).json()).toMatchObject({ operations: ['read'], bulk: { update: null } })
    expect((await opened('one-at-a-time')).json()).toMatchObject({ bulk: { update: null } })
    catalog = [{ ok: true, described: KEY_GONE }]
    expect((await opened('ticket')).json()).toMatchObject({ operations: ['read'], bulk: { update: null } })
  })
})

describe('the published bundle', () => {
  // The grant is checked on publish and on every read: by the policy's own
  // validation, and against the form's rules, which the policy does not
  // hold -- a format 1 bundle is published with the form it carries, and a
  // rule there that shows the note by the status reads both together.
  // Watched failing with readTogetherProblems left out of validateBundle:
  // the bundle was published with both fields granted.
  test('is refused when its change grant names a field a rule of the form reads together with another, or a field no change may set', () => {
    expect(validateBundle(bundleOf(POLICY))).toMatchObject({ ok: true })
    const ruled = bundleOf(POLICY)
    const form = {
      ...ruled.form,
      logic: { rules: [...(ruled.form.logic?.rules ?? []), { target: 'note', kind: 'visible' as const, cel: 'status == "open"' }] },
    }
    const sentence = (field: string) =>
      `policy: bulk.update.fields: ${field} is read by the rule on note together with another field, which a change of chosen records cannot run over each record's other answers`
    expect(validateBundle({ ...ruled, form })).toEqual({ ok: false, problems: [sentence('note'), sentence('status')] })
    expect(validateBundle(bundleOf({ ...POLICY, bulk: { update: { roles: ['clerk'], fields: ['id'] } } }))).toEqual({
      ok: false,
      problems: ["policy: bulk.update.fields: id is the record's key, which an update never sets"],
    })
  })
})
