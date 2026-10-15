import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot, describedOf, generateForm } from '@formancy/data-core'
import type { ColumnMeta, DatabaseAdapter, FormPolicy, LookupAdapter, LookupSignal, NormalizedType, ObjectRef, RecordAdapter } from '@formancy/data-core'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { RuntimeAuditEvent } from '../audit.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry } from '../connections.js'
import type { IdentityVerifier } from '../identity.js'

/*
 * What the lookup routes decide around the adapter (0061), over fake ports
 * that keep the port's contract: a statement that "runs" until its signal
 * aborts, then rejects with exactly the signal's reason. What a database does
 * with a cancel is each adapter's suite, and the whole path the server's
 * lookup-limits suite, both against real servers (0003); here it is which
 * signal the route hands the port, and how each way a lookup ends is answered.
 */
const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 100, lengthUnit: 'utf16-code-units', fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true },
})
const ref = (name: string) => ({ schema: 'sales', name })
const SNAPSHOT = createSnapshot({
  kind: 'sqlserver', serverVersion: '16.0', account: { user: 'dbo', login: 'sa' }, scope: { schemas: ['sales'] }, gaps: [],
  objects: [
    { ref: ref('country'), kind: 'table', comment: null, columns: [col('code', 1, TEXT), col('name', 2, TEXT)], primaryKey: { name: 'pk_country', columns: ['code'] }, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none' },
    {
      ref: ref('customer'), kind: 'table', comment: null, columns: [col('id', 1, INT32), col('country_code', 2, TEXT)],
      primaryKey: { name: 'pk_customer', columns: ['id'] }, uniqueKeys: [],
      foreignKeys: [{ name: 'fk_customer_country', columns: ['country_code'], references: { table: ref('country'), columns: ['code'] }, onUpdate: 'no-action', onDelete: 'no-action', enforced: true, validated: true }],
      checks: [], rowSecurity: 'none',
    },
  ],
})
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: [] },
  fields: { id: { read: ['clerk'], write: ['clerk'] }, country: { read: ['clerk'], write: ['clerk'] } },
  rowFilters: [],
  lookups: { country: [] },
}
const verifyIdentity: IdentityVerifier = async (token) => (token === 'clerk' ? { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: {} } } : { ok: false, reason: 'bad' })

/** How long the fake registry takes to open the connection: a cold login and its ping. */
let opening: number
/** How the fake lookup port behaves in a case: answer at once, wait for its signal, or fail with its own error. */
let behaviour: 'answer' | 'wait' | 'fail-translated'
/** Every signal the port was handed, in order. */
let signals: LookupSignal[]
let inserts: number
let events: RuntimeAuditEvent[]
let logs: Array<{ msg?: string; deadlineMs?: number }>
let root: string
let store: ConfigurationStore
let source: string
const apps: FastifyInstance[] = []

/** A statement that runs until its signal aborts, then rejects with the reason -- or, for `fail-translated`, with an error of its own, as an adapter that wrapped the reason would. */
function run<T>(signal: LookupSignal, answer: T): Promise<T> {
  signals.push(signal)
  if (behaviour === 'answer') return Promise.resolve(answer)
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(behaviour === 'wait' ? signal.reason : new Error('the database was told to stop')), { once: true })
  })
}

function registry(): ConnectionRegistry {
  const lookups: LookupAdapter = {
    search: (_config, _query, _filters, signal) => run(signal, { rows: [{ token: 'k1:CH', label: 'Switzerland' }], hasMore: false, omitted: 0 }),
    resolve: (_config, tokens, _filters, signal) => run(signal, tokens.map((token) => ({ token, label: 'Switzerland' }))),
    rejects: (_config, _tokens, _filters, signal) => run(signal, []),
  }
  const records = {
    describe: async (table: ObjectRef) => ({ ok: true, described: { ...(describedOf(SNAPSHOT, table) as NonNullable<ReturnType<typeof describedOf>>), definition: 'd' } }),
    insert: async () => {
      inserts += 1
      return { ok: true, values: { id: '1', country_code: 'CH' }, version: null }
    },
  } as unknown as RecordAdapter
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: '16.0' }), discover: async () => SNAPSHOT, close: async () => {} } as DatabaseAdapter
  return {
    ids: () => ['erp'],
    scope: () => ({ schemas: ['sales'] }),
    open: async () => {
      if (opening > 0) await new Promise((resolve) => setTimeout(resolve, opening))
      return { adapter, lookups, records }
    },
    close: async () => {},
  }
}

