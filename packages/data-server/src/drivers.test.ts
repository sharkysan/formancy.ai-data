import { describe, expect, test } from 'vitest'
import type { ConnectionConfig } from './connections.js'
import { DRIVER_FACTORIES, entraLogin } from './drivers.js'

/*
 * What the factories refuse before any driver is asked, for a
 * ConnectionConfig an embedder built without parseConnections (0074). Each
 * entry points at a port nothing listens on, so a factory that went on to
 * connect would fail with the operating system's sentence, not its own.
 * Watched failing with each check removed.
 *
 * And how an allowlist login becomes the adapter's: `entraLogin`, exported
 * by this module for this file and not by the package. No container takes
 * an Entra login, so nothing else reaches the mapping.
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

describe('entraLogin', () => {
  const TENANT = '7c1f6a2e-3b4d-4e5f-9a8b-0c1d2e3f4a5b'
  const CLIENT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f'

  // The allowlist's tenant, client and secret become the adapter's
  // tenantId, clientId and clientSecret, each in its own place: tenant and
  // client are both UUIDs, so a swap passes every check the allowlist
  // makes and logs in to the client's id as a directory, and the
  // adapter's own test builds its login by hand and never sees this
  // mapping. Watched failing with tenant and client swapped.
  test('gives a service principal the allowlist’s tenant, client and resolved secret, each in its place', () => {
    expect(entraLogin({ type: 'entra-service-principal', tenant: TENANT, client: CLIENT, secret: 'env:ERP_CLIENT_SECRET' }, 'the-resolved-secret')).toEqual({
      type: 'service-principal',
      tenantId: TENANT,
      clientId: CLIENT,
      clientSecret: 'the-resolved-secret',
    })
  })

  // A managed identity's client id chooses a user-assigned identity;
  // without one the host's own logs in. A client id dropped would log in
  // as the system-assigned identity, another principal with other grants,
  // and a client id invented would ask for an identity the host may not
  // have. Watched failing with the client id dropped.
  test('gives a managed identity its client id when the allowlist names one, and none when it does not', () => {
    expect(entraLogin({ type: 'entra-managed-identity', client: CLIENT }, undefined)).toEqual({ type: 'managed-identity', clientId: CLIENT })
    expect(entraLogin({ type: 'entra-managed-identity' }, undefined)).toStrictEqual({ type: 'managed-identity' })
  })

  // The adapter keeps one credential, and its token cache, for each login
  // object it is given (data-sqlserver's connect.ts), and the registry
  // opens a connection again after a failed open with the secret resolved
  // again. So a connection's login is one object while its secret is the
  // same -- a failed open costs no new token -- and a new one when the
  // secret changed, so a corrected or rotated secret is logged in with.
  // Watched failing with a new object made for every open.
  test('is one object for a connection while its secret is the same, and a new one when the secret changes', () => {
    const principal = { type: 'entra-service-principal', tenant: TENANT, client: CLIENT, secret: 'file:/run/secrets/erp-client-secret' } as const
    const first = entraLogin(principal, 'secret-1')
    expect(entraLogin(principal, 'secret-1')).toBe(first)
    const rotated = entraLogin(principal, 'secret-2')
    expect(rotated).not.toBe(first)
    expect(rotated).toMatchObject({ clientSecret: 'secret-2' })
    expect(entraLogin(principal, 'secret-2')).toBe(rotated)
    const managed = { type: 'entra-managed-identity', client: CLIENT } as const
    expect(entraLogin(managed, undefined)).toBe(entraLogin(managed, undefined))
    expect(entraLogin({ ...managed }, undefined)).not.toBe(entraLogin(managed, undefined))
  })
})
