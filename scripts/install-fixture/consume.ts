/*
 * A consumer that knows nothing about the workspace.
 *
 * Copied into a temporary npm project by install-test.mjs, installed from the
 * packed tarballs, type-checked with skipLibCheck OFF and run under Node. What
 * is on trial is that the published entry points resolve, with the types that
 * shipped. Connecting to a database is the integration suites' business.
 */
import { createDataClient, fieldProblems, LIST_PAGE_SIZE, lookupSources, sourceNames } from '@formancy/data-client'
import type { DeleteOutcome, FormMenu, Outcome, PublishedForm, RecordList, Refusal } from '@formancy/data-client'
import { DATABASE_KINDS, isDatabaseKind, reachesPast } from '@formancy/data-core'
import type { CascadeRule, DatabaseAdapter, DatabaseKind, FormPolicy } from '@formancy/data-core'
import { connectPostgres, createPostgresAdapter } from '@formancy/data-postgres'
import { DRIVER_FACTORIES } from '@formancy/data-server'
import type { AdminAuditEvent, AuditEvent, AuditSink, RuntimeAuditEvent } from '@formancy/data-server'
import { connectSqlServer, createSqlServerAdapter } from '@formancy/data-sqlserver'
import type { FormSchema } from '@formancy/spec'

// Each factory's parameter is the driver's own type, which has to resolve from
// the consumer's node_modules for this file to type-check at all -- the case a
// devDependency on a types package would get wrong.
const factories: Record<DatabaseKind, (driver: never) => DatabaseAdapter> = {
  postgres: createPostgresAdapter,
  sqlserver: createSqlServerAdapter,
}

// Each adapter opens its own connections from its own copy of the driver, and
// the server opens every connection through them (0025). A tarball whose
// server cannot resolve an adapter, or an adapter that stopped exporting its
// connect function, fails here rather than at a host's first request.
const connects = { postgres: connectPostgres, sqlserver: connectSqlServer }

for (const kind of DATABASE_KINDS) {
  if (!isDatabaseKind(kind)) throw new Error(`${kind} is not a database kind`)
  if (typeof factories[kind] !== 'function') throw new Error(`no adapter factory for ${kind}`)
  if (typeof connects[kind] !== 'function') throw new Error(`no connect function for ${kind}`)
  if (typeof DRIVER_FACTORIES[kind] !== 'function') throw new Error(`the server has no driver for ${kind}`)
}

// The client's declarations name only what Node's own types declare too --
// `fetch`, `AbortSignal` -- and FormSchema, which resolves from the client's
// dependency on @formancy/spec. A declaration that named a DOM-only type, or a
// spec the consumer does not have, fails the type check above this line.
const refusal: Refusal = {
  ok: false,
  status: 422,
  code: 'invalid-values',
  message: 'A selection is not one of the options.',
  fieldErrors: [{ field: 'customer', code: 'not-an-option', message: 'This is not one of the options this form offers.' }],
}
const outcome: Outcome<PublishedForm> = refusal
if (outcome.ok || fieldProblems(outcome)['customer']?.[0] !== 'This is not one of the options this form offers.') {
  throw new Error('fieldProblems did not give the server sentence for customer')
}

// The audit trail is one union of two planes (0033), and a sink reads a
// plane's own fields only after narrowing on `plane`. A package that stopped
// exporting either plane's event, or a union that no longer narrowed, fails
// the type check above this line; one whose events lost `plane` fails here.
const heard: string[] = []
const sink: AuditSink = (event: AuditEvent) => {
  if (event.plane === 'runtime') {
    const runtime: RuntimeAuditEvent = event
    heard.push(`runtime ${runtime.record ?? 'no record'}`)
  } else {
    const admin: AdminAuditEvent = event
    heard.push(`admin ${admin.connection ?? 'no connection'}`)
  }
}
await sink({ at: 't', plane: 'runtime', actor: null, operation: 'read', form: 'order', formVersion: null, status: 401, outcome: 'unauthenticated', record: null })
await sink({ at: 't', plane: 'admin', actor: 'a', operation: 'publish', connection: 'erp', form: 'order', formVersion: 1, expectedBase: null, restoredFrom: null, draft: null, status: 201, outcome: 'ok' })
if (heard.join() !== 'runtime no record,admin erp') throw new Error('an audit sink did not tell the planes apart')