/** A server over the fake ports with this deadline, listening on loopback, its trail and its log kept. */
async function serve(lookupDeadlineMs?: number): Promise<string> {
  const app = await createDataServer({
    verifyIdentity,
    logger: { stream: { write: (line) => void logs.push(JSON.parse(line) as { msg?: string }) } },
    runtime: { registry: registry(), store, audit: { sink: (event) => void events.push(event as RuntimeAuditEvent) }, ...(lookupDeadlineMs === undefined ? {} : { lookupDeadlineMs }) },
  })
  apps.push(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  return `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`
}

async function post(base: string, path: string, body: unknown, signal?: AbortSignal): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { authorization: 'Bearer clerk', 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal === undefined ? {} : { signal }) })
  return { status: response.status, json: (await response.json()) as unknown }
}

beforeEach(async () => {
  behaviour = 'answer'
  opening = 0
  signals = []
  inserts = 0
  events = []
  logs = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-lookups-'))
  store = createFileConfigurationStore(root)
  const { form, bindings } = generateForm(SNAPSHOT, { connection: 'erp', root: ref('customer'), formId: 'customer', title: 'Customer', lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }] })
  const lookup = bindings.fields.find((binding) => binding.kind === 'lookup')
  if (lookup?.kind !== 'lookup') throw new Error('the customer form has no lookup')
  source = encodeURIComponent(lookup.source)
  await store.publish('customer', null, { format: 1, connection: 'erp', form, bindings, policy: POLICY, snapshot: SNAPSHOT })
})

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  await rm(root, { recursive: true, force: true })
})

