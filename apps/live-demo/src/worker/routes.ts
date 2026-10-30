/*
 * Which of its answers the live demo's Worker gives a request, from its
 * method and path alone (0070). The Worker runs only for what
 * wrangler.json's run_worker_first names -- the session and everything
 * under /v1/ -- and for a file under the demo's path that the assets do
 * not have; everything else of the page is a static asset that never
 * reaches it.
 */
import { PREFIX } from './limits.js'

/** The one path that starts a visitor's server, and only by POST. */
export const SESSION_PATH = `${PREFIX}/session`

/** The session's methods: GET lists the personas, POST signs one in. */
const SESSION_METHODS = ['GET', 'POST'] as const

/**
 * The runtime plane's routes, each with the one method the server
 * registers it for: 0037's runtime door, and nothing else of `/v1/`. The
 * administrator's plane shares the prefix `/v1/forms/:id` -- its versions,
 * drafts, imports, drift -- so a prefix would forward it; only these paths
 * are sent to a visitor's server. scripts/live-demo.test.mjs holds this
 * list to deploy/cloudflare/doors.json, the routes the built server
 * registers, so a route the server adds under `/v1/` fails a test until it
 * is decided here.
 */
export const RUNTIME_ROUTES: readonly { method: 'GET' | 'POST'; path: string }[] = [
  { method: 'GET', path: '/v1/forms' },
  { method: 'GET', path: '/v1/forms/:id' },
  { method: 'POST', path: '/v1/forms/:id/lookups/:source/query' },
  { method: 'POST', path: '/v1/forms/:id/lookups/:source/resolve' },
  { method: 'POST', path: '/v1/forms/:id/records/create' },
  { method: 'POST', path: '/v1/forms/:id/records/delete' },
  { method: 'POST', path: '/v1/forms/:id/records/export' },
  { method: 'POST', path: '/v1/forms/:id/records/list' },
  { method: 'POST', path: '/v1/forms/:id/records/read' },
  { method: 'POST', path: '/v1/forms/:id/records/supersede' },
  { method: 'POST', path: '/v1/forms/:id/records/update' },
]

/**
 * A route's path as a pattern: each `:name` one segment of anything but a
 * slash, as doors.json's runtimePattern writes it, and each other segment
 * itself. A segment that is not plain still matches, for the server's own
 * 400 path-not-plain (0037's P3).
 */
const patternOf = (path: string): RegExp => new RegExp(`^${path.replace(/:[a-z]+/g, '[^/]+')}$`)

const RUNTIME = RUNTIME_ROUTES.map((route) => ({ ...route, pattern: patternOf(route.path) }))

export type Route =
  /** The personas and the idle time, from constants: nothing is started. */
  | { kind: 'session-index' }
  /** A persona's sign-in, which starts the visitor's server when it is not running. */
  | { kind: 'sign-in' }
  /** Sent to the visitor's server at `path`: the demo's path taken off, the query kept, nothing else changed. */
  | { kind: 'forward'; path: string }
  | { kind: 'method-not-allowed'; allow: readonly string[] }
  | { kind: 'not-found' }

/**
 * The route of `method` on `url`, whose path the URL parser has already
 * made absolute -- a dot segment, `%2e%2e` included, is resolved before
 * this sees it. An escape is not decoded: a path that is not plain is sent
 * as written, for the server's own 400 path-not-plain (0037's P3).
 */
export function routeOf(method: string, url: URL): Route {
  if (url.pathname === SESSION_PATH) {
    if (!(SESSION_METHODS as readonly string[]).includes(method)) return { kind: 'method-not-allowed', allow: SESSION_METHODS }
    return method === 'GET' ? { kind: 'session-index' } : { kind: 'sign-in' }
  }
  if (!url.pathname.startsWith(`${PREFIX}/v1/`)) return { kind: 'not-found' }
  const path = url.pathname.slice(PREFIX.length)
  const routes = RUNTIME.filter((route) => route.pattern.test(path))
  if (routes.length === 0) return { kind: 'not-found' }
  if (!routes.some((route) => route.method === method)) return { kind: 'method-not-allowed', allow: routes.map((route) => route.method) }
  return { kind: 'forward', path: `${path}${url.search}` }
}
