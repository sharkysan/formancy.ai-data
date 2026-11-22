import { createSecretKey } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION, recordToken, REFUSAL_PREFIX } from '@formancy/data-core'
import type { ChangedAnswer, ChosenAnswer, FieldBinding, FormBindings, FormPolicy, GenerationRequest, MetadataSnapshot } from '@formancy/data-core'
import { BULK_PARITY, PARITY_CASCADES, POSTGRES_IMAGE, SQLSERVER_IMAGE, startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { BulkCase, PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
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
 * Deleting (0173) and changing (0175) the chosen records of a page, end to
 * end on both engines: HTTP into the real server, through the real
 * drivers, into the parity schema and the shared fixture's orders on real
 * databases. Each record of a request is a write of its own, in its own
 * transaction, in the order sent; what each answers is the database's, and
 * BULK_PARITY writes it once for both engines. The route's own decisions
 * -- who may send one, when it stops, what a write id does -- are
 * runtime-bulk.test.ts's and runtime-bulk-update.test.ts's, over fake
 * ports.
 *
 * Not declared with `covers()`: BULK_PARITY is no family of shared cases,
 * because this suite runs on the default images alone and a case the
 * report holds must pass on every image of the matrix (data-fixtures'
 * bulk.ts says why). Each record's delete is held on every image by the
 * adapters' DELETE_PARITY and CASCADE_PARITY suites, and each record's
 * update by their update cases.
 *
 * Its own containers and its own audit sink with a key, so the rows it
 * leaves behind are no other suite's business and the trail is checked.
 */
const SECRET = 'a-chosen-records-host-secret-of-32-bytes'
const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'
const AUDIT_KEY = 'the-chosen-records-suite-audit-key'

async function token(subject: string, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ sub: subject, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('10m')
    .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
}

/** Statements on a database's owner, around the server: what a case starts from, and what is left after it. */
interface Owner {
  run(statement: string): Promise<void>
  /** The id a single-row insert made. */
  inserted(statement: string): Promise<string>
  /** The count a counting statement finds. */
  count(statement: string): Promise<number>
}

let pg: PostgresFixture
let ms: SqlServerFixture
let owners: Record<'pg' | 'ms', Owner>
let closeOwners: () => Promise<void>
let root: string
let registry: ConnectionRegistry
let app: FastifyInstance
let admin: string
let clerk: string
let otherClerk: string
const events: AuditEvent[] = []

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
      // The fixture's containers speak no TLS. A real allowlist leaves it on.
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
  // The shared fixture's orders, which a change of chosen records is about (0175).
  connections.push(
    { ...(connections[0] as ConnectionConfig), id: 'pg-sales', schemas: ['sales'] },
    { ...(connections[1] as ConnectionConfig), id: 'ms-sales', schemas: ['sales'] },
  )
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
  owners = {
    pg: {
      run: async (statement) => void (await pgOwner.unsafe(statement)),
      inserted: async (statement) => (await pgOwner.unsafe<Array<{ id: string }>>(statement))[0]?.id ?? '',
      count: async (statement) => (await pgOwner.unsafe<Array<{ n: number }>>(statement))[0]?.n ?? -1,
    },
    ms: {
      run: async (statement) => void (await msOwner.request().batch(statement)),
      inserted: async (statement) => String((await msOwner.request().query<{ id: number }>(statement)).recordset[0]?.id),
      count: async (statement) => (await msOwner.request().query<{ n: number }>(statement)).recordset[0]?.n ?? -1,
    },
  }
  closeOwners = async () => {
    await pgOwner.end({ timeout: 5 })
    await msOwner.close()
  }

  root = await mkdtemp(join(tmpdir(), 'formancy-data-e2e-bulk-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({
    key: { kind: 'secret', secret: SECRET },
    issuer: ISSUER,
    audience: AUDIENCE,
    attributes: { tenant: 'tid' },
  })
  app = await createDataServer({
    verifyIdentity,
    admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } },
    runtime: { registry, store, audit: { sink: (event) => void events.push(event), key: AUDIT_KEY } },
  })
  admin = await token('admin-1', { roles: ['data-admin'] })
  clerk = await token('clerk-1', { roles: ['clerk'], tid: 1 })
  otherClerk = await token('clerk-2', { roles: ['clerk'], tid: 2 })
})

