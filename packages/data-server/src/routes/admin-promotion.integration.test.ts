import { createSecretKey } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffSnapshots, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FieldBinding, FormBindings, FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import { EDGE_VALUES, POSTGRES_IMAGE, SQLSERVER_IMAGE, startPostgresFixture, startSqlServerFixture, WRITER } from '@formancy/data-fixtures'
import type { PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import { createIdentityVerifier } from '@formancy/data-identity'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { LightMyRequestResponse } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { BundleV2, PublishedBundle } from '../bundle.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry } from '../connections.js'
import { DRIVER_FACTORIES } from '../drivers.js'

/*
 * A published version moved from one deployment to another (0062), on both
 * engines, against the shared fixture's real servers. Each deployment is a
 * server with a store of its own and an allowlist naming `erp`; for one
 * engine, both name the same database, which the owner alters between the
 * export and the import, as a production database differs from a
 * development one.
 *
 * Development publishes the order form, and its version is read through
 * the route the studio downloads it from: the export. The same file as
 * 0.1.0 wrote it, its customer a plain select, is refused by a deployment
 * of its own as a base this server does not generate (0066). Production
 * has lost approved_by, a column the form binds, with plan section 14 step
 * 8's DDL: the import is refused, and nothing is written. The column put
 * back, the import is version 1 there, and a clerk creates an order
 * through production's runtime and reads it back exactly. Pointed at the
 * other engine, production's `erp` refuses the import as the caller's
 * problem; as the order form's own account, formancy_writer (0027), the
 * import does exactly what drift between the two snapshots says, which is
 * to refuse.
 */

const SECRET = 'a-promotion-host-secret-of-32-bytes!!'
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

type Engine = 'pg' | 'ms'
type Account = 'owner' | 'writer'

/**
 * approved_by dropped, as e2e.integration.test.ts's step 8 drops it, and put
 * back with its foreign key, as the fixture defines it. SQL Server refuses
 * to drop a column a foreign key uses, so the constraint goes first there,
 * and comes back in a batch of its own once the column exists.
 */
const DDL: Record<Engine, { drop: string[]; restore: string[] }> = {
  pg: {
    drop: ['alter table sales."order" drop column approved_by'],
    restore: [
      'alter table sales."order" add column approved_by integer, add constraint fk_order_approved_by foreign key (approved_by) references sales.employee (id)',
    ],
  },
  ms: {
    drop: ['alter table sales.[order] drop constraint fk_order_approved_by', 'alter table sales.[order] drop column approved_by'],
    restore: [
      'alter table sales.[order] add approved_by int null',
      'alter table sales.[order] add constraint fk_order_approved_by foreign key (approved_by) references sales.employee (id)',
    ],
  },
}

let pg: PostgresFixture
let ms: SqlServerFixture
let verifyIdentity: Awaited<ReturnType<typeof createIdentityVerifier>>
let admin: string
let clerk: string
const registries: ConnectionRegistry[] = []
const roots: string[] = []

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(POSTGRES_IMAGE), startSqlServerFixture(SQLSERVER_IMAGE)])
  verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: 'tid' } })
  admin = await token('admin-1', { roles: ['data-admin'] })
  clerk = await token('clerk-1', { roles: ['clerk'], tid: 1 })
})

