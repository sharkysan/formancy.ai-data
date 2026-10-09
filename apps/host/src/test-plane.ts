import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataClient } from '@formancy/data-client'
import type { DataClient } from '@formancy/data-client'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FieldBinding, FormPolicy } from '@formancy/data-core'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, DRIVER_FACTORIES } from '@formancy/data-server'
import type { ConnectionConfig, ConnectionRegistry, IdentityVerifier } from '@formancy/data-server'
import mssql from 'mssql'
import postgres from 'postgres'
import { inject } from 'vitest'

/*
 * One suite file's server: the real data server over the run's two databases,
 * through the real drivers, behind a fake `fetch` -- the studio's test plane
 * with the runtime plane switched on, and a real registry where the studio's
 * has captured snapshots (0029). Every answer the host page gets in a test is
 * the one `createDataServer` gives, from the database: what stale is, which
 * customers a tenant may pick, whether a selection is still one of them.
 *
 * What is fake is what the studio's plane fakes: the identity verifier, which
 * takes literal tokens (verification is identity.test's, and the client
 * suite signs real ones), and `fetch`, which goes through `app.inject`
 * instead of a socket.
 */

/** The tokens the fake verifier accepts. Literal, and meaningless anywhere but this suite. */
export const TOKENS = { admin: 'host-test-administrator', clerk: 'host-test-clerk-tenant-1', otherClerk: 'host-test-clerk-tenant-2' } as const

const verifyIdentity: IdentityVerifier = async (token) => {
  if (token === TOKENS.admin) return { ok: true, identity: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.clerk) return { ok: true, identity: { actor: { id: 'clerk-1', roles: ['clerk'] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.otherClerk) return { ok: true, identity: { actor: { id: 'clerk-2', roles: ['clerk'] }, attributes: { tenant: '2' } } }
  return { ok: false, reason: 'ERR_JWS_INVALID' }
}

/** The fixture's values, from the run's setup: see `Edges`. */
export const EDGES = inject('edges')

/** The engines every runtime behaviour is proved on (0003), with what each needs to offer update. */
export const ENGINES = [
  { engine: 'PostgreSQL', connection: 'pg', formId: 'pg-order', versionColumn: 'row_version' as string | undefined },
  { engine: 'SQL Server', connection: 'ms', formId: 'ms-order', versionColumn: undefined },
] as const

export type Engine = (typeof ENGINES)[number]

/** One request as the page sent it: what the server, and anybody on the wire, would see. */
export interface Sent {
  method: string
  /** The URL as the page wrote it, query string included. */
  url: string
  path: string
  headers: Record<string, string>
  body: string | undefined
}

export interface Plane {
  /** The `fetch` the page is given: every call is answered by the real server. */
  fetch: typeof fetch
  /** Every request the page made, in order. */
  sent: Sent[]
  /** The clerk of tenant 1, through a client beside the page: what the database holds, asked by somebody else. */
  clerk: DataClient
  /**
   * Connections whose database stops answering: opening one fails as a
   * refused socket does, which the server must say as 503 without passing the
   * driver's message on. The one fault here that is not the database's own.
   */
  unreachable: Set<string>
  db: {
    /** A customer of tenant 1, written through the database's owner, as another application would. */
    insertCustomer(connection: Engine['connection'], no: number, name: string): Promise<void>
    deleteCustomer(connection: Engine['connection'], no: number): Promise<void>
  }
  close(): Promise<void>
}

/** A clerk may do everything the form offers, on the fields it writes, inside their tenant: the end-to-end journey's policy. */
function clerkPolicy(fields: readonly FieldBinding[]): FormPolicy {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
  }
}


/**
 * `app.inject` as a `fetch`, recording what was asked into `sent` when given a
 * list. Every request still being answered is in `pending`: a renderer that
 * abandons a search rejects its fetch, and the server goes on asking the
 * database, so closing the plane waits for those rather than pulling the
 * connections out from under them.
 */
function injectingFetch(app: Awaited<ReturnType<typeof createDataServer>>, pending: Set<Promise<unknown>>, sent?: Sent[]): typeof fetch {
  return async (input, init) => {
    const href = input instanceof Request ? input.url : String(input)
    const url = new URL(href, 'http://host.test')
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const body = typeof init?.body === 'string' ? init.body : undefined
    sent?.push({ method, url: href, path: url.pathname, headers, body })
    // A renderer abandons a search when the next keystroke arrives; the
    // browser's fetch then rejects with the signal's reason, and so does this.
    const signal = init?.signal ?? undefined
    signal?.throwIfAborted()
    const answering = Promise.resolve(app.inject({ method: method as 'GET' | 'POST', url: `${url.pathname}${url.search}`, headers, ...(body === undefined ? {} : { payload: body }) }))
    pending.add(answering)
    void answering.finally(() => pending.delete(answering)).catch(() => {})
    const reply = await answering
    signal?.throwIfAborted()
    const answered = new Headers()
    for (const [name, value] of Object.entries(reply.headers)) {
      if (value !== undefined) answered.set(name, Array.isArray(value) ? value.join(', ') : String(value))
    }
    return new Response(reply.statusCode === 204 ? null : reply.body, { status: reply.statusCode, headers: answered })
  }
}

/** A `fetch` whose writes are answered late, when the test says so: see `holdingWrites`. */
export interface Holding {
  fetch: typeof fetch
  /** The path of every write the server has answered and this is still holding, oldest first. */
  held: string[]
  /** Hand the oldest held answer to whoever asked. */
  answer(): void
}

/**
 * `fetch` with every create and update held after the server has answered it:
 * the record is written, and the page does not know yet. That is the moment a
 * person goes on typing, presses Save again or opens another record, and on
 * `app.inject` it otherwise lasts too few ticks to reach. Reads and lookups
 * pass straight through.
 */
export function holdingWrites(fetch: typeof globalThis.fetch): Holding {
  const waiting: Array<() => void> = []
  const held: string[] = []
  return {
    held,
    fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname
      if (!/\/records\/(create|update)$/.test(path)) return fetch(input, init)
      const reply = await fetch(input, init)
      held.push(path)
      await new Promise<void>((resolve) => waiting.push(resolve))
      held.splice(held.indexOf(path), 1)
      return reply
    },
    answer: () => {
      waiting.shift()?.()
    },
  }
}

