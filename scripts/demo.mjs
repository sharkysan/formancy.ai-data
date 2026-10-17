// `pnpm demo:deploy`: the built examples page, put on formancy.ai at the
// path the Worker's config, apps/examples/wrangler.json, routes to it, with
// the headers scripts/demo-headers.mjs decides (0069).
//
//   pnpm demo:deploy                 build, check, deploy with the Cloudflare login Wrangler holds
//   node scripts/demo.mjs --dry-run  check and let Wrangler check what it would upload, after `pnpm build`; uploads nothing
//
// formancy.ai is one static deployment of its own repository, served by a
// Worker named formancy-ai, and formancy.ai/data is kept for this
// product's page in that site's shell (CLAUDE.md, "One shell for every page
// of the site"). The examples page is not part of that site, and is never
// copied into it: that repository is Apache-2.0 and this one is not (0001).
// It is served by a Worker of its own, with static assets and no code,
// routed at `/data/examples/` of the same zone and nowhere else; a route
// takes precedence over a Worker on the hostname's Custom Domain and a more
// specific route over a less specific one, so formancy.ai's Worker never
// sees a request under `/data/examples/`, and this one never sees any other
// -- `/data` itself included. Formancy Report's Studio is served at
// `/report/` the same way (formancy.ai-report 0018), and this script is its
// deploy, adapted.
//
// The page is built with a relative base, so the one build is right at the
// root of `vite preview` and under `/data/examples/`; the browser gate
// serves it under the path read from here, with the headers this writes
// (scripts/demo-serve.mjs), and this refuses a built page that asks
// formancy.ai for a file other than by a path relative to it, which
// formancy.ai would answer from its own site. Static assets are found
// by the request's whole path, so the build is staged under that path in
// apps/examples/.cloudflare, the directory the config names, with the
// `_headers` file at its root, and the staging is removed afterwards.
//
// Cloudflare's Workers Builds runs this on every push to main, as the
// deploy command after `pnpm build` (.github/REPO-METADATA.md), with the API
// token it generates. By hand it needs a Cloudflare login that can edit
// Workers on formancy.ai's zone, `npx --yes <WRANGLER> login` once. Either
// way it needs a clean checkout: the deployment's message names the commit
// it is, and a change not committed would be deployed under a commit that
// does not hold it. GitHub's workflows hold no Cloudflare token and never
// run it.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { references, resolved } from './addresses.mjs'
import { HASHED, headerRules, headersFile, POLICY, policyProblems } from './demo-headers.mjs'
import { NOTICES_FILE } from './third-party-notices.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(repo, 'apps', 'examples')
const CONFIG = join(app, 'wrangler.json')

/** The site the demo is a path of: formancy.ai's zone. */
const HOST = 'formancy.ai'

/**
 * The demo's Worker. Wrangler deploys to whichever Worker the config
 * names: `formancy-ai` would put this page in place of formancy.ai's whole
 * site, and `formancy-report-studio` in place of the report's Studio.
 */
export const WORKER = 'formancy-data-examples'

/** The path formancy.ai keeps for this product's own page; the demo is one path below it. */
const PRODUCT = '/data/'

/** The directory the config gives Wrangler, where the build is staged under the demo's path. */
const STAGE = './.cloudflare'

/**
 * Wrangler, at an exact version older than two weeks when it was chosen
 * (4.146.0, published on 2026-10-01, the version formancy.ai-report's demo
 * deploys with): npx with no version takes whatever the registry calls
 * newest on the day someone deploys.
 */
export const WRANGLER = 'wrangler@4.146.0'

/**
 * Everything the demo's config may say: a name, a date, two addresses
 * switched off, the routes and the assets. Anything else -- code, a
 * variable, a binding of any kind -- is more than a directory of files.
 */
const KEYS = ['name', 'compatibility_date', 'workers_dev', 'preview_urls', 'routes', 'assets']
const ASSET_KEYS = ['directory', 'html_handling', 'not_found_handling']

/** apps/examples/wrangler.json, as Wrangler reads it. */
export function readDemoConfig() {
  return JSON.parse(readFileSync(CONFIG, 'utf8'))
}

/** The route whose pattern ends in `/*`, which every path under the demo's takes. */
function wildcard(config) {
  return (config.routes ?? []).find((route) => typeof route.pattern === 'string' && route.pattern.endsWith('/*'))
}

