import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import type { ConfigurationStore } from './config-store.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'
import type { IdentityVerifier } from './identity.js'
import { servedPlanes } from './planes.js'

/*
 * What the runnable server writes to its log: Fastify's line for every
 * request, and both planes' audit events, on one stream (0033). Whoever runs
 * the collector reads all of it, so what a caller typed -- a path, a query, a
 * Host header -- is not in it: anybody who can reach the port, token or none,
 * could otherwise put a connection string, password and host included, into
 * the operator's log one line above the audit event that leaves it out.
 */

const HOST = '10.0.0.5'
const PASSWORD = 'S3cret-pw-e81'

const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'admin' ? { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } } : { ok: false, reason: 'bad' }

/** The allowlist knows `erp` and opens nothing: no request here gets as far as a database. */
const registry = (): ConnectionRegistry => ({ ids: () => ['erp'], scope: (id) => (id === 'erp' ? { schemas: ['sales'] } : undefined), open: async () => undefined, close: async () => {} })

let root: string
let store: ConfigurationStore
let lines: Array<{ msg: string; req?: unknown; audit?: { plane: string; operation: string } }>
let written: string[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'formancy-data-server-log-'))
  store = createFileConfigurationStore(root)
  written = []
  lines = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** The server as `main.ts` composes it -- both planes from `servedPlanes`, the audit sink its log -- writing to this suite. */
async function runnable(adminRoles: readonly string[] = ['data-admin']): Promise<FastifyInstance> {
  let app: FastifyInstance | undefined
  const planes = servedPlanes({ registry: registry(), store, adminRoles, auditKey: undefined, log: () => (app as FastifyInstance).log })
  app = await createDataServer({
    verifyIdentity,
    logger: {
      stream: {
        write: (line: string) => {
          written.push(line)
          lines.push(JSON.parse(line) as (typeof lines)[number])
        },
      },
    },
    ...planes,
  })
  return app
}

describe("the runnable server's log", () => {
  // Every request Fastify logs, it logs by the route that answered, not the
  // path that was sent: a path parameter, a query and the Host header are
  // whatever the caller typed. Fastify's default writes the URL as sent and
  // the Host header into `incoming request`, and a 404's path into its own
  // line, so each of these put a password and a host in the log. Encoded,
  // as a client would send them, the paths are not plain and are refused
  // before any route's work (0037), and one whose escape does not decode is
  // the router's own 400; so the same text is also sent raw, where nothing
  // needs encoding, with an administrator's token: those reach the routes'
  // handlers, and what they log is held here too.
  test('names the route a request matched, and never the path, the query or the Host it was sent with', async () => {
    const server = await runnable()
    const address = encodeURIComponent(`postgres://sa:${PASSWORD}@${HOST}:5432/erp`)
    const forged = encodeURIComponent(`Server=${HOST};Password=${PASSWORD}`)
    const raw = `Server=${HOST};Password=${PASSWORD}`
    const admin = { authorization: 'Bearer admin' }
    const answers: string[] = []
    for (const [method, url, headers] of [
      ['POST', `/v1/connections/${address}/test`, {}],
      ['GET', `/v1/connections?password=${PASSWORD}`, {}],
      ['GET', `/v1/connections/${address}/metadata`, admin],
      ['POST', `/v1/forms/${forged}/records/read`, {}],
      ['POST', `/v1/forms/employee/lookups/${address}/query`, {}],
      ['GET', `/v1/${address}/nothing`, {}],
      ['POST', `/v1/forms/${address}%E0/versions`, {}],
      ['POST', `/v1/connections/${raw}/test`, admin],
      ['GET', `/v1/connections/${raw}/metadata`, admin],
      ['POST', `/v1/forms/${raw}/records/read`, admin],
      ['POST', `/v1/forms/employee/lookups/${raw}/query`, admin],
      ['GET', `/v1/${raw}/nothing`, admin],
    ] as const) {
      const answer = await server.inject({ method, url, headers: { host: HOST, ...headers } })
      answers.push(`${String(answer.statusCode)} ${String((answer.json() as { code?: unknown }).code)}`)
    }
    expect(answers).toEqual([
      '400 path-not-plain',
      '401 unauthenticated',
      '400 path-not-plain',
      '400 path-not-plain',
      '400 path-not-plain',
      '400 path-not-plain',
      '400 FST_ERR_BAD_URL',
      '404 unknown-connection',
      '404 unknown-connection',
      '400 invalid-request',
      '400 invalid-request',
      '404 undefined',
    ])
    expect(written.filter((line) => line.includes(PASSWORD) || line.includes(HOST))).toEqual([])
    expect(lines.filter((line) => line.msg === 'incoming request').map((line) => line.req)).toEqual([
      expect.objectContaining({ method: 'POST', route: '/v1/connections/:id/test' }),
      expect.objectContaining({ method: 'GET', route: '/v1/connections' }),
      expect.objectContaining({ method: 'GET', route: '/v1/connections/:id/metadata' }),
      expect.objectContaining({ method: 'POST', route: '/v1/forms/:id/records/read' }),
      expect.objectContaining({ method: 'POST', route: '/v1/forms/:id/lookups/:source/query' }),
      expect.objectContaining({ method: 'GET', route: null }),
      expect.objectContaining({ method: 'POST', route: '/v1/connections/:id/test' }),
      expect.objectContaining({ method: 'GET', route: '/v1/connections/:id/metadata' }),
      expect.objectContaining({ method: 'POST', route: '/v1/forms/:id/records/read' }),
      expect.objectContaining({ method: 'POST', route: '/v1/forms/:id/lookups/:source/query' }),
      expect.objectContaining({ method: 'GET', route: null }),
    ])
  })

  // One sink for both planes, the server's own log: the collector picks the
  // trail out by `msg: 'audit'` and tells the planes apart by `audit.plane`.
  // A plane wired to another sink, or to none, leaves its line out here.
  // The administrator's plane is on only when roles administer it.
  test('writes both planes\' events to the same log, told apart by plane', async () => {
    const server = await runnable()
    await server.inject({ method: 'GET', url: '/v1/forms/employee' })
    await server.inject({ method: 'GET', url: '/v1/forms/employee/versions' })
    expect(lines.filter((line) => line.msg === 'audit').map((line) => ({ plane: line.audit?.plane, operation: line.audit?.operation }))).toEqual([
      { plane: 'runtime', operation: 'form' },
      { plane: 'admin', operation: 'version-list' },
    ])
    expect(servedPlanes({ registry: registry(), store, adminRoles: [], auditKey: undefined, log: () => server.log }).admin).toBeUndefined()
  })
})
