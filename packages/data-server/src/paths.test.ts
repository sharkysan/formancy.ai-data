import { describe, expect, test } from 'vitest'
import { CONFIGURATION_ID } from './config-store.js'
import { parseConnections } from './connections.js'
import { PATH_NOT_PLAIN, plainPath } from './paths.js'

/*
 * What a plain path is (0037). A proxy in front of this server may match a
 * path after decoding it, resolving its dot segments and collapsing its
 * slashes -- cloudflared 2026.10.0 was measured doing all three -- while
 * Fastify routes the path as sent. On a plain path there is nothing to
 * decode, resolve or collapse, so both read the same string; every other
 * path is refused before any route's work. These cases hold the line on both
 * sides: no path a client builds from a valid name is refused, and nothing
 * either reader could rewrite is let through.
 */

describe('plainPath', () => {
  // The server's own routes with the names clients send, at the edges of each
  // name's grammar: a form id with every punctuation it may hold, one ending
  // in `.js` (which a cache keys on), versions, sources. If any of these were
  // refused, a valid request from the studio or a host would be a 400.
  test.each([
    '/health',
    '/v1/whoami',
    '/v1/connections',
    '/v1/connections/erp/test',
    '/v1/connections/erp.main_1-a/metadata',
    '/v1/form-proposals',
    '/v1/forms/order',
    '/v1/forms/0',
    '/v1/forms/sales.order_v2-x',
    '/v1/forms/order.js',
    '/v1/forms/order/versions',
    '/v1/forms/order/versions/latest',
    '/v1/forms/order/versions/9007199254740991',
    '/v1/forms/order/drift',
    '/v1/forms/order/regenerations',
    '/v1/forms/order/restorations',
    '/v1/forms/order/records/read',
    '/v1/forms/order/records/create',
    '/v1/forms/order/records/update',
    '/v1/forms/order/lookups/customer-by-id/query',
    '/v1/forms/order/lookups/customer-by-id/resolve',
  ])('accepts the route %s with a valid name', (path) => {
    expect(plainPath(path)).toBe(true)
  })

  // A connection string typed raw where a name goes is plain: no reader
  // decodes or resolves any of it, so both route it to the same route, which
  // refuses the name itself. The suites that hold a caller's text out of the
  // log and the trail send it this way to reach the routes' own filters. A
  // `;` is ordinary to both readers (Fastify's useSemicolonDelimiter is off).
  test.each(['/v1/forms/Server=10.0.0.5;Password=x/records/read', '/v1/forms/a;/versions', "/v1/forms/a!$&'()*+,:@~/versions"])(
    'accepts %s, whose characters no reader rewrites',
    (path) => {
      expect(plainPath(path)).toBe(true)
    },
  )

  // The query is not routed by either reader; refusing a `%` in it would
  // refuse every search a lookup sends with a space in it.
  test.each(['/v1/connections/erp/metadata?schema=%2F..%5C', '/v1/forms/order?a=b#c', '/v1/forms/order?'])(
    'accepts %s: the query is no part of the path',
    (path) => {
      expect(plainPath(path)).toBe(true)
    },
  )

  // Each of these is a path cloudflared reads differently from Fastify, or
  // could: an escape it decodes (a slash, a dot, a backslash, a NUL, an
  // escaped escape), a backslash it reads as a slash, a dot segment it
  // resolves, a doubled slash it collapses, an empty segment, or a character
  // a path does not carry as itself. If any were accepted, a runtime-only
  // door could forward it to an administrator's route.
  test.each([
    '/v1/forms/a%2Fversions',
    '/v1/forms/x%2F../versions',
    '/v1/forms/a/versions/..%2F..%2Fb',
    '/v1/forms/a/versions/%2e%2E/b',
    '/v1/forms/a/versions/..%5C..%5Cb',
    '/v1/forms/a%00',
    '/v1/forms/a%252Fb',
    '/v1/forms/a/versions/..\\..\\b',
    '/v1/forms/a#/versions',
    '/v1/forms/a b',
    '/v1/forms/a//records/read',
    '//v1/forms/a',
    '/v1/forms/a/records/read/',
    '/v1/forms/a/./records/read',
    '/v1/forms/x/../versions',
    '/v1/forms/a/.',
    '/v1/forms/a/..',
    '/',
    '',
    '*',
    'http://formancy.example.com/v1/forms/a',
    '/v1/forms/café',
    '/v1/forms/a\u0000',
    '/v1/forms/a\t',
  ])('refuses %j', (path) => {
    expect(plainPath(path)).toBe(false)
  })
})

describe('no valid name is refused', () => {
  /** Every character a name could be asked to hold: the 256 a Latin-1 request line carries, and two beyond. */
  const characters = [...Array.from({ length: 256 }, (_, code) => String.fromCharCode(code)), '€', '\u{1F600}']

  /** `name` as the studio and data-client send it: one segment, encodeURIComponent. */
  const sent = (route: (segment: string) => string, name: string): string => route(encodeURIComponent(name))

  // A form id's grammar is the store's. If it ever admitted a character
  // that encodeURIComponent escapes -- `+`, a space -- the form could be
  // published and then never read through a client, because its path would
  // hold a `%`. Derived from the store's own expression, not a copy of it.
  test('every form id the store accepts is a plain path on every route that names one', () => {
    const accepted = characters.map((character) => `a${character}0`).filter((id) => CONFIGURATION_ID.test(id))
    expect(accepted.length).toBeGreaterThan(0)
    for (const id of accepted) {
      for (const route of [
        (form: string) => `/v1/forms/${form}`,
        (form: string) => `/v1/forms/${form}/records/read`,
        (form: string) => `/v1/forms/${form}/versions/latest`,
      ]) {
        expect(plainPath(sent(route, id)), sent(route, id)).toBe(true)
      }
    }
  })

  // The same for a connection id, read through the allowlist's parser.
  test('every connection id the allowlist accepts is a plain path', () => {
    const entry = (id: string) => ({ id, kind: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', password: 'env:P', schemas: ['s'] })
    const accepted = characters.map((character) => `a${character}0`).filter((id) => parseConnections([entry(id)]).ok)
    expect(accepted.length).toBeGreaterThan(0)
    for (const id of accepted) expect(plainPath(sent((connection) => `/v1/connections/${connection}/metadata`, id)), id).toBe(true)
  })
})

describe('PATH_NOT_PLAIN', () => {
  // A client shows the server's sentence verbatim (data-client, the studio),
  // and data-client reads a 4xx with a code and a message as a refusal:
  // nothing was written, which is true of a request no route ran for.
  test('is a code and a sentence that says why, and names no part of the path', () => {
    expect(PATH_NOT_PLAIN).toEqual({
      code: 'path-not-plain',
      message:
        "This path holds an encoded character, an empty or a dot segment, or a character a path does not carry as itself. No name here is written that way, and a proxy in front of this server may read such a path differently, so it was not routed to any route's work.",
    })
  })
})
