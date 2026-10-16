// deploy/cloudflare/doors.json and the Cloudflare guide's generated blocks,
// from the built data server's own router (0037).
//
// The two doors of the tunnel are decided by path. The administrator's and
// the runtime plane share the prefix `/v1/forms/:id`, and cloudflared routes
// by hostname and path, never by method, so no prefix separates them: a
// hand-written pattern is one missing `$` from forwarding the
// administrator's plane. So the routes are read from what the server
// registers -- three servers built through the package's public exports,
// with no plane, with the runtime plane alone and with the administrator's
// alone, under review (0065) so that its draft routes, which a server
// without review does not register, are decided too -- classified by
// difference, and written into doors.json, from
// which deploy/cloudflare/ingress.mjs renders the tunnel's configuration
// and docs/deploy/cloudflare.md shows the doors. doors.test.mjs fails when
// either is not what this renders from the built server. A fifth server,
// the runtime plane with an origin listed (0060), is read too: what it adds
// is not in doors.json, and doors.test.mjs holds it to the runtime door.
//
//   node scripts/cloudflare/doors.mjs --write   (after pnpm build)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expectations, render as renderCheck } from '../../deploy/cloudflare/check.mjs'
import { ingressYaml } from '../../deploy/cloudflare/ingress.mjs'
import { readBlock, replaceBlock } from '../generated-block.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DOORS = 'deploy/cloudflare/doors.json'
export const RATE_LIMITED = 'deploy/cloudflare/rate-limited.json'
export const GUIDE = 'docs/deploy/cloudflare.md'
const GENERATOR = 'scripts/cloudflare/doors.mjs'

/** The example names every command of the guide carries, and the gate's configure step uses. */
export const EXAMPLE = {
  admin: 'formancy.example.com',
  team: 'example-team',
  aud: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  app: 'app.example.com',
  appService: 'http://hostapp:3000',
}

/**
 * The value a route's sample gives a parameter, by the collection it names:
 * the segment before it. A parameter after any other segment has none, and
 * stops the generator, so a new kind of name is a decision rather than a
 * guess.
 */
const SAMPLES = { forms: 'order', connections: 'erp', lookups: 'customer', versions: '1', drafts: '1' }

const LINE = /^((?:│ {3}| {4})*)(?:├── |└── )(\/\S*) \(([A-Z]+(?:, [A-Z]+)*)\)$/

/**
 * Fastify's `printRoutes({ commonPrefix: false })`, read back: `[{ method,
 * path }]`, a child's path joined to its parent's. HEAD is folded into the
 * GET Fastify adds it for; a HEAD alone, and any line that is not a route,
 * stops the reading with a sentence rather than being skipped.
 */
export function parsePrintedRoutes(text) {
  const routes = []
  const parents = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const match = LINE.exec(line)
    if (match === null) throw new Error(`the router printed a line that is not a route with its methods: ${JSON.stringify(line)}`)
    const [, indent, segment, list] = match
    const depth = indent.length / 4
    if (depth > parents.length) throw new Error(`the router printed ${JSON.stringify(line)} under no route`)
    parents.length = depth
    const path = `${parents.at(-1) ?? ''}${segment}`
    parents.push(path)
    const methods = list.split(', ')
    if (methods.includes('HEAD') && !methods.includes('GET')) throw new Error(`${path} answers HEAD without GET, which Fastify adds HEAD for; the doors have no rule for it`)
    for (const method of methods.filter((entry) => entry !== 'HEAD')) routes.push({ method, path })
  }
  return routes
}

const key = (route) => `${route.method} ${route.path}`

/** A route's path with every parameter given its sample value. */
export function samplePath(path) {
  const segments = path.split('/')
  return segments
    .map((segment, index) => {
      if (!segment.startsWith(':')) return segment
      const value = SAMPLES[segments[index - 1]]
      if (value === undefined) throw new Error(`${path}: the parameter ${segment} follows "${segments[index - 1]}", which has no sample in scripts/cloudflare/doors.mjs`)
      return value
    })
    .join('/')
}