afterAll(async () => {
  await app?.close()
  await registry?.close()
  await closeOwners?.()
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

/**
 * A form over a parity table, proposed and published with a policy under
 * which clerks read it and delete its records, one at a time and the chosen
 * ones of a page together: the root's tenant pinned where it has one, and
 * the keys a delete acts through named.
 */
async function publish(connection: string, formId: string, table: string, scoped: boolean, cascades: FormPolicy['cascades'] = []): Promise<void> {
  const proposal = await call('POST', '/v1/form-proposals', admin, {
    connection,
    root: { schema: 'parity', name: table },
    formId,
    title: table,
    lookups: [],
    versionColumn: 'version',
    ...(scoped ? { pinned: ['tenant_id'] } : {}),
  })
  expect(proposal.statusCode, proposal.body).toBe(200)
  const proposed = proposal.json<Proposal>()
  expect(proposed.bindings.operations.delete).toBe(true)
  const writes = (binding: FieldBinding) => (binding.writes.create || binding.writes.update) && binding.field !== 'tenant_id'
  const policy: FormPolicy = {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'], delete: ['clerk'] },
    fields: Object.fromEntries(proposed.bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: writes(binding) ? ['clerk'] : [] }])),
    rowFilters: scoped ? [{ column: 'tenant_id', attribute: 'tenant' }] : [],
    lookups: {},
    cascades,
    bulk: { delete: { roles: ['clerk'] } },
  }
  const { form, bindings, snapshot, generation } = proposed
  const published = await call('POST', `/v1/forms/${formId}/versions`, admin, {
    expectedBase: null,
    bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
  })
  expect(published.statusCode, published.body).toBe(201)
}

/** Each record's outcome as the trail names it: `done`, the code it was refused with, or `not-sent`. */
function outcomesOf(answer: ChosenAnswer<unknown>): string[] {
  return answer.records.map((outcome) => (!outcome.sent ? 'not-sent' : outcome.status === 200 ? 'done' : String((outcome.body as { code?: unknown }).code)))
}

/** A record of `id` at the version a row the owner inserted starts at. */
const inserted = (id: string) => {
  const made = recordToken(['id'], { id })
  if (!made.ok) throw new Error(made.message)
  return { record: made.token, version: '1' }
}

