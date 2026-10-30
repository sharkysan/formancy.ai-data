import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IdentityVerifier } from '@formancy/data-identity'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import type { DataServerOptions } from './app.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'

/*
 * Whom the server believes about a client's address (0071), through the
 * real server: the rate limiter's bucket and the log's `remoteAddress` are
 * the two things that address decides. The peer is set with inject's
 * `remoteAddress`, which is what Fastify reads as the socket's; the log's
 * port is read over a real socket, which inject's has none of.
 *
 * Every client here is a documentation address (RFC 5737, RFC 3849), and
 * every proxy a private one.
 */

const verifyIdentity: IdentityVerifier = async (token) => {
  if (token === 'admin') return { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } }
  if (token === 'good') return { ok: true, identity: { actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: 'acme' } } }
  return { ok: false, reason: 'bad' }
}

const PROXY = '10.0.0.2'
const ALICE = '198.51.100.7'
const BOB = '198.51.100.8'

interface Line {
  msg: string
  req?: { remoteAddress?: string; remotePort?: number }
}

let lines: Line[]
let written: string[]
let servers: FastifyInstance[]
let root: string

beforeEach(async () => {
  lines = []
  written = []
  servers = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-forwarded-'))
})

afterEach(async () => {
  for (const server of servers) await server.close()
  await rm(root, { recursive: true, force: true })
})

/** The server with a limit of two a minute, logging into `lines`. */
async function server(options: Partial<DataServerOptions> = {}): Promise<FastifyInstance> {
  const app = await createDataServer({
    verifyIdentity,
    rateLimit: { max: 2, timeWindowMs: 60_000 },
    logger: {
      stream: {
        write: (line: string) => {
          written.push(line)
          lines.push(JSON.parse(line) as Line)
        },
      },
    },
    ...options,
  })
  servers.push(app)
  return app
}

/** `GET /v1/whoami` with a refused token from `peer`, with `forwardedFor` as its X-Forwarded-For when given: each answer's status. */
async function statuses(app: FastifyInstance, requests: ReadonlyArray<{ peer: string; forwardedFor?: string }>): Promise<number[]> {
  const answers: number[] = []
  for (const { peer, forwardedFor } of requests) {
    const headers: Record<string, string> = { authorization: 'Bearer refused' }
    if (forwardedFor !== undefined) headers['x-forwarded-for'] = forwardedFor
    answers.push((await app.inject({ method: 'GET', url: '/v1/whoami', remoteAddress: peer, headers })).statusCode)
  }
  return answers
}

/** The address each `incoming request` line names. */
const logged = () => lines.filter((line) => line.msg === 'incoming request').map((line) => line.req?.remoteAddress)

