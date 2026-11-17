import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataClient } from '@formancy/data-client'
import type { DataClient } from '@formancy/data-client'
import { applyPresentation, EMPTY_PRESENTATION, MAX_LOOKUP_DEADLINE_MS } from '@formancy/data-core'
import type { FieldBinding, FormBindings, FormPolicy, PresentationOverrides } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, createIdentityVerifier, DRIVER_FACTORIES } from '@formancy/data-server'
import type { ConfigurationStore, ConnectionConfig, ConnectionRegistry, IdentityVerifier } from '@formancy/data-server'
import { AUDIENCE, ISSUER, TENANT_CLAIM } from '@formancy/data-live-demo/worker'
import mssql from 'mssql'
import postgres from 'postgres'
import { inject } from 'vitest'
import { childForms, clerkPolicy, offered, ORDER_CASCADES, ORDER_MOVES, ORDER_VIEWS, STARTING, WITHHELD_VIEWS } from './test-forms.js'
import type { Proposed } from './test-forms.js'
import { actionDb, losingRuns, publishActions } from './test-actions.js'
import type { ActionDb, LosingRuns } from './test-actions.js'
import { orderDb } from './test-orders.js'
import type { OrderDb } from './test-orders.js'
import { injectingFetch } from './test-fetch.js'
import { losingSaves, publishSaved, savedDb } from './test-saves.js'
import type { SavedDb } from './test-saves.js'
import type { Sent } from './test-fetch.js'

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
 * suite signs real ones) -- and, for the live demo's page, the server's own
 * verifier beside it -- and `fetch`, which goes through `app.inject` instead
 * of a socket.
 */

/** The tokens the fake verifier accepts. Literal, and meaningless anywhere but this suite. Tenant 3's clerk sees the paged customers alone (0085). */
export const TOKENS = {
  admin: 'host-test-administrator',
  clerk: 'host-test-clerk-tenant-1',
  otherClerk: 'host-test-clerk-tenant-2',
  thirdClerk: 'host-test-clerk-tenant-3',
  /** Tenant 1's clerk who keeps views of their own (0126), so no other case meets them. */
  keeper: 'host-test-clerk-tenant-1-keeper',
  /** Tenant 1's clerk who may also delete an order's lines saved with it (0155), which no other clerk may. */
  remover: 'host-test-clerk-tenant-1-remover',
} as const

