import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, DELETE_REFUSED, describedOf, DUPLICATE_RECORD, generateForm, LIST_PAGE_SIZE } from '@formancy/data-core'
import type {
  ActionAdapter,
  ColumnMeta,
  DatabaseAdapter,
  DeleteOutcome,
  DeleteRequest,
  Described,
  DescribedTable,
  FormPolicy,
  LookupAdapter,
  NormalizedType,
  ObjectMeta,
  ObjectRef,
  RecordAdapter,
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
 * `POST /v1/forms/:id/records/delete-chosen` and what `GET /v1/forms/:id`
 * says of it (0173), over fake ports. What the database does with each
 * delete is the adapter suites' business and e2e-bulk's, against real
 * servers (0003); what is under test here is what the route decides around
 * the single delete it runs for each record: who may send one, what
 * reaches the port and in which order, what each record's outcome is, when
 * it stops sending, what a write id does, and what the trail says.
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

/** A ticket: a key the database numbers, a tenant, a note and a rowversion -- a table a delete can be made against. */
const TICKET: ObjectMeta = {
  ref: ref('ticket'),
  kind: 'table',
  comment: null,
  columns: [
    col('id', 1, INT32, { generated: 'identity-always' }),
    col('tenant_id', 2, INT32),
    col('note', 3, NOTE, { nullable: true }),
    col('row_version', 4, ROWVERSION, { generated: 'rowversion' }),
  ],
  primaryKey: { name: 'pk_ticket', columns: ['id'] },
  uniqueKeys: [],
  foreignKeys: [],
  checks: [],
  rowSecurity: 'none',
  access: { delete: true },
  referencedBy: [],
}
const SNAPSHOT = createSnapshot({
  kind: 'sqlserver',
  serverVersion: '16.0',
  account: { user: 'dbo', login: 'sa' },
  scope: { schemas: ['sales'] },
  gaps: [],
  objects: [TICKET],
})

const READS = { read: ['clerk', 'auditor'], write: [] }
/** Clerks and a sweeper read and delete tickets of their tenant, one at a time; an auditor reads them. No bulk grant: what every policy written before 0173 says. */
const ONE_AT_A_TIME: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'sweeper', 'auditor'], create: [], update: [], delete: ['clerk', 'sweeper'] },
  fields: { id: READS, tenant_id: READS, note: READS },
  rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
  lookups: {},
}
/** The same, and clerks alone delete the chosen ones of a page together. */
const POLICY: FormPolicy = { ...ONE_AT_A_TIME, bulk: { delete: { roles: ['clerk'] } } }

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
const DEFINITION = 'the definition the fake catalog described'
const KEY = 'an-audit-key-the-operator-keeps-secret'
const WRITE_ID = '0123456789abcdef0123456789abcdef'

const described: DescribedTable = { ...(describedOf(SNAPSHOT, ref('ticket')) as Omit<DescribedTable, 'definition'>), definition: DEFINITION }
/** The ticket's key gone: two rows can share one, and a delete could remove both. */
const KEY_GONE: DescribedTable = { ...described, primaryKey: null }

let deletes: DeleteRequest[]
let describes: number
/** Each call of the fake port, in the order made: a description, or a delete by its key's value. */
let calls: string[]
/** What the fake delete answers for a record, by its key's value; a key not named is the row deleted, its key as sent. */
let outcomes: Map<string, DeleteOutcome>
/** How long the fake delete takes, in milliseconds. */
let lag: number
/** The key whose fake delete throws rather than answering, as an adapter's programming error does; null for none. */
let throwsAt: string | null
/** What the fake catalog says to each `describe`, in turn; once used up, the published snapshot's. */
let catalog: Described[]
let events: RuntimeAuditEvent[]
let lines: Array<Record<string, unknown>>
let root: string
let store: ConfigurationStore
let app: FastifyInstance