describe('a proxy the operator names', () => {
  // The point of the setting: behind nginx every person arrives from nginx,
  // and one bucket for all of them lets one script refuse everybody. With
  // the proxy named, each address it forwards is a bucket of its own --
  // Alice spends hers and Bob still has his -- and the log names each of
  // them where it named the proxy. Watched failing against the server
  // before 0071, which ignored the option: Bob's request was 429.
  test('splits the limit by the address it forwards, and the log names each client', async () => {
    const app = await server({ trustedProxies: [PROXY] })
    expect(
      await statuses(app, [
        { peer: PROXY, forwardedFor: ALICE },
        { peer: PROXY, forwardedFor: ALICE },
        { peer: PROXY, forwardedFor: ALICE },
        { peer: PROXY, forwardedFor: BOB },
      ]),
    ).toEqual([401, 401, 429, 401])
    expect(logged()).toEqual([ALICE, ALICE, ALICE, BOB])
  })

  // The proxy appends the address it saw to whatever the client sent, so
  // only the rightmost address a trusted hop wrote is believed: what the
  // client put to the left of it is the client's own typing. Two hops, both
  // named -- nginx behind cloudflared, as the composed stack behind the
  // tunnel -- reach one further, and no further. Watched failing with
  // Fastify given `true`, which believed the leftmost address: each forged
  // one was a bucket of its own.
  test('believes only the address a trusted hop wrote, not what the client wrote to the left of it', async () => {
    const app = await server({ trustedProxies: [PROXY, '10.0.1.0/24'] })
    expect(
      await statuses(app, [
        { peer: PROXY, forwardedFor: `203.0.113.1, ${ALICE}` },
        { peer: PROXY, forwardedFor: `203.0.113.2, ${ALICE}` },
        { peer: PROXY, forwardedFor: `203.0.113.3, ${ALICE}, 10.0.1.5` },
      ]),
    ).toEqual([401, 401, 429])
    expect(logged()).toEqual([ALICE, ALICE, ALICE])
  })

  // A trusted proxy that passes a client's own header on without adding to
  // it, or writes an address with its port, leaves text at the place the
  // walk stops, and Fastify gives that text back as the address: a bucket
  // per request, and whatever the client typed in the log. Such a request
  // is counted and logged as its peer's, as without the setting. Watched
  // failing with request.ip used as it came: the limit was never reached,
  // and the typed text was logged. The log is searched for each value whole,
  // as the client typed it: a bare `4711` was found on CI inside a line's
  // `responseTime`, 0.3447110000000748, which no client typed. Watched
  // failing so on 2026-10-18 with `request.ip` logged as the address alone:
  // each of the three was found in its request's line.
  test('counts a forwarded value that is no address as the peer, and logs none of it', async () => {
    const app = await server({ trustedProxies: [PROXY] })
    const typed = ['S3cret-pw-e81', `${ALICE}:4711`, 'unknown']
    expect(
      await statuses(
        app,
        typed.map((forwardedFor) => ({ peer: PROXY, forwardedFor })),
      ),
    ).toEqual([401, 401, 429])
    expect(logged()).toEqual([PROXY, PROXY, PROXY])
    expect(written.filter((line) => typed.some((value) => line.includes(value)))).toEqual([])
  })

  // The limiter counts an IPv6 client by its /64, which @fastify/rate-limit
  // does by default, since one host is commonly given a whole /64 and could
  // otherwise take a new address, and a new bucket, per request. Forwarded
  // addresses keep that. And a list matches a peer in either spelling a
  // socket reports: an IPv4 proxy on a dual-stack listener arrives as
  // ::ffff:10.0.0.2, and is the 10.0.0.2 the operator wrote. Watched failing
  // with the forwarded address used as the key unmasked: the second /64
  // address was a bucket of its own.
  test('keeps an IPv6 client to its /64, and matches an IPv4 proxy reported as IPv4-mapped', async () => {
    const app = await server({ trustedProxies: [PROXY, '2001:db8::/64'] })
    expect(
      await statuses(app, [
        { peer: `::ffff:${PROXY}`, forwardedFor: '2001:db8:aaaa::1' },
        { peer: '2001:db8::5', forwardedFor: '2001:db8:aaaa::2' },
        { peer: PROXY, forwardedFor: '2001:db8:aaaa:0:ffff::3' },
        { peer: PROXY, forwardedFor: '2001:db8:bbbb::1' },
      ]),
    ).toEqual([401, 401, 429, 401])
    expect(logged()).toEqual(['2001:db8:aaaa::1', '2001:db8:aaaa::2', '2001:db8:aaaa:0:ffff::3', '2001:db8:bbbb::1'])
  })

  // An embedder's list is held to the setting's rule before anything is
  // built, as main.ts holds the variable: `*` would let every client choose
  // its own bucket. An empty list trusts nothing.
  test('createDataServer refuses a list nobody could have meant, by place, and takes an empty one', async () => {
    await expect(createDataServer({ verifyIdentity, trustedProxies: [PROXY, '*'] })).rejects.toThrow(/^trustedProxies\[1\] trusts every peer/)
    await expect(createDataServer({ verifyIdentity, trustedProxies: ['10.0.0.5/24'] })).rejects.toThrow(/^trustedProxies\[0\] has bits set past its prefix/)
    const app = await server({ trustedProxies: [] })
    expect(
      await statuses(app, [
        { peer: PROXY, forwardedFor: ALICE },
        { peer: PROXY, forwardedFor: BOB },
        { peer: PROXY, forwardedFor: '203.0.113.1' },
      ]),
    ).toEqual([401, 401, 429])
  })
})

describe('a peer the operator does not name', () => {
  // Unset is every release before 0071: X-Forwarded-For is anybody's to
  // send, so it changes nothing -- one bucket for the peer, and the peer's
  // address in the log, whatever the header says. Watched failing with
  // Fastify given `true` whatever the list.
  test('with no list, a forged X-Forwarded-For changes neither the bucket nor the log', async () => {
    const app = await server()
    expect(
      await statuses(app, [
        { peer: PROXY, forwardedFor: ALICE },
        { peer: PROXY, forwardedFor: BOB },
        { peer: PROXY, forwardedFor: '203.0.113.1' },
      ]),
    ).toEqual([401, 401, 429])
    expect(logged()).toEqual([PROXY, PROXY, PROXY])
  })

  // A client that reaches the server directly, past the proxy -- on Linux,
  // any local process can, at the container's address -- and sends the
  // header a proxy would, naming the proxy as its last hop, is not the
  // proxy: the list is asked about the peer that connected, not about what
  // the header says. Watched failing with every peer trusted: each forged
  // address was a bucket of its own.
  test('a peer not in the list is not believed, whatever its header names', async () => {
    const app = await server({ trustedProxies: [PROXY] })
    const direct = '10.0.0.9'
    expect(
      await statuses(app, [
        { peer: direct, forwardedFor: `${ALICE}, ${PROXY}` },
        { peer: direct, forwardedFor: `${BOB}, ${PROXY}` },
        { peer: direct, forwardedFor: ALICE },
      ]),
    ).toEqual([401, 401, 429])
    expect(logged()).toEqual([direct, direct, direct])
  })
})

