import { isDatabaseKind } from '@formancy/data-core'
import type { DatabaseAdapter, DatabaseKind, DiscoveryScope, LookupAdapter, RecordAdapter } from '@formancy/data-core'
import { resolveSecret } from './secrets.js'
import type { SecretSource } from './secrets.js'

/**
 * One database the deployment allows forms to bind to, as the operator wrote
 * it. The password is a secret reference, never a password (0014): this file is
 * reviewable configuration, and a secret in it would be a secret in review.
 */
export interface ConnectionConfig {
  /** The name forms use. Lower case, as configuration ids are (0013). */
  id: string
  kind: DatabaseKind
  host: string
  port: number
  database: string
  user: string
  /** `env:NAME` or `file:/absolute/path`. */
  password: string
  /** The schemas an administrator approved. Discovery reads nothing outside them. */
  schemas: string[]
  /**
   * TLS. On by default, and certificate checking with it: a deployment that
   * turns either off says so here, in a file somebody reviews.
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
 * Opens a connection of one kind. Supplied by the composition root, which
 * imports the drivers; nothing here does, so the registry is tested with a
 * fake and the server's core depends on no driver.
 */
export type ConnectionFactory = (config: ConnectionConfig, password: string) => Promise<OpenConnection>

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

/**
 * The allowlist, checked: every problem at once, so an operator fixes the file
 * in one pass rather than one restart per mistake.
 */
export function parseConnections(document: unknown): { ok: true; connections: ConnectionConfig[] } | { ok: false; problems: string[] } {
  if (!Array.isArray(document)) return { ok: false, problems: ['the connections file is a list'] }
  const problems: string[] = []
  const seen = new Set<string>()
  const connections: ConnectionConfig[] = []
  document.forEach((entry: unknown, index) => {
    const where = `connections[${String(index)}]`
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`${where} is not an object`)
      return
    }
    const value = entry as Record<string, unknown>
    const id = value['id']
    const before = problems.length
    if (typeof id !== 'string' || !ID.test(id)) problems.push(`${where}.id must be lower-case letters, digits, dot, hyphen or underscore`)
    else if (seen.has(id)) problems.push(`${where}.id ${id} is used twice`)
    if (!isDatabaseKind(value['kind'])) problems.push(`${where}.kind must be postgres or sqlserver`)
    for (const field of ['host', 'database', 'user'] as const) {
      if (typeof value[field] !== 'string' || value[field] === '') problems.push(`${where}.${field} is required`)
    }
    const port = value['port']
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) problems.push(`${where}.port must be a port number`)
    const password = value['password']
    if (typeof password !== 'string' || !(password.startsWith('env:') || password.startsWith('file:'))) {
      // Never echoed: a value here that is not a reference is most likely the password itself.
      problems.push(`${where}.password must be a secret reference, env:NAME or file:/path`)
    }
    const schemas = value['schemas']
    if (!Array.isArray(schemas) || schemas.length === 0 || !schemas.every((schema) => typeof schema === 'string' && schema !== '')) {
      problems.push(`${where}.schemas must list at least one approved schema`)
    }
    if (problems.length === before && typeof id === 'string') {
      seen.add(id)
      connections.push(entry as ConnectionConfig)
    }
  })
  return problems.length === 0 ? { ok: true, connections } : { ok: false, problems }
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
        pending = resolveSecret(config.password, secrets).then((password) => factory(config, password))
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
