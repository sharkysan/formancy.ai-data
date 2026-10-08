/*
 * A consumer that knows nothing about the workspace.
 *
 * Copied into a temporary npm project by install-test.mjs, installed from the
 * packed tarballs, type-checked with skipLibCheck OFF and run under Node. What
 * is on trial is that the published entry points resolve, with the types that
 * shipped. Connecting to a database is the integration suites' business.
 */
import { DATABASE_KINDS, isDatabaseKind } from '@formancy/data-core'
import type { DatabaseAdapter, DatabaseKind } from '@formancy/data-core'
import { createPostgresAdapter } from '@formancy/data-postgres'
import { createSqlServerAdapter } from '@formancy/data-sqlserver'

// Each factory's parameter is the driver's own type, which has to resolve from
// the consumer's node_modules for this file to type-check at all -- the case a
// devDependency on a types package would get wrong.
const factories: Record<DatabaseKind, (driver: never) => DatabaseAdapter> = {
  postgres: createPostgresAdapter,
  sqlserver: createSqlServerAdapter,
}

for (const kind of DATABASE_KINDS) {
  if (!isDatabaseKind(kind)) throw new Error(`${kind} is not a database kind`)
  if (typeof factories[kind] !== 'function') throw new Error(`no adapter factory for ${kind}`)
}

console.log(`ok: ${DATABASE_KINDS.join(', ')}`)
