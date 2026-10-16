import { createSecretKey } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FieldBinding, FormBindings, FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import { EDGE_VALUES, startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { LightMyRequestResponse } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry } from '../connections.js'
import { DRIVER_FACTORIES } from '../drivers.js'
import { createIdentityVerifier } from '../identity.js'

/*
 * Publication under review (0065), on both engines, against the shared
 * fixture's real servers: a deployment whose publisher roles are set, with
 * real tokens whose `sub` is who submitted and who approved.
 *
 * An author proposes the order form and submits it as a draft; nothing is
 * served. The database's owner then drops approved_by, a column the form
 * binds, with plan section 14 step 8's DDL: the publisher's approval asks
 * the database again and is refused with that change alone, and nothing is
 * written. The column put back, the author still cannot approve their own
 * draft, the publisher approves it, the version written is the draft's
 * bundle, and a clerk creates an order through the runtime and reads it
 * back exactly.
 */

const SECRET = 'a-review-host-secret-of-32-bytes-ok!!'
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

/** approved_by dropped and put back with its foreign key, as admin-promotion.integration.test.ts does it, one batch each. */
const DDL: Record<Engine, { drop: string[]; restore: string[] }> = {
  pg: {
    drop: ['alter table sales."order" drop column approved_by'],
    restore: ['alter table sales."order" add column approved_by integer, add constraint fk_order_approved_by foreign key (approved_by) references sales.employee (id)'],
  },
  ms: {
    drop: ['alter table sales.[order] drop constraint fk_order_approved_by', 'alter table sales.[order] drop column approved_by'],
    restore: ['alter table sales.[order] add approved_by int null', 'alter table sales.[order] add constraint fk_order_approved_by foreign key (approved_by) references sales.employee (id)'],
  },
}

let pg: PostgresFixture
let ms: SqlServerFixture
let verifyIdentity: Awaited<ReturnType<typeof createIdentityVerifier>>
let author: string
let publisher: string
let clerk: string
const registries: ConnectionRegistry[] = []
const roots: string[] = []

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
  verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: 'tid' } })
  author = await token('author-1', { roles: ['data-admin'] })
  publisher = await token('publisher-1', { roles: ['data-admin', 'data-publisher'] })
  clerk = await token('clerk-1', { roles: ['clerk'], tid: 1 })
})

afterAll(async () => {
  await Promise.all(registries.map((registry) => registry.close()))
  await Promise.all([pg?.stop(), ms?.stop()])
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

/** `erp` on one engine's database, as its owner. */
function erp(engine: Engine): { config: ConnectionConfig; password: string } {
  if (engine === 'pg') {
    const url = new URL(pg.admin)
    // The fixture's containers speak no TLS. A real allowlist leaves it on.
    const config: ConnectionConfig = { id: 'erp', kind: 'postgres', host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: 'env:ERP_PASSWORD', schemas: ['sales'], tls: { enabled: false } }
    return { config, password: decodeURIComponent(url.password) }
  }
  const config: ConnectionConfig = { id: 'erp', kind: 'sqlserver', host: String(ms.admin.server), port: Number(ms.admin.port), database: String(ms.admin.database), user: String(ms.admin.user), password: 'env:ERP_PASSWORD', schemas: ['sales'], tls: { enabled: false, trustServerCertificate: true } }
  return { config, password: String(ms.admin.password) }
}

interface Deployment {
  root: string
  call(method: 'GET' | 'POST', url: string, bearer: string, payload?: unknown): Promise<LightMyRequestResponse>
}

/** Both planes, a store of its own, `erp` on `engine`, and publication under review. */
async function deployment(engine: Engine): Promise<Deployment> {
  const { config, password } = erp(engine)
  const registry = createConnectionRegistry([config], DRIVER_FACTORIES, { env: { ERP_PASSWORD: password }, readFile: async () => '' })
  registries.push(registry)
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-review-'))
  roots.push(root)
  const store = createFileConfigurationStore(root)
  // The administrator's trail is admin-audit.test.ts's subject; here it is required and discarded.
  const app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin', 'data-publisher'], publisherRoles: ['data-publisher'], audit: { sink: () => {} } }, runtime: { registry, store } })
  return {
    root,
    call: (method, url, bearer, payload) => app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) }),
  }
}

/** Statements as the database's owner, which is who changes a schema, one batch each. */
async function owner(engine: Engine): Promise<{ run(statements: readonly string[]): Promise<void>; close(): Promise<void> }> {
  if (engine === 'pg') {
    const url = new URL(pg.admin)
    const sql = connectPostgres({ host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), tls: { enabled: false, rejectUnauthorized: false } })
    return { run: async (statements) => { for (const statement of statements) await sql.unsafe(statement) }, close: () => sql.end({ timeout: 5 }) }
  }
  const pool = await connectSqlServer({ host: String(ms.admin.server), port: Number(ms.admin.port), database: String(ms.admin.database), user: String(ms.admin.user), password: String(ms.admin.password), encrypt: false, trustServerCertificate: true })
  return { run: async (statements) => { for (const statement of statements) await pool.request().batch(statement) }, close: () => pool.close() }
}

