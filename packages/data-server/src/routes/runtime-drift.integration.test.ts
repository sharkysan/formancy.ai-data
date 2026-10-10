import { createSecretKey } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffSnapshots, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { DriftReport, FieldBinding, FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot, RecordAdapter } from '@formancy/data-core'
import { driftingOn, runtimeOf, startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { DriftingCase, DriftVerdict, PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { FormSchema } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { PublishedBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionConfig, ConnectionFactory, ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry } from '../connections.js'
import { DRIVER_FACTORIES } from '../drivers.js'
import { createIdentityVerifier } from '../identity.js'

/*
 * The runtime refuses what drift review blocks in the form's own table
 * (0041): the reproduction of 2026-10-10, inverted. It is the failure it
 * prevents -- after an ALTER drift review called blocking, with update
 * stopped, every runtime update still reached the database, which wrote,
 * rounded, converted or refused as its own rules said: a narrower scale
 * stored 1234.5678 as 1234.57 and answered 200, a retype to real stored the
 * nearest float32, a column no ALTER touched committed, and reads answered
 * 200 over a column the form could no longer read.
 *
 * Each case of `DRIFTING`, on both engines, against the shared fixture's real
 * servers: a form proposed and published over a table of its own, the table
 * changed by its owner, and then, over HTTP as a clerk the policy lets do
 * everything -- so only drift can refuse -- the form opened, its record read,
 * every update and a create sent. The record port is wrapped by a
 * pass-through that only counts what the real adapter was asked; the driver
 * and the database are the real ones (0003). The row is read back as the
 * owner.
 *
 * What each case must show: the drift route's report says review's verdict
 * and the runtime's; the form offers exactly what the runtime allows, or is
 * 409 `drift`; a read is answered only while the form can be read; a write
 * the runtime stops is 409 `drift`, reaches neither insert nor update, and
 * leaves the row as the ALTER left it; a write it allows is answered and
 * committed. On the runtime before 0041 every refused case failed here as the
 * reproduction observed: 200 and 422 and `schema-changed` from the database,
 * with the writes reaching it. Every allowed case failed there only for the
 * report's `readable` and `runtime`, which it did not have; they are here for
 * a runtime that refuses too much, and a runtime that refused whenever its
 * report held any change failed each one allowed despite a change.
 */

const SECRET = 'a-reproduction-host-secret-of-32-bytes!'
const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'

async function token(subject: string, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ sub: subject, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('30m')
    .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
}

type Engine = 'postgres' | 'sqlserver'

/** What the real record adapter was asked, per connection and port method. */
const asked = new Map<string, Record<string, number>>()

/** The real factories, each call of the record port counted on the way through. The driver and the database are the real ones. */
function recording(factory: ConnectionFactory): ConnectionFactory {
  return async (config, password) => {
    const open = await factory(config, password)
    const counted = Object.fromEntries(
      Object.entries(open.records).map(([name, method]) => [
        name,
        (...args: unknown[]) => {
          const tally = asked.get(config.id) ?? {}
          tally[name] = (tally[name] ?? 0) + 1
          asked.set(config.id, tally)
          return (method as (...given: unknown[]) => unknown)(...args)
        },
      ]),
    ) as unknown as RecordAdapter
    return { ...open, records: counted }
  }
}

/** How many writes the adapter was asked to make on a connection so far. */
function writesAsked(connection: string): number {
  const tally = asked.get(connection) ?? {}
  return (tally['insert'] ?? 0) + (tally['update'] ?? 0)
}

let pg: PostgresFixture
let ms: SqlServerFixture
let root: string
let registry: ConnectionRegistry
let app: FastifyInstance
let base: string
let admin: string
let clerk: string

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
  const pgUrl = new URL(pg.admin)
  const connections: ConnectionConfig[] = [
    {
      id: 'postgres-drifting',
      kind: 'postgres',
      host: pgUrl.hostname,
      port: Number(pgUrl.port),
      database: pgUrl.pathname.slice(1),
      user: decodeURIComponent(pgUrl.username),
      password: 'env:PG_PASSWORD',
      schemas: ['drifting'],
      tls: { enabled: false },
    },
    {
      id: 'sqlserver-drifting',
      kind: 'sqlserver',
      host: String(ms.admin.server),
      port: Number(ms.admin.port),
      database: String(ms.admin.database),
      user: String(ms.admin.user),
      password: 'env:MS_PASSWORD',
      schemas: ['drifting'],
      tls: { enabled: false, trustServerCertificate: true },
    },
  ]
  registry = createConnectionRegistry(connections, { postgres: recording(DRIVER_FACTORIES.postgres), sqlserver: recording(DRIVER_FACTORIES.sqlserver) }, {
    env: { PG_PASSWORD: decodeURIComponent(pgUrl.password), MS_PASSWORD: String(ms.admin.password) },
    readFile: async () => '',
  })
  root = await mkdtemp(join(tmpdir(), 'formancy-data-runtime-drift-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: {} })
  app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store } })
  // A real socket and a plain HTTP client: what any host's backend would send.
  await app.listen({ host: '127.0.0.1', port: 0 })
  base = `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`
  admin = await token('admin-1', { roles: ['data-admin'] })
  clerk = await token('clerk-1', { roles: ['clerk'] })
})

