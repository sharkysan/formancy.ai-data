import { inspect } from 'node:util'
import { ClientSecretCredential, ManagedIdentityCredential } from '@azure/identity'
import mssql from 'mssql'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { DatabaseAdapter } from '@formancy/data-core'
import { selectedImage, startSqlServerContainer } from '@formancy/data-fixtures'
import type { ServerRecord, StartedMSSQLServerContainer } from '@formancy/data-fixtures'
import { createSqlServerAdapter } from './adapter.js'
import { connectSqlServer, sqlServerConfig } from './connect.js'
import type { SqlServerConnectOptions } from './connect.js'
import { ENTRA_REFUSED } from './entra.js'
import type { EntraLogin } from './entra.js'

/**
 * Against REAL SQL Server. There is no mocked driver here and there is not
 * going to be one (0003): what an adapter gets wrong, it gets wrong under real
 * T-SQL semantics, and a suite that passed without a server would be proving
 * the mock.
 */
let container: StartedMSSQLServerContainer
let server: ServerRecord
let adapter: DatabaseAdapter

beforeAll(async () => {
  // The image this run chose (FORMANCY_IMAGES, 0067), through the harness
  // that records what answered (0035), and that accepts the EULA as
  // compose.yaml makes a developer do.
  ;({ container, server } = await startSqlServerContainer())
  const pool = await new mssql.ConnectionPool({
    server: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    // The container has a self-signed certificate. A customer's server has a
    // real one, and the composition root there says so; this is the test's
    // configuration and not a default anything in this package carries.
    options: { encrypt: false, trustServerCertificate: true },
  }).connect()
  adapter = createSqlServerAdapter(pool)
})

afterAll(async () => {
  await adapter.close()
  await container.stop()
})

describe('the SQL Server adapter', () => {
  // A ping that answered from the driver's configuration would pass against a
  // server that is not there, and one that reported a version other than the
  // server's would put a wrong one in every snapshot. The version asserted is
  // what the server told the harness when it started, asked its own way, so
  // the adapter's answer has to have come from it -- and if the two queries
  // ever disagree, this is how anybody finds out.
  test('ping reports the server that answered', async () => {
    const identity = await adapter.ping()
    expect(identity.kind).toBe('sqlserver')
    expect(identity.version).toBe(server.version)
  })

  // The start above names no image, so it is the one place a leg of the
  // matrix (0067) depends on the bare call following FORMANCY_IMAGES: on
  // the default, the 2019 leg's ping would be 2022's, reported as 2019's.
  test('runs on the image this run chose', () => {
    expect(server.image).toBe(selectedImage('sqlserver'))
  })

  // A composition root closes on shutdown and again on an error path. The
  // second call must not throw, or the error path hides the original error.
  // Last, because nothing can ping after it.
  test('close is safe to call twice', async () => {
    await adapter.close()
    await expect(adapter.close()).resolves.toBeUndefined()
  })
})

describe('connectSqlServer', () => {
  // The pool this package opens and the parameter types it binds must come
  // from one copy of mssql; a pool from another copy refuses every parameter.
  // Discovery binds parameters, so a discovery through a pool opened here is
  // the proof.
  test('opens a pool its own adapters can bind parameters on', async () => {
    const { startSqlServerFixture } = await import('@formancy/data-fixtures')
    const fixture = await startSqlServerFixture()
    try {
      const pool = await connectSqlServer({
        host: String(fixture.admin.server),
        port: Number(fixture.admin.port),
        database: String(fixture.admin.database),
        user: String(fixture.admin.user),
        password: String(fixture.admin.password),
        encrypt: false,
        trustServerCertificate: true,
      })
      const snapshot = await createSqlServerAdapter(pool).discover({ schemas: ['sales'] })
      expect(snapshot.objects.length).toBeGreaterThan(0)
      await pool.close()
    } finally {
      await fixture.stop()
    }
  })
})

describe('connectSqlServer, for a SQL login', () => {
  // tedious's debug output prints a login's password (login7-payload.js
  // writes it into the payload's text), and mssql turns tedious's on with
  // its own `debug`. Neither is ever set: a pool a SQL login opens has
  // both unset, as mssql hands them to tedious. Watched failing with
  // `debug: true` in sqlServerConfig.
  test('opens a pool with no debug output', async () => {
    const pool = await connectSqlServer({ ...address(), user: container.getUsername(), password: container.getPassword() })
    try {
      // mssql keeps the config it was given as `config`, which its types do not declare.
      const { config } = pool as unknown as { config: { debug?: unknown; options?: { debug?: unknown } } }
      expect(config.debug).toBeUndefined()
      expect(config.options?.debug).toBeUndefined()
      expect(tediousConfigOf(pool).options.debug).toBeUndefined()
    } finally {
      await pool.close()
    }
  })
})

