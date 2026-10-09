import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, generateForm } from '@formancy/data-core'
import type {
  ColumnMeta,
  DatabaseAdapter,
  FormPolicy,
  InsertRequest,
  LookupAdapter,
  NormalizedType,
  RecordAdapter,
  RecordOutcome,
  UpdateRequest,
} from '@formancy/data-core'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { PublishedBundle } from '../bundle.js'
import { recordReference } from '../audit.js'
import type { AuditEvent } from '../audit.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { IdentityVerifier } from '../identity.js'

/*
 * The runtime plane over fake ports. What the database does with a request is
 * the adapter suites' business, against real servers (0003); what is under
 * test here is what the route decides before and after: who may, what is
 * stripped, what reaches the port, and how each answer is translated.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})
const ref = (name: string) => ({ schema: 'sales', name })

const SNAPSHOT = createSnapshot({
  kind: 'sqlserver', serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
  objects: [
    {
      ref: ref('country'), kind: 'table', comment: null,
      columns: [col('id', 1, INT32, { generated: 'identity-always' }), col('iso_code', 2, { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true }), col('name', 3, { kind: 'text', maxLength: 100, lengthUnit: 'utf16-code-units', fixedLength: false })],
      primaryKey: { name: 'pk_country', columns: ['id'] }, uniqueKeys: [{ name: 'uq_country_iso_code', columns: ['iso_code'] }], foreignKeys: [], checks: [], rowSecurity: 'none',
    },
    {
      ref: ref('customer'), kind: 'table', comment: null,
      columns: [
        col('tenant_id', 1, INT32),
        col('customer_no', 2, INT32),
        col('name', 3, { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }),
        col('country_code', 4, { kind: 'text', maxLength: 2, lengthUnit: 'utf16-code-units', fixedLength: true }, { nullable: true }),
        col('created_at', 5, { kind: 'timestamp', withTimeZone: true, precision: 7 }, { hasDefault: true }),
        col('row_version', 6, { kind: 'rowversion' }, { generated: 'rowversion' }),
      ],
      primaryKey: { name: 'pk_customer', columns: ['tenant_id', 'customer_no'] }, uniqueKeys: [],
      foreignKeys: [{ name: 'fk_customer_country', columns: ['country_code'], references: { table: ref('country'), columns: ['iso_code'] }, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true }],
      checks: [],
      rowSecurity: 'none',
    },
  ],
})

const RW = { read: ['clerk'], write: ['clerk'] }
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { tenant_id: { read: ['clerk'], write: [] }, customer_no: RW, name: RW, country: RW, created_at: { read: ['clerk'], write: [] } },
  rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
  lookups: { country: [] },
}

/** A country has no version to guard an update with, so its form offers read and create. */
const COUNTRY_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: [] },
  fields: { id: { read: ['clerk'], write: [] }, iso_code: RW, name: RW },
  rowFilters: [],
  lookups: {},
}

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'clerk' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: { tenant: '1' } } }
    : token === 'clerk-042' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: { tenant: '042' } } }
    : token === 'stranger' ? { ok: true, identity: { actor: { id: 's', roles: [] }, attributes: { tenant: '1' } } }
      : { ok: false, reason: 'bad' }

const STORED = { tenant_id: '1', customer_no: '7', name: 'Muster AG', country_code: 'CH', created_at: '2026-10-08T00:00:00Z' }
const RECORD = 'k1:1,7'
const VERSION = '00000000000007d1'

/** What the fake ports were asked, and what they answer. Each test sets what it needs. */
let calls: { inserts: InsertRequest[]; updates: UpdateRequest[]; rejects: string[][]; lookups: number }
let writeOutcome: RecordOutcome
/** What a fake insert waits for before it answers: settled, unless a case holds it. */
let insertGate: Promise<void>
/** What the fake read answers; undefined is the stored customer. */
let readOutcome: RecordOutcome | undefined
let rejected: string[]
let rejectsFails: boolean
let root: string
let app: FastifyInstance

