import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { configProblems, demoBase, demoUrl, indexProblems, namingProblems, readDemoConfig, unhashedAssets, viteBuild, WORKER, WRANGLER } from './demo.mjs'
import { contentSecurityPolicy, headerRules, headersFile, headersFor, parseHeadersFile, policyProblems, POLICY } from './demo-headers.mjs'
import { serveDemo } from './demo-serve.mjs'
import { NOTICES_FILE } from './third-party-notices.mjs'

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
const index = read('apps', 'examples', 'index.html')
const wrangler = readDemoConfig()

/** The page's address, against which every address in it is resolved. */
const address = 'https://formancy.ai/data/examples/'

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
    // Wrangler deploys to whichever Worker the name says: formancy.ai's own
    // would then serve only /data/examples/ and answer 404 for the rest of
    // the site, and the report's would lose its Studio.
    ["formancy.ai's own Worker", { ...base, name: 'formancy-ai' }, 'formancy-data-examples'],
    ["the report's Worker", { ...base, name: 'formancy-report-studio' }, 'formancy-data-examples'],
    ['no name', Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'name')), 'formancy-data-examples'],
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
  // However the attribute is quoted, and whether the address names the
  // path, the host or the whole of formancy.ai, or climbs out of the
  // page's directory.
  test('refuses a built page that asks formancy.ai for a file other than by a path relative to the page, and only that', () => {
    expect(indexProblems('<script type="module" crossorigin src="./assets/index-a.js"></script><link rel="stylesheet" crossorigin href="./assets/index-b.css">', address)).toEqual([])
    expect(indexProblems('<link rel="icon" href="data:," /><link href="https://fonts.googleapis.com/css2?family=Archivo" rel="stylesheet" />', address)).toEqual([])
    expect(indexProblems('<script type="module" crossorigin src="/assets/index-a.js"></script>', address)).toEqual(['src="/assets/index-a.js"'])
    expect(indexProblems('<link rel="modulepreload" crossorigin href="/data/examples/assets/c.js">', address)).toEqual(['href="/data/examples/assets/c.js"'])
    expect(indexProblems("<script src='/assets/x.js'></script>", address)).toEqual(['src="/assets/x.js"'])
    expect(indexProblems('<script src=/assets/x.js></script>', address)).toEqual(['src="/assets/x.js"'])
    expect(indexProblems('<script src="//formancy.ai/assets/x.js"></script>', address)).toEqual(['src="//formancy.ai/assets/x.js"'])
    expect(indexProblems('<link rel="stylesheet" href="https://formancy.ai/data/examples/assets/b.css">', address)).toEqual(['href="https://formancy.ai/data/examples/assets/b.css"'])
    expect(indexProblems('<script src="../assets/x.js"></script>', address)).toEqual(['src="../assets/x.js"'])
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
  //
  // A name's shape is not its hash: `fixture-snapshot.json` has the shape.
  // So a file Vite copied from the public directory, under the name it has
  // there, is refused whatever its name, and so is a config that names
  // what it writes by a pattern without [hash].
  test('refuses a file in assets/ that the public directory put there, or whose name has not the shape of a hashed one', () => {
    expect(unhashedAssets(['index-BxKwE78K.js', 'angular-bootstrap-b1VPoZ-e.js', 'index-BgSCHOjx.css'], [])).toEqual([])
    expect(unhashedAssets(['index-BxKwE78K.js', 'index.js', 'logo.svg'], [])).toEqual(['index.js', 'logo.svg'])
    expect(unhashedAssets(['index-BxKwE78K.js', 'fixture-snapshot.json', 'brand-template.svg'], ['fixture-snapshot.json', 'brand-template.svg'])).toEqual(['fixture-snapshot.json', 'brand-template.svg'])
  })

  test.each([
    ['chunks named without a hash', { assetsDir: 'assets', output: { chunkFileNames: 'assets/[name].js' } }, 'chunkFileNames'],
    ['entries named without a hash', { assetsDir: 'assets', output: [{ entryFileNames: 'assets/[name].js' }] }, 'entryFileNames'],
    ['assets named by a function', { assetsDir: 'assets', output: { assetFileNames: () => 'assets/x.css' } }, 'assetFileNames'],
    ['another assets directory than the one the headers cache', { assetsDir: 'static', output: undefined }, 'static'],
  ])('refuses a build whose Vite config gives %s', (_name, facts, says) => {
    const problems = namingProblems(facts)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain(says)
  })

  // The examples page's own Vite config, resolved as `vite build` resolves
  // it: every file it writes into assets/ is named with a hash, and its
  // public directory is the one beside its config.
  test("the examples page's Vite config names everything it writes into assets/ with a hash", async () => {
    const facts = await viteBuild()
    expect(namingProblems(facts)).toEqual([])
    expect(facts.publicDir.replaceAll('\\', '/')).toBe(join(app, 'public').replaceAll('\\', '/'))
  }, 30_000)

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
  // hand. The repository it is connected to, and the one the steps that
  // create it tell the dashboard to import, is this one as data-core's
  // manifest names it for npm's provenance, and every Worker the section
  // names is the demo's: a slug or a name copied from the report's file
  // would connect formancy.ai-report, or create its Worker a second time.
  test("REPO-METADATA.md's Workers Builds settings are pnpm demo:deploy's halves, for the demo's Worker and this repository", () => {
    const metadata = read('.github', 'REPO-METADATA.md')
    const setting = (name) => new RegExp(`^\\| ${name} \\| \`([^\`]+)\` \\|`, 'm').exec(metadata)?.[1]
    const repository = JSON.parse(read('packages', 'data-core', 'package.json')).repository.url.replace(/^git\+https:\/\/github\.com\//, '').replace(/\.git$/, '')
    const start = metadata.indexOf("\n## The demo's Worker on Cloudflare\n")
    const worker = metadata.slice(start, metadata.indexOf('\n## ', start + 1))
    expect(start).toBeGreaterThan(-1)
    expect(setting('Git repository')).toBe(repository)
    const named = [...worker.matchAll(/\bsharkysan\/[\w.-]*[\w-]/g)].map((match) => match[0])
    expect(named.length).toBeGreaterThan(1)
    for (const each of named) expect(each).toBe(repository)
    const workers = [...worker.matchAll(/\bformancy-(?!ai\b)[a-z][a-z-]*[a-z]/g)].map((match) => match[0])
    expect(workers.length).toBeGreaterThan(1)
    for (const each of workers) expect(each).toBe(WORKER)
    expect(setting('Worker')).toBe(WORKER)
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

  // The browser gate measures the page through serveDemo. Served at the
  // root of its origin, or without the headers, it would pass a build that
  // is a blank page under /data/examples/ or one its own policy stops; and
  // with a type of its own for a file Cloudflare sends otherwise, it would
  // pass a page whose notices a browser reads in the wrong encoding.
  // Measured on 2026-10-16: formancy.ai/report/THIRD-PARTY-NOTICES.txt,
  // which Workers static assets serve with no `_headers`, answered
  // `Content-Type: text/plain`, with no charset.
  test("the page is served as formancy.ai serves it: under the demo's path alone, each file with the deploy's headers over Cloudflare's type", async () => {
    const directory = mkdtempSync(join(tmpdir(), 'demo-serve-'))
    mkdirSync(join(directory, 'assets'))
    writeFileSync(join(directory, 'index.html'), '<!doctype html><title>page</title>')
    writeFileSync(join(directory, 'assets', 'index-BxKwE78K.js'), 'export {}')
    writeFileSync(join(directory, NOTICES_FILE), 'the “Software”')
    writeFileSync(join(directory, 'other.txt'), 'text')
    const { server, port, base: served } = await serveDemo(directory)
    try {
      const get = (path) => fetch(`http://127.0.0.1:${String(port)}${path}`, { redirect: 'manual' })
      const rules = headerRules(demoBase(wrangler))
      expect(served).toBe('/data/examples/')
      expect((await get('/')).status).toBe(404)
      expect((await get('/index.html')).status).toBe(404)
      expect((await get('/data/')).status).toBe(404)
      const bare = await get('/data/examples')
      expect([bare.status, bare.headers.get('location')]).toEqual([307, '/data/examples/'])
      for (const path of ['/data/examples/', '/data/examples/assets/index-BxKwE78K.js', `/data/examples/${NOTICES_FILE}`]) {
        const answer = await get(path)
        expect(answer.status, path).toBe(200)
        for (const [name, value] of Object.entries(headersFor(rules, path))) expect(answer.headers.get(name), `${path} ${name}`).toBe(value)
      }
      expect((await get(`/data/examples/${NOTICES_FILE}`)).headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect((await get('/data/examples/other.txt')).headers.get('content-type')).toBe('text/plain')
    } finally {
      server.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe("the demo's headers (0069)", () => {
  const rules = headerRules(demoBase(wrangler))

  // The policy as decided, directive by directive: nothing a directive
  // does not name, nothing inline and nothing evaluated, scripts, styles
  // and fetches from formancy.ai's own origin and Google's fonts, no
  // plugin, no <base>, no form sent anywhere and no page framing it. A
  // directive loosened here is a change to the record.
  test('the Content-Security-Policy is the strict one the record names', () => {
    expect(POLICY).toEqual({
      'default-src': ["'none'"],
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
    expect(policyProblems(POLICY, { html: index, stylesheets, address })).toEqual([])
  })

  test.each([
    ['an inline script in the page', { html: index.replace('</body>', '<script>window.x = 1</script></body>') }, 'inline'],
    ['a style attribute in the page', { html: index.replace('<div id="root">', '<div id="root" style="color: red">') }, 'style'],
    ['the fonts link removed from the page', { html: index.replace(/<link\s+href="https:\/\/fonts\.googleapis\.com[^>]*>/, '') }, 'https://fonts.googleapis.com'],
    ['a script from another host', { html: index.replace('</head>', '<script src="https://cdn.example/x.js"></script></head>') }, 'https://cdn.example'],
    ['a script from another host, by a protocol-relative address', { html: index.replace('</head>', '<script src="//cdn.example/x.js"></script></head>') }, 'https://cdn.example'],
    ['a script from another host, single-quoted', { html: index.replace('</head>', "<script src='https://cdn.example/x.js'></script></head>") }, 'https://cdn.example'],
    ['a stylesheet from another host, unquoted', { html: index.replace('</head>', '<link rel=stylesheet href=https://cdn.example/x.css></head>') }, 'https://cdn.example'],
    ['a script from another host, after a > in a quoted attribute', { html: index.replace('</head>', '<script data-x="a>b" src="https://cdn.example/x.js"></script></head>') }, 'https://cdn.example'],
    ['the font host the page preconnects to missing', { policy: { ...POLICY, 'font-src': ["'self'"] } }, 'https://fonts.gstatic.com'],
    ['a host the page never loads', { policy: { ...POLICY, 'connect-src': ["'self'", 'https://api.example'] } }, 'https://api.example'],
    ['inline scripts allowed', { policy: { ...POLICY, 'script-src': ["'self'", "'unsafe-inline'"] } }, 'unsafe-inline'],
    ['eval allowed', { policy: { ...POLICY, 'script-src': ["'self'", "'unsafe-eval'"] } }, 'unsafe-eval'],
    ['data: images neither the page nor its stylesheets use', { html: index.replace('href="data:,"', 'href="./icon.svg"'), stylesheets: ['a { color: red }'] }, 'data:'],
    ['data: images refused while the theme draws them', { policy: { ...POLICY, 'img-src': ["'self'"] } }, 'data:'],
    ['a directive the record names missing', { policy: Object.fromEntries(Object.entries(POLICY).filter(([name]) => name !== 'frame-ancestors')) }, 'frame-ancestors'],
  ])('refuses %s', (_name, change, says) => {
    const problems = policyProblems(change.policy ?? POLICY, { html: change.html ?? index, stylesheets: change.stylesheets ?? stylesheets, address })
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
    expect(page['Content-Type']).toBeUndefined()
    expect(chunk['Content-Type']).toBeUndefined()
    // Cloudflare sends a .txt as bare text/plain, whose encoding a browser
    // guesses, and the notices are not ASCII: a bundled MIT text's curly
    // quotes among them. 0046 serves them as UTF-8, and so does the demo.
    const notices = headersFor(parseHeadersFile(text), `/data/examples/${NOTICES_FILE}`)
    expect(notices['Content-Type']).toBe('text/plain; charset=utf-8')
    expect(notices['Content-Security-Policy']).toBe(contentSecurityPolicy())
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
