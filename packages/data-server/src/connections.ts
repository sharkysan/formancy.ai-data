import { isDatabaseKind } from '@formancy/data-core'
import type { DatabaseAdapter, DatabaseKind, DiscoveryScope, LookupAdapter, RecordAdapter } from '@formancy/data-core'
import { resolveSecret } from '@formancy/data-identity'
import type { SecretSource } from '@formancy/data-identity'

/**
 * How a SQL Server connection logs in when it is not a SQL login: as a
 * Microsoft Entra principal (0074). A managed identity is user-assigned by
 * its `client` id, or the host's own without one; a service principal is a
 * `tenant` and a `client`, both ids, and a `secret` that is a reference, as
 * a password is. No test of this release logs in as either.
 */
export type ConnectionLogin =
  { type: 'entra-managed-identity'; client?: string } | { type: 'entra-service-principal'; tenant: string; client: string; secret: string }

/**
 * One database the deployment allows forms to bind to, as the operator wrote
 * it. The password is a secret reference, never a password (0014): this file is
 * reviewable configuration, and a secret in it would be a secret in review.
 * It logs in one way: `user` and `password`, or, on SQL Server, `login`.
 */
export interface ConnectionConfig {
  /** The name forms use. Lower case, as configuration ids are (0013). */
  id: string
  kind: DatabaseKind
  host: string
  port: number
  database: string
  /** A SQL login's user, with `password`; absent when `login` says how the connection logs in. */
  user?: string
  /** `env:NAME` or `file:/absolute/path`, with `user`. */
  password?: string
  /** SQL Server only: an Entra principal, in place of `user` and `password` (0074). */
  login?: ConnectionLogin
  /** The schemas an administrator approved. Discovery reads nothing outside them. */
  schemas: string[]
  /**
   * TLS. On by default, and certificate checking with it: a deployment that
   * turns either off says so here, in a file somebody reviews. An Entra
   * login turns neither off.
   */
  tls?: { enabled?: boolean; trustServerCertificate?: boolean }
}

/** What the server holds for one open connection: the three ports. */
export interface OpenConnection {
  adapter: DatabaseAdapter
  lookups: LookupAdapter
  records: RecordAdapter
}

/**
 * Opens a connection of one kind, with the secret its entry names resolved:
 * a SQL login's password or a service principal's client secret, and none
 * for a managed identity. Supplied by the composition root, which imports
 * the drivers; nothing here does, so the registry is tested with a fake and
 * the server's core depends on no driver.
 */
export type ConnectionFactory = (config: ConnectionConfig, secret: string | undefined) => Promise<OpenConnection>

