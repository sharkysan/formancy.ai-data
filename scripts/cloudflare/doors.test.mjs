import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { DOORS, GUIDE, parsePrintedRoutes, RATE_LIMITED, readJson, renderDoors, routesFromServer, runtimePattern, staleBlocks } from './doors.mjs'

/**
 * The tunnel's two doors, as the built data server's router has them
 * (0037). The planes share the prefix `/v1/forms/:id` and cloudflared
 * chooses a rule by hostname and path, never by method, so the runtime
 * door's pattern is generated from the routes the server registers, and
 * this fails when deploy/cloudflare/doors.json, the pattern or the guide's
 * blocks are not what that router gives.
 *
 * It needs `pnpm build`, as `verify` runs it after: the routes are the built
 * server's, through the package's public exports, as mint-token.test.mjs
 * reads the built verifier.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fresh = renderDoors(await routesFromServer())
const committed = readJson(DOORS)
const key = (route) => `${route.method} ${route.path}`

describe('deploy/cloudflare/doors.json', () => {
  // A route the server added and doors.json does not have is a route
  // neither door was decided for; a runtime route left out is one the host
  // application cannot reach. Named route by route, with the command that
  // writes the file.
  test('is what the built server’s router gives', () => {
    const missing = fresh.routes.filter((route) => !committed.routes.some((entry) => key(entry) === key(route)))
    const gone = committed.routes.filter((route) => !fresh.routes.some((entry) => key(entry) === key(route)))
    expect([...missing.map((route) => `${key(route)} is not in ${DOORS}`), ...gone.map((route) => `${key(route)} is in ${DOORS} and the server has no such route`)], 'run node scripts/cloudflare/doors.mjs --write').toEqual([])
    expect(committed, `${DOORS} is not what the server gives: run node scripts/cloudflare/doors.mjs --write`).toEqual(fresh)
  })

  // A timestamp would change the file on every run and make the check
  // above a check of the clock.
  test('says what made it in a fixed sentence', () => {
    expect(committed.generated).toMatch(/^by scripts\/cloudflare\/doors\.mjs from the routes the built data server registers/)
  })
})

describe('the runtime door’s pattern', () => {
  const pattern = new RegExp(fresh.runtimePattern)
  const samples = (plane) => fresh.routes.filter((route) => plane(route.plane))

  // The pattern cloudflared matches must let through every runtime route
  // and no other: one administrator route it matched would be forwarded to
  // the internet without Access in front of it. JavaScript's RegExp and
  // cloudflared's RE2 agree on this subset -- literals, `[^/]+`,
  // alternation and anchors -- and the CI job asks cloudflared itself.
  test('matches every runtime route’s sample and no administrator’s or shared one', () => {
    expect(samples((plane) => plane === 'runtime').filter((route) => !pattern.test(route.sample)).map(key)).toEqual([])
    expect(samples((plane) => plane !== 'runtime').filter((route) => pattern.test(route.sample)).map(key)).toEqual([])
  })

  // cloudflared routes by path and never by method, so a path it forwards
  // must be runtime for every method the server registers there: an
  // administrator's DELETE on /v1/forms/:id would ride through the runtime
  // door with the GET.
  test('forwards no path at which another plane registers a method', () => {
    const forwarded = fresh.routes.filter((route) => pattern.test(route.sample))
    const sharing = fresh.routes.filter((route) => route.plane !== 'runtime' && forwarded.some((other) => other.path === route.path))
    expect(sharing.map(key)).toEqual([])
  })

  // An unanchored or half-anchored pattern is the hand-written mistake this
  // generator exists to rule out.
  test('is anchored at both ends, one alternative per runtime path', () => {
    expect(fresh.runtimePattern).toMatch(/^\^\(\?:.*\)\$$/)
    expect(fresh.runtimePattern.slice(4, -2).split('|')).toHaveLength(new Set(samples((plane) => plane === 'runtime').map((route) => route.path)).size)
    expect(() => runtimePattern([])).toThrow(/registers no route/)
  })
})

describe('the router’s printed routes', () => {
  // A line the reader skipped would be a route doors.json never decided.
  test('are read whole, HEAD folded into GET, and anything else refused', () => {
    const text = ['├── /health (GET, HEAD)', '└── /v1/forms/:id (GET, HEAD)', '    ├── /records/read (POST)', '    └── /versions (POST, GET, HEAD)', '        └── /:version (GET, HEAD)', ''].join('\n')
    expect(parsePrintedRoutes(text)).toEqual([
      { method: 'GET', path: '/health' },
      { method: 'GET', path: '/v1/forms/:id' },
      { method: 'POST', path: '/v1/forms/:id/records/read' },
      { method: 'POST', path: '/v1/forms/:id/versions' },
      { method: 'GET', path: '/v1/forms/:id/versions' },
      { method: 'GET', path: '/v1/forms/:id/versions/:version' },
    ])
    expect(() => parsePrintedRoutes('├── /v1/forms/:id')).toThrow(/not a route with its methods/)
    expect(() => parsePrintedRoutes('├── /x (HEAD)')).toThrow(/HEAD without GET/)
    expect(() => parsePrintedRoutes('    ├── /orphan (GET)')).toThrow(/under no route/)
  })
})

describe('docs/deploy/cloudflare.md', () => {
  // The guide shows the configuration configure writes, the doors, the edge
  // rule's settings and the check's output; a hand edit there -- a pattern
  // shortened by one `$`, Access dropped from the example -- would be a
  // door the guide describes and nothing configures.
  test('holds the five blocks doors.json and rate-limited.json render', () => {
    const stale = staleBlocks(readFileSync(join(repo, GUIDE), 'utf8'), committed, readJson(RATE_LIMITED))
    expect(stale.map(({ name }) => `the block "${name}" is not what scripts/cloudflare/doors.mjs renders: run node scripts/cloudflare/doors.mjs --write`)).toEqual([])
  })
})

describe('deploy/cloudflare/rate-limited.json', () => {
  // The edge's custom block body: data-client reads a 4xx with a string
  // `message` as a refusal (nothing was written) and anything else as an
  // unknown write. Cloudflare takes a body of at most 30 KB.
  test('is JSON with a string code and message, within the 30 KB Cloudflare takes', () => {
    const text = readFileSync(join(repo, RATE_LIMITED), 'utf8')
    const body = JSON.parse(text)
    expect(Object.keys(body).sort()).toEqual(['code', 'message'])
    expect(typeof body.code).toBe('string')
    expect(typeof body.message).toBe('string')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(30_000)
  })
})