function registry(): ConnectionRegistry {
  const records: RecordAdapter = {
    read: async () => readOutcome ?? { ok: true, values: { ...STORED }, version: VERSION },
    insert: async (request) => {
      calls.inserts.push(request)
      await insertGate
      return writeOutcome
    },
    update: async (request) => {
      calls.updates.push(request)
      return writeOutcome
    },
  }
  const lookups: LookupAdapter = {
    search: async () => {
      calls.lookups += 1
      return { rows: [{ token: 'k1:CH', label: 'Switzerland' }], hasMore: false, omitted: 0 }
    },
    resolve: async (_config, tokens) => {
      calls.lookups += 1
      return tokens.map((token) => ({ token, label: 'Switzerland' }))
    },
    rejects: async (_config, tokens) => {
      calls.rejects.push([...tokens])
      if (rejectsFails) throw new Error('timeout on 10.0.0.5')
      return tokens.filter((token) => rejected.includes(token))
    },
  }
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: '16.0' }), discover: async () => SNAPSHOT, close: async () => {} } as DatabaseAdapter
  return { ids: () => ['erp'], scope: () => ({ schemas: ['sales'] }), open: async (id) => (id === 'erp' ? { adapter, lookups, records } : undefined), close: async () => {} }
}

beforeEach(async () => {
  calls = { inserts: [], updates: [], rejects: [], lookups: 0 }
  writeOutcome = { ok: true, values: { ...STORED }, version: VERSION }
  insertGate = Promise.resolve()
  readOutcome = undefined
  rejected = []
  rejectsFails = false
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-'))
  const store = createFileConfigurationStore(root)
  const { form, bindings } = generateForm(SNAPSHOT, {
    connection: 'erp', root: ref('customer'), formId: 'customer', title: 'Customer',
    lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }], pinned: ['tenant_id'],
  })
  const bundle: PublishedBundle = { format: 1, connection: 'erp', form, bindings, policy: POLICY, snapshot: SNAPSHOT }
  await store.publish('customer', null, bundle)
  // The same form whose country list is scoped by the tenant, through the country's integer id.
  const scoped = generateForm(SNAPSHOT, {
    connection: 'erp', root: ref('customer'), formId: 'scoped', title: 'Customer',
    lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }], pinned: ['tenant_id'],
  })
  await store.publish('scoped', null, { ...bundle, form: scoped.form, bindings: scoped.bindings, policy: { ...POLICY, lookups: { country: [{ column: 'id', attribute: 'tenant' }] } } })
  // A country, whose key the database numbers: a create names no key of its own.
  const country = generateForm(SNAPSHOT, { connection: 'erp', root: ref('country'), formId: 'country', title: 'Country', lookups: [] })
  await store.publish('country', null, { ...bundle, form: country.form, bindings: country.bindings, policy: COUNTRY_POLICY })
  app = await createDataServer({ verifyIdentity, runtime: { registry: registry(), store } })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const as = (token: string) => ({ authorization: `Bearer ${token}` })
const post = (url: string, payload: unknown, token = 'clerk') => app.inject({ method: 'POST', url, headers: as(token), payload: payload as Record<string, unknown> })
/** What a renderer submits for a new customer: every field, the read-only ones empty. */
const NEW = { tenant_id: null, customer_no: 8, name: 'Neu GmbH', country: 'k1:CH', created_at: null }

