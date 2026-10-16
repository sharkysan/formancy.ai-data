import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, DELETE_REFUSED, describedOf, generateForm } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, DeleteOutcome, ForeignKeyMeta, DeleteRequest, Described, DescribedTable, FormPolicy, InboundKey, LookupAdapter, NormalizedType, ObjectMeta, ObjectRef, RecordAdapter } from '@formancy/data-core'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AuditSink, RuntimeAuditEvent } from '../audit.js'
import { recordReference } from '../audit.js'
import type { PublishedBundle } from '../bundle.js'
import { validateBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { IdentityVerifier } from '../identity.js'

/*
 * `POST /v1/forms/:id/records/delete` and what `GET /v1/forms/:id` says of
 * delete (0050), over fake ports. What the database does with a delete is
 * the adapter suites' business, against real servers (0003); what is under
 * test here is what the route decides before and after: who may delete,
 * what reaches the port, how each answer is worded, what a write id does,
 * and what the trail says.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const NOTE: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const ROWVERSION: NormalizedType = { kind: 'rowversion' }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})
const ref = (name: string): ObjectRef => ({ schema: 'sales', name })
const fk = (name: string, columns: string[], target: string, onDelete: 'no-action' | 'cascade'): ForeignKeyMeta => ({ name, columns, references: { table: ref(target), columns: ['id'] }, onUpdate: 'no-action', onDelete, enforced: true, validated: true })
const inbound = (table: string, name: string, columns: string[], onDelete: InboundKey['onDelete']): InboundKey => ({ table: ref(table), name, columns, referencedColumns: ['id'], onDelete, onUpdate: 'no-action', enforced: true })

/** A table with a key the database numbers, a tenant, a note and a rowversion: one a delete can be made against. */
function numbered(name: string, extra: Partial<ObjectMeta> = {}): ObjectMeta {
  return {
    ref: ref(name), kind: 'table', comment: null,
    columns: [col('id', 1, INT32, { generated: 'identity-always' }), col('tenant_id', 2, INT32), col('note', 3, NOTE, { nullable: true }), col('row_version', 4, ROWVERSION, { generated: 'rowversion' })],
    primaryKey: { name: `pk_${name}`, columns: ['id'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none', access: { delete: true }, referencedBy: [], ...extra,
  }
}

/**
 * A ticket, which a reply refers to with NO ACTION, so the database may keep
 * one; an order, whose lines cascade from it, which 0050 offers no grant
 * over; and the lines themselves, which nothing refers to.
 */
const SNAPSHOT = createSnapshot({
  kind: 'sqlserver', serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
  objects: [
    numbered('ticket', { referencedBy: [inbound('reply', 'fk_reply_ticket', ['ticket_id'], 'no-action')] }),
    numbered('reply', { columns: [...numbered('reply').columns, col('ticket_id', 5, INT32)], foreignKeys: [fk('fk_reply_ticket', ['ticket_id'], 'ticket', 'no-action')] }),
    numbered('order', { referencedBy: [inbound('line', 'fk_line_order', ['order_id'], 'cascade')] }),
    numbered('line', { columns: [...numbered('line').columns, col('order_id', 5, INT32)], foreignKeys: [fk('fk_line_order', ['order_id'], 'order', 'cascade')] }),
  ],
})

const READS = { read: ['clerk'], write: [] }
const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
/** Clerks read and delete tickets of their tenant; an auditor only reads them. */
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk', 'auditor'], create: [], update: [], delete: ['clerk'] },
  fields: { id: READS, tenant_id: READS, note: READS },
  rowFilters: TENANT,
  lookups: {},
}
const READ_ONLY: FormPolicy = { ...POLICY, operations: { read: ['clerk'], create: [], update: [] } }
/** The same, and the lines' key named with its action, so a delete of an order takes its lines (0051). */
const CASCADING: FormPolicy = { ...POLICY, cascades: [{ table: ref('line'), foreignKey: 'fk_line_order', onDelete: 'cascade' }] }

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'clerk' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: { tenant: '1' } } }
    : token === 'auditor' ? { ok: true, identity: { actor: { id: 'a', roles: ['auditor'] }, attributes: { tenant: '1' } } }
    : token === 'clerk-untenanted' ? { ok: true, identity: { actor: { id: 'u', roles: ['clerk'] }, attributes: {} } }
      : { ok: false, reason: 'bad' }