describe.each([
  { engine: 'PostgreSQL', connection: 'pg-parity', db: 'pg' as const, n: '' },
  { engine: 'SQL Server', connection: 'ms-parity', db: 'ms' as const, n: 'N' },
])('deleting chosen records on $engine', ({ connection, db, n }) => {
  const removable = `${connection}-removable-chosen`
  const parents = `${connection}-parent-chosen`
  const cascading = `${connection}-cascade-chosen`

  beforeAll(async () => {
    await publish(connection, removable, 'removable', true)
    await publish(connection, parents, 'removable_parent', true, [...PARITY_CASCADES])
    await publish(connection, cascading, 'removable_cascade', false, [
      { table: { schema: 'parity', name: 'removable_grandchild' }, foreignKey: 'fk_removable_grandchild_cascade', onDelete: 'cascade' },
    ])
  })

  /** A record created through the form, by its token and the version it was read at. */
  async function created(formId: string, note: string, bearer = clerk): Promise<{ record: string; version: string }> {
    const made = await call('POST', `/v1/forms/${formId}/records/create`, bearer, { answers: { note } })
    expect(made.statusCode, made.body).toBe(201)
    const { record, version } = made.json<{ record: string; version: string }>()
    return { record, version }
  }
  const idOf = (record: string) => record.slice('k1:'.length)
  const read = (formId: string, record: string, bearer = clerk) => call('POST', `/v1/forms/${formId}/records/read`, bearer, { record })

  // One request over six records, each the case BULK_PARITY names: each is
  // deleted or refused as a delete of it alone would be, in the order
  // sent, and a refusal stops nothing -- the record after the stale one,
  // the one after the referenced one, are deleted. What was kept is kept:
  // the stale, another tenant's, the referenced. The trail names every
  // record by its hash and what became of each by its code.
  test('deletes each record on its own in the order sent, and goes on past the records it cannot delete', async () => {
    const deleted = await created(removable, 'chosen: deleted')
    const stale = await created(removable, 'chosen: stale')
    const gone = await created(removable, 'chosen: not found')
    const theirs = await created(removable, 'chosen: another tenant', otherClerk)
    const referenced = await created(removable, 'chosen: referenced')
    const last = await created(removable, 'chosen: deleted last')

    const changed = await call('POST', `/v1/forms/${removable}/records/update`, clerk, { ...stale, answers: { note: 'chosen: changed since' } })
    expect(changed.statusCode, changed.body).toBe(200)
    expect((await call('POST', `/v1/forms/${removable}/records/delete`, clerk, gone)).statusCode).toBe(200)
    await owners[db].run(`insert into parity.removable_child (removable_id, note) values (${idOf(referenced.record)}, ${n}'refers to it')`)

    const cases: Array<[BulkCase, { record: string; version: string }]> = [
      ['deleted', deleted],
      ['stale', stale],
      ['not-found', gone],
      ['other-tenant', theirs],
      ['referenced', referenced],
      ['deleted', last],
    ]
    const response = await call('POST', `/v1/forms/${removable}/records/delete-chosen`, clerk, { records: cases.map(([, sent]) => sent) })
    expect(response.statusCode, response.body).toBe(200)
    const answer = response.json<ChosenAnswer>()
    expect(outcomesOf(answer)).toEqual(cases.map(([name]) => BULK_PARITY[name]))
    expect(answer.records[0]).toEqual({ sent: true, status: 200, body: { record: deleted.record, deleted: true } })
    expect(answer.records[4]).toEqual({
      sent: true,
      status: 422,
      body: { code: 'referenced', message: 'Other records still refer to this one, so the database keeps it. Nothing was deleted.' },
    })

    expect((await read(removable, deleted.record)).statusCode).toBe(404)
    expect((await read(removable, last.record)).statusCode).toBe(404)
    expect((await read(removable, stale.record)).statusCode).toBe(200)
    expect((await read(removable, referenced.record)).statusCode).toBe(200)
    expect((await read(removable, theirs.record, otherClerk)).statusCode).toBe(200)

    const trail = events.filter(
      (event): event is RuntimeAuditEvent => event.plane === 'runtime' && event.form === removable && event.operation === 'delete-chosen',
    )
    expect(trail.map(({ status, outcome, record, rows, records, outcomes }) => ({ status, outcome, record, rows, records, outcomes }))).toEqual([
      {
        status: 200,
        outcome: 'ok',
        record: null,
        rows: 6,
        records: cases.map(([, sent]) => recordReference(AUDIT_KEY, sent.record)),
        outcomes: ['done', 'stale', 'not-found', 'not-found', 'referenced', 'done'],
      },
    ])
  })

  // A parent's rows go with it through the keys the policy names, two
  // levels down, and a row that referred to it through SET NULL stays with
  // its reference cleared: each record of the request is a delete with its
  // reach (0051), exactly as one sent alone.
  test('deletes each chosen parent with the rows that cascade from it', async () => {
    const first = await created(parents, 'chosen parent: first')
    const second = await created(parents, 'chosen parent: second')
    const parent = idOf(first.record)
    const child =
      db === 'pg'
        ? await owners.pg.inserted(`insert into parity.removable_cascade (parent_id, note) values (${parent}, 'cascades') returning id::text as id`)
        : await owners.ms.inserted(`insert into parity.removable_cascade (parent_id, note) output inserted.id values (${parent}, N'cascades')`)
    await owners[db].run(`insert into parity.removable_cascade (parent_id, note) values (${parent}, ${n}'cascades too')`)
    await owners[db].run(`insert into parity.removable_grandchild (cascade_id, note) values (${child}, ${n}'two levels down')`)
    await owners[db].run(`insert into parity.removable_null (parent_id, note) values (${parent}, ${n}'cleared')`)

    const response = await call('POST', `/v1/forms/${parents}/records/delete-chosen`, clerk, { records: [first, second] })
    expect(response.statusCode, response.body).toBe(200)
    expect(outcomesOf(response.json<ChosenAnswer>())).toEqual([BULK_PARITY.cascade, BULK_PARITY.cascade])
    const counted = (sql: string) => owners[db].count(db === 'pg' ? sql.replace('count(*)', 'count(*)::int') : sql)
    expect(await counted(`select count(*) as n from parity.removable_cascade where parent_id = ${parent}`)).toBe(0)
    expect(await counted(`select count(*) as n from parity.removable_grandchild where cascade_id = ${child}`)).toBe(0)
    expect(await counted(`select count(*) as n from parity.removable_null where note = ${n}'cleared' and parent_id is null`)).toBe(1)
  })

  // A record the page read, which a cascade of another form's delete took
  // since, is not found -- the answer a record deleted since gets -- and
  // the record after it is deleted. Nothing was deleted twice and nothing
  // was refused for it.
  test('answers a record a cascade took since the page read it not found, and deletes the next', async () => {
    const taking = await created(parents, 'chosen parent: takes its row')
    const keeping = await created(parents, 'chosen parent: keeps its row')
    const insert = (parent: string, note: string) =>
      db === 'pg'
        ? owners.pg.inserted(`insert into parity.removable_cascade (parent_id, note) values (${parent}, '${note}') returning id::text as id`)
        : owners.ms.inserted(`insert into parity.removable_cascade (parent_id, note) output inserted.id values (${parent}, N'${note}')`)
    const taken = inserted(await insert(idOf(taking.record), 'taken by a cascade'))
    const next = inserted(await insert(idOf(keeping.record), 'deleted after it'))
    expect((await call('POST', `/v1/forms/${parents}/records/delete`, clerk, taking)).statusCode).toBe(200)

    const response = await call('POST', `/v1/forms/${cascading}/records/delete-chosen`, clerk, { records: [taken, next] })
    expect(response.statusCode, response.body).toBe(200)
    expect(outcomesOf(response.json<ChosenAnswer>())).toEqual([BULK_PARITY['cascade-taken'], 'done'])
    expect((await read(cascading, next.record)).statusCode).toBe(404)
  })
})

