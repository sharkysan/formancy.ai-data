import { createSecretKey } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION, LIST_PAGE_SIZE, recordToken } from '@formancy/data-core'
import type { ChosenAnswer, FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot } from '@formancy/data-core'
import { percentiles, POSTGRES_IMAGE, SQLSERVER_IMAGE, startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import { createIdentityVerifier } from '@formancy/data-identity'
import type { IdentityVerifier } from '@formancy/data-identity'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { FormSchema } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import { DEFAULT_BULK_DEADLINE_MS } from './bulk-deadline.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConfigurationStore } from './config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from './connections.js'
import { createConnectionRegistry } from './connections.js'
import { DRIVER_FACTORIES } from './drivers.js'

/*
 * What deleting a page of chosen records costs (0173), through the real
 * server and its drivers on the default images, both engines: `n` rows of
 * parity.removable the owner inserts, deleted in one request, at each of
 * BULK_SIZES, 20 runs at each, timed from the server being asked to its
 * answer -- the request's authorisation, then each record's description
 * and delete, one after another. Held without a clock where a fact has
 * none -- every record of every run is deleted -- and timed, and reported,
 * where it has: test-results/bulk-sized.json, with the answer's bytes,
 * what write-once.ts keeps of a page.
 *
 * The timings are what DEFAULT_BULK_DEADLINE_MS is to be set from
 * (bulk-deadline.ts: chosen until this suite has run in CI). The one clock
 * this suite holds is that a page of LIST_PAGE_SIZE records, sent to a
 * server with the default deadline, is deleted whole within it: a runner
 * on which it is not has outgrown the default, and the deadline is
 * measured again there. In this file's own containers, so no other suite's
 * load is timed.
 */
const SECRET = 'a-bulk-sized-host-secret-of-32-bytes!!'
const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'

/** How many chosen records one request deletes: one, a handful, and a page. */
const BULK_SIZES = [1, 10, LIST_PAGE_SIZE] as const
/** Runs per size: the timings reported are each size's over these. */
const RUNS = 20
/** Long enough for a page on a loaded runner: a measurement is never cut by the deadline it is to set. */
const MEASURING = 600_000

let pg: PostgresFixture
let ms: SqlServerFixture
let registry: ConnectionRegistry
let store: ConfigurationStore
let root: string
let verifyIdentity: IdentityVerifier
/** A server whose deadline no measurement reaches, and one with the default's. */
let measuring: FastifyInstance
let defaulted: FastifyInstance
let admin: string
let clerk: string
/** `n` new rows of parity.removable of tenant 1, inserted by the owner: their ids. */
let insertRows: (db: 'pg' | 'ms', n: number) => Promise<string[]>
let closeOwners: () => Promise<void>

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(POSTGRES_IMAGE), startSqlServerFixture(SQLSERVER_IMAGE)])
  const pgUrl = new URL(pg.admin)
  const connections: ConnectionConfig[] = [
    {
      id: 'pg-parity',
      kind: 'postgres',
      host: pgUrl.hostname,
      port: Number(pgUrl.port),
      database: pgUrl.pathname.slice(1),
      user: decodeURIComponent(pgUrl.username),
      password: 'env:PG_PASSWORD',
      schemas: ['parity'],
      tls: { enabled: false },
    },
    {
      id: 'ms-parity',
      kind: 'sqlserver',
      host: String(ms.admin.server),
      port: Number(ms.admin.port),
      database: String(ms.admin.database),
      user: String(ms.admin.user),
      password: 'env:MS_PASSWORD',
      schemas: ['parity'],
      tls: { enabled: false, trustServerCertificate: true },
    },
  ]
  registry = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: { PG_PASSWORD: decodeURIComponent(pgUrl.password), MS_PASSWORD: String(ms.admin.password) },
    readFile: async () => '',
  })
  const pgOwner = connectPostgres({
    host: pgUrl.hostname,
    port: Number(pgUrl.port),
    database: pgUrl.pathname.slice(1),
    user: decodeURIComponent(pgUrl.username),
    password: decodeURIComponent(pgUrl.password),
    tls: { enabled: false, rejectUnauthorized: false },
  })
  const msOwner = await connectSqlServer({
    host: String(ms.admin.server),
    port: Number(ms.admin.port),
    database: String(ms.admin.database),
    user: String(ms.admin.user),
    password: String(ms.admin.password),
    encrypt: false,
    trustServerCertificate: true,
  })
  insertRows = async (db, n) =>
    db === 'pg'
      ? (
          await pgOwner.unsafe<Array<{ id: string }>>(
            `insert into parity.removable (tenant_id, note) select 1, 'sized' from generate_series(1, ${String(n)}) returning id::text as id`,
          )
        ).map((row) => row.id)
      : (
          await msOwner
            .request()
            .query<{ id: number }>(
              `insert into parity.removable (tenant_id, note) output inserted.id select top (${String(n)}) 1, N'sized' from sys.all_objects`,
            )
        ).recordset.map((row) => String(row.id))
  closeOwners = async () => {
    await pgOwner.end({ timeout: 5 })
    await msOwner.close()
  }

  root = await mkdtemp(join(tmpdir(), 'formancy-data-bulk-sized-'))
  store = createFileConfigurationStore(root)
  verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: 'tid' } })
  measuring = await createDataServer({
    verifyIdentity,
    admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } },
    runtime: { registry, store, bulkDeadlineMs: MEASURING },
  })
  defaulted = await createDataServer({ verifyIdentity, runtime: { registry, store } })
  const sign = (subject: string, claims: Record<string, unknown>) =>
    new SignJWT({ sub: subject, ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('30m')
      .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
  admin = await sign('admin-1', { roles: ['data-admin'] })
  clerk = await sign('clerk-1', { roles: ['clerk'], tid: 1 })
})