/** Starts the server and publishes `pg-order` and `ms-order` through the administrator's plane. */
export async function startPlane(): Promise<Plane> {
  const { pg, ms } = inject('databases')
  const connections: ConnectionConfig[] = [
    { id: 'pg', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: ['sales'], tls: { enabled: false } },
    { id: 'ms', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: ['sales'], tls: { enabled: false, trustServerCertificate: true } },
  ]
  const real = createConnectionRegistry(connections, DRIVER_FACTORIES, { env: { PG_PASSWORD: pg.password, MS_PASSWORD: ms.password }, readFile: async () => '' })
  const unreachable = new Set<string>()
  const registry: ConnectionRegistry = {
    ...real,
    open: async (id) => {
      if (unreachable.has(id)) throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
      return real.open(id)
    },
  }
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-host-'))
  const store = createFileConfigurationStore(root)
  const app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'] }, runtime: { registry, store } })

  const admin = async (url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const reply = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${TOKENS.admin}` }, payload })
    if (reply.statusCode >= 300) throw new Error(`${url} answered ${String(reply.statusCode)}: ${reply.body}`)
    return reply.json<Record<string, unknown>>()
  }
  for (const { connection, formId, versionColumn } of ENGINES) {
    const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'sales', name: 'order' },
      formId,
      title: 'Order',
      lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
      ...(versionColumn === undefined ? {} : { versionColumn }),
    })
    const policy = clerkPolicy((bindings as { fields: FieldBinding[] }).fields)
    await admin(`/v1/forms/${formId}/versions`, { expectedBase: null, bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot } })
  }

  const pgAdmin = postgres({ host: pg.host, port: pg.port, database: pg.database, username: pg.user, password: pg.password, onnotice: () => {} })
  const msAdmin = await new mssql.ConnectionPool({
    server: ms.host,
    port: ms.port,
    database: ms.database,
    user: ms.user,
    password: ms.password,
    options: { encrypt: false, trustServerCertificate: true },
  }).connect()

  const sent: Sent[] = []
  const pending = new Set<Promise<unknown>>()
  return {
    fetch: injectingFetch(app, pending, sent),
    sent,
    clerk: createDataClient({ token: () => TOKENS.clerk, fetch: injectingFetch(app, pending) }),
    unreachable,
    db: {
      insertCustomer: async (connection, no, name) => {
        if (connection === 'pg') await pgAdmin`insert into sales.customer (tenant_id, customer_no, name) values (1, ${no}, ${name})`
        else await msAdmin.request().input('no', mssql.Int, no).input('name', mssql.NVarChar(200), name).query('insert into sales.customer (tenant_id, customer_no, name) values (1, @no, @name)')
      },
      deleteCustomer: async (connection, no) => {
        if (connection === 'pg') await pgAdmin`delete from sales.customer where tenant_id = 1 and customer_no = ${no}`
        else await msAdmin.request().input('no', mssql.Int, no).query('delete from sales.customer where tenant_id = 1 and customer_no = @no')
      },
    },
    close: async () => {
      await Promise.allSettled([...pending])
      await app.close()
      await real.close()
      await pgAdmin.end()
      await msAdmin.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
