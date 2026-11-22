// The host gate's plane: the real server over the shared fixture on a real
// PostgreSQL 17 through the real driver (0029), with the order form and the
// order line form published as the suites publish them (src/test-plane.ts,
// with `deletes`): as the generator made them, clerks of tenant 1 allowed
// everything they offer -- delete of an order included, its policy naming
// every key a delete of an order acts through (0051, 0053) -- and an order's
// lines reached through their order (0043), whose typed key offers no
// delete on PostgreSQL (0050). The identity verifier takes literal tokens,
// as the studio's gate does: the administrator's, and a clerk's of tenant 1
// and of tenant 3, whose customers are the paged ones, one lookup page and
// ten more, inserted beside the fixture's (0085). And the customer form,
// read only, which Drill down goes down from: a customer, its orders, their
// lines (0090). The order form is published with two list views and no
// default (0105), so its grid opens on every record, as every state before
// the views' found it, and offers the View picker in all of them. And over
// the parity schema an order and its lines saved with it, one to three of
// them (0155), as src/test-saves.ts publishes them: a clerk adds and
// changes lines, and the order's own Save sends them. And over the actions
// schema every fixture loads, an order with close_order bound as its
// action `close`, worded by its presentation, as src/test-actions.ts
// publishes it (0162), and again as `close-all`, over the records a person
// chooses of the page (0166): a clerk reads the order and runs both, and
// deletes the orders chosen together (0174), which nothing refers to.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPresentation, EMPTY_PRESENTATION } from '@formancy/data-core'
import { insertPaged, POSTGRES_IMAGE, startPostgresFixture } from '@formancy/data-fixtures'
import { createConnectionRegistry, createDataServer, createFileConfigurationStore, DRIVER_FACTORIES } from '@formancy/data-server'
import postgres from 'postgres'

export const FORM = 'pg-order'
export const LINES = 'pg-order-line'
export const CUSTOMERS = 'pg-customer'
export const SAVED_ORDER = 'pg-saved-order'
export const SAVED_LINES = 'pg-saved-line'
export const ACTION_ORDER = 'pg-action-order'
/** What close's presentation says, as src/test-actions.ts's CLOSE_WORDS. */
export const CLOSE_WORDS = { label: 'Close the order', confirm: 'It closes the order, and the database keeps the note with it.', done: 'The order is closed.' }
/** What close-all's presentation says, as src/test-actions.ts's CLOSE_ALL_LABEL (0166). */
export const CLOSE_ALL_LABEL = 'Close the chosen orders'
export const TOKENS = { admin: 'browser-gate-administrator', clerk: 'browser-gate-clerk', thirdClerk: 'browser-gate-clerk-tenant-3' }

/**
 * The order form's list views (0105): neither the default, so the grid
 * opens on every record. They differ in their filter and their sort, and
 * the second sorts by two columns, so picking one changes both at once and
 * the headers show two sorted columns.
 */
export const ORDER_VIEWS = [
  { name: 'Placed, newest first', filter: [{ field: 'status', op: 'equals', value: 'placed' }], sort: [{ field: 'id', direction: 'desc' }] },
  {
    name: 'Noted, largest first',
    filter: [{ field: 'notes', op: 'not-null' }],
    sort: [
      { field: 'amount', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ],
  },
]

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
    fields: Object.fromEntries(
      bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: binding.writes.create || binding.writes.update ? ['clerk'] : [] }]),
    ),
    rowFilters: [{ column: 'tenant_id', attribute: 'tenant' }],
    lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
    ...extra,
  }
}

