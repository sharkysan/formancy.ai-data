import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseAdapter, LookupAdapter, RecordAdapter } from '@formancy/data-core'
import { SQLSERVER_LOGINS } from '@formancy/data-sqlserver'
import { describe, expect, test } from 'vitest'
import type { ConnectionConfig, ConnectionFactory, OpenConnection } from './connections.js'
import { CONNECTION_LOGINS, createConnectionRegistry, entraEnvironmentProblems, parseConnections, untestedLogins } from './connections.js'

const ERP: ConnectionConfig = {
  id: 'erp',
  kind: 'sqlserver',
  host: 'db.internal',
  port: 1433,
  database: 'erp',
  user: 'formancy',
  password: 'env:ERP_PASSWORD',
  schemas: ['sales'],
}

/** A connection whose ports are inert: the registry is what is under test, not a database. */
function fakeConnection(onClose: () => void = () => {}): OpenConnection {
  const adapter = { kind: 'sqlserver', ping: async () => ({ kind: 'sqlserver', version: 'x', product: 'sqlserver', major: null }), discover: async () => { throw new Error('unused') }, close: async () => onClose() } as DatabaseAdapter
  return { adapter, lookups: {} as LookupAdapter, records: {} as RecordAdapter }
}

const secrets = { env: { ERP_PASSWORD: 'p@ss' }, readFile: async () => '' }

const TENANT = '7c1f6a2e-3b4d-4e5f-9a8b-0c1d2e3f4a5b'
const CLIENT = '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f'
const CLIENT_SECRET = 'Zq8~entra-client-secret-value-e81'

/** An Entra entry as an operator writes one (0074): no user and no password, TLS left on. */
const { user: _user, password: _password, ...ADDRESS } = ERP
const MANAGED: ConnectionConfig = { ...ADDRESS, id: 'erp-mi', login: { type: 'entra-managed-identity', client: CLIENT } }
const SYSTEM: ConnectionConfig = { ...ADDRESS, id: 'erp-system', login: { type: 'entra-managed-identity' } }
const PRINCIPAL: ConnectionConfig = { ...ADDRESS, id: 'erp-sp', login: { type: 'entra-service-principal', tenant: TENANT, client: CLIENT, secret: 'file:/run/secrets/erp-client-secret' } }

/** The problems parseConnections finds in `entries`, which must be some. */
function problemsOf(entries: unknown[]): string[] {
  const outcome = parseConnections(entries)
  expect(outcome.ok).toBe(false)
  return outcome.ok ? [] : outcome.problems
}

describe('parseConnections', () => {
  // The happy path, as an operator would write it.
  test('accepts an allowlist with secret references', () => {
    expect(parseConnections([ERP])).toEqual({ ok: true, connections: [ERP] })
  })

  // Every mistake at once, so a broken file is one fix and one restart. And the
  // commonest mistake — the password itself where its reference belongs — is
  // refused without being repeated.
  test('lists every problem, and never repeats a password', () => {
    const outcome = parseConnections([
      { ...ERP, password: 'hunter2-the-actual-password' },
      { ...ERP, id: 'Bad Id', kind: 'oracle', port: 70000, schemas: [] },
      ERP,
      { ...ERP },
      'not an object',
    ])
    expect(outcome.ok).toBe(false)
    const problems = outcome.ok ? [] : outcome.problems
    expect(problems).toEqual(
      expect.arrayContaining([
        'connections[0].password must be a secret reference, env:NAME or file:/path',
        expect.stringMatching(/connections\[1\]\.id must be lower-case/),
        'connections[1].kind must be postgres or sqlserver',
        'connections[1].port must be a port number',
        'connections[1].schemas must list at least one approved schema',
        'connections[3].id erp is used twice',
        'connections[4] is not an object',
      ]),
    )
    expect(problems.join(' ')).not.toContain('hunter2')
    expect(parseConnections({})).toEqual({ ok: false, problems: ['the connections file is a list'] })
  })

  // The allowlist the composed stack runs with (0032), as committed: every
  // key it writes is one this release reads, so refusing unknown keys
  // refuses nothing an operator copied from it.
  test('accepts deploy/connections.json as committed', () => {
    const committed = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'deploy', 'connections.json'), 'utf8')) as unknown
    expect(parseConnections(committed).ok).toBe(true)
  })

  // A key this release does not read was kept and ignored, so a later
  // release's `login`, `authentication` or `sslmode` in a file this one
  // read would have been dropped silently and the entry logged in some
  // other way (0074). Refused on every entry, and inside `tls` and
  // `login`, by name: the value may be the secret itself. And `tls`'s
  // two settings were taken as they came, so `"enabled": "false"`, a
  // string, turned TLS on. Watched failing with the unknown-key rule
  // removed, and with tls's types unchecked.
  test('refuses a key it does not read, on every entry, naming the key and never its value', () => {
    const problems = problemsOf([
      { ...ERP, sslmode: 'disable', authentication: 'hunter2-the-actual-password' },
      { ...ERP, id: 'tls-junk', tls: { enabled: 'false', trustServerCertificate: 1, ca: 'hunter2-a-pem' } },
      { ...ERP, id: 'tls-text', tls: 'off' },
    ])
    expect(problems).toEqual([
      'connections[0].sslmode is not a setting this release reads',
      'connections[0].authentication is not a setting this release reads',
      'connections[1].tls.enabled must be true or false',
      'connections[1].tls.trustServerCertificate must be true or false',
      'connections[1].tls.ca is not a setting this release reads',
      'connections[2].tls must be an object: enabled and trustServerCertificate, each true or false',
    ])
    expect(problems.join(' ')).not.toContain('hunter2')
    expect(problems.join(' ')).not.toContain('disable')
  })
})