/*
 * An Entra login against a real server (0074). The container is SQL Server
 * 2022 on Linux, which takes no Entra login: asked with a FEDAUTH LOGIN7 it
 * answers at once with "Login failed for user ''." and sends no FEDAUTHINFO,
 * so tedious never asks for a token -- measured on 2026-10-17, 10 to 27 ms
 * over four attempts in two runs, encrypted or not, with a credential that
 * counted no call. A SQL login with an empty user is answered in the same words, and
 * the server's errorlog writes the same reason for both ("An attempt to
 * login using SQL authentication failed"), so nothing the server says tells
 * an Entra login from a fallback to a SQL login. So this holds what can be
 * held: one failed login and no second one, a sentence that names nothing
 * of the principal, no token asked for, and the configuration the pool
 * opens every connection with, which is a credential and no user. Nothing
 * here, or anywhere in this release, shows an Entra login succeeding.
 */
describe('connectSqlServer, for an Entra principal', () => {
  const TENANT = '7c1f6a2e-3b4d-4e5f-9a8b-0c1d2e3f4a5b'
  const CLIENT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f'
  const SECRET = 'Zq8~entra-client-secret-value-e81'
  const LOGINS: ReadonlyArray<{ name: string; entra: EntraLogin; credential: { prototype: object } }> = [
    { name: 'a service principal', entra: { type: 'service-principal', tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET }, credential: ClientSecretCredential },
    { name: 'a managed identity', entra: { type: 'managed-identity', clientId: CLIENT }, credential: ManagedIdentityCredential },
  ]

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** The server's own count of failed logins, from its errorlog: what was tried, whatever the driver said. */
  async function failedLogins(): Promise<number> {
    const sa = await connectSqlServer({ ...address(), user: container.getUsername(), password: container.getPassword() })
    try {
      // With no line to match, the procedure returns no result set at all.
      const found = await sa.request().query<{ Text: string }>(`exec xp_readerrorlog 0, 1, N'Login failed'`)
      return found.recordset?.length ?? 0
    } finally {
      await sa.close()
    }
  }

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
    const asked = vi.spyOn(credential.prototype as { getToken: () => Promise<null> }, 'getToken').mockRejectedValue(new Error('a test asks Entra nothing'))
    const before = await failedLogins()
    const error = await connectSqlServer({ ...address(), entra }).then(
      () => undefined,
      (rejected: unknown) => rejected,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(ENTRA_REFUSED)
    const said = [(error as Error).message, inspect(error, { depth: Infinity, showHidden: true }), JSON.stringify(error)].join('\n')
    for (const value of [TENANT, CLIENT, SECRET]) expect(said).not.toContain(value)
    expect(await failedLogins()).toBe(before + 1)
    expect(asked).not.toHaveBeenCalled()
  })

  // Since the server cannot tell a fallback apart, the pool's own
  // configuration is held: what mssql hands tedious for every connection
  // the pool opens is the one credential connectSqlServer built, for this
  // pool, and no user name or password to log in with instead, and no
  // debug output. mssql's `_config()` is private; it is read here because
  // it is exactly what each new connection is given. Watched failing with
  // the user and password added beside the credential, and with a
  // credential built for each `_config()`.
  test.each(LOGINS)('opens every connection of the pool with one credential for $name, and no user or password', ({ entra }) => {
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
    expect(first.options.debug).toBeUndefined()
    expect(sqlServerConfig(options).authentication).not.toBe(config.authentication)
  })
})

/** Where the container is, over TLS with its self-signed certificate trusted: an Entra login is refused without TLS. */
function address(): { host: string; port: number; database: string; encrypt: boolean; trustServerCertificate: boolean } {
  return { host: container.getHost(), port: container.getPort(), database: 'master', encrypt: true, trustServerCertificate: true }
}

/** What mssql hands tedious for each connection it opens: the pool's private `_config()`. */
function tediousConfigOf(pool: mssql.ConnectionPool): { authentication: { type: string; options: Record<string, unknown> }; options: { debug?: unknown } } {
  return (pool as unknown as { _config(): ReturnType<typeof tediousConfigOf> })._config()
}
