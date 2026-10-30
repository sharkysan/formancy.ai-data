import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CROSS_ORIGIN_REQUEST_HEADERS, createSnapshot, generateForm } from '@formancy/data-core'
import type { ColumnMeta, FormPolicy, NormalizedType } from '@formancy/data-core'
import type { IdentityVerifier } from '@formancy/data-identity'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDataServer } from './app.js'
import type { AuditEvent } from './audit.js'
import type { PublishedBundle } from './bundle.js'
import type { ConfigurationStore } from './config-store.js'
import { CONFIGURATION_ID_MAX_LENGTH, createFileConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'
import { crossOrigin, PREFLIGHT_MAX_AGE_SECONDS } from './cors.js'
import { ADMIN_OPERATIONS } from './routes/admin-audit.js'
import { ROUTE_OPERATIONS } from './routes/runtime.js'

/*
 * Across origins (0060), over the real server with both planes, both audit
 * sinks, a verifier and a registry that count what they are asked, and the
 * server's log. What is under test is the HTTP layer's decision: which
 * preflight is granted, which answer carries an origin back, and which
 * token-bearing request a browser marks cross-site is refused before its
 * token is read. A browser's own part -- that it sends the preflight, honours
 * the grant and reuses it -- is the host page's browser gate's, which needs
 * a page on another origin (0060, PR 3).
 */

const LISTED = 'https://app.example'
const OTHER = 'https://other.example'
const BOTH_HEADERS = 'authorization,content-type,formancy-write-id'

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const TEXT: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name,
  ordinal,
  databaseType: type.kind,
  type,
  nullable: false,
  hasDefault: false,
  defaultExpression: null,
  generated: 'none',
  comment: null,
  access: { select: true, insert: true, update: true },
  ...extra,
})
const SNAPSHOT = createSnapshot({
  kind: 'sqlserver',
  serverVersion: '16.0',
  account: { user: 'dbo', login: 'sa' },
  scope: { schemas: ['sales'] },
  gaps: [],
  objects: [
    {
      ref: { schema: 'sales', name: 'employee' },
      kind: 'table',
      comment: null,
      columns: [col('id', 1, INT32), col('name', 2, TEXT), col('row_version', 3, { kind: 'rowversion' }, { generated: 'rowversion' })],
      primaryKey: { name: 'pk_employee', columns: ['id'] },
      uniqueKeys: [],
      foreignKeys: [],
      checks: [],
      rowSecurity: 'none',
    },
  ],
})
const RW = { read: ['clerk'], write: ['clerk'] }
const POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { id: RW, name: RW },
  rowFilters: [],
  lookups: {},
}
const UPDATE = { record: 'k1:1', version: '00000000000007d1', answers: { id: 1, name: 'Muster' } }

/** Every token presented is counted: a plane's first work is reading the token, so none counted means none began. */
let asked: string[]
const verifyIdentity: IdentityVerifier = async (token) => {
  asked.push(token)
  if (token === 'admin') return { ok: true, identity: { actor: { id: 'a', roles: ['data-admin'] }, attributes: {} } }
  if (token === 'clerk') return { ok: true, identity: { actor: { id: 'c', roles: ['clerk'] }, attributes: {} } }
  return { ok: false, reason: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }
}

/** The allowlist knows `erp`; every connection asked for is counted, and none opens, so a served write ends at 500 unknown-connection. */
let opened: number
const registry = (): ConnectionRegistry => ({
  ids: () => ['erp'],
  scope: (id) => (id === 'erp' ? { schemas: ['sales'] } : undefined),
  open: async () => {
    opened += 1
    return undefined
  },
  close: async () => {},
})

let root: string
let store: ConfigurationStore
let events: AuditEvent[]
let lines: Array<{ msg: string; reason?: string; origin?: string; level: number }>
let servers: FastifyInstance[]

beforeEach(async () => {
  asked = []
  opened = 0
  events = []
  lines = []
  servers = []
  root = await mkdtemp(join(tmpdir(), 'formancy-data-cross-origin-'))
  store = createFileConfigurationStore(root)
  const { form, bindings } = generateForm(SNAPSHOT, {
    connection: 'erp',
    root: { schema: 'sales', name: 'employee' },
    formId: 'employee',
    title: 'Employee',
    lookups: [],
  })
  const bundle: PublishedBundle = { format: 1, connection: 'erp', form, bindings, policy: POLICY, snapshot: SNAPSHOT }
  await store.publish('employee', null, bundle)
})

afterEach(async () => {
  for (const server of servers) await server.close()
  await rm(root, { recursive: true, force: true })
})