/** The path the demo is served under, with both its slashes: `/data/examples/`. */
export function demoBase(config) {
  const route = wildcard(config)
  if (route === undefined || !route.pattern.startsWith(`${HOST}/`)) return undefined
  return route.pattern.slice(HOST.length, -1)
}

/** The address a reader opens: formancy.ai, at the demo's path. */
export function demoUrl(config) {
  const base = demoBase(config)
  return base === undefined ? undefined : `https://${HOST}${base}`
}

/**
 * What would put the demo anywhere but one path below formancy.ai/data, or
 * put more there than the built page: one sentence per problem, none when
 * the config is the demo's.
 */
export function configProblems(config) {
  const problems = []
  if (config.name !== WORKER) problems.push(`the config names the Worker ${String(config.name)}, not ${WORKER}: the deploy would replace whatever that Worker serves`)
  if (config.main !== undefined) problems.push(`the config names main, ${String(config.main)}: the demo's Worker serves the built page and runs no code`)
  for (const key of Object.keys(config)) if (key !== 'main' && !KEYS.includes(key)) problems.push(`the config has ${key}, which the demo's Worker does not: it is a directory of files and holds nothing else`)
  for (const key of Object.keys(config.assets ?? {})) if (!ASSET_KEYS.includes(key)) problems.push(`the config has assets.${key}, which the demo's Worker does not: no code reaches its files or runs before them`)
  if (config.workers_dev !== false) problems.push('workers_dev is not false: the demo would answer on a workers.dev address beside formancy.ai')
  if (config.preview_urls !== false) problems.push('preview_urls is not false: every version would answer on an address of its own')
  const routes = config.routes ?? []
  for (const route of routes) {
    if (route.custom_domain !== undefined) problems.push(`the route ${String(route.pattern)} sets custom_domain: a Custom Domain takes a whole hostname, and the demo is one path of ${HOST}`)
    else if (route.zone_name !== HOST) problems.push(`the route ${String(route.pattern)} is on the zone ${String(route.zone_name)}, not ${HOST}`)
  }
  const base = demoBase(config)
  if (base === undefined) problems.push(`no route ${HOST}${PRODUCT}<path>/*: nothing says which path of ${HOST} the demo is`)
  else if (!new RegExp(`^${PRODUCT}[a-z][a-z0-9-]*/$`).test(base)) {
    problems.push(`the demo's path is ${base}: it is one path below ${HOST}${PRODUCT}, never ${PRODUCT} itself, which is the product's page in formancy.ai's site, nor anything wider`)
  } else {
    const bare = `${HOST}${base.slice(0, -1)}`
    const expected = [`${HOST}${base}*`, bare]
    if (!routes.some((route) => route.pattern === bare)) problems.push(`no route ${bare}: the path without its slash would be answered by formancy.ai's 404 instead of being sent to ${base}`)
    for (const route of routes.filter((each) => !expected.includes(each.pattern))) {
      problems.push(`the route ${String(route.pattern)} is not the demo's path: it would send the demo more of ${HOST} than ${base}`)
    }
  }
  if (config.assets?.directory !== STAGE) problems.push(`assets.directory is ${String(config.assets?.directory)}, not ${STAGE}: the deploy stages the build there, under the demo's path`)
  if (config.assets?.html_handling !== 'auto-trailing-slash') problems.push(`assets.html_handling is ${String(config.assets?.html_handling)}, not auto-trailing-slash, which sends the path without its slash to the page and its relative files`)
  if (config.assets?.not_found_handling !== 'none') problems.push(`assets.not_found_handling is ${String(config.assets?.not_found_handling)}, not none: a path the build does not have is a 404, never the page`)
  return problems
}

/**
 * Every `src` or `href` of the built page, served at `address`, that asks
 * formancy.ai for a file other than by a path relative to the page -- by an
 * absolute path, by an address that names formancy.ai, or by a relative one
 * that climbs out of the demo's path -- however the attribute is quoted.
 * Under the demo's path such a file is formancy.ai's, not the page's: the
 * page loads and its script does not. And at the root of `pnpm demo`, which
 * serves the same build, it is no file of the build at all.
 */
export function indexProblems(html, address) {
  const page = new URL(address)
  return references(html)
    .filter(({ value }) => {
      const url = resolved(value, page)
      if (url === null || url.origin !== page.origin) return false
      const relative = !/^(?:[a-z][a-z0-9+.-]*:|[/\\])/i.test(value.trim())
      return !relative || !url.pathname.startsWith(page.pathname)
    })
    .map(({ name, value }) => `${name}="${value}"`)
}

