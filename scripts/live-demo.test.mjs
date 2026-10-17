import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { MAX_INSTANCES, PREFIX, routeOf, RUNTIME_ROUTES, SESSION_PATH } from '../apps/live-demo/dist/worker/pure.mjs'
import { DOORS, readJson, runtimePattern } from './cloudflare/doors.mjs'
import { buildProblems, namingProblems, viteBuild, WRANGLER } from './demo.mjs'
import { contentSecurityPolicy, headersFor, parseHeadersFile, policyProblems, POLICY } from './demo-headers.mjs'
import { DEMO_BUILD, deployArguments, LIVE_CONFIG, LIVE_WORKER, liveConfigProblems, liveDemoBase, liveDemoUrl, readLiveDemoConfig } from './live-demo.mjs'
import { LIVE_ALLOWED, LIVE_POLICY, liveHeaderRules, liveHeadersFile } from './live-demo-headers.mjs'
import { NOTICES_FILE } from './third-party-notices.mjs'

/**
 * The live demo on formancy.ai (0070): the Worker's config, the deploy's
 * refusals, the headers the page is served with, and the prose that names
 * the Worker, its commands and its repository, held to the config, the
 * Worker's own constants (apps/live-demo/dist/worker/pure.mjs, so `pnpm
 * build` first, as for scripts/mint-token.test.mjs) and the host page they
 * depend on. Unlike the examples' Worker this one runs code and starts
 * containers, which cost money while they run, so what the config may say
 * is exactly the demo's and nothing more.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...path) => readFileSync(join(repo, ...path), 'utf8').replaceAll('\r\n', '\n')
const root = JSON.parse(read('package.json'))
const config = readLiveDemoConfig()
const hostApp = join(repo, 'apps', 'host')

/** A copy of the committed config with `change` applied to it. */
const changed = (change) => {
  const copy = structuredClone(config)
  change(copy)
  return copy
}