describe('parseConnections, for an Entra principal', () => {
  // A SQL Server connection may log in as an Entra managed identity --
  // user-assigned by its client id, or the host's own without one -- or a
  // service principal whose secret is a reference, as a password is.
  test('accepts a managed identity and a service principal for SQL Server, with no user and no password', () => {
    const tls = { ...PRINCIPAL, id: 'erp-tls', tls: { enabled: true, trustServerCertificate: false } }
    expect(parseConnections([MANAGED, SYSTEM, PRINCIPAL, tls])).toEqual({ ok: true, connections: [MANAGED, SYSTEM, PRINCIPAL, tls] })
  })

  // Every way an Entra entry can be wrong is its own sentence, naming the
  // field and never its value: a tenant written as a domain name, which v1
  // does not resolve; a client that is not an id; a secret pasted where its
  // reference belongs; a secret beside a managed identity, which has none;
  // a type this release does not log in as -- `default`, which reads the
  // environment and can pick up a developer's `az login`, and `password`
  // and `access-token` among them; a login beside a user and a password,
  // where only one can be meant; a login on PostgreSQL; and TLS turned off
  // or the server's certificate trusted, under which the token, a bearer
  // token for every database the principal reaches, would cross the
  // network in the clear or go to whoever answered. An authority is not a
  // setting: the public cloud alone. Watched failing with each rule
  // removed in turn.
  test('refuses every way an Entra entry can be wrong, naming the field and never its value', () => {
    const problems = problemsOf([
      { ...PRINCIPAL, login: { type: 'entra-service-principal', tenant: 'contoso.onmicrosoft.com', client: 'my-app', secret: CLIENT_SECRET } },
      { ...MANAGED, login: { type: 'entra-managed-identity', client: CLIENT, secret: 'env:ERP_CLIENT_SECRET', tenant: TENANT } },
      { ...MANAGED, id: 'default', login: { type: 'entra-default' } },
      { ...MANAGED, id: 'both', user: 'formancy', password: 'env:ERP_PASSWORD' },
      { ...MANAGED, id: 'pg', kind: 'postgres' },
      { ...MANAGED, id: 'clear', tls: { enabled: false } },
      { ...PRINCIPAL, id: 'trusting', tls: { trustServerCertificate: true } },
      { ...PRINCIPAL, id: 'elsewhere', login: { type: 'entra-service-principal', tenant: TENANT, client: CLIENT, secret: 'env:ERP_CLIENT_SECRET', authority: 'https://login.microsoftonline.us' } },
      { ...ADDRESS, id: 'shapeless', login: 'entra' },
      { ...PRINCIPAL, id: 'unsaid', login: { type: 'entra-service-principal' } },
    ])
    expect(problems).toEqual([
      "connections[0].login.tenant must be the directory's tenant id, a UUID; a domain name is not taken",
      "connections[0].login.client must be the application's client id, a UUID",
      'connections[0].login.secret must be a secret reference, env:NAME or file:/path',
      'connections[1].login.secret is not a setting of an entra-managed-identity login',
      'connections[1].login.tenant is not a setting of an entra-managed-identity login',
      'connections[2].login.type must be entra-managed-identity or entra-service-principal',
      'connections[3] logs in one way: user and password, or login, not both',
      'connections[4].login is for SQL Server; a PostgreSQL connection logs in with user and password',
      'connections[5].tls.enabled cannot be false for an Entra login: its token would cross the network in the clear',
      'connections[6].tls.trustServerCertificate cannot be true for an Entra login: its token would go to any server that answered',
      'connections[7].login.authority is not a setting of an entra-service-principal login',
      'connections[8].login must be an object naming its type',
      "connections[9].login.tenant must be the directory's tenant id, a UUID; a domain name is not taken",
      "connections[9].login.client must be the application's client id, a UUID",
      'connections[9].login.secret must be a secret reference, env:NAME or file:/path',
    ])
    for (const value of ['contoso', 'my-app', CLIENT_SECRET, TENANT, CLIENT, 'ERP_CLIENT_SECRET', 'microsoftonline.us']) expect(problems.join(' ')).not.toContain(value)
  })

  // The startup line main.ts logs once per Entra connection: what the
  // operator is told before the first request, that no test of this
  // release logs in as one. It names the connection and nothing of the
  // principal. Watched failing with a SQL login named too.
  test('says once for each Entra connection that no test logs in as one, naming the connection alone', () => {
    const said = untestedLogins([ERP, MANAGED, PRINCIPAL])
    expect(said).toEqual([
      'No test of this release logs in as an Entra principal; connection erp-mi logs in as one.',
      'No test of this release logs in as an Entra principal; connection erp-sp logs in as one.',
    ])
    for (const value of [TENANT, CLIENT, 'erp-client-secret']) expect(said.join(' ')).not.toContain(value)
  })

  // @azure/identity 4.13.3's ManagedIdentityCredential does not ask the
  // host's identity endpoint when AZURE_FEDERATED_TOKEN_FILE,
  // AZURE_TENANT_ID and a client id are set: it takes AKS workload
  // identity's token exchange (tokenExchangeMsi.js), as the tenant
  // AZURE_TENANT_ID names, the client AZURE_CLIENT_ID names when the entry
  // names none, at the authority AZURE_AUTHORITY_HOST names -- review sent
  // it to a listener there on 2026-10-17. That is another principal, at
  // another authority, than the reviewed entry says, and a way in this
  // release does not take. Refused at start on the token file alone,
  // naming the variable and never its value; a service principal reads
  // none of these, and is not refused. Watched failing with the check
  // made for every Entra entry (the service principal refused), and with
  // it removed from main.ts (scripts/server-start.test.mjs).
  test('refuses a managed identity while AZURE_FEDERATED_TOKEN_FILE is set, naming the variable and never its value', () => {
    const file = '/var/run/secrets/azure/tokens/azure-identity-token'
    const workload = { AZURE_FEDERATED_TOKEN_FILE: file, AZURE_TENANT_ID: TENANT, AZURE_CLIENT_ID: CLIENT }
    const problems = entraEnvironmentProblems([ERP, MANAGED, SYSTEM, PRINCIPAL], workload)
    expect(problems).toEqual([
      'connection erp-mi logs in as a managed identity, which logs in by workload identity while AZURE_FEDERATED_TOKEN_FILE is set, as the tenant, client and authority the environment names; this release does not take workload identity. Unset it, or log in as a service principal (0074).',
      'connection erp-system logs in as a managed identity, which logs in by workload identity while AZURE_FEDERATED_TOKEN_FILE is set, as the tenant, client and authority the environment names; this release does not take workload identity. Unset it, or log in as a service principal (0074).',
    ])
    for (const value of [file, TENANT, CLIENT]) expect(problems.join(' ')).not.toContain(value)
    expect(entraEnvironmentProblems([ERP, MANAGED, SYSTEM, PRINCIPAL], { AZURE_TENANT_ID: TENANT, AZURE_CLIENT_ID: CLIENT })).toEqual([])
    expect(entraEnvironmentProblems([ERP, PRINCIPAL], workload)).toEqual([])
  })

  // The login types the allowlist takes are the adapter's, which the
  // README's tested-on row says (0074): a type added on one side and not
  // the other would be a login no row names, or a row no entry can reach.
  test('takes exactly the Entra logins the SQL Server adapter opens, which it says are not tested', () => {
    expect(['sql', ...CONNECTION_LOGINS]).toEqual(SQLSERVER_LOGINS.map((login) => login.login))
    expect(SQLSERVER_LOGINS.filter((login) => login.login !== 'sql').every((login) => !login.tested)).toBe(true)
  })
})

