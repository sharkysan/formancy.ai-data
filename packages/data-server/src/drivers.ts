import type { DatabaseAdapter, DatabaseKind } from '@formancy/data-core'
import { connectPostgres, createPostgresAdapter, createPostgresLookups, createPostgresRecords } from '@formancy/data-postgres'
import { connectSqlServer, createSqlServerAdapter, createSqlServerLookups, createSqlServerRecords } from '@formancy/data-sqlserver'
import type { ConnectionConfig, ConnectionFactory } from './connections.js'

/** TLS unless the operator turned it off, and certificates checked unless the operator trusts the server's. */
function tls(config: ConnectionConfig): { enabled: boolean; trust: boolean } {
  return { enabled: config.tls?.enabled ?? true, trust: config.tls?.trustServerCertificate ?? false }
}

/** The application name the lookups' client gives PostgreSQL, so a DBA tells it from the records' in pg_stat_activity (0061). */
export const POSTGRES_LOOKUPS_APPLICATION = 'formancy-data lookups'

/**
 * PostgreSQL. Pinged before it is handed out, so an allowlisted connection that
 * cannot be reached fails here, where the registry retries it next time,
 * rather than on the first record a person saves.
 *
 * Two clients (0061). Lookups run on one of their own, because PostgreSQL
 * delivers a cancel on a connection of its own, and a cancel that arrives
 * after its statement finished stops whatever that backend runs next: in the
 * 2026-10-14 probe a lookup's late cancel stopped the statement pipelined
 * behind it on a shared pool of one. On their own client a late cancel can
 * stop only another lookup -- which the adapter runs once more -- and never a
 * record read or write, which 0015 never retries. The cost is up to twice the
 * connections per allowlisted database, each pool at the driver's default.
 * The ping runs on the records' client; a failure ends both. Closing the
 * adapter closes both, each as the adapter closes its own.
 */
const openPostgres: ConnectionFactory = async (config, password) => {
  const { enabled, trust } = tls(config)
  const options = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    tls: { enabled, rejectUnauthorized: !trust },
  }
  const sql = connectPostgres(options)
  const lookupSql = connectPostgres({ ...options, applicationName: POSTGRES_LOOKUPS_APPLICATION })
  const records = createPostgresAdapter(sql)
  const lookups = createPostgresAdapter(lookupSql)
  const adapter: DatabaseAdapter = {
    ...records,
    close: async () => {
      await Promise.all([records.close(), lookups.close()])
    },
  }
  try {
    await adapter.ping()
  } catch (error) {
    await Promise.all([sql.end({ timeout: 1 }), lookupSql.end({ timeout: 1 })])
    throw error
  }
  return { adapter, lookups: createPostgresLookups(lookupSql), records: createPostgresRecords(sql) }
}

/** SQL Server: no native module, no ODBC. */
const openSqlServer: ConnectionFactory = async (config, password) => {
  const { enabled, trust } = tls(config)
  const pool = await connectSqlServer({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    encrypt: enabled,
    trustServerCertificate: trust,
  })
  return { adapter: createSqlServerAdapter(pool), lookups: createSqlServerLookups(pool), records: createSqlServerRecords(pool) }
}

/**
 * The drivers, one factory per engine. Each adapter package opens its own
 * connections (`connectPostgres`, `connectSqlServer`), so a connection and the
 * code that binds values on it always come from one copy of the driver — the
 * server imports no driver at all, and the end-to-end suite is what found why
 * that matters.
 */
export const DRIVER_FACTORIES: Readonly<Record<DatabaseKind, ConnectionFactory>> = {
  postgres: openPostgres,
  sqlserver: openSqlServer,
}
