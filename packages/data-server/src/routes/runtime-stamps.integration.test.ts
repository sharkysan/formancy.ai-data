import { createSecretKey } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FormBindings, GenerationRequest, MetadataSnapshot } from '@formancy/data-core'
import { AUDITED_POLICY, AUDITED_STAMPS, POSTGRES_IMAGE, SQLSERVER_IMAGE, startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import { createIdentityVerifier } from '@formancy/data-identity'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { FormSchema } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry } from '../connections.js'
import { DRIVER_FACTORIES } from '../drivers.js'

/*
 * What the server stamps (0153), through the runtime plane on both
 * engines: HTTP into the real server, through the real drivers, into the
 * shared fixture's parity.audited. An administrator proposes the form with
 * the stamps confirmed and publishes it; then Alice creates a record, Bob
 * -- of her tenant, another person -- changes it, and Carol, who created
 * nothing, reads it. What each step must show: the stored creator is the
 * token's subject and site, never what a body says; the time is the
 * database's, read as the owner beside the database's own clock; a stamp
 * submitted is refused; Bob's update restamps who changed it and leaves
 * who created it; Carol sees the record Alice created, since a stamp
 * filters nothing; and a token whose identity the column cannot hold, or
 * that lacks the attribute stamped, writes nothing.
 *
 * Each adapter's `stamps.integration.test.ts` holds the statements to the
 * engine's clock in detail; this file holds the plane to the stamps.
 */

const SECRET = 'a-stamping-host-secret-of-32-bytes!!'
const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'

async function token(subject: string, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ sub: subject, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('10m')
    .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
}

let pg: PostgresFixture
let ms: SqlServerFixture
let pgOwner: ReturnType<typeof connectPostgres>
let msOwner: Awaited<ReturnType<typeof connectSqlServer>>
let root: string
let registry: ConnectionRegistry
let app: FastifyInstance
let admin: string
let alice: string
let bob: string
let carol: string

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(POSTGRES_IMAGE), startSqlServerFixture(SQLSERVER_IMAGE)])
  const pgUrl = new URL(pg.admin)
  // The owner's own connections, which read the rows and the clock as the database holds them.
  pgOwner = connectPostgres({
    host: pgUrl.hostname,
    port: Number(pgUrl.port),
    database: pgUrl.pathname.slice(1),
    user: decodeURIComponent(pgUrl.username),
    password: decodeURIComponent(pgUrl.password),
    tls: { enabled: false, rejectUnauthorized: false },
  })
  msOwner = await connectSqlServer({
    host: String(ms.admin.server),
    port: Number(ms.admin.port),
    database: String(ms.admin.database),
    user: String(ms.admin.user),
    password: String(ms.admin.password),
    encrypt: false,
    trustServerCertificate: true,
  })
  const connections: ConnectionConfig[] = [
    {
      id: 'pg',
      kind: 'postgres',
      host: pgUrl.hostname,
      port: Number(pgUrl.port),
      database: pgUrl.pathname.slice(1),
      user: decodeURIComponent(pgUrl.username),
      password: 'env:PG_PASSWORD',
      schemas: ['parity'],
      // The fixture's containers speak no TLS. A real allowlist leaves it on.
      tls: { enabled: false },
    },
    {
      id: 'ms',
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
  root = await mkdtemp(join(tmpdir(), 'formancy-data-stamps-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({
    key: { kind: 'secret', secret: SECRET },
    issuer: ISSUER,
    audience: AUDIENCE,
    attributes: { tenant: 'tid', site: 'site' },
  })
  app = await createDataServer({
    verifyIdentity,
    admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } },
    runtime: { registry, store },
  })
  admin = await token('admin-1', { roles: ['data-admin'] })
  alice = await token('alice', { roles: ['clerk'], tid: 1, site: 'Bern' })
  bob = await token('bob', { roles: ['clerk'], tid: 1, site: 'Basel' })
  carol = await token('carol', { roles: ['clerk'], tid: 1, site: 'Chur' })
})

afterAll(async () => {
  await app?.close()
  await registry?.close()
  await pgOwner?.end({ timeout: 5 })
  await msOwner?.close()
  await Promise.all([pg?.stop(), ms?.stop()])
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

const call = (method: 'GET' | 'POST', url: string, bearer: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) })

interface Proposal {
  form: FormSchema
  bindings: FormBindings
  snapshot: MetadataSnapshot
  generation: GenerationRequest
}

/** The database's own clock and a row's created_at, both as instants to the second in UTC, as the owner reads them. */
const clocks = {
  pg: {
    now: async () =>
      (await pgOwner.unsafe<Array<{ at: string }>>(`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`))[0]?.at,
    createdAt: async (id: number) =>
      (
        await pgOwner.unsafe<Array<{ at: string }>>(
          `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at from parity.audited where id = $1`,
          [id],
        )
      )[0]?.at,
  },
  ms: {
    now: async () => (await msOwner.request().query<{ at: string }>(`select convert(nvarchar(19), sysutcdatetime(), 126) + 'Z' as at`)).recordset[0]?.at,
    createdAt: async (id: number) =>
      (
        await msOwner
          .request()
          .query<{ at: string }>(
            `select convert(nvarchar(19), switchoffset(created_at, '+00:00'), 126) + 'Z' as at from parity.audited where id = ${String(Math.trunc(id))}`,
          )
      ).recordset[0]?.at,
  },
} as const

