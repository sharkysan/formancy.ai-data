import { createSecretKey } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FieldBinding, FormBindings, FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import { EDGE_VALUES, POSTGRES_IMAGE, SQLSERVER_IMAGE, startPostgresFixture, startSqlServerFixture } from '@formancy/data-fixtures'
import type { PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import { createIdentityVerifier } from '@formancy/data-identity'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { LightMyRequestResponse } from 'fastify'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDataServer } from '../app.js'
import type { AdminAuditEvent, AuditEvent } from '../audit.js'
import { createFileConfigurationStore } from '../config-store.js'
import type { ConnectionConfig, ConnectionRegistry } from '../connections.js'
import { createConnectionRegistry } from '../connections.js'
import { DRIVER_FACTORIES } from '../drivers.js'

/*
 * Two drafts of the order form through review (0065), on both engines,
 * against the shared fixture's real servers: a deployment whose publisher
 * roles are set, and real tokens whose `sub` is who submitted and who
 * approved -- never a body's word for it.
 *
 * An author submits the form a proposal generated, and no publisher can
 * write it directly. The database's owner drops approved_by, a column the
 * form binds, with plan section 14 step 8's DDL: the publisher's approval
 * asks the database again and is refused with that change alone, and
 * nothing is written. The column put back, the author, who is no
 * publisher, cannot approve it, the publisher does, version 1 is the
 * draft's bundle and nothing else, and a clerk creates an order through
 * the runtime and reads it back. A publisher then submits a second draft
 * over version 1 and cannot approve it themselves; approved_by is dropped
 * again, and the other publisher's approval of a draft over a version the
 * runtime already serves is refused the same way. The column put back, the
 * approval is version 2, and the runtime serves it. Who approved is read
 * from the only place that says: the administrator's trail.
 */

const SECRET = 'a-drafts-host-secret-of-32-bytes-ok!!'
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

/**
 * approved_by dropped, as e2e.integration.test.ts's step 8 drops it, and put
 * back with its foreign key, as admin-promotion.integration.test.ts does:
 * SQL Server refuses to drop a column a foreign key uses, so the constraint
 * goes first there, and comes back in a batch of its own once the column
 * exists.
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
/** An administrator who is no publisher. */
let author: string
/** A publisher by the publisher role alone, which is also an administrator's role. */
let publisher: string
/** A second publisher, holding both roles, for the draft the first submits. */
let other: string
let clerk: string
const registries: ConnectionRegistry[] = []
const roots: string[] = []

beforeAll(async () => {
  ;[pg, ms] = await Promise.all([startPostgresFixture(POSTGRES_IMAGE), startSqlServerFixture(SQLSERVER_IMAGE)])
  verifyIdentity = await createIdentityVerifier({ key: { kind: 'secret', secret: SECRET }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: 'tid' } })
  author = await token('author-1', { roles: ['data-admin'] })
  publisher = await token('publisher-1', { roles: ['data-publisher'] })
  other = await token('publisher-2', { roles: ['data-admin', 'data-publisher'] })
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
    const config: ConnectionConfig = {
      id: 'erp',
      kind: 'postgres',
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: 'env:ERP_PASSWORD',
      schemas: ['sales'],
      tls: { enabled: false },
    }
    return { config, password: decodeURIComponent(url.password) }
  }
  const config: ConnectionConfig = {
    id: 'erp',
    kind: 'sqlserver',
    host: String(ms.admin.server),
    port: Number(ms.admin.port),
    database: String(ms.admin.database),
    user: String(ms.admin.user),
    password: 'env:ERP_PASSWORD',
    schemas: ['sales'],
    tls: { enabled: false, trustServerCertificate: true },
  }
  return { config, password: String(ms.admin.password) }
}

interface Deployment {
  root: string
  /** The administrator's trail, as the sink was given it. */
  events: AdminAuditEvent[]
  call(method: 'GET' | 'POST', url: string, bearer: string, payload?: unknown): Promise<LightMyRequestResponse>
}

