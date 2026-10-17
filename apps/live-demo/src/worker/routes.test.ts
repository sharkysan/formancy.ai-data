import { describe, expect, test } from 'vitest'
import { PREFIX } from './limits.js'
import { routeOf, RUNTIME_ROUTES } from './routes.js'

/**
 * Which of its four answers the Worker gives a request (0070). The Worker
 * runs only for the paths wrangler.json's run_worker_first names and for a
 * file the assets do not have, so every request here is under the demo's
 * path; what it sends a visitor's server is the runtime plane's door and
 * nothing else (0037's runtime pattern), with the demo's path taken off.
 * scripts/live-demo.test.mjs holds RUNTIME_ROUTES to the routes the built
 * server registers (deploy/cloudflare/doors.json); this holds what the
 * Worker does with them.
 */
const at = (path: string): URL => new URL(`https://formancy.ai${path}`)

describe("the Worker's routes", () => {
  // The session is the one path that starts anything, and only by POST: a
  // GET of it lists the personas from constants, so a crawler that follows
  // every link starts no container.
  test('answers the session path with the personas on GET and a sign-in on POST, and nothing else', () => {
    expect(routeOf('GET', at(`${PREFIX}/session`))).toEqual({ kind: 'session-index' })
    expect(routeOf('POST', at(`${PREFIX}/session`))).toEqual({ kind: 'sign-in' })
    for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      expect(routeOf(method, at(`${PREFIX}/session`)), method).toEqual({ kind: 'method-not-allowed', allow: ['GET', 'POST'] })
    }
    expect(routeOf('GET', at(`${PREFIX}/session/`))).toEqual({ kind: 'not-found' })
    expect(routeOf('POST', at(`${PREFIX}/sessions`))).toEqual({ kind: 'not-found' })
  })

  // The runtime plane's door, with the demo's path taken off and the query
  // kept: a path sent with the prefix would be the server's 404, and one
  // that lost its query a list without its search.
  test('forwards each runtime route by its method, without the demo path and with the query', () => {
    expect(routeOf('GET', at(`${PREFIX}/v1/forms`))).toEqual({ kind: 'forward', path: '/v1/forms' })
    expect(routeOf('GET', at(`${PREFIX}/v1/forms/order`))).toEqual({ kind: 'forward', path: '/v1/forms/order' })
    expect(routeOf('POST', at(`${PREFIX}/v1/forms/order/records/list`))).toEqual({ kind: 'forward', path: '/v1/forms/order/records/list' })
    expect(routeOf('POST', at(`${PREFIX}/v1/forms/order/lookups/customer/query?x=1`))).toEqual({ kind: 'forward', path: '/v1/forms/order/lookups/customer/query?x=1' })
    for (const route of RUNTIME_ROUTES) {
      const path = route.path.replace(':id', 'order-line').replace(':source', 'order')
      expect(routeOf(route.method, at(`${PREFIX}${path}`)), `${route.method} ${route.path}`).toEqual({ kind: 'forward', path })
    }
  })

  // The administrator's plane shares the prefix /v1/forms/:id with the
  // runtime plane, and 0037's runtime door forwards none of it: a Worker
  // that forwarded the prefix would leave only the image's settings between
  // a visitor and publishing, importing or approving a form. Each route the
  // server registers there, as deploy/cloudflare/doors.json samples it, is
  // the Worker's own 404, by either method, and wakes no server.
  test("answers 404 for the administrator's routes under /v1/forms, by either method", () => {
    const administrator = ['versions', 'versions/1', 'versions/latest', 'imports', 'restorations', 'regenerations', 'drift', 'drafts', 'drafts/1', 'drafts/1/approval', 'drafts/1/rejection']
    for (const rest of administrator) {
      for (const method of ['GET', 'POST']) expect(routeOf(method, at(`${PREFIX}/v1/forms/order/${rest}`)), `${method} ${rest}`).toEqual({ kind: 'not-found' })
    }
    for (const path of ['/v1/forms/order/records', '/v1/forms/order/records/list/x', '/v1/forms/order/lookups/customer', '/v1/forms/order/lookups/customer/search', '/v1/forms/order/x', '/v1/forms/order/']) {
      expect(routeOf('POST', at(`${PREFIX}${path}`)), path).toEqual({ kind: 'not-found' })
    }
  })

  // Every route of the runtime plane answers one method
  // (packages/data-server/src/routes/runtime*.ts); another is not one of
  // its routes, and saying so here costs the visitor's server nothing.
  test('forwards only the method each route has, and names it', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      expect(routeOf(method, at(`${PREFIX}/v1/forms/order`)), method).toEqual({ kind: 'method-not-allowed', allow: ['GET'] })
    }
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect(routeOf(method, at(`${PREFIX}/v1/forms/order/records/list`)), method).toEqual({ kind: 'method-not-allowed', allow: ['POST'] })
    }
  })

  // /v1/connections, /v1/health or a name that only begins like `forms` is
  // no request the page makes, and the Worker does not wake a server for
  // it.
  test('answers 404 for /v1/ outside forms, and for any other path under the demo', () => {
    for (const path of ['/v1', '/v1/', '/v1/connections', '/v1/health', '/v1/formsx', '/v1/forms-old/x', '/health', '/', '/nope.js', '/assets/missing-12345678.js']) {
      expect(routeOf('GET', at(`${PREFIX}${path}`)), path).toEqual({ kind: 'not-found' })
      expect(routeOf('POST', at(`${PREFIX}${path}`)), path).toEqual({ kind: 'not-found' })
    }
    expect(routeOf('GET', at('/data/demo-old/v1/forms'))).toEqual({ kind: 'not-found' })
    expect(routeOf('GET', at('/v1/forms'))).toEqual({ kind: 'not-found' })
  })

  // What is not plain inside a segment -- an encoded slash or dot, a space
  // -- is passed on as written, for the server's own 400 path-not-plain
  // (0037's P3), rather than a second list of what is plain written here.
  // An empty segment, a doubled or trailing slash, is a path no route has,
  // and the Worker's 404. The URL parser has already resolved a dot segment
  // before the Worker sees the path, `%2e%2e` included, so climbing out of
  // /v1/forms lands on a path this answers 404.
  test('passes an escape through as written, and sees a dot segment already resolved', () => {
    expect(routeOf('GET', at(`${PREFIX}/v1/forms/a%2Fb`))).toEqual({ kind: 'forward', path: '/v1/forms/a%2Fb' })
    expect(routeOf('GET', at(`${PREFIX}/v1/forms/..%2F..%2Fb`))).toEqual({ kind: 'forward', path: '/v1/forms/..%2F..%2Fb' })
    expect(routeOf('POST', at(`${PREFIX}/v1/forms/a%2Fb/records/read`))).toEqual({ kind: 'forward', path: '/v1/forms/a%2Fb/records/read' })
    expect(routeOf('GET', at(`${PREFIX}/v1/forms/order%20x`))).toEqual({ kind: 'forward', path: '/v1/forms/order%20x' })
    expect(routeOf('GET', at(`${PREFIX}/v1/forms/%2E`))).toEqual({ kind: 'not-found' })
    expect(routeOf('GET', at(`${PREFIX}/v1/forms//order`))).toEqual({ kind: 'not-found' })
    expect(routeOf('GET', at(`${PREFIX}/v1/forms/../connections`))).toEqual({ kind: 'not-found' })
    expect(routeOf('GET', at(`${PREFIX}/v1/forms/%2e%2e/%2e%2e/admin`))).toEqual({ kind: 'not-found' })
    expect(routeOf('GET', at(`${PREFIX}/v1/forms\\order`))).toEqual({ kind: 'forward', path: '/v1/forms/order' })
  })
})
