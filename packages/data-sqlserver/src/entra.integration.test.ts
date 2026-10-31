import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { inspect } from 'node:util'
import { ClientSecretCredential, ManagedIdentityCredential } from '@azure/identity'
import mssql from 'mssql'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { startSqlServerContainer } from '@formancy/data-fixtures'
import type { ServerRecord, StartedMSSQLServerContainer } from '@formancy/data-fixtures'
import { connectSqlServer, sqlServerConfig } from './connect.js'
import type { SqlServerConnectOptions } from './connect.js'
import { ENTRA_REFUSED } from './entra.js'
import type { EntraLogin } from './entra.js'

/*
 * An Entra login against a real server (0074), which logs in over TDS 8.0
 * alone: TLS before the first TDS message, and the server's certificate
 * checked. Two facts of a server decide whether such a login reaches it,
 * measured on 2026-10-17 on Docker Desktop on Windows: SQL Server 2019
 * (15.0.4500.2) and 2022 (16.0.4295.3) on Linux reset a connection that
 * opens with TLS, even with a certificate configured, and SQL Server 2025
 * (17.0.5015.4) takes one only with a certificate configured, resetting it
 * on the self-signed fallback. So this file names SQL Server 2025, and
 * starts it with a certificate made for `localhost` in the container, which
 * the client trusts only once the first test has shown that, untrusted, it
 * is refused. The run's own image, whichever it is, is held to the reset in
 * adapter.integration.test.ts.
 *
 * SQL Server on Linux takes no Entra login: asked with a FEDAUTH LOGIN7 it
 * answers at once with "Login failed for user ''." and sends no FEDAUTHINFO,
 * so tedious never asks for a token -- measured on 2022 over TDS 7, 10 to
 * 27 ms over four attempts in two runs, and on 2025 over TDS 8.0 in 38 ms
 * in one, each with a credential that counted no call. A SQL login with an empty
 * user is answered in the same words, and the errorlog writes the same
 * reason for both ("An attempt to login using SQL authentication failed"),
 * so nothing the server says tells an Entra login from a fallback to a SQL
 * login. So this holds what can be held: one failed login and no second
 * one, a sentence that names nothing of the principal, no token asked for,
 * and the configuration the pool opens every connection with, which is a
 * credential, TDS 8.0 and no user. Nothing here, or anywhere in this
 * release, shows an Entra login succeeding.
 */

/** The image this file names for a fact of its own: the one of the matrix that takes TDS 8.0. */
const SQLSERVER_2025_IMAGE = 'mcr.microsoft.com/mssql/server:2025-latest'

const TENANT = '7c1f6a2e-3b4d-4e5f-9a8b-0c1d2e3f4a5b'
const CLIENT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f'
const SECRET = 'Zq8~entra-client-secret-value-e81'
const LOGINS: ReadonlyArray<{ name: string; entra: EntraLogin; credential: { prototype: object } }> = [
  {
    name: 'a service principal',
    entra: { type: 'service-principal', tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET },
    credential: ClientSecretCredential,
  },
  { name: 'a managed identity', entra: { type: 'managed-identity', clientId: CLIENT }, credential: ManagedIdentityCredential },
]

let container: StartedMSSQLServerContainer
let server: ServerRecord
let certificate: string
/** The process's trusted certificates before this file added the container's. */
const trusted = getCACertificates('default')

beforeAll(async () => {
  const started = await startSqlServerContainer(SQLSERVER_2025_IMAGE, { certificate: true })
  ;({ container, server } = started)
  if (started.certificate === undefined) throw new Error('the container was started without its certificate')
  certificate = started.certificate
})

