import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { configProblems, demoBase, demoUrl, indexProblems, readDemoConfig, unhashedAssets, WRANGLER } from './demo.mjs'
import { contentSecurityPolicy, headerRules, headersFile, headersFor, parseHeadersFile, policyProblems, POLICY } from './demo-headers.mjs'

/**
 * The examples page as a demo on formancy.ai (0069): the Worker's config,
 * the deploy's refusals, the headers the page is served with, and the
 * prose that names a command, a port or an address, held to the manifests,
 * the configs and the page they depend on. None of them breaks when a
 * route, a script or a font host moves, so this does.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(repo, 'apps', 'examples')
const read = (...path) => readFileSync(join(repo, ...path), 'utf8').replaceAll('\r\n', '\n')
const readme = read('README.md')
const root = JSON.parse(read('package.json'))
const examples = JSON.parse(read('apps', 'examples', 'package.json'))
const vite = read('apps', 'examples', 'vite.config.ts')
const gate = read('apps', 'examples', 'scripts', 'browser-test.mjs')
const index = read('apps', 'examples', 'index.html')
const wrangler = readDemoConfig()

/**
 * The stylesheets the page draws with, as they are before the build: the
 * Blueprint theme it imports, as installed, and its own. What the built
 * stylesheets hold is what scripts/demo.mjs checks at deploy time, against
 * the same policy.
 */
const stylesheets = [readFileSync(createRequire(join(app, 'package.json')).resolve('@formancy/themes/blueprint.css'), 'utf8'), read('apps', 'examples', 'src', 'app.css')]

/** The text under `## <title>`, up to the next heading of that level. */
function section(title) {
  const start = readme.indexOf(`\n## ${title}\n`)
  if (start === -1) return ''
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start, end === -1 ? undefined : end)
}

/** The port the config gives `server` or `preview`, which strictPort keeps from wandering. */
function port(block) {
  const match = new RegExp(`${block}: \\{ port: (\\d+), strictPort: true \\}`).exec(vite)
  return match === null ? undefined : Number(match[1])
}