/** The Entra logins the allowlist takes: the SQL Server adapter's (SQLSERVER_LOGINS), held to it by connections.test.ts. */
export const CONNECTION_LOGINS = ['entra-managed-identity', 'entra-service-principal'] as const

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The keys an entry, its `tls` and each login may hold. Any other is refused by name (0074). */
const ENTRY_KEYS = new Set(['id', 'kind', 'host', 'port', 'database', 'user', 'password', 'login', 'schemas', 'tls'])
const TLS_KEYS = ['enabled', 'trustServerCertificate'] as const
const LOGIN_KEYS: Readonly<Record<(typeof CONNECTION_LOGINS)[number], ReadonlySet<string>>> = {
  'entra-managed-identity': new Set(['type', 'client']),
  'entra-service-principal': new Set(['type', 'tenant', 'client', 'secret']),
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isReference = (value: unknown): boolean => typeof value === 'string' && (value.startsWith('env:') || value.startsWith('file:'))

/**
 * What is wrong with an entry's `tls`: anything but an object of the two
 * booleans. An Entra login turns neither off: its token is a bearer token
 * for every database the principal reaches, so without TLS it would cross
 * the network in the clear (tedious offers the server no encryption at
 * all), and with the server's certificate trusted it would go to whichever
 * server answered.
 */
function tlsProblems(where: string, tls: unknown, entra: boolean): string[] {
  if (tls === undefined) return []
  if (!isObject(tls)) return [`${where}.tls must be an object: enabled and trustServerCertificate, each true or false`]
  const problems: string[] = []
  for (const key of TLS_KEYS) {
    if (tls[key] !== undefined && typeof tls[key] !== 'boolean') problems.push(`${where}.tls.${key} must be true or false`)
  }
  for (const key of Object.keys(tls)) {
    if (!(TLS_KEYS as readonly string[]).includes(key)) problems.push(`${where}.tls.${key} is not a setting this release reads`)
  }
  if (entra && tls['enabled'] === false)
    problems.push(`${where}.tls.enabled cannot be false for an Entra login: its token would cross the network in the clear`)
  if (entra && tls['trustServerCertificate'] === true)
    problems.push(`${where}.tls.trustServerCertificate cannot be true for an Entra login: its token would go to any server that answered`)
  return problems
}

/**
 * What is wrong with an entry's `login`. Each field is named and its value
 * never repeated: a tenant or client that is not an id may be anything,
 * and a secret that is not a reference is most likely the secret. A tenant
 * is its id, never a domain name, which would need resolving; there is no
 * authority, because the public cloud is the one this release logs in to.
 */
function loginProblems(where: string, login: unknown): string[] {
  if (!isObject(login)) return [`${where}.login must be an object naming its type`]
  const type = login['type']
  if (type !== 'entra-managed-identity' && type !== 'entra-service-principal') return [`${where}.login.type must be ${CONNECTION_LOGINS.join(' or ')}`]
  const problems: string[] = []
  const principal = type === 'entra-service-principal'
  const isId = (field: string) => typeof login[field] === 'string' && UUID.test(login[field])
  if (principal && !isId('tenant')) problems.push(`${where}.login.tenant must be the directory's tenant id, a UUID; a domain name is not taken`)
  if ((principal || login['client'] !== undefined) && !isId('client')) problems.push(`${where}.login.client must be the application's client id, a UUID`)
  if (principal && !isReference(login['secret'])) problems.push(`${where}.login.secret must be a secret reference, env:NAME or file:/path`)
  for (const key of Object.keys(login)) {
    if (!LOGIN_KEYS[type].has(key)) problems.push(`${where}.login.${key} is not a setting of an ${type} login`)
  }
  return problems
}

/** How the entry logs in: a SQL login's two fields, or, on SQL Server, `login` and neither of them. */
function signInProblems(where: string, value: Record<string, unknown>): string[] {
  if (value['login'] === undefined) {
    const problems: string[] = []
    if (typeof value['user'] !== 'string' || value['user'] === '') problems.push(`${where}.user is required`)
    // Never echoed: a value here that is not a reference is most likely the password itself.
    if (!isReference(value['password'])) problems.push(`${where}.password must be a secret reference, env:NAME or file:/path`)
    return problems
  }
  if (value['user'] !== undefined || value['password'] !== undefined) return [`${where} logs in one way: user and password, or login, not both`]
  if (value['kind'] === 'postgres') return [`${where}.login is for SQL Server; a PostgreSQL connection logs in with user and password`]
  return loginProblems(where, value['login'])
}

/**
 * The allowlist, checked: every problem at once, so an operator fixes the file
 * in one pass rather than one restart per mistake. A key this release does
 * not read is refused, on every entry: kept and ignored, a later release's
 * setting in this file would be dropped and the entry would log in some
 * other way (0074).
 */
export function parseConnections(document: unknown): { ok: true; connections: ConnectionConfig[] } | { ok: false; problems: string[] } {
  if (!Array.isArray(document)) return { ok: false, problems: ['the connections file is a list'] }
  const problems: string[] = []
  const seen = new Set<string>()
  const connections: ConnectionConfig[] = []
  document.forEach((entry: unknown, index) => {
    const where = `connections[${String(index)}]`
    if (!isObject(entry)) {
      problems.push(`${where} is not an object`)
      return
    }
    const value = entry
    const id = value['id']
    const before = problems.length
    if (typeof id !== 'string' || !ID.test(id)) problems.push(`${where}.id must be lower-case letters, digits, dot, hyphen or underscore`)
    else if (seen.has(id)) problems.push(`${where}.id ${id} is used twice`)
    if (!isDatabaseKind(value['kind'])) problems.push(`${where}.kind must be postgres or sqlserver`)
    for (const field of ['host', 'database'] as const) {
      if (typeof value[field] !== 'string' || value[field] === '') problems.push(`${where}.${field} is required`)
    }
    const port = value['port']
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) problems.push(`${where}.port must be a port number`)
    problems.push(...signInProblems(where, value))
    const schemas = value['schemas']
    if (!Array.isArray(schemas) || schemas.length === 0 || !schemas.every((schema) => typeof schema === 'string' && schema !== '')) {
      problems.push(`${where}.schemas must list at least one approved schema`)
    }
    problems.push(...tlsProblems(where, value['tls'], value['login'] !== undefined))
    for (const key of Object.keys(value)) {
      if (!ENTRY_KEYS.has(key)) problems.push(`${where}.${key} is not a setting this release reads`)
    }
    if (problems.length === before && typeof id === 'string') {
      seen.add(id)
      connections.push(entry as unknown as ConnectionConfig)
    }
  })
  return problems.length === 0 ? { ok: true, connections } : { ok: false, problems }
}

