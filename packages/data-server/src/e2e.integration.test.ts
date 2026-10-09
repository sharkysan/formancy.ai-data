import { createSecretKey } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION, presentationOf } from '@formancy/data-core'
import type { FieldBinding, FieldWrites, FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot, PresentationOverrides } from '@formancy/data-core'
import { EDGE_VALUES, startPostgresFixture, startSqlServerFixture, WRITER } from '@formancy/data-fixtures'
import type { PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { FormSchema, LayoutNode } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
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
 *
 * Then again through the order form's own account, formancy_writer (0027):
 * what it may not UPDATE is written on create only, and the policy on
 * customer shows it tenant 1's rows only, whoever the clerk is.
 *
 * Last, plan section 14's demonstration step 8 (0030): the order table is
 * altered under a published form with a presentation, the form regenerated
 * and restored. It changes the shared sales.order, so it runs after every
 * other journey in this file.
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
  // The same databases as the order form's account, which holds only the grants that form needs.
  const pgConnection = connections[0] as ConnectionConfig
  const msConnection = connections[1] as ConnectionConfig
  connections.push(
    { ...pgConnection, id: 'pg-writer', user: WRITER.user, password: 'env:PG_WRITER_PASSWORD' },
    { ...msConnection, id: 'ms-writer', user: WRITER.user, password: 'env:MS_WRITER_PASSWORD' },
  )
  registry = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: {
      PG_PASSWORD: decodeURIComponent(pgUrl.password),
      MS_PASSWORD: String(ms.admin.password),
      PG_WRITER_PASSWORD: WRITER.postgresPassword,
      MS_WRITER_PASSWORD: WRITER.sqlServerPassword,
    },
    readFile: async () => '',
  })
  root = await mkdtemp(join(tmpdir(), 'formancy-data-e2e-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: 'tid' } })
  // The administrator's trail is admin-audit.test.ts's subject; here it is required and discarded.
  app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store } })
  admin = await token('admin-1', { roles: ['data-admin'] })
  clerk = await token('clerk-1', { roles: ['clerk'], tid: 1 })
  otherClerk = await token('clerk-2', { roles: ['clerk'], tid: 2 })
})

afterAll(async () => {
  await app?.close()
  await registry?.close()
  await Promise.all([pg?.stop(), ms?.stop()])
  // Unset when a fixture failed to start: the cause is that failure, and an
  // rm of undefined here would report a second, misleading one.
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

const call = (method: 'GET' | 'POST', url: string, bearer: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) })

/** A proposal as the server answers it. */
interface Proposal {
  form: FormSchema
  bindings: FormBindings
  snapshot: MetadataSnapshot
  generation: GenerationRequest
}

/** A proposal published as proposed: format 2, nothing chosen over the generated base (0030). */
function asProposed(connection: string, { form, bindings, snapshot, generation }: Proposal, policy: FormPolicy) {
  return { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot }
}

/** A clerk may do everything the form offers, on the fields it writes on either operation; read-only fields are readable only. */
function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
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
    const proposed = proposal.json() as Proposal
    expect(proposed.bindings.operations).toEqual({ create: true, update: true })
    const bundle = asProposed(connection, proposed, clerkPolicy(proposed.bindings.fields))
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

/** What the writer's order form writes on each operation, by engine: the two must agree. */
const writerWrites = new Map<string, Array<[string, FieldWrites]>>()

