import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSnapshot } from '@formancy/data-core'
import type { DatabaseAdapter, LookupAdapter, MetadataSnapshot, RecordAdapter } from '@formancy/data-core'
import { createDataServer, createFileConfigurationStore } from '@formancy/data-server'
import type { ConfigurationStore, ConnectionRegistry, IdentityVerifier } from '@formancy/data-server'
import owner from './fixtures/postgres-owner.json'
import reader from './fixtures/postgres-reader.json'
import sqlserver from './fixtures/sqlserver-owner.json'

/**
 * The real data server, behind a fake `fetch`, for the studio's suite.
 *
 * Every answer the studio gets in a test is the one `createDataServer` gives:
 * the administrator plane's own routes, its own validation and its own store
 * on a temporary directory. Nothing here writes a response body. So when the
 * server changes a shape -- a field renamed, a status moved -- the studio's
 * tests fail, rather than passing against JSON somebody wrote to look like it.
 *
 * What is fake is what the server is designed to be given: the identity
 * verifier (literal tokens instead of signed ones; verification is
 * `identity.test.ts`'s), and the connection registry, whose adapters answer
 * with snapshots captured from the shared fixture by
 * `scripts/capture-snapshots.mjs`: PostgreSQL as its owner, who sees
 * everything, and as the restricted reader, who sees `sales.order` and gaps;
 * and SQL Server as its owner, whose order table keeps a rowversion.
 */

/** A snapshot read from a committed file, refused if it was edited after it was captured. */
export function readSnapshot(raw: unknown): MetadataSnapshot {
  const { fingerprint, ...contents } = raw as MetadataSnapshot
  const recomputed = createSnapshot(contents)
  if (recomputed.fingerprint !== fingerprint) {
    throw new Error(`a captured snapshot hashes to ${recomputed.fingerprint}, not ${String(fingerprint)}: it was edited. Run scripts/capture-snapshots.mjs again.`)
  }
  return recomputed
}

export const OWNER_SNAPSHOT = readSnapshot(owner)
export const READER_SNAPSHOT = readSnapshot(reader)
export const SQLSERVER_SNAPSHOT = readSnapshot(sqlserver)

/** The tokens the fake verifier accepts, and who each one is. */
export const TOKENS = { admin: 'studio-test-administrator', clerk: 'studio-test-clerk' } as const
export const ADMIN_ROLE = 'data-admin'

const verifyIdentity: IdentityVerifier = async (token) => {
  if (token === TOKENS.admin) return { ok: true, identity: { actor: { id: 'ada', roles: [ADMIN_ROLE] }, attributes: { tenant: '1' } } }
  if (token === TOKENS.clerk) return { ok: true, identity: { actor: { id: 'clerk-7', roles: ['clerk'] }, attributes: { tenant: '1' } } }
  return { ok: false, reason: 'ERR_JWS_INVALID' }
}

export interface TestPlane {
  /** The `fetch` the studio is given: every call is answered by the real server. */
  fetch: typeof fetch
  /** Each connection's database as it is now. A test replaces one to make drift. */
  databases: Map<string, MetadataSnapshot>
  /** Connections whose database does not answer. */
  unreachable: Set<string>
  /** Connections the operator has taken out of the allowlist since the server started. */
  removed: Set<string>
  /** Every request the studio made, as method and path, in order. */
  requests: Array<{ method: string; path: string }>
  /**
   * Hold every request whose path matches until `release` is called: the
   * server is slow, and the studio is seen while it waits.
   */
  hold(path: RegExp): { release: () => void }
  store: ConfigurationStore
  /** The store's directory: one file per published version, which a test can damage by hand. */
  root: string
  close(): Promise<void>
}

/** The connections the registry allows, in the order the server lists them. */
export const CONNECTIONS = ['fixture', 'fixture-reader', 'fixture-sqlserver'] as const

export async function startPlane(): Promise<TestPlane> {
  const root = await mkdtemp(join(tmpdir(), 'formancy-data-studio-'))
  const store = createFileConfigurationStore(root)
  const databases = new Map<string, MetadataSnapshot>([
    ['fixture', OWNER_SNAPSHOT],
    ['fixture-reader', READER_SNAPSHOT],
    ['fixture-sqlserver', SQLSERVER_SNAPSHOT],
  ])
  const unreachable = new Set<string>()
  const removed = new Set<string>()
  const requests: TestPlane['requests'] = []
  let held: { path: RegExp; until: Promise<void> } | null = null

  const allowed = (id: string) => databases.has(id) && !removed.has(id)
  const registry: ConnectionRegistry = {
    ids: () => [...databases.keys()].filter(allowed).sort(),
    scope: (id) => (allowed(id) ? { schemas: [...OWNER_SNAPSHOT.scope.schemas] } : undefined),
    open: async (id) => {
      const now = databases.get(id)
      if (now === undefined || !allowed(id)) return undefined
      // The driver's message names a host and a port, as a real one does; the
      // server must not pass it on.
      if (unreachable.has(id)) throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
      const adapter: DatabaseAdapter = {
        kind: now.kind,
        ping: async () => ({ kind: now.kind, version: now.serverVersion }),
        discover: async () => databases.get(id) ?? now,
        close: async () => {},
      }
      // The administrator plane never touches a record or a lookup.
      return { adapter, lookups: {} as LookupAdapter, records: {} as RecordAdapter }
    },
    close: async () => {},
  }

  const app = await createDataServer({ verifyIdentity, admin: { registry, store, adminRoles: [ADMIN_ROLE] } })

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://studio.test')
    const method = (init?.method ?? 'GET').toUpperCase()
    requests.push({ method, path: url.pathname })
    if (held?.path.test(url.pathname) === true) await held.until
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value
    })
    const reply = await app.inject({
      method: method as 'GET' | 'POST',
      url: `${url.pathname}${url.search}`,
      headers,
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    })
    const answered = new Headers()
    for (const [name, value] of Object.entries(reply.headers)) {
      if (value !== undefined) answered.set(name, Array.isArray(value) ? value.join(', ') : String(value))
    }
    return new Response(reply.statusCode === 204 ? null : reply.body, { status: reply.statusCode, headers: answered })
  }

  return {
    fetch,
    databases,
    unreachable,
    removed,
    requests,
    hold: (path) => {
      let release = () => {}
      held = { path, until: new Promise<void>((resolve) => (release = resolve)) }
      return {
        release: () => {
          held = null
          release()
        },
      }
    },
    store,
    root,
    close: async () => {
      await app.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/**
 * A snapshot of `base` with one column of one table dropped, made the one way a
 * snapshot is made, so it carries a true fingerprint: the database after
 * somebody ran `alter table ... drop column`.
 */
export function withoutColumn(base: MetadataSnapshot, table: string, column: string): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(base)
  const object = contents.objects.find((candidate) => candidate.ref.name === table)
  if (object === undefined) throw new Error(`the snapshot has no ${table}`)
  object.columns = object.columns.filter((candidate) => candidate.name !== column)
  return createSnapshot(contents)
}