/** Both planes as main.ts serves them, one sink each into `events`, the log into `lines`, the runtime answering `origins`; under review (0065) when `review`, so the draft routes are there too. */
async function serve(origins: readonly string[] = [LISTED], rateLimit = { max: 100_000, timeWindowMs: 60_000 }, review = false): Promise<FastifyInstance> {
  const sink = (event: AuditEvent) => void events.push(event)
  const app = await createDataServer({
    verifyIdentity,
    rateLimit,
    logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as (typeof lines)[number]) } },
    admin: {
      registry: registry(),
      store,
      adminRoles: review ? ['data-admin', 'data-publisher'] : ['data-admin'],
      ...(review ? { publisherRoles: ['data-publisher'] } : {}),
      audit: { sink },
    },
    runtime: { registry: registry(), store, audit: { sink }, origins },
  })
  servers.push(app)
  return app
}

const preflight = (app: FastifyInstance, url: string, method: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'OPTIONS', url, headers: { origin: LISTED, 'access-control-request-method': method, ...headers } })

/** The code an answer's JSON body carries, or null for an answer without one, a granted preflight's. */
const codeOf = (answer: { body: string }) => (answer.body === '' ? null : ((JSON.parse(answer.body) as { code?: string }).code ?? null))

/** Every `access-control-*` header an answer carries. */
const corsHeaders = (headers: IncomingHttpHeaders | Record<string, unknown>) => Object.keys(headers).filter((name) => name.startsWith('access-control-'))

/** A path of `pattern` with each parameter given a name of the collection before it. */
const SAMPLES: Record<string, string> = { forms: 'employee', connections: 'erp', lookups: 'manager', versions: '1' }
function sample(pattern: string, at?: { index: number; value: string }): string {
  const segments = pattern.split('/')
  return segments
    .map((segment, index) => (!segment.startsWith(':') ? segment : at?.index === index ? at.value : (SAMPLES[segments[index - 1] ?? ''] ?? 'x')))
    .join('/')
}

/** `METHOD pattern` split. */
const split = (key: string) => {
  const space = key.indexOf(' ')
  return { method: key.slice(0, space), pattern: key.slice(space + 1) }
}

/** Fastify's printRoutes({ commonPrefix: false }), read back as every `{ method, url }` it holds, HEAD and OPTIONS included. */
const LINE = /^((?:│ {3}| {4})*)(?:├── |└── )(\S+) \(([A-Z]+(?:, [A-Z]+)*)\)$/
function routesOf(app: FastifyInstance): Array<{ method: string; url: string }> {
  const routes: Array<{ method: string; url: string }> = []
  const parents: string[] = []
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    if (line.trim() === '') continue
    const match = LINE.exec(line)
    if (match === null) throw new Error(`printRoutes printed a line that is not a route: ${line}`)
    parents.length = (match[1] ?? '').length / 4
    const url = `${parents.at(-1) ?? ''}${match[2] ?? ''}`
    parents.push(url)
    for (const method of (match[3] ?? '').split(', ')) routes.push({ method, url })
  }
  return routes
}

const RUNTIME_PATHS = [...new Set(Object.keys(ROUTE_OPERATIONS).map((key) => split(key).pattern))]
const OFFERED_METHODS = new Set(Object.keys(ROUTE_OPERATIONS).map((key) => split(key).method))

describe('a preflight from a listed origin', () => {
  // A page on another origin reaches a route only after the browser's
  // preflight for it is granted, so a runtime route without one is a route
  // that page cannot use. The routes are read from ROUTE_OPERATIONS, the
  // table the plane registers from, so a route added to the plane is
  // offered with it. The grant names the one method asked, the three
  // headers the client sends, and how long a browser may keep it; never
  // credentials, exposed headers or the private network. Watched failing
  // with the OPTIONS paths written by hand without records/delete.
  test('is granted for every runtime route, with its method, the three headers and Max-Age', async () => {
    const app = await serve()
    const grants = []
    for (const key of Object.keys(ROUTE_OPERATIONS)) {
      const { method, pattern } = split(key)
      const answer = await preflight(app, sample(pattern), method, { 'access-control-request-headers': BOTH_HEADERS })
      grants.push({
        key,
        status: answer.statusCode,
        headers: Object.fromEntries(corsHeaders(answer.headers).map((name) => [name, answer.headers[name]])),
        vary: answer.headers['vary'],
      })
    }
    expect(grants).toEqual(
      Object.keys(ROUTE_OPERATIONS).map((key) => ({
        key,
        status: 204,
        headers: {
          'access-control-allow-origin': LISTED,
          'access-control-allow-methods': split(key).method,
          'access-control-allow-headers': CROSS_ORIGIN_REQUEST_HEADERS.join(', '),
          'access-control-max-age': String(PREFLIGHT_MAX_AGE_SECONDS),
        },
        vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      })),
    )
    expect(PREFLIGHT_MAX_AGE_SECONDS).toBe(600)
    // A browser sends the preflight to the request's URL, its query
    // included, and the router finds the route without it, as it routes the
    // request: measured with the query passed to findRoute as sent.
    const queried = await preflight(app, '/v1/forms/employee?view=all', 'GET')
    expect({ status: queried.statusCode, origin: queried.headers['access-control-allow-origin'] }).toEqual({ status: 204, origin: LISTED })
    expect(events).toEqual([])
    expect(asked).toEqual([])
  })
})

