import { createSecretKey, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION, recordToken } from '@formancy/data-core'
import type { DatabaseKind, FieldBinding, FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot } from '@formancy/data-core'
import { answerBytes, EDGE_VALUES, POSTGRES_IMAGE, SQLSERVER_IMAGE, startPostgresFixture, startSqlServerFixture, startTcpHop } from '@formancy/data-fixtures'
import type { PostgresFixture, SqlServerFixture, TcpHop } from '@formancy/data-fixtures'
import { createIdentityVerifier } from '@formancy/data-identity'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { FormSchema } from '@formancy/spec'
import type { FastifyInstance } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import type { AuditEvent, RuntimeAuditEvent } from './audit.js'
import { recordReference } from './audit.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from './connections.js'
import { createConnectionRegistry } from './connections.js'
import { DRIVER_FACTORIES } from './drivers.js'

/*
 * Release gate 6 (0031): a write whose answer is lost after the database
 * committed it is reported as unknown, and nothing in the product sends it
 * again. On both engines, end to end: HTTP into the real server, through the
 * real drivers and their own pools, into the shared fixture -- with a TCP hop
 * in front of each database that drops the answer to the write after the
 * database has sent it. Every byte is the driver's and the server's; only the
 * network fails, so this is not a mocked driver (0003).
 *
 * Each case marks its write with a text its answer echoes -- the order's
 * notes, the customer's name -- and the hop swallows the answer carrying it.
 * A matched answer is not yet proof of a commit (PostgreSQL sends a deferred
 * constraint's refusal after the row, P2b), so the owner's own connection,
 * which does not go through the hop, is polled until the write is visible
 * before the connection is cut. Then the hop says how many times the marker
 * crossed it towards the database: once, or something replayed it.
 *
 * Its own containers, so the rows it leaves behind are no other suite's
 * business, and its own audit sink with a key, so the trail is checked too.
 */
const SECRET = 'a-lost-answer-host-secret-of-32-bytes!'
const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'
const AUDIT_KEY = 'the-lost-answer-suite-audit-key'

async function token(subject: string, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ sub: subject, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('10m')
    .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
}

/** How many rows a counting statement finds, on the owner's own connection around the hop: what the database holds, asked by somebody else. */
type Count = (connection: 'pg' | 'ms', statement: { pg: string; ms: string }, text: string) => Promise<number>