describe('the live demo on formancy.ai (0070)', () => {
  // The Worker as committed: the demo's path of formancy.ai, its assets,
  // one container of the demo's image, one Durable Object class, and no
  // address beside the route.
  test("the live demo's Wrangler config is the demo's, at /data/demo/ of formancy.ai and nowhere else", () => {
    expect(liveConfigProblems(config)).toEqual([])
    expect(liveDemoBase()).toBe('/data/demo/')
    expect(liveDemoUrl()).toBe('https://formancy.ai/data/demo/')
  })

  // The config and the Worker's code say the same thing twice -- where
  // the demo is, how many servers may run -- and only the code's copy
  // reaches a visitor, in its routes and its start failure. Held to each
  // other, so a cap raised in one is raised in both.
  test("names the Worker's path and its cap, as the Worker's own constants say them", () => {
    expect(config.routes.map((route) => route.pattern).sort()).toEqual([`formancy.ai${PREFIX}`, `formancy.ai${PREFIX}/*`])
    expect(config.containers[0].max_instances).toBe(MAX_INSTANCES)
    expect(config.assets.run_worker_first).toEqual([SESSION_PATH, `${PREFIX}/v1/*`])
    for (const route of RUNTIME_ROUTES) expect(route.path.startsWith('/v1/'), route.path).toBe(true)
  })

  // The Worker sends a visitor's server exactly what 0037's runtime door
  // forwards: the runtime plane's routes, each by its method, and none of
  // the administrator's, which shares the prefix /v1/forms/:id. Held to
  // doors.json, the routes the built server registers (doors.test.mjs holds
  // it to the server), so a route the server adds is decided in the Worker
  // too, rather than forwarded by a prefix nobody looked at again.
  test("forwards exactly the routes 0037's runtime door does, each by its method", () => {
    const doors = readJson(DOORS)
    expect(runtimePattern(RUNTIME_ROUTES.map((route) => ({ ...route, plane: 'runtime' })))).toBe(doors.runtimePattern)
    const forwarded = doors.routes.filter((route) => route.runtimeDoor === 'forwarded')
    expect(RUNTIME_ROUTES.map((route) => `${route.method} ${route.path}`).sort()).toEqual(forwarded.map((route) => `${route.method} ${route.path}`).sort())
    expect(doors.routes.length).toBeGreaterThan(forwarded.length)
    for (const route of doors.routes) {
      const decided = routeOf(route.method, new URL(`https://formancy.ai${PREFIX}${route.sample}`))
      if (route.runtimeDoor === 'forwarded') expect(decided, `${route.method} ${route.path}`).toEqual({ kind: 'forward', path: route.sample })
      else expect(decided.kind, `${route.method} ${route.path}`).not.toBe('forward')
    }
  })

  // Wrangler resolves these relative to the config: a Worker whose code or
  // image is not where it says fails at deploy, after the Worker is live.
  test('names files that are there: the Worker, the Dockerfile, and the repository root as its build context', () => {
    const at = join(repo, dirname(LIVE_CONFIG))
    expect(existsSync(join(at, config.main))).toBe(true)
    expect(existsSync(join(at, config.containers[0].image))).toBe(true)
    expect(resolve(at, config.containers[0].image_build_context)).toBe(resolve(repo))
    expect(existsSync(join(repo, '.dockerignore'))).toBe(true)
  })

  // Each would put something other than the live demo at formancy.ai, put
  // it somewhere else too, or give it more than it has: another Worker's
  // site replaced; an address beside the route; a secret, a variable or a
  // binding nothing in the Worker reads; a container larger, more numerous,
  // reachable over SSH or of another image; a Durable Object of another
  // Worker; or Cloudflare keeping every visitor's requests in its logs.
  test.each([
    ["formancy.ai's own Worker", (c) => (c.name = 'formancy-ai'), 'formancy-data-demo'],
    ["the examples' Worker", (c) => (c.name = 'formancy-data-examples'), 'formancy-data-demo'],
    ["the report's Worker", (c) => (c.name = 'formancy-report-studio'), 'formancy-data-demo'],
    ['no name', (c) => delete c.name, 'formancy-data-demo'],
    ['other code', (c) => (c.main = 'src/other.ts'), 'main'],
    ['no code', (c) => delete c.main, 'main'],
    ['a workers.dev address', (c) => (c.workers_dev = true), 'workers_dev'],
    ['a version address', (c) => (c.preview_urls = true), 'preview_urls'],
    ['a variable', (c) => (c.vars = { MODE: 'demo' }), 'vars'],
    ['a secret', (c) => (c.secrets = { required: ['KEY'] }), 'secrets'],
    ['a KV namespace', (c) => (c.kv_namespaces = [{ binding: 'CACHE', id: 'x' }]), 'kv_namespaces'],
    ['an R2 bucket', (c) => (c.r2_buckets = [{ binding: 'FILES', bucket_name: 'x' }]), 'r2_buckets'],
    ['a D1 database', (c) => (c.d1_databases = [{ binding: 'DB', database_id: 'x' }]), 'd1_databases'],
    ['a queue', (c) => (c.queues = { producers: [{ binding: 'Q', queue: 'x' }] }), 'queues'],
    ['a service binding', (c) => (c.services = [{ binding: 'SITE', service: 'formancy-ai' }]), 'services'],
    ['an AI binding', (c) => (c.ai = { binding: 'AI' }), 'ai'],
    ['migrations beside the exports', (c) => (c.migrations = [{ tag: 'v1', new_sqlite_classes: ['DemoServer'] }]), 'migrations'],
    ['an assets binding, which would let code read the files', (c) => (c.assets.binding = 'ASSETS'), 'assets.binding'],
    ['the Worker run before every file', (c) => (c.assets.run_worker_first = true), 'run_worker_first'],
    ['the Worker run before the page', (c) => c.assets.run_worker_first.push('/data/demo/'), 'run_worker_first'],
    ['the Worker not run for the session', (c) => (c.assets.run_worker_first = ['/data/demo/v1/*']), 'run_worker_first'],
    ['assets staged elsewhere', (c) => (c.assets.directory = './dist'), '.cloudflare'],
    ['no redirect from /data/demo to /data/demo/', (c) => (c.assets.html_handling = 'none'), 'auto-trailing-slash'],
    ['the page answering every missing path', (c) => (c.assets.not_found_handling = 'single-page-application'), 'not_found_handling'],
    ['a route on another zone', (c) => (c.routes[0].zone_name = 'example.com'), 'example.com'],
    ['no route for the path without its slash', (c) => c.routes.splice(1, 1), 'formancy.ai/data/demo on the zone'],
    ['no route for what is below the path', (c) => c.routes.splice(0, 1), 'formancy.ai/data/demo/* on the zone'],
    ["the product's own path, /data", (c) => c.routes.push({ pattern: 'formancy.ai/data', zone_name: 'formancy.ai' }), 'formancy.ai/data '],
    ["the examples' path", (c) => c.routes.push({ pattern: 'formancy.ai/data/examples/*', zone_name: 'formancy.ai' }), 'formancy.ai/data/examples/*'],
    ['the whole site', (c) => c.routes.push({ pattern: 'formancy.ai/*', zone_name: 'formancy.ai' }), 'formancy.ai/*'],
    ['another hostname of the zone', (c) => c.routes.push({ pattern: 'www.formancy.ai/data/demo/*', zone_name: 'formancy.ai' }), 'www.formancy.ai'],
    ['a custom domain', (c) => c.routes.push({ pattern: 'demo.formancy.ai', custom_domain: true }), 'custom_domain'],
    ['a route by zone id', (c) => (c.routes[0] = { pattern: 'formancy.ai/data/demo/*', zone_id: 'x' }), 'zone'],
    ['no container', (c) => delete c.containers, 'containers'],
    ['two containers', (c) => c.containers.push({ ...c.containers[0], class_name: 'Other' }), 'exactly one'],
    ['another image', (c) => (c.containers[0].image = '../../deploy/web/Dockerfile'), 'image'],
    ['an image from a registry', (c) => (c.containers[0].image = 'registry.cloudflare.com/x/demo:latest'), 'image'],
    ['another build context', (c) => (c.containers[0].image_build_context = '.'), 'image_build_context'],
    ['a larger instance', (c) => (c.containers[0].instance_type = 'standard-1'), 'instance_type'],
    ['a custom instance', (c) => (c.containers[0].instance_type = { vcpu: 4, memory_mib: 12288, disk_mb: 20000 }), 'instance_type'],
    ['a higher cap', (c) => (c.containers[0].max_instances = 20), 'max_instances'],
    ["Wrangler's default cap", (c) => delete c.containers[0].max_instances, 'max_instances'],
    ['SSH into the container', (c) => (c.containers[0].ssh = { enabled: true }), 'ssh'],
    ['authorized keys', (c) => (c.containers[0].authorized_keys = [{ name: 'k', public_key: 'ssh-ed25519 x' }]), 'authorized_keys'],
    ['placement constraints', (c) => (c.containers[0].constraints = { regions: ['EEUR'] }), 'constraints'],
    ['image variables', (c) => (c.containers[0].image_vars = { KEY: 'x' }), 'image_vars'],
    ["the container's own logs", (c) => (c.containers[0].observability = { logs: { enabled: true } }), 'observability'],
    ['the durable_object scheduling policy', (c) => (c.containers[0].scheduling_policy = 'durable_object'), 'scheduling_policy'],
    ['another Durable Object class', (c) => (c.containers[0].class_name = 'Other'), 'class_name'],
    ['another binding name', (c) => (c.durable_objects.bindings[0].name = 'OTHER'), 'durable_objects'],
    ["another Worker's Durable Object", (c) => (c.durable_objects.bindings[0].script_name = 'formancy-ai'), 'durable_objects'],
    ['a second binding', (c) => c.durable_objects.bindings.push({ name: 'MORE', class_name: 'More' }), 'durable_objects'],
    ['key-value storage for the class', (c) => (c.exports.DemoServer.storage = 'kv'), 'exports'],
    ['a second export', (c) => (c.exports.Other = { type: 'durable-object', storage: 'sqlite' }), 'exports'],
    ['no exports', (c) => delete c.exports, 'exports'],
    ['observability on', (c) => (c.observability.enabled = true), 'observability'],
    ['logs on', (c) => (c.observability.logs = { enabled: true }), 'observability'],
    ['no observability setting, which is not off', (c) => delete c.observability, 'observability'],
  ])('refuses %s', (_name, change, says) => {
    const problems = liveConfigProblems(changed(change))
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain(says)
  })

  // The deploy with the Wrangler the examples' deploy pins, one for both
  // (0069), never whatever npx finds newest; the commit in the message;
  // every running container replaced at once when the image changed, which
  // a demo whose data resets anyway can afford; and a dry run that is the
  // same command with --dry-run and nothing else, so what it checked is
  // what a deploy would do.
  test('deploys with the pinned Wrangler, the config, the commit and an immediate rollout; the dry run adds --dry-run alone', () => {
    expect(deployArguments('abc', false)).toEqual(['--yes', WRANGLER, 'deploy', '--config', 'apps/live-demo/wrangler.json', '--message', 'formancy.ai-data@abc', '--containers-rollout=immediate'])
    expect(deployArguments('abc', true)).toEqual([...deployArguments('abc', false), '--dry-run'])
    expect(root.scripts['live-demo:deploy']).toBe('pnpm build && node scripts/live-demo.mjs')
  })

  // scripts/demo.mjs ran its deploy whenever the program's path ended in
  // demo.mjs, and live-demo.mjs ends so and imports it: running the live
  // demo's deploy would have deployed the examples page first. Each runs
  // only as the program it is.
  test("running the live demo's deploy runs no other deploy", () => {
    const result = spawnSync(process.execPath, [join(repo, 'scripts', 'live-demo.mjs'), '--not-an-option'], { cwd: repo, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('usage: node scripts/live-demo.mjs [--dry-run]')
    expect(result.stderr).not.toContain('scripts/demo.mjs [--dry-run]')
  })

  // The deploy refuses a checkout with changes, and makes two directories
  // of its own in it: the host page's demo build and the staging. Not
  // ignored, a second deploy from the same checkout would refuse its own
  // outputs as uncommitted changes.
  test("ignores the deploy's own outputs, so a second deploy finds the checkout clean", () => {
    const result = spawnSync('git', ['check-ignore', `${DEMO_BUILD}/index.html`, 'apps/live-demo/.cloudflare/_headers'], { cwd: repo, encoding: 'utf8' })
    expect(result.stdout.trim().split('\n')).toEqual([`${DEMO_BUILD}/index.html`, 'apps/live-demo/.cloudflare/_headers'])
  })

  // Cloudflare's Workers Builds runs the commands its dashboard holds, which
  // nothing here can read; REPO-METADATA.md records them, for this Worker
  // and this repository as data-core's manifest names it. A name or a slug
  // copied from the examples' section would deploy the live demo over the
  // examples page, or connect another repository.
  test("REPO-METADATA.md's live demo settings are pnpm live-demo:deploy's halves, for this Worker and this repository", () => {
    const metadata = read('.github', 'REPO-METADATA.md')
    const start = metadata.indexOf("\n## The live demo's Worker on Cloudflare\n")
    expect(start).toBeGreaterThan(-1)
    const section = metadata.slice(start, metadata.indexOf('\n## ', start + 1))
    const setting = (name) => new RegExp(`^\\| ${name} \\| \`([^\`]+)\` \\|`, 'm').exec(section)?.[1]
    const repository = JSON.parse(read('packages', 'data-core', 'package.json')).repository.url.replace(/^git\+https:\/\/github\.com\//, '').replace(/\.git$/, '')
    expect(setting('Worker')).toBe(LIVE_WORKER)
    expect(setting('Git repository')).toBe(repository)
    expect(setting('Root directory')).toBe('/')
    expect(setting('Production branch')).toBe('main')
    expect(`${String(setting('Build command'))} && ${String(setting('Deploy command'))}`).toBe(root.scripts['live-demo:deploy'])
    const named = [...section.matchAll(/\bsharkysan\/[\w.-]*[\w-]/g)].map((match) => match[0])
    expect(named.length).toBeGreaterThan(1)
    for (const each of named) expect(each).toBe(repository)
    const workers = [...section.matchAll(/\bformancy-(?!ai\b)[a-z][a-z-]*[a-z]/g)].map((match) => match[0])
    expect(workers.length).toBeGreaterThan(1)
    for (const each of workers) expect(each).toBe(LIVE_WORKER)
  })

  // 0070 says GitHub holds no Cloudflare token and never deploys the live
  // demo either. A workflow step that ran it, or read a token for it, would
  // make that false while every gate stayed green. The image's own gate
  // may run in CI; deploying it may not.
  test('no workflow deploys the live demo or holds a Cloudflare token', () => {
    const directory = join(repo, '.github', 'workflows')
    const files = readdirSync(directory).filter((file) => file.endsWith('.yml'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(read('.github', 'workflows', file), file).not.toMatch(/\bwrangler\b|live-demo\.mjs|live-demo:deploy|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|cloudflare\/wrangler-action/i)
    }
  })
})

describe("the live demo's headers (0070)", () => {
  const base = liveDemoBase()
  const rules = liveHeaderRules(base)

  // The examples page's policy with one source added in one directive: the
  // style elements AG Grid injects need 'unsafe-inline' in style-src. Every
  // other directive is 0069's, scripts above all; a second loosening is a
  // change to the record, not to this file.
  test("is the examples page's policy with 'unsafe-inline' in style-src, and nothing else", () => {
    expect(LIVE_ALLOWED).toEqual({ 'style-src': ["'unsafe-inline'"] })
    expect(LIVE_POLICY).toEqual({ ...POLICY, 'style-src': [...POLICY['style-src'], "'unsafe-inline'"] })
    expect(contentSecurityPolicy(LIVE_POLICY)).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
  })

  // The host page's index.html and the stylesheets it draws with, as they
  // are before the build: the hosts the policy names are the ones it loads,
  // and data: images only because the theme draws them. What the built page
  // holds is what scripts/live-demo.mjs checks at deploy, against the same
  // policy and allowance.
  test('names exactly the hosts the host page loads, with its one allowance and no other', () => {
    const html = read('apps', 'host', 'index.html')
    const styles = join(hostApp, 'src', 'styles')
    const stylesheets = [
      readFileSync(createRequire(join(hostApp, 'package.json')).resolve('@formancy/themes/blueprint.css'), 'utf8'),
      read('apps', 'host', 'src', 'host.css'),
      ...readdirSync(styles).map((file) => readFileSync(join(styles, file), 'utf8')),
    ]
    const page = { html, stylesheets, address: liveDemoUrl() }
    expect(policyProblems(LIVE_POLICY, page, { allowed: LIVE_ALLOWED })).toEqual([])
    // Without the allowance it is a loose policy like any other, and the
    // allowance is no licence for the page itself to carry a style.
    expect(policyProblems(LIVE_POLICY, page)).toEqual(["style-src allows 'unsafe-inline'"])
    expect(policyProblems(LIVE_POLICY, { ...page, html: html.replace('<div id="root">', '<div id="root" style="color: red">') }, { allowed: LIVE_ALLOWED })).toEqual([
      'index.html has an inline style, which style-src allows only for what a script injects',
    ])
    expect(policyProblems(LIVE_POLICY, page, { allowed: { 'script-src': ["'unsafe-inline'"] } })).toEqual(["style-src allows 'unsafe-inline'"])
  })

  // The file Workers Static Assets read, parsed back as Cloudflare's
  // documentation describes the format: the page and its files with the
  // live policy and its companions, the hashed chunks a year's cache, the
  // notices as UTF-8, and nothing for any other path of formancy.ai --
  // the examples page's included.
  test('the _headers file reads back as the rules, and gives each path what Cloudflare would', () => {
    const text = liveHeadersFile(base)
    expect(text.split('\n')[0]).toBe('# Written by scripts/live-demo.mjs from scripts/live-demo-headers.mjs (0070).')
    expect(parseHeadersFile(text)).toEqual(rules)
    const page = headersFor(parseHeadersFile(text), '/data/demo/')
    expect(page['Content-Security-Policy']).toBe(contentSecurityPolicy(LIVE_POLICY))
    expect(page['X-Content-Type-Options']).toBe('nosniff')
    expect(page['Referrer-Policy']).toBe('no-referrer')
    expect(page['Permissions-Policy']).toMatch(/^(?:[a-z-]+=\(\), )+[a-z-]+=\(\)$/)
    expect(page['Cache-Control']).toBeUndefined()
    const chunk = headersFor(parseHeadersFile(text), '/data/demo/assets/index-BxKwE78K.js')
    expect(chunk['Cache-Control']).toBe('public, max-age=31536000, immutable')
    expect(headersFor(parseHeadersFile(text), `/data/demo/${NOTICES_FILE}`)['Content-Type']).toBe('text/plain; charset=utf-8')
    for (const path of ['/data/', '/data/examples/', '/data/demo-old/', '/']) expect(headersFor(rules, path), path).toEqual({})
  })

  // Cloudflare reads at most 100 rules of at most 2,000 characters a line;
  // past either, a header would be dropped where nothing here would see it.
  test("the _headers file is within Cloudflare's limits", () => {
    expect(rules.length).toBeLessThanOrEqual(100)
    for (const line of liveHeadersFile(base).split('\n')) expect(line.length, line.slice(0, 40)).toBeLessThanOrEqual(2000)
  })
})

describe("the live demo's build checks (0070)", () => {
  // The host page's own Vite config, resolved in the demo mode the deploy
  // builds it in: every file it writes into assets/ is named with a hash,
  // which the year's cache is right for.
  test("the host page's Vite config, in demo mode, names everything it writes into assets/ with a hash", async () => {
    const facts = await viteBuild(hostApp, 'demo')
    expect(namingProblems(facts)).toEqual([])
    expect(facts.publicDir.replaceAll('\\', '/')).toBe(join(hostApp, 'public').replaceAll('\\', '/'))
  }, 30_000)

  // The examples' checks, run on a build laid out as the host page's demo
  // build is -- relative files, a hashed chunk and stylesheet, the
  // notices -- with the host page's config and the live policy: a page the
  // live demo can serve passes, and each thing the checks exist for is
  // still refused. A check that ignored the policy or the allowance it was
  // given would pass the first and fail here, or the other way round.
  test('pass a demo build of the shape the host page writes, and refuse what they refuse for the examples', async () => {
    const html = read('apps', 'host', 'index.html').replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" crossorigin src="./assets/index-yOTureDI.js"></script>').replace('</head>', '<link rel="stylesheet" crossorigin href="./assets/index-B8R33OWx.css"></head>')
    const page = { root: hostApp, mode: 'demo', name: "the host page's demo build", policy: LIVE_POLICY, allowed: LIVE_ALLOWED }
    const build = (files) => {
      const directory = mkdtempSync(join(tmpdir(), 'live-demo-build-'))
      mkdirSync(join(directory, 'assets'))
      for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text)
      return directory
    }
    const files = { 'index.html': html, 'assets/index-yOTureDI.js': 'export {}', 'assets/index-B8R33OWx.css': '.x{background:url("data:image/svg+xml,%3Csvg%3E")}', [NOTICES_FILE]: 'notices' }
    const directories = []
    try {
      const fine = build(files)
      directories.push(fine)
      expect(await buildProblems(fine, liveDemoUrl(), page)).toEqual([])
      expect((await buildProblems(fine, liveDemoUrl(), { ...page, allowed: {} })).join('\n')).toContain("style-src allows 'unsafe-inline'")
      const absolute = build({ ...files, 'index.html': html.replace('./assets/index-yOTureDI.js', '/assets/index-yOTureDI.js') })
      const unloaded = build({ ...files, 'assets/index-DzQepO-y.js': 'export {}' })
      const noNotices = build(Object.fromEntries(Object.entries(files).filter(([name]) => name !== NOTICES_FILE)))
      directories.push(absolute, unloaded, noNotices)
      expect((await buildProblems(absolute, liveDemoUrl(), page)).join('\n')).toContain('src="/assets/index-yOTureDI.js"')
      expect((await buildProblems(unloaded, liveDemoUrl(), page)).join('\n')).toContain('index-DzQepO-y.js')
      expect((await buildProblems(noNotices, liveDemoUrl(), page)).join('\n')).toContain(NOTICES_FILE)
    } finally {
      for (const directory of directories) rmSync(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