/** Both planes, a store of its own, `erp` on `engine`, and publication under review. */
async function deployment(engine: Engine): Promise<Deployment> {
  const { config, password } = erp(engine)
  const registry = createConnectionRegistry([config], DRIVER_FACTORIES, { env: { ERP_PASSWORD: password }, readFile: async () => '' })
  registries.push(registry)
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-drafts-'))
  roots.push(root)
  const store = createFileConfigurationStore(root)
  const events: AdminAuditEvent[] = []
  const sink = (event: AuditEvent) => {
    if (event.plane === 'admin') events.push(event)
  }
  const app = await createDataServer({
    verifyIdentity,
    admin: { registry, store, adminRoles: ['data-admin', 'data-publisher'], publisherRoles: ['data-publisher'], audit: { sink } },
    runtime: { registry, store },
  })
  return {
    root,
    events,
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

/** The version file the store writes for `bundle`: its JSON, two-space indented, and a newline. */
const spelled = (bundle: unknown) => `${JSON.stringify(bundle, null, 2)}\n`

describe.each([
  { engine: 'PostgreSQL', connection: 'pg' as const, versionColumn: 'row_version' as string | undefined },
  { engine: 'SQL Server', connection: 'ms' as const, versionColumn: undefined },
])('two drafts of the order form reviewed on $engine', ({ connection, versionColumn }) => {
  let deployed: Deployment
  let ddl: Awaited<ReturnType<typeof owner>>
  /** The first draft's bundle, as the author built it from a proposal. */
  let first: Record<string, unknown>
  /** The second, a publisher's, over version 1. */
  let second: Record<string, unknown>
  /** The order a clerk created under version 1, and what they answered. */
  let order: { record: string; answers: Record<string, unknown> }

  /** A bundle of the order form as the database is now, under `title`, as the studio would build it. */
  async function proposed(bearer: string, title: string): Promise<Record<string, unknown>> {
    const proposal = await deployed.call('POST', '/v1/form-proposals', bearer, {
      connection: 'erp',
      root: { schema: 'sales', name: 'order' },
      formId: 'order',
      title,
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
    return {
      format: 2,
      connection: 'erp',
      generation,
      base: form,
      presentation: EMPTY_PRESENTATION,
      form,
      bindings,
      policy: clerkPolicy(bindings.fields),
      snapshot,
    }
  }

  beforeAll(async () => {
    ;[deployed, ddl] = await Promise.all([deployment(connection), owner(connection)])
  })
  afterAll(async () => {
    await ddl?.close()
  })

  // Under review a publisher's direct publish, or an import, would be a
  // version only one person looked at: both refused before anything is
  // read. The author's draft then names them by their token, not by the
  // `submittedBy` their body claims -- a server that read it would let
  // the author pass their draft off as the publisher's, or lock the
  // publisher out of approving it as their own.
  test('an author submits the form a proposal generated, and no publisher writes it directly', async () => {
    first = await proposed(author, 'Order')
    for (const route of ['versions', 'imports']) {
      const direct = await deployed.call('POST', `/v1/forms/order/${route}`, publisher, { expectedBase: null, bundle: first })
      expect([route, direct.statusCode, direct.json().code]).toEqual([route, 403, 'review-required'])
    }
    const submitted = await deployed.call('POST', '/v1/forms/order/drafts', author, { expectedBase: null, bundle: first, submittedBy: 'publisher-1' })
    expect(submitted.statusCode, submitted.body).toBe(201)
    expect(submitted.json()).toMatchObject({ draft: 1, state: 'pending', drift: { blocking: false } })
    const read = await deployed.call('GET', '/v1/forms/order/drafts/1', publisher)
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json()).toMatchObject({ state: 'pending', expectedBase: null, submittedBy: 'author-1', current: null, refuses: {} })
    expect((await deployed.call('GET', '/v1/forms/order/versions', author)).statusCode).toBe(404)
    expect((await deployed.call('GET', '/v1/forms/order', clerk)).statusCode).toBe(404)
  })

  // Between submit and approval the database lost approved_by, which the
  // form binds: an approval that trusted the submit's check would publish
  // a form every save of which the database refuses. It discovers again
  // and is refused with that change alone; nothing is written, and the
  // draft still waits. Its base is no version, so what refuses it is
  // drift alone: no version's keys are compared.
  test('a bound column dropped after the first submit refuses its approval as incompatible, and writes nothing', async () => {
    await ddl.run(DDL[connection].drop)
    const refused = await deployed.call('POST', '/v1/forms/order/drafts/1/approval', publisher)
    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json()).toMatchObject({
      code: 'incompatible',
      changes: [{ kind: 'column-dropped', severity: 'blocking', subject: { name: 'approved_by' } }],
    })
    expect(refused.json().changes).toHaveLength(1)
    expect((await deployed.call('GET', '/v1/forms/order/versions', author)).statusCode).toBe(404)
    expect((await deployed.call('GET', '/v1/forms/order/drafts/1', publisher)).json()).toMatchObject({ state: 'pending', current: null })
    await ddl.run(DDL[connection].restore)
  })

  // The author's approval is refused -- approving is a publisher's, and
  // they hold no publisher role -- and the publisher's writes version 1 as
  // the draft's bundle and nothing else: a version file that carried who
  // approved it, or a bundle the approval rebuilt, would serve something
  // nobody reviewed. Who approved is the trail's, refusals included. The
  // runtime then serves what was reviewed: a clerk finds their customer,
  // creates an order at the largest amount numeric(18,4) holds, and reads
  // it back exactly.
  test('an author, who is no publisher, is refused approval (publisher-required); the publisher approves it as version 1, and a clerk creates and reads back an order', async () => {
    const own = await deployed.call('POST', '/v1/forms/order/drafts/1/approval', author)
    expect([own.statusCode, own.json().code]).toEqual([403, 'publisher-required'])
    const approved = await deployed.call('POST', '/v1/forms/order/drafts/1/approval', publisher)
    expect(approved.statusCode, approved.body).toBe(201)
    expect(approved.json()).toMatchObject({ version: 1, drift: { blocking: false } })
    expect(await readFile(join(deployed.root, 'order', '1.json'), 'utf8')).toBe(spelled(first))
    expect(
      deployed.events
        .filter((event) => event.operation === 'draft-approve')
        .map(({ actor, outcome, form, draft, formVersion }) => ({ actor, outcome, form, draft, formVersion })),
    ).toEqual([
      { actor: 'publisher-1', outcome: 'incompatible', form: 'order', draft: 1, formVersion: null },
      { actor: 'author-1', outcome: 'publisher-required', form: 'order', draft: 1, formVersion: null },
      { actor: 'publisher-1', outcome: 'ok', form: 'order', draft: 1, formVersion: 1 },
    ])

    const definition = (await deployed.call('GET', '/v1/forms/order', clerk)).json()
    const source = definition.form.model.fields.find((field: { key: string }) => field.key === 'customer').optionsSource as string
    const options = (await deployed.call('POST', `/v1/forms/order/lookups/${source}/query`, clerk, { operation: 'create', search: 'Muster' })).json()
    expect(options.rows.map((row: { label: string }) => row.label)).toEqual(['Muster AG'])
    const answers = {
      customer: options.rows[0].token as string,
      order_date: EDGE_VALUES.orderDate,
      status: 'placed',
      amount: EDGE_VALUES.largestAmount,
      notes: 'approved by a publisher',
    }
    const created = await deployed.call('POST', '/v1/forms/order/records/create', clerk, { answers })
    expect(created.statusCode, created.body).toBe(201)
    const read = await deployed.call('POST', '/v1/forms/order/records/read', clerk, { record: created.json().record })
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json().answers).toMatchObject(answers)
    order = { record: created.json().record as string, answers }
    expect((await deployed.call('GET', '/v1/forms/order/drafts/1', author)).json()).toMatchObject({ state: 'published', current: 1 })
  })

  // Four eyes holds for a submitter who is a publisher too: holding the
  // role is not approving one's own work. The queue names the draft by
  // its submitter's token, and offers it to the other publisher.
  test('a publisher submits a second draft over version 1, and cannot approve it themselves', async () => {
    second = await proposed(publisher, 'Sales order')
    const submitted = await deployed.call('POST', '/v1/forms/order/drafts', publisher, { expectedBase: 1, bundle: second })
    expect(submitted.statusCode, submitted.body).toBe(201)
    expect(submitted.json()).toMatchObject({ draft: 2, state: 'pending' })
    const own = await deployed.call('POST', '/v1/forms/order/drafts/2/approval', publisher)
    expect([own.statusCode, own.json().code]).toEqual([403, 'own-draft'])
    const queue = await deployed.call('GET', '/v1/drafts', other)
    expect(queue.statusCode, queue.body).toBe(200)
    expect(queue.json()).toEqual({
      drafts: [{ form: 'order', draft: 2, expectedBase: 1, submittedBy: 'publisher-1', title: 'Sales order', refuses: {} }],
      unreadable: [],
    })
  })

  // The same drift under a draft over a version the runtime already
  // serves: the approval discovers again and is refused with that change
  // alone; no file is written beside version 1, and the draft still waits. The trail says it was refused,
  // and that no version came of it. With the approval's call to `gate`
  // removed, this case fails on both engines -- 201, version 2 written
  // over the dropped column: observed on 2026-10-16 against
  // postgres:17-alpine and mssql/server:2022-latest.
  test('a bound column dropped after the second submit refuses its approval over version 1 as incompatible, and writes nothing', async () => {
    await ddl.run(DDL[connection].drop)
    const refused = await deployed.call('POST', '/v1/forms/order/drafts/2/approval', other)
    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json()).toMatchObject({
      code: 'incompatible',
      changes: [{ kind: 'column-dropped', severity: 'blocking', subject: { name: 'approved_by' } }],
    })
    expect(refused.json().changes).toHaveLength(1)
    expect((await deployed.call('GET', '/v1/forms/order/versions', author)).json()).toEqual({ versions: [1] })
    expect(await readdir(join(deployed.root, 'order'))).toEqual(['1.json'])
    expect((await deployed.call('GET', '/v1/forms/order/drafts/2', other)).json()).toMatchObject({ state: 'pending', current: 1 })
    expect(deployed.events.filter((event) => event.operation === 'draft-approve').at(-1)).toMatchObject({
      actor: 'publisher-2',
      outcome: 'incompatible',
      draft: 2,
      expectedBase: 1,
      connection: 'erp',
      formVersion: null,
    })
  })

  // The column back, nothing the form rests on differs: the approval is
  // version 2, the second draft's bundle exactly, and the runtime serves
  // it -- its title, and the clerk's order read back through it.
  test('with the column back, the approval is version 2, and the runtime serves it', async () => {
    await ddl.run(DDL[connection].restore)
    const approved = await deployed.call('POST', '/v1/forms/order/drafts/2/approval', other)
    expect(approved.statusCode, approved.body).toBe(201)
    expect(approved.json()).toMatchObject({ version: 2, drift: { blocking: false } })
    expect(await readFile(join(deployed.root, 'order', '2.json'), 'utf8')).toBe(spelled(second))
    expect(deployed.events.filter((event) => event.operation === 'draft-approve').at(-1)).toMatchObject({
      actor: 'publisher-2',
      outcome: 'ok',
      draft: 2,
      expectedBase: 1,
      formVersion: 2,
    })

    const definition = await deployed.call('GET', '/v1/forms/order', clerk)
    expect(definition.statusCode, definition.body).toBe(200)
    expect(definition.json().form.title).toBe('Sales order')
    const read = await deployed.call('POST', '/v1/forms/order/records/read', clerk, { record: order.record })
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json().answers).toMatchObject(order.answers)
    expect((await deployed.call('GET', '/v1/drafts', other)).json()).toEqual({ drafts: [], unreadable: [] })
  })
})
