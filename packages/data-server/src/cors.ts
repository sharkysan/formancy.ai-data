/**
 * Across origins (0060): the runtime plane answers a page on another origin
 * when the operator lists that origin exactly, and nothing else does.
 *
 * - `FORMANCY_DATA_CORS_ORIGINS`, read by main.ts and parsed here, and
 *   `runtime.origins`, which createDataServer checks with the same rule.
 * - `crossOrigin`, which createDataServer calls on every server: with a
 *   list, an `OPTIONS` route at each runtime path that grants a preflight
 *   only where the method asked reaches the runtime route at that path, the
 *   origin carried back on every answer of a runtime route, and a check at
 *   ready that refuses a route another plane could answer at a runtime
 *   path; with or without one, a token-bearing request a browser marks
 *   cross-site or same-site refused before its token is read unless its
 *   origin is listed and its route is the runtime plane's.
 *
 * Never a wildcard, a pattern, `null` or credentials, and never HEAD.
 */
import { CROSS_ORIGIN_REQUEST_HEADERS } from '@formancy/data-core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ROUTE_OPERATIONS } from './routes/runtime.js'

/**
 * How long a browser may keep a granted preflight, in seconds. Each engine
 * caps what it keeps, read on main on 2026-10-13: WebKit at 600
 * (`maxPreflightCacheTimeout`, CrossOriginPreflightResultCache.cpp:43),
 * Chromium at two hours (`kMaxTimeout`, services/network/cors/
 * preflight_result.cc:40) and Firefox at 86400 (nsCORSListenerProxy.cpp:
 * 1404), so 600 is the longest every engine honours as written. It is also
 * the longest a browser that cached a grant keeps sending without asking
 * after its origin leaves the list, which the refusal below closes for
 * every browser that sends Sec-Fetch-Site. A choice within those caps, not
 * a measurement: nothing here measured a cost that would choose another.
 */
export const PREFLIGHT_MAX_AGE_SECONDS = 600

/** The answer to a refused preflight, and to a token-bearing request refused across origins: a code and a sentence, and nothing of the request. */
export const CROSS_ORIGIN_REFUSED = {
  code: 'cross-origin-refused',
  message:
    'Across origins this server answers only the runtime plane’s routes, from an origin its operator lists, and this request is not one of those, so it was refused before any work.',
} as const

const SETTING = 'FORMANCY_DATA_CORS_ORIGINS'

/** Plain HTTP is accepted on these hosts only, where a developer's page is: never across a network (0060). */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** One label of a host name as a browser's URL parser leaves it: lower case, digits, `-` and `_`. Anchored, one class, so linear (CodeQL). */
const LABEL = /^[a-z0-9_-]+$/

/**
 * Why `entry` is not an origin this server lists, as the end of a sentence
 * that never repeats it, or `undefined`. An origin is accepted only when
 * the URL parser gives it back unchanged as its origin -- so lower case, no
 * path, no trailing slash, no default port, no user information, a punycode
 * name -- with a host that is a DNS name or an IP address, over `https:`, or
 * `http:` on loopback.
 */