/** A clerk does everything the form offers, on their own tenant's orders and customers. */
function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
  }
}

describe.each([
  { engine: 'PostgreSQL', connection: 'pg' as const, versionColumn: 'row_version' as string | undefined },
  { engine: 'SQL Server', connection: 'ms' as const, versionColumn: undefined },
])('the order form published under review on $engine', ({ connection, versionColumn }) => {
  let deployed: Deployment
  let ddl: Awaited<ReturnType<typeof owner>>
  let bundle: Record<string, unknown>

  beforeAll(async () => {
    ;[deployed, ddl] = await Promise.all([deployment(connection), owner(connection)])
  })
  afterAll(async () => {
    await ddl?.close()
  })

  // The author proposes from the database and submits what the studio
  // would have published: a draft, which nobody's runtime serves. Their
  // direct publish is refused, as a publisher's would be.
  test('an author submits the order form as a draft, and nothing is served', async () => {
    const proposal = await deployed.call('POST', '/v1/form-proposals', author, {
      connection: 'erp', root: { schema: 'sales', name: 'order' }, formId: 'order', title: 'Order', lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }], ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    expect(proposal.statusCode, proposal.body).toBe(200)
    const { form, bindings, snapshot, generation } = proposal.json() as { form: unknown; bindings: FormBindings; snapshot: MetadataSnapshot; generation: unknown }
    bundle = { format: 2, connection: 'erp', generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy: clerkPolicy(bindings.fields), snapshot }
    const direct = await deployed.call('POST', '/v1/forms/order/versions', author, { expectedBase: null, bundle })
    expect([direct.statusCode, direct.json().code]).toEqual([403, 'review-required'])
    const submitted = await deployed.call('POST', '/v1/forms/order/drafts', author, { expectedBase: null, bundle })
    expect(submitted.statusCode, submitted.body).toBe(201)
    expect(submitted.json()).toMatchObject({ draft: 1, state: 'pending', drift: { blocking: false } })
    expect((await deployed.call('GET', '/v1/forms/order', clerk)).statusCode).toBe(404)
  })

  // Between submit and approval the database lost approved_by, which the
  // form binds: an approval that trusted the submit's check would publish
  // a form every save of which the database refuses. It discovers again
  // and is refused with that change alone; nothing is written, and the
  // draft still waits.
  test('a bound column dropped after the submit refuses the approval as incompatible, and writes nothing', async () => {
    await ddl.run(DDL[connection].drop)
    const refused = await deployed.call('POST', '/v1/forms/order/drafts/1/approval', publisher)
    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json()).toMatchObject({ code: 'incompatible', changes: [{ kind: 'column-dropped', severity: 'blocking', subject: { name: 'approved_by' } }] })
    expect(refused.json().changes).toHaveLength(1)
    expect((await deployed.call('GET', '/v1/forms/order/versions', author)).statusCode).toBe(404)
    expect((await deployed.call('GET', '/v1/forms/order/drafts/1', publisher)).json()).toMatchObject({ state: 'pending' })
  })

  // The column back, the author's own approval is refused -- approving is
  // a publisher's -- and the publisher's writes version 1, the draft's
  // bundle exactly. The
  // runtime then serves what was reviewed: a clerk finds their customer,
  // creates an order at the largest amount numeric(18,4) holds, and reads
  // it back exactly.
  test('with the column back, the publisher approves, and a clerk creates and reads back an order exactly', async () => {
    await ddl.run(DDL[connection].restore)
    const own = await deployed.call('POST', '/v1/forms/order/drafts/1/approval', author)
    expect([own.statusCode, own.json().code]).toEqual([403, 'publisher-required'])
    const approved = await deployed.call('POST', '/v1/forms/order/drafts/1/approval', publisher)
    expect(approved.statusCode, approved.body).toBe(201)
    expect(approved.json()).toMatchObject({ version: 1, drift: { blocking: false } })
    expect(await readFile(join(deployed.root, 'order', '1.json'), 'utf8')).toBe(`${JSON.stringify(bundle, null, 2)}\n`)

    const definition = (await deployed.call('GET', '/v1/forms/order', clerk)).json()
    const source = definition.form.model.fields.find((field: { key: string }) => field.key === 'customer').optionsSource as string
    const options = (await deployed.call('POST', `/v1/forms/order/lookups/${source}/query`, clerk, { operation: 'create', search: 'Muster' })).json()
    expect(options.rows.map((row: { label: string }) => row.label)).toEqual(['Muster AG'])
    const answers = { customer: options.rows[0].token as string, order_date: EDGE_VALUES.orderDate, status: 'placed', amount: EDGE_VALUES.largestAmount, notes: 'approved by a publisher' }
    const created = await deployed.call('POST', '/v1/forms/order/records/create', clerk, { answers })
    expect(created.statusCode, created.body).toBe(201)
    const read = await deployed.call('POST', '/v1/forms/order/records/read', clerk, { record: created.json().record })
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json().answers).toMatchObject(answers)
    expect((await deployed.call('GET', '/v1/forms/order/drafts/1', author)).json()).toMatchObject({ state: 'published', current: 1 })
  })
})