describe('the differential: a preflight is granted exactly where the request is the runtime plane’s', () => {
  // Fastify's findRoute gives a route's parameters, not the route, and the
  // planes share /v1/forms/:id, so a preflight could be granted at a path
  // whose request another plane answers -- an administrator's route opened
  // to another origin. Every route the router holds is sampled, HEAD
  // included, with plain names and with each static segment of the other
  // plane at each parameter; the request is sent without a token, and its
  // audit event says which plane answered; the preflight for that method is
  // sent from a listed origin. A grant if and only if the plane is the
  // runtime's and the method one its table names: HEAD, which the audit
  // counts as the GET it answers for, never. Watched failing three ways: an
  // OPTIONS route granting every path under /v1/forms/; a scratch
  // administrator route GET /v1/forms/menu with the check that the method
  // reaches the same parameters removed (and the check at ready off); and
  // the key built the audit's way, HEAD as GET. The administrator's plane
  // is under review (0065), so every route its table names is in the router.
  test('for every route the router holds, sampled with the other plane’s names', async () => {
    const app = await serve([LISTED], undefined, true)
    await app.ready()
    const routes = routesOf(app)

    const statics = (table: Readonly<Record<string, string>>) => [
      ...new Set(
        Object.keys(table).flatMap((key) =>
          split(key)
            .pattern.split('/')
            .filter((segment) => segment !== '' && !segment.startsWith(':')),
        ),
      ),
    ]
    const runtimeNames = statics(ROUTE_OPERATIONS)
    const adminNames = statics(ADMIN_OPERATIONS)
    const results: Array<{ method: string; path: string; plane: string | null; granted: boolean }> = []
    for (const { method, url } of routes.filter((route) => route.method !== 'OPTIONS')) {
      const key = `${method === 'HEAD' ? 'GET' : method} ${url}`
      const others = Object.hasOwn(ROUTE_OPERATIONS, key) ? adminNames : Object.hasOwn(ADMIN_OPERATIONS, key) ? runtimeNames : []
      const segments = url.split('/')
      const paths = new Set([sample(url)])
      segments.forEach((segment, index) => {
        if (segment.startsWith(':')) for (const value of others) paths.add(sample(url, { index, value }))
      })
      for (const path of paths) {
        events = []
        await app.inject({ method: method as 'GET', url: path })
        const plane = events.length === 1 ? (events[0] as AuditEvent).plane : events.length === 0 ? null : 'more than one event'
        const answer = await preflight(app, path, method)
        results.push({ method, path, plane, granted: answer.statusCode === 204 && answer.headers['access-control-allow-origin'] === LISTED })
      }
    }
    expect(results.filter((result) => result.granted !== (result.plane === 'runtime' && OFFERED_METHODS.has(result.method)))).toEqual([])
    expect(results.filter((result) => result.granted).length).toBeGreaterThan(Object.keys(ROUTE_OPERATIONS).length)
    expect(results.filter((result) => result.plane === 'admin').length).toBeGreaterThan(Object.keys(ADMIN_OPERATIONS).length)

    // And what was sampled is everything the router holds: both tables, the
    // two routes of neither plane, a HEAD for every GET, and the OPTIONS
    // routes themselves, one per runtime path and no other.
    const shared = ['GET /health', 'GET /v1/whoami']
    const gets = [...Object.keys(ROUTE_OPERATIONS), ...Object.keys(ADMIN_OPERATIONS), ...shared].filter((key) => key.startsWith('GET '))
    expect(new Set(routes.map(({ method, url }) => `${method} ${url}`))).toEqual(
      new Set([
        ...Object.keys(ROUTE_OPERATIONS),
        ...Object.keys(ADMIN_OPERATIONS),
        ...shared,
        ...gets.map((key) => `HEAD ${split(key).pattern}`),
        ...RUNTIME_PATHS.map((path) => `OPTIONS ${path}`),
      ]),
    )
  })

  // On its own, because it is the one disagreement the property allows: a
  // HEAD is audited as the runtime's GET, and is still not offered.
  test('HEAD is audited as the runtime GET it answers for, and its preflight is refused', async () => {
    const app = await serve()
    expect((await app.inject({ method: 'HEAD', url: '/v1/forms/x' })).statusCode).toBe(401)
    expect(events.map(({ plane, operation }) => ({ plane, operation }))).toEqual([{ plane: 'runtime', operation: 'form' }])
    const answer = await preflight(app, '/v1/forms/x', 'HEAD')
    expect({ status: answer.statusCode, cors: corsHeaders(answer.headers), code: codeOf(answer) }).toEqual({
      status: 403,
      cors: [],
      code: 'cross-origin-refused',
    })
    expect(lines.filter((line) => line.msg === 'preflight refused').map(({ reason, origin }) => ({ reason, origin }))).toEqual([
      { reason: 'method not offered on this route', origin: LISTED },
    ])
  })
})