/**
 * The sentence main.ts logs at start for each connection that logs in as an
 * Entra principal, naming the connection and nothing of the principal: no
 * test of this release logs in as one (0074).
 */
export function untestedLogins(connections: readonly ConnectionConfig[]): string[] {
  return connections
    .filter((connection) => connection.login !== undefined)
    .map((connection) => `No test of this release logs in as an Entra principal; connection ${connection.id} logs in as one.`)
}

/** The variable under which @azure/identity's managed identity logs in by workload identity's token exchange instead. */
const WORKLOAD_TOKEN_FILE = 'AZURE_FEDERATED_TOKEN_FILE'

/**
 * What in the environment `env` stops the server at start, for the Entra
 * connections among `connections`: a managed identity while
 * AZURE_FEDERATED_TOKEN_FILE is set. @azure/identity 4.13.3 then logs in by
 * AKS workload identity's token exchange (tokenExchangeMsi.js), as the
 * tenant, client and authority host the environment names rather than the
 * reviewed entry, and this release does not take workload identity (0074).
 * The library takes it when AZURE_TENANT_ID and a client id are set too;
 * the token file alone is refused here, and named, never its value.
 * main.ts passes the process's environment: nothing here reads it.
 */
export function entraEnvironmentProblems(connections: readonly ConnectionConfig[], env: Readonly<Record<string, string | undefined>>): string[] {
  if (env[WORKLOAD_TOKEN_FILE] === undefined) return []
  return connections
    .filter((connection) => connection.login?.type === 'entra-managed-identity')
    .map(
      (connection) =>
        `connection ${connection.id} logs in as a managed identity, which logs in by workload identity while ${WORKLOAD_TOKEN_FILE} is set, as the tenant, client and authority the environment names; this release does not take workload identity. Unset it, or log in as a service principal (0074).`,
    )
}

/** The secret reference an entry names: a SQL login's password, a service principal's client secret, or none. */
function secretReference(config: ConnectionConfig): string | undefined {
  if (config.login === undefined) return config.password
  return config.login.type === 'entra-service-principal' ? config.login.secret : undefined
}

export interface ConnectionRegistry {
  /** The ids a form may bind to. */
  ids(): string[]
  /** The approved scope of one connection, or `undefined` if the deployment does not allow it. */
  scope(id: string): DiscoveryScope | undefined
  /**
   * The connection's ports, opened on first use and shared after. A connection
   * that failed to open is tried again on the next call, not cached as broken:
   * a database restarting is not a reason to restart the server.
   */
  open(id: string): Promise<OpenConnection | undefined>
  /** Closes every open connection. Safe to call twice. */
  close(): Promise<void>
}

/**
 * The allowlisted connections, opened lazily through the composition root's
 * factories. A form names a connection; this is the only place that name
 * becomes a database, so a form cannot reach a database the operator did not
 * list.
 */
export function createConnectionRegistry(
  connections: readonly ConnectionConfig[],
  factories: Readonly<Partial<Record<DatabaseKind, ConnectionFactory>>>,
  secrets?: SecretSource,
): ConnectionRegistry {
  const byId = new Map(connections.map((connection) => [connection.id, connection]))
  const opening = new Map<string, Promise<OpenConnection>>()

  return {
    ids: () => [...byId.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),

    scope(id) {
      const config = byId.get(id)
      return config === undefined ? undefined : { schemas: [...config.schemas] }
    },

    async open(id) {
      const config = byId.get(id)
      if (config === undefined) return undefined
      let pending = opening.get(id)
      if (pending === undefined) {
        const factory = factories[config.kind]
        if (factory === undefined) throw new Error(`no driver is configured for ${config.kind} connections`)
        const reference = secretReference(config)
        const secret = reference === undefined ? Promise.resolve(undefined) : resolveSecret(reference, secrets)
        pending = secret.then((resolved) => factory(config, resolved))
        opening.set(id, pending)
        // Forgotten on failure, so the next request tries again.
        pending.catch(() => opening.delete(id))
      }
      return pending
    },

    async close() {
      const open = [...opening.values()]
      opening.clear()
      await Promise.allSettled(open.map(async (pending) => (await pending).adapter.close()))
    },
  }
}