let pg: PostgresFixture
let ms: SqlServerFixture
let hops: Record<'pg' | 'ms', TcpHop>
let count: Count
/** A row of lost.removable inserted by the owner, around the hop: its id. */
let insertRemovable: (connection: 'pg' | 'ms', code: string) => Promise<string>
let closeOwners: () => Promise<void>
let root: string
let registry: ConnectionRegistry
let app: FastifyInstance
let admin: string
let clerk: string
const events: AuditEvent[] = []

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(POSTGRES_IMAGE), startSqlServerFixture(SQLSERVER_IMAGE)])
  const pgUrl = new URL(pg.admin)
  hops = {
    pg: await startTcpHop({ kind: 'postgres', host: pgUrl.hostname, port: Number(pgUrl.port) }),
    ms: await startTcpHop({ kind: 'sqlserver', host: String(ms.admin.server), port: Number(ms.admin.port) }),
  }
  // The registry reaches each database through its hop, by the address an operator would write.
  const connections: ConnectionConfig[] = [
    {
      id: 'pg',
      kind: 'postgres',
      host: '127.0.0.1',
      port: hops.pg.port,
      database: pgUrl.pathname.slice(1),
      user: decodeURIComponent(pgUrl.username),
      password: 'env:PG_PASSWORD',
      schemas: ['sales'],
      tls: { enabled: false },
    },
    {
      id: 'ms',
      kind: 'sqlserver',
      host: '127.0.0.1',
      port: hops.ms.port,
      database: String(ms.admin.database),
      user: String(ms.admin.user),
      password: 'env:MS_PASSWORD',
      schemas: ['sales'],
      tls: { enabled: false, trustServerCertificate: true },
    },
  ]
  // A table whose key holds a text a delete's answer echoes (0050), in a schema of its own: `lost`.
  connections.push(
    { ...(connections[0] as ConnectionConfig), id: 'pg-lost', schemas: ['lost'] },
    { ...(connections[1] as ConnectionConfig), id: 'ms-lost', schemas: ['lost'] },
  )
  registry = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: { PG_PASSWORD: decodeURIComponent(pgUrl.password), MS_PASSWORD: String(ms.admin.password) },
    readFile: async () => '',
  })

  // The owners' own connections, straight to the databases.
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
  await pgOwner.unsafe(
    'create schema lost; create table lost.removable (id integer generated always as identity, code varchar(100) not null, version integer not null default 1, primary key (id, code))',
  )
  await msOwner.request().batch('create schema lost')
  await msOwner
    .request()
    .batch(
      'create table lost.removable (id int identity(1, 1) not null, code nvarchar(100) not null, version int not null constraint df_lost_removable_version default 1, constraint pk_lost_removable primary key (id, code))',
    )
  insertRemovable = async (connection, code) => {
    if (connection === 'pg')
      return (await pgOwner.unsafe<Array<{ id: string }>>('insert into lost.removable (code) values ($1) returning id::text as id', [code]))[0]?.id ?? ''
    return String(
      (await msOwner.request().input('code', code).query<{ id: number }>('insert into lost.removable (code) output inserted.id values (@code)')).recordset[0]
        ?.id,
    )
  }
  count = async (connection, statement, text) => {
    if (connection === 'pg') return (await pgOwner.unsafe<Array<{ n: number }>>(statement.pg, [text]))[0]?.n ?? 0
    return (await msOwner.request().input('text', text).query<{ n: number }>(statement.ms)).recordset[0]?.n ?? 0
  }
  closeOwners = async () => {
    await pgOwner.end({ timeout: 5 })
    await msOwner.close()
  }

  root = await mkdtemp(join(tmpdir(), 'formancy-data-lost-answer-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({
    key: { kind: 'secret', secret: SECRET },
    issuer: ISSUER,
    audience: AUDIENCE,
    attributes: { tenant: 'tid' },
  })
  app = await createDataServer({
    verifyIdentity,
    // One sink for both planes, as main.ts wires it; the trail below narrows on `plane`.
    admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: (event) => void events.push(event) } },
    runtime: { registry, store, audit: { sink: (event) => void events.push(event), key: AUDIT_KEY } },
  })
  admin = await token('admin-1', { roles: ['data-admin'] })
  clerk = await token('clerk-1', { roles: ['clerk'], tid: 1 })
})

// The product's own shutdown, awaited, after answers were lost under it: a
// server that cannot close after a cut hangs a rolling deploy. postgres.js
// 3.4.9 keeps a query that failed with its connection as that connection's
// current one, and `end()` without a timeout waits on it for ever; the
// PostgreSQL adapter bounds it at CLOSE_GRACE, five seconds (0031). The hook
// allows longer than that, so a regression in the bound fails here rather
// than being given up on.
afterAll(async () => {
  await app?.close()
  await registry?.close()
  await closeOwners?.()
  await Promise.all([hops?.pg.close(), hops?.ms.close()])
  await Promise.all([pg?.stop(), ms?.stop()])
  await rm(root, { recursive: true, force: true })
}, 60_000)