describe.each([
  { engine: 'PostgreSQL', connection: 'pg' as const },
  { engine: 'SQL Server', connection: 'ms' as const },
])('the stamps on $engine', ({ connection }) => {
  const formId = `${connection}-audited`

  // The administrator confirms each stamp; the proposal shows each stamped
  // field read-only, and the form is published with a policy that grants
  // nobody a stamp's field -- no grant could.
  test('an administrator proposes the audited form with its stamps and publishes it', async () => {
    const proposal = await call('POST', '/v1/form-proposals', admin, {
      connection,
      root: { schema: 'parity', name: 'audited' },
      formId,
      title: 'Audited',
      lookups: [],
      pinned: ['tenant_id'],
      versionColumn: 'version',
      stamps: AUDITED_STAMPS,
    })
    expect(proposal.statusCode, proposal.body).toBe(200)
    const proposed = proposal.json<Proposal>()
    expect(proposed.bindings.stamps?.map((stamp) => stamp.column)).toEqual(AUDITED_STAMPS.map((stamp) => stamp.column))
    const bundle = { format: 2, connection, ...proposed, base: proposed.form, presentation: EMPTY_PRESENTATION, policy: AUDITED_POLICY }
    const published = await call('POST', `/v1/forms/${formId}/versions`, admin, { expectedBase: null, bundle })
    expect(published.statusCode, published.body).toBe(201)
  })

  // The whole journey on one record. To be watched failing in CI with the
  // planner's stamps left out of the insert -- the database refuses
  // created_by NULL -- and with the stamps planned from the answers.
  test('stamps who and when, never from the body, and filters nothing', async () => {
    const definition = (await call('GET', `/v1/forms/${formId}`, alice)).json()
    // What a page may send and a copy carries are the over-posting check's (0117, 0107): no stamp.
    expect(definition.writable).toEqual({ create: ['note'], update: ['note'] })
    expect(definition.copied).toEqual(['note'])

    const before = await clocks[connection].now()
    const created = await call('POST', `/v1/forms/${formId}/records/create`, alice, { answers: { note: 'first' } })
    const after = await clocks[connection].now()
    expect(created.statusCode, created.body).toBe(201)
    const { record, version, answers } = created.json()
    expect(answers).toMatchObject({ created_by: 'alice', created_in: 'Bern', changed_by: null, changed_on: null })
    // The time is the database's: the stored instant lies between its own clock read before and after.
    const id = Number(answers.id)
    const stamped = await clocks[connection].createdAt(id)
    expect([before, stamped, after].map(String).sort()).toEqual([before, stamped, after].map(String))
    expect(answers.created_at).toBe(stamped)

    // A stamp in the body is somebody saying who they are: refused, nothing written.
    for (const forged of [{ created_by: 'mallory' }, { changed_at: '2020-01-01T00:00:00' }]) {
      const refused = await call('POST', `/v1/forms/${formId}/records/create`, alice, { answers: { note: 'forged', ...forged } })
      expect(refused.statusCode, refused.body).toBe(403)
      expect(refused.json()).toMatchObject({ code: 'over-posting' })
    }

    // Bob changes Alice's record: he is who changed it last, she who created it.
    const read = (await call('POST', `/v1/forms/${formId}/records/read`, bob, { record })).json()
    expect(read.answers).toMatchObject({ created_by: 'alice' })
    const saved = await call('POST', `/v1/forms/${formId}/records/update`, bob, { record, version, answers: { ...read.answers, note: 'second' } })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json().answers).toMatchObject({ note: 'second', created_by: 'alice', created_in: 'Bern', changed_by: 'bob' })
    expect(saved.json().answers.changed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(saved.json().answers.created_at).toBe(stamped)
    // An echo of a stamp Bob read is no change; a different one is refused.
    const tampered = await call('POST', `/v1/forms/${formId}/records/update`, bob, {
      record,
      version: saved.json().version,
      answers: { ...saved.json().answers, note: 'third', changed_by: 'alice' },
    })
    expect(tampered.statusCode, tampered.body).toBe(403)

    // Carol created nothing, and reads what Alice created and Bob changed.
    const theirs = await call('POST', `/v1/forms/${formId}/records/read`, carol, { record })
    expect(theirs.statusCode, theirs.body).toBe(200)
    expect(theirs.json().answers).toMatchObject({ created_by: 'alice', changed_by: 'bob' })
  })

  // An identity the column cannot hold is refused, naming the column, never
  // cut to fit; a token without the attribute a stamp names is refused as a
  // row filter's missing one is. Neither writes.
  test('refuses what the token cannot fill', async () => {
    const long = await token('a'.repeat(41), { roles: ['clerk'], tid: 1, site: 'Bern' })
    const tooLong = await call('POST', `/v1/forms/${formId}/records/create`, long, { answers: { note: 'long' } })
    expect(tooLong.statusCode, tooLong.body).toBe(403)
    expect(tooLong.json()).toMatchObject({ code: 'unstampable', message: expect.stringContaining('created_by') })
    const siteless = await token('dora', { roles: ['clerk'], tid: 1 })
    const missing = await call('POST', `/v1/forms/${formId}/records/create`, siteless, { answers: { note: 'nowhere' } })
    expect(missing.statusCode, missing.body).toBe(403)
    expect(missing.json()).toMatchObject({ code: 'missing-attribute' })
  })
})