afterAll(async () => {
  setDefaultCACertificates(trusted)
  await container?.stop()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Where the container is, as an Entra pool is given it: TLS on, the certificate checked. */
function address(): { host: string; port: number; database: string; encrypt: boolean; trustServerCertificate: boolean } {
  return { host: container.getHost(), port: container.getPort(), database: 'master', encrypt: true, trustServerCertificate: false }
}

/** The server's own count of failed logins, from its errorlog: what was tried, whatever the driver said. */
async function failedLogins(): Promise<number> {
  const sa = await connectSqlServer({
    host: container.getHost(),
    port: container.getPort(),
    database: 'master',
    user: container.getUsername(),
    password: container.getPassword(),
    encrypt: false,
    trustServerCertificate: true,
  })
  try {
    // With no line to match, the procedure returns no result set at all.
    const found = await sa.request().query<{ Text: string }>(`exec xp_readerrorlog 0, 1, N'Login failed'`)
    return found.recordset?.length ?? 0
  } finally {
    await sa.close()
  }
}

/** The rejection `connectSqlServer` ends in, for `entra`, with the credential's getToken counted and refusing. */
async function refusal(entra: EntraLogin, credential: { prototype: object }): Promise<{ error: unknown; asked: ReturnType<typeof vi.spyOn> }> {
  const asked = vi.spyOn(credential.prototype as { getToken: () => Promise<null> }, 'getToken').mockRejectedValue(new Error('a test asks Entra nothing'))
  const error = await connectSqlServer({ ...address(), entra }).then(
    () => undefined,
    (rejected: unknown) => rejected,
  )
  return { error, asked }
}

test('runs on SQL Server 2025', () => {
  // The file's facts are 2025's: on the run's own image an Entra pool is
  // reset before any login (adapter.integration.test.ts).
  expect(server.image).toBe(SQLSERVER_2025_IMAGE)
  expect(server.version).toMatch(/^17\./)
})

describe('an Entra pool, to a server whose certificate the client does not trust', () => {
  // The certificate is self-signed and not yet trusted, and an Entra pool
  // is never told to trust one (connect.ts): the TLS handshake fails before
  // the first TDS message, so the server logs no login at all and nothing
  // asks for a token. Watched failing with the pool given TDS 7 and the
  // certificate trusted, `encrypt: true, trustServerCertificate: true`, as
  // these tests gave it before 0074 took TDS 8.0: the login reached the
  // server and was refused there.
  test.each(LOGINS)('is refused at TLS for $name, before any login reaches the server', async ({ entra, credential }) => {
    const before = await failedLogins()
    const { error, asked } = await refusal(entra, credential)
    expect(error).toMatchObject({ code: 'ESOCKET' })
    expect((error as Error).message).toContain('self-signed certificate')
    expect(await failedLogins()).toBe(before)
    expect(asked).not.toHaveBeenCalled()
  })
})

describe('an Entra pool, to a server whose certificate the client trusts', () => {
  beforeAll(() => {
    setDefaultCACertificates([...trusted, certificate])
  })

  // A sentence, not mssql's empty message: tedious's own answer is "Login
  // failed for user ''.", which says nothing of Entra, and every log line
  // the server writes logs `.message`. Nothing of the principal -- the
  // secret, the tenant, the client -- is in the message, in the whole
  // inspected error or in its JSON. The server counts exactly one failed
  // login for the attempt: a second would be a retry, as a SQL login or
  // otherwise. And no token was asked for, since the server sent no
  // FEDAUTHINFO: were one asked, it would be asked of Entra by a test.
  // Watched failing with entraLoginFailure skipped (the message was
  // tedious's "Login failed for user ''."), and with a second connect
  // attempted after the first failed (two failed logins).
  test.each(LOGINS)('is refused for $name in one failed login, with a sentence naming nothing of it, and no token asked for', async ({ entra, credential }) => {
    const before = await failedLogins()
    const { error, asked } = await refusal(entra, credential)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(ENTRA_REFUSED)
    const said = [(error as Error).message, inspect(error, { depth: Infinity, showHidden: true }), JSON.stringify(error)].join('\n')
    for (const value of [TENANT, CLIENT, SECRET]) expect(said).not.toContain(value)
    expect(await failedLogins()).toBe(before + 1)
    expect(asked).not.toHaveBeenCalled()
  })
})

describe('the configuration of an Entra pool', () => {
  // Since the server cannot tell a fallback apart, the pool's own
  // configuration is held: what mssql hands tedious for every connection
  // the pool opens is the one credential connectSqlServer built for this
  // login, TDS 8.0 with the certificate checked, and no user name or
  // password to log in with instead, and no debug output. mssql's
  // `_config()` is private; it is read here because it is exactly what each
  // new connection is given. Watched failing with the user and password
  // added beside the credential, with a credential built for each
  // `_config()`, and with TDS 7 and the certificate trusted.
  test.each(LOGINS)('opens every connection of the pool with one credential for $name, over TDS 8.0, and no user or password', ({ entra }) => {
    const options: SqlServerConnectOptions = { ...address(), entra }
    const config = sqlServerConfig(options)
    expect(config.user).toBeUndefined()
    expect(config.password).toBeUndefined()
    expect((config as { debug?: unknown }).debug).toBeUndefined()
    const pool = new mssql.ConnectionPool(config)
    const [first, second] = [tediousConfigOf(pool), tediousConfigOf(pool)]
    expect(first.authentication.type).toBe('token-credential')
    expect(Object.keys(first.authentication.options)).toEqual(['credential'])
    expect(second.authentication.options['credential']).toBe(first.authentication.options['credential'])
    expect(first.options).toMatchObject({ encrypt: 'strict', trustServerCertificate: false })
    expect(first.options.debug).toBeUndefined()
    expect(sqlServerConfig(options).authentication).not.toBe(config.authentication)
  })
})

/** What mssql hands tedious for each connection it opens: the pool's private `_config()`. */
function tediousConfigOf(pool: mssql.ConnectionPool): {
  authentication: { type: string; options: Record<string, unknown> }
  options: { debug?: unknown; encrypt?: unknown; trustServerCertificate?: unknown }
} {
  return (pool as unknown as { _config(): ReturnType<typeof tediousConfigOf> })._config()
}
