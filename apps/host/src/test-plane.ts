import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataClient } from '@formancy/data-client'
import type { DataClient } from '@formancy/data-client'
import { applyPresentation, EMPTY_PRESENTATION } from '@formancy/data-core'
import type { FieldBinding, FormBindings, FormPolicy, PresentationOverrides } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, DRIVER_FACTORIES } from '@formancy/data-server'
import type { ConfigurationStore, ConnectionConfig, ConnectionRegistry, IdentityVerifier } from '@formancy/data-server'
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

/**
 * The engines every runtime behaviour is proved on (0003), with what each
 * needs to offer update, and the ids of the forms `startPlane({ children: true })`
 * publishes beside the order form: an order's lines, reached through their
 * order (0043); employees, each managed by an employee -- a form that is its
 * own child; and orders by who created and who approved them -- one form
 * twice under one parent, which this clerk may only read.
 */
export const ENGINES = [
  { engine: 'PostgreSQL', connection: 'pg', formId: 'pg-order', versionColumn: 'row_version' as string | undefined, lines: 'pg-order-line', employees: 'pg-employee', staff: 'pg-order-staff', parity: 'pg-parity', removable: 'pg-removable' },
  { engine: 'SQL Server', connection: 'ms', formId: 'ms-order', versionColumn: undefined, lines: 'ms-order-line', employees: 'ms-employee', staff: 'ms-order-staff', parity: 'ms-parity', removable: 'ms-removable' },
] as const

/** The keys a delete of an order acts through on the fixture, with their actions: its lines and deliveries, and the deliveries' parcels (0051, 0056). */
const ORDER_CASCADES: NonNullable<FormPolicy['cascades']> = [
  { table: { schema: 'sales', name: 'order_line' }, foreignKey: 'fk_order_line_order', onDelete: 'cascade' },
  { table: { schema: 'sales', name: 'delivery' }, foreignKey: 'fk_delivery_order', onDelete: 'cascade' },
  { table: { schema: 'sales', name: 'parcel' }, foreignKey: 'fk_parcel_delivery', onDelete: 'cascade' },
]

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
  /**
   * Connections whose next record insert loses its answer between the server
   * and the database: `after` the database stored it, or `before` it was
   * sent. The server is then told what a cut connection tells it,
   * `unknown-outcome`, and answers 502 with the record its key names (0031).
   * The fault is the network's, around a real write: data-server's
   * e2e-lost-answer proves the adapters say `unknown-outcome` when a TCP hop
   * really drops the answer, and needs a text marker in it, which an order
   * line, all numbers, does not have.
   */
  lose: Map<string, 'after' | 'before'>
  /** The server's store, written straight to as an older release's server wrote it, which this release's routes refuse. */
  store: ConfigurationStore
  db: {
    /** A customer of tenant 1, written through the database's owner, as another application would. */
    insertCustomer(connection: Engine['connection'], no: number, name: string): Promise<void>
    deleteCustomer(connection: Engine['connection'], no: number): Promise<void>
    /** How many orders have exactly these notes, asked of the database's owner. */
    countOrders(connection: Engine['connection'], notes: string): Promise<number>
    /** `count` orders of tenant 1's, for Muster AG, noted `<notes> <n>`, written by the owner in one statement: more than a page. */
    insertOrders(connection: Engine['connection'], count: number, notes: string): Promise<void>
    /** A row of `parity.removable_child` that refers to the removable record `record`, with NO ACTION: a delete of it is refused while this row is there. */
    referToRemovable(connection: Engine['connection'], record: string): Promise<void>
    /**
     * An order of tenant 1's approved by employee `approver`, written by the
     * owner -- the clerk may only read the form that names approvers -- and
     * its token, which spells its key.
     */
    insertApprovedOrder(connection: Engine['connection'], approver: number): Promise<string>
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

/** A `fetch` that holds the requests it is told to, until the test lets each go: see `holdingRequests`. */
export interface Held {
  fetch: typeof fetch
  /** The path of every request held and not yet let go, oldest first. */
  held: string[]
  /** Send the oldest held request on to the real server; settles once its answer is handed back to the page. */
  pass(): Promise<void>
  /** Fail the oldest held request as a dropped connection does, with the browser's own `TypeError`. */
  fail(): Promise<void>
}

/**
 * `fetch` with each request `holds` picks kept back before it is sent: a
 * record's read, or a form's definition, that the person has moved past by
 * the time it is answered. On `app.inject` an answer otherwise arrives within
 * a few ticks, before a person could do anything else. Everything else
 * passes straight through. What `pass` and `fail` settle on is the answer
 * handed back; what the page then does with it is a few ticks more.
 */
export function holdingRequests(fetch: typeof globalThis.fetch, holds: (request: { method: string; path: string; body: string | undefined }) => boolean): Held {
  const waiting: Array<(go: boolean) => Promise<void>> = []
  const held: string[] = []
  const release = async (go: boolean): Promise<void> => {
    const next = waiting.shift()
    if (next === undefined) throw new Error('no request is held')
    await next(go)
  }
  return {
    held,
    fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname
      const method = (init?.method ?? 'GET').toUpperCase()
      if (!holds({ method, path, body: typeof init?.body === 'string' ? init.body : undefined })) return fetch(input, init)
      held.push(path)
      let answered: () => void = () => {}
      const handedBack = new Promise<void>((resolve) => {
        answered = resolve
      })
      const go = await new Promise<boolean>((resolve) =>
        waiting.push(async (decided) => {
          resolve(decided)
          await handedBack
        }),
      )
      held.splice(held.indexOf(path), 1)
      try {
        if (!go) throw new TypeError('Failed to fetch')
        return await fetch(input, init)
      } finally {
        answered()
      }
    },
    pass: () => release(true),
    fail: () => release(false),
  }
}

