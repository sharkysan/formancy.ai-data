/*
 * Which of its answers the live demo's Worker gives a request, from its
 * method and path alone (0070). The Worker runs only for what
 * wrangler.json's run_worker_first names -- the session and the runtime
 * plane's door -- and for a file under the demo's path that the assets do
 * not have; everything else of the page is a static asset that never
 * reaches it.
 */
import { PREFIX } from './limits.js'

/** The one path that starts a visitor's server, and only by POST. */
export const SESSION_PATH = `${PREFIX}/session`

/**
 * The runtime plane's door under the demo's path: `/v1/forms` and below,
 * the paths 0037's runtime pattern names, and not the rest of `/v1/`.
 */
export const RUNTIME_PATH = `${PREFIX}/v1/forms`

/** Every route of the runtime plane is one of these (packages/data-server/src/routes/runtime*.ts). */
const METHODS = ['GET', 'POST'] as const

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
  const known = (METHODS as readonly string[]).includes(method)
  if (url.pathname === SESSION_PATH) {
    if (!known) return { kind: 'method-not-allowed', allow: METHODS }
    return method === 'GET' ? { kind: 'session-index' } : { kind: 'sign-in' }
  }
  if (url.pathname === RUNTIME_PATH || url.pathname.startsWith(`${RUNTIME_PATH}/`)) {
    if (!known) return { kind: 'method-not-allowed', allow: METHODS }
    return { kind: 'forward', path: `${url.pathname.slice(PREFIX.length)}${url.search}` }
  }
  return { kind: 'not-found' }
}
