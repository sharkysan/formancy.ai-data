/*
 * A consumer that knows nothing about the workspace.
 *
 * Copied into a temporary npm project by install-test.mjs, installed from the
 * packed tarballs, type-checked with skipLibCheck OFF and run under Node. What
 * is on trial is that the published entry points resolve, with the types that
 * shipped. Connecting to a database is the integration suites' business.
 */
import { createDataClient, fieldProblems, lookupSources, sourceNames } from '@formancy/data-client'
import type { Outcome, PublishedForm, Refusal } from '@formancy/data-client'
import { DATABASE_KINDS, isDatabaseKind } from '@formancy/data-core'
import type { DatabaseAdapter, DatabaseKind } from '@formancy/data-core'
import { connectPostgres, createPostgresAdapter } from '@formancy/data-postgres'
import { DRIVER_FACTORIES } from '@formancy/data-server'
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

console.log(`ok: ${DATABASE_KINDS.join(', ')}; data-client`)
