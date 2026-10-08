import { MSSQLServerContainer } from '@testcontainers/mssqlserver'
import type { StartedMSSQLServerContainer } from '@testcontainers/mssqlserver'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { DatabaseAdapter } from '@formancy/data-core'
import { createSqlServerAdapter } from './adapter.js'

/**
 * Against REAL SQL Server. There is no mocked driver here and there is not
 * going to be one (0003): what an adapter gets wrong, it gets wrong under real
 * T-SQL semantics, and a suite that passed without a server would be proving
 * the mock.
 */
let container: StartedMSSQLServerContainer
let adapter: DatabaseAdapter

beforeAll(async () => {
  // Accepting the EULA is the operator's act. In a test it is this line, which
  // is the same decision compose.yaml makes a developer spell out.
  container = await new MSSQLServerContainer('mcr.microsoft.com/mssql/server:2022-latest').acceptLicense().start()
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
  // server that is not there. SQL Server 2022 is version 16, and that is the
  // image the container runs, so the answer has to have come from it.
  test('ping reports the server that answered', async () => {
    const identity = await adapter.ping()
    expect(identity.kind).toBe('sqlserver')
    expect(identity.version).toMatch(/^16\./)
  })

  // A composition root closes on shutdown and again on an error path. The
  // second call must not throw, or the error path hides the original error.
  // Last, because nothing can ping after it.
  test('close is safe to call twice', async () => {
    await adapter.close()
    await expect(adapter.close()).resolves.toBeUndefined()
  })
})
