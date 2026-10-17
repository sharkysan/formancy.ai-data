import { ManagedIdentityCredential } from '@azure/identity'
import mssql from 'mssql'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { DatabaseAdapter } from '@formancy/data-core'
import { selectedImage, startSqlServerContainer } from '@formancy/data-fixtures'
import type { ServerRecord, StartedMSSQLServerContainer } from '@formancy/data-fixtures'
import { createSqlServerAdapter } from './adapter.js'
import { connectSqlServer } from './connect.js'

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
 * An Entra login logs in over TDS 8.0 alone, TLS before the first TDS
 * message and the certificate checked (0074). The run's image, whichever
 * of the matrix it is, has no certificate configured, and none of the three
 * takes such a connection then: measured on 2026-10-17, SQL Server 2019 and
 * 2022 on Linux reset it with a certificate or without, and 2025 without
 * one. So on every leg an Entra pool is refused before anything reaches
 * the server's login: the downgrade a server that does not speak TLS first
 * could otherwise offer is never taken. What a server that takes TDS 8.0
 * answers is entra.integration.test.ts's, on 2025 with a certificate.
 */
describe('connectSqlServer, for an Entra principal', () => {
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

  // Before 0074 took TDS 8.0, this server was sent the PRELOGIN, offered
  // TLS, and refused the login in one failed login; a server that offered
  // none would have been sent the token in the clear. Now the server ends
  // the connection during the TLS handshake it does not expect, so it logs
  // no login and no token is asked for. The error is tedious's, passed on
  // as it came: it says where it failed and carries no credential.
  // Watched failing on 2026-10-17 on 2022 with the pool given TDS 7,
  // `encrypt: true`: with the certificate trusted, the server refused the
  // login in one failed login; with it checked, TDS 7's TLS failed on the
  // self-signed certificate, which a server that offered no TLS would not
  // have asked it to check.
  test('is refused at TLS on the run’s image, before any login reaches the server', async () => {
    const asked = vi.spyOn(ManagedIdentityCredential.prototype, 'getToken').mockRejectedValue(new Error('a test asks Entra nothing'))
    const before = await failedLogins()
    const error = await connectSqlServer({ ...address(), trustServerCertificate: false, entra: { type: 'managed-identity', clientId: '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f' } }).then(
      () => undefined,
      (rejected: unknown) => rejected,
    )
    expect(error).toMatchObject({ code: 'ESOCKET' })
    expect((error as Error).message).toContain('disconnected before secure TLS connection was established')
    expect(await failedLogins()).toBe(before)
    expect(asked).not.toHaveBeenCalled()
  })
})

/** Where the container is, over TLS with its self-signed certificate trusted, as the harness's own SQL logins are. */
function address(): { host: string; port: number; database: string; encrypt: boolean; trustServerCertificate: boolean } {
  return { host: container.getHost(), port: container.getPort(), database: 'master', encrypt: true, trustServerCertificate: true }
}

/** What mssql hands tedious for each connection it opens: the pool's private `_config()`. */
function tediousConfigOf(pool: mssql.ConnectionPool): { authentication: { type: string; options: Record<string, unknown> }; options: { debug?: unknown } } {
  return (pool as unknown as { _config(): ReturnType<typeof tediousConfigOf> })._config()
}