describe('the runtime plane', () => {
  // Nothing about a form is served to somebody the host has not vouched for,
  // and a person the policy grants nothing does not learn the form exists.
  test('requires a verified token, and an operation the policy grants', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/forms/customer' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/v1/forms/customer', headers: as('stranger') })).statusCode).toBe(403)
    const served = (await app.inject({ method: 'GET', url: '/v1/forms/customer', headers: as('clerk') })).json()
    expect(served.operations).toEqual(['read', 'create', 'update'])
    expect(served.readable).toEqual(['tenant_id', 'customer_no', 'name', 'country', 'created_at'])
    expect(served.form.id).toBe('customer')
    expect((await app.inject({ method: 'GET', url: '/v1/forms/nope', headers: as('clerk') })).statusCode).toBe(404)
  })

  // A read returns the answers the generated form holds: numbers for number
  // fields, the lookup as its token, plus the record token and version.
  test('reads a record as the form holds it', async () => {
    const response = await post('/v1/forms/customer/records/read', { record: RECORD })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      record: RECORD,
      version: VERSION,
      answers: { tenant_id: 1, customer_no: 7, name: 'Muster AG', country: 'k1:CH', created_at: '2026-10-08T00:00:00Z' },
    })
    expect((await post('/v1/forms/customer/records/read', { record: 'not-a-token' })).statusCode).toBe(400)
    expect((await post('/v1/forms/customer/records/read', {})).statusCode).toBe(400)
  })

  // A renderer submits every field, the read-only ones empty. The echo is
  // removed, the tenant comes from the token, and the selection is checked
  // against the database before anything is written.
  test('creates: strips the empty read-only echo, pins the tenant from context, checks the selection', async () => {
    const response = await post('/v1/forms/customer/records/create', { answers: NEW })
    expect(response.statusCode).toBe(201)
    expect(calls.rejects).toEqual([['k1:CH']])
    const values = Object.fromEntries((calls.inserts[0]?.values ?? []).map((entry) => [entry.name, entry.value]))
    expect(values).toEqual({ tenant_id: '1', customer_no: '8', name: 'Neu GmbH', country_code: 'CH' })
  })

  // A tenant in the request is the browser's claim, not the host's. Sent with
  // a value, it is over-posting, and nothing is written.
  test('refuses a submitted tenant, and writes nothing', async () => {
    const response = await post('/v1/forms/customer/records/create', { answers: { ...NEW, tenant_id: 2 } })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ code: 'over-posting' })
    expect(calls.inserts).toEqual([])
  })

  // A selection the database does not vouch for is a field error; one it
  // cannot answer for refuses the save, closed, with nothing written.
  test('a rejected selection is a field error, and a lookup that cannot answer refuses the save', async () => {
    rejected = ['k1:CH']
    const refused = await post('/v1/forms/customer/records/create', { answers: NEW })
    expect(refused.statusCode).toBe(422)
    expect(refused.json().fieldErrors).toEqual([expect.objectContaining({ field: 'country' })])
    rejected = []
    rejectsFails = true
    const down = await post('/v1/forms/customer/records/create', { answers: NEW })
    expect(down.statusCode).toBe(503)
    expect(down.body).not.toContain('10.0.0.5')
    expect(calls.inserts).toEqual([])
  })

  // The codec's field errors reach the person by field; the database's
  // refusals are translated, and an ambiguous write says it may have happened.
  test('field errors from the planner, and translated database refusals', async () => {
    const invalid = await post('/v1/forms/customer/records/create', { answers: { ...NEW, name: 'x'.repeat(201) } })
    expect(invalid.statusCode).toBe(422)
    expect(invalid.json().fieldErrors).toEqual([expect.objectContaining({ field: 'name' })])
    writeOutcome = { ok: false, code: 'unique-violation', column: 'customer_no', message: 'duplicate key value is (8)' }
    const duplicate = await post('/v1/forms/customer/records/create', { answers: NEW })
    expect(duplicate.statusCode).toBe(422)
    expect(duplicate.json()).toEqual({ code: 'unique-violation', message: 'Another record already has this value.', fieldErrors: [{ field: 'customer_no', code: 'unique-violation', message: 'Another record already has this value.' }] })
    expect(duplicate.body).not.toContain('(8)')
    writeOutcome = { ok: false, code: 'unknown-outcome', message: 'ECONNRESET after commit' }
    const unknown = await post('/v1/forms/customer/records/create', { answers: NEW })
    expect(unknown.statusCode).toBe(502)
    expect(unknown.json().message).toMatch(/may have been saved/)
  })

  // An update echoes every read-only field as it was read. Unchanged, the echo
  // is removed; changed, it is over-posting. A stale version is 409.
  test('updates: an unchanged read-only echo is removed, a changed one refused, a stale version is 409', async () => {
    const current = { tenant_id: 1, customer_no: 7, name: 'Neuer Name', country: 'k1:CH', created_at: '2026-10-08T00:00:00Z' }
    const saved = await post('/v1/forms/customer/records/update', { record: RECORD, version: VERSION, answers: current })
    expect(saved.statusCode).toBe(200)
    expect(calls.updates[0]?.set.map((entry) => entry.name)).toContain('name')
    expect(calls.updates[0]?.set.map((entry) => entry.name)).not.toContain('created_at')
    const tampered = await post('/v1/forms/customer/records/update', { record: RECORD, version: VERSION, answers: { ...current, created_at: '2020-01-01T00:00:00Z' } })
    expect(tampered.statusCode).toBe(403)
    expect(calls.updates).toHaveLength(1)
    writeOutcome = { ok: false, code: 'stale', message: 'changed' }
    expect((await post('/v1/forms/customer/records/update', { record: RECORD, version: VERSION, answers: current })).statusCode).toBe(409)
    expect((await post('/v1/forms/customer/records/update', { record: RECORD, answers: current })).statusCode).toBe(400)
  })

  // Every way the database can be out of reach answers the same, says nothing
  // about hosts, and writes nothing: a lookup that throws, a connection that
  // will not open, and a form published against a connection the operator has
  // since removed from the allowlist — that last one is the server's
  // configuration, not the person's, so it is 500.
  test('a database out of reach is 503 with no detail; a removed connection is 500', async () => {
    const store = createFileConfigurationStore(root)
    const failing: ConnectionRegistry = {
      ...registry(),
      open: async () => {
        const open = await registry().open('erp')
        if (open === undefined) throw new Error('unreachable')
        return { ...open, lookups: { ...open.lookups, search: async () => { throw new Error('timeout on 10.0.0.5') }, resolve: async () => { throw new Error('timeout on 10.0.0.5') } } }
      },
    }
    const broken = await createDataServer({ verifyIdentity, runtime: { registry: failing, store } })
    const source = 'erp-sales-customer-fk-customer-country'
    for (const url of [`/v1/forms/customer/lookups/${source}/query`, `/v1/forms/customer/lookups/${source}/resolve`]) {
      const response = await broken.inject({ method: 'POST', url, headers: as('clerk'), payload: { operation: 'create', tokens: ['k1:CH'] } })
      expect(response.statusCode, url).toBe(503)
      expect(response.body).not.toContain('10.0.0.5')
    }
    const unreachable = await createDataServer({ verifyIdentity, runtime: { registry: { ...registry(), open: async () => { throw new Error('ECONNREFUSED 10.0.0.5') } }, store } })
    const down = await unreachable.inject({ method: 'POST', url: '/v1/forms/customer/records/read', headers: as('clerk'), payload: { record: RECORD } })
    expect(down.statusCode).toBe(503)
    expect(down.body).not.toContain('10.0.0.5')
    const removed = await createDataServer({ verifyIdentity, runtime: { registry: { ...registry(), open: async () => undefined }, store } })
    expect((await removed.inject({ method: 'POST', url: '/v1/forms/customer/records/read', headers: as('clerk'), payload: { record: RECORD } })).statusCode).toBe(500)
  })

  // A lookup is found by the option-source name the form document carries,
  // under the policy for the operation the form is open for.
  test('lookups: search and resolve through the policy, and refuse what they cannot honour', async () => {
    const source = (await app.inject({ method: 'GET', url: '/v1/forms/customer', headers: as('clerk') })).json().form.model.fields.find((field: { key: string }) => field.key === 'country').optionsSource
    const search = await post(`/v1/forms/customer/lookups/${String(source)}/query`, { operation: 'create', search: 'Sw' })
    expect(search.statusCode).toBe(200)
    expect(search.json()).toEqual({ rows: [{ token: 'k1:CH', label: 'Switzerland' }], hasMore: false, omitted: 0 })
    expect((await post(`/v1/forms/customer/lookups/${String(source)}/resolve`, { operation: 'update', tokens: ['k1:CH'] })).json()).toEqual({ rows: [{ token: 'k1:CH', label: 'Switzerland' }] })
    expect((await post(`/v1/forms/customer/lookups/${String(source)}/query`, { search: 'Sw' })).statusCode).toBe(400)
    expect((await post('/v1/forms/customer/lookups/nope/query', { operation: 'create' })).statusCode).toBe(404)
    expect((await post(`/v1/forms/customer/lookups/${String(source)}/resolve`, { operation: 'create', tokens: Array.from({ length: 101 }, () => 'k1:CH') })).statusCode).toBe(400)
    expect((await post(`/v1/forms/customer/lookups/${String(source)}/query`, { operation: 'create' }, 'stranger')).statusCode).toBe(403)
  })

  // The route scoped nothing: it passed the policy's text to the adapter, so
  // a tenant of '042' — which a record request refuses, because each engine
  // would convert it to 42 — listed tenant 42's countries (0028). Scoped
  // with scopeRowFilters like a record request, it is refused the same way,
  // before a connection is opened and with the adapter never asked.
  test('lookups: a trusted value not spelled as its column holds it is refused before the adapter is asked', async () => {
    const source = 'erp-sales-customer-fk-customer-country'
    expect((await post(`/v1/forms/scoped/lookups/${source}/query`, { operation: 'create', search: '' })).statusCode).toBe(200)
    expect(calls.lookups).toBe(1)
    for (const route of ['query', 'resolve']) {
      const response = await post(`/v1/forms/scoped/lookups/${source}/${route}`, { operation: 'create', search: '', tokens: ['k1:CH'] }, 'clerk-042')
      expect(response.statusCode, route).toBe(403)
      expect(response.json(), route).toMatchObject({ code: 'invalid-context' })
    }
    expect(calls.lookups).toBe(1)
  })

  // A refusal the port has no code for — a trigger's own error, a write the
  // database declined — will be refused again, so the person is told not to
  // retry; only `unavailable` says the database could not answer now (0028).
  test('a refused write is 422 and says it will be refused again; unavailable stays 503', async () => {
    writeOutcome = { ok: false, code: 'refused', message: 'trigger tr_customer raised 51701' }
    const refused = await post('/v1/forms/customer/records/create', { answers: NEW })
    expect(refused.statusCode).toBe(422)
    expect(refused.json()).toEqual({ code: 'refused', message: 'The database refused this request, and nothing was saved. Sending it again will be refused the same way.' })
    expect(refused.body).not.toContain('51701')
    writeOutcome = { ok: false, code: 'refused', column: 'name', message: 'trigger tr_customer refused name' }
    expect((await post('/v1/forms/customer/records/create', { answers: NEW })).json().fieldErrors).toEqual([expect.objectContaining({ field: 'name', code: 'refused' })])
    writeOutcome = { ok: false, code: 'unavailable', message: 'deadlock victim' }
    const unavailable = await post('/v1/forms/customer/records/create', { answers: NEW })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json()).toEqual({ code: 'unavailable', message: 'The database could not complete this now. Nothing was saved.' })
  })
})