/** One request over a real socket from 127.0.0.1, with `headers`. */
function send(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: '/v1/whoami', headers, agent: false }, (incoming) => {
      incoming.resume()
      incoming.on('end', () => resolve(incoming.statusCode ?? 0))
      incoming.on('error', reject)
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

describe("the log's address and port", () => {
  // The port in the log is the socket's: beside a forwarded address it is
  // the proxy's connection, not the client's, and a line naming the client
  // with the proxy's port says something false. So a believed address is
  // logged alone, and the peer's with its port as before. Watched failing
  // with the port kept for a forwarded address.
  test("names a believed client without the proxy's port, and the peer with its own", async () => {
    const trusting = await server({ trustedProxies: ['127.0.0.1'] })
    await trusting.listen({ port: 0, host: '127.0.0.1' })
    expect(await send((trusting.server.address() as AddressInfo).port, { 'x-forwarded-for': ALICE })).toBe(401)
    const plain = await server()
    await plain.listen({ port: 0, host: '127.0.0.1' })
    expect(await send((plain.server.address() as AddressInfo).port, { 'x-forwarded-for': ALICE })).toBe(401)
    const requests = lines.filter((line) => line.msg === 'incoming request').map((line) => line.req)
    expect(requests).toEqual([
      { method: 'GET', route: '/v1/whoami', remoteAddress: ALICE },
      { method: 'GET', route: '/v1/whoami', remoteAddress: '127.0.0.1', remotePort: expect.any(Number) as unknown },
    ])
  })
})

/** The allowlist knows `erp` and opens nothing. */
const registry = (): ConnectionRegistry => ({
  ids: () => ['erp'],
  scope: (id) => (id === 'erp' ? { schemas: ['sales'] } : undefined),
  open: async () => undefined,
  close: async () => {},
})

describe('X-Forwarded-Host and X-Forwarded-Proto', () => {
  // Trusting a proxy also makes Fastify's request.host and request.protocol
  // follow the X-Forwarded-Host and X-Forwarded-Proto it passes on -- nginx
  // passes on whatever a client sent -- and nothing in this server reads
  // either: the cross-origin rule compares Origin byte for byte with the
  // list and reads Sec-Fetch-Site (0060), never the Host or the scheme. So
  // every kind of answer, from both planes, the cross-origin rule and the
  // limiter's headers aside, is the same with a forged host and scheme as
  // without. A change that starts reading either would differ here. Watched
  // failing with a scratch onSend hook echoing request.host in a header.
  test('change no answer, from a trusted proxy', async () => {
    const store = createFileConfigurationStore(root)
    const app = await server({
      rateLimit: { max: 1000, timeWindowMs: 60_000 },
      trustedProxies: [PROXY],
      admin: { registry: registry(), store, adminRoles: ['data-admin'], audit: { sink: () => {} } },
      runtime: { registry: registry(), store, origins: ['https://app.example'] },
    })
    const listed = { origin: 'https://app.example' }
    const requests = [
      ['GET', '/health', {}],
      ['GET', '/v1/whoami', { authorization: 'Bearer good' }],
      ['GET', '/v1/whoami', {}],
      ['OPTIONS', '/v1/forms/employee', { ...listed, 'access-control-request-method': 'GET' }],
      ['OPTIONS', '/v1/forms/employee', { origin: 'https://other.example', 'access-control-request-method': 'GET' }],
      ['GET', '/v1/forms/employee', listed],
      ['GET', '/v1/forms/employee', { ...listed, authorization: 'Bearer good', 'sec-fetch-site': 'cross-site' }],
      ['GET', '/v1/forms/employee', { origin: 'https://other.example', authorization: 'Bearer good', 'sec-fetch-site': 'cross-site' }],
      ['GET', '/v1/connections', { authorization: 'Bearer admin' }],
      ['GET', '/v1/connections', { ...listed, authorization: 'Bearer admin', 'sec-fetch-site': 'cross-site' }],
      ['GET', '/v1/nothing', {}],
    ] as const
    const answer = async (method: 'GET' | 'OPTIONS', url: string, headers: Record<string, string>) => {
      const response = await app.inject({ method, url, remoteAddress: PROXY, headers: { 'x-forwarded-for': ALICE, ...headers } })
      const kept = Object.fromEntries(Object.entries(response.headers).filter(([name]) => name !== 'date' && !name.startsWith('x-ratelimit-')))
      return { status: response.statusCode, headers: kept, body: response.body }
    }
    for (const [method, url, headers] of requests) {
      const plain = await answer(method, url, headers)
      const forged = await answer(method, url, { ...headers, 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https' })
      expect({ method, url, ...forged }).toEqual({ method, url, ...plain })
    }
    expect(new Set(logged())).toEqual(new Set([ALICE]))
  })
})