/** close_order over the open record, with a source for every parameter: the note asked in its dialog. */
const CLOSE = {
  name: 'close',
  routine: {
    schema: 'actions',
    name: 'close_order',
    signature: 'pg_catalog.int8, pg_catalog.text, pg_catalog.text, pg_catalog."numeric", pg_catalog.int4',
  },
  scope: 'record',
  parameters: [
    { parameter: 'p_order', from: { key: 'id' } },
    { parameter: 'p_note', from: { input: 'note' } },
    { parameter: 'p_actor', from: { actor: 'id' } },
    { parameter: 'p_amount', from: { field: 'amount' } },
    { parameter: 'p_tenant', from: { attribute: 'tenant' } },
  ],
}

/**
 * The action order (0162): close_order bound as `close`, with a source for
 * every parameter -- the note asked in its dialog -- and worded by its
 * presentation, which the server checks as it checks the suites'; and
 * bound again as `close-all`, over the records a person chooses of the
 * page (0166), so the grid has its boxes and the bar above it; a clerk of
 * tenant 1 reads the order and runs both, through its customer (0043), and
 * may delete the orders chosen together (0173, 0174) and change their note
 * together (0175, 0176).
 */
async function publishActionOrder(call) {
  const proposal = await call(TOKENS.admin, '/v1/form-proposals', {
    connection: 'pg-actions',
    root: { schema: 'actions', name: 'order' },
    formId: ACTION_ORDER,
    title: 'Order',
    lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
    versionColumn: 'version',
    actions: [CLOSE, { ...CLOSE, name: 'close-all', scope: 'selection' }],
  })
  const presentation = {
    ...EMPTY_PRESENTATION,
    actions: [
      { action: 'close', ...CLOSE_WORDS },
      { action: 'close-all', label: CLOSE_ALL_LABEL },
    ],
  }
  const presented = applyPresentation(proposal.form, presentation, proposal.bindings)
  if (!presented.ok) throw new Error(`close's words do not apply: ${presented.problems.join('; ')}`)
  await call(TOKENS.admin, `/v1/forms/${ACTION_ORDER}/versions`, {
    expectedBase: null,
    bundle: {
      format: 2,
      connection: 'pg-actions',
      generation: proposal.generation,
      base: proposal.form,
      presentation,
      form: presented.form,
      bindings: proposal.bindings,
      policy: {
        version: 1,
        operations: { read: ['clerk'], create: [], update: ['clerk'], delete: ['clerk'] },
        fields: Object.fromEntries(
          proposal.bindings.fields.map((binding) => [
            binding.field,
            { read: ['clerk'], write: ['note', 'amount'].includes(binding.field) && binding.writes.update ? ['clerk'] : [] },
          ]),
        ),
        rowFilters: [],
        lookups: { customer: [{ column: 'tenant_id', attribute: 'tenant' }] },
        through: ['customer'],
        actions: { close: { roles: ['clerk'] }, 'close-all': { roles: ['clerk'] } },
        bulk: { delete: { roles: ['clerk'] }, update: { roles: ['clerk'], fields: ['note'] } },
      },
      snapshot: proposal.snapshot,
    },
  })
}