function registry(): ConnectionRegistry {
  const refused = (what: string) => async () => {
    throw new Error(`a delete of chosen records never ${what}`)
  }
  const records: RecordAdapter = {
    describe: async () => {
      describes += 1
      calls.push('describe')
      return catalog.shift() ?? { ok: true, described }
    },
    read: refused('reads'),
    list: refused('lists'),
    insert: refused('inserts'),
    update: refused('updates'),
    supersede: refused('changes from a date'),
    save: refused('saves a record with its rows'),
    delete: async (request) => {
      deletes.push(request)
      calls.push(`delete ${request.key[0]?.value ?? ''}`)
      if (lag > 0) await new Promise((resolve) => setTimeout(resolve, lag))
      const id = String(request.key[0]?.value ?? '')
      if (id === throwsAt) throw new Error(`the fake adapter threw at ${id}, in words no answer may carry`)
      return outcomes.get(id) ?? { ok: true, deleted: { values: { id }, version: request.expectedVersion } }
    },
  }
  const lookups: LookupAdapter = { search: async () => ({ rows: [], hasMore: false, omitted: 0 }), resolve: async () => [], rejects: async () => [] }
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
  const generated = generateForm(SNAPSHOT, { connection: 'erp', root: ref('ticket'), formId: 'ticket', title: 'Ticket', lookups: [] })
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
  deletes = []
  describes = 0
  calls = []
  outcomes = new Map()
  lag = 0
  throwsAt = null
  catalog = []
  events = []
  lines = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-bulk-'))
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
const chosen = (ids: readonly number[], version = VERSION) => ({ records: ids.map((id) => ({ record: `k1:${String(id)}`, version })) })
const removeChosen = (form: string, payload: unknown, token = 'clerk', headers: Record<string, string> = {}, on: FastifyInstance = app) =>
  on.inject({
    method: 'POST',
    url: `/v1/forms/${form}/records/delete-chosen`,
    headers: { ...as(token), ...headers },
    payload: payload as Record<string, unknown>,
  })
const removeOne = (record: string, version = VERSION) =>
  app.inject({ method: 'POST', url: '/v1/forms/ticket/records/delete', headers: as('clerk'), payload: { record, version } })
const opened = (form: string, token = 'clerk') => app.inject({ method: 'GET', url: `/v1/forms/${form}`, headers: as(token) })
const keysSent = () => deletes.map((request) => request.key[0]?.value)

describe('deleting chosen records', () => {
  // Each record is a single delete: the planner's request for its token
  // and version reaches the port, one after another in the order sent --
  // never sorted, never all at once -- and each is described first, as a
  // delete alone is. Watched failing with every record's description asked
  // before the first delete: the port's calls came out of turn.
  test('sends each record its own delete, in the order sent, each over its own description', async () => {
    const response = await removeChosen('ticket', chosen([9, 3, 7]))
    expect(response.statusCode, response.body).toBe(200)
    expect(calls).toEqual(['describe', 'delete 9', 'describe', 'delete 3', 'describe', 'delete 7'])
    expect(deletes[0]).toEqual({
      target: { table: ref('ticket'), identity: [{ name: 'id', type: INT32 }], concurrency: { kind: 'rowversion', column: 'row_version' } },
      key: [{ name: 'id', type: INT32, value: '9' }],
      expectedVersion: VERSION,
      filters: { kind: 'restricted', equal: [{ column: 'tenant_id', type: INT32, value: '1' }] },
      through: [],
      reach: { removed: [ref('ticket')], cleared: [], accepted: [] },
      definition: DEFINITION,
    })
    expect(response.json()).toEqual({
      records: ['k1:9', 'k1:3', 'k1:7'].map((record) => ({ sent: true, status: 200, body: { record, deleted: true } })),
    })
  })

  // A record's outcome is what `POST …/records/delete` answers for it
  // alone, status and body, whatever the port said -- so a page reads it
  // as it reads a single delete's. Each case is asked of both routes and
  // compared (watched failing with the bulk route wording a stale record
  // itself: "This record changed." where the single delete says more).
  test('answers each record exactly as the single delete answers it', async () => {
    const said: Array<[string, DeleteOutcome | undefined]> = [
      ['1', undefined],
      ['2', { ok: false, code: 'stale', message: 'm' }],
      ['3', { ok: false, code: 'not-found', message: 'm' }],
      ['4', { ok: false, code: 'foreign-key-violation', constraint: 'fk_reply_ticket', column: 'ticket_id', message: 'Key (id)=(4) is referenced.' }],
      ['5', { ok: false, code: 'declined', reason: 'Closed tickets are kept.', message: 'm' }],
      ['6', { ok: false, code: 'refused', message: 'm' }],
      ['7', { ok: false, code: 'permission-denied', message: 'm' }],
      ['8', { ok: false, code: 'schema-changed', message: 'm' }],
    ]
    for (const [id, outcome] of said) if (outcome !== undefined) outcomes.set(id, outcome)
    const together = await removeChosen('ticket', chosen(said.map(([id]) => Number(id))))
    const alone = []
    for (const [id] of said) {
      const one = await removeOne(`k1:${id}`)
      alone.push({ sent: true, status: one.statusCode, body: one.json<unknown>() })
    }
    expect(together.json()).toEqual({ records: alone })
    expect(together.json<{ records: Array<{ status: number }> }>().records.map((outcome) => outcome.status)).toEqual([200, 409, 404, 422, 422, 422, 403, 409])
    // A token this form cannot plan is that record's refusal, and the rest are sent.
    const planned = await removeChosen('ticket', { records: [{ record: 'k1:x', version: VERSION }, { record: 'k1:1', version: '1' }, ...chosen([2]).records] })
    expect(planned.json<{ records: Array<{ status: number; body: { code: string } }> }>().records.map(({ status, body }) => [status, body.code])).toEqual([
      [400, 'invalid-record-token'],
      [400, 'invalid-version'],
      [409, 'stale'],
    ])
  })

  // A refusal about one record is that record's: the records after it are
  // still sent, and each still answered. Watched failing with the loop
  // stopping at the first refusal: the third and fourth were not sent.
  test('goes on past a record refused, and sends the rest', async () => {
    outcomes.set('2', { ok: false, code: 'stale', message: 'm' })
    outcomes.set('3', { ok: false, code: 'not-found', message: 'm' })
    const response = await removeChosen('ticket', chosen([1, 2, 3, 4]))
    expect(keysSent()).toEqual(['1', '2', '3', '4'])
    expect(response.json<{ records: Array<{ sent: boolean; status: number }> }>().records.map(({ status }) => status)).toEqual([200, 409, 404, 200])
  })

  // An answer lost, or a database out of reach, leaves the connection in
  // doubt: the record is answered as a single delete would be -- 502 naming
  // it with its version, or 503 -- and nothing more is sent, every record
  // after it `{ sent: false }`. Watched failing with the loop going on past
  // an unknown outcome: the third record was deleted over a connection
  // whose last answer nobody heard.
  test('stops at the first unknown outcome or unavailable, and answers the rest not sent', async () => {
    outcomes.set('2', { ok: false, code: 'unknown-outcome', message: 'lost' })
    const lost = await removeChosen('ticket', chosen([1, 2, 3, 4]))
    expect(keysSent()).toEqual(['1', '2'])
    expect(lost.json()).toEqual({
      records: [
        { sent: true, status: 200, body: { record: 'k1:1', deleted: true } },
        {
          sent: true,
          status: 502,
          body: {
            code: 'unknown-outcome',
            operation: 'delete',
            record: 'k1:2',
            version: VERSION,
            message:
              'The connection to the database failed after the deletion was sent. It may have been deleted. Deleting again with the same version deletes nothing else: if it was deleted, that is answered as not found.',
          },
        },
        { sent: false },
        { sent: false },
      ],
    })
    deletes = []
    outcomes = new Map([['5', { ok: false, code: 'unavailable', message: 'm' }]])
    const unreached = await removeChosen('ticket', chosen([5, 6]))
    expect(keysSent()).toEqual(['5'])
    expect(unreached.json<{ records: unknown[] }>().records).toEqual([
      { sent: true, status: 503, body: { code: 'unavailable', message: 'The database could not complete this now. Nothing was deleted.' } },
      { sent: false },
    ])
  })

  // The deadline is checked before each record and never during one: the
  // first is always sent, and once it has passed every record after it is
  // not sent, said once in the log with how many. Watched failing with the
  // deadline unchecked: all three were deleted.
  test('checks the deadline before each record, and answers the rest not sent once it has passed', async () => {
    const hurried = await server(30)
    try {
      lag = 60
      const response = await removeChosen('ticket', chosen([1, 2, 3]), 'clerk', {}, hurried)
      expect(keysSent()).toEqual(['1'])
      expect(response.json()).toEqual({ records: [{ sent: true, status: 200, body: { record: 'k1:1', deleted: true } }, { sent: false }, { sent: false }] })
      expect(lines.filter((line) => line['msg'] === 'a request over chosen records passed its deadline; the records after it were not sent')).toEqual([
        expect.objectContaining({ level: 40, form: 'ticket', sent: 1, unsent: 2, deadlineMs: 30 }),
      ])
    } finally {
      await hurried.close()
    }
  })

  // Who may send one is asked before any statement -- the description
  // included: a person whose roles the bulk grant does not name, though
  // they may delete one record at a time; one on a form whose policy grants
  // nobody; one whose context cannot scope a delete. Watched failing with
  // authorizeBulk left out: the sweeper's record was described and deleted.
  test('is 403 with no statement for a person the bulk grant does not let through', async () => {
    expect((await removeChosen('ticket', chosen([1]), 'sweeper')).json()).toEqual({
      code: 'operation-denied',
      message: 'no role of this actor may delete chosen records together with this form',
    })
    expect((await removeChosen('ticket', chosen([1]), 'auditor')).statusCode).toBe(403)
    expect((await removeChosen('one-at-a-time', chosen([1]))).json()).toMatchObject({ code: 'operation-denied' })
    expect((await removeChosen('ticket', chosen([1]), 'clerk-untenanted')).json()).toMatchObject({ code: 'missing-attribute' })
    expect({ describes, deletes }).toEqual({ describes: 0, deletes: [] })
    // The sweeper still deletes one at a time.
    expect(
      (await app.inject({ method: 'POST', url: '/v1/forms/ticket/records/delete', headers: as('sweeper'), payload: { record: 'k1:1', version: VERSION } }))
        .statusCode,
    ).toBe(200)
  })

  // What the browser sent is checked first: a body that is not one to a
  // page of `{ record, version }`, and a write id that is not one, are 400
  // and nothing is sent. Two tokens of one key would send a second delete
  // of one row, answered not found about a record its person chose: 400
  // `duplicate-record`, naming the token, before any statement. Watched
  // failing with the duplicate check left out: the port was asked to delete
  // k1:1 twice.
  test('answers a malformed body, a page and one more, a write id that is not one, and a record named twice 400, sending nothing', async () => {
    expect((await removeChosen('ticket', { record: 'k1:1', version: VERSION })).json()).toEqual({
      code: 'invalid-request',
      message: 'Expected { records: [{ record, version }] }.',
    })
    const ids = Array.from({ length: LIST_PAGE_SIZE + 1 }, (_, index) => index + 1)
    expect((await removeChosen('ticket', chosen(ids))).json()).toMatchObject({
      code: 'invalid-request',
      message: expect.stringMatching(/from 1 to 50 records/),
    })
    expect((await removeChosen('ticket', chosen([1]), 'clerk', { 'formancy-write-id': 'short' })).json()).toMatchObject({ code: 'invalid-request' })
    const twice = await removeChosen('ticket', chosen([1, 2, 1]))
    expect([twice.statusCode, twice.json()]).toEqual([400, { code: 'duplicate-record', message: DUPLICATE_RECORD, records: ['k1:1', 'k1:1'] }])
    expect({ describes, deletes }).toEqual({ describes: 0, deletes: [] })
  })

  // A form the database no longer fits as published is refused once, at
  // the first record, with the delete's sentence, before anything is sent:
  // every other record would be refused the same way. Drift found later --
  // the catalog moving between two records -- is that record's, and the
  // request goes on. Watched failing with the first record's drift kept as
  // its outcome: the request answered 200 with ten drift refusals.
  test('answers a form drift stops once, 409, at the first record, and drift found later as that record’s', async () => {
    catalog = [{ ok: true, described: KEY_GONE }]
    const first = await removeChosen('ticket', chosen([1, 2, 3]))
    expect([first.statusCode, first.json()]).toEqual([409, { code: 'drift', message: DELETE_REFUSED }])
    expect({ describes, deletes }).toEqual({ describes: 1, deletes: [] })
    catalog = [
      { ok: true, described },
      { ok: true, described: KEY_GONE },
    ]
    const later = await removeChosen('ticket', chosen([1, 2, 3]))
    expect(later.json<{ records: Array<{ status: number }> }>().records.map(({ status }) => status)).toEqual([200, 409, 200])
    expect(keysSent()).toEqual(['1', '3'])
  })

  // The table gone or changed under the form (`schema-changed`), and a
  // connection the database will not let delete (`permission-denied`), are
  // what the form and its connection are, not what a record is: the first
  // record refused either way is the request's answer, once, with the
  // delete's own status and sentence, nothing deleted -- not fifty
  // descriptions and deletes each answered the same. Found at a later
  // record they stay that record's ("answers each record exactly as the
  // single delete answers it" sends both there). Watched failing with
  // ABOUT_THE_FORM holding drift and the configuration codes alone: the
  // vanished table's request answered 200, its first record a 409
  // `schema-changed` inside it and the next two described and deleted.
  test('answers a first record refused for what the table or the connection is once, with the delete’s own refusal', async () => {
    catalog = [{ ok: false, code: 'schema-changed', message: 'the table is gone' }]
    const vanished = await removeChosen('ticket', chosen([1, 2, 3]))
    expect([vanished.statusCode, vanished.json()]).toEqual([409, { code: 'schema-changed', message: 'The database changed since this form was published.' }])
    expect({ describes, deletes }).toEqual({ describes: 1, deletes: [] })
    outcomes.set('4', { ok: false, code: 'permission-denied', message: 'm' })
    const denied = await removeChosen('ticket', chosen([4, 5, 6]))
    expect([denied.statusCode, denied.json()]).toEqual([403, { code: 'permission-denied', message: 'The database connection is not allowed to do this.' }])
    expect(keysSent()).toEqual(['4'])
  })

  // A record whose delete throws -- an adapter's programming error, a
  // refusal deleteFailure has no words for -- is that record's 500 in the
  // server's own sentence, never the error's, and the request stops there,
  // since nobody can say what the connection did; the records before it
  // keep their outcomes in the answer and in the trail, and the error is
  // the operator's, in the log. The client reads a record's 500 as its
  // delete unknown. Watched failing with the loop uncaught: the request
  // was a bare 500 carrying the error's own words, the first record's
  // deletion in neither the answer nor the trail.
  test('answers a record whose delete throws 500 in its own words, keeps what came before, and sends nothing after', async () => {
    throwsAt = '2'
    const response = await removeChosen('ticket', chosen([1, 2, 3]))
    expect(keysSent()).toEqual(['1', '2'])
    expect([response.statusCode, response.json()]).toEqual([
      200,
      {
        records: [
          { sent: true, status: 200, body: { record: 'k1:1', deleted: true } },
          {
            sent: true,
            status: 500,
            body: { code: 'internal', message: "This record's delete failed in the server, and it may have been deleted; the operator's log says why." },
          },
          { sent: false },
        ],
      },
    ])
    expect(events.map(({ status, outcomes: each }) => ({ status, outcomes: each }))).toEqual([{ status: 200, outcomes: ['done', 'internal', 'not-sent'] }])
    expect(lines.filter((line) => line['msg'] === 'a delete of a chosen record failed in the server; the records after it were not sent')).toEqual([
      expect.objectContaining({
        level: 50,
        form: 'ticket',
        err: expect.objectContaining({ message: 'the fake adapter threw at 2, in words no answer may carry' }),
      }),
    ])
    expect(response.body).not.toContain('no answer may carry')
  })

  // A sending that arrives again with its write id is answered with the
  // first sending's answer -- each record's outcome as it was -- and asks
  // the database nothing, not even a description; the same id with another
  // body is refused. Watched failing with the loop run outside sendOnce:
  // the resend sent both deletes again, and was answered otherwise.
  test('answers a write id once, and refuses it with another body', async () => {
    outcomes.set('2', { ok: false, code: 'stale', message: 'm' })
    const id = { 'formancy-write-id': WRITE_ID }
    const first = await removeChosen('ticket', chosen([1, 2]), 'clerk', id)
    const sent = { describes, deletes: deletes.length }
    outcomes = new Map([['1', { ok: false, code: 'not-found', message: 'm' }]])
    const again = await removeChosen('ticket', chosen([1, 2]), 'clerk', id)
    expect(again.json()).toEqual(first.json())
    expect({ describes, deletes: deletes.length }).toEqual(sent)
    expect((await removeChosen('ticket', chosen([1, 3]), 'clerk', id)).json()).toMatchObject({
      code: 'invalid-request',
      message: expect.stringMatching(/different write/),
    })
  })

  // One event per request: the operation `delete-chosen`, every record by
  // its keyed hash in the order sent, their count, and what became of each
  // by its code -- `done`, a refusal's code, `unknown-outcome`, `not-sent`
  // -- never a value: a declined record is `declined`, its reason nowhere
  // in the trail or the log. `record` is null. A resend is `repeated`,
  // with no outcomes of its own; a request refused as a whole names its
  // records and no outcomes. Watched failing with `outcomes` left off the
  // event: the trail said 200 ok and nothing of the stale record.
  test('audits one event per request, naming every record by its hash and what became of each by its code', async () => {
    outcomes.set('2', { ok: false, code: 'declined', reason: 'Ticket 2 is kept by order of Ms Example.', message: 'm' })
    outcomes.set('3', { ok: false, code: 'unknown-outcome', message: 'lost' })
    const id = { 'formancy-write-id': WRITE_ID }
    await removeChosen('ticket', chosen([1, 2, 3, 4]), 'clerk', id)
    await removeChosen('ticket', chosen([1, 2, 3, 4]), 'clerk', id)
    await removeChosen('ticket', chosen([5]), 'sweeper')
    const hashes = (ids: number[]) => ids.map((each) => recordReference(KEY, `k1:${String(each)}`))
    expect(
      events.map(({ operation, status, outcome, record, rows, records, outcomes: each }) => ({
        operation,
        status,
        outcome,
        record,
        rows,
        records,
        outcomes: each,
      })),
    ).toEqual([
      {
        operation: 'delete-chosen',
        status: 200,
        outcome: 'ok',
        record: null,
        rows: 4,
        records: hashes([1, 2, 3, 4]),
        outcomes: ['done', 'declined', 'unknown-outcome', 'not-sent'],
      },
      { operation: 'delete-chosen', status: 200, outcome: 'repeated', record: null, rows: 4, records: hashes([1, 2, 3, 4]), outcomes: null },
      { operation: 'delete-chosen', status: 403, outcome: 'operation-denied', record: null, rows: 1, records: hashes([5]), outcomes: null },
    ])
    const said = JSON.stringify([events, lines])
    expect(said).not.toContain('Ms Example')
    expect(lines.filter((line) => line['msg'] === 'refused: the deployment declined a write, in words that go to the person and to no log')).toHaveLength(1)
  })
})

describe('GET /v1/forms/:id and deleting chosen records', () => {
  // A page offers the box column and Delete the chosen… where this says
  // so: the bulk grant names a role of theirs and the delete is offered
  // them now -- by the policy and by the database as it is. Watched
  // failing with `bulk` read from the policy alone: the drifted form
  // offered a delete of chosen records it would refuse.
  test('says a person may delete chosen records exactly where the grant and the delete both hold', async () => {
    expect((await opened('ticket')).json()).toMatchObject({ operations: ['read', 'delete'], bulk: { delete: true } })
    expect((await opened('ticket', 'sweeper')).json()).toMatchObject({ operations: ['read', 'delete'], bulk: { delete: false } })
    expect((await opened('ticket', 'auditor')).json()).toMatchObject({ operations: ['read'], bulk: { delete: false } })
    expect((await opened('one-at-a-time')).json()).toMatchObject({ operations: ['read', 'delete'], bulk: { delete: false } })
    catalog = [{ ok: true, described: KEY_GONE }]
    expect((await opened('ticket')).json()).toMatchObject({ operations: ['read'], bulk: { delete: false } })
  })
})

describe('the published bundle', () => {
  // The grant is checked on publish and on every read, by the policy's own
  // validation: a role it names must be one that may delete, and a form
  // that offers no delete takes none.
  test('is refused when its bulk grant names a role that may not delete, or a form offers no delete', () => {
    expect(validateBundle(bundleOf(POLICY))).toMatchObject({ ok: true })
    expect(validateBundle(bundleOf({ ...POLICY, bulk: { delete: { roles: ['clerk', 'auditor'] } } }))).toEqual({
      ok: false,
      problems: ['policy: bulk.delete grants auditor, who may not delete with this form: each chosen record is a delete of its own'],
    })
    const unoffered = bundleOf(POLICY)
    const { delete: _offered, ...operations } = unoffered.bindings.operations
    expect(
      validateBundle({
        ...unoffered,
        bindings: { ...unoffered.bindings, operations },
        policy: { ...POLICY, operations: { ...POLICY.operations, delete: [] } },
      }),
    ).toEqual({
      ok: false,
      problems: ['policy: bulk names who may delete chosen records together, and this form does not offer delete'],
    })
  })
})