/** A `fetch` that loses the answers to writes: see `losingWrites`. */
export interface Losing {
  fetch: typeof fetch
  /** The path of every write whose answer it lost: `times` at most. */
  lost: string[]
}

/**
 * `fetch` that loses the answer to the next create or update, as a network
 * between the page and the data server does (0031), and passes everything
 * else through. `after`: the request reaches the real server, which stores
 * it and answers, and the page is told the fetch failed -- what the browser
 * says when the connection drops after sending. `before`: it fails without
 * reaching the server, which the page cannot tell apart from `after`. Either
 * way the rejection is the browser's own `TypeError`, so the client sees
 * exactly what it would see in a page. Once, unless `times` says more: what
 * the page does next is what is under test, and it must reach the server.
 */
export function losingWrites(fetch: typeof globalThis.fetch, { when, times = 1, writes = /\/records\/(create|update)$/ }: { when: 'after' | 'before'; times?: number; writes?: RegExp }): Losing {
  const lost: string[] = []
  return {
    lost,
    fetch: async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname
      if (lost.length >= times || !writes.test(path)) return fetch(input, init)
      lost.push(path)
      if (when === 'after') await fetch(input, init)
      throw new TypeError('Failed to fetch')
    },
  }
}

/** The bindings as a proposal answers them: what the policy below is derived from. */
interface Proposed {
  fields: FieldBinding[]
  operations: { create?: unknown; update?: unknown; delete?: unknown }
}

/** The lookup fields of a proposal, each with its foreign key. */
const lookupsOf = (bindings: Proposed): Array<{ field: string; foreignKey: string }> =>
  bindings.fields.flatMap((binding) => (binding.kind === 'lookup' ? [{ field: binding.field, foreignKey: binding.foreignKey }] : []))

/** Each operation the form offers, granted to the clerk, unless `readOnly` -- delete only when `deletes` asks for it (0053). */
function offered(bindings: Proposed, readOnly = false, deletes = false): FormPolicy['operations'] {
  const grant = (operation: unknown): string[] => (readOnly || operation === false || operation === undefined ? [] : ['clerk'])
  return { read: ['clerk'], create: grant(bindings.operations.create), update: grant(bindings.operations.update), ...(deletes ? { delete: grant(bindings.operations.delete) } : {}) }
}

/**
 * What each child form of `ENGINES` is published with: its table, the
 * lookups the generator makes of its foreign keys, the labels a person gave
 * two of them in the studio, and its policy for tenant 1's clerk, derived
 * from the bindings.
 */
