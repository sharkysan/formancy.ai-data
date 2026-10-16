// The host gate's plane: the real server over the shared fixture on a real
// PostgreSQL 17 through the real driver (0029), with the order form and the
// order line form published as the suites publish them (src/test-plane.ts,
// with `deletes`): as the generator made them, clerks of tenant 1 allowed
// everything they offer -- delete of an order included, its policy naming
// every key a delete of an order acts through (0051, 0053) -- and an order's
// lines reached through their order (0043), whose typed key offers no
// delete on PostgreSQL (0050). The identity verifier takes two literal
// tokens, as the studio's gate does.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_PRESENTATION } from '@formancy/data-core'
import { POSTGRES_IMAGE, startPostgresFixture } from '@formancy/data-fixtures'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, DRIVER_FACTORIES } from '@formancy/data-server'
import postgres from 'postgres'

export const FORM = 'pg-order'
export const LINES = 'pg-order-line'
export const TOKENS = { admin: 'browser-gate-administrator', clerk: 'browser-gate-clerk' }

/** The keys a delete of an order acts through on the fixture, with their actions: its lines and deliveries, and the deliveries' parcels. */
const ORDER_CASCADES = [
  { table: { schema: 'sales', name: 'order_line' }, foreignKey: 'fk_order_line_order', onDelete: 'cascade' },
  { table: { schema: 'sales', name: 'delivery' }, foreignKey: 'fk_delivery_order', onDelete: 'cascade' },
  { table: { schema: 'sales', name: 'parcel' }, foreignKey: 'fk_parcel_delivery', onDelete: 'cascade' },
]

/** A clerk of tenant 1 may do everything the form offers, on the fields it writes. */
function clerkPolicy(bindings, extra = {}) {
  return {
    version: 1,
    operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
    fields: Object.fromEntries(bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }])),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
    ...extra,
  }
}

export async function startPlane() {
  const fixture = await startPostgresFixture(POSTGRES_IMAGE)
  const url = new URL(fixture.admin)
  const real = createConnectionRegistry(
    [{ id: 'pg', kind: 'postgres', host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: 'env:PG_PASSWORD', schemas: ['sales'], tls: { enabled: false } }],
    DRIVER_FACTORIES,
    { env: { PG_PASSWORD: decodeURIComponent(url.password) }, readFile: async () => '' },
  )
  // The next connection asked for fails as a refused socket does, once:
  // the server says so as 503 in its own words, which the gate measures.
  let refusing = 0
  const registry = {
    ...real,
    open: async (id) => {
      if (refusing > 0) {
        refusing -= 1
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
      }
      return real.open(id)
    },
  }
  const root = mkdtempSync(join(tmpdir(), 'formancy-data-host-gate-'))
  const store = createFileConfigurationStore(root)
  const verifyIdentity = async (token) => {
    if (token === TOKENS.admin) return { ok: true, identity: { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } } }
    if (token === TOKENS.clerk) return { ok: true, identity: { actor: { id: 'clerk-1', roles: ['clerk'] }, attributes: { tenant: '1' } } }
    return { ok: false, reason: 'ERR_JWS_INVALID' }
  }
  // The administrator's trail is the server's suites' subject; here it is required and discarded.
  const server = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } }, runtime: { registry, store } })
  const call = async (token, path, payload) => {
    const reply = await server.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${token}` }, payload })
    if (reply.statusCode >= 300) throw new Error(`${path} answered ${String(reply.statusCode)}: ${reply.body}`)
    return reply.json()
  }
  const publish = async ({ formId, title, table, lookups, policy }) => {
    const proposal = await call(TOKENS.admin, '/v1/form-proposals', { connection: 'pg', root: { schema: 'sales', name: table }, formId, title, lookups, versionColumn: 'row_version' })
    // Published as the generator made it (0030 refuses anything but
    // presentation over the generated base), which draws a lookup as a
    // typeahead where it can be searched (0066).
    const form = proposal.form
    await call(TOKENS.admin, `/v1/forms/${formId}/versions`, { expectedBase: null, bundle: { format: 2, connection: 'pg', generation: proposal.generation, base: form, presentation: EMPTY_PRESENTATION, form, bindings: proposal.bindings, policy: policy(proposal.bindings), snapshot: proposal.snapshot } })
    return form
  }
  const form = await publish({
    formId: FORM,
    title: 'Order',
    table: 'order',
    lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
    policy: (bindings) => clerkPolicy(bindings, { operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'], delete: ['clerk'] }, cascades: ORDER_CASCADES }),
  })
  // No tenant column of its own: its rows are its tenant's orders' lines, through the order lookup's filter (0043).
  await publish({
    formId: LINES,
    title: 'Order line',
    table: 'order_line',
    lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
    policy: (bindings) => clerkPolicy(bindings, { rowFilters: [], lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] }, through: ['order'] }),
  })
  const source = form.model.fields.find((field) => field.key === 'customer').optionsSource
  const sql = postgres(fixture.admin, { onnotice: () => {} })
  return {
    server,
    /** A fresh order of tenant 1's with `lines` lines, for one width's run, made the way the page would make it; `notes` finds it. */
    order: async (lines = 0, notes = null) => {
      const customer = (await call(TOKENS.clerk, `/v1/forms/${FORM}/lookups/${source}/query`, { operation: 'create', search: 'Muster' })).rows[0].token
      const record = (await call(TOKENS.clerk, `/v1/forms/${FORM}/records/create`, { answers: { customer, order_date: '2026-10-08', status: 'placed', amount: '1', notes } })).record
      for (let no = 1; no <= lines; no += 1) await call(TOKENS.clerk, `/v1/forms/${LINES}/records/create`, { answers: { order: record, line_no: String(no), quantity: String(no), unit_price: '2.50' } })
      return record
    },
    insertCustomer: (no, name) => sql`insert into sales.customer (tenant_id, customer_no, name) values (1, ${no}, ${name})`,
    /** How many orders have exactly these notes: what the database holds, asked beside the page. */
    ordersWithNotes: async (notes) => (await sql`select count(*)::int as n from sales."order" where notes = ${notes}`)[0].n,
    deleteCustomer: (no) => sql`delete from sales.customer where tenant_id = 1 and customer_no = ${no}`,
    /** An order's group written beside the page, as the database's owner; `null` puts it back. */
    setGroup: (record, group) => sql`update sales."order" set "group" = ${group} where id = ${record.slice('k1:'.length)}`,
    /** An order changed beside the page, through the server as tenant 1's clerk: its version moves on. */
    change: async (record, notes) => {
      const { version } = await call(TOKENS.clerk, `/v1/forms/${FORM}/records/read`, { record })
      await call(TOKENS.clerk, `/v1/forms/${FORM}/records/update`, { record, version, answers: { notes } })
    },
    /** An order deleted beside the page, through the server as tenant 1's clerk. */
    remove: async (record) => {
      const { version } = await call(TOKENS.clerk, `/v1/forms/${FORM}/records/read`, { record })
      await call(TOKENS.clerk, `/v1/forms/${FORM}/records/delete`, { record, version })
    },
    /** Whether an order is there, asked of the database's owner. */
    stored: async (record) => (await sql`select count(*)::int as n from sales."order" where id = ${record.slice('k1:'.length)}`)[0].n === 1,
    /** The next request's database out of reach. */
    refuseNext: () => {
      refusing = 1
    },
    close: async () => {
      await server.close()
      await real.close()
      await sql.end()
      rmSync(root, { recursive: true, force: true })
      await fixture.stop()
    },
  }
}