function originProblem(entry: unknown): string | undefined {
  if (typeof entry !== 'string') return 'is not a string'
  if (entry === '*' || entry === 'null') return 'is a wildcard or the opaque origin, which is never listed: each origin is named exactly'
  let url: URL
  try {
    url = new URL(entry)
  } catch {
    return 'is not an origin: a scheme, a host and, where it is not the default, a port'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'is not an https: origin'
  if (url.origin !== entry)
    return 'is not written as a browser sends Origin: lower case, a punycode name, no path or trailing slash, no default port and no user information'
  const host = url.hostname
  if (!(host.startsWith('[') || host.split('.').every((label) => LABEL.test(label)))) return 'names a pattern or a host that is no DNS name or IP address'
  if (url.protocol === 'http:' && !LOOPBACK.has(host))
    return 'is plain HTTP on a host other than localhost, 127.0.0.1 or [::1]: anything else is listed as https:'
  return undefined
}

export type CorsOriginsSetting = { ok: true; origins: readonly string[] } | { ok: false; problem: string }

/**
 * `FORMANCY_DATA_CORS_ORIGINS` as written: origins separated by commas,
 * space around each ignored. Unset, empty, or nothing but commas and space
 * is no origin -- Compose passes `""` for a variable it was not given. Any
 * entry that is not an origin refuses the whole setting, named by its place
 * and never quoted; and a list needs the runtime plane, whose routes are all
 * it grants.
 */
export function corsOriginsSetting(text: string | undefined, plane: { runtime: boolean }): CorsOriginsSetting {
  const entries = (text ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  for (const [index, entry] of entries.entries()) {
    const problem = originProblem(entry)
    if (problem !== undefined) return { ok: false, problem: `${SETTING}: entry ${String(index + 1)} ${problem}.` }
  }
  if (entries.length > 0 && !plane.runtime) {
    return {
      ok: false,
      problem: `${SETTING} lists origins, and the runtime plane is off: set FORMANCY_DATA_STORE_DIR and FORMANCY_DATA_CONNECTIONS, or leave it empty.`,
    }
  }
  return { ok: true, origins: [...new Set(entries)] }
}

/** What is wrong with `runtime.origins` as an embedder passed it, by place, or `undefined`: the setting's rule, with no trimming. */
export function originsProblem(origins: unknown): string | undefined {
  if (!Array.isArray(origins)) return 'runtime.origins is not a list of origins.'
  for (const [index, entry] of origins.entries()) {
    const problem = originProblem(entry)
    if (problem !== undefined) return `runtime.origins[${String(index)}] ${problem}.`
  }
  return undefined
}

/** `existing` Vary with `name` added once, by its token case-insensitively; `*` stays `*`. */
export function varyWith(existing: number | string | readonly string[] | undefined, name: string): string {
  const tokens = [existing ?? []]
    .flat()
    .flatMap((value) => String(value).split(','))
    .map((token) => token.trim())
    .filter((token) => token !== '')
  if (tokens.includes('*')) return '*'
  return tokens.some((token) => token.toLowerCase() === name.toLowerCase()) ? tokens.join(', ') : [...tokens, name].join(', ')
}

/**
 * The origin as a log line may name it: only when the URL parser gives it
 * back unchanged and it is no longer than an origin can be (`https://`, a
 * 253-character name and a port). Such an origin holds no user information,
 * path or query, so nothing a caller pasted into a URL rides into the log
 * with it, and it is what the operator would add to the list (0060).
 * Anything else is logged with no origin at all.
 */
function loggable(origin: unknown): { origin?: string } {
  if (typeof origin !== 'string' || origin.length > 267) return {}
  try {
    return new URL(origin).origin === origin ? { origin } : {}
  } catch {
    return {}
  }
}

/** `METHOD url` as the runtime table keys it: HEAD is HEAD, and the table names none, so it is never offered across origins. */
const routeKey = (request: FastifyRequest) => `${request.method} ${request.routeOptions.url ?? ''}`

const OFFERED = new Set(Object.keys(ROUTE_OPERATIONS))

/** A route as the check at ready sees it. */
interface RegisteredRoute {
  method: string
  url: string
  constraints?: unknown
}

/** A segment of a pattern: a plain `:name`, static text, or something the overlap rule does not model. */
function segmentKind(segment: string): 'parameter' | 'static' | 'unmodelled' {
  if (/^:[A-Za-z0-9_]+$/.test(segment)) return 'parameter'
  return segment.includes(':') || segment.includes('*') ? 'unmodelled' : 'static'
}

/** Whether a path exists that both patterns, each of plain segments, match: the same number of segments, each equal static text or a parameter on either side. */
function overlap(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length &&
    a.every((segment, index) => segment === b[index] || segmentKind(segment) === 'parameter' || segmentKind(String(b[index])) === 'parameter')
  )
}

/**
 * The methods a browser sends on a URL's grant without asking again, whatever
 * method the grant named: the Fetch standard asks again only for another
 * method or for a header the grant does not name, and a grant names its
 * headers by URL. Measured in Chromium and WebKit, not Firefox (0060).
 */
const SAFELISTED = new Set(['GET', 'HEAD', 'POST'])

/**
 * What stops a server with origins at ready, as sentences: a route outside
 * the runtime table whose pattern could match a path a runtime pattern
 * matches -- any runtime pattern for a GET, HEAD or POST, which ride the
 * grant of whatever method was granted at that URL, and one of the same
 * method otherwise. Those are the requests a grant for the runtime route
 * would let a browser send to the other, and the case Fastify's parameters
 * cannot tell apart. OPTIONS routes are this file's, and a HEAD at a
 * runtime GET's own pattern is the one Fastify adds for it: no other can
 * be registered there. Any route whose pattern holds a regex parameter, a
 * wildcard or two parameters in one segment, or that has a constraint,
 * stops it too: the rule does not model those, and refuses rather than
 * guesses.
 */
function routeProblems(routes: readonly RegisteredRoute[]): string[] {
  const problems: string[] = []
  const runtime = [...OFFERED].map((key) => ({ key, method: key.slice(0, key.indexOf(' ')), segments: key.slice(key.indexOf(' ') + 1).split('/') }))
  for (const route of routes) {
    const segments = route.url.split('/')
    const constrained = typeof route.constraints === 'object' && route.constraints !== null && Object.keys(route.constraints).length > 0
    if (constrained || segments.some((segment) => segmentKind(segment) === 'unmodelled')) {
      problems.push(`${route.method} ${route.url} has a pattern or a constraint the check that keeps the planes apart across origins does not model`)
      continue
    }
    const key = `${route.method} ${route.url}`
    if (route.method === 'OPTIONS' || OFFERED.has(key) || (route.method === 'HEAD' && OFFERED.has(`GET ${route.url}`))) continue
    for (const pattern of runtime) {
      const rides = SAFELISTED.has(route.method) || pattern.method === route.method
      if (rides && overlap(segments, pattern.segments)) problems.push(`${key} could answer a path the runtime route ${pattern.key} answers`)
    }
  }
  return problems
}

/** Whether two routers' parameters are the same names with the same values, in any order. */
function sameParameters(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const names = Object.keys(a)
  return names.length === Object.keys(b).length && names.every((name) => Object.hasOwn(b, name) && a[name] === b[name])
}

type Preflight = { granted: true; origin: string; method: string } | { granted: false; reason: string }

export interface CrossOriginOptions {
  /** Origins exactly as a browser sends them, already checked (`originsProblem`); empty, nothing is offered across origins. */
  origins: readonly string[]
}

/**
 * Called by createDataServer on every server, after the path-not-plain
 * refusal and before any route, so its hooks cover every route registered
 * after it.
 */
export function crossOrigin(app: FastifyInstance, options: CrossOriginOptions): void {
  const listed = new Set(options.origins)

  // A browser that cached a grant keeps sending without asking for up to
  // Max-Age; after its origin left the list its requests, writes included,
  // would run and only their answers go unread. So a request carrying a
  // token whose Sec-Fetch-Site says the browser sent it from another site
  // is refused here unless its origin is listed and its route the runtime
  // plane's: after every onRequest, the limiter's included, so it is
  // counted wherever the limiter counts, which is every route but /health;
  // before each plane's preHandler, which reads the token, so no token is
  // read and no work done; and a plane's own hooks still write its one
  // event, where the route is a plane's, which /v1/whoami and /health are
  // not. With no route, the router's 404 is left as it is. Only ever
  // narrows: no browser sends a token across origins without a grant.
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.url === undefined || request.headers.authorization === undefined) return undefined
    const site = request.headers['sec-fetch-site']
    if (site !== 'cross-site' && site !== 'same-site') return undefined
    const origin = request.headers.origin
    const fromListed = typeof origin === 'string' && listed.has(origin)
    if (fromListed && OFFERED.has(routeKey(request))) return undefined
    request.log.info({ reason: fromListed ? 'route not offered across origins' : 'origin not listed', ...loggable(origin) }, 'cross-origin request refused')
    return reply.code(403).send(CROSS_ORIGIN_REFUSED)
  })

  if (listed.size === 0) return

  // Every route, as it is registered, for the check at ready: Fastify's
  // parameters cannot tell two routes apart whose parameters come out equal.
  const routes: RegisteredRoute[] = []
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) routes.push({ method, url: route.url, constraints: route.constraints })
  })
  // eslint-disable-next-line @typescript-eslint/require-await -- a Fastify hook that throws refuses the start only as a rejection
  app.addHook('onReady', async () => {
    const problems = routeProblems(routes)
    if (problems.length > 0)
      throw new Error(
        `With origins listed, the server does not start beside a route another plane could answer at a runtime path (0060): ${problems.join('; ')}.`,
      )
  })

  // Every answer of a runtime route, refusals included -- path-not-plain,
  // 401, 404, 409, the limiter's 429, the plane's 503 -- so a page on a
  // listed origin reads the server's sentence; Vary on all of them, since
  // the same route answers another origin without it. What is written
  // before any hook, the router's 414 and the 503 while closing among it,
  // carries neither (app.ts says which). Never credentials, exposed headers
  // or the private network.
  app.addHook('onSend', async (request, reply, payload) => {
    if (!OFFERED.has(routeKey(request))) return payload
    reply.header('vary', varyWith(reply.getHeader('vary'), 'Origin'))
    const origin = request.headers.origin
    if (typeof origin === 'string' && listed.has(origin)) reply.header('access-control-allow-origin', origin)
    return payload
  })

  /** A preflight at `pattern`, decided: the origin, the method the runtime table names here and the router takes to the same parameters, and only the headers the server reads. */
  const decide = (request: FastifyRequest, pattern: string): Preflight => {
    const origin = request.headers.origin
    const method = request.headers['access-control-request-method']
    if (typeof origin !== 'string' || typeof method !== 'string') return { granted: false, reason: 'not a preflight' }
    if (!listed.has(origin)) return { granted: false, reason: 'origin not listed' }
    if (!OFFERED.has(`${method} ${pattern}`)) return { granted: false, reason: 'method not offered on this route' }
    // Where the method takes this path, as far as Fastify says: its
    // parameters. A route of another plane at this path gives others. The
    // router leaves a query out, as it does routing the request. No route
    // at all cannot be, the runtime route being here; it is refused all the
    // same. Behind the check at ready, which refuses every such route
    // registered after this call, it holds only a route registered before
    // it, which createDataServer has none of; and it asks for the method
    // asked alone: another riding the grant is the check at ready's.
    const reached = app.findRoute({ method: method, url: request.url })
    if (reached === null || !sameParameters(reached.params, request.params as Record<string, unknown>))
      return { granted: false, reason: 'method reaches another route' }
    const asked = String(request.headers['access-control-request-headers'] ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== '')
    if (!asked.every((name) => (CROSS_ORIGIN_REQUEST_HEADERS as readonly string[]).includes(name))) return { granted: false, reason: 'header not allowed' }
    return { granted: true, origin, method }
  }

  // One OPTIONS route per runtime path, from the table the plane registers
  // from, outside both planes: a preflight reads no token and does no work,
  // so it is no audit event, and it is not counted, so the limiter's 429,
  // which the page can read, never becomes a refused preflight, which it
  // cannot. An OPTIONS anywhere else has no route: the router's 404.
  const vary = 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers'
  for (const pattern of new Set([...OFFERED].map((key) => key.slice(key.indexOf(' ') + 1)))) {
    app.options(pattern, { config: { rateLimit: false } }, async (request, reply) => {
      const decided = decide(request, pattern)
      if (!decided.granted) {
        request.log.info({ reason: decided.reason, ...loggable(request.headers.origin) }, 'preflight refused')
        return reply.code(403).header('vary', vary).send(CROSS_ORIGIN_REFUSED)
      }
      return reply
        .code(204)
        .headers({
          'access-control-allow-origin': decided.origin,
          'access-control-allow-methods': decided.method,
          'access-control-allow-headers': CROSS_ORIGIN_REQUEST_HEADERS.join(', '),
          'access-control-max-age': String(PREFLIGHT_MAX_AGE_SECONDS),
          vary,
        })
        .send()
    })
  }
}