function childForms(engine: Engine, deletes: boolean): Array<{
  formId: string
  title: string
  table: string
  lookups: Array<{ foreignKey: string; display: string[] }>
  versionColumn?: string
  pinned?: string[]
  labels?: Record<string, string>
  policy: (bindings: Proposed) => FormPolicy
}> {
  // On SQL Server both tables carry a rowversion, which the generator finds itself.
  const version = engine.connection === 'pg' ? { versionColumn: 'row_version' } : {}
  return [
    {
      formId: engine.lines,
      title: 'Order line',
      table: 'order_line',
      lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
      ...version,
      // No tenant column of its own: its rows are its tenant's orders' lines, through the order lookup's filter (0043).
      policy: (bindings) => ({ ...clerkPolicy(bindings.fields), operations: offered(bindings, false, deletes), rowFilters: [], lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] }, through: ['order'] }),
    },
    {
      formId: engine.employees,
      title: 'Employee',
      table: 'employee',
      lookups: [{ foreignKey: 'fk_employee_manager', display: ['name'] }],
      // Employees are nobody's tenant: no row filter, and a manager may be any of them.
      policy: (bindings) => ({ ...clerkPolicy(bindings.fields), operations: offered(bindings), rowFilters: [], lookups: Object.fromEntries(lookupsOf(bindings).map(({ field }) => [field, []])) }),
    },
    {
      formId: engine.staff,
      title: 'Order',
      table: 'order',
      lookups: [
        { foreignKey: 'fk_order_created_by', display: ['name'] },
        { foreignKey: 'fk_order_approved_by', display: ['name'] },
      ],
      ...version,
      // Its tenant comes from the token, as the row filter says.
      pinned: ['tenant_id'],
      // The generator labels both lookups by their table, "Employee"; a person tells them apart.
      labels: { fk_order_created_by: 'Created by', fk_order_approved_by: 'Approved by' },
      // Read only, so the page draws a record of it with every field disabled.
      policy: (bindings) => ({ ...clerkPolicy(bindings.fields), operations: offered(bindings, true), lookups: Object.fromEntries(lookupsOf(bindings).map(({ field }) => [field, []])) }),
    },
  ]
}

/**
 * Starts the server and publishes `pg-order` and `ms-order` through the
 * administrator's plane -- with `children`, each engine's child forms of
 * `ENGINES` too. With `deletes` (0053), the clerk may also delete with each
 * form that offers it -- an order, its lines on SQL Server, whose rowversion
 * proves them, where on PostgreSQL their typed key offers none -- the order
 * form's policy naming every key a delete of an order acts through; and
 * each engine's `parity.removable`, which other rows refer to with NO ACTION
 * and RESTRICT, is published as `removable` of `ENGINES`, on a connection
 * scoped to `parity`.
 */