describe.each([
  { engine: 'PostgreSQL', connection: 'pg-writer', versionColumn: 'row_version' as string | undefined },
  { engine: 'SQL Server', connection: 'ms-writer', versionColumn: undefined },
])("a form proposed through the order form's own account on $engine", ({ connection, versionColumn }) => {
  const formId = `${connection}-order`

  // Generation offers what the account may do and nothing else (0027). The
  // writer may insert every column of an order and update four of them — on
  // PostgreSQL also the version column — so both operations are offered,
  // with amount written on create only; its customer rows are policed.
  test('offers create and update, writes on create only what it may not UPDATE, and notes the policy on customer', async () => {
    const proposal = await call('POST', '/v1/form-proposals', admin, {
      connection,
      root: { schema: 'sales', name: 'order' },
      formId,
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    expect(proposal.statusCode, proposal.body).toBe(200)
    const proposed = proposal.json()
    const { bindings, snapshot, notes } = proposed
    expect(snapshot.account.user).toBe(WRITER.user)
    expect(bindings.operations).toEqual({ create: true, update: true })
    const fields = bindings.fields as FieldBinding[]
    expect(fields.find((binding) => binding.field === 'amount')?.writes).toEqual({ create: true, update: false })
    expect(fields.find((binding) => binding.field === 'status')?.writes).toEqual({ create: true, update: true })
    expect(notes).toContainEqual(expect.objectContaining({ subject: 'customer', kind: 'access', message: expect.stringMatching(/^Row-level security applies to this connection on sales\.customer/) }))
    writerWrites.set(connection.slice(0, 2), fields.map((binding): [string, FieldWrites] => [binding.field, binding.writes]))

    const bundle = asProposed(connection, proposed, clerkPolicy(fields))
    const published = await call('POST', `/v1/forms/${formId}/versions`, admin, { expectedBase: null, bundle })
    expect(published.statusCode, published.body).toBe(201)
  })

  // The policy on customer compares the database's own principal, not the
  // clerk: through the writer, tenant 2's customer is hidden from every clerk,
  // where the owner's form offers it to tenant 2's (the journey above).
  test("its customer lookup offers tenant 1's customer to tenant 1's clerk, and nothing to tenant 2's", async () => {
    const definition = (await call('GET', `/v1/forms/${formId}`, clerk)).json()
    const source = definition.form.model.fields.find((field: { key: string }) => field.key === 'customer').optionsSource as string
    const mine = (await call('POST', `/v1/forms/${formId}/lookups/${source}/query`, clerk, { operation: 'create', search: '' })).json()
    expect(mine.rows.map((row: { label: string }) => row.label)).toEqual(['Muster AG'])
    const theirs = (await call('POST', `/v1/forms/${formId}/lookups/${source}/query`, otherClerk, { operation: 'create', search: '' })).json()
    expect(theirs.rows).toEqual([])
  })

  // A field written on create only is shown enabled on update — formancy has
  // no per-operation mode — and a changed value there is a write the database
  // would refuse: refused as over-posting, 403, before the database is asked.
  // An unchanged echo of it is dropped, and the change the account may make is saved.
  test('creates, is refused a changed amount on update, and saves status', async () => {
    const definition = (await call('GET', `/v1/forms/${formId}`, clerk)).json()
    const source = definition.form.model.fields.find((field: { key: string }) => field.key === 'customer').optionsSource as string
    const customer = (await call('POST', `/v1/forms/${formId}/lookups/${source}/query`, clerk, { operation: 'create', search: 'Muster' })).json().rows[0].token as string
    const created = await call('POST', `/v1/forms/${formId}/records/create`, clerk, {
      answers: { customer, order_date: EDGE_VALUES.orderDate, status: 'placed', amount: '5', notes: 'through the writer' },
    })
    expect(created.statusCode, created.body).toBe(201)
    const { record, version } = created.json()
    const read = (await call('POST', `/v1/forms/${formId}/records/read`, clerk, { record })).json()

    const changed = await call('POST', `/v1/forms/${formId}/records/update`, clerk, { record, version, answers: { ...read.answers, amount: '6' } })
    expect(changed.statusCode, changed.body).toBe(403)
    expect(changed.json()).toMatchObject({ code: 'over-posting' })

    const saved = await call('POST', `/v1/forms/${formId}/records/update`, clerk, { record, version, answers: { ...read.answers, status: 'shipped' } })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json().answers).toMatchObject({ status: 'shipped', amount: '5.0000' })
  })
})

describe("the order form's own account on both engines", () => {
  // The same grants on both engines must generate the same form: an engine
  // that read a privilege differently would offer a write the other refuses.
  // The version column is no field on either, so every field must agree.
  test('the fields write the same on each operation on PostgreSQL and SQL Server', () => {
    expect(writerWrites.get('pg')).toBeDefined()
    expect(writerWrites.get('ms')).toEqual(writerWrites.get('pg'))
  })
})

/**
 * Statements on the database's owner, which is who changes a schema. The
 * DDL is plan section 14's step 8, measured on both servers first
 * (2026-10-09): SQL Server refuses to drop a column a foreign key uses, so
 * the constraint goes first there; PostgreSQL drops it with the column.
 * Neither needed a grant revoked.
 */
const STEP_8 = {
  pg: {
    compatible: [
      'alter table sales."order" add column reference varchar(40)',
      'alter table sales."order" alter column "group" type varchar(60)',
      `alter table sales."order" drop constraint ck_order_status, add constraint ck_order_status check (status in ('draft', 'placed', 'shipped', 'cancelled'))`,
    ],
    incompatible: ['alter table sales."order" drop column approved_by'],
  },
  ms: {
    compatible: [
      'alter table sales.[order] add reference nvarchar(40) null',
      'alter table sales.[order] alter column [group] nvarchar(60) null',
      `alter table sales.[order] drop constraint ck_order_status; alter table sales.[order] add constraint ck_order_status check (status in ('draft', 'placed', 'shipped', 'cancelled'))`,
    ],
    incompatible: ['alter table sales.[order] drop constraint fk_order_approved_by', 'alter table sales.[order] drop column approved_by'],
  },
} as const

/** Runs statements as the owner, one batch each, on a connection of its own that the suite closes. */
async function owner(connection: 'pg' | 'ms'): Promise<{ run(statements: readonly string[]): Promise<void>; close(): Promise<void> }> {
  if (connection === 'pg') {
    const url = new URL(pg.admin)
    const sql = connectPostgres({
      host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), tls: { enabled: false, rejectUnauthorized: false },
    })
    return { run: async (statements) => { for (const statement of statements) await sql.unsafe(statement) }, close: () => sql.end({ timeout: 5 }) }
  }
  const pool = await connectSqlServer({
    host: String(ms.admin.server), port: Number(ms.admin.port), database: String(ms.admin.database), user: String(ms.admin.user), password: String(ms.admin.password), encrypt: false, trustServerCertificate: true,
  })
  return { run: async (statements) => { for (const statement of statements) await pool.request().batch(statement) }, close: () => pool.close() }
}

