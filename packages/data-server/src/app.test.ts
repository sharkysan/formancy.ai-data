import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDataServer } from './app.js'
import type { DataServerOptions } from './app.js'
import type { AuditEvent } from './audit.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'
import type { IdentityVerifier } from './identity.js'
import { PATH_NOT_PLAIN } from './paths.js'

/**
 * A verifier that accepts one literal token. The real one has its own suite;
 * what is under test here is what the HTTP layer does with each outcome.
 */
const verifyIdentity: IdentityVerifier = async (token) =>
  token === 'good'
    ? { ok: true, identity: { actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: 'acme' } } }
    : { ok: false, reason: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }

describe('the data server', () => {
  // A container orchestrator needs a route that answers without credentials.
  test('health answers without a token', async () => {
    const app = await createDataServer({ verifyIdentity })
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  // The person wiring a host in sees exactly the identity the server derived.
  test('whoami returns the verified identity', async () => {
    const app = await createDataServer({ verifyIdentity })
    const response = await app.inject({ method: 'GET', url: '/v1/whoami', headers: { authorization: 'Bearer good' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: 'acme' } })
  })

  // No token, a bad token, and a header that is not a bearer token are all the
  // same answer: 401, with the scheme named, and no detail an attacker could use.
  test('whoami refuses a missing, bad or malformed token with 401', async () => {
    const app = await createDataServer({ verifyIdentity })
    for (const headers of [{}, { authorization: 'Bearer bad' }, { authorization: 'Basic dTpw' }, { authorization: 'Bearer a b' }]) {
      const response = await app.inject({ method: 'GET', url: '/v1/whoami', headers })
      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
      expect(response.json()).toEqual({ code: 'unauthenticated', message: 'A valid host token is required.' })
    }
  })

  // Every token presented is a signature check. Without a limit, a client can
  // replay forgeries at the verifier as fast as the network allows. /health is
  // exempt, because an orchestrator polling it must not see a busy server as dead.
  test('limits requests per client, except health', async () => {
    const app = await createDataServer({ verifyIdentity, rateLimit: { max: 2, timeWindowMs: 60_000 } })
    const statuses: number[] = []
    for (let n = 0; n < 3; n += 1) {
      statuses.push((await app.inject({ method: 'GET', url: '/v1/whoami', headers: { authorization: 'Bearer bad' } })).statusCode)
    }
    expect(statuses).toEqual([401, 401, 429])
    for (let n = 0; n < 5; n += 1) expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
  })

  // The routes the plan describes and this release does not have must not
  // answer as if they did.
  test('a route that does not exist yet is a 404, not a placeholder', async () => {
    const app = await createDataServer({ verifyIdentity })
    const response = await app.inject({ method: 'POST', url: '/v1/forms/x/records/read', headers: { authorization: 'Bearer good' } })
    expect(response.statusCode).toBe(404)
  })
})

/*
 * Over a real socket, because light-my-request builds its URL with WHATWG
 * `URL`, which resolves `.` and `..` and turns a backslash into a slash
 * before the router sees the path: `inject('/v1/forms/x/../connections')`
 * arrives as `/v1/forms/connections`. A suite that injected these paths
 * would be testing the test's own normalisation, not the server's.
 */

interface Answer {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

let servers: FastifyInstance[]
let root: string
let asked: string[]
let events: AuditEvent[]

beforeEach(async () => {
  servers = []
  asked = []
  events = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-app-'))
})

afterEach(async () => {
  for (const server of servers) await server.close()
  await rm(root, { recursive: true, force: true })
})

/** Asked of every token presented, so a test can see whether any route's work began: a plane's first work is reading the token. */
const counting: IdentityVerifier = async (token) => {
  asked.push(token)
  if (token === 'admin') return { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } }
  return verifyIdentity(token)
}

/** The allowlist knows `erp` and opens nothing. */
const registry = (): ConnectionRegistry => ({ ids: () => ['erp'], scope: (id) => (id === 'erp' ? { schemas: ['sales'] } : undefined), open: async () => undefined, close: async () => {} })

/** Both planes, as main.ts serves them, auditing into `events`; listening on a free loopback port. */
async function listening(overrides: Partial<DataServerOptions> = {}): Promise<number> {
  const store = createFileConfigurationStore(root)
  const audit = { sink: (event: AuditEvent) => void events.push(event) }
  const server = await createDataServer({
    verifyIdentity: counting,
    admin: { registry: registry(), store, adminRoles: ['data-admin'], audit },
    runtime: { registry: registry(), store, audit },
    ...overrides,
  })
  servers.push(server)
  await server.listen({ port: 0, host: '127.0.0.1' })
  return (server.server.address() as AddressInfo).port
}

/** One request with its target exactly as written, on a connection of its own. */
function send(port: number, method: string, target: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method, path: target, headers, agent: false }, (incoming) => {
      let body = ''
      incoming.setEncoding('utf8')
      incoming.on('data', (chunk: string) => (body += chunk))
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }))
      incoming.on('error', reject)
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

const admin = { authorization: 'Bearer admin' }

