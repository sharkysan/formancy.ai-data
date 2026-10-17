import { describe, expect, test } from 'vitest'
import type { ConnectionConfig } from './connections.js'
import { DRIVER_FACTORIES } from './drivers.js'

/*
 * What the factories refuse before any driver is asked, for a
 * ConnectionConfig an embedder built without parseConnections (0074). Each
 * entry points at a port nothing listens on, so a factory that went on to
 * connect would fail with the operating system's sentence, not its own.
 * Watched failing with each check removed.
 */

const NOWHERE = { host: '127.0.0.1', port: 1, database: 'erp', schemas: ['sales'] }

describe('DRIVER_FACTORIES', () => {
  // A SQL login with no user or no password would reach tedious and
  // postgres.js as `undefined`, which each sends as an empty login: the
  // server refuses "Login failed for user ''", after a round trip, and
  // nothing says the entry named no login at all.
  test('refuse a connection that names neither a SQL login nor an Entra principal', async () => {
    const bare = { id: 'erp', ...NOWHERE } as const
    await expect(DRIVER_FACTORIES.sqlserver({ ...bare, kind: 'sqlserver' }, undefined)).rejects.toThrow('connection erp names no user and password to log in with')
    await expect(DRIVER_FACTORIES.postgres({ ...bare, kind: 'postgres', user: 'formancy' }, undefined)).rejects.toThrow('connection erp names no user and password to log in with')
  })

  // An Entra login on PostgreSQL would otherwise be dropped and the
  // connection opened with no login, as above.
  test('refuse a PostgreSQL connection that names an Entra principal', async () => {
    const config: ConnectionConfig = { id: 'erp', kind: 'postgres', ...NOWHERE, login: { type: 'entra-managed-identity' } }
    await expect(DRIVER_FACTORIES.postgres(config, undefined)).rejects.toThrow('connection erp names a login, which only a SQL Server connection takes')
  })

  // A service principal whose secret was not resolved would reach
  // @azure/identity with none, which refuses it in its own words --
  // "ClientSecretCredential: clientSecret is a required parameter" and a
  // troubleshooting link -- rather than saying the reference resolved to
  // nothing.
  test('refuse a service principal given no secret', async () => {
    const config: ConnectionConfig = {
      id: 'erp',
      kind: 'sqlserver',
      ...NOWHERE,
      login: { type: 'entra-service-principal', tenant: '7c1f6a2e-3b4d-4e5f-9a8b-0c1d2e3f4a5b', client: '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f', secret: 'env:ERP_CLIENT_SECRET' },
    }
    await expect(DRIVER_FACTORIES.sqlserver(config, undefined)).rejects.toThrow('a service principal logs in with its client secret, and none was resolved')
  })
})
