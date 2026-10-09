import { createSecretKey } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FieldBinding, FormPolicy } from '@formancy/data-core'
import { EDGE_VALUES, startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import type { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from './connections.js'
import { createConnectionRegistry } from './connections.js'
import { DRIVER_FACTORIES } from './drivers.js'
import { createIdentityVerifier } from './identity.js'

/*
 * The whole product, end to end, on both engines: HTTP into the real server,
 * through the real drivers, into the shared fixture on real databases. Every
 * other suite tests one part against a fake of its neighbours; this is the one
 * that would notice if the parts disagree (0003, 0024).
 *
 * The journey is plan section 3's: an administrator proposes a form from the
 * database as it is and publishes it with a policy; a clerk, whose tenant the
 * host's token names, finds a customer, creates an order, reads it back
 * exactly, saves a change, has a stale save refused, and cannot see another
 * tenant's order at all.
 */
const SECRET = 'an-end-to-end-host-secret-of-32-bytes!'
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
let root: string
let registry: ConnectionRegistry
let app: FastifyInstance
let admin: string
let clerk: string
let otherClerk: string

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
  const pgUrl = new URL(pg.admin)
  const connections: ConnectionConfig[] = [
    {
      id: 'pg',
      kind: 'postgres',
      host: pgUrl.hostname,
      port: Number(pgUrl.port),
      database: pgUrl.pathname.slice(1),
      user: decodeURIComponent(pgUrl.username),
      password: 'env:PG_PASSWORD',
      schemas: ['sales'],
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
      schemas: ['sales'],
      tls: { enabled: false, trustServerCertificate: true },
    },
  ]
  registry = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: { PG_PASSWORD: decodeURIComponent(pgUrl.password), MS_PASSWORD: String(ms.admin.password) },
    readFile: async () => '',
  })
  root = await mkdtemp(join(tmpdir(), 'formancy-data-e2e-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: 'tid' } })
  app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'] }, runtime: { registry, store } })
  admin = await token('admin-1', { roles: ['data-admin'] })
  clerk = await token('clerk-1', { roles: ['clerk'], tid: 1 })
  otherClerk = await token('clerk-2', { roles: ['clerk'], tid: 2 })
})

afterAll(async () => {
  await app?.close()
  await registry?.close()
  await Promise.all([pg?.stop(), ms?.stop()])
  await rm(root, { recursive: true, force: true })
})

const call = (method: 'GET' | 'POST', url: string, bearer: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) })

/** A clerk may do everything the form offers, on the fields it writes; read-only fields are readable only. */
function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writable ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    // The customer lookup carries the tenant in its key, so its target is
    // pinned to the same tenant: a clerk can only pick their own customers.
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
  }
}

describe.each([
  { engine: 'PostgreSQL', connection: 'pg', versionColumn: 'row_version' as string | undefined },
  { engine: 'SQL Server', connection: 'ms', versionColumn: undefined },
])('the journey on $engine', ({ connection, versionColumn }) => {
  const formId = `${connection}-order`

  // Plan section 3, steps 1 to 7: the administrator proposes from the database
  // as it is now and publishes with a policy. On PostgreSQL the version column
  // is application-maintained and must be confirmed; SQL Server's rowversion
  // needs nothing.
  test('an administrator proposes the order form and publishes it with a policy', async () => {
    const proposal = await call('POST', '/v1/form-proposals', admin, {
      connection,
      root: { schema: 'sales', name: 'order' },
      formId,
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    expect(proposal.statusCode).toBe(200)
    const { form, bindings, snapshot } = proposal.json()
    expect(bindings.operations).toEqual({ create: true, update: true })
    const bundle = { format: 1, connection, form, bindings, policy: clerkPolicy(bindings.fields), snapshot }
    const published = await call('POST', `/v1/forms/${formId}/versions`, admin, { expectedBase: null, bundle })
    expect(published.statusCode, published.body).toBe(201)
  })

  // Steps 8 and 9: a clerk finds a customer through the lookup — only their
  // own tenant's — creates an order at the largest amount numeric(18,4)
  // holds, and reads it back exactly. Then saves a change, and a second save
  // from the same version is refused as stale.
  test('a clerk creates, reads back exactly, updates, and is refused a stale save', async () => {
    const definition = (await call('GET', `/v1/forms/${formId}`, clerk)).json()
    const source = definition.form.model.fields.find((field: { key: string }) => field.key === 'customer').optionsSource as string
    const options = (await call('POST', `/v1/forms/${formId}/lookups/${source}/query`, clerk, { operation: 'create', search: 'Muster' })).json()
    expect(options.rows.map((row: { label: string }) => row.label)).toEqual(['Muster AG'])
    const customer = options.rows[0].token as string

    const created = await call('POST', `/v1/forms/${formId}/records/create`, clerk, {
      answers: { customer, order_date: EDGE_VALUES.orderDate, status: 'placed', amount: EDGE_VALUES.largestAmount, notes: 'from the end-to-end test' },
    })
    expect(created.statusCode, created.body).toBe(201)
    const { record, version } = created.json()

    const read = (await call('POST', `/v1/forms/${formId}/records/read`, clerk, { record })).json()
    expect(read.answers).toMatchObject({ customer, order_date: EDGE_VALUES.orderDate, status: 'placed', amount: EDGE_VALUES.largestAmount, notes: 'from the end-to-end test' })
    expect(read.version).toBe(version)

    const saved = await call('POST', `/v1/forms/${formId}/records/update`, clerk, { record, version, answers: { ...read.answers, amount: '12.5' } })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json().answers.amount).toBe('12.5000')
    expect(saved.json().version).not.toBe(version)

    const stale = await call('POST', `/v1/forms/${formId}/records/update`, clerk, { record, version, answers: { ...read.answers, amount: '13' } })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ code: 'stale' })
  })

  // Another tenant's order does not exist for this clerk — not "forbidden",
  // which would say it does — and their lookup offers none of tenant 1's customers.
  test('another tenant can neither see the order nor pick its customer', async () => {
    const definition = (await call('GET', `/v1/forms/${formId}`, clerk)).json()
    const source = definition.form.model.fields.find((field: { key: string }) => field.key === 'customer').optionsSource as string
    const mine = (await call('POST', `/v1/forms/${formId}/lookups/${source}/query`, otherClerk, { operation: 'create', search: '' })).json()
    expect(mine.rows.map((row: { label: string }) => row.label)).toEqual(['Other Tenant GmbH'])
    const tenantOnesOrder = 'k1:9007199254740993'
    const hidden = await call('POST', `/v1/forms/${formId}/records/read`, otherClerk, { record: tenantOnesOrder })
    expect(hidden.statusCode).toBe(404)
    const visible = await call('POST', `/v1/forms/${formId}/records/read`, clerk, { record: tenantOnesOrder })
    expect(visible.statusCode).toBe(200)
    expect(visible.json().answers.amount).toBe(EDGE_VALUES.largestAmount)
  })

  // Step 10: nothing changed in the database, so drift reports nothing.
  test('drift against the database as it is now reports nothing', async () => {
    const drift = await call('POST', `/v1/forms/${formId}/drift`, admin)
    expect(drift.json()).toMatchObject({ version: 1, changes: [], blocking: false })
  })
})
