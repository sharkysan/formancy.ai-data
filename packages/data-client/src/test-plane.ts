import { createSecretKey } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION, recordToken } from '@formancy/data-core'
import type { FieldBinding, FormPolicy } from '@formancy/data-core'
import { startTcpHop } from '@formancy/data-fixtures'
import type { TcpHop } from '@formancy/data-fixtures'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, createIdentityVerifier, DRIVER_FACTORIES } from '@formancy/data-server'
import type { ConnectionConfig } from '@formancy/data-server'
import { SignJWT } from 'jose'
import mssql from 'mssql'
import postgres from 'postgres'
import { inject } from 'vitest'
import type { DatabaseDetails } from './test-databases.js'
import { createDataClient } from './client.js'
import type { DataClient } from './client.js'

/*
 * One file's server: the real data server over the run's two databases, with
 * the real drivers and the real identity verifier, listening on a loopback
 * port so every call the client makes crosses real HTTP -- path encoding,
 * headers and bodies included. Nothing here is a fake but the host that
 * signs the tokens, and that signs them with the same HS256 a host would.
 *
 * Read by the integration suites only; never part of the package.
 */

const SECRET = 'a-client-suite-host-secret-of-32-bytes!'
const ISSUER = 'https://host.example'
const AUDIENCE = 'formancy-data'

/** The engines every runtime behaviour is proved on (0003), with what each needs to offer update. */
export const ENGINES = [
  { engine: 'PostgreSQL', connection: 'pg', versionColumn: 'row_version' as string | undefined },
  { engine: 'SQL Server', connection: 'ms', versionColumn: undefined },
] as const

/** One request as it left the client: what the server, and anybody on the wire, saw. */
export interface Sent {
  method: string
  url: string
  headers: Record<string, string>
  body: string | undefined
}

/**
 * A TCP hop in front of each database (0031), and the connections `pg-hop`
 * and `ms-hop` through them, with `pg-hop-order` and `ms-hop-order`
 * published over them: the forms whose answers a suite can lose after the
 * database has sent them. Beside them, the owner's own connections, around
 * the hops, to see what the database holds.
 */
export interface Lossy {
  hops: Record<'pg' | 'ms', TcpHop>
  /** How many orders have exactly these notes, asked of the database's owner, not through a hop. */
  ordersWithNotes(connection: 'pg' | 'ms', notes: string): Promise<number>
  /**
   * A row of `lost.removable` -- a numbered id and a text the suite chooses,
   * its key -- inserted by the owner, which `pg-hop-removable` and
   * `ms-hop-removable` may delete (0050): its token.
   */
  insertRemovable(connection: 'pg' | 'ms', code: string): Promise<string>
  /** How many rows of `lost.removable` have this code, asked of the owner. */
  removableCoded(connection: 'pg' | 'ms', code: string): Promise<number>
}

export interface Plane {
  /** `http://127.0.0.1:<port>`: the server, across real HTTP. */
  base: string
  /** The administrator, and a clerk of each tenant: 1 and 2 hold the fixture's rows, 3 the paged customers (0085). */
  tokens: { admin: string; clerk: string; otherClerk: string; thirdClerk: string }
  /** Every request the spied fetch carried, in order. Cleared by `clear()`. */
  sent: Sent[]
  /** Node's own fetch, recording what it is asked to send. */
  fetch: typeof fetch
  /** A client over the spied fetch, for one held token. */
  client(token?: string | (() => string)): DataClient
  /** Present when the plane was started with `{ hops: true }`. */
  lossy: Lossy | undefined
  close(): Promise<void>
}

async function sign(subject: string, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ sub: subject, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('10m')
    .sign(createSecretKey(Buffer.from(SECRET, 'utf8')))
}

/** A clerk may do everything the form offers, on the fields it writes, inside their tenant; the e2e journey's policy. */
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

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries())
}

/**
 * Starts the server and publishes `pg-order` and `ms-order` through the
 * administrator's plane -- with `lines`, `pg-order-line` and
 * `ms-order-line` too, an order's lines reached through their order (0043);
 * with `countries`, `pg-customer` and `ms-customer`, whose lookup reads
 * `sales.country`;
 * with `removable`, `pg-removable` and `ms-removable` over the parity
 * schema's table a clerk may delete from within their tenant (0050); and,
 * with `hops`, `pg-hop-order` and `ms-hop-order` through a TCP hop each, and
 * `pg-hop-removable` and `ms-hop-removable` over `lost.removable` (`Lossy`).
 */