const verifyIdentity: IdentityVerifier = async (token) => {
  if (token === TOKENS.admin) return { ok: true, identity: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.clerk) return { ok: true, identity: { actor: { id: 'clerk-1', roles: ['clerk'] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.otherClerk) return { ok: true, identity: { actor: { id: 'clerk-2', roles: ['clerk'] }, attributes: { tenant: '2' } } }
  if (token === TOKENS.thirdClerk) return { ok: true, identity: { actor: { id: 'clerk-3', roles: ['clerk'] }, attributes: { tenant: '3' } } }
  if (token === TOKENS.keeper) return { ok: true, identity: { actor: { id: 'clerk-1-keeper', roles: ['clerk'] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.remover) return { ok: true, identity: { actor: { id: 'clerk-1-remover', roles: ['clerk', 'remover'] }, attributes: { tenant: '1' } } }
  return { ok: false, reason: 'ERR_JWS_INVALID' }
}

/**
 * With `demoKey`, the literal tokens and the live demo's (0070): a token
 * the fake does not know is judged by data-server's own verifier, given the
 * key and configured as deploy/demo's image configures the server -- the
 * issuer, the audience and `tenant=tid` that its Dockerfile test holds to
 * the demo's token module. So a persona signed in through the demo's
 * Worker is whoever that verifier says, as on Cloudflare.
 */
async function verifierFor(demoKey: string | undefined): Promise<IdentityVerifier> {
  if (demoKey === undefined) return verifyIdentity
  const demo = await createIdentityVerifier({
    key: { kind: 'secret', secret: demoKey },
    issuer: ISSUER,
    audience: AUDIENCE,
    attributes: { tenant: TENANT_CLAIM },
  })
  const literal = new Set<string>(Object.values(TOKENS))
  return async (token) => (literal.has(token) ? verifyIdentity(token) : demo(token))
}

/** The fixture's values, from the run's setup: see `Edges`. */
export const EDGES = inject('edges')

/** Tenant 3's paged customers and its first order on each engine, from the run's setup: see `Paged`. */
export const PAGED = inject('paged')

/**
 * The engines every runtime behaviour is proved on (0003), with what each
 * needs to offer update, and the ids of the forms `startPlane({ children: true })`
 * publishes beside the order form: an order's lines, reached through their
 * order (0043); employees, each managed by an employee -- a form that is its
 * own child; and orders by who created and who approved them -- one form
 * twice under one parent, which this clerk may only read. With
 * `startPlane({ children: true, deliveries: true })`, an order's deliveries
 * too, named by their carrier (test-forms.ts). `read` is the order form
 * again, which `startPlane({ paged: true })` publishes for the clerk to
 * read only (0085); `withheld` the order form again, which
 * `startPlane({ views: true })` publishes for the clerk to read without
 * Amount, with views whose default is on Amount (0105); `unread` the order
 * form again, which `startPlane({ unread: true })` publishes for the clerk
 * to create and update without reading or writing its status (0149);
 * `starting` the order form again, which `startPlane({ starting: true })`
 * publishes with `STARTING`, its status started at placed over its
 * column's draft and its group at Online (0150); `savedOrder` and
 * `savedLines`, which `startPlane({ saves: true })` publishes over the
 * parity schema's order and its lines, saved with it, one to three of them
 * (0155).
 */
export const ENGINES = [
  {
    engine: 'PostgreSQL',
    connection: 'pg',
    formId: 'pg-order',
    versionColumn: 'row_version' as string | undefined,
    lines: 'pg-order-line',
    employees: 'pg-employee',
    staff: 'pg-order-staff',
    deliveries: 'pg-delivery',
    parity: 'pg-parity',
    removable: 'pg-removable',
    read: 'pg-order-read',
    withheld: 'pg-order-withheld',
    moves: 'pg-order-moves',
    unread: 'pg-order-unread',
    starting: 'pg-order-starting',
    party: 'pg-party',
    company: 'pg-party-company',
    price: 'pg-price',
    savedOrder: 'pg-saved-order',
    savedLines: 'pg-saved-line',
  },
  {
    engine: 'SQL Server',
    connection: 'ms',
    formId: 'ms-order',
    versionColumn: undefined,
    lines: 'ms-order-line',
    employees: 'ms-employee',
    staff: 'ms-order-staff',
    deliveries: 'ms-delivery',
    parity: 'ms-parity',
    removable: 'ms-removable',
    read: 'ms-order-read',
    withheld: 'ms-order-withheld',
    moves: 'ms-order-moves',
    unread: 'ms-order-unread',
    starting: 'ms-order-starting',
    party: 'ms-party',
    company: 'ms-party-company',
    price: 'ms-price',
    savedOrder: 'ms-saved-order',
    savedLines: 'ms-saved-line',
  },
] as const

export type Engine = (typeof ENGINES)[number]

export interface Plane {
  /** The `fetch` the page is given: every call is answered by the real server. */
  fetch: typeof fetch
  /** Every request the page made, in order. */
  sent: Sent[]
  /** The clerk of tenant 1, through a client beside the page: what the database holds, asked by somebody else. */
  clerk: DataClient
  /** The clerk of tenant 3, whose customers are the paged ones (0085), the same way. */
  thirdClerk: DataClient
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
  /**
   * Connections whose next save of a record with its rows (0155) loses its
   * answer the same way: `after` the transaction committed, or `before` it
   * began. The server answers 502 naming the record and the version sent.
   */
  loseSave: Map<string, 'after' | 'before'>
  /** Connections whose next run of an action (0162) loses its answer: see `LosingRuns`. */
  runs: LosingRuns
  /** The server's store, written straight to as an older release's server wrote it, which this release's routes refuse. */
  store: ConfigurationStore
  /**
   * With `startPlane({ demo: true })`, the key the server verifies the live
   * demo's tokens with: random for each plane, as a Durable Object makes one
   * for each start (0070). Undefined otherwise, and no demo token is accepted.
   */
  demoKey: string | undefined
  db: SavedDb & ActionDb & OrderDb
  close(): Promise<void>
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
 * scoped to `parity`. With `demo`, the server also accepts the live demo's
 * tokens, signed with `demoKey` (0070). With `paged`, the order form is
 * published again as `read` of `ENGINES`, which the clerk may only read.
 * With `views` (0105), the order form is published with `ORDER_VIEWS`, the
 * deliveries with `DELIVERY_VIEWS`, and the order form again as `withheld`
 * of `ENGINES`, which the clerk may read but for Amount, with
 * `WITHHELD_VIEWS` (test-forms.ts). With `sections` (0109), `party` of
 * `ENGINES` is published over `parity.party`, and `company` over
 * `parity.party_company` as a section of it, shown while its kind is
 * `company`. With `versions` (0113, 0115), `price` of `ENGINES` is
 * published over `parity.price`, a chain of versions, whose note the clerk
 * reads and may not write (0117). With `unread` (0149), the order form is
 * published again as `unread` of `ENGINES`, whose status the clerk neither
 * reads nor writes. With `starting` (0150), the order form is published
 * again as `starting` of `ENGINES`, with `STARTING` chosen over its base.
 * With `actions` (0162), each engine's action order (test-actions.ts).
 */
export async function startPlane(
  options: {
    children?: boolean
    deletes?: boolean
    deliveries?: boolean
    demo?: boolean
    paged?: boolean
    sections?: boolean
    versions?: boolean
    views?: boolean
    /** An order form whose status the clerk moves from draft to placed to shipped, and never back (0112, 0127). */
    moves?: boolean
    /** An order form whose status, which defaults to draft, the clerk neither reads nor writes (0149). */
    unread?: boolean
    /** An order form whose status starts at placed and whose group at Online, chosen over the generated base (0150). */
    starting?: boolean
    /** An order and its lines saved with it, one to three of them, over the parity schema (0155). */
    saves?: boolean
    actions?: boolean
  } = {},
): Promise<Plane> {
  const { pg, ms } = inject('databases')
  // 32 random bytes as base64url: the shape of the key a Durable Object starts its container with.
  const demoKey = options.demo === true ? randomBytes(32).toString('base64url') : undefined
  const deletes = options.deletes === true
  const connections: ConnectionConfig[] = [
    { id: 'pg', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: ['sales'], tls: { enabled: false } },
    { id: 'ms', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: ['sales'], tls: { enabled: false, trustServerCertificate: true } },
    { id: 'pg-parity', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: ['parity'], tls: { enabled: false } },
    { id: 'ms-parity', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: ['parity'], tls: { enabled: false, trustServerCertificate: true } },
    { id: 'pg-actions', kind: 'postgres', ...pg, password: 'env:PG_PASSWORD', schemas: ['actions'], tls: { enabled: false } },
    { id: 'ms-actions', kind: 'sqlserver', ...ms, password: 'env:MS_PASSWORD', schemas: ['actions'], tls: { enabled: false, trustServerCertificate: true } },
  ]
  const real = createConnectionRegistry(connections, DRIVER_FACTORIES, {
    env: { PG_PASSWORD: pg.password, MS_PASSWORD: ms.password },
    readFile: async () => '',
  })
  const unreachable = new Set<string>()
  const lose = new Map<string, 'after' | 'before'>()
  const loseSave = new Map<string, 'after' | 'before'>()
  const runs: LosingRuns = { lose: new Map(), late: [] }
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
          save: losingSaves(open.records, id, loseSave),
        },
        actions: losingRuns(open.actions, id, runs),
      }
    },
  }
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-host-'))
  const store = createFileConfigurationStore(root)
  // The administrator's trail is the server's suites' subject; here it is required and discarded. So is the
  // lookup deadline (0061), which counts a wait for a pooled connection: on CI's runner, beside the other
  // files, a search past 892 ms was 503 lookup-timeout, so the plane runs with the longest, as 0034's does.
  const app = await createDataServer({
    verifyIdentity: await verifierFor(demoKey),
    admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } },
    runtime: { registry, store, lookupDeadlineMs: MAX_LOOKUP_DEADLINE_MS },
  })

  const admin = async (url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const reply = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${TOKENS.admin}` }, payload })
    if (reply.statusCode >= 300) throw new Error(`${url} answered ${String(reply.statusCode)}: ${reply.body}`)
    return reply.json<Record<string, unknown>>()
  }
  const views = options.views === true
  for (const { connection, formId: order, versionColumn, read, withheld, moves, unread, starting } of ENGINES) {
    for (const formId of [
      order,
      ...(options.paged === true ? [read] : []),
      ...(views ? [withheld] : []),
      ...(options.moves === true ? [moves] : []),
      ...(options.unread === true ? [unread] : []),
      ...(options.starting === true ? [starting] : []),
    ]) {
      const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
        connection,
        root: { schema: 'sales', name: 'order' },
        formId,
        title: 'Order',
        lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
        ...(versionColumn === undefined ? {} : { versionColumn }),
      })
      const base = clerkPolicy((bindings as { fields: FieldBinding[] }).fields)
      // `read` the clerk may only read, so a record of it is drawn with every field disabled;
      // `withheld` they may read too, but for Amount, which its default view is on.
      const readOnly = { ...base, operations: offered(bindings as Proposed, true) }
      const policy: FormPolicy =
        formId === read
          ? readOnly
          : formId === withheld
            ? { ...readOnly, fields: { ...base.fields, amount: { read: [], write: [] } } }
            : formId === moves
              ? { ...base, transitions: ORDER_MOVES }
              : formId === unread
                ? { ...base, fields: { ...base.fields, status: { read: [], write: [] } } }
                : deletes
                  ? { ...base, operations: { ...base.operations, delete: ['clerk'] }, cascades: ORDER_CASCADES }
                  : base
      // A presentation of views alone: the form is its base (0030, 0105).
      const named = !views ? undefined : formId === order ? ORDER_VIEWS : formId === withheld ? WITHHELD_VIEWS : undefined
      // `starting`'s starting values (0150) are the one presentation here that changes the form, so it is applied as the server checks it.
      const presentation: PresentationOverrides =
        formId === starting ? { ...EMPTY_PRESENTATION, fields: STARTING } : named === undefined ? EMPTY_PRESENTATION : { ...EMPTY_PRESENTATION, views: named }
      const presented = applyPresentation(form as FormSchema, presentation, bindings as FormBindings)
      if (!presented.ok) throw new Error(`the presentation of ${formId} does not apply: ${presented.problems.join('; ')}`)
      await admin(`/v1/forms/${formId}/versions`, {
        expectedBase: null,
        bundle: { format: 2, connection, generation, base: form, presentation, form: presented.form, bindings, policy, snapshot },
      })
    }
  }
  for (const { parity: connection, removable: formId } of deletes ? ENGINES : []) {
    // A table whose key the database numbers, so its version column proves a record (0050); its tenant pinned to the clerk's.
    const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'parity', name: 'removable' },
      formId,
      title: 'Removable',
      lookups: [],
      versionColumn: 'version',
      pinned: ['tenant_id'],
    })
    const policy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'], delete: ['clerk'] },
      fields: { id: { read: ['clerk'], write: [] }, tenant_id: { read: ['clerk'], write: [] }, note: { read: ['clerk'], write: ['clerk'] } },
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
      lookups: {},
    }
    await admin(`/v1/forms/${formId}/versions`, {
      expectedBase: null,
      bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
    })
  }
  for (const { parity: connection, party, company } of options.sections === true ? ENGINES : []) {
    // A party, its tenant pinned to the clerk's, and its company details as a section of it while its kind is company (0109).
    const CLERK_RW = { read: ['clerk'], write: ['clerk'] }
    const parties = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'parity', name: 'party' },
      formId: party,
      title: 'Party',
      lookups: [],
      versionColumn: 'version',
      pinned: ['tenant_id'],
    })
    const partyPolicy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
      fields: { id: { read: ['clerk'], write: [] }, tenant_id: { read: ['clerk'], write: [] }, name: CLERK_RW, kind: CLERK_RW },
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
      lookups: {},
    }
    const companies = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'parity', name: 'party_company' },
      formId: company,
      title: 'Company details',
      lookups: [{ foreignKey: 'fk_party_company_party', display: ['name'], section: { when: { column: 'kind', value: 'company' } } }],
      versionColumn: 'version',
    })
    const companyPolicy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
      fields: { party: CLERK_RW, vat_no: CLERK_RW },
      rowFilters: [],
      lookups: { party: [{ column: 'tenant_id', attribute: 'tenant' }] },
      through: ['party'],
    }
    for (const [formId, proposed, policy] of [
      [party, parties, partyPolicy],
      [company, companies, companyPolicy],
    ] as const) {
      const { form, bindings, snapshot, generation } = proposed
      await admin(`/v1/forms/${formId}/versions`, {
        expectedBase: null,
        bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
      })
    }
  }
  for (const { parity: connection, price } of options.versions === true ? ENGINES : []) {
    // A product's prices, each a version valid from one date until the next starts, the tenant pinned to the clerk's (0113, 0115).
    const CLERK_RW = { read: ['clerk'], write: ['clerk'] }
    const READS = { read: ['clerk'], write: [] }
    const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
      connection,
      root: { schema: 'parity', name: 'price' },
      formId: price,
      title: 'Price',
      lookups: [],
      versionColumn: 'version',
      pinned: ['tenant_id'],
      validity: { from: 'valid_from', to: 'valid_to' },
    })
    const policy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
      // The note the clerk reads and may not write, which the bindings write: the policy's, so the page learns it from `writable` (0117).
      fields: { tenant_id: READS, product_no: CLERK_RW, valid_from: CLERK_RW, valid_to: READS, amount: CLERK_RW, note: READS },
      rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
      lookups: {},
    }
    await admin(`/v1/forms/${price}/versions`, {
      expectedBase: null,
      bundle: { format: 2, connection, generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings, policy, snapshot },
    })
  }
  if (options.saves === true) await publishSaved(admin)
  if (options.actions === true) await publishActions(admin, ENGINES)
  for (const engine of options.children === true ? ENGINES : []) {
    for (const child of childForms(engine, { deletes, deliveries: options.deliveries === true, views })) {
      const { form, bindings, snapshot, generation } = await admin('/v1/form-proposals', {
        connection: engine.connection,
        root: { schema: 'sales', name: child.table },
        formId: child.formId,
        title: child.title,
        lookups: child.lookups,
        ...(child.versionColumn === undefined ? {} : { versionColumn: child.versionColumn }),
        ...(child.pinned === undefined ? {} : { pinned: child.pinned }),
      })
      const proposed = bindings as Proposed & FormBindings
      const presentation: PresentationOverrides = { ...EMPTY_PRESENTATION, ...(child.views === undefined ? {} : { views: child.views }) }
      const presented = applyPresentation(form as FormSchema, presentation, proposed)
      if (!presented.ok) throw new Error(presented.problems.join('; '))
      const bundle = {
        format: 2,
        connection: engine.connection,
        generation,
        base: form,
        presentation,
        form: presented.form,
        bindings,
        policy: child.policy(proposed),
        snapshot,
      }
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
    thirdClerk: createDataClient({ token: () => TOKENS.thirdClerk, fetch: injectingFetch(app, pending) }),
    unreachable,
    lose,
    loseSave,
    runs,
    store,
    demoKey,
    db: {
      ...savedDb(pgAdmin, msAdmin),
      ...actionDb(pgAdmin, msAdmin),
      ...orderDb(pgAdmin, msAdmin),
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