const call = (url: string, bearer: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${bearer}` }, payload: payload as Record<string, unknown> })

interface Proposal {
  form: FormSchema
  bindings: FormBindings
  snapshot: MetadataSnapshot
  generation: GenerationRequest
}

/** A proposal published as proposed: format 2, nothing chosen over the generated base (0030); e2e.integration's helper. */
function asProposed(connection: string, { form, bindings, snapshot, generation }: Proposal, policy: FormPolicy) {
  return { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot }
}

/** A clerk of a tenant may do what the form offers, on the fields it writes. */
function clerkPolicy(bindings: FormBindings): FormPolicy {
  const fields = bindings.fields
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: bindings.operations.update ? ['clerk'] : [] },
    fields: Object.fromEntries(
      fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }]),
    ),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: Object.fromEntries(
      fields.filter((binding) => binding.kind === 'lookup').map((binding) => [binding.field, [{ column: 'tenant_id', attribute: 'tenant' }]]),
    ),
  }
}

async function publish(connection: string, formId: string, generation: Record<string, unknown>): Promise<void> {
  const proposal = await call('/v1/form-proposals', admin, { connection, formId, ...generation })
  expect(proposal.statusCode, proposal.body).toBe(200)
  const proposed = proposal.json() as Proposal
  const published = await call(`/v1/forms/${formId}/versions`, admin, {
    expectedBase: null,
    bundle: asProposed(connection, proposed, clerkPolicy(proposed.bindings)),
  })
  expect(published.statusCode, published.body).toBe(201)
}

/** A form whose clerks may read and delete every row: lost.removable has no tenant (0050). */
async function publishDeleting(connection: string, formId: string, generation: Record<string, unknown>): Promise<void> {
  const proposal = await call('/v1/form-proposals', admin, { connection, formId, ...generation })
  expect(proposal.statusCode, proposal.body).toBe(200)
  const proposed = proposal.json() as Proposal
  expect(proposed.bindings.operations.delete).toBe(true)
  const policy: FormPolicy = {
    version: 1,
    operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] },
    fields: Object.fromEntries(proposed.bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: [] }])),
    rowFilters: [],
    lookups: {},
  }
  const published = await call(`/v1/forms/${formId}/versions`, admin, { expectedBase: null, bundle: asProposed(connection, proposed, policy) })
  expect(published.statusCode, published.body).toBe(201)
}

/** `promise`, or a failure that says what never happened -- a hop that never matched is a reason, not a timeout. */
async function bounded<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(what)), 20_000)))
  try {
    return await Promise.race([promise, late])
  } finally {
    clearTimeout(timer)
  }
}

/** Polls until `check` passes: a write committed on another connection is visible when it is, not after a sleep. */
async function eventually(check: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      await check()
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

const REMOVABLE_CODED = {
  pg: 'select count(*)::int as n from lost.removable where code = $1',
  ms: 'select count(*) as n from lost.removable where code = @text',
}
const ORDERS_WITH_NOTES = {
  pg: 'select count(*)::int as n from sales."order" where notes = $1',
  ms: 'select count(*) as n from sales.[order] where notes = @text',
}
const CUSTOMERS_NAMED = {
  pg: 'select count(*)::int as n from sales.customer where name = $1',
  ms: 'select count(*) as n from sales.customer where name = @text',
}

describe.each([
  { engine: 'PostgreSQL', connection: 'pg' as const, kind: 'postgres' as DatabaseKind, versionColumn: 'row_version', customerNo: 5101 },
  { engine: 'SQL Server', connection: 'ms' as const, kind: 'sqlserver' as DatabaseKind, versionColumn: undefined, customerNo: 5102 },
])('an answer lost after the commit on $engine', ({ engine, connection, kind, versionColumn, customerNo }) => {
  const orderForm = `${connection}-order`
  const customerForm = `${connection}-customer`
  let customerToken: string
  let source: string

  beforeAll(async () => {
    await publish(connection, orderForm, {
      root: { schema: 'sales', name: 'order' },
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    // A customer is named by its tenant, pinned from the token, and a number the clerk types.
    await publish(connection, customerForm, { root: { schema: 'sales', name: 'customer' }, title: 'Customer', lookups: [], pinned: ['tenant_id'] })
    source = (await app.inject({ method: 'GET', url: `/v1/forms/${orderForm}`, headers: { authorization: `Bearer ${clerk}` } }))
      .json()
      .form.model.fields.find((field: { key: string }) => field.key === 'customer').optionsSource as string
    customerToken = (await call(`/v1/forms/${orderForm}/lookups/${source}/query`, clerk, { operation: 'create', search: 'Muster' })).json().rows[0]
      .token as string
  })

  /**
   * Sends `write` with its answer swallowed by the hop, waits until the owner
   * sees what it wrote, and only then cuts the connection that carried it.
   * Returns the server's answer and how often `marker` has gone to the
   * database: a count that is read when asked, so a case can ask again later.
   */
  async function sentAndLost(marker: string, visible: () => Promise<void>, write: () => ReturnType<typeof call>) {
    const hop = hops[connection]
    const bytes = answerBytes(kind, marker)
    const sent = hop.countSent(bytes)
    const lost = hop.swallowAnswersFrom(bytes)
    const pending = write()
    await bounded(lost.matched, `the marker never appeared in an answer on ${engine}`)
    await eventually(visible)
    lost.cut()
    const response = await pending
    return { response, sent }
  }

  // Gate 6's no-replay proof. An order's key is numbered by the database, so
  // the 502 cannot name it; and the database was asked once -- a server that
  // tried again on a lost answer would have made a second order, which the
  // marker would have crossed the hop a second time to make. Counted twice:
  // as the 502 arrives, and again after one more round trip through the same
  // engine's pool, so a retry the product scheduled for after answering --
  // a timer, a background job -- has had its turn on the wire too.
  test('an order create is 502 with no record, sent once, and exactly one order exists', async () => {
    const notes = `lost create ${connection} ${String(Date.now())}`
    const { response, sent } = await sentAndLost(
      notes,
      async () => expect(await count(connection, ORDERS_WITH_NOTES, notes)).toBe(1),
      () =>
        call(`/v1/forms/${orderForm}/records/create`, clerk, {
          answers: { customer: customerToken, order_date: EDGE_VALUES.orderDate, status: 'placed', amount: '1', notes },
        }),
    )
    expect(response.statusCode, response.body).toBe(502)
    expect(response.json()).toMatchObject({ code: 'unknown-outcome', operation: 'create', record: null, version: null })
    expect(sent()).toBe(1)
    const after = await call(`/v1/forms/${orderForm}/lookups/${source}/query`, clerk, { operation: 'create', search: 'Muster' })
    expect(after.statusCode, after.body).toBe(200)
    expect(sent()).toBe(1)
    expect(await count(connection, ORDERS_WITH_NOTES, notes)).toBe(1)
  })

  // An update protects itself: the version it sent is in the one guarded
  // statement. The 502 hands back both, the change is stored, and saving
  // again with that version is refused as stale -- stored at most once,
  // which is what makes "Saving again is safe" a true sentence.
  test('an order update is 502 with its record and version, is stored once, and a resend is stale', async () => {
    const created = await call(`/v1/forms/${orderForm}/records/create`, clerk, {
      answers: { customer: customerToken, order_date: EDGE_VALUES.orderDate, status: 'placed', amount: '2', notes: 'before' },
    })
    expect(created.statusCode, created.body).toBe(201)
    const { record, version, answers } = created.json() as { record: string; version: string; answers: Record<string, unknown> }
    const notes = `lost update ${connection} ${String(Date.now())}`
    const { response, sent } = await sentAndLost(
      notes,
      async () => expect(await count(connection, ORDERS_WITH_NOTES, notes)).toBe(1),
      () => call(`/v1/forms/${orderForm}/records/update`, clerk, { record, version, answers: { ...answers, notes } }),
    )
    expect(response.statusCode, response.body).toBe(502)
    expect(response.json()).toMatchObject({ code: 'unknown-outcome', operation: 'update', record, version })
    expect(sent()).toBe(1)

    const read = await call(`/v1/forms/${orderForm}/records/read`, clerk, { record })
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json().answers.notes).toBe(notes)
    expect(read.json().version).not.toBe(version)
    const again = await call(`/v1/forms/${orderForm}/records/update`, clerk, { record, version, answers: { ...answers, notes } })
    expect(again.statusCode, again.body).toBe(409)
    expect(again.json()).toMatchObject({ code: 'stale' })

    const trail = events.filter(
      (event): event is RuntimeAuditEvent => event.plane === 'runtime' && event.form === orderForm && event.record === recordReference(AUDIT_KEY, record),
    )
    expect(trail.map(({ operation, status, outcome }) => ({ operation, status, outcome }))).toEqual([
      { operation: 'create', status: 201, outcome: 'ok' },
      { operation: 'update', status: 502, outcome: 'unknown-outcome' },
      { operation: 'read', status: 200, outcome: 'ok' },
      { operation: 'update', status: 409, outcome: 'stale' },
    ])
  })

  // A customer's key is in the insert -- the pinned tenant and the number
  // typed -- so the 502 names it, the host can read it by that token and
  // find it, and a second create of it is refused by the key: the token the
  // server promised is the one the stored row has (intendedRecord).
  test('a customer create is 502 with the record it made, which reads back, and a second create is refused', async () => {
    const name = `Lost Kunde ${connection} ${String(Date.now())}`
    const { response, sent } = await sentAndLost(
      name,
      async () => expect(await count(connection, CUSTOMERS_NAMED, name)).toBe(1),
      () => call(`/v1/forms/${customerForm}/records/create`, clerk, { answers: { customer_no: customerNo, name } }),
    )
    const record = `k1:1,${String(customerNo)}`
    expect(response.statusCode, response.body).toBe(502)
    expect(response.json()).toMatchObject({ code: 'unknown-outcome', operation: 'create', record, version: null })
    expect(sent()).toBe(1)

    const read = await call(`/v1/forms/${customerForm}/records/read`, clerk, { record })
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json()).toMatchObject({ record, answers: { name } })
    const twice = await call(`/v1/forms/${customerForm}/records/create`, clerk, { answers: { customer_no: customerNo, name } })
    expect(twice.statusCode, twice.body).toBe(422)
    expect(twice.json()).toMatchObject({ code: 'unique-violation' })
    expect(await count(connection, CUSTOMERS_NAMED, name)).toBe(1)

    // The trail names the lost create's record as the read that settles it
    // does. The refused second create names none: a create is named by what
    // it made, or by what it would have made when that is unknown.
    const trail = events.filter(
      (event): event is RuntimeAuditEvent => event.plane === 'runtime' && event.form === customerForm && event.record === recordReference(AUDIT_KEY, record),
    )
    expect(trail.map(({ operation, status, outcome }) => ({ operation, status, outcome }))).toEqual([
      { operation: 'create', status: 502, outcome: 'unknown-outcome' },
      { operation: 'read', status: 200, outcome: 'ok' },
    ])
  })

  // A delete protects itself as an update does (0050): the version it sent
  // is in the one guarded statement, and the key it names -- a numbered id
  // and a fresh UUID, the marker the statement's answer echoes -- is never
  // another record's. The 502 hands back both, the row is gone, the
  // database was asked once, and deleting again with that version is not
  // found and deletes nothing else. The trail names the record twice, by
  // its keyed hash (watched failing with the route asking the adapter again
  // after a lost answer: the second statement found nothing, and the person
  // was told 404 about a record the first one had deleted).
  test('a delete is 502 with its record and version, sent once, the row gone, and a resend is not found', async () => {
    const formId = `${connection}-removable-lost`
    await publishDeleting(`${connection}-lost`, formId, {
      root: { schema: 'lost', name: 'removable' },
      title: 'Removable',
      lookups: [],
      versionColumn: 'version',
    })
    const code = randomUUID()
    const id = await insertRemovable(connection, code)
    const token = recordToken(['id', 'code'], { id, code })
    if (!token.ok) throw new Error(token.message)
    const record = token.token
    const { response, sent } = await sentAndLost(
      code,
      async () => expect(await count(connection, REMOVABLE_CODED, code)).toBe(0),
      () => call(`/v1/forms/${formId}/records/delete`, clerk, { record, version: '1' }),
    )
    expect(response.statusCode, response.body).toBe(502)
    expect(response.json()).toMatchObject({ code: 'unknown-outcome', operation: 'delete', record, version: '1' })
    expect(sent()).toBe(1)

    const again = await call(`/v1/forms/${formId}/records/delete`, clerk, { record, version: '1' })
    expect([again.statusCode, again.json()]).toEqual([404, { code: 'not-found', message: 'No such record.' }])
    expect(await count(connection, REMOVABLE_CODED, code)).toBe(0)
    const trail = events.filter(
      (event): event is RuntimeAuditEvent => event.plane === 'runtime' && event.form === formId && event.record === recordReference(AUDIT_KEY, record),
    )
    expect(trail.map(({ operation, status, outcome }) => ({ operation, status, outcome }))).toEqual([
      { operation: 'delete', status: 502, outcome: 'unknown-outcome' },
      { operation: 'delete', status: 404, outcome: 'not-found' },
    ])
  })
})