describe('the demo on formancy.ai (0069)', () => {
  const base = { ...wrangler, routes: wrangler.routes.map((route) => ({ ...route })), assets: { ...wrangler.assets } }
  const routes = (...patterns) => ({ ...base, routes: patterns.map((pattern) => ({ pattern, zone_name: 'formancy.ai' })) })

  // The Worker as committed: the built examples page at one path below
  // formancy.ai/data, and at no address beside it.
  test("the examples' Wrangler config serves the built page at /data/examples/ of formancy.ai and nowhere else", () => {
    expect(configProblems(wrangler)).toEqual([])
    expect(demoBase(wrangler)).toBe('/data/examples/')
    expect(demoUrl(wrangler)).toBe('https://formancy.ai/data/examples/')
  })

  // Each would put the demo somewhere the README and the gate do not say,
  // take a path formancy.ai keeps for the product's page, or put more than
  // the built page there: a workers.dev address beside the route, a route on
  // another site, code or a binding at the edge, a path without its slash
  // answered by formancy.ai's 404, or the staging directory another than the
  // one the deploy fills.
  test.each([
    ['a workers.dev address', { ...base, workers_dev: true }, 'workers_dev'],
    ['a preview address per version', { ...base, preview_urls: true }, 'preview_urls'],
    ['code that runs at the edge', { ...base, main: 'worker.js' }, 'main'],
    ['a binding', { ...base, kv_namespaces: [{ binding: 'CACHE', id: 'x' }] }, 'kv_namespaces'],
    ['an assets binding, which would let code reach them', { ...base, assets: { ...base.assets, binding: 'ASSETS' } }, 'assets.binding'],
    ['code run before the assets', { ...base, assets: { ...base.assets, run_worker_first: true } }, 'assets.run_worker_first'],
    ['a route on another zone', { ...base, routes: [{ pattern: 'formancy.ai/data/examples/*', zone_name: 'example.com' }, base.routes[1]] }, 'zone'],
    ['no route for the path without its slash', { ...base, routes: [base.routes[0]] }, 'formancy.ai/data/examples'],
    ["the product's own path, formancy.ai/data", routes('formancy.ai/data/*', 'formancy.ai/data'), '/data/'],
    ['the bare /data beside the demo', routes('formancy.ai/data/examples/*', 'formancy.ai/data/examples', 'formancy.ai/data'), 'formancy.ai/data '],
    ['everything below /data beside the demo', routes('formancy.ai/data/examples/*', 'formancy.ai/data/examples', 'formancy.ai/data*'), 'formancy.ai/data*'],
    ['the whole site', routes('formancy.ai/*', 'formancy.ai'), "the demo's path is /"],
    ['a path outside /data', routes('formancy.ai/examples/*', 'formancy.ai/examples'), '/examples/'],
    ['two levels below /data', routes('formancy.ai/data/examples/old/*', 'formancy.ai/data/examples/old'), '/data/examples/old/'],
    ['another hostname of the zone', routes('formancy.ai/data/examples/*', 'formancy.ai/data/examples', 'www.formancy.ai/data/examples/*'), 'www.formancy.ai'],
    ['a custom domain', { ...base, routes: [...base.routes, { pattern: 'examples.formancy.ai', custom_domain: true }] }, 'custom_domain'],
    ['assets staged elsewhere', { ...base, assets: { ...base.assets, directory: './dist' } }, '.cloudflare'],
    ['no redirect from /data/examples to /data/examples/', { ...base, assets: { ...base.assets, html_handling: 'none' } }, 'auto-trailing-slash'],
    ['the page answering every missing path', { ...base, assets: { ...base.assets, not_found_handling: 'single-page-application' } }, 'not_found_handling'],
  ])('refuses %s', (_name, config, says) => {
    const problems = configProblems(config)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain(says)
  })

  // A page built with an absolute base asks formancy.ai for /assets/…, the
  // site's own directory: the demo is a blank page while every log says it
  // deployed. The gate would see it; the deploy refuses it before anything
  // is uploaded.
  test('refuses a built page that asks for a file by an absolute path, and only that', () => {
    expect(indexProblems('<script type="module" crossorigin src="./assets/index-a.js"></script><link rel="stylesheet" crossorigin href="./assets/index-b.css">')).toEqual([])
    expect(indexProblems('<link rel="icon" href="data:," /><link href="https://fonts.googleapis.com/css2?family=Archivo" rel="stylesheet" />')).toEqual([])
    expect(indexProblems('<script type="module" crossorigin src="/assets/index-a.js"></script>')).toEqual(['src="/assets/index-a.js"'])
    expect(indexProblems('<link rel="modulepreload" crossorigin href="/data/examples/assets/c.js">')).toEqual(['href="/data/examples/assets/c.js"'])
  })

  // The examples page is built with a relative base, so the one build is
  // right at the root of `vite preview` and under /data/examples/; with
  // Vite's default the deploy above would refuse every build.
  test('the examples page is built with a relative base', () => {
    expect(vite).toMatch(/^ {2}base: '\.\/',$/m)
  })

  // A year's cache is right only for a file whose name changes with its
  // content: a stale page asking for a chunk the deploy removed would
  // otherwise be served the old one. Vite names every chunk it writes with
  // a hash; the deploy refuses an assets directory holding anything else.
  test('refuses a file in assets/ whose name carries no hash', () => {
    expect(unhashedAssets(['index-BxKwE78K.js', 'angular-bootstrap-b1VPoZ-e.js', 'index-BgSCHOjx.css'])).toEqual([])
    expect(unhashedAssets(['index-BxKwE78K.js', 'index.js', 'logo.svg'])).toEqual(['index.js', 'logo.svg'])
  })

  // The deploy is the root's script, after the same build `pnpm demo`
  // makes, and with the Wrangler the record names, never whatever npx finds
  // newest.
  test('is deployed by the root script, after the build, with a pinned Wrangler', () => {
    expect(root.scripts['demo:deploy']).toBe('pnpm build && node scripts/demo.mjs')
    expect(WRANGLER).toMatch(/^wrangler@\d+\.\d+\.\d+$/)
  })

  // Cloudflare's Workers Builds runs the commands its dashboard holds, which
  // nothing here can read; REPO-METADATA.md records them. Recorded apart
  // from `pnpm demo:deploy`, the two would drift, and the demo deployed on a
  // push to main would be built or checked otherwise than one deployed by
  // hand.
  test("REPO-METADATA.md's Workers Builds settings are pnpm demo:deploy's halves, for the demo's Worker", () => {
    const metadata = read('.github', 'REPO-METADATA.md')
    const setting = (name) => new RegExp(`^\\| ${name} \\| \`([^\`]+)\` \\|`, 'm').exec(metadata)?.[1]
    expect(setting('Worker')).toBe(wrangler.name)
    expect(setting('Root directory')).toBe('/')
    expect(setting('Production branch')).toBe('main')
    expect(`${String(setting('Build command'))} && ${String(setting('Deploy command'))}`).toBe(root.scripts['demo:deploy'])
  })

  // Workers Builds picks Node from .node-version and defaults to another
  // major; without it the demo would be built on a Node no gate builds on.
  test('Cloudflare builds the demo on the Node every gate and the release run on', () => {
    const pinned = read('.node-version').trim()
    const versions = ['gates.yml', 'release.yml'].flatMap((file) => [...read('.github', 'workflows', file).matchAll(/node-version: (\S+)/g)].map((match) => match[1]))
    expect(versions.length).toBeGreaterThan(0)
    for (const each of versions) expect(each).toBe(pinned)
  })

  // The record says GitHub holds no Cloudflare token and never deploys. A
  // workflow step that ran the deploy, or read a token for it, would make
  // that false while every gate stayed green.
  test('no workflow deploys the demo or holds a Cloudflare token', () => {
    const directory = join(repo, '.github', 'workflows')
    const files = readdirSync(directory).filter((file) => file.endsWith('.yml'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const text = read('.github', 'workflows', file)
      expect(text, file).not.toMatch(/\bwrangler\b|demo\.mjs|demo:deploy|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|cloudflare\/wrangler-action/i)
    }
  })

  // A Wrangler bumped in the script and not in RELEASING.md would have the
  // rightsholder log in with one version and deploy with another.
  test('RELEASING.md names only the Wrangler the deploy runs', () => {
    const named = [...read('RELEASING.md').matchAll(/\bwrangler@[\w.-]+/g)].map((match) => match[0])
    expect(named.length).toBeGreaterThan(0)
    for (const each of named) expect(each).toBe(WRANGLER)
  })

  // The gate measuring the page at the root of its origin, or without the
  // headers, would pass a build that is a blank page under /data/examples/
  // or one its own policy stops; served under the demo's path with the
  // headers the deploy writes, every check of it is a check of the demo as
  // formancy.ai serves it.
  test('the browser gate serves the built page under the demo’s path, with the headers the deploy writes', () => {
    expect(gate).toMatch(/import \{[^}]*\bdemoBase\b[^}]*\breadDemoConfig\b[^}]*\} from '\.\.\/\.\.\/\.\.\/scripts\/demo\.mjs'/)
    expect(gate).toMatch(/import \{[^}]*\bheadersFile\b[^}]*\} from '\.\.\/\.\.\/\.\.\/scripts\/demo-headers\.mjs'/)
    expect(gate).toContain('const BASE = demoBase(readDemoConfig())')
    expect(gate).toContain('parseHeadersFile(headersFile(headerRules(BASE)))')
  })
})