/** What the trigger the change cases add says, after the prefix, when it keeps an order noted `kept` as it is. */
const KEPT = 'This order is kept as it is.'

describe.each([
  { engine: 'PostgreSQL', connection: 'pg-sales', db: 'pg' as const, versionColumn: 'row_version' },
  { engine: 'SQL Server', connection: 'ms-sales', db: 'ms' as const, versionColumn: undefined },
])('changing chosen records on $engine', ({ connection, db, versionColumn }) => {
  const formId = `${connection}-order-chosen`
  let customer: string
  let theirCustomer: string

  // The order form, published with a policy under which clerks read,
  // create and update the orders of their tenant, move an order's status
  // draft to placed to shipped and never back, and change the chosen ones
  // of a page together in their status, amount, notes and customer. And a
  // trigger, this suite's own, that keeps an order noted `kept` as it is,
  // in the deployment's own words (0156): PostgreSQL's BEFORE UPDATE with
  // RAISE EXCEPTION, SQL Server's AFTER UPDATE with THROW 50001.
  beforeAll(async () => {
    const proposal = await call('POST', '/v1/form-proposals', admin, {
      connection,
      root: { schema: 'sales', name: 'order' },
      formId,
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    expect(proposal.statusCode, proposal.body).toBe(200)
    const { form, bindings, snapshot, generation } = proposal.json<Proposal>()
    const clerks = ['clerk']
    const policy: FormPolicy = {
      version: 1,
      operations: { read: clerks, create: clerks, update: clerks },
      fields: Object.fromEntries(
        bindings.fields.map((binding) => [binding.field, { read: clerks, write: binding.writes.create || binding.writes.update ? clerks : [] }]),
      ),
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
      lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
      transitions: {
        field: 'status',
        moves: [
          { from: null, to: 'draft', roles: clerks },
          { from: null, to: 'placed', roles: clerks },
          { from: 'draft', to: 'placed', roles: clerks },
          { from: 'placed', to: 'shipped', roles: clerks },
        ],
      },
      bulk: { update: { roles: clerks, fields: ['status', 'amount', 'notes', 'customer'] } },
    }
    const published = await call('POST', `/v1/forms/${formId}/versions`, admin, {
      expectedBase: null,
      bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
    })
    expect(published.statusCode, published.body).toBe(201)
    await owners[db].run(
      db === 'pg'
        ? [
            'create function sales.keep_order() returns trigger language plpgsql as $kept$',
            'begin',
            `  if old.notes = 'kept' then raise exception using message = '${REFUSAL_PREFIX}${KEPT}'; end if;`,
            '  return new;',
            'end',
            '$kept$;',
            'create trigger tr_order_kept before update on sales."order" for each row execute function sales.keep_order()',
          ].join('\n')
        : [
            'create trigger sales.tr_order_kept on sales.[order] after update as begin set nocount on;',
            `  if exists (select 1 from deleted where notes = N'kept') throw 50001, N'${REFUSAL_PREFIX}${KEPT}', 1; end`,
          ].join('\n'),
    )
    const source = (await call('GET', `/v1/forms/${formId}`, clerk)).json().form.model.fields.find((field: { key: string }) => field.key === 'customer')
      .optionsSource as string
    const first = async (bearer: string) =>
      (await call('POST', `/v1/forms/${formId}/lookups/${source}/query`, bearer, { operation: 'update', search: '' })).json().rows[0].token as string
    customer = await first(clerk)
    theirCustomer = await first(otherClerk)
  })

  /** An order created through the form, by its token and the version it was created at. */
  async function order(status: string, notes: string, bearer = clerk): Promise<{ record: string; version: string }> {
    const made = await call('POST', `/v1/forms/${formId}/records/create`, bearer, {
      answers: { customer: bearer === clerk ? customer : theirCustomer, order_date: '2026-11-22', status, amount: '1', notes },
    })
    expect(made.statusCode, made.body).toBe(201)
    const { record, version } = made.json<{ record: string; version: string }>()
    return { record, version }
  }
  const read = (record: string, bearer = clerk) => call('POST', `/v1/forms/${formId}/records/read`, bearer, { record })
  const changed = (records: Array<{ record: string; version: string }>, answers: Record<string, unknown>) =>
    call('POST', `/v1/forms/${formId}/records/update-chosen`, clerk, { records, answers })

  // One request over five orders, each the case BULK_PARITY names: each is
  // changed or refused as its update alone would be, in the order sent, and
  // a refusal stops nothing. The one changed takes every answer, its amount
  // in the column's spelling; the one updated since is stale and keeps what
  // it holds; the shipped one may not move back to placed, from its own
  // state; the one the trigger keeps is refused in the trigger's words. The
  // trail names every record by its hash and what became of each by its
  // code, never a value.
  test('changes each record on its own in the order sent, each as its update alone would be', async () => {
    const draft = await order('draft', 'chosen: changed')
    const since = await order('draft', 'chosen: changed since')
    const placed = await order('placed', 'chosen: shipped since')
    const kept = await order('draft', 'kept')
    const spelled = await order('draft', 'chosen: spelled')
    const updated = await call('POST', `/v1/forms/${formId}/records/update`, clerk, { ...since, answers: { notes: 'changed since it was read' } })
    expect(updated.statusCode, updated.body).toBe(200)
    const shipped = await call('POST', `/v1/forms/${formId}/records/update`, clerk, { ...placed, answers: { status: 'shipped' } })
    expect(shipped.statusCode, shipped.body).toBe(200)
    const shippedAt = { record: placed.record, version: shipped.json<{ version: string }>().version }

    const cases: Array<[BulkCase, { record: string; version: string }]> = [
      ['changed', draft],
      ['stale', since],
      ['move-refused', shippedAt],
      ['declined', kept],
      ['spelled', spelled],
    ]
    const response = await changed(
      cases.map(([, sent]) => sent),
      { status: 'placed', amount: '12.5', notes: 'changed together', customer },
    )
    expect(response.statusCode, response.body).toBe(200)
    const answer = response.json<ChangedAnswer>()
    expect(outcomesOf(answer)).toEqual(cases.map(([name]) => BULK_PARITY[name]))
    expect(answer.records[0]).toMatchObject({
      sent: true,
      status: 200,
      body: { record: draft.record, answers: { status: 'placed', amount: '12.5000', notes: 'changed together', customer } },
    })
    expect(answer.records[3]).toMatchObject({ sent: true, status: 422, body: { code: 'declined', message: KEPT } })

    expect((await read(spelled.record)).json()).toMatchObject({ answers: { status: 'placed', amount: '12.5000', notes: 'changed together' } })
    expect((await read(since.record)).json()).toMatchObject({ answers: { status: 'draft', notes: 'changed since it was read' } })
    expect((await read(placed.record)).json()).toMatchObject({ answers: { status: 'shipped', notes: 'chosen: shipped since' } })
    expect((await read(kept.record)).json()).toMatchObject({ answers: { status: 'draft', notes: 'kept' } })

    const trail = events.filter(
      (event): event is RuntimeAuditEvent => event.plane === 'runtime' && event.form === formId && event.operation === 'update-chosen',
    )
    expect(trail.map(({ status, outcome, record, rows, records, outcomes, moved }) => ({ status, outcome, record, rows, records, outcomes, moved }))).toEqual([
      {
        status: 200,
        outcome: 'ok',
        record: null,
        rows: 5,
        records: cases.map(([, sent]) => recordReference(AUDIT_KEY, sent.record)),
        outcomes: ['done', 'stale', 'transition-denied', 'declined', 'done'],
        moved: null,
      },
    ])
    expect(JSON.stringify(trail)).not.toContain(KEPT)
  })

  // A record deleted since the page read it, and another tenant's, are not
  // found -- a change of their notes alone, of which no move is checked --
  // and the record after them is changed; the other tenant's order keeps
  // what it holds.
  test('answers a record deleted since and another tenant’s not found, and changes the next', async () => {
    const gone = await order('draft', 'chosen: deleted since')
    const theirs = await order('draft', 'chosen: another tenant', otherClerk)
    const next = await order('draft', 'chosen: after them')
    const table = db === 'pg' ? 'sales."order"' : 'sales.[order]'
    await owners[db].run(`delete from ${table} where id = ${gone.record.slice('k1:'.length)}`)

    const response = await changed([gone, theirs, next], { notes: 'changed after the gone' })
    expect(response.statusCode, response.body).toBe(200)
    expect(outcomesOf(response.json<ChangedAnswer>())).toEqual([BULK_PARITY['not-found'], BULK_PARITY['other-tenant'], 'done'])
    expect((await read(next.record)).json()).toMatchObject({ answers: { notes: 'changed after the gone' } })
    expect((await read(theirs.record, otherClerk)).json()).toMatchObject({ answers: { notes: 'chosen: another tenant' } })
  })

  // A selection is checked once for the request, before any record is
  // read: another tenant's customer is no option of this clerk's, and a
  // customer number of their own tenant that names no row is not one of
  // the options -- each 422 for the request, and no order changed.
  test('refuses the request once for a customer outside the lookup’s filter, changing no order', async () => {
    const first = await order('draft', 'chosen: kept by its lookup')
    const second = await order('draft', 'chosen: kept by its lookup too')
    const theirs = await changed([first, second], { customer: theirCustomer, notes: 'never written' })
    expect([theirs.statusCode, theirs.json()]).toEqual([
      422,
      expect.objectContaining({ code: 'invalid-values', fieldErrors: [expect.objectContaining({ field: 'customer', code: 'not-an-option' })] }),
    ])
    const missing = await changed([first, second], { customer: 'k1:1,999999', notes: 'never written' })
    expect([missing.statusCode, missing.json()]).toEqual([
      422,
      {
        code: 'invalid-values',
        message: 'A selection is not one of the options.',
        fieldErrors: [{ field: 'customer', code: 'not-an-option', message: 'This is not one of the options this form offers.' }],
      },
    ])
    for (const { record, version } of [first, second]) {
      expect((await read(record)).json()).toMatchObject({ version, answers: { notes: expect.stringMatching(/^chosen: kept by its lookup/) } })
    }
  })
})