describe('a write whose answer was lost (0031)', () => {
  const LOST: RecordOutcome = { ok: false, code: 'unknown-outcome', message: 'write CONNECTION_CLOSED 10.0.0.5:5432' }

  // The customer's key is the tenant, pinned from the context, and a number
  // the clerk typed: the 502 names the record the create would have made, so
  // the host can read it before offering to enter it again. And the adapter
  // was asked once: a route that tried again would make the second copy this
  // answer exists to prevent.
  test('a create names the record it would have made, and is sent to the database once', async () => {
    writeOutcome = LOST
    const response = await post('/v1/forms/customer/records/create', { answers: NEW })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({
      code: 'unknown-outcome',
      message: 'The connection to the database failed after the record was sent. It may have been saved: read it before entering it again.',
      operation: 'create',
      record: 'k1:1,8',
      version: null,
    })
    expect(calls.inserts).toHaveLength(1)
    expect(response.body).not.toContain('10.0.0.5')
  })

  // A key the database numbers is not in the insert, so nothing here can say
  // which record it would be: null, and a sentence that says only the
  // person's own search can tell -- never a token for a row that may not exist.
  test('a create whose key the database numbers names no record, and says why', async () => {
    writeOutcome = LOST
    const response = await post('/v1/forms/country/records/create', { answers: { id: null, iso_code: 'CH', name: 'Schweiz' } })
    expect(response.statusCode, response.body).toBe(502)
    expect(response.json()).toEqual({
      code: 'unknown-outcome',
      message: 'The connection to the database failed after the record was sent. It may have been saved, and the database numbers new records, so only a search of your own can tell.',
      operation: 'create',
      record: null,
      version: null,
    })
    expect(calls.inserts).toHaveLength(1)
  })

  // An update carries its own protection: the version sent is in the one
  // guarded statement (0015), so saving again with exactly it is stored at
  // most once. The 502 hands both back for the host to reconcile with.
  test('an update names the record and the version it sent, and is sent to the database once', async () => {
    writeOutcome = LOST
    const answers = { tenant_id: 1, customer_no: 7, name: 'Neuer Name', country: 'k1:CH', created_at: '2026-10-08T00:00:00Z' }
    const response = await post('/v1/forms/customer/records/update', { record: RECORD, version: VERSION, answers })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({
      code: 'unknown-outcome',
      message: 'The connection to the database failed after the change was sent. It may have been saved. Saving again with the same version is safe: it is stored at most once.',
      operation: 'update',
      record: RECORD,
      version: VERSION,
    })
    expect(calls.updates).toHaveLength(1)
  })

  // Only a write can have an unknown outcome. A read that reported one would
  // be an adapter's bug; answered as a 502 "may have been saved", it would
  // tell a person something was saved when nothing was asked to be.
  test('a read that reports an unknown outcome is a server error, not a 502', async () => {
    readOutcome = LOST
    const response = await post('/v1/forms/customer/records/read', { record: RECORD })
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('may have been saved')
  })
})