const escape = (literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The runtime door's path pattern: every runtime route's path, each
 * parameter one segment of anything but a slash, anchored at both ends.
 * cloudflared matches it against the path after it decoded and resolved it,
 * which is why the server refuses every path that is not plain (paths.ts).
 */
export function runtimePattern(routes) {
  const paths = [...new Set(routes.filter((route) => route.plane === 'runtime').map((route) => route.path))].sort()
  if (paths.length === 0) throw new Error('the runtime plane registers no route, so the runtime door would forward nothing')
  const alternatives = paths.map((path) => path.split('/').map((segment) => (segment.startsWith(':') ? '[^/]+' : escape(segment))).join('/'))
  return `^(?:${alternatives.join('|')})$`
}

/**
 * The routes of the built server at `serverRoot`, classified: `{ routes:
 * [{ method, path, plane }], limit, crossOrigin }`. Three servers through
 * the package's public exports -- no plane, the runtime plane, the
 * administrator's under review -- and a route's plane is the server it appears in
 * beyond the first; one both planes register, and a server with both that
 * is not the union, stop it. `limit` is measured: requests a server built
 * with the defaults answers before its first 429, all within the window
 * its 429 names. `crossOrigin` is `[{ method, path }]`, what the runtime
 * server adds with an origin listed (0060): never in doors.json, whose
 * servers list none, as the composed stack lists none.
 */
export async function routesFromServer(serverRoot = join(repo, 'packages', 'data-server')) {
  const server = await import(pathToFileURL(join(serverRoot, 'dist', 'index.mjs')).href)
  const scratch = mkdtempSync(join(tmpdir(), 'formancy-data-doors-'))
  try {
    const store = server.createFileConfigurationStore(scratch)
    const registry = server.createConnectionRegistry([], {})
    const audit = { sink: () => {} }
    const verifyIdentity = async () => ({ ok: false, reason: 'no token is valid here' })
    // Under review, the administrator's plane registers every route it has.
    const admin = { registry, store, adminRoles: ['data-admin', 'data-publisher'], publisherRoles: ['data-publisher'], audit }
    const planes = {
      none: {},
      runtime: { runtime: { registry, store, audit } },
      administrator: { admin },
      both: { runtime: { registry, store, audit }, admin },
      crossOrigin: { runtime: { registry, store, audit, origins: ['https://app.example'] } },
    }
    const printed = {}
    let limit
    for (const [name, options] of Object.entries(planes)) {
      const app = await server.createDataServer({ verifyIdentity, ...options })
      await app.ready()
      printed[name] = parsePrintedRoutes(app.printRoutes({ commonPrefix: false }))
      if (name === 'none') limit = await measureLimit(app)
      await app.close()
    }
    const shared = new Set(printed.none.map(key))
    const runtime = printed.runtime.filter((route) => !shared.has(key(route)))
    const administrator = printed.administrator.filter((route) => !shared.has(key(route)))
    const both = new Set(runtime.map(key))
    const twice = administrator.filter((route) => both.has(key(route)))
    if (twice.length > 0) throw new Error(`both planes register ${twice.map(key).join(', ')}, so no door can tell whose it is`)
    const union = [...printed.none, ...runtime, ...administrator].map(key).sort()
    const all = printed.both.map(key).sort()
    if (union.join('\n') !== all.join('\n')) throw new Error(`the server with both planes registers ${all.join(', ')}, not the union of the planes alone, ${union.join(', ')}`)
    const routes = [
      ...printed.none.map((route) => ({ ...route, plane: 'shared' })),
      ...runtime.map((route) => ({ ...route, plane: 'runtime' })),
      ...administrator.map((route) => ({ ...route, plane: 'administrator' })),
    ]
    const served = new Set(printed.runtime.map(key))
    return { routes, limit, crossOrigin: printed.crossOrigin.filter((route) => !served.has(key(route))) }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Requests answered before the first 429, all inside the window the 429's `retry-after` names: what one bucket holds. */
async function measureLimit(app) {
  for (let count = 0; count < 1_000_000; count += 1) {
    const response = await app.inject({ method: 'GET', url: '/v1/whoami' })
    if (response.statusCode !== 429) continue
    const retryAfter = Number(response.headers['retry-after'])
    if (!(retryAfter > 0 && retryAfter <= 60)) throw new Error(`the first 429 came after ${String(count)} requests with retry-after ${String(response.headers['retry-after'])}, not within a minute`)
    return count
  }
  throw new Error('no 429 within a million requests')
}

/** doors.json: every route with its plane, its sample and what each door does with it, sorted by path then method. */
export function renderDoors({ routes, limit }) {
  const sorted = [...routes].sort((a, b) => (a.path === b.path ? (a.method < b.method ? -1 : 1) : a.path < b.path ? -1 : 1))
  return {
    generated: 'by scripts/cloudflare/doors.mjs from the routes the built data server registers; do not edit, run node scripts/cloudflare/doors.mjs --write',
    runtimePattern: runtimePattern(routes),
    serverLimitPerMinute: limit,
    routes: sorted.map((route) => ({
      method: route.method,
      path: route.path,
      plane: route.plane,
      sample: samplePath(route.path),
      administratorDoor: 'behind Access',
      runtimeDoor: route.plane === 'runtime' ? 'forwarded' : 'not forwarded',
    })),
  }
}

const code = (value) => `\`${value}\``

/** The guide's `doors` block: every route and what each door does with it, then the pattern. */
export function doorsBlock(doors) {
  return [
    '| Method | Path | Plane | Administrator’s door | Runtime door |',
    '| --- | --- | --- | --- | --- |',
    ...doors.routes.map((route) => `| ${code(route.method)} | ${code(route.path)} | ${route.plane} | ${route.administratorDoor} | ${route.runtimeDoor} |`),
    '',
    'The runtime door forwards a path only when it matches this pattern, which setup writes into the tunnel’s configuration and checks against cloudflared:',
    '',
    '```text',
    doors.runtimePattern,
    '```',
  ].join('\n')
}

/** The guide's `rate-limit` block: the edge rule's settings, and how its threshold relates to the server's bucket for each address (0071). */
export function rateLimitBlock(doors) {
  const limit = doors.serverLimitPerMinute
  const perPeriod = limit / 6
  const per = Number.isInteger(perPeriod) ? String(perPeriod) : perPeriod.toFixed(1)
  return [
    '| Setting | Value |',
    '| --- | --- |',
    '| When incoming requests match | URI Path starts with `/v1/` |',
    '| With the same characteristics | IP |',
    '| When rate exceeds | Requests: your threshold; Period: 10 seconds |',
    '| Then take action | Block |',
    '| With response type | Custom JSON, on Pro and above; Free has no custom response, and Cloudflare answers with its own error 1015 |',
    '| With response code | `429`, on Pro and above |',
    '| Response body | the JSON below, on Pro and above |',
    '| For duration | 10 seconds |',
    '',
    `The data server counts each visitor's address on its own, as Cloudflare's edge reported it, and refuses that address, with 429, once it passes ${String(limit)} a minute unless \`FORMANCY_DATA_RATE_LIMIT\` says otherwise, which is ${per} per 10 seconds. The edge counts each address too, per Cloudflare location, so with a threshold at or below ${per} it blocks an address sending steadily before the server would refuse it, and those requests never reach your machine; above ${per}, the server's own 429 comes first.`,
  ].join('\n')
}

/** The guide's `rate-limit-body` block: rate-limited.json, as the operator pastes it. */
export function rateLimitBodyBlock(body) {
  return ['```text', JSON.stringify(body), '```'].join('\n')
}

/** The guide's `check-output` block: what doors-check prints for the example names when every door answers as it should. */
export function checkOutputBlock(doors) {
  const inputs = { admin: EXAMPLE.admin, team: EXAMPLE.team }
  const results = expectations(doors, inputs).map((expectation) => ({ expectation, pass: true }))
  return ['```text', renderCheck(results, inputs), '```'].join('\n')
}

/** The guide's `config` block: what configure writes for the example names with a host application, by ingress.mjs itself, for a tunnel id of zeros. */
export function configBlock(doors) {
  const { admin, team, aud, app } = EXAMPLE
  return ['```text', ingressYaml(doors, { admin, team, aud, app }, '00000000-0000-0000-0000-000000000000').trimEnd(), '```'].join('\n')
}

/** The guide's five blocks, by name, each with the file it renders. */
export function blocksFor(doors, body) {
  return {
    config: { from: DOORS, text: configBlock(doors) },
    doors: { from: DOORS, text: doorsBlock(doors) },
    'rate-limit': { from: DOORS, text: rateLimitBlock(doors) },
    'rate-limit-body': { from: RATE_LIMITED, text: rateLimitBodyBlock(body) },
    'check-output': { from: DOORS, text: checkOutputBlock(doors) },
  }
}

/** Each of `markdown`'s five blocks against what `doors` and `body` render: `[{ name, actual, expected }]` for those that differ. */
export function staleBlocks(markdown, doors, body) {
  return Object.entries(blocksFor(doors, body))
    .map(([name, { text }]) => ({ name, actual: readBlock(markdown, GENERATOR, { name }), expected: text }))
    .filter((entry) => entry.actual !== entry.expected)
}

/** `markdown` with its five blocks written from `doors` and `body`. */
export function rewriteGuide(markdown, doors, body) {
  let text = markdown
  for (const [name, { from, text: rendered }] of Object.entries(blocksFor(doors, body))) text = replaceBlock(text, GENERATOR, rendered, { from, name })
  return text
}

export const readJson = (path) => JSON.parse(readFileSync(join(repo, path), 'utf8'))

// `node scripts/cloudflare/doors.mjs [--write]`
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/cloudflare/doors.mjs')) {
  const doors = renderDoors(await routesFromServer())
  const text = `${JSON.stringify(doors, null, 2)}\n`
  if (process.argv.includes('--write')) {
    writeFileSync(join(repo, DOORS), text, 'utf8')
    const guide = join(repo, GUIDE)
    writeFileSync(guide, rewriteGuide(readFileSync(guide, 'utf8'), doors, readJson(RATE_LIMITED)), 'utf8')
    console.log(`${DOORS}: ${String(doors.routes.length)} routes; ${GUIDE}: ${String(Object.keys(blocksFor(doors, readJson(RATE_LIMITED))).length)} blocks written`)
  } else {
    process.stdout.write(text)
  }
}