describe('the check at ready', () => {
  // What parameters cannot tell apart: a route of no plane, or another
  // plane, at a pattern a runtime pattern of the same method could also
  // match. For /v1/forms/read/records/read the OPTIONS route gives
  // { id: 'read' }, and POST's tree prefers the static segment and reaches
  // the scratch route with { id: 'read' } too. So a server with origins
  // does not start beside one, nor beside a route whose pattern the overlap
  // rule does not model -- a regex parameter, a wildcard, two parameters in
  // one segment, a constraint -- rather than guess. Without origins nothing
  // is offered across origins, and they start as before. Watched failing
  // with the check removed: the scratch server started, and the preflight
  // for POST /v1/forms/read/records/read was granted while the request
  // reached the scratch route.
  test('refuses a route that overlaps a runtime pattern, and one it does not model, only with origins', async () => {
    /** `ready()`, as what a test can print: a Fastify instance is not. */
    const started = (app: FastifyInstance) => app.ready().then(() => 'started')
    await expect(started(await serve())).resolves.toBe('started')

    const overlapping = await serve()
    overlapping.post('/v1/forms/read/records/:id', async () => ({ scratch: true }))
    await expect(started(overlapping)).rejects.toThrow(
      'POST /v1/forms/read/records/:id could answer a path the runtime route POST /v1/forms/:id/records/read answers',
    )

    for (const [path, options] of [
      ['/v1/forms/:id(^\\d+)/extra', {}],
      ['/v1/files/*', {}],
      ['/v1/pairs/:from-:to', {}],
      ['/v1/elsewhere', { constraints: { host: 'other.example' } }],
    ] as const) {
      const unmodelled = await serve()
      unmodelled.get(path, options, async () => ({ scratch: true }))
      await expect(started(unmodelled), path).rejects.toThrow(
        `GET ${path} has a pattern or a constraint the check that keeps the planes apart across origins does not model`,
      )
    }

    const without = await serve([])
    without.post('/v1/forms/read/records/:id', async () => ({ scratch: true }))
    without.get('/v1/files/*', async () => ({ scratch: true }))
    await expect(started(without)).resolves.toBe('started')
  })

  // A browser keeps a grant by URL and header, not by method: it asks again
  // only for a method other than GET, HEAD and POST, or a header the grant
  // does not name. Measured on 2026-10-14 with Playwright 1.63, a page on
  // http://localhost:Q and this server on 127.0.0.1:P: after a granted GET
  // preflight at /v1/forms/employee, Chromium 153 and WebKit 26.6 sent a POST
  // with JSON and a HEAD there, each with Authorization, and no second
  // preflight; Firefox 155 asked again for each. So a route of those methods
  // outside the runtime table at a path any runtime pattern matches,
  // whatever that pattern's method, would take requests riding the runtime's
  // grant, with only Sec-Fetch-Site between them, which an older browser does
  // not send; it stops the server, an explicit HEAD too. A PUT does not: no
  // grant names it, so a browser asks first and is refused. Watched failing
  // with the methods compared, as the check first was: all three started.
  test('refuses a GET, HEAD or POST route at a path a runtime pattern of any method matches', async () => {
    const started = (app: FastifyInstance) => app.ready().then(() => 'started')
    for (const [method, url, runtime] of [
      ['POST', '/v1/forms/:id', 'GET /v1/forms/:id'],
      ['HEAD', '/v1/forms/menu', 'GET /v1/forms/:id'],
      ['GET', '/v1/forms/:id/records/:operation', 'POST /v1/forms/:id/records/read'],
    ] as const) {
      const app = await serve()
      app.route({ method, url, handler: async () => ({ scratch: true }) })
      await expect(started(app), `${method} ${url}`).rejects.toThrow(`${method} ${url} could answer a path the runtime route ${runtime} answers`)
    }
    const put = await serve()
    put.put('/v1/forms/:id', async () => ({ scratch: true }))
    await expect(started(put)).resolves.toBe('started')
    expect((await preflight(put, '/v1/forms/employee', 'PUT')).statusCode).toBe(403)
  })
})

describe('crossOrigin on its own', () => {
  // The preflight's own check that the method asked for reaches the route
  // the OPTIONS route stands for, with its parameters: a route registered
  // before crossOrigin is one the check at ready never saw, which
  // createDataServer never has, so only a bare app shows it. A static GET
  // /v1/forms/menu beside GET /v1/forms/:id gives {} where the OPTIONS route
  // gives { id: 'menu' }; a POST at a records path with no POST route gives
  // nothing at all. Both are refused, and a path the GET route takes is
  // granted. Watched failing with the parameters not compared (menu was
  // granted) and with no route not refused (a 500).
  test('refuses a preflight whose method reaches another route, or none', async () => {
    const app = Fastify({ logger: { stream: { write: (line: string) => void lines.push(JSON.parse(line) as (typeof lines)[number]) } } })
    servers.push(app)
    app.get('/v1/forms/menu', async () => ({ scratch: true }))
    crossOrigin(app, { origins: [LISTED] })
    app.get('/v1/forms/:id', async () => ({ runtime: true }))
    await app.ready()
    const answers = [
      await preflight(app, '/v1/forms/menu', 'GET'),
      await preflight(app, '/v1/forms/x/records/read', 'POST'),
      await preflight(app, '/v1/forms/employee', 'GET'),
    ]
    expect(answers.map((answer) => `${String(answer.statusCode)} ${codeOf(answer)}`)).toEqual([
      '403 cross-origin-refused',
      '403 cross-origin-refused',
      '204 null',
    ])
    expect(lines.filter((line) => line.msg === 'preflight refused').map((line) => line.reason)).toEqual([
      'method reaches another route',
      'method reaches another route',
    ])
  })
})