describe('a write sent again (0031)', () => {
  const ID = '0123456789abcdef0123456789abcdef'
  const sending = (url: string, payload: unknown, id: string = ID) =>
    app.inject({ method: 'POST', url, headers: { ...as('clerk'), 'formancy-write-id': id }, payload: payload as Record<string, unknown> })
  const UPDATE = { record: RECORD, version: VERSION, answers: { tenant_id: 1, customer_no: 7, name: 'Neuer Name', country: 'k1:CH', created_at: '2026-10-08T00:00:00Z' } }

  // Chromium resends a request whose reused connection closed before any
  // answer, on its own, below the page (measured, 0031). Arriving with the
  // same write id, it is answered with what the first sending got, and the
  // database is asked once: without this, a create whose answer the network
  // lost after the commit is stored twice behind one "Created".
  test('a create that arrives again with its write id is answered with the first answer, and stored once', async () => {
    const first = await sending('/v1/forms/customer/records/create', { answers: NEW })
    const again = await sending('/v1/forms/customer/records/create', { answers: NEW })
    expect([first.statusCode, again.statusCode]).toEqual([201, 201])
    expect(again.json()).toEqual(first.json())
    expect(calls.inserts).toHaveLength(1)
  })

  // The resend can arrive while the first sending still waits on the
  // database -- a connection reset during a lock wait. It waits for that
  // answer rather than racing it to a second row.
  test('a sending that arrives while the first is in flight waits for its answer', async () => {
    let release = (): void => {}
    insertGate = new Promise<void>((resolve) => (release = resolve))
    const first = sending('/v1/forms/customer/records/create', { answers: NEW })
    const again = sending('/v1/forms/customer/records/create', { answers: NEW })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.inserts).toHaveLength(1)
    release()
    const answers = await Promise.all([first, again])
    expect(answers.map((answer) => answer.statusCode)).toEqual([201, 201])
    expect(answers[1]?.json()).toEqual(answers[0]?.json())
    expect(calls.inserts).toHaveLength(1)
  })

  // A first sending whose answer the database lost is repeated as that: the
  // resend is not the moment to find out, by writing again.
  test('an unknown outcome is answered again as unknown, and the database is asked once', async () => {
    writeOutcome = { ok: false, code: 'unknown-outcome', message: 'CONNECTION_CLOSED' }
    const first = await sending('/v1/forms/customer/records/create', { answers: NEW })
    const again = await sending('/v1/forms/customer/records/create', { answers: NEW })
    expect([first.statusCode, again.statusCode]).toEqual([502, 502])
    expect(again.json()).toEqual(first.json())
    expect(calls.inserts).toHaveLength(1)
  })

  // An update is protected by its version already, but its resend would be
  // answered 409 "the record changed" -- changed by itself. The first answer
  // is the true one.
  test('an update that arrives again is answered with the first answer, and sent once', async () => {
    const first = await sending('/v1/forms/customer/records/update', UPDATE)
    const again = await sending('/v1/forms/customer/records/update', UPDATE)
    expect([first.statusCode, again.statusCode]).toEqual([200, 200])
    expect(again.json()).toEqual(first.json())
    expect(calls.updates).toHaveLength(1)
  })

  // The id names one sending of one write, by one person, to one form: the
  // same id elsewhere is another write. A request without one is a write of
  // its own every time, as before.
  test('another form, or no write id, is another write', async () => {
    await sending('/v1/forms/customer/records/create', { answers: NEW })
    await sending('/v1/forms/scoped/records/create', { answers: NEW })
    await post('/v1/forms/customer/records/create', { answers: NEW })
    await post('/v1/forms/customer/records/create', { answers: NEW })
    expect(calls.inserts).toHaveLength(4)
  })

  // An id that comes back with a different write is a client's bug or
  // somebody's guess: answering it with the first write's answer would say
  // "Created" about something never sent. Refused, and nothing is asked.
  test('the same write id with a different write is refused, and nothing is sent', async () => {
    await sending('/v1/forms/customer/records/create', { answers: NEW })
    const other = await sending('/v1/forms/customer/records/create', { answers: { ...NEW, customer_no: 9 } })
    expect(other.statusCode).toBe(400)
    expect(other.json()).toMatchObject({ code: 'invalid-request' })
    expect(calls.inserts).toHaveLength(1)
  })

  // An id that is not one is refused before anything is read or written,
  // rather than ignored, which would quietly switch the guard off.
  test('a write id that is not one is refused before anything is asked', async () => {
    for (const id of ['', 'short', 'x'.repeat(65), 'has space in it 0123456789abcdef']) {
      const response = await sending('/v1/forms/customer/records/create', { answers: NEW }, id)
      expect({ id, status: response.statusCode }).toEqual({ id, status: 400 })
    }
    expect(calls.inserts).toHaveLength(0)
    expect(calls.rejects).toHaveLength(0)
  })
})

