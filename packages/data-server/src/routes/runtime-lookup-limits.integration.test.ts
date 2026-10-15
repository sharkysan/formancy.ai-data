import { createSecretKey } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION, MAX_LOOKUP_DEADLINE_MS } from '@formancy/data-core'
import type { FieldBinding, FormPolicy, ObjectRef } from '@formancy/data-core'
import { blockTable, startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { BlockedTable, PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import type { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { RuntimeAuditEvent } from '../audit.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry } from '../connections.js'
import { DRIVER_FACTORIES, POSTGRES_LOOKUPS_APPLICATION } from '../drivers.js'
import { createIdentityVerifier } from '../identity.js'

/*
 * A lookup statement stops when its request is abandoned or its deadline
 * passes (0061), over real HTTP, through the real drivers, on real
 * PostgreSQL 17 and SQL Server 2022 (0003). The statement is made to wait
 * in the database behind a table its owner holds locked (`blockTable`), so
 * "the database finished the scan for nobody" is visible as a statement
 * still waiting, and "the database was told to stop it" as one that stopped
 * waiting while the lock was still held.
 *
 * Two servers over one registry and store: one whose deadline is the longest
 * a timer holds, so only the client's leaving stops a statement, and one
 * with a short deadline of this suite's choosing -- long enough for the
 * statement to be seen waiting, short beside the suite's timeouts. Neither is
 * a product number; the product's default is derived (0061) and held by
 * data-performance's deadline.test.ts.
 */

const SECRET = 'a-lookup-limits-host-secret-of-32-bytes!'
const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'
/** The short server's deadline, chosen for this suite: see above. */
const SHORT_DEADLINE_MS = 1_500

const CUSTOMER: ObjectRef = { schema: 'sales', name: 'customer' }
const ORDER: ObjectRef = { schema: 'sales', name: 'order' }

async function token(subject: string, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ sub: subject, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('30m')
    .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
}

/** A clerk may do everything the form offers inside their tenant; the client suites' policy. */
function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
  }
}

let pg: PostgresFixture
let ms: SqlServerFixture
let root: string
let registry: ConnectionRegistry
let patient: FastifyInstance
let short: FastifyInstance
const bases = { patient: '', short: '' }
let admin: string
let clerk: string
const events: RuntimeAuditEvent[] = []
/** The short server's log lines, parsed. */
const logs: Array<{ msg?: string; deadlineMs?: number }> = []
/** Each order form's customer source, as its published bindings name it: the name carries the connection's. */
const sources: Record<string, string> = {}

async function listening(app: FastifyInstance): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 })
  return `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`
}

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
  const pgUrl = new URL(pg.admin)
  const connections: ConnectionConfig[] = [
    { id: 'pg', kind: 'postgres', host: pgUrl.hostname, port: Number(pgUrl.port), database: pgUrl.pathname.slice(1), user: decodeURIComponent(pgUrl.username), password: 'env:PG_PASSWORD', schemas: ['sales'], tls: { enabled: false } },
    { id: 'ms', kind: 'sqlserver', host: String(ms.admin.server), port: Number(ms.admin.port), database: String(ms.admin.database), user: String(ms.admin.user), password: 'env:MS_PASSWORD', schemas: ['sales'], tls: { enabled: false, trustServerCertificate: true } },
  ]
  registry = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: { PG_PASSWORD: decodeURIComponent(pgUrl.password), MS_PASSWORD: String(ms.admin.password) },
    readFile: async () => '',
  })
  root = await mkdtemp(join(tmpdir(), 'formancy-data-lookup-limits-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: 'tid' } })
  const audit = { sink: (event: unknown) => void events.push(event as RuntimeAuditEvent) }
  patient = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store, audit, lookupDeadlineMs: MAX_LOOKUP_DEADLINE_MS } })
  short = await createDataServer({ verifyIdentity, logger: { stream: { write: (line) => void logs.push(JSON.parse(line) as { msg?: string }) } }, runtime: { registry, store, audit, lookupDeadlineMs: SHORT_DEADLINE_MS } })
  bases.patient = await listening(patient)
  bases.short = await listening(short)
  admin = await token('admin-1', { roles: ['data-admin'] })
  clerk = await token('clerk-1', { roles: ['clerk'], tid: 1 })
  for (const connection of ['pg', 'ms']) {
    const formId = `${connection}-order`
    const proposed = await call('patient', `/v1/form-proposals`, { connection, root: ORDER, formId, title: 'Order', lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }], ...(connection === 'pg' ? { versionColumn: 'row_version' } : {}) }, admin)
    const { form, bindings, snapshot, generation } = proposed.json as Record<string, unknown>
    const fields = (bindings as { fields: FieldBinding[] }).fields
    const policy = clerkPolicy(fields)
    const lookup = fields.find((binding) => binding.kind === 'lookup')
    if (lookup?.kind !== 'lookup') throw new Error(`${formId} has no lookup`)
    sources[connection] = lookup.source
    const publishedAnswer = await call('patient', `/v1/forms/${formId}/versions`, { expectedBase: null, bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot } }, admin)
    if (publishedAnswer.status >= 300) throw new Error(`publishing ${formId} answered ${String(publishedAnswer.status)}`)
  }
})