describe('a refused preflight', () => {
  // Each is a request the browser would then not send. The answer carries
  // no access-control-* header, so nothing about it is readable by the page
  // that asked, and the log says why, naming the origin only in the form a
  // browser sends it (server-log.test.ts holds the rest). Watched failing by
  // echoing the origin that was sent.
  test('is 403 cross-origin-refused, carries nothing, and the log says why', async () => {
    const app = await serve()
    const refused = [
      [{ origin: OTHER }, 'GET', 'origin not listed'],
      [{ origin: 'null' }, 'GET', 'origin not listed'],
      [{ origin: 'https://App.example' }, 'GET', 'origin not listed'],
      [{ origin: `${LISTED}/` }, 'GET', 'origin not listed'],
      [{}, 'DELETE', 'method not offered on this route'],
      [{ 'access-control-request-headers': `${BOTH_HEADERS},x-requested-with` }, 'GET', 'header not allowed'],
      [{ 'access-control-request-headers': 'cookie' }, 'GET', 'header not allowed'],
    ] as const
    for (const [headers, method, reason] of refused) {
      lines = []
      const answer = await preflight(app, '/v1/forms/employee', method, headers)
      expect({ headers, status: answer.statusCode, cors: corsHeaders(answer.headers), code: codeOf(answer) }).toEqual({
        headers,
        status: 403,
        cors: [],
        code: 'cross-origin-refused',
      })
      expect(lines.filter((line) => line.msg === 'preflight refused').map((line) => line.reason)).toEqual([reason])
    }
    for (const headers of [{ origin: LISTED }, { 'access-control-request-method': 'GET' }]) {
      lines = []
      const answer = await app.inject({ method: 'OPTIONS', url: '/v1/forms/employee', headers })
      expect({ status: answer.statusCode, cors: corsHeaders(answer.headers) }).toEqual({ status: 403, cors: [] })
      expect(lines.filter((line) => line.msg === 'preflight refused').map((line) => line.reason)).toEqual(['not a preflight'])
    }
    // No OPTIONS route at an administrator path: the router's 404.
    for (const path of ['/v1/connections', '/v1/forms/employee/versions', '/v1/whoami', '/health']) {
      const answer = await preflight(app, path, 'GET')
      expect({ path, status: answer.statusCode, cors: corsHeaders(answer.headers) }).toEqual({ path, status: 404, cors: [] })
    }
    expect(events).toEqual([])
  })
})

/** One request with its target exactly as written, on a connection of its own (app.test.ts says why). */
function send(port: number, method: string, target: string, headers: Record<string, string>): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method, path: target, headers, agent: false }, (incoming) => {
      incoming.resume()
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers }))
      incoming.on('error', reject)
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