describe('the operational audit trail', () => {
  const KEY = 'an-audit-key-the-operator-keeps-secret'

  // A key of null means none at all: undefined would bring the default back.
  async function audited(sink: (event: AuditEvent) => void, key: string | null = KEY) {
    const store = createFileConfigurationStore(root)
    return createDataServer({ verifyIdentity, runtime: { registry: registry(), store, audit: { sink, ...(key === null ? {} : { key }), now: () => '2026-10-09T12:00:00.000Z' } } })
  }

  // One event per request, with what happened and against which version — and
  // nothing the person typed. An audit log holding answers would be a second
  // copy of the customer's data with none of its permissions.
  test('records who did what to which version, and never a value', async () => {
    const events: AuditEvent[] = []
    const server = await audited((event) => events.push(event))
    const response = await server.inject({ method: 'POST', url: '/v1/forms/customer/records/create', headers: as('clerk'), payload: { answers: NEW } })
    expect(response.statusCode).toBe(201)
    expect(events).toEqual([
      { at: '2026-10-09T12:00:00.000Z', actor: 'c', operation: 'create', form: 'customer', formVersion: 1, status: 201, outcome: 'ok', record: recordReference(KEY, 'k1:1,7') },
    ])
    expect(JSON.stringify(events)).not.toContain('Neu GmbH')
    expect(JSON.stringify(events)).not.toContain('k1:')
  })

  // An unknown create names the record it would have made, by the same keyed
  // hash as everything else: an operator reconciling the trail can match it
  // to the read that settles it. Without it the event says only "a create
  // went wrong", about no record.
  test('records an unknown create with the record it would have made', async () => {
    const events: AuditEvent[] = []
    const server = await audited((event) => events.push(event))
    writeOutcome = { ok: false, code: 'unknown-outcome', message: 'ECONNRESET' }
    await server.inject({ method: 'POST', url: '/v1/forms/customer/records/create', headers: as('clerk'), payload: { answers: NEW } })
    expect(events.map(({ status, outcome, record }) => ({ status, outcome, record }))).toEqual([
      { status: 502, outcome: 'unknown-outcome', record: recordReference(KEY, 'k1:1,8') },
    ])
  })

  // A sending answered with an earlier one's answer asked nothing of the
  // database: the trail says so, rather than a second "ok" create that an
  // operator would count as a second record.
  test('records a write that arrived again as repeated', async () => {
    const events: AuditEvent[] = []
    const server = await audited((event) => events.push(event))
    for (let n = 0; n < 2; n += 1) {
      await server.inject({ method: 'POST', url: '/v1/forms/customer/records/create', headers: { ...as('clerk'), 'formancy-write-id': '0123456789abcdef0123456789abcdef' }, payload: { answers: NEW } })
    }
    expect(events.map(({ status, outcome, record }) => ({ status, outcome, record }))).toEqual([
      { status: 201, outcome: 'ok', record: recordReference(KEY, 'k1:1,7') },
      { status: 201, outcome: 'repeated', record: recordReference(KEY, 'k1:1,7') },
    ])
  })

  // Refusals are audited too, by the stable code the response carried, and a
  // request that never authenticated is recorded with no actor.
  test('records refusals by their code, and an unauthenticated request with no actor', async () => {
    const events: AuditEvent[] = []
    const server = await audited((event) => events.push(event))
    await server.inject({ method: 'POST', url: '/v1/forms/customer/records/create', headers: as('clerk'), payload: { answers: { ...NEW, tenant_id: 2 } } })
    await server.inject({ method: 'POST', url: '/v1/forms/customer/records/read', payload: { record: RECORD } })
    await server.inject({ method: 'POST', url: '/v1/forms/nope/records/read', headers: as('clerk'), payload: { record: RECORD } })
    expect(events.map(({ actor, operation, status, outcome, formVersion }) => ({ actor, operation, status, outcome, formVersion }))).toEqual([
      { actor: 'c', operation: 'create', status: 403, outcome: 'over-posting', formVersion: 1 },
      { actor: null, operation: 'read', status: 401, outcome: 'unauthenticated', formVersion: null },
      { actor: 'c', operation: 'read', status: 404, outcome: 'unknown-form', formVersion: null },
    ])
  })

  // The outcome is the body's code, so a refusal is audited as refused and
  // not as the database being down — the two ask an operator different things.
  test('records a refused write as refused', async () => {
    const events: AuditEvent[] = []
    const server = await audited((event) => events.push(event))
    writeOutcome = { ok: false, code: 'refused', message: 'trigger' }
    await server.inject({ method: 'POST', url: '/v1/forms/customer/records/create', headers: as('clerk'), payload: { answers: NEW } })
    expect(events.map(({ status, outcome }) => ({ status, outcome }))).toEqual([{ status: 422, outcome: 'refused' }])
  })

  // A record token spells its key, and a key is often small. Without a key to
  // hash with, nothing is recorded rather than a reference that only looks redacted.
  test('names a record only by a keyed hash, and not at all without a key', async () => {
    const events: AuditEvent[] = []
    const server = await audited((event) => events.push(event), null)
    await server.inject({ method: 'POST', url: '/v1/forms/customer/records/read', headers: as('clerk'), payload: { record: RECORD } })
    expect(events[0]?.record).toBeNull()
    expect(recordReference(KEY, RECORD)).toMatch(/^[0-9a-f]{32}$/)
    expect(recordReference(KEY, RECORD)).not.toBe(recordReference('another-key', RECORD))
  })

  // By the time the event exists the write has committed or not; refusing to
  // answer because the trail failed would only hide which.
  test('a sink that fails does not fail the request', async () => {
    const server = await audited(() => {
      throw new Error('disk full')
    })
    expect((await server.inject({ method: 'POST', url: '/v1/forms/customer/records/read', headers: as('clerk'), payload: { record: RECORD } })).statusCode).toBe(200)
  })
})