export async function startPlane() {
  const fixture = await startPostgresFixture(POSTGRES_IMAGE)
  await insertPaged({ kind: 'postgres', admin: fixture.admin })
  const url = new URL(fixture.admin)
  const real = createConnectionRegistry(
    [
      {
        id: 'pg',
        kind: 'postgres',
        host: url.hostname,
        port: Number(url.port),
        database: url.pathname.slice(1),
        user: decodeURIComponent(url.username),
        password: 'env:PG_PASSWORD',
        schemas: ['sales'],
        tls: { enabled: false },
      },
      {
        id: 'pg-parity',
        kind: 'postgres',
        host: url.hostname,
        port: Number(url.port),
        database: url.pathname.slice(1),
        user: decodeURIComponent(url.username),
        password: 'env:PG_PASSWORD',
        schemas: ['parity'],
        tls: { enabled: false },
      },
      {
        id: 'pg-actions',
        kind: 'postgres',
        host: url.hostname,
        port: Number(url.port),
        database: url.pathname.slice(1),
        user: decodeURIComponent(url.username),
        password: 'env:PG_PASSWORD',
        schemas: ['actions'],
        tls: { enabled: false },
      },
    ],
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
    if (token === TOKENS.thirdClerk) return { ok: true, identity: { actor: { id: 'clerk-3', roles: ['clerk'] }, attributes: { tenant: '3' } } }
    return { ok: false, reason: 'ERR_JWS_INVALID' }
  }
  // The administrator's trail is the server's suites' subject; here it is required and discarded.
  const server = await createDataServer({
    verifyIdentity,
    admin: { registry, store, adminRoles: ['data-admin'], audit: { sink: () => {} } },
    runtime: { registry, store },
  })
  const call = async (token, path, payload) => {
    const reply = await server.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${token}` }, payload })
    if (reply.statusCode >= 300) throw new Error(`${path} answered ${String(reply.statusCode)}: ${reply.body}`)
    return reply.json()
  }
  const publish = async ({ formId, title, table, lookups, policy, versionColumn = 'row_version', views, connection = 'pg', schema = 'sales', pinned }) => {
    const proposal = await call(TOKENS.admin, '/v1/form-proposals', {
      connection,
      root: { schema, name: table },
      formId,
      title,
      lookups,
      ...(versionColumn === null ? {} : { versionColumn }),
      ...(pinned === undefined ? {} : { pinned }),
    })
    // Published as the generator made it (0030 refuses anything but
    // presentation over the generated base), which draws a lookup as a
    // typeahead where it can be searched (0066); views alone leave the form
    // its base.
    const form = proposal.form
    const presentation = views === undefined ? EMPTY_PRESENTATION : { ...EMPTY_PRESENTATION, views }
    await call(TOKENS.admin, `/v1/forms/${formId}/versions`, {
      expectedBase: null,
      bundle: {
        format: 2,
        connection,
        generation: proposal.generation,
        base: form,
        presentation,
        form,
        bindings: proposal.bindings,
        policy: policy(proposal.bindings),
        snapshot: proposal.snapshot,
      },
    })
    return form
  }
  const form = await publish({
    formId: FORM,
    title: 'Order',
    table: 'order',
    lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
    policy: (bindings) =>
      clerkPolicy(bindings, { operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'], delete: ['clerk'] }, cascades: ORDER_CASCADES }),
    views: ORDER_VIEWS,
  })
  // No tenant column of its own: its rows are its tenant's orders' lines, through the order lookup's filter (0043).
  await publish({
    formId: LINES,
    title: 'Order line',
    table: 'order_line',
    lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
    policy: (bindings) => clerkPolicy(bindings, { rowFilters: [], lookups: { order: [{ column: 'tenant_id', attribute: 'tenant' }] }, through: ['order'] }),
  })
  // A customer has no version column, so it is read only: Drill down only reads it.
  await publish({
    formId: CUSTOMERS,
    title: 'Customer',
    table: 'customer',
    lookups: [],
    versionColumn: null,
    policy: (bindings) =>
      clerkPolicy(bindings, {
        operations: { read: ['clerk'], create: [], update: [] },
        fields: Object.fromEntries(bindings.fields.map((binding) => [binding.field, { read: ['clerk'], write: [] }])),
        lookups: {},
      }),
  })
  // An order of the parity schema and its lines saved with it, one to three: read through their order, and never deleted here.
  await publish({
    formId: SAVED_ORDER,
    title: 'Order',
    table: 'saved_order',
    lookups: [],
    versionColumn: 'version',
    connection: 'pg-parity',
    schema: 'parity',
    pinned: ['tenant_id'],
    policy: (bindings) => clerkPolicy(bindings, { lookups: {} }),
  })
  await publish({
    formId: SAVED_LINES,
    title: 'Order line',
    table: 'saved_line',
    lookups: [{ foreignKey: 'fk_saved_line_order', display: ['note'], together: { min: 1, max: 3 } }],
    versionColumn: 'version',
    connection: 'pg-parity',
    schema: 'parity',
    policy: (bindings) =>
      clerkPolicy(bindings, { rowFilters: [], lookups: { saved_order: [{ column: 'tenant_id', attribute: 'tenant' }] }, through: ['saved_order'] }),
  })
  await publishActionOrder(call)
  const source = form.model.fields.find((field) => field.key === 'customer').optionsSource
  const sql = postgres(fixture.admin, { onnotice: () => {} })
  return {
    server,
    /** A fresh order of tenant 1's with `lines` lines, for one width's run, made the way the page would make it; `notes` finds it, and `customer` is searched for its customer. */
    order: async (lines = 0, notes = null, customer = 'Muster') => {
      const buyer = (await call(TOKENS.clerk, `/v1/forms/${FORM}/lookups/${source}/query`, { operation: 'create', search: customer })).rows[0].token
      const record = (
        await call(TOKENS.clerk, `/v1/forms/${FORM}/records/create`, {
          answers: { customer: buyer, order_date: '2026-10-08', status: 'placed', amount: '1', notes },
        })
      ).record
      for (let no = 1; no <= lines; no += 1)
        await call(TOKENS.clerk, `/v1/forms/${LINES}/records/create`, {
          answers: { order: record, line_no: String(no), quantity: String(no), unit_price: '2.50' },
        })
      return record
    },
    insertCustomer: (no, name) => sql`insert into sales.customer (tenant_id, customer_no, name) values (1, ${no}, ${name})`,
    /** A parity order of tenant 1's noted `note`, with `lines` lines numbered from 1, written by the owner: its token. */
    savedOrder: async (note, lines) => {
      const [{ id }] = await sql`insert into parity.saved_order (tenant_id, note) values (1, ${note}) returning id`
      for (let no = 1; no <= lines; no += 1) await sql`insert into parity.saved_line (order_id, line_no, quantity) values (${id}, ${no}, ${no})`
      return `k1:${String(id)}`
    },
    /** How many parity orders are noted exactly `note`, and how many lines they hold, asked of the owner. */
    savedWithNote: async (note) =>
      (
        await sql`select count(distinct o.id)::int as orders, count(l.id)::int as lines from parity.saved_order as o left join parity.saved_line as l on l.order_id = o.id where o.note = ${note}`
      )[0],
    /** An open order of tenant 1's in the actions schema, for a customer of its own, as the owner inserts it, noted `note` where given: its token. */
    actionOrder: async (note = null) => {
      const [{ id: customer }] = await sql`insert into actions.customer (tenant_id, name) values (1, 'Gate customer') returning id`
      const [{ id }] = await sql`insert into actions."order" (customer_id, amount, note) values (${customer}, 12.50, ${note}) returning id`
      return `k1:${String(id)}`
    },
    /** An action order's status and note, as the owner reads them; undefined once it is deleted. */
    actionOrderOf: async (record) => (await sql`select status, note from actions."order" where id = ${record.slice('k1:'.length)}`)[0],
    /** An action order changed beside the page, as the owner writes it: its version moves on. */
    touchActionOrder: (record) => sql`update actions."order" set version = version + 1 where id = ${record.slice('k1:'.length)}`,
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
    /**
     * Each step named to `step` before it runs, for the gate to say which
     * one a late error came in. Called by the page's origin once the server
     * has answered every request it was handed (scripts/gate-origin.mjs):
     * the server's close waits for no injected request, and the registry
     * opens a connection again for one that asks after it has closed, a
     * pool nothing ends, which the database's stop then resets.
     */
    close: async (step = () => {}) => {
      step('closing the server')
      await server.close()
      step('closing the connection registry')
      await real.close()
      step("ending the plane's own database client")
      await sql.end()
      rmSync(root, { recursive: true, force: true })
      step('stopping the database')
      await fixture.stop()
    },
  }
}