afterAll(async () => {
  await short?.close()
  await patient?.close()
  await registry?.close()
  await Promise.all([pg?.stop(), ms?.stop()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

/** One request to one of the servers, as a host's page sends it; bounded, so a request the server never answers fails here. */
async function call(server: 'patient' | 'short', path: string, body: unknown, bearer = clerk, signal?: AbortSignal): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${bases[server]}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  return { status: response.status, json: text === '' ? null : (JSON.parse(text) as unknown) }
}

/** Polls until `condition` holds, or fails naming what never happened. */
async function until(condition: () => Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const ENGINES = [
  { engine: 'PostgreSQL', connection: 'pg' as const },
  { engine: 'SQL Server', connection: 'ms' as const },
]

function source(connection: 'pg' | 'ms'): string {
  const name = sources[connection]
  if (name === undefined) throw new Error(`${connection}-order was not published`)
  return encodeURIComponent(name)
}

function locked(connection: 'pg' | 'ms', table: ObjectRef): Promise<BlockedTable> {
  return connection === 'pg' ? blockTable({ kind: 'postgres', admin: pg.admin }, table) : blockTable({ kind: 'sqlserver', admin: ms.admin }, table)
}

/** The tenant's first customer, as the warm-up search answers it: proves the form is served and warms its connection. */
async function firstCustomer(connection: 'pg' | 'ms'): Promise<string> {
  const answer = await call('patient', `/v1/forms/${connection}-order/lookups/${source(connection)}/query`, { operation: 'create', search: '' })
  expect(answer.status).toBe(200)
  const rows = (answer.json as { rows: Array<{ token: string }> }).rows
  expect(rows.length).toBeGreaterThan(0)
  return rows[0]?.token ?? ''
}

/** The owner's own PostgreSQL connection, around the server, through the adapter package's driver. */
function pgOwner(): ReturnType<typeof connectPostgres> {
  const url = new URL(pg.admin)
  return connectPostgres({ host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), tls: { enabled: false, rejectUnauthorized: false } })
}

/** How many orders the owner sees, asked around the server. */
async function orders(connection: 'pg' | 'ms'): Promise<number> {
  if (connection === 'pg') {
    const sql = pgOwner()
    try {
      return (await sql<Array<{ n: number }>>`select count(*)::int as n from sales."order"`)[0]?.n ?? -1
    } finally {
      await sql.end({ timeout: 5 })
    }
  }
  const pool = await connectSqlServer({ host: String(ms.admin.server), port: Number(ms.admin.port), database: String(ms.admin.database), user: String(ms.admin.user), password: String(ms.admin.password), encrypt: false, trustServerCertificate: true })
  try {
    return (await pool.request().query<{ n: number }>('select count(*) as n from sales.[order]')).recordset[0]?.n ?? -1
  } finally {
    await pool.close()
  }
}

describe.each(ENGINES)('lookup limits on $engine', ({ connection }) => {
  const form = `${connection}-order`

  // (a) The renderers abort a superseded search's request. Before 0061 the
  // server passed no signal on, and the database finished every scan it had
  // started, for nobody: here the statement would go on waiting until the
  // lock went. Now it is gone while the lock is still held, and the audit
  // trail's event for the request says the client left (0023).
  test('an abandoned search stops its statement, and the trail says abandoned', async () => {
    await firstCustomer(connection)
    events.length = 0
    const blocked = await locked(connection, CUSTOMER)
    try {
      const controller = new AbortController()
      const sent = call('patient', `/v1/forms/${form}/lookups/${source(connection)}/query`, { operation: 'create', search: 'Muster' }, clerk, controller.signal)
      await until(async () => (await blocked.waiting()) === 1, 'the search waited behind the lock')
      controller.abort()
      await expect(sent).rejects.toThrow()
      await until(async () => (await blocked.waiting()) === 0, 'the abandoned search stopped waiting while the lock was held')
      await until(async () => events.some((event) => event.operation === 'lookup-query'), 'the abandoned request was audited')
      expect(events.filter((event) => event.operation === 'lookup-query')).toEqual([expect.objectContaining({ form, status: 499, outcome: 'abandoned' })])
    } finally {
      await blocked.release()
    }
  })

  // (b) A search past the deadline is refused with a code of its own, alike
  // on both engines: `unavailable` would invite a retry, and a contains
  // search that timed out reads the same rows again (0028). A resolve reads
  // by key, so one past the deadline waited -- here on the lock -- and a
  // retry helps: it is `unavailable`, alike on both engines too. Either way
  // the statement is gone, not left running after the refusal.
  test('a search past the deadline is 503 lookup-timeout, a resolve 503 unavailable, and their statements are gone', async () => {
    const customer = await firstCustomer(connection)
    const blocked = await locked(connection, CUSTOMER)
    try {
      for (const [action, body, refusal] of [
        ['query', { operation: 'create', search: 'Muster' }, { code: 'lookup-timeout', message: `The search took longer than this server allows (${String(SHORT_DEADLINE_MS)} ms), and the database was told to stop it. The same search will take as long again.` }],
        ['resolve', { operation: 'update', tokens: [customer] }, { code: 'unavailable', message: 'The selected options could not be loaded.' }],
      ] as const) {
        let seen = 0
        const answer = call('short', `/v1/forms/${form}/lookups/${source(connection)}/${action}`, body)
        const watching = (async () => {
          for (let settled = false; !settled; ) {
            seen = Math.max(seen, await blocked.waiting())
            settled = await Promise.race([answer.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20))])
          }
        })()
        expect(await answer).toEqual({ status: 503, json: refusal })
        await watching
        expect(seen, `the ${action} statement reached the database`).toBe(1)
        await until(async () => (await blocked.waiting()) === 0, `the ${action} statement stopped waiting while the lock was held`, 5_000)
      }
    } finally {
      await blocked.release()
    }
  })

  // (c) A membership check inside a create has the deadline too, and no
  // abandonment: a write goes on after its client leaves (0031). Past the
  // deadline it is refused as every check that cannot answer is, nothing
  // saved -- which is true, and the count says so -- and its statement is gone.
  // The log says the deadline passed: on SQL Server, mssql's default 15 s
  // request timeout would also end in 503 unavailable, later and for another
  // reason, and only the log tells the two apart.
  test('a create whose membership check passes the deadline is 503 unavailable and saves nothing', async () => {
    const customer = await firstCustomer(connection)
    const before = await orders(connection)
    const blocked = await locked(connection, CUSTOMER)
    logs.length = 0
    try {
      const answer = await call('short', `/v1/forms/${form}/records/create`, { answers: { customer, order_date: '2026-10-14', status: 'placed', amount: '5', notes: 'past the deadline' } })
      expect(answer).toEqual({ status: 503, json: { code: 'unavailable', message: 'A selection could not be checked. Nothing was saved.' } })
      expect(logs.filter((line) => line.msg?.includes('passed its deadline') === true)).toEqual([expect.objectContaining({ deadlineMs: SHORT_DEADLINE_MS })])
      await until(async () => (await blocked.waiting()) === 0, 'the membership check stopped waiting while the lock was held', 5_000)
    } finally {
      await blocked.release()
    }
    expect(await orders(connection)).toBe(before)
  })
})

describe('the PostgreSQL lookups client', () => {
  // (d) PostgreSQL delivers a cancel on a connection of its own, and one that
  // arrives after its statement finished stops whatever that backend runs
  // next (0061, probe of 2026-10-14). On one client shared with the records,
  // a lookup's late cancel could stop a record's write. So the lookups run on
  // a client of their own, named for a DBA: while a lookup and a record read
  // both wait, the lookup's backend carries the lookups' name and the read's
  // does not.
  test('runs lookups on a client of its own, which pg_stat_activity names', async () => {
    const customer = await firstCustomer('pg')
    const created = await call('patient', '/v1/forms/pg-order/records/create', { answers: { customer, order_date: '2026-10-14', status: 'placed', amount: '5', notes: 'read while locked' } })
    expect(created.status).toBe(201)
    const record = (created.json as { record: string }).record
    const customers = await locked('pg', CUSTOMER)
    const orderTable = await locked('pg', ORDER)
    const sql = pgOwner()
    let released = false
    try {
      const search = call('patient', `/v1/forms/pg-order/lookups/${source('pg')}/query`, { operation: 'create', search: 'Muster' })
      const read = call('patient', '/v1/forms/pg-order/records/read', { record })
      // Which table each waits for is read from pg_locks, not from the
      // statement's text: pg_stat_activity keeps only its first 1024 bytes,
      // and the read's catalog walk names the order table past them.
      const waiting = async () =>
        (
          await sql<Array<{ application: string; relation: string }>>`
            select a.application_name as application, l.relation::pg_catalog.regclass::pg_catalog.text as relation
            from pg_catalog.pg_locks as l join pg_catalog.pg_stat_activity as a on a.pid = l.pid
            where not l.granted and l.relation is not null and a.datname = pg_catalog.current_database()`
        ).map((row) => ({ lookups: row.application === POSTGRES_LOOKUPS_APPLICATION, relation: row.relation }))
      await until(async () => (await waiting()).length === 2, 'the search and the read both waited')
      const rows = await waiting()
      expect(rows.filter((row) => row.lookups)).toEqual([{ lookups: true, relation: 'sales.customer' }])
      expect(rows.filter((row) => !row.lookups)).toEqual([{ lookups: false, relation: 'sales."order"' }])
      await Promise.all([customers.release(), orderTable.release()])
      released = true
      expect((await search).status).toBe(200)
      expect((await read).status).toBe(200)
    } finally {
      if (!released) await Promise.all([customers.release(), orderTable.release()])
      await sql.end({ timeout: 5 })
    }
  })
})