export async function startPlane(options: { hops?: boolean; lines?: boolean; removable?: boolean; countries?: boolean } = {}): Promise<Plane> {
  const { pg, ms } = inject('databases')
  const connections: ConnectionConfig[] = [
    { id: 'pg', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: ['sales'], tls: { enabled: false } },
    { id: 'ms', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: ['sales'], tls: { enabled: false, trustServerCertificate: true } },
  ]
  const [pgConnection, msConnection] = connections as [ConnectionConfig, ConnectionConfig]
  // Every key of the parity schema's removable tables is numbered by the database, so a version proves a record (0050).
  connections.push({ ...pgConnection, id: 'pg-parity', schemas: ['parity'] }, { ...msConnection, id: 'ms-parity', schemas: ['parity'] })
  const hops = options.hops === true ? { pg: await startTcpHop({ ...pg, kind: 'postgres' }), ms: await startTcpHop({ ...ms, kind: 'sqlserver' }) } : undefined
  if (hops !== undefined) {
    // The same databases, reached through the hops by the address an operator would write.
    connections.push(
      { ...pgConnection, id: 'pg-hop', host: '127.0.0.1', port: hops.pg.port },
      { ...msConnection, id: 'ms-hop', host: '127.0.0.1', port: hops.ms.port },
      { ...pgConnection, id: 'pg-hop-lost', host: '127.0.0.1', port: hops.pg.port, schemas: ['lost'] },
      { ...msConnection, id: 'ms-hop-lost', host: '127.0.0.1', port: hops.ms.port, schemas: ['lost'] },
    )
  }
  const owners = hops === undefined ? undefined : await openOwners(pg, ms)
  const registry = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: { PG_PASSWORD: pg.password, MS_PASSWORD: ms.password },
    readFile: () => Promise.resolve(''),
  })
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-client-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = await createIdentityVerifier({
    key: { kind: 'secret', secret: SECRET },
    issuer: ISSUER,
    audience: AUDIENCE,
    attributes: { tenant: 'tid' },
  })
  // The administrator's trail is the server's suites' subject; here it is required and discarded.
  const app = await createDataServer({
    verifyIdentity,
    admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } },
    runtime: { registry, store },
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const base = `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`
  const tokens = {
    admin: await sign('admin-1', { roles: ['data-admin'] }),
    clerk: await sign('clerk-1', { roles: ['clerk'], tid: 1 }),
    otherClerk: await sign('clerk-2', { roles: ['clerk'], tid: 2 }),
    thirdClerk: await sign('clerk-3', { roles: ['clerk'], tid: 3 }),
  }

  const admin = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.admin}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const parsed = (await response.json()) as Record<string, unknown>
    if (!response.ok) throw new Error(`${path} answered ${String(response.status)}: ${JSON.stringify(parsed)}`)
    return parsed
  }
  const published = ENGINES.flatMap((engine) => (hops === undefined ? [engine] : [engine, { ...engine, connection: `${engine.connection}-hop` }]))
  for (const { connection, versionColumn } of published) {
    const formId = `${connection}-order`
    const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'sales', name: 'order' },
      formId,
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    const policy = clerkPolicy((bindings as { fields: FieldBinding[] }).fields)
    await admin(`/v1/forms/${formId}/versions`, {
      expectedBase: null,
      bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
    })
  }
  for (const { connection, versionColumn } of options.lines === true ? ENGINES : []) {
    const formId = `${connection}-order-line`
    const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'sales', name: 'order_line' },
      formId,
      title: 'Order line',
      lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
      ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    // No tenant column of its own: its rows are its tenant's orders' lines, through the order lookup's filter (0043).
    const policy: FormPolicy = {
      ...clerkPolicy((bindings as { fields: FieldBinding[] }).fields),
      rowFilters: [],
      lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] },
      through: ['order'],
    }
    await admin(`/v1/forms/${formId}/versions`, {
      expectedBase: null,
      bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
    })
  }
  // A customer form whose lookup reads `sales.country`, which no other form here
  // reads and no write here checks: a suite may hold that table locked
  // without waiting on, or holding up, a file that shares the database.
  for (const { connection } of options.countries === true ? ENGINES : []) {
    const formId = `${connection}-customer`
    const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'sales', name: 'customer' },
      formId,
      title: 'Customer',
      lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }],
    })
    const fields = (bindings as { fields: FieldBinding[] }).fields
    const lookups = Object.fromEntries(fields.filter((binding) => binding.kind === 'lookup').map((binding) => [binding.field, []]))
    // No version column, so no update; the tenant comes from the row filter, so nobody writes it.
    const base = clerkPolicy(fields)
    const policy: FormPolicy = {
      ...base,
      operations: { read: ['clerk'], create: ['clerk'], update: [] },
      fields: { ...base.fields, tenant_id: { read: ['clerk'], write: [] } },
      lookups,
    }
    await admin(`/v1/forms/${formId}/versions`, {
      expectedBase: null,
      bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
    })
  }
  // Forms a clerk may delete with (0050): within their tenant over the parity schema, and every row of lost.removable through the hops.
  const deletable: Array<[string, string, Record<string, unknown>, FormPolicy['rowFilters']]> = [
    ...(options.removable === true
      ? ENGINES.map(({ connection }): [string, string, Record<string, unknown>, FormPolicy['rowFilters']] => [
          `${connection}-parity`,
          `${connection}-removable`,
          { root: { schema: 'parity', name: 'removable' }, pinned: ['tenant_id'] },
          [{ column: 'tenant_id', attribute: 'tenant' }],
        ])
      : []),
    ...(hops === undefined
      ? []
      : ENGINES.map(({ connection }): [string, string, Record<string, unknown>, FormPolicy['rowFilters']] => [
          `${connection}-hop-lost`,
          `${connection}-hop-removable`,
          { root: { schema: 'lost', name: 'removable' } },
          [],
        ])),
  ]
  for (const [connection, formId, generation, rowFilters] of deletable) {
    const {
      form,
      bindings,
      snapshot,
      generation: generated,
    } = await admin('/v1/form-proposals', { connection, formId, title: 'Removable', lookups: [], versionColumn: 'version', ...generation })
    const base = clerkPolicy((bindings as { fields: FieldBinding[] }).fields)
    const policy: FormPolicy = { ...base, operations: { ...base.operations, delete: ['clerk'] }, rowFilters, lookups: {} }
    await admin(`/v1/forms/${formId}/versions`, {
      expectedBase: null,
      bundle: { format: 2, connection, generation: generated, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
    })
  }

  const sent: Sent[] = []
  const spied: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    sent.push({ method: init?.method ?? 'GET', url, headers: headersOf(init), body: typeof init?.body === 'string' ? init.body : undefined })
    return fetch(input, init)
  }

  return {
    base,
    tokens,
    sent,
    fetch: spied,
    client: (token = tokens.clerk) => createDataClient({ token: typeof token === 'function' ? token : () => token, base, fetch: spied }),
    lossy:
      hops === undefined || owners === undefined
        ? undefined
        : { hops, ordersWithNotes: owners.ordersWithNotes, insertRemovable: owners.insertRemovable, removableCoded: owners.removableCoded },
    close: async () => {
      await app.close()
      // Awaited behind the hops too: the PostgreSQL adapter bounds postgres.js's
      // end(), which would otherwise wait for ever on a query cut under it (0031).
      await registry.close()
      await owners?.close()
      await Promise.all([hops?.pg.close(), hops?.ms.close()])
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * The databases' owners, on connections of their own around the hops, and
 * `lost.removable` on each, made once for the run: a numbered id and a
 * code, its key, so a delete's answer echoes a text the suite chose (0050).
 */
async function openOwners(
  pg: DatabaseDetails,
  ms: DatabaseDetails,
): Promise<Pick<Lossy, 'ordersWithNotes' | 'insertRemovable' | 'removableCoded'> & { close(): Promise<void> }> {
  const pgOwner = postgres({ host: pg.host, port: pg.port, database: pg.database, username: pg.user, password: pg.password, onnotice: () => {} })
  const msOwner = await new mssql.ConnectionPool({
    server: ms.host,
    port: ms.port,
    database: ms.database,
    user: ms.user,
    password: ms.password,
    options: { encrypt: false, trustServerCertificate: true },
  }).connect()
  await pgOwner.unsafe(
    'create schema if not exists lost; create table if not exists lost.removable (id integer generated always as identity, code varchar(100) not null, version integer not null default 1, primary key (id, code))',
  )
  await msOwner.request().batch("if schema_id('lost') is null exec('create schema lost')")
  await msOwner.request().batch(`if object_id('lost.removable') is null create table lost.removable (
    id int identity(1, 1) not null, code nvarchar(100) not null, version int not null constraint df_lost_removable_version default 1,
    constraint pk_lost_removable primary key (id, code))`)
  return {
    insertRemovable: async (connection, code) => {
      const id =
        connection === 'pg'
          ? ((await pgOwner<Array<{ id: string }>>`insert into lost.removable (code) values (${code}) returning id::text as id`)[0]?.id ?? '')
          : String(
              (
                await msOwner
                  .request()
                  .input('code', mssql.NVarChar(100), code)
                  .query<{ id: number }>('insert into lost.removable (code) output inserted.id values (@code)')
              ).recordset[0]?.id,
            )
      const token = recordToken(['id', 'code'], { id, code })
      if (!token.ok) throw new Error(token.message)
      return token.token
    },
    removableCoded: async (connection, code) => {
      if (connection === 'pg') return (await pgOwner<Array<{ n: number }>>`select count(*)::int as n from lost.removable where code = ${code}`)[0]?.n ?? 0
      return (
        (await msOwner.request().input('code', mssql.NVarChar(100), code).query<{ n: number }>('select count(*) as n from lost.removable where code = @code'))
          .recordset[0]?.n ?? 0
      )
    },
    ordersWithNotes: async (connection, notes) => {
      if (connection === 'pg') return (await pgOwner<Array<{ n: number }>>`select count(*)::int as n from sales."order" where notes = ${notes}`)[0]?.n ?? 0
      const result = await msOwner
        .request()
        .input('notes', mssql.NVarChar(mssql.MAX), notes)
        .query<{ n: number }>('select count(*) as n from sales.[order] where notes = @notes')
      return result.recordset[0]?.n ?? 0
    },
    close: async () => {
      await pgOwner.end({ timeout: 5 })
      await msOwner.close()
    },
  }
}
