import type { FastifyBaseLogger } from 'fastify'
import type { DataServerOptions } from './app.js'
import { logAuditSink } from './audit.js'
import type { AuditSink } from './audit.js'
import type { ConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'

/** What the runnable server found in its configuration, once it has a store and an allowlist. */
export interface ServedConfiguration {
  registry: ConnectionRegistry
  store: ConfigurationStore
  /** Roles that administer; none, and the administrator's plane is off. */
  adminRoles: readonly string[]
  /** Names records in the trail by a keyed hash; without it, no record is named (0023). */
  auditKey: string | undefined
  /** The server's log, looked up when an event fires: the server does not exist yet while its options are built. */
  log: () => FastifyBaseLogger
}

/**
 * The planes `main.ts` serves: the runtime, and the administrator's when roles
 * administer it. One sink for both -- the server's own log, one line per
 * event, which a collector tells apart by `audit.plane` (0033). The
 * administrator's plane takes no audit key, because it names no record.
 *
 * Out of `main.ts`, which reads the environment and exits on a missing
 * setting, so that `server-log.test.ts` can hold this wiring to what the
 * documents say it is.
 */
export function servedPlanes(found: ServedConfiguration): Pick<DataServerOptions, 'admin' | 'runtime'> {
  const { registry, store, adminRoles, auditKey } = found
  const sink: AuditSink = (event) => logAuditSink(found.log())(event)
  return {
    runtime: { registry, store, audit: { sink, ...(auditKey === undefined ? {} : { key: auditKey }) } },
    ...(adminRoles.length === 0 ? {} : { admin: { registry, store, adminRoles, audit: { sink } } }),
  }
}