describe('the answers of a runtime route', () => {
  // A page on a listed origin reads the server's sentence only when the
  // answer carries its origin back: a refusal without it is a network error
  // to the page, and "could not be reached" is not what happened. So every
  // answer of a runtime route carries it -- the server's own 400 for a path
  // a proxy could read differently, sent over a real socket because inject
  // resolves dot segments first; a 401; the plane's 404; the limiter's 429
  // -- with Vary: Origin, since the same route answers another origin
  // without it. Watched failing with the header set only where a route's
  // handler runs, after the token is read: only the 404 carried it.
  test('carry the listed origin back, refusals included, with Vary: Origin', async () => {
    const app = await serve([LISTED], { max: 3, timeWindowMs: 60_000 })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as AddressInfo).port
    const answers = [
      await send(port, 'GET', '/v1/forms/a%2Frecords%2Fread', { origin: LISTED }),
      await send(port, 'GET', '/v1/forms/employee', { origin: LISTED }),
      await send(port, 'GET', '/v1/forms/nope', { origin: LISTED, authorization: 'Bearer clerk' }),
      await send(port, 'GET', '/v1/forms/employee', { origin: LISTED }),
    ]
    expect(
      answers.map(({ status, headers }) => ({
        status,
        origin: headers['access-control-allow-origin'],
        vary: headers['vary'],
        credentials: headers['access-control-allow-credentials'],
      })),
    ).toEqual([
      { status: 400, origin: LISTED, vary: 'Origin', credentials: undefined },
      { status: 401, origin: LISTED, vary: 'Origin', credentials: undefined },
      { status: 404, origin: LISTED, vary: 'Origin', credentials: undefined },
      { status: 429, origin: LISTED, vary: 'Origin', credentials: undefined },
    ])
    // Another origin, and none: the same Vary, and no origin back.
    const other = await app.inject({ method: 'GET', url: '/v1/forms/employee', headers: { origin: OTHER } })
    const none = await app.inject({ method: 'GET', url: '/v1/forms/employee' })
    expect([other, none].map(({ headers }) => ({ origin: headers['access-control-allow-origin'], vary: headers['vary'] }))).toEqual([
      { origin: undefined, vary: 'Origin' },
      { origin: undefined, vary: 'Origin' },
    ])
  })

  // The administrator's plane answers no other origin (0024, 0060): no
  // answer of it carries an origin back, whatever was listed, and neither
  // does /v1/whoami, /health, a HEAD, or a 404 no route answered. The
  // planes audit theirs as before, and /v1/whoami and /health, which belong
  // to neither, write no event. Watched failing with the routes told apart
  // by `startsWith('/v1/forms')`: the administrator's version routes carried
  // the origin.
  test('and no answer of the administrator’s plane, /v1/whoami, /health, a HEAD or a 404 carries it', async () => {
    const app = await serve()
    const admin = { origin: LISTED, authorization: 'Bearer admin' }
    const asked = [
      ['GET', '/v1/connections', admin],
      ['GET', '/v1/forms/employee/versions', admin],
      ['GET', '/v1/forms/employee/versions/latest', admin],
      ['GET', '/v1/forms/employee/versions/1', admin],
      ['POST', '/v1/forms/employee/drift', { origin: LISTED }],
      ['GET', '/v1/whoami', { origin: LISTED, authorization: 'Bearer clerk' }],
      ['GET', '/health', { origin: LISTED }],
      ['HEAD', '/v1/forms/employee', { origin: LISTED }],
      ['GET', '/v1/nothing', { origin: LISTED }],
    ] as const
    const answers = []
    for (const [method, url, headers] of asked) answers.push(await app.inject({ method, url, headers }))
    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200, 200, 401, 200, 200, 401, 404])
    expect(answers.flatMap((answer) => corsHeaders(answer.headers))).toEqual([])
    expect(events.map(({ plane, operation }) => `${plane} ${operation}`)).toEqual([
      'admin connection-list',
      'admin version-list',
      'admin version-latest',
      'admin version-read',
      'admin drift',
      'runtime form',
    ])
    // Nor the router's 414 for a runtime path whose parameter is past its
    // limit: written before any hook, it carries neither the origin nor
    // Vary, as the documents say. Watched failing with the router's limit
    // raised: the runtime route answered 404, with both.
    const long = await app.inject({ method: 'GET', url: `/v1/forms/${'a'.repeat(CONFIGURATION_ID_MAX_LENGTH + 1)}`, headers: { origin: LISTED } })
    expect({ status: long.statusCode, cors: corsHeaders(long.headers), vary: long.headers['vary'] }).toEqual({ status: 414, cors: [], vary: undefined })
  })
})

describe('preflights', () => {
  // A preflight reads no token and does no work, so it is not an audit
  // event; and it is not counted, because a counted preflight turns the
  // limiter's 429, which the page can read, into a refused preflight, which
  // it cannot. The actual requests are counted and audited as before, the
  // 429 included, and it carries the origin. Watched failing with
  // `rateLimit: false` dropped: the third preflight was the limiter's 429.
  test('are neither audited nor counted, and the limiter’s 429 carries the origin', async () => {
    const app = await serve([LISTED], { max: 2, timeWindowMs: 60_000 })
    const grants = []
    for (let n = 0; n < 5; n += 1) grants.push((await preflight(app, '/v1/forms/employee', 'GET')).statusCode)
    const actual = []
    for (let n = 0; n < 3; n += 1) {
      const answer = await app.inject({ method: 'GET', url: '/v1/forms/employee', headers: { origin: LISTED } })
      actual.push({ status: answer.statusCode, origin: answer.headers['access-control-allow-origin'] })
    }
    expect(grants).toEqual([204, 204, 204, 204, 204])
    expect(actual).toEqual([401, 401, 429].map((status) => ({ status, origin: LISTED })))
    expect(events.map(({ plane, operation, status }) => ({ plane, operation, status }))).toEqual(
      [401, 401, 429].map((status) => ({ plane: 'runtime', operation: 'form', status })),
    )
  })
})

