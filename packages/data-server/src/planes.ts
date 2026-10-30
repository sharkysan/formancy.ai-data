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
  /** `FORMANCY_DATA_PUBLISHER_ROLES`, parsed: the roles that approve a draft (0065); absent, no review. */
  publisherRoles?: readonly string[] | undefined
  /** `FORMANCY_DATA_BROWSE_ROLES`, parsed: the roles that may read a connection's rows (0099); absent, nobody. */
  browseRoles?: readonly string[] | undefined
  /** Names records in the trail by a keyed hash; without it, no record is named (0023). */
  auditKey: string | undefined
  /** `FORMANCY_DATA_CORS_ORIGINS`, parsed: the origins the runtime plane answers (0060); the administrator's answers none. */
  origins: readonly string[]
  /** `FORMANCY_DATA_LOOKUP_DEADLINE_MS`, parsed: how long a lookup statement may run (0061). */
  lookupDeadlineMs: number
  /** The server's log, looked up when an event fires: the server does not exist yet while its options are built. */
  log: () => FastifyBaseLogger
}

/**
 * The planes `main.ts` serves: the runtime, and the administrator's when roles
 * administer it -- under review when publisher roles are set (0065), and
 * browsable by the browse roles when they are set (0099). One sink
 * for both -- the server's own log, one line per event, which a collector
 * tells apart by `audit.plane` (0033). The administrator's plane takes no
 * audit key, because it names no record.
 *
 * Out of `main.ts`, which reads the environment and exits on a missing
 * setting, so that `server-log.test.ts` can hold this wiring to what the
 * documents say it is.
 */
export function servedPlanes(found: ServedConfiguration): Pick<DataServerOptions, 'admin' | 'runtime'> {
  const { registry, store, adminRoles, publisherRoles, browseRoles, auditKey, origins, lookupDeadlineMs } = found
  const sink: AuditSink = (event) => logAuditSink(found.log())(event)
  return {
    runtime: { registry, store, origins, lookupDeadlineMs, audit: { sink, ...(auditKey === undefined ? {} : { key: auditKey }) } },
    ...(adminRoles.length === 0
      ? {}
      : {
          admin: {
            registry,
            store,
            adminRoles,
            ...(publisherRoles === undefined ? {} : { publisherRoles }),
            ...(browseRoles === undefined ? {} : { browseRoles }),
            audit: { sink },
          },
        }),
  }
}