/**
 * The files of the build's assets directory a year's cache would be wrong
 * for, given those `copied` from the public directory's: each the public
 * directory put there, which Vite copies under the name it has there,
 * whatever that name looks like; and each whose name has not the shape
 * Vite gives a hashed one, `name-<8 characters>.ext`. What Vite bundles it
 * names by its output options, which namingProblems holds to a hash.
 */
export function unhashedAssets(names, copied) {
  return names.filter((name) => copied.includes(name) || !/-[\w-]{8}\.[a-z0-9]+$/i.test(name))
}

/**
 * The files of the build's assets directory the page never loads: none
 * named by `html`, or by a file it names, however deep. Each is named by a
 * hash of its content, so its name is in the text of whatever loads it.
 * turbo replays a cached build over the dist/ that is there and removes
 * nothing, so a checkout that built before holds earlier builds' files, and
 * a deploy from it would serve them all.
 */
export function unloadedAssets(files, html) {
  const names = Object.keys(files)
  const loaded = new Set()
  const read = [html]
  while (read.length > 0) {
    const text = read.pop()
    for (const name of names) {
      if (loaded.has(name) || !text.includes(name)) continue
      loaded.add(name)
      read.push(files[name])
    }
  }
  return names.filter((name) => !loaded.has(name))
}

/** The output options by which Vite names what it bundles. */
const NAMED_BY = ['entryFileNames', 'chunkFileNames', 'assetFileNames']

/**
 * What in the examples page's resolved Vite config would name a file it
 * bundles without a hash of its content, or write the hashed files
 * elsewhere than the directory the headers cache: one sentence each. An
 * option left unset is Vite's own, `<assetsDir>/[name]-[hash]…`.
 */
export function namingProblems({ assetsDir, output }) {
  const problems = []
  if (`${String(assetsDir)}/` !== HASHED) problems.push(`writes the hashed files to ${String(assetsDir)}/, and the headers give ${HASHED} the year's cache`)
  for (const each of [output ?? {}].flat()) {
    for (const option of NAMED_BY) {
      const pattern = each[option]
      if (pattern === undefined) continue
      if (typeof pattern !== 'string') problems.push(`names files by a function, output.${option}, whose names cannot be read before the build`)
      else if (!pattern.includes('[hash]')) problems.push(`names files by output.${option}, ${pattern}, which has no [hash]`)
    }
  }
  return problems
}

/**
 * A page's Vite config -- the examples page's unless `root` names another
 * app, in `mode` -- resolved as `vite build` resolves it, with the Vite
 * that app builds with: its public directory (none when it is switched
 * off), its assets directory and its output options. The live demo's
 * deploy asks it of the host page in its demo mode (0070).
 */
export async function viteBuild(root = app, mode = 'production') {
  const vite = await import(pathToFileURL(createRequire(join(root, 'package.json')).resolve('vite')).href)
  const config = await vite.resolveConfig({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'silent', mode }, 'build', mode)
  return { publicDir: config.publicDir || null, assetsDir: config.build.assetsDir, output: config.build.rolldownOptions?.output ?? config.build.rollupOptions?.output }
}

/**
 * A command's output, without its last newline; a command that fails stops
 * the deploy. Wrangler is told not to send Cloudflare its usage telemetry.
 * The live demo's deploy runs its commands through this too (0070).
 */
