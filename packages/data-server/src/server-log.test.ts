import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_LOOKUP_DEADLINE_MS } from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import type { ConfigurationStore } from './config-store.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'
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
let lines: Array<{ msg: string; req?: unknown; audit?: { plane: string; operation: string }; reason?: string; origin?: string }>
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

/** The server as `main.ts` composes it -- both planes from `servedPlanes`, the audit sink its log, an origin listed, review when publisher roles are given -- writing to this suite. */
async function runnable(adminRoles: readonly string[] = ['data-admin'], origins: readonly string[] = ['https://app.example'], publisherRoles?: readonly string[]): Promise<FastifyInstance> {
  let app: FastifyInstance | undefined
  const planes = servedPlanes({ registry: registry(), store, adminRoles, publisherRoles, auditKey: undefined, origins, lookupDeadlineMs: DEFAULT_LOOKUP_DEADLINE_MS, log: () => (app as FastifyInstance).log })
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
    expect(servedPlanes({ registry: registry(), store, adminRoles: [], auditKey: undefined, origins: [], lookupDeadlineMs: DEFAULT_LOOKUP_DEADLINE_MS, log: () => server.log }).admin).toBeUndefined()
  })
  // Review is the operator's choice, read once by main.ts and handed to the
  // administrator's plane by servedPlanes (0065). Dropped on the way, the
  // deployment would let one administrator publish alone while its
  // operator set FORMANCY_DATA_PUBLISHER_ROLES to stop exactly that; the
  // refusal is in the same log as every other event, by its code. Unset,
  // the plane says review is off. Watched failing with servedPlanes
  // leaving publisherRoles out.
  test('puts the administrator plane under review when publisher roles are set, and not otherwise', async () => {
    const reviewed = await runnable(['data-admin', 'data-publisher'], [], ['data-publisher'])
    expect((await reviewed.inject({ method: 'GET', url: '/v1/administration', headers: { authorization: 'Bearer admin' } })).json()).toMatchObject({ review: true, publisher: false })
    const refused = await reviewed.inject({ method: 'POST', url: '/v1/forms/employee/versions', headers: { authorization: 'Bearer admin' }, payload: { expectedBase: null } })
    expect([refused.statusCode, (refused.json() as { code: string }).code]).toEqual([403, 'review-required'])
    expect(lines.filter((line) => line.msg === 'audit').map((line) => ({ operation: line.audit?.operation, outcome: (line.audit as { outcome?: string } | undefined)?.outcome }))).toEqual([
      { operation: 'administration', outcome: 'ok' },
      { operation: 'publish', outcome: 'review-required' },
    ])
    const plain = await runnable()
    expect((await plain.inject({ method: 'GET', url: '/v1/administration', headers: { authorization: 'Bearer admin' } })).json()).toEqual({ review: false, publisher: true, refuses: { browse: { code: 'browse-role-required', message: "Reading a connection's rows needs a browse role, which this deployment gives to nobody or not to you." } } })
    expect(servedPlanes({ registry: registry(), store, adminRoles: [], publisherRoles: ['data-publisher'], auditKey: undefined, origins: [], lookupDeadlineMs: DEFAULT_LOOKUP_DEADLINE_MS, log: () => plain.log }).admin).toBeUndefined()
  })

  // A refused preflight is a plain network error to the page that sent it,
  // so the log is the only place that says why, and names the origin to
  // list (0060). But an Origin header is whatever the caller typed: one
  // holding a password and a host in its user information, its path or its
  // query is logged with no origin at all. An origin is named only as a
  // browser sends one, which the URL parser gives back unchanged and which
  // holds none of those, on both lines: the refused preflight and the
  // token-bearing request refused across origins. Watched failing with the
  // header logged as received.
  test('names a refused origin only as a browser sends one, and never what was typed around it', async () => {
    const server = await runnable()
    const typed = [`https://user:${PASSWORD}@${HOST}`, `https://${HOST}/${PASSWORD}`, `https://${HOST}?password=${PASSWORD}`, `https://${HOST}:${PASSWORD}`]
    for (const origin of [...typed, 'https://other.example']) {
      const preflight = await server.inject({ method: 'OPTIONS', url: '/v1/forms/employee', headers: { origin, 'access-control-request-method': 'GET' } })
      const riding = await server.inject({ method: 'GET', url: '/v1/forms/employee', headers: { origin, 'sec-fetch-site': 'cross-site', authorization: 'Bearer admin' } })
      expect([preflight.statusCode, riding.statusCode]).toEqual([403, 403])
    }
    expect(written.filter((line) => line.includes(PASSWORD) || line.includes(HOST))).toEqual([])
    const refusals = lines.filter((line) => line.msg === 'preflight refused' || line.msg === 'cross-origin request refused').map(({ msg, reason, origin }) => ({ msg, reason, origin }))
    expect(refusals).toEqual([
      ...typed.flatMap(() => [
        { msg: 'preflight refused', reason: 'origin not listed', origin: undefined },
        { msg: 'cross-origin request refused', reason: 'origin not listed', origin: undefined },
      ]),
      { msg: 'preflight refused', reason: 'origin not listed', origin: 'https://other.example' },
      { msg: 'cross-origin request refused', reason: 'origin not listed', origin: 'https://other.example' },
    ])
  })
})