describe('a token-bearing request a browser marks cross-site', () => {
  const update = (app: FastifyInstance, headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/v1/forms/employee/records/update', headers: { authorization: 'Bearer clerk', ...headers }, payload: UPDATE })

  // A browser that cached a granted preflight keeps sending without asking
  // for up to Max-Age; after its origin left the list, its writes would
  // still run and only their answers go unread. So a request carrying a
  // token whose Sec-Fetch-Site -- the browser's own, which no script sets
  // -- is cross-site or same-site is refused before the token is read
  // unless its origin is listed and its route is the runtime plane's. The
  // verifier is never asked, no connection is opened, the plane audits it
  // with no actor, and the limiter counts it. Watched failing with the
  // preHandler removed: the unlisted update reached the verifier and the
  // registry.
  test('is refused before its token is read unless its origin is listed and its route is the runtime’s', async () => {
    const app = await serve([LISTED], { max: 3, timeWindowMs: 60_000 })
    for (const site of ['cross-site', 'same-site']) {
      events = []
      const answer = await update(app, { 'sec-fetch-site': site, origin: OTHER })
      expect({ site, status: answer.statusCode, code: codeOf(answer), cors: corsHeaders(answer.headers) }).toEqual({
        site,
        status: 403,
        code: 'cross-origin-refused',
        cors: [],
      })
      expect(events.map(({ plane, operation, actor, status, outcome }) => ({ plane, operation, actor, status, outcome }))).toEqual([
        { plane: 'runtime', operation: 'update', actor: null, status: 403, outcome: 'cross-origin-refused' },
      ])
    }
    expect({ asked, opened }).toEqual({ asked: [], opened: 0 })
    expect(lines.filter((line) => line.msg === 'cross-origin request refused').map(({ reason, origin }) => ({ reason, origin }))).toEqual([
      { reason: 'origin not listed', origin: OTHER },
      { reason: 'origin not listed', origin: OTHER },
    ])
    // Counted: the third request of a limit of three is answered, the fourth is the limiter's.
    expect((await update(app, { 'sec-fetch-site': 'cross-site', origin: OTHER })).statusCode).toBe(403)
    expect((await update(app, { 'sec-fetch-site': 'cross-site', origin: LISTED })).statusCode).toBe(429)
  })

  // A listed origin on a runtime route is served -- the token read, the
  // connection asked for -- and carries its origin back. On the
  // administrator's plane, /v1/whoami or /health, the same request is
  // refused whatever is listed: no grant there, so no request riding one.
  // Each plane audits its own refusal; /v1/whoami and /health belong to
  // neither, and write no event.
  test('is served from a listed origin on a runtime route, and refused on every other route', async () => {
    const app = await serve()
    const served = await update(app, { 'sec-fetch-site': 'cross-site', origin: LISTED })
    expect({ status: served.statusCode, code: codeOf(served), origin: served.headers['access-control-allow-origin'] }).toEqual({
      status: 500,
      code: 'unknown-connection',
      origin: LISTED,
    })
    expect({ asked, opened }).toEqual({ asked: ['clerk'], opened: 1 })
    asked = []
    events = []
    lines = []
    const elsewhere = [
      await app.inject({ method: 'GET', url: '/v1/connections', headers: { authorization: 'Bearer admin', 'sec-fetch-site': 'cross-site', origin: LISTED } }),
      await app.inject({
        method: 'GET',
        url: '/v1/forms/employee/versions',
        headers: { authorization: 'Bearer admin', 'sec-fetch-site': 'same-site', origin: LISTED },
      }),
      await app.inject({ method: 'GET', url: '/v1/whoami', headers: { authorization: 'Bearer clerk', 'sec-fetch-site': 'cross-site', origin: LISTED } }),
      await app.inject({
        method: 'HEAD',
        url: '/v1/forms/employee',
        headers: { authorization: 'Bearer clerk', 'sec-fetch-site': 'cross-site', origin: LISTED },
      }),
      await app.inject({ method: 'GET', url: '/health', headers: { authorization: 'Bearer clerk', 'sec-fetch-site': 'cross-site', origin: LISTED } }),
    ]
    expect(elsewhere.map((answer) => ({ status: answer.statusCode, cors: corsHeaders(answer.headers) }))).toEqual(
      [403, 403, 403, 403, 403].map((status) => ({ status, cors: [] })),
    )
    expect(asked).toEqual([])
    expect(events.map(({ plane, actor, status, outcome }) => ({ plane, actor, status, outcome }))).toEqual([
      { plane: 'admin', actor: null, status: 403, outcome: 'cross-origin-refused' },
      { plane: 'admin', actor: null, status: 403, outcome: 'cross-origin-refused' },
      { plane: 'runtime', actor: null, status: 403, outcome: 'cross-origin-refused' },
    ])
    expect(lines.filter((line) => line.msg === 'cross-origin request refused').map((line) => line.reason)).toEqual(
      Array(5).fill('route not offered across origins'),
    )
  })

  // A path no route takes is the router's 404, token or none, and the rule
  // leaves it so: a root preHandler runs for that 404 too, and refusing
  // there would turn "no such route" into a 403 and a log line about a
  // route nobody offered. Watched failing with the rule's no-route guard
  // removed: the 404 was a 403 and logged.
  test('leaves the router’s 404 as it is', async () => {
    const app = await serve()
    const answer = await app.inject({
      method: 'GET',
      url: '/v1/nothing',
      headers: { authorization: 'Bearer clerk', 'sec-fetch-site': 'cross-site', origin: OTHER },
    })
    expect({ status: answer.statusCode, cors: corsHeaders(answer.headers) }).toEqual({ status: 404, cors: [] })
    expect(lines.filter((line) => line.msg === 'cross-origin request refused')).toEqual([])
    expect(asked).toEqual([])
  })

  // What the rule never touches: a request the browser says is same-origin
  // or that it started itself, one with no Sec-Fetch-Site -- every
  // non-browser client, and a browser too old to send it -- whatever its
  // Origin, and one with no token, which is the plane's 401 as before. And
  // all of it with an empty list too, which still refuses a request riding
  // a grant cached under an earlier list.
  test.each([[[LISTED]], [[]]] as const)('answers as without the rule what it does not concern, with origins %j', async (origins) => {
    const app = await serve(origins)
    const unconcerned = [
      await update(app, { 'sec-fetch-site': 'same-origin', origin: OTHER }),
      await update(app, { 'sec-fetch-site': 'none' }),
      await update(app, { origin: OTHER }),
      await app.inject({
        method: 'POST',
        url: '/v1/forms/employee/records/update',
        headers: { 'sec-fetch-site': 'cross-site', origin: OTHER },
        payload: UPDATE,
      }),
    ]
    expect(unconcerned.map((answer) => `${String(answer.statusCode)} ${codeOf(answer)}`)).toEqual([
      '500 unknown-connection',
      '500 unknown-connection',
      '500 unknown-connection',
      '401 unauthenticated',
    ])
    expect(asked).toEqual(['clerk', 'clerk', 'clerk'])
    const riding = await update(app, { 'sec-fetch-site': 'cross-site', origin: origins.length === 0 ? LISTED : OTHER })
    expect(riding.statusCode).toBe(403)
    expect(asked).toHaveLength(3)
  })
})

describe('with no origin listed', () => {
  // The default, and the composed stack's: nothing is offered across
  // origins, so no route exists to answer a preflight and no answer says
  // anything a browser would read as a grant, or a Vary that only a grant
  // needs. Watched failing with the OPTIONS routes registered whatever the
  // list: printRoutes had them.
  test('no OPTIONS route exists, and no answer carries Vary or access-control-*', async () => {
    const app = await serve([])
    await app.ready()
    expect(routesOf(app).filter((route) => route.method === 'OPTIONS')).toEqual([])
    const answers = [
      await preflight(app, '/v1/forms/employee', 'GET'),
      await app.inject({ method: 'GET', url: '/v1/forms/employee', headers: { origin: LISTED } }),
      await app.inject({ method: 'GET', url: '/v1/forms/nope', headers: { origin: LISTED, authorization: 'Bearer clerk' } }),
      await app.inject({ method: 'GET', url: '/v1/connections', headers: { origin: LISTED, authorization: 'Bearer admin' } }),
      await app.inject({ method: 'GET', url: '/v1/whoami', headers: { origin: LISTED, authorization: 'Bearer clerk' } }),
    ]
    expect(answers.map((answer) => answer.statusCode)).toEqual([404, 401, 404, 200, 200])
    expect(answers.flatMap((answer) => [...corsHeaders(answer.headers), ...(answer.headers['vary'] === undefined ? [] : ['vary'])])).toEqual([])
  })
})

describe('createDataServer', () => {
  // An embedder hands the list over past main.ts: `*` is as impossible there
  // as in the setting, and the server does not start with it; an empty list
  // is no list.
  test('refuses runtime.origins it would not accept from the setting, and takes an empty one', async () => {
    const options = { verifyIdentity, runtime: { registry: registry(), store } }
    /** The server built, as what a test can print: a Fastify instance is not. */
    const built = (origins: readonly string[]) =>
      createDataServer({ ...options, runtime: { ...options.runtime, origins } }).then((app) => {
        servers.push(app)
        return 'built'
      })
    await expect(built(['*'])).rejects.toThrow(/^runtime\.origins\[0\] /)
    await expect(built([LISTED, 'https://app.example/'])).rejects.toThrow(/^runtime\.origins\[1\] /)
    const app = await createDataServer({ ...options, runtime: { ...options.runtime, origins: [] } })
    servers.push(app)
    expect((await preflight(app, '/v1/forms/employee', 'GET')).statusCode).toBe(404)
  })

  // The list is checked when createDataServer is called, and building the
  // server awaits before the grants are made: an embedder's array changed in
  // that time would be granted without being checked, plain HTTP to an
  // intranet name among it. So the server copies it first and grants the
  // copy. Watched failing with the array itself handed on: the pushed origin
  // was granted.
  test('grants the list it checked, not the array as it is later', async () => {
    const origins = [LISTED]
    const pending = createDataServer({ verifyIdentity, runtime: { registry: registry(), store, origins } })
    origins.push('http://intranet.example')
    const app = await pending
    servers.push(app)
    const later = await app.inject({
      method: 'OPTIONS',
      url: '/v1/forms/employee',
      headers: { origin: 'http://intranet.example', 'access-control-request-method': 'GET' },
    })
    expect({ status: later.statusCode, cors: corsHeaders(later.headers) }).toEqual({ status: 403, cors: [] })
    expect((await preflight(app, '/v1/forms/employee', 'GET')).statusCode).toBe(204)
  })
})