export async function startPlane(options: { children?: boolean; deletes?: boolean } = {}): Promise<Plane> {
  const { pg, ms } = inject('databases')
  const deletes = options.deletes === true
  const connections: ConnectionConfig[] = [
    { id: 'pg', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: ['sales'], tls: { enabled: false } },
    { id: 'ms', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: ['sales'], tls: { enabled: false, trustServerCertificate: true } },
    { id: 'pg-parity', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: ['parity'], tls: { enabled: false } },
    { id: 'ms-parity', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: ['parity'], tls: { enabled: false, trustServerCertificate: true } },
  ]
  const real = createConnectionRegistry(connections, DRIVER_FACTORIES, { env: { PG_PASSWORD: pg.password, MS_PASSWORD: ms.password }, readFile: async () => '' })
  const unreachable = new Set<string>()
  const lose = new Map<string, 'after' | 'before'>()
  const registry: ConnectionRegistry = {
    ...real,
    open: async (id) => {
      if (unreachable.has(id)) throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
      const open = await real.open(id)
      if (open === undefined) return undefined
      return {
        ...open,
        records: {
          ...open.records,
          insert: async (request) => {
            const when = lose.get(id)
            if (when === undefined) return open.records.insert(request)
            lose.delete(id)
            if (when === 'after') {
              const stored = await open.records.insert(request)
              if (!stored.ok) throw new Error(`the insert whose answer was to be lost was refused: ${stored.code}`)
            }
            return { ok: false, code: 'unknown-outcome', message: 'The connection to the database closed before the answer arrived.' }
          },
        },
      }
    },
  }
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-host-'))
  const store = createFileConfigurationStore(root)
  // The administrator's trail is the server's suites' subject; here it is required and discarded.
  const app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store } })

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
    const base = clerkPolicy((bindings as { fields: FieldBinding[] }).fields)
    const policy: FormPolicy = deletes ? { ...base, operations: { ...base.operations, delete: ['clerk'] }, cascades: ORDER_CASCADES } : base
    await admin(`/v1/forms/${formId}/versions`, { expectedBase: null, bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot } })
  }
  for (const { parity: connection, removable: formId } of deletes ? ENGINES : []) {
    // A table whose key the database numbers, so its version column proves a record (0050); its tenant pinned to the clerk's.
    const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', { connection, root: { schema: 'parity', name: 'removable' }, formId, title: 'Removable', lookups: [], versionColumn: 'version', pinned: ['tenant_id'] })
    const policy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'], delete: ['clerk'] },
      fields: { id: { read: ['clerk'], write: [] }, tenant_id: { read: ['clerk'], write: [] }, note: { read: ['clerk'], write: ['clerk'] } },
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
      lookups: {},
    }
    await admin(`/v1/forms/${formId}/versions`, { expectedBase: null, bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot } })
  }
  for (const engine of options.children === true ? ENGINES : []) {
    for (const child of childForms(engine, deletes)) {
      const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
        connection: engine.connection,
        root: { schema: 'sales', name: child.table },
        formId: child.formId,
        title: child.title,
        lookups: child.lookups,
        ...(child.versionColumn === undefined ? {} : { versionColumn: child.versionColumn }),
        ...(child.pinned === undefined ? {} : { pinned: child.pinned }),
      })
      const proposed = bindings as unknown as Proposed & FormBindings
      const presentation: PresentationOverrides = {
        ...EMPTY_PRESENTATION,
        fields: lookupsOf(proposed).flatMap(({ field, foreignKey }) => {
          const label = child.labels?.[foreignKey]
          return label === undefined ? [] : [{ field, anchor: { kind: 'lookup' as const, foreignKey }, label }]
        }),
      }
      const presented = applyPresentation(form as FormSchema, presentation, proposed)
      if (!presented.ok) throw new Error(presented.problems.join('; '))
      const bundle = { format: 2, connection: engine.connection, generation, base: form, presentation, form: presented.form, bindings, policy: child.policy(proposed), snapshot }
      await admin(`/v1/forms/${child.formId}/versions`, { expectedBase: null, bundle })
    }
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
    lose,
    store,
    db: {
      insertCustomer: async (connection, no, name) => {
        if (connection === 'pg') await pgAdmin`insert into sales.customer (tenant_id, customer_no, name) values (1, ${no}, ${name})`
        else await msAdmin.request().input('no', mssql.Int, no).input('name', mssql.NVarChar(200), name).query('insert into sales.customer (tenant_id, customer_no, name) values (1, @no, @name)')
      },
      deleteCustomer: async (connection, no) => {
        if (connection === 'pg') await pgAdmin`delete from sales.customer where tenant_id = 1 and customer_no = ${no}`
        else await msAdmin.request().input('no', mssql.Int, no).query('delete from sales.customer where tenant_id = 1 and customer_no = @no')
      },
      insertOrders: async (connection, count, notes) => {
        if (connection === 'pg') {
          await pgAdmin`insert into sales."order" (tenant_id, customer_no, order_date, status, amount, notes) select 1, 1001, date '2026-10-08', 'placed', 1, ${notes} || ' ' || n from generate_series(1, ${count}) as n`
          return
        }
        await msAdmin
          .request()
          .input('count', mssql.Int, count)
          .input('notes', mssql.NVarChar(200), notes)
          .query("insert into sales.[order] (tenant_id, customer_no, order_date, status, amount, notes) select 1, 1001, '2026-10-08', 'placed', 1, concat(@notes, ' ', value) from generate_series(1, @count)")
      },
      insertApprovedOrder: async (connection, approver) => {
        if (connection === 'pg') {
          const [row] = await pgAdmin<Array<{ id: string }>>`insert into sales."order" (tenant_id, customer_no, order_date, status, amount, approved_by) values (1, 1001, date '2026-10-08', 'placed', 1, ${approver}) returning id::text as id`
          return `k1:${String(row?.id)}`
        }
        const result = await msAdmin
          .request()
          .input('approver', mssql.Int, approver)
          .query<{ id: string }>("insert into sales.[order] (tenant_id, customer_no, order_date, status, amount, approved_by) output cast(inserted.id as nvarchar(40)) as id values (1, 1001, '2026-10-08', 'placed', 1, @approver)")
        return `k1:${String(result.recordset[0]?.id)}`
      },
      referToRemovable: async (connection, record) => {
        const id = Number(record.slice('k1:'.length))
        if (connection === 'pg') await pgAdmin`insert into parity.removable_child (removable_id, note) values (${id}, 'refers to it')`
        else await msAdmin.request().input('id', mssql.Int, id).query("insert into parity.removable_child (removable_id, note) values (@id, N'refers to it')")
      },
      countOrders: async (connection, notes) => {
        if (connection === 'pg') return (await pgAdmin<Array<{ n: number }>>`select count(*)::int as n from sales."order" where notes = ${notes}`)[0]?.n ?? 0
        const result = await msAdmin.request().input('notes', mssql.NVarChar(mssql.MAX), notes).query<{ n: number }>('select count(*) as n from sales.[order] where notes = @notes')
        return result.recordset[0]?.n ?? 0
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
