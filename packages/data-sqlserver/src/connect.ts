import mssql from 'mssql'
import type { ConnectionPool } from 'mssql'

export interface SqlServerConnectOptions {
  host: string
  port: number
  database: string
  user: string
  password: string
  /** TLS. The composition root decides; there is no default here to forget. */
  encrypt: boolean
  trustServerCertificate: boolean
}

/**
 * A connected pool, from this package's own copy of mssql.
 *
 * Why the adapter package opens its own connections: mssql's parameter types
 * are objects tedious checks by identity, and this package binds every value
 * with `mssql.NVarChar` and friends from ITS copy. A pool built from another
 * copy — two installs of mssql@12.7.4 that differ only in which supports-color
 * satisfied an optional peer, which is exactly what pnpm produced for the
 * server — refuses every parameter with "type.validate is not a function".
 * Found by the end-to-end suite; no unit test could see it. Opening the pool
 * here means the pool and the types always come from one copy.
 */
export function connectSqlServer(options: SqlServerConnectOptions): Promise<ConnectionPool> {
  return new mssql.ConnectionPool({
    server: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password: options.password,
    options: { encrypt: options.encrypt, trustServerCertificate: options.trustServerCertificate },
  }).connect()
}