afterAll(async () => {
  await Promise.all(registries.map((registry) => registry.close()))
  await Promise.all([pg?.stop(), ms?.stop()])
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

/** `erp` as one deployment's allowlist names it: one engine's database, as its owner or as the order form's account. */
function erp(engine: Engine, account: Account): { config: ConnectionConfig; password: string } {
  if (engine === 'pg') {
    const url = new URL(pg.admin)
    const config: ConnectionConfig = {
      id: 'erp',
      kind: 'postgres',
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: account === 'owner' ? decodeURIComponent(url.username) : WRITER.user,
      password: 'env:ERP_PASSWORD',
      schemas: ['sales'],
      // The fixture's containers speak no TLS. A real allowlist leaves it on.
      tls: { enabled: false },
    }
    return { config, password: account === 'owner' ? decodeURIComponent(url.password) : WRITER.postgresPassword }
  }
  const config: ConnectionConfig = {
    id: 'erp',
    kind: 'sqlserver',
    host: String(ms.admin.server),
    port: Number(ms.admin.port),
    database: String(ms.admin.database),
    user: account === 'owner' ? String(ms.admin.user) : WRITER.user,
    password: 'env:ERP_PASSWORD',
    schemas: ['sales'],
    tls: { enabled: false, trustServerCertificate: true },
  }
  return { config, password: account === 'owner' ? String(ms.admin.password) : WRITER.sqlServerPassword }
}

interface Deployment {
  root: string
  call(method: 'GET' | 'POST', url: string, bearer: string, payload?: unknown): Promise<LightMyRequestResponse>
}

/** A deployment: both planes, a store of its own, and `erp` on `engine` as `account`. */
async function deployment(engine: Engine, account: Account = 'owner'): Promise<Deployment> {
  const { config, password } = erp(engine, account)
  const registry = createConnectionRegistry([config], DRIVER_FACTORIES, { env: { ERP_PASSWORD: password }, readFile: async () => '' })
  registries.push(registry)
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-promotion-'))
  roots.push(root)
  const store = createFileConfigurationStore(root)
  // The administrator's trail is admin-audit.test.ts's subject; here it is required and discarded.
  const app = await createDataServer({
    verifyIdentity,
    admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } },
    runtime: { registry, store },
  })
  return {
    root,
    call: (method, url, bearer, payload) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${bearer}` },
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      }),
  }
}

/** Statements as the database's owner, which is who changes a schema, one batch each. */
async function owner(engine: Engine): Promise<{ run(statements: readonly string[]): Promise<void>; close(): Promise<void> }> {
  if (engine === 'pg') {
    const url = new URL(pg.admin)
    const sql = connectPostgres({
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      tls: { enabled: false, rejectUnauthorized: false },
    })
    return {
      run: async (statements) => {
        for (const statement of statements) await sql.unsafe(statement)
      },
      close: () => sql.end({ timeout: 5 }),
    }
  }
  const pool = await connectSqlServer({
    host: String(ms.admin.server),
    port: Number(ms.admin.port),
    database: String(ms.admin.database),
    user: String(ms.admin.user),
    password: String(ms.admin.password),
    encrypt: false,
    trustServerCertificate: true,
  })
  return {
    run: async (statements) => {
      for (const statement of statements) await pool.request().batch(statement)
    },
    close: () => pool.close(),
  }
}

/** A clerk does everything the form offers, on their own tenant's orders and customers, as the end-to-end journey's policy says. */
function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(
      fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }]),
    ),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
  }
}

describe.each([
  { engine: 'PostgreSQL', connection: 'pg' as const, other: 'ms' as const, versionColumn: 'row_version' as string | undefined },
  { engine: 'SQL Server', connection: 'ms' as const, other: 'pg' as const, versionColumn: undefined },
])('a version of the order form moved between deployments on $engine', ({ connection, other, versionColumn }) => {
  let development: Deployment
  let production: Deployment
  let ddl: Awaited<ReturnType<typeof owner>>
  /** The export: version 1 as development's route reads it. */
  let bundle: PublishedBundle

  beforeAll(async () => {
    ;[development, production, ddl] = await Promise.all([deployment(connection), deployment(connection), owner(connection)])
  })
  afterAll(async () => {
    await ddl?.close()
  })

  // Development proposes from its database and publishes with a policy;
  // the version read back through the route is the file development's
  // store wrote, which is what the studio downloads.
  test('development publishes the order form, and its version is read as the export', async () => {
    const proposal = await development.call('POST', '/v1/form-proposals', admin, {
      connection: 'erp',
      root: { schema: 'sales', name: 'order' },
      formId: 'order',
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    expect(proposal.statusCode, proposal.body).toBe(200)
    const { form, bindings, snapshot, generation } = proposal.json() as {
      form: unknown
      bindings: FormBindings
      snapshot: MetadataSnapshot
      generation: unknown
    }
    const published = await development.call('POST', '/v1/forms/order/versions', admin, {
      expectedBase: null,
      bundle: {
        format: 2,
        connection: 'erp',
        generation,
        base: form,
        presentation: EMPTY_PRESENTATION,
        form,
        bindings,
        policy: clerkPolicy(bindings.fields),
        snapshot,
      },
    })
    expect(published.statusCode, published.body).toBe(201)
    const read = await development.call('GET', '/v1/forms/order/versions/1', admin)
    expect(read.statusCode, read.body).toBe(200)
    bundle = read.json().bundle as PublishedBundle
    expect(`${JSON.stringify(bundle, null, 2)}\n`).toBe(await readFile(join(development.root, 'order', '1.json'), 'utf8'))
  })

  // The export as 0.1.0 wrote it: its customer lookup is the plain select
  // that release generated, with no widget in the base or the form, so its
  // presentation still gives its form and it validates. Only this server's
  // generator, which draws a lookup a person can search as a typeahead,
  // says the base is not its own: 422, 0062's cost first met at 0066, and
  // nothing written. Into a deployment of its own, not production: watched
  // answering 201 on main, where the stripped file is what the generator
  // writes, which in production would also have written the version the
  // next case expects not to be there.
  test('the export as 0.1.0 wrote it, its customer a plain select, is refused as not what this server generates, and writes nothing', async () => {
    const older = structuredClone(bundle) as BundleV2
    for (const form of [older.base, older.form]) delete (form.model.fields.find((field) => field.key === 'customer') as { widget?: unknown }).widget
    const target = await deployment(connection)
    const refused = await target.call('POST', '/v1/forms/order/imports', admin, { expectedBase: null, bundle: older })
    expect(refused.statusCode, refused.body).toBe(422)
    expect(refused.json()).toEqual({
      code: 'invalid-bundle',
      message: expect.any(String),
      problems: ['base: is not what this server generates from the stored snapshot and generation request'],
    })
    expect((await target.call('GET', '/v1/forms/order/versions', admin)).statusCode).toBe(404)
  })

  // Production's table has lost approved_by, which the form binds: served
  // there, every save would name a column the database no longer has.
  // Refused with that change alone, and production's store stays empty.
  test('production without a bound column refuses the import as incompatible, and writes nothing', async () => {
    await ddl.run(DDL[connection].drop)
    const refused = await production.call('POST', '/v1/forms/order/imports', admin, { expectedBase: null, bundle })
    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json()).toMatchObject({
      code: 'incompatible',
      changes: [{ kind: 'column-dropped', severity: 'blocking', subject: { name: 'approved_by' } }],
    })
    expect(refused.json().changes).toHaveLength(1)
    expect((await production.call('GET', '/v1/forms/order/versions', admin)).statusCode).toBe(404)
  })

  // The column back, nothing the form rests on differs, and the import is
  // version 1 in production, the same bytes development's store wrote.
  // Production's runtime then serves what development reviewed: a clerk
  // finds their customer, creates an order at the largest amount
  // numeric(18,4) holds, and reads it back exactly.
  test('with the column put back, the import is version 1, and a clerk creates and reads back an order exactly', async () => {
    await ddl.run(DDL[connection].restore)
    const imported = await production.call('POST', '/v1/forms/order/imports', admin, { expectedBase: null, bundle })
    expect(imported.statusCode, imported.body).toBe(201)
    expect(imported.json()).toMatchObject({ version: 1, drift: { blocking: false } })
    expect(await readFile(join(production.root, 'order', '1.json'), 'utf8')).toBe(await readFile(join(development.root, 'order', '1.json'), 'utf8'))

    const definition = (await production.call('GET', '/v1/forms/order', clerk)).json()
    const source = definition.form.model.fields.find((field: { key: string }) => field.key === 'customer').optionsSource as string
    const options = (await production.call('POST', `/v1/forms/order/lookups/${source}/query`, clerk, { operation: 'create', search: 'Muster' })).json()
    expect(options.rows.map((row: { label: string }) => row.label)).toEqual(['Muster AG'])
    const answers = {
      customer: options.rows[0].token as string,
      order_date: EDGE_VALUES.orderDate,
      status: 'placed',
      amount: EDGE_VALUES.largestAmount,
      notes: 'imported from development',
    }
    const created = await production.call('POST', '/v1/forms/order/records/create', clerk, { answers })
    expect(created.statusCode, created.body).toBe(201)
    const read = await production.call('POST', '/v1/forms/order/records/read', clerk, { record: created.json().record })
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json().answers).toMatchObject(answers)
    expect(read.json().version).toBe(created.json().version)
  })

  // An operator who points production's `erp` at the other engine's
  // database: the version's bindings are for this engine, and drift does
  // not compare across engines. 422, said as the caller's to put right.
  test("production's erp on the other engine refuses the import as other-engine", async () => {
    const elsewhere = await deployment(other)
    const refused = await elsewhere.call('POST', '/v1/forms/order/imports', admin, { expectedBase: null, bundle })
    expect(refused.statusCode, refused.body).toBe(422)
    expect(refused.json().code).toBe('other-engine')
    expect((await elsewhere.call('GET', '/v1/forms/order/versions', admin)).statusCode).toBe(404)
  })

  // Production's `erp` as formancy_writer, the account that holds only
  // the grants the order form needs (0027), where development discovered
  // as the owner. The import decides with drift's rules and nothing else:
  // a gate of its own could refuse what drift allows, or allow what it
  // blocks. Measured on 2026-10-14 against postgres:17-alpine and
  // mssql/server:2022-latest, drift blocks on both: another account, and
  // UPDATE on columns the owner's snapshot said the form writes -- a version
  // moved to a deployment with a narrower account is regenerated there.
  // Refused with exactly drift's blocking changes, and nothing written.
  test("production's erp as the order form's account does exactly what drift between the two snapshots says", async () => {
    const writer = await deployment(connection, 'writer')
    const discovered = await writer.call('GET', '/v1/connections/erp/metadata', admin)
    expect(discovered.statusCode, discovered.body).toBe(200)
    const drift = diffSnapshots(bundle.snapshot, discovered.json() as MetadataSnapshot, bundle.bindings, bundle.policy)
    expect(drift.blocking).toBe(true)
    const imported = await writer.call('POST', '/v1/forms/order/imports', admin, { expectedBase: null, bundle })
    expect(imported.statusCode, imported.body).toBe(409)
    expect(imported.json()).toEqual({
      code: 'incompatible',
      message: expect.any(String),
      changes: drift.changes.filter((change) => change.severity === 'blocking'),
    })
    expect((await writer.call('GET', '/v1/forms/order/versions', admin)).statusCode).toBe(404)
  })
})