describe('createConnectionRegistry', () => {
  // A form names a connection; this is where that name becomes a database. A
  // name the operator did not list reaches nothing.
  test('opens only allowlisted connections, once, with the resolved password', async () => {
    const calls: Array<{ id: string; password: string | undefined }> = []
    const factory: ConnectionFactory = async (config, password) => {
      calls.push({ id: config.id, password })
      return fakeConnection()
    }
    const registry = createConnectionRegistry([ERP], { sqlserver: factory }, secrets)
    expect(registry.ids()).toEqual(['erp'])
    expect(registry.scope('erp')).toEqual({ schemas: ['sales'] })
    expect(registry.scope('elsewhere')).toBeUndefined()
    expect(await registry.open('elsewhere')).toBeUndefined()
    const [first, second] = await Promise.all([registry.open('erp'), registry.open('erp')])
    expect(first).toBe(second)
    expect(calls).toEqual([{ id: 'erp', password: 'p@ss' }])
  })

  // A database restarting is not a reason to restart the server: a failed open
  // is forgotten, so the next request tries again.
  test('tries again after a failed open', async () => {
    let attempts = 0
    const registry = createConnectionRegistry([ERP], {
      sqlserver: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('ECONNREFUSED')
        return fakeConnection()
      },
    }, secrets)
    await expect(registry.open('erp')).rejects.toThrow('ECONNREFUSED')
    await expect(registry.open('erp')).resolves.toBeDefined()
    expect(attempts).toBe(2)
  })

  // A kind with no driver configured, and a password that cannot be resolved,
  // are both loud — never a connection opened without credentials.
  test('refuses a kind with no driver and a secret that cannot be resolved', async () => {
    await expect(createConnectionRegistry([ERP], {}, secrets).open('erp')).rejects.toThrow(/no driver is configured for sqlserver/)
    const noSecret = createConnectionRegistry([ERP], { sqlserver: async () => fakeConnection() }, { env: {}, readFile: async () => '' })
    await expect(noSecret.open('erp')).rejects.toThrow(/ERP_PASSWORD is unset or empty/)
  })

  // A service principal's secret is a reference, resolved as a password's
  // is and handed to the factory; a managed identity has none, and nothing
  // is read for it. Watched failing with the password resolved for every
  // entry, which left a service principal's secret unresolved.
  test('resolves a service principal’s secret and nothing for a managed identity', async () => {
    const read: string[] = []
    const calls: Array<{ id: string; secret: string | undefined }> = []
    const factory: ConnectionFactory = async (config, secret) => {
      calls.push({ id: config.id, secret })
      return fakeConnection()
    }
    const registry = createConnectionRegistry([MANAGED, PRINCIPAL], { sqlserver: factory }, {
      env: {},
      readFile: async (path) => {
        read.push(path)
        return `${CLIENT_SECRET}\n`
      },
    })
    await registry.open('erp-mi')
    await registry.open('erp-sp')
    expect(calls).toEqual([
      { id: 'erp-mi', secret: undefined },
      { id: 'erp-sp', secret: CLIENT_SECRET },
    ])
    expect(read).toEqual(['/run/secrets/erp-client-secret'])
  })

  // A secret that cannot be resolved stops the open, naming the variable
  // or the form of the reference and never a value: an embedder's config,
  // which parseConnections never saw, may hold the secret itself.
  test('refuses a service principal whose secret cannot be resolved, without repeating it', async () => {
    const factory = async () => fakeConnection()
    const login = (secret: string): ConnectionConfig => ({ ...PRINCIPAL, login: { type: 'entra-service-principal', tenant: TENANT, client: CLIENT, secret } })
    const unset = createConnectionRegistry([login('env:ERP_CLIENT_SECRET')], { sqlserver: factory }, { env: {}, readFile: async () => '' })
    await expect(unset.open('erp-sp')).rejects.toThrow('the environment variable ERP_CLIENT_SECRET is unset or empty')
    const pasted = createConnectionRegistry([login(CLIENT_SECRET)], { sqlserver: factory }, { env: {}, readFile: async () => '' })
    const error = await pasted.open('erp-sp').then(
      () => undefined,
      (rejected: unknown) => rejected as Error,
    )
    expect(error?.message).toMatch(/^a secret reference is env:NAME or file:\/absolute\/path/)
    expect(error?.message).not.toContain(CLIENT_SECRET)
  })

  // Shutdown closes what was opened, and only that; calling it twice is harmless.
  test('closes every open connection, once', async () => {
    let closed = 0
    const registry = createConnectionRegistry([ERP, { ...ERP, id: 'idle' }], { sqlserver: async () => fakeConnection(() => (closed += 1)) }, secrets)
    await registry.open('erp')
    await registry.close()
    await registry.close()
    expect(closed).toBe(1)
  })
})