export function run(command, args, options = {}) {
  const settings = { cwd: repo, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, ...options }
  // npx and pnpm are .cmd files on Windows, which Node starts only through a
  // shell: one command line, as the install gate's, rather than arguments
  // beside `shell`, which Node would concatenate unescaped all the same
  // (DEP0190).
  const result =
    (command === 'npx' || command === 'pnpm') && process.platform === 'win32'
      ? spawnSync([`${command}.cmd`, ...args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg))].join(' '), { ...settings, shell: true })
      : spawnSync(command, args, settings)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}`)
  return (result.stdout ?? '').trimEnd()
}

/**
 * The checks on the build in `dist` served at `address`, before anything
 * is staged: one sentence per problem. The examples page's build under
 * POLICY unless `page` says otherwise -- the app whose Vite config built
 * it, its mode, its name in a sentence, and the policy it is served with
 * and that policy's allowances -- as the live demo's deploy says for the
 * host page's demo build (0070).
 */
export async function buildProblems(dist, address, page = {}) {
  const { root = app, mode = 'production', name = 'the examples page', policy = POLICY, allowed = {} } = page
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const absolute = indexProblems(html, address)
  const problems = absolute.length === 0 ? [] : [`the built page asks formancy.ai for files other than by a path relative to it, which formancy.ai answers from its own site: ${absolute.join(', ')}`]
  const vite = await viteBuild(root, mode)
  for (const problem of namingProblems(vite)) problems.push(`${name}'s Vite config ${problem}`)
  const copiedFrom = vite.publicDir === null ? null : join(vite.publicDir, HASHED)
  const copied = copiedFrom !== null && existsSync(copiedFrom) ? readdirSync(copiedFrom) : []
  const assets = readdirSync(join(dist, HASHED))
  const unhashed = unhashedAssets(assets, copied)
  if (unhashed.length > 0) problems.push(`${HASHED} holds files copied from the public directory or whose names carry no hash, which the headers would cache for a year: ${unhashed.join(', ')}`)
  const unloaded = unloadedAssets(Object.fromEntries(assets.map((name) => [name, readFileSync(join(dist, HASHED, name), 'utf8')])), html)
  if (unloaded.length > 0) problems.push(`${HASHED} holds files the page never loads, an earlier build's, which the deploy would serve too; delete ${relative(repo, dist).replaceAll('\\', '/')} and build again: ${unloaded.join(', ')}`)
  const stylesheets = assets.filter((name) => name.endsWith('.css')).map((name) => readFileSync(join(dist, HASHED, name), 'utf8'))
  for (const problem of policyProblems(policy, { html, stylesheets, address }, { allowed })) problems.push(`the Content-Security-Policy does not fit the built page: ${problem}`)
  if (!existsSync(join(dist, NOTICES_FILE))) problems.push(`the build has no ${NOTICES_FILE}, and the page bundles other people's packages, whose licences go with it (0046)`)
  return problems
}

async function main(args) {
  const unknown = args.filter((arg) => arg !== '--dry-run')
  if (unknown.length > 0) throw new Error(`unknown argument ${unknown.join(' ')}; usage: node scripts/demo.mjs [--dry-run]`)
  const dryRun = args.includes('--dry-run')
  const config = readDemoConfig()
  const problems = configProblems(config)
  if (problems.length > 0) throw new Error(`apps/examples/wrangler.json is not the demo's:\n  ${problems.join('\n  ')}`)
  const changed = run('git', ['status', '--porcelain'])
  if (changed !== '' && !dryRun) throw new Error(`the checkout has changes, and the deployment would name a commit that does not hold them; commit them first:\n${changed}`)
  const dist = join(app, 'dist')
  if (!existsSync(join(dist, 'index.html'))) throw new Error('apps/examples/dist/index.html is not there: run `pnpm build` first, or `pnpm demo:deploy`, which does')
  const built = await buildProblems(dist, demoUrl(config))
  if (built.length > 0) throw new Error(`the build is not the demo's:\n  ${built.join('\n  ')}`)
  const commit = run('git', ['rev-parse', 'HEAD'])
  const stage = join(app, STAGE)
  const base = demoBase(config)
  rmSync(stage, { recursive: true, force: true })
  try {
    cpSync(dist, join(stage, base), { recursive: true })
    writeFileSync(join(stage, '_headers'), headersFile(headerRules(base)))
    const deploy = ['--yes', WRANGLER, 'deploy', '--config', 'apps/examples/wrangler.json', '--message', `formancy.ai-data@${commit}`, ...(dryRun ? ['--dry-run'] : [])]
    run('npx', deploy, { stdio: 'inherit' })
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  console.log(dryRun ? `\nchecked, and nothing uploaded: ${commit}${changed === '' ? '' : ', with uncommitted changes'} would be served at ${demoUrl(config)}` : `\n${commit} is served at ${demoUrl(config)}`)
}

// Run as a program, and only as one: scripts/live-demo.mjs imports this
// file, and its name ends in demo.mjs too. Compared by real path: Node
// gives the main module its real path and the program the path it was
// typed with, so through a linked directory the two differ, and compared
// as given this did nothing and exited 0, a deploy reported that never ran.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    console.error(`\nthe demo was not deployed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