const VERSION = '00000000000007d1'
const DEFINITION = 'the definition the fake catalog described'
const KEY = 'an-audit-key-the-operator-keeps-secret'
const WRITE_ID = '0123456789abcdef0123456789abcdef'

const describedAs = (table: ObjectRef): DescribedTable => ({ ...(describedOf(SNAPSHOT, table) as Omit<DescribedTable, 'definition'>), definition: DEFINITION })
/** The ticket's key gone: two rows can share one, and a delete could remove both. */
const KEY_GONE: DescribedTable = { ...describedAs(ref('ticket')), primaryKey: null }

let deletes: DeleteRequest[]
let describes: number
/** What the fake delete answers; undefined is the row deleted, its key spelled as the database held it. */
let deleteOutcome: DeleteOutcome | undefined
/** What the fake catalog says to `describe`; undefined is the published snapshot's. */
let catalog: Described | undefined
let events: RuntimeAuditEvent[]
let root: string
let app: FastifyInstance

function registry(): ConnectionRegistry {
  const refused = (what: string) => async () => {
    throw new Error(`a delete never ${what}`)
  }
  const records: RecordAdapter = {
    describe: async (table) => {
      describes += 1
      return catalog ?? { ok: true, described: describedAs(table) }
    },
    read: async (request) => ({ ok: true, described: describedAs(request.target.table), record: { values: { id: '7', tenant_id: '1', note: 'n' }, version: VERSION } }),
    list: refused('lists'),
    insert: refused('inserts'),
    update: refused('updates'),
    delete: async (request) => {
      deletes.push(request)
      return deleteOutcome ?? { ok: true, deleted: { values: { id: '7' }, version: VERSION } }
    },
  }
  const lookups: LookupAdapter = { search: async () => ({ rows: [], hasMore: false, omitted: 0 }), resolve: async () => [], rejects: async () => [] }
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: '16.0', product: 'sqlserver', major: 16, compatibility: 160 }), discover: async () => SNAPSHOT, close: async () => {} } as DatabaseAdapter
  return { ids: () => ['erp'], scope: () => ({ schemas: ['sales'] }), open: async (id) => (id === 'erp' ? { adapter, lookups, records } : undefined), close: async () => {} }
}

function bundleOf(table: string, policy: FormPolicy): PublishedBundle {
  const generated = generateForm(SNAPSHOT, { connection: 'erp', root: ref(table), formId: table, title: table, lookups: [] })
  return { format: 1, connection: 'erp', form: generated.form, bindings: generated.bindings, policy, snapshot: SNAPSHOT }
}

