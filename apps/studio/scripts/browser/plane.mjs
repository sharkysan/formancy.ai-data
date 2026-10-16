// The studio gate's planes: the real server, as the suite runs it -- the
// captured databases behind a fake registry, a store on a temporary
// directory, literal tokens. One plane as most deployments run, where every
// administrator publishes; and one under review (0065), as
// FORMANCY_DATA_PUBLISHER_ROLES=data-publisher starts it, where an author
// submits a draft and a publisher who did not submit it approves it.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataServer, createFileConfigurationStore } from '@formancy/data-server'
import { APP } from './serve.mjs'

/** `admin` is an administrator, and under review an author; `publisher` holds the publisher role alone. */
export const TOKENS = { admin: 'browser-gate-administrator', publisher: 'browser-gate-publisher' }

export const snapshot = (name) => JSON.parse(readFileSync(join(APP, 'src', 'fixtures', name), 'utf8'))

const IDENTITIES = new Map([
  [TOKENS.admin, { actor: { id: 'ada', roles: ['data-admin'] }, attributes: { tenant: '1' } }],
  [TOKENS.publisher, { actor: { id: 'grace', roles: ['data-publisher'] }, attributes: { tenant: '1' } }],
])

/**
 * A plane; `review: true` puts publication under review. `databases` is
 * mutable so a run can drift one.
 */
export async function startPlane({ review = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'formancy-data-studio-gate-'))
  const databases = new Map([
    ['fixture', snapshot('postgres-owner.json')],
    ['fixture-reader', snapshot('postgres-reader.json')],
    ['fixture-sqlserver', snapshot('sqlserver-owner.json')],
    ['fixture-sqlserver-reader', snapshot('sqlserver-reader.json')],
    ['fixture-writer', snapshot('postgres-writer.json')],
  ])
  const registry = {
    ids: () => [...databases.keys()].sort(),
    scope: (id) => (databases.has(id) ? { schemas: ['sales'] } : undefined),
    open: async (id) => {
      const now = databases.get(id)
      if (now === undefined) return undefined
      const adapter = { kind: now.kind, ping: async () => ({ kind: now.kind, version: now.serverVersion }), discover: async () => databases.get(id), close: async () => {} }
      return { adapter, lookups: {}, records: {} }
    },
    close: async () => {},
  }
  const verifyIdentity = async (token) => (IDENTITIES.has(token) ? { ok: true, identity: IDENTITIES.get(token) } : { ok: false, reason: 'ERR_JWS_INVALID' })
  // The administrator's trail is the server's suites' subject; here it is required and discarded.
  const audit = { sink: () => {} }
  const store = createFileConfigurationStore(root)
  const admin = review
    ? { registry, store, adminRoles: ['data-admin', 'data-publisher'], publisherRoles: ['data-publisher'], audit }
    : { registry, store, adminRoles: ['data-admin'], audit }
  const server = await createDataServer({ verifyIdentity, admin })
  return {
    server,
    databases,
    root,
    close: async () => {
      await server.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}