afterAll(async () => {
  await measuring?.close()
  await defaulted?.close()
  await registry?.close()
  await closeOwners?.()
  await Promise.all([pg?.stop(), ms?.stop()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

interface Proposal {
  form: FormSchema
  bindings: FormBindings
  snapshot: MetadataSnapshot
  generation: GenerationRequest
}

const post = (on: FastifyInstance, url: string, bearer: string, payload: unknown) =>
  on.inject({ method: 'POST', url, headers: { authorization: `Bearer ${bearer}` }, payload: payload as Record<string, unknown> })

describe.each([
  { engine: 'PostgreSQL', connection: 'pg-parity', db: 'pg' as const },
  { engine: 'SQL Server', connection: 'ms-parity', db: 'ms' as const },
])('deleting a page of chosen records on $engine (0173)', ({ connection, db }) => {
  const formId = `${connection}-removable-sized`
  const report: Array<Record<string, number | string>> = []

  beforeAll(async () => {
    const proposal = await post(measuring, '/v1/form-proposals', admin, {
      connection,
      root: { schema: 'parity', name: 'removable' },
      formId,
      title: 'Removable',
      lookups: [],
      versionColumn: 'version',
      pinned: ['tenant_id'],
    })
    expect(proposal.statusCode, proposal.body).toBe(200)
    const { form, bindings, snapshot, generation } = proposal.json<Proposal>()
    const policy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] },
      fields: Object.fromEntries(bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: [] }])),
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
      lookups: {},
      bulk: { delete: { roles: ['clerk'] } },
    }
    const published = await post(measuring, `/v1/forms/${formId}/versions`, admin, {
      expectedBase: null,
      bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
    })
    expect(published.statusCode, published.body).toBe(201)
  })

  afterAll(() => {
    // The measurement, beside the run's results: what bulk-deadline.ts is to record.
    mkdirSync('test-results', { recursive: true })
    writeFileSync(join('test-results', `bulk-sized-${db === 'pg' ? 'postgres' : 'sqlserver'}.json`), JSON.stringify(report, null, 2))
  })

  /** A request's records: `n` new rows, each at the version a row starts at. */
  async function fresh(n: number): Promise<Array<{ record: string; version: string }>> {
    return (await insertRows(db, n)).map((id) => {
      const made = recordToken(['id'], { id })
      if (!made.ok) throw new Error(made.message)
      return { record: made.token, version: '1' }
    })
  }

  /** Every record of a request deleted, in the order sent: what each run must have done before its time counts. */
  function allDone(body: ChosenAnswer, records: ReadonlyArray<{ record: string }>): void {
    expect(body.records).toEqual(records.map(({ record }) => ({ sent: true, status: 200, body: { record, deleted: true } })))
  }

  // Every run deletes every record it names, and is timed: the first of
  // each size apart, since SQL Server compiles a batch it has not seen
  // before it runs it, and PostgreSQL's pool may open its connection then.
  test.each(BULK_SIZES)(
    'of %i records deletes each, and is timed',
    async (n) => {
      const firstRecords = await fresh(n)
      const sending = performance.now()
      const first = await post(measuring, `/v1/forms/${formId}/records/delete-chosen`, clerk, { records: firstRecords })
      const firstMs = performance.now() - sending
      expect(first.statusCode, first.body).toBe(200)
      allDone(first.json<ChosenAnswer>(), firstRecords)

      const times: number[] = []
      let bytes = 0
      for (let run = 0; run < RUNS; run += 1) {
        const records = await fresh(n)
        const start = performance.now()
        const response = await post(measuring, `/v1/forms/${formId}/records/delete-chosen`, clerk, { records })
        times.push(performance.now() - start)
        expect(response.statusCode, response.body).toBe(200)
        allDone(response.json<ChosenAnswer>(), records)
        bytes = Buffer.byteLength(response.body, 'utf8')
      }
      const { p50, p95, p99, max } = percentiles(times)
      report.push({
        engine: db === 'pg' ? 'postgres' : 'sqlserver',
        records: n,
        first: Math.round(firstMs),
        runs: RUNS,
        p50: Math.round(p50),
        p95: Math.round(p95),
        p99: Math.round(p99),
        max: Math.round(max),
        bytes,
      })
    },
    600_000,
  )

  // The default deadline admits a page: a server that reads no setting
  // deletes every one of LIST_PAGE_SIZE chosen records, none answered not
  // sent. A runner on which it does not is one the default is to be
  // measured on again.
  test('of a page, is deleted whole within the default deadline', async () => {
    const records = await fresh(LIST_PAGE_SIZE)
    const start = performance.now()
    const response = await post(defaulted, `/v1/forms/${formId}/records/delete-chosen`, clerk, { records })
    expect(response.statusCode, response.body).toBe(200)
    allDone(response.json<ChosenAnswer>(), records)
    expect(performance.now() - start).toBeLessThan(DEFAULT_BULK_DEADLINE_MS)
  })
})