describe('the lookup routes', () => {
  // A limit must not change what a completed lookup answers (0012, 0028):
  // the page goes back as the port gave it, and the signal it was handed
  // never aborted -- a route that aborted it after every answer would make
  // the adapter cancel statements that had already finished.
  test('answer a lookup that completes exactly as the port answered, its signal never aborted', async () => {
    const base = await serve(10_000)
    expect(await post(base, `/v1/forms/customer/lookups/${source}/query`, { operation: 'create', search: 'Sw' })).toEqual({ status: 200, json: { rows: [{ token: 'k1:CH', label: 'Switzerland' }], hasMore: false, omitted: 0 } })
    expect(await post(base, `/v1/forms/customer/lookups/${source}/resolve`, { operation: 'create', tokens: ['k1:CH'] })).toEqual({ status: 200, json: { rows: [{ token: 'k1:CH', label: 'Switzerland' }] } })
    expect(signals.map((signal) => signal.aborted)).toEqual([false, false])
  })

  // Past the deadline the port is told to stop, and the person is told that
  // the same search takes as long again: `unavailable` would invite a retry
  // that reads the same rows (0028). A route that did not hand the port a
  // signal that fires would wait for the database for ever.
  test('answer a search past the deadline 503 lookup-timeout, and say so in the log', async () => {
    behaviour = 'wait'
    const base = await serve(50)
    expect(await post(base, `/v1/forms/customer/lookups/${source}/query`, { operation: 'create', search: 'Sw' })).toEqual({
      status: 503,
      json: { code: 'lookup-timeout', message: 'The search took longer than this server allows (50 ms), and the database was told to stop it. The same search will take as long again.' },
    })
    expect(signals.map((signal) => (signal.reason as Error).name)).toEqual(['TimeoutError'])
    expect(logs.filter((line) => line.msg?.includes('passed its deadline') === true)).toEqual([expect.objectContaining({ lookup: 'search', deadlineMs: 50 })])
  })

  // A resolve reads by key, at most a row a token, so one past the deadline
  // waited -- on a lock, on the pool -- rather than read too much, and trying
  // again usually helps. `lookup-timeout` says the opposite, and a code says
  // whether to try again the same way every time (0028); so a resolve is
  // `unavailable`, which invites the retry, and only the log names the
  // deadline (2026-10-15 review).
  test('answer a resolve past the deadline 503 unavailable, and name the deadline in the log', async () => {
    behaviour = 'wait'
    const base = await serve(50)
    expect(await post(base, `/v1/forms/customer/lookups/${source}/resolve`, { operation: 'create', tokens: ['k1:CH'] })).toEqual({ status: 503, json: { code: 'unavailable', message: 'The selected options could not be loaded.' } })
    expect(signals.map((signal) => (signal.reason as Error).name)).toEqual(['TimeoutError'])
    expect(logs.filter((line) => line.msg?.includes('passed its deadline') === true)).toEqual([expect.objectContaining({ lookup: 'resolve', deadlineMs: 50 })])
  })

  // The deadline bounds the statement, so it starts when the adapter is
  // asked: a wait for a pooled connection, inside the driver, counts, and
  // reading the form and opening its connection do not. Started at the
  // route, a first search on a connection whose login took longer than the
  // deadline was answered "the database was told to stop it; the same search
  // will take as long again" with no statement sent, and the same search a
  // moment later answered (2026-10-15 review).
  test('count the deadline from the adapter call, not from opening the connection', async () => {
    opening = 150
    const base = await serve(50)
    expect(await post(base, `/v1/forms/customer/lookups/${source}/query`, { operation: 'create', search: 'Sw' })).toEqual({ status: 200, json: { rows: [{ token: 'k1:CH', label: 'Switzerland' }], hasMore: false, omitted: 0 } })
    expect(signals.map((signal) => signal.aborted)).toEqual([false])
  })

  // The route tells its own abort from a database failure by identity, and
  // nothing else: an adapter that wrapped or translated the reason has
  // failed, and is answered as any failure is, never as a timeout it cannot
  // prove.
  test('answer a port that rejects with anything but the reason itself 503 unavailable', async () => {
    behaviour = 'fail-translated'
    const base = await serve(50)
    expect(await post(base, `/v1/forms/customer/lookups/${source}/query`, { operation: 'create', search: 'Sw' })).toEqual({ status: 503, json: { code: 'unavailable', message: 'The options could not be loaded.' } })
  })

  // The browser's abort is what 0061 carries to the database. The port's
  // signal aborts with an AbortError, not the deadline's TimeoutError, and
  // the trail's one event for the request says the client left: 499
  // `abandoned`, written to a response nobody reads (0023).
  test('abort the port when the client leaves, and audit the request as abandoned', async () => {
    behaviour = 'wait'
    const base = await serve(60_000)
    const controller = new AbortController()
    const sent = post(base, `/v1/forms/customer/lookups/${source}/query`, { operation: 'create', search: 'Sw' }, controller.signal)
    while (signals.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()
    await expect(sent).rejects.toThrow()
    while (events.length === 0) await new Promise((resolve) => setTimeout(resolve, 5))
    expect((signals[0]?.reason as Error).name).toBe('AbortError')
    expect(events).toEqual([expect.objectContaining({ operation: 'lookup-query', status: 499, outcome: 'abandoned' })])
  })

  // A membership check inside a create has the deadline (0061) and no
  // abandonment, since a write goes on after its client leaves (0031). Past
  // the deadline the answer is every failed check's, nothing saved, and only
  // the log says why.
  test('refuse a create whose membership check passes the deadline, unchanged, with nothing inserted', async () => {
    behaviour = 'wait'
    const base = await serve(50)
    expect(await post(base, '/v1/forms/customer/records/create', { answers: { id: 1, country: 'k1:CH' } })).toEqual({ status: 503, json: { code: 'unavailable', message: 'A selection could not be checked. Nothing was saved.' } })
    expect(inserts).toBe(0)
    expect(logs.filter((line) => line.msg?.includes('passed its deadline') === true)).toEqual([expect.objectContaining({ deadlineMs: 50 })])
  })
})