beforeEach(async () => {
  deletes = []
  describes = 0
  deleteOutcome = undefined
  catalog = undefined
  events = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-deletes-'))
  const store = createFileConfigurationStore(root)
  const ticket = bundleOf('ticket', POLICY)
  await store.publish('ticket', null, ticket)
  await store.publish('read-only', null, { ...ticket, policy: READ_ONLY })
  await store.publish('order', null, bundleOf('order', CASCADING))
  // A form published before 0050: its bindings say nothing of delete.
  const { delete: _offered, ...before } = ticket.bindings.operations
  await store.publish('before', null, { ...ticket, bindings: { ...ticket.bindings, operations: before }, policy: READ_ONLY })
  const sink: AuditSink = (event) => {
    if (event.plane === 'runtime') events.push(event)
  }
  app = await createDataServer({ verifyIdentity, runtime: { registry: registry(), store, audit: { sink, key: KEY, now: () => '2026-10-11T12:00:00.000Z' } } })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const remove = (form: string, payload: unknown, token = 'clerk', headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: `/v1/forms/${form}/records/delete`, headers: { ...as(token), ...headers }, payload: payload as Record<string, unknown> })
const opened = (form: string, token = 'clerk') => app.inject({ method: 'GET', url: `/v1/forms/${form}`, headers: as(token) })

describe('the delete route', () => {
  // What reaches the port is the planner's request for the token and the
  // version sent, no more: the key, the tenant's filter, the root as the
  // reach and the definition the route described. The answer names the row
  // the statement deleted and holds nothing of it.
  test('hands the port the planned request, and answers the deleted row by its token', async () => {
    const response = await remove('ticket', { record: 'k1:7', version: VERSION })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ record: 'k1:7', deleted: true })
    expect(deletes).toEqual([
      {
        target: { table: ref('ticket'), identity: [{ name: 'id', type: INT32 }], concurrency: { kind: 'rowversion', column: 'row_version' } },
        key: [{ name: 'id', type: INT32, value: '7' }],
        expectedVersion: VERSION,
        filters: { kind: 'restricted', equal: [{ column: 'tenant_id', type: INT32, value: '1' }] },
        through: [],
        reach: { removed: [ref('ticket')], cleared: [], accepted: [] },
        definition: DEFINITION,
      },
    ])
    expect(describes).toBe(1)
  })

  // The token answered is the row's own, made from the key the statement
  // deleted: under a case-insensitive key the database may hold it spelled
  // otherwise than the token sent (0028).
  test('answers the token of the key as the database held it', async () => {
    deleteOutcome = { ok: true, deleted: { values: { id: '0007' }, version: VERSION } }
    expect((await remove('ticket', { record: 'k1:7', version: VERSION })).json()).toEqual({ record: 'k1:0007', deleted: true })
  })

  // Nothing is deleted for a person the host has not vouched for, whom the
  // policy grants no delete, or whose context cannot scope it -- and no
  // statement is sent: the policy is asked before the table is described
  // (0041).
  test('is 401 without a token, and 403 with no statement to a person the policy does not let delete', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/forms/ticket/records/delete', payload: { record: 'k1:7', version: VERSION } })).statusCode).toBe(401)
    expect((await remove('ticket', { record: 'k1:7', version: VERSION }, 'auditor')).json()).toMatchObject({ code: 'operation-denied' })
    expect((await remove('ticket', { record: 'k1:7', version: VERSION }, 'clerk-untenanted')).json()).toMatchObject({ code: 'missing-attribute' })
    expect((await remove('read-only', { record: 'k1:7', version: VERSION })).json()).toMatchObject({ code: 'operation-denied' })
    expect((await remove('before', { record: 'k1:7', version: VERSION })).json()).toMatchObject({ code: 'operation-denied' })
    expect({ describes, deletes }).toEqual({ describes: 0, deletes: [] })
  })

  // What the browser sent is checked before anything else: a body without
  // the version, a token that names no record of this form, a version no
  // rowversion could be.
  test('answers a malformed body, token or version 400, and deletes nothing', async () => {
    expect((await remove('ticket', { record: 'k1:7' })).json()).toMatchObject({ code: 'invalid-request' })
    expect((await remove('ticket', { record: 'k1:x', version: VERSION })).json()).toMatchObject({ code: 'invalid-record-token' })
    expect((await remove('ticket', { record: 'k1:7', version: '1' })).json()).toMatchObject({ code: 'invalid-version' })
    expect((await remove('ticket', { record: 'k1:7', version: VERSION }, 'clerk', { 'formancy-write-id': 'short' })).json()).toMatchObject({ code: 'invalid-request' })
    expect(deletes).toEqual([])
  })

  // Each outcome the port can answer, in a delete's own words: never
  // "nothing was saved", and never a field error, because the column a key
  // names is another table's. `referenced` says something refers to the
  // record and nothing more (watched failing with the update's sentences,
  // recordFailure's, answered instead).
  test('answers each outcome of the port in its own words, with no field errors', async () => {
    const cases: Array<[DeleteOutcome, number, string, RegExp]> = [
      [{ ok: false, code: 'stale', message: 'm' }, 409, 'stale', /Reload it and review the changes before deleting it/],
      [{ ok: false, code: 'not-found', message: 'm' }, 404, 'not-found', /No such record/],
      [{ ok: false, code: 'foreign-key-violation', constraint: 'fk_reply_ticket', column: 'ticket_id', message: 'm' }, 422, 'referenced', /^Other records still refer to this one, so the database keeps it\. Nothing was deleted\.$/],
      [{ ok: false, code: 'refused', message: 'm' }, 422, 'refused', /nothing was deleted\. Sending it again will be refused the same way/],
      [{ ok: false, code: 'check-violation', column: 'note', message: 'm' }, 422, 'refused', /nothing was deleted/],
      [{ ok: false, code: 'permission-denied', message: 'm' }, 403, 'permission-denied', /not allowed/],
      [{ ok: false, code: 'schema-changed', message: 'm' }, 409, 'schema-changed', /changed since this form was published/],
      [{ ok: false, code: 'unavailable', message: 'm' }, 503, 'unavailable', /Nothing was deleted\./],
    ]
    for (const [outcome, status, code, sentence] of cases) {
      deleteOutcome = outcome
      const response = await remove('ticket', { record: 'k1:7', version: VERSION })
      expect({ status: response.statusCode, body: response.json() as unknown }).toEqual({ status, body: { code, message: expect.stringMatching(sentence) } })
    }
    // The catalog that cannot be described now is a delete's refusal too.
    catalog = { ok: false, code: 'unavailable', message: 'm' }
    expect((await remove('ticket', { record: 'k1:7', version: VERSION })).json()).toEqual({ code: 'unavailable', message: 'The database could not complete this now. Nothing was deleted.' })
  })

  // `referenced` names no table, key or count to the person. An operator
  // learns from the log which key kept the record, by its name, and nothing
  // of the adapter's sentence, which on PostgreSQL can carry the key's
  // values (0050).
  test('says in the log which key kept a referenced record, and no value', async () => {
    const lines: Array<Record<string, unknown>> = []
    const logged = await createDataServer({
      verifyIdentity,
      logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) } },
      runtime: { registry: registry(), store: createFileConfigurationStore(root) },
    })
    deleteOutcome = { ok: false, code: 'foreign-key-violation', constraint: 'fk_reply_ticket', column: 'ticket_id', message: 'Key (id)=(7) is still referenced from table "reply".' }
    const response = await logged.inject({ method: 'POST', url: '/v1/forms/ticket/records/delete', headers: as('clerk'), payload: { record: 'k1:7', version: VERSION } })
    expect(response.json()).toEqual({ code: 'referenced', message: 'Other records still refer to this one, so the database keeps it. Nothing was deleted.' })
    expect(lines.filter((line) => line['msg'] === 'a delete was refused: other records still refer to this one')).toEqual([expect.objectContaining({ level: 30, form: 'ticket', constraint: 'fk_reply_ticket' })])
    expect(JSON.stringify(lines)).not.toContain('(7)')
  })

  // The database as this request described it stops a delete as drift
  // review does: a key gone could make one statement remove two rows. The
  // sentence says nothing was deleted, and the port is never asked.
  test('refuses drift over the description, with the delete’s sentence, and sends nothing', async () => {
    catalog = { ok: true, described: KEY_GONE }
    expect((await remove('ticket', { record: 'k1:7', version: VERSION })).json()).toEqual({ code: 'drift', message: DELETE_REFUSED })
    expect(deletes).toEqual([])
  })

  // An answer lost after the delete was sent (0031): 502, with what was
  // addressed for the host to reconcile with, and a sentence that says
  // deleting again with the same version is safe.
  test('answers a lost answer 502 with the record and version sent', async () => {
    deleteOutcome = { ok: false, code: 'unknown-outcome', message: 'lost' }
    const response = await remove('ticket', { record: 'k1:7', version: VERSION })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({
      code: 'unknown-outcome',
      operation: 'delete',
      record: 'k1:7',
      version: VERSION,
      message: 'The connection to the database failed after the deletion was sent. It may have been deleted. Deleting again with the same version deletes nothing else: if it was deleted, that is answered as not found.',
    })
  })

  // A sending that arrives again with its write id is answered with the
  // first answer and asks the database nothing; the same id with another
  // body is refused. The trail names the operation `delete` and the record
  // by its keyed hash, and the second as `repeated` (watched failing with
  // the route sending without sendOnce: deleted twice).
  test('answers a write id once, refuses it with another body, and audits delete and repeated', async () => {
    const id = { 'formancy-write-id': WRITE_ID }
    const first = await remove('ticket', { record: 'k1:7', version: VERSION }, 'clerk', id)
    const again = await remove('ticket', { record: 'k1:7', version: VERSION }, 'clerk', id)
    expect([first.statusCode, again.statusCode, again.json()]).toEqual([200, 200, { record: 'k1:7', deleted: true }])
    expect(deletes).toHaveLength(1)
    expect(describes).toBe(1)
    expect((await remove('ticket', { record: 'k1:8', version: VERSION }, 'clerk', id)).json()).toMatchObject({ code: 'invalid-request', message: expect.stringMatching(/different write/) })
    expect(events.map(({ operation, status, outcome, record }) => ({ operation, status, outcome, record }))).toEqual([
      { operation: 'delete', status: 200, outcome: 'ok', record: recordReference(KEY, 'k1:7') },
      { operation: 'delete', status: 200, outcome: 'repeated', record: recordReference(KEY, 'k1:7') },
      { operation: 'delete', status: 400, outcome: 'invalid-request', record: recordReference(KEY, 'k1:8') },
    ])
  })

  // A delete has no lookup fields: a lookup asked for delete is the request's mistake.
  test('refuses a lookup asked for delete', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/forms/ticket/lookups/any/query', headers: as('clerk'), payload: { operation: 'delete' } })
    expect([response.statusCode, response.json()]).toEqual([400, { code: 'invalid-request', message: expect.stringMatching(/read, create or update/) }])
  })
})