afterAll(async () => {
  await app?.close()
  await registry?.close()
  await Promise.all([pg?.stop(), ms?.stop()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

async function call(method: 'GET' | 'POST', path: string, bearer: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, json: text === '' ? null : JSON.parse(text) }
}

/** The table as its owner sees it: row 1 as JSON text, and how many rows there are. */
interface Held {
  row: string | null
  rows: number
}

/** The owner's own connection, which changes the schema and reads the rows back. */
async function owner(engine: Engine): Promise<{ run(statements: readonly string[]): Promise<void>; held(table: string): Promise<Held>; close(): Promise<void> }> {
  if (engine === 'postgres') {
    const url = new URL(pg.admin)
    const sql = connectPostgres({
      host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), tls: { enabled: false, rejectUnauthorized: false },
    })
    return {
      run: async (statements) => {
        for (const statement of statements) await sql.unsafe(statement)
      },
      held: async (table) => {
        const [found] = await sql.unsafe<Held[]>(
          `select (select pg_catalog.row_to_json(t)::text from drifting.${table} t where t.id = 1) as row, (select pg_catalog.count(*)::int from drifting.${table}) as rows`,
        )
        return found as Held
      },
      close: () => sql.end({ timeout: 5 }),
    }
  }
  const pool = await connectSqlServer({
    host: String(ms.admin.server), port: Number(ms.admin.port), database: String(ms.admin.database), user: String(ms.admin.user), password: String(ms.admin.password), encrypt: false, trustServerCertificate: true,
  })
  return {
    run: async (statements) => {
      for (const statement of statements) await pool.request().batch(statement)
    },
    held: async (table) =>
      (
        await pool
          .request()
          .query<Held>(
            `select (select * from drifting.${table} where id = 1 for json path, without_array_wrapper, include_null_values) as row, (select count(*) from drifting.${table}) as rows`,
          )
      ).recordset[0] as Held,
    close: () => pool.close(),
  }
}

/** Everything the form offers, to a clerk, on every field it writes and every lookup: no row filter, so only drift could refuse. */
function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: [],
    lookups: Object.fromEntries(fields.filter((binding) => binding.kind === 'lookup').map((binding) => [binding.field, []])),
  }
}

interface Proposal {
  form: FormSchema
  bindings: FormBindings
  snapshot: MetadataSnapshot
  generation: GenerationRequest
}

/** One write as the clerk saw it: the status, the refusal's code, whether it reached the adapter, and whether the row moved. */
interface Sent {
  status: number
  code?: string
  reached: boolean
  committed: boolean
}

/** Everything a case shows, compared at once, so a failure shows every difference. */
interface Shown {
  review: DriftVerdict
  runtime: unknown
  form: { status: number; code?: string; operations?: string[] }
  read: { status: number; code?: string }
  updates: Sent[]
  create: Sent
  /** The owner's row after every write, against the row the ALTER left, when no update may commit. */
  rowAsAltered: boolean | null
  rows: number
}

/** What a case must show, from its verdicts. */
function expected(entry: DriftingCase, verdict: DriftVerdict, after: Held): Shown {
  const runtime = runtimeOf(entry) as DriftVerdict
  const write = (allowed: boolean, status: number): Sent => (allowed ? { status, reached: true, committed: true } : { status: 409, code: 'drift', reached: false, committed: false })
  const operations = (['read', 'create', 'update'] as const).filter((operation) => runtime[operation])
  return {
    review: verdict,
    runtime: { readable: runtime.read, writable: { create: runtime.create, update: runtime.update } },
    form: !runtime.read ? { status: 409, code: 'drift' } : operations.length === 0 ? { status: 409, code: 'drift' } : { status: 200, operations },
    read: runtime.read ? { status: 200 } : { status: 409, code: 'drift' },
    updates: entry.updates.map(() => write(runtime.update, 200)),
    create: write(runtime.create, 201),
    rowAsAltered: runtime.update ? null : true,
    rows: after.rows + (runtime.create ? 1 : 0),
  }
}