const form: FormSchema = { specVersion: '3', id: 'order', title: 'Order', model: { fields: [{ key: 'customer', type: 'select', optionsSource: 'order.customer' }] } }
if (sourceNames(form).join() !== 'order.customer') throw new Error('sourceNames did not name order.customer')

// A name that cannot be one path segment is refused before a request, so the
// stub is never called: the published code carries the guard, not only the source.
let fetched = 0
const client = createDataClient({
  token: () => 'unused',
  base: 'http://127.0.0.1:9',
  fetch: async () => {
    fetched += 1
    throw new Error('fetch must not be called')
  },
})
const dotted = await client.form('..')
if (dotted.ok || dotted.code !== 'invalid-name' || fetched !== 0) throw new Error('form("..") was not refused before a request')
if (Object.keys(lookupSources(client, 'order', form, 'create')).join() !== 'order.customer') throw new Error('lookupSources did not name order.customer')

// A page of records (0044): the client's list, its answer's type and the page
// bound it re-exports, through the published entry points -- a value the
// client re-exports from the core, which a type-only re-export would lose.
const page: Outcome<RecordList> = await client.list('..', { limit: LIST_PAGE_SIZE })
if (page.ok || page.code !== 'invalid-name' || fetched !== 0 || !Number.isSafeInteger(LIST_PAGE_SIZE)) throw new Error('list("..") was not refused before a request')

// The menu (0045): the client's forms() and its answer's type through the
// published entry points, read from a stub that answers as the server does --
// a reply checked by a guard the published code carries, not only the source.
const menuClient = createDataClient({
  token: () => 'unused',
  base: 'http://127.0.0.1:9',
  fetch: async () => new Response(JSON.stringify({ forms: [{ id: 'order', title: 'Order', operations: ['read'], children: [{ form: 'order-line', field: 'order' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
})
const menu: Outcome<FormMenu> = await menuClient.forms()
if (!menu.ok || menu.value.forms[0]?.children[0]?.field !== 'order') throw new Error('forms() did not read the menu')

// A deletion (0050): the client's delete() and its outcome's type through the
// published entry points, read from a stub that answers as the server does --
// a reply held to the deletion's shape by a guard the published code carries.
const deleteClient = createDataClient({
  token: () => 'unused',
  base: 'http://127.0.0.1:9',
  fetch: async () => new Response(JSON.stringify({ record: 'k1:7', deleted: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
})
const deleted: DeleteOutcome = await deleteClient.delete('order', { record: 'k1:7', version: '1' })
if (!deleted.ok || deleted.value.record !== 'k1:7' || deleted.value.deleted !== true) throw new Error('delete() did not read the deletion')

// What a delete may act through (0051): a policy that names a key with its
// action, typed by what the published core declares, and the core's own
// reading of a reach that goes past its root.
const lines: CascadeRule = { table: { schema: 'sales', name: 'order_line' }, foreignKey: 'fk_order_line_order', onDelete: 'cascade' }
const cascading: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [], delete: ['clerk'] }, fields: {}, rowFilters: [], lookups: {}, cascades: [lines] }
if (!reachesPast({ removed: [{ schema: 'sales', name: 'order' }, lines.table], cleared: [] }) || cascading.cascades?.length !== 1) throw new Error('reachesPast() did not read a reach past its root')

console.log(`ok: ${DATABASE_KINDS.join(', ')}; data-client, lists, the menu, deletion and cascades included; audit events`)
