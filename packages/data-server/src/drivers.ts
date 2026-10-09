import type { DatabaseKind } from '@formancy/data-core'
import { connectPostgres, createPostgresAdapter, createPostgresLookups, createPostgresRecords } from '@formancy/data-postgres'
import { connectSqlServer, createSqlServerAdapter, createSqlServerLookups, createSqlServerRecords } from '@formancy/data-sqlserver'
import type { ConnectionConfig, ConnectionFactory } from './connections.js'

/** TLS unless the operator turned it off, and certificates checked unless the operator trusts the server's. */
function tls(config: ConnectionConfig): { enabled: boolean; trust: boolean } {
  return { enabled: config.tls?.enabled ?? true, trust: config.tls?.trustServerCertificate ?? false }
}

/**
 * PostgreSQL. Pinged before it is handed out, so an allowlisted connection that
 * cannot be reached fails here, where the registry retries it next time,
 * rather than on the first record a person saves.
 */
const openPostgres: ConnectionFactory = async (config, password) => {
  const { enabled, trust } = tls(config)
  const sql = connectPostgres({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    tls: { enabled, rejectUnauthorized: !trust },
  })
  const adapter = createPostgresAdapter(sql)
  try {
    await adapter.ping()
  } catch (error) {
    await sql.end({ timeout: 1 })
    throw error
  }
  return { adapter, lookups: createPostgresLookups(sql), records: createPostgresRecords(sql) }
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