type Grid = { kind: 'table'; columns: number; children: Array<{ kind: 'field'; path: string; span?: 'all' }> }
const sectionsOf = (form: FormSchema) => (form.layouts?.[0]?.nodes ?? []) as Array<{ kind: 'section'; label: string; children: LayoutNode[] }>
const orderOf = (form: FormSchema) => (sectionsOf(form)[0]?.children[0] as Grid).children.map((node) => node.path)

describe.each([
  { engine: 'PostgreSQL', connection: 'pg' as const, versionColumn: 'row_version' as string | undefined },
  { engine: 'SQL Server', connection: 'ms' as const, versionColumn: undefined },
])('a published form through a change to its table on $engine (plan section 14, step 8)', ({ connection, versionColumn }) => {
  const formId = `${connection}-evolve`
  let ddl: Awaited<ReturnType<typeof owner>>
  let proposal: Proposal
  let edited: FormSchema
  let presentation: PresentationOverrides
  const file = (version: number) => readFile(join(root, formId, `${String(version)}.json`), 'utf8')
  const versions = async () => (await call('GET', `/v1/forms/${formId}/versions`, admin)).json().versions as number[]

  beforeAll(async () => {
    ddl = await owner(connection)
  })
  afterAll(async () => {
    await ddl?.close()
  })

  // Steps 1 and 2: propose with the journey's request, then the studio's
  // four edits, made by JSON as builder-core makes them. The presentation
  // derived holds exactly those edits.
  test('an administrator proposes the order form and edits its presentation', async () => {
    const response = await call('POST', '/v1/form-proposals', admin, {
      connection, root: { schema: 'sales', name: 'order' }, formId, title: 'Order', lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }], ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    expect(response.statusCode, response.body).toBe(200)
    proposal = response.json() as Proposal
    expect(orderOf(proposal.form)).toEqual(['customer', 'order_date', 'status', 'amount', 'notes', 'group', 'created_by', 'approved_by'])

    edited = JSON.parse(JSON.stringify(proposal.form)) as FormSchema
    for (const [key, label] of [['notes', 'Delivery notes'], ['approved_by', 'Approver']] as const) {
      const field = edited.model.fields.find((entry) => entry.key === key)
      if (field !== undefined) field.label = label
    }
    const order = sectionsOf(edited)[0] as { label: string; children: LayoutNode[] }
    order.label = 'Order details'
    const nodes = (order.children[0] as Grid).children
    nodes.splice(3, 0, ...nodes.splice(4, 1))
    const group = nodes.find((node) => node.path === 'group')
    if (group !== undefined) group.span = 'all'

    const derived = presentationOf(proposal.form, edited, proposal.bindings)
    expect(derived.ok, derived.ok ? '' : derived.problems.join('; ')).toBe(true)
    presentation = (derived as { presentation: PresentationOverrides }).presentation
    expect(presentation).toEqual({
      version: 1,
      fields: [
        { field: 'notes', anchor: { kind: 'column', column: 'notes' }, label: 'Delivery notes' },
        { field: 'group', anchor: { kind: 'column', column: 'group' }, span: 'all' },
        { field: 'approved_by', anchor: { kind: 'column', column: 'approved_by' }, label: 'Approver' },
      ],
      sections: [{ anchor: { label: 'Order', occurrence: 0 }, label: 'Order details', order: ['customer', 'order_date', 'status', 'notes', 'amount', 'group', 'created_by', 'approved_by'] }],
    })
  })

  // Step 3: published as version 1, its presentation beside its base.
  test('publishes version 1 with that presentation', async () => {
    const bundle = { ...asProposed(connection, proposal, clerkPolicy(proposal.bindings.fields)), presentation, form: edited }
    const published = await call('POST', `/v1/forms/${formId}/versions`, admin, { expectedBase: null, bundle })
    expect(published.statusCode, published.body).toBe(201)
  })

  // Step 4: a compatible change. Measured on both servers: a nullable
  // column, a wider text column and a replaced check are, for this form, one
  // thing to review and two to note — nothing it rests on stops.
  test('a compatible change to the table is reviewed and blocks nothing', async () => {
    await ddl.run(STEP_8[connection].compatible)
    const drift = (await call('POST', `/v1/forms/${formId}/drift`, admin)).json()
    expect(drift.blocking).toBe(false)
    expect(drift.changes.map((change: { kind: string; severity: string }) => [change.kind, change.severity])).toEqual([
      ['column-added', 'review'],
      ['check-changed', 'info'],
      ['column-loosened', 'info'],
    ])
  })

  // Steps 5 and 6: regenerated, the person's four edits come through
  // untouched, the new column goes after its generated predecessor, and
  // the wider column is wider in the form. Published from it, the form and
  // the database agree again.
  test('a regeneration carries the presentation, and its publish leaves no drift', async () => {
    const response = await call('POST', `/v1/forms/${formId}/regenerations`, admin)
    expect(response.statusCode, response.body).toBe(200)
    const regeneration = response.json()
    expect(regeneration).toMatchObject({ version: 1, conflicts: [], lookupsDropped: [], keysReassigned: [], policyProblems: [] })
    expect(canonicalize(regeneration.presentation.fields)).toBe(canonicalize(presentation.fields))
    expect(orderOf(regeneration.form)).toEqual(['customer', 'order_date', 'status', 'notes', 'amount', 'group', 'created_by', 'approved_by', 'reference'])
    expect(regeneration.form.model.fields.find((field: { key: string }) => field.key === 'group')).toMatchObject({ maxLength: 60, label: 'Group' })

    const { version, drift: _drift, policyProblems: _problems, conflicts: _conflicts, lookupsDropped: _dropped, keysReassigned: _keys, notes: _notes, ...parts } = regeneration
    const published = await call('POST', `/v1/forms/${formId}/versions`, admin, { expectedBase: version, bundle: { format: 2, connection, ...parts } })
    expect(published.statusCode, published.body).toBe(201)
    expect((await call('POST', `/v1/forms/${formId}/drift`, admin)).json()).toMatchObject({ version: 2, changes: [], blocking: false })
  })

  // Step 7: version 1 still fits the database, so it may be restored, as a
  // new version holding the same document; this store wrote version 1, so
  // the new file holds the same bytes.
  test('version 1 is restored, in the same bytes, as version 3', async () => {
    const restored = await call('POST', `/v1/forms/${formId}/restorations`, admin, { version: 1, expectedBase: 2 })
    expect(restored.statusCode, restored.body).toBe(201)
    expect(restored.json()).toMatchObject({ version: 3, restoredFrom: 1 })
    expect(await file(3)).toBe(await file(1))
    expect(await versions()).toEqual([1, 2, 3])
  })

  // Steps 8 and 9: an incompatible change. Version 2 binds approved_by, so
  // restoring it would publish a form whose writes fail: refused, with the
  // change that blocks it, and nothing written.
  test('after approved_by is dropped, restoring version 2 is refused as incompatible', async () => {
    await ddl.run(STEP_8[connection].incompatible)
    const refused = await call('POST', `/v1/forms/${formId}/restorations`, admin, { version: 2, expectedBase: 3 })
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ code: 'incompatible', changes: [{ kind: 'column-dropped', severity: 'blocking', subject: { name: 'approved_by' } }] })
    expect(refused.json().changes).toHaveLength(1)
    expect(await versions()).toEqual([1, 2, 3])
  })

  // Steps 10 and 11: regenerated from version 3 — version 1's content — the
  // label chosen for the dropped column is the one thing reported, the
  // order loses only that field, and the published policy's grant for it
  // is named. Published with a policy for the new fields, the clerk sees
  // the person's labels and nothing the database no longer has.
  test('a regeneration reports the dropped label, and the form published from it serves the presentation', async () => {
    const regeneration = (await call('POST', `/v1/forms/${formId}/regenerations`, admin)).json()
    expect(regeneration.version).toBe(3)
    expect(regeneration.conflicts).toEqual([
      { kind: 'field-gone', field: 'approved_by', anchor: { kind: 'column', column: 'approved_by' }, property: 'label', yours: 'Approver', resolution: 'dropped', message: expect.any(String) },
    ])
    expect(orderOf(regeneration.form)).toEqual(['customer', 'order_date', 'status', 'notes', 'amount', 'group', 'created_by', 'reference'])
    expect(regeneration.policyProblems).toContain('policy: fields.approved_by: the form has no field approved_by')

    const { version, drift: _drift, policyProblems: _problems, conflicts: _conflicts, lookupsDropped: _dropped, keysReassigned: _keys, notes: _notes, ...parts } = regeneration
    const bundle = { format: 2, connection, ...parts, policy: clerkPolicy(regeneration.bindings.fields) }
    const published = await call('POST', `/v1/forms/${formId}/versions`, admin, { expectedBase: version, bundle })
    expect(published.statusCode, published.body).toBe(201)
    expect(published.json()).toEqual({ version: 4 })
    expect((await call('POST', `/v1/forms/${formId}/drift`, admin)).json()).toMatchObject({ changes: [], blocking: false })

    const served = (await call('GET', `/v1/forms/${formId}`, clerk)).json().form as FormSchema
    expect(served.model.fields.find((field) => field.key === 'notes')?.label).toBe('Delivery notes')
    expect(sectionsOf(served)[0]?.label).toBe('Order details')
    expect(served.model.fields.some((field) => field.key === 'approved_by')).toBe(false)
  })
})