describe('GET /v1/forms/:id and delete', () => {
  // Delete is offered where the bindings offer it, the policy grants it and
  // the database as it is now allows it; with it comes what a delete also
  // does, for the page's confirmation: nothing cascades or clears in 0050,
  // and a reply's NO ACTION key may keep a ticket.
  test('offers delete with what it also does, where the bindings, the policy and the database allow', async () => {
    expect((await opened('ticket')).json()).toMatchObject({ operations: ['read', 'delete'], deleting: { cascades: false, clears: false, restricted: true } })
    expect((await opened('ticket', 'auditor')).json()).toMatchObject({ operations: ['read'], deleting: null })
    expect((await opened('read-only')).json()).toMatchObject({ operations: ['read'], deleting: null })
    catalog = { ok: true, described: KEY_GONE }
    expect((await opened('ticket')).json()).toMatchObject({ operations: ['read'], deleting: null })
  })

  // An order whose policy names its lines' key: a page says a delete
  // removes other records with it, from the accepted key's action, and the
  // route hands the port the reach the planner made -- the lines, and the
  // key with the table it refers to -- which the adapter locks and guards
  // (watched failing with GET's `deleting` worked out without the policy:
  // cascades false).
  test("says a delete cascades where the policy names the key, and hands the port that reach", async () => {
    expect((await opened('order')).json()).toMatchObject({ operations: ['read', 'delete'], deleting: { cascades: true, clears: false, restricted: false } })
    const response = await remove('order', { record: 'k1:7', version: VERSION })
    expect(response.statusCode, response.body).toBe(200)
    expect(deletes.map((request) => request.reach)).toEqual([
      { removed: [ref('order'), ref('line')], cleared: [], accepted: [{ from: ref('line'), name: 'fk_line_order', onto: ref('order'), onDelete: 'cascade' }] },
    ])
  })

  // A form published before 0050 says nothing of delete, and offers none
  // (`offers()`), where the route once offered every flag not `false`.
  test('offers no delete on a form whose bindings say nothing of it', async () => {
    expect((await opened('before')).json()).toMatchObject({ operations: ['read'], deleting: null })
  })
})

describe('the published bundle', () => {
  // What a delete also does is checked on publish and on every read, by
  // the planner's own function: an order whose lines cascade from it may
  // be deleted only where its policy names the key with its action (0051),
  // and a role that deletes must read.
  test('is refused when its policy grants delete over a cascade it does not name, or to a role that may not read', () => {
    const order = bundleOf('order', POLICY)
    expect(validateBundle(order)).toEqual({
      ok: false,
      problems: ['policy: operations.delete grants roles, and deleting a record of sales.order also deletes rows of sales.line (fk_line_order, ON DELETE CASCADE), which cascades does not accept'],
    })
    expect(validateBundle(bundleOf('order', CASCADING))).toMatchObject({ ok: true })
    expect(validateBundle(bundleOf('line', POLICY))).toMatchObject({ ok: true })
    const blind = bundleOf('ticket', { ...POLICY, operations: { ...POLICY.operations, delete: ['clerk', 'purger'] } })
    expect(validateBundle(blind)).toEqual({
      ok: false,
      problems: ['policy: operations.delete grants purger, who may not read with this form: a delete names the version its person read, so grant read to every role that may delete'],
    })
  })
})
