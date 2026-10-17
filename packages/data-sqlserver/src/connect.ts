import mssql from 'mssql'
import type { ConnectionPool } from 'mssql'
import { ENTRA_UNENCRYPTED, entraCredential, entraLoginFailure } from './entra.js'
import type { EntraLogin } from './entra.js'

/** Where the server is, and TLS. The composition root decides TLS; there is no default here to forget. */
interface SqlServerAddress {
  host: string
  port: number
  database: string
  encrypt: boolean
  trustServerCertificate: boolean
}

/** A SQL login: a user and its password. */
interface SqlLogin {
  user: string
  password: string
  entra?: never
}

/** An Entra principal, which no test of this release logs in as (0074). */
interface EntraPrincipal {
  entra: EntraLogin
  user?: never
  password?: never
}

export type SqlServerConnectOptions = SqlServerAddress & (SqlLogin | EntraPrincipal)

/** A way into SQL Server this adapter opens a pool with, and whether a test of this release logs in that way. */
export interface SqlServerLogin {
  login: 'sql' | `entra-${EntraLogin['type']}`
  name: string
  tested: boolean
}

/**
 * Every login `connectSqlServer` takes, in the order a reader meets them.
 * Every suite logs in with a SQL login; nothing logs in as an Entra
 * principal, since no container takes one and no test asks Entra (0074).
 * The README's tested-on table says this list, derived
 * (scripts/release-report/tested-on.mjs), and the allowlist's login types
 * are held to it (packages/data-server/src/connections.test.ts).
 */
export const SQLSERVER_LOGINS: readonly SqlServerLogin[] = [
  { login: 'sql', name: 'SQL login', tested: true },
  { login: 'entra-managed-identity', name: 'Entra managed identity', tested: false },
  { login: 'entra-service-principal', name: 'Entra service principal', tested: false },
]

/**
 * What mssql is given for a pool. A SQL login is a user and a password; an
 * Entra principal is one credential, built here once for the pool, which
 * mssql hands every connection the pool opens, and no user or password at
 * all, so nothing can log in as a SQL login in its place. Neither ever sets
 * mssql's `debug` or tedious's `options.debug`: tedious's debug output
 * prints a login's password (login7-payload.js).
 */
export function sqlServerConfig(options: SqlServerConnectOptions): mssql.config {
  const base = {
    server: options.host,
    port: options.port,
    database: options.database,
    options: { encrypt: options.encrypt, trustServerCertificate: options.trustServerCertificate },
  }
  if (options.entra === undefined) return { ...base, user: options.user, password: options.password }
  return { ...base, authentication: { type: 'token-credential', options: { credential: entraCredential(options.entra) } } }
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
 *
 * An Entra principal is refused without TLS, before anything is opened, and
 * a failed Entra login rejects with a sentence that names no tenant, client
 * or secret (entra.ts). A login that fails later, when the pool opens
 * another connection, reaches whoever asked for the connection as mssql
 * rejects it: the records' adapter answers it `unavailable`.
 */
export async function connectSqlServer(options: SqlServerConnectOptions): Promise<ConnectionPool> {
  if (options.entra === undefined) return new mssql.ConnectionPool(sqlServerConfig(options)).connect()
  if (!options.encrypt) throw new Error(ENTRA_UNENCRYPTED)
  try {
    return await new mssql.ConnectionPool(sqlServerConfig(options)).connect()
  } catch (error) {
    throw entraLoginFailure(error)
  }
}