describe.each([
  { engine: 'PostgreSQL', kind: 'postgres' as Engine },
  { engine: 'SQL Server', kind: 'sqlserver' as Engine },
])('the runtime against a changed table, on $engine', ({ kind }) => {
  const connection = `${kind}-drifting`
  let ddl: Awaited<ReturnType<typeof owner>>

  beforeAll(async () => {
    ddl = await owner(kind)
    await ddl.run(['create schema drifting'])
  })
  afterAll(async () => {
    await ddl?.close()
  })

  test.each(driftingOn(kind).filter((entry) => entry.verdict !== null))('$name: the form does exactly what the runtime allows, and nothing it stops reaches the database', async (entry) => {
    const formId = `${kind}-${entry.table.replaceAll('_', '-')}`
    await ddl.run(entry.setUp[kind] as readonly string[])

    // Proposed and published as the studio would, with a policy that lets the clerk do everything.
    const proposed = await call('POST', '/v1/form-proposals', admin, {
      connection, root: { schema: 'drifting', name: entry.table }, formId, title: entry.table, lookups: entry.lookups ?? [], ...(kind === 'postgres' ? { versionColumn: 'row_version' } : {}),
    })
    expect(proposed.status, JSON.stringify(proposed.json)).toBe(200)
    const proposal = proposed.json as Proposal
    expect(proposal.bindings.operations).toEqual({ create: true, update: true })
    const policy = clerkPolicy(proposal.bindings.fields)
    const bundle = { format: 2, connection, generation: proposal.generation, base: proposal.form, presentation: EMPTY_PRESENTATION, form: proposal.form, bindings: proposal.bindings, policy, snapshot: proposal.snapshot }
    const published = await call('POST', `/v1/forms/${formId}/versions`, admin, { expectedBase: null, bundle })
    expect(published.status, JSON.stringify(published.json)).toBe(201)

    // Before: the clerk reads the record as the host would, and holds its version.
    const before = await call('POST', `/v1/forms/${formId}/records/read`, clerk, { record: 'k1:1' })
    expect(before.status, JSON.stringify(before.json)).toBe(200)

    // The owner changes the table.
    await ddl.run(entry.alter[kind] as readonly string[])
    const after = await ddl.held(entry.table)

    // Review, as diffSnapshots says it for the published bindings, and as the drift route reports it.
    const latest = (await call('GET', `/v1/forms/${formId}/versions/latest`, admin)).json as { version: number; bundle: PublishedBundle }
    const open = await registry.open(connection)
    const scope = registry.scope(connection)
    if (open === undefined || scope === undefined) throw new Error(`${connection} is not in the registry`)
    const direct: DriftReport = diffSnapshots(latest.bundle.snapshot, await open.adapter.discover(scope), latest.bundle.bindings, latest.bundle.policy)
    const routed = (await call('POST', `/v1/forms/${formId}/drift`, admin)).json as DriftReport & { version: number }
    expect(routed).toMatchObject({ blocking: direct.blocking, writable: direct.writable, changes: direct.changes })

    const form = await call('GET', `/v1/forms/${formId}`, clerk)
    const read = await call('POST', `/v1/forms/${formId}/records/read`, clerk, { record: 'k1:1' })

    let version = before.json.version as string
    const send = async (path: string, body: unknown, status: number): Promise<Sent> => {
      const writes = writesAsked(connection)
      const prior = await ddl.held(entry.table)
      const response = await call('POST', path, clerk, body)
      const now = await ddl.held(entry.table)
      if (response.status === 200) version = response.json.version as string
      return {
        status: response.status,
        ...(response.status === status ? {} : { code: response.json?.code as string }),
        reached: writesAsked(connection) > writes,
        committed: now.row !== prior.row || now.rows !== prior.rows,
      }
    }
    const updates: Sent[] = []
    for (const answer of entry.updates) {
      updates.push(await send(`/v1/forms/${formId}/records/update`, { record: 'k1:1', version, answers: { [answer.field]: answer.value } }, 200))
    }
    const create = await send(`/v1/forms/${formId}/records/create`, { answers: entry.insert }, 201)
    const last = await ddl.held(entry.table)
    const runtime = runtimeOf(entry) as DriftVerdict

    const shown: Shown = {
      review: { read: (routed as { readable?: boolean }).readable as boolean, create: routed.writable.create, update: routed.writable.update },
      runtime: (routed as { runtime?: unknown }).runtime,
      form: form.status === 200 ? { status: 200, operations: form.json.operations as string[] } : { status: form.status, code: form.json?.code as string },
      read: read.status === 200 ? { status: 200 } : { status: read.status, code: read.json?.code as string },
      updates,
      create,
      rowAsAltered: runtime.update ? null : last.row === after.row,
      rows: last.rows,
    }
    expect(shown).toEqual(expected(entry, entry.verdict as DriftVerdict, after))
    // Review alone says what diffSnapshots says: the route adds nothing of its own.
    expect({ read: (direct as { readable?: boolean }).readable, ...direct.writable }).toEqual(entry.verdict)
  })
})