describe('a path a proxy could read differently (0037)', () => {
  // cloudflared 2026.10.0 matched each of these as a runtime route, after
  // decoding, resolving dot segments and collapsing slashes, while Fastify
  // routes the path as sent: the first five reach administrator routes there,
  // the backslash one too. Each is refused before any route's work, so a
  // door that forwards only the runtime plane forwards nothing that runs an
  // administrator's handler. An administrator's token is sent with each, and
  // the verifier is never asked: no plane began. A path that matched a route
  // of a plane is still that plane's one event, by its status (0033); one no
  // route matches has none, as a 404 has none.
  test('is answered 400 path-not-plain, and no route of either plane runs for it', async () => {
    const port = await listening()
    const paths = [
      ['POST', '/v1/connections/..%2Fforms/test', 'connection-test'],
      ['GET', '/v1/connections/..%2Fforms/metadata', 'discovery'],
      ['GET', '/v1/forms/x%2F../versions', 'version-list'],
      ['GET', '/v1/forms/a/versions/..%2F..%2Fb', 'version-read'],
      ['GET', '/v1/forms/a/versions/..%5C..%5Cb', 'version-read'],
      ['GET', '/v1/forms/a/versions/..\\..\\b', 'version-read'],
      ['GET', '/v1/forms/a%2Frecords%2Fread', 'form'],
      ['GET', '/v1/forms/a%252Fb', 'form'],
      ['GET', '/v1/forms/a/versions/%2E%2E/%2E%2E/b', null],
      ['GET', '/v1/forms/x/../versions', null],
      ['POST', '/v1/forms/a/./records/read', null],
      ['POST', '/v1/forms/a//records/read', null],
      ['GET', '/v1/whoami/', null],
    ] as const
    for (const [method, target] of paths) {
      const answer = await send(port, method, target, admin)
      expect({ target, status: answer.status, body: JSON.parse(answer.body) as unknown }).toEqual({ target, status: 400, body: PATH_NOT_PLAIN })
    }
    expect(asked).toEqual([])
    const routed = paths.flatMap(([, , operation]) => (operation === null ? [] : [operation]))
    await vi.waitFor(() => expect(events).toHaveLength(routed.length))
    expect(events.map(({ operation, actor, status, outcome }) => ({ operation, actor, status, outcome }))).toEqual(
      routed.map((operation) => ({ operation, actor: null, status: 400, outcome: 'path-not-plain' })),
    )
  })

  // A refusal is a request like any other to the limiter: otherwise a
  // script could send these as fast as the network allows, each one an
  // audit event when it names a route, and never be slowed.
  test('is counted by the rate limiter, and refused by it once over the limit', async () => {
    const port = await listening({ rateLimit: { max: 2, timeWindowMs: 60_000 } })
    const statuses: number[] = []
    for (const target of ['/v1/forms/a/versions/..%2F..%2Fb', '/v1/forms/x/../versions', '/v1/whoami', '/v1/forms/a%2Fb']) {
      statuses.push((await send(port, 'GET', target, admin)).status)
    }
    expect(statuses).toEqual([400, 400, 429, 429])
  })
})

describe('every answer says no-store (0037)', () => {
  // A form id may end in `.js` or `.css`, which a CDN caches by extension,
  // and a cache that ignores Authorization would then hand one person's form
  // or record to the next. `no-store` is the origin saying never, whatever
  // the cache's own rules; it also keeps forms out of a shared machine's
  // browser cache. Every kind of answer: a success, a refusal by a route,
  // by a plane, by the limiter, by Fastify's body parser and by the 404
  // handler, and this change's own 400.
  test('a success, a refusal and every error carry cache-control: no-store', async () => {
    const port = await listening()
    const limited = await listening({ rateLimit: { max: 1, timeWindowMs: 60_000 } })
    await send(limited, 'GET', '/v1/whoami')
    const answers = [
      [port, 'GET', '/health', {}, 200],
      [port, 'HEAD', '/health', {}, 200],
      [port, 'GET', '/v1/whoami', { authorization: 'Bearer good' }, 200],
      [port, 'GET', '/v1/whoami', {}, 401],
      [port, 'GET', '/v1/connections', admin, 200],
      [port, 'GET', '/v1/connections', { authorization: 'Bearer good' }, 403],
      [port, 'GET', '/v1/forms/order.js', { authorization: 'Bearer good' }, 404],
      [port, 'POST', '/v1/forms/order/records/read', { ...admin, 'content-type': 'application/json' }, 400],
      [port, 'GET', '/v1/nothing', {}, 404],
      [port, 'GET', '/v1/forms/a%2Fb', {}, 400],
      [limited, 'GET', '/v1/whoami', {}, 429],
    ] as const
    const seen = []
    for (const [to, method, target, headers, status] of answers) {
      const answer = await send(to, method, target, headers)
      expect(answer.status, `${method} ${target}`).toBe(status)
      seen.push({ method, target, status, cacheControl: answer.headers['cache-control'] })
    }
    expect(seen.filter((answer) => answer.cacheControl !== 'no-store')).toEqual([])
  })

  // The exception the README states, held so it cannot quietly become
  // false either way: what the router answers itself -- an escape that does
  // not decode, a parameter past its length -- is written before any hook,
  // so it carries no Cache-Control and is the router's 400, not
  // path-not-plain, and the limiter does not count it. Neither runs a route
  // or names a form. A Fastify that ran hooks for these would fail here, and
  // the README would be updated.
  test("the router's own refusals run no hook, as the README says", async () => {
    const port = await listening({ rateLimit: { max: 1, timeWindowMs: 60_000 } })
    const undecodable = await send(port, 'POST', '/v1/forms/%E0/versions', admin)
    const tooLong = await send(port, 'GET', `/v1/forms/e${'x'.repeat(128)}/versions/latest`, admin)
    expect([undecodable, tooLong].map(({ status, headers, body }) => ({ status, cacheControl: headers['cache-control'], code: (JSON.parse(body) as { code: string }).code }))).toEqual([
      { status: 400, cacheControl: undefined, code: 'FST_ERR_BAD_URL' },
      { status: 414, cacheControl: undefined, code: 'FST_ERR_MAX_PARAM_LENGTH' },
    ])
    expect(asked).toEqual([])
    expect((await send(port, 'GET', '/v1/whoami')).status).toBe(401)
  })
})