describe("the demo's headers (0069)", () => {
  const rules = headerRules(demoBase(wrangler))

  // The policy as decided, directive by directive: nothing inline and
  // nothing evaluated, the page's own files and Google's fonts, no plugin,
  // no <base>, no form sent anywhere and no page framing it. A directive
  // loosened here is a change to the record.
  test('the Content-Security-Policy is the strict one the record names', () => {
    expect(POLICY).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'font-src': ['https://fonts.gstatic.com'],
      'img-src': ['data:'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
      'frame-ancestors': ["'none'"],
    })
    expect(contentSecurityPolicy()).not.toMatch(/unsafe|\*|https?:(?:\s|;|$)/)
  })

  // A font host the page stopped using, or one it began to, is a policy
  // that names a host for nothing or a page whose fonts the browser
  // refuses. Derived from index.html and the stylesheets, never typed: each
  // host the policy names is one the page loads, in the directive it loads
  // it under, and the data: images the theme draws are the only reason
  // img-src names anything.
  test('names exactly the hosts index.html loads, and data: only for the images the stylesheets draw', () => {
    expect(policyProblems(POLICY, { html: index, stylesheets })).toEqual([])
  })

  test.each([
    ['an inline script in the page', { html: index.replace('</body>', '<script>window.x = 1</script></body>') }, 'inline'],
    ['a style attribute in the page', { html: index.replace('<div id="root">', '<div id="root" style="color: red">') }, 'style'],
    ['the fonts link removed from the page', { html: index.replace(/<link\s+href="https:\/\/fonts\.googleapis\.com[^>]*>/, '') }, 'https://fonts.googleapis.com'],
    ['a script from another host', { html: index.replace('</head>', '<script src="https://cdn.example/x.js"></script></head>') }, 'https://cdn.example'],
    ['the font host the page preconnects to missing', { policy: { ...POLICY, 'font-src': ["'self'"] } }, 'https://fonts.gstatic.com'],
    ['a host the page never loads', { policy: { ...POLICY, 'connect-src': ["'self'", 'https://api.example'] } }, 'https://api.example'],
    ['inline scripts allowed', { policy: { ...POLICY, 'script-src': ["'self'", "'unsafe-inline'"] } }, 'unsafe-inline'],
    ['eval allowed', { policy: { ...POLICY, 'script-src': ["'self'", "'unsafe-eval'"] } }, 'unsafe-eval'],
    ['data: images neither the page nor its stylesheets use', { html: index.replace('href="data:,"', 'href="./icon.svg"'), stylesheets: ['a { color: red }'] }, 'data:'],
    ['data: images refused while the theme draws them', { policy: { ...POLICY, 'img-src': ["'self'"] } }, 'data:'],
    ['a directive the record names missing', { policy: Object.fromEntries(Object.entries(POLICY).filter(([name]) => name !== 'frame-ancestors')) }, 'frame-ancestors'],
  ])('refuses %s', (_name, change, says) => {
    const problems = policyProblems(change.policy ?? POLICY, { html: change.html ?? index, stylesheets: change.stylesheets ?? stylesheets })
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain(says)
  })

  // The file Workers Static Assets read is the file the gate serves with:
  // parsed back, it is the rules, and each path gets what Cloudflare's
  // documented matching gives it -- every matching rule, one under the
  // other.
  test('the _headers file reads back as the rules, and gives each path what Cloudflare would', () => {
    const text = headersFile(rules)
    expect(parseHeadersFile(text)).toEqual(rules)
    const page = headersFor(parseHeadersFile(text), '/data/examples/')
    expect(page['Content-Security-Policy']).toBe(contentSecurityPolicy())
    expect(page['X-Content-Type-Options']).toBe('nosniff')
    expect(page['Referrer-Policy']).toBe('no-referrer')
    expect(page['Permissions-Policy']).toMatch(/^(?:[a-z-]+=\(\), )+[a-z-]+=\(\)$/)
    expect(page['Cache-Control']).toBeUndefined()
    const chunk = headersFor(parseHeadersFile(text), '/data/examples/assets/index-BxKwE78K.js')
    expect(chunk['Cache-Control']).toBe('public, max-age=31536000, immutable')
    expect(chunk['Content-Security-Policy']).toBe(contentSecurityPolicy())
    expect(headersFor(rules, '/report/')).toEqual({})
    expect(headersFor(rules, '/data/')).toEqual({})
    expect(headersFor(rules, '/data/examples-old/')).toEqual({})
  })

  // Cloudflare reads at most 100 rules of at most 2,000 characters a line;
  // past either, a header would be dropped where nothing here would see it.
  test("the _headers file is within Cloudflare's limits", () => {
    const lines = headersFile(rules).split('\n')
    expect(rules.length).toBeLessThanOrEqual(100)
    for (const line of lines) expect(line.length, line.slice(0, 40)).toBeLessThanOrEqual(2000)
  })
})

describe("README.md's demo", () => {
  const examplesSection = section('Examples')

  // The demo is the examples page as the browser gate measures it: built,
  // then served. `pnpm demo` serves the build with Vite's preview and the
  // page's own config; a demo that ran the dev server would show what no
  // gate checked.
  test('pnpm demo runs the build and then the built examples page', () => {
    expect(root.scripts.demo).toBe('pnpm build && pnpm --filter @formancy/data-examples preview')
    expect(examples.name).toBe('@formancy/data-examples')
    expect(examples.scripts.preview).toBe('vite preview')
  })

  // A port changed in the config would leave the README sending a reader to
  // an address nothing answers; every port the Examples section names is
  // the page's.
  test("the Examples section names only the page's port, for both the demo and the dev server", () => {
    const preview = port('preview')
    expect(preview).toBeDefined()
    expect(port('server')).toBe(preview)
    expect(examplesSection).toContain('pnpm demo')
    const named = [...examplesSection.matchAll(/localhost:(\d{2,5})\b/g)].map((match) => Number(match[1]))
    expect(named.length).toBeGreaterThan(0)
    for (const each of named) expect(each).toBe(preview)
  })

  // A route moved in the Worker's config would leave the README sending a
  // reader to formancy.ai's 404 while the demo answered somewhere else.
  test("Try it and Examples send a reader to the address the demo's Worker is routed at", () => {
    expect(section('Try it')).toContain(demoUrl(wrangler))
    expect(examplesSection).toContain(demoUrl(wrangler))
  })
})
