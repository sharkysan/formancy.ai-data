import type { TokenCredential } from '@azure/identity'
import mssql from 'mssql'
import type { ConnectionPool } from 'mssql'
import { encryptedConnector, encryptionRefusal } from './encryption.js'
import { ENTRA_UNCHECKED, ENTRA_UNENCRYPTED, entraCredential, entraLoginFailure } from './entra.js'
import type { EntraLogin } from './entra.js'

/**
 * Where the server is, and TLS. The composition root decides TLS; there is
 * no default here to forget. For a SQL login, `encrypt` true is TDS 7's TLS,
 * which a server that answers it will not encrypt is refused (0081), and
 * false sends the login unencrypted, as the operator chose. For an Entra
 * principal it can only say yes: `encrypt` must be true and
 * `trustServerCertificate` false, and the pool is TDS 8.0 (sqlServerConfig).
 */
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
 * The credential each Entra login object logs in with, built the first time
 * a pool is opened with that object and kept while the object lives. A pool
 * whose open failed is dropped, and the next one is opened with the same
 * login, so it gets the same credential and the token cache the credential
 * keeps: a principal the server refuses after its token costs one token,
 * not one per attempt. The composition root keeps one object for each
 * connection, and a new one when its secret changes (0074).
 */
const credentials = new WeakMap<EntraLogin, TokenCredential>()

function credentialFor(login: EntraLogin): TokenCredential {
  let credential = credentials.get(login)
  if (credential === undefined) {
    credential = entraCredential(login)
    credentials.set(login, credential)
  }
  return credential
}

/**
 * What mssql is given for a pool. A SQL login is a user and a password, over
 * the TLS the composition root chose: with `encrypt`, every connection is
 * opened through encryption.ts's connector, which refuses one whose server
 * answers that it will not encrypt before the login is sent (0081); TDS 7
 * still, because SQL Server 2019 and 2022 on Linux take no TDS 8.0 (0074).
 * Without `encrypt` there is nothing to refuse: the operator chose to send
 * the login unencrypted. An Entra principal is one credential,
 * which mssql hands every connection the pool opens, and no user or password
 * at all, so nothing can log in as a SQL login in its place; and it is
 * always TDS 8.0, `encrypt: 'strict'`: TLS before the first TDS message,
 * with the server's certificate checked. `encrypt: true` is TDS 7's, which
 * starts TLS only when the server's PRELOGIN answer asks for it
 * (connection.js, performTlsNegotiation), so whoever answered in the
 * server's place could decline it and be sent the token in the clear
 * (0074). Neither ever sets mssql's `debug` or tedious's `options.debug`:
 * tedious's debug output prints a login's password (login7-payload.js).
 */
export function sqlServerConfig(options: SqlServerConnectOptions): mssql.config {
  const base = { server: options.host, port: options.port, database: options.database }
  if (options.entra === undefined) {
    const tls = { encrypt: options.encrypt, trustServerCertificate: options.trustServerCertificate }
    return { ...base, options: options.encrypt ? { ...tls, connector: encryptedConnector } : tls, user: options.user, password: options.password }
  }
  return {
    ...base,
    options: { encrypt: 'strict', trustServerCertificate: false },
    authentication: { type: 'token-credential', options: { credential: credentialFor(options.entra) } },
  }
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
 * A SQL login whose server answered, when TLS was asked for, that it would
 * not encrypt rejects with encryption.ts's sentence, with nothing of the
 * login in it (0081). An Entra principal is refused without TLS or with
 * the server's certificate trusted, before anything is opened, and a
 * failed Entra login rejects with a sentence that names no tenant, client
 * or secret (entra.ts). A login that fails later, or a connection the guard
 * refuses later, when the pool opens another connection, reaches whoever
 * asked for the connection as mssql rejects it: the records' adapter
 * answers it `unavailable`.
 */
export async function connectSqlServer(options: SqlServerConnectOptions): Promise<ConnectionPool> {
  if (options.entra === undefined) {
    try {
      return await new mssql.ConnectionPool(sqlServerConfig(options)).connect()
    } catch (error) {
      throw encryptionRefusal(error) ?? error
    }
  }
  if (!options.encrypt) throw new Error(ENTRA_UNENCRYPTED)
  if (options.trustServerCertificate) throw new Error(ENTRA_UNCHECKED)
  try {
    return await new mssql.ConnectionPool(sqlServerConfig(options)).connect()
  } catch (error) {
    throw entraLoginFailure(error)
  }
}
