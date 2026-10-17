// `pnpm live-demo:deploy`: the live master-detail demo at formancy.ai/data/demo/
// (0070) -- the host page's demo build as static assets, and a Worker whose
// Durable Object starts each visitor's own Cloudflare Container running the
// real data server and PostgreSQL (deploy/demo/Dockerfile) -- deployed with
// the config apps/live-demo/wrangler.json and the headers
// scripts/live-demo-headers.mjs decides.
//
//   pnpm live-demo:deploy                 build, check, deploy with the Cloudflare login Wrangler holds
//   node scripts/live-demo.mjs --dry-run  check, and let Wrangler build the Worker and the image without uploading either, after `pnpm build`
//
// It mirrors scripts/demo.mjs, the examples page's deploy (0069), and reuses
// its checks: the Worker is routed at one path below formancy.ai/data and
// nowhere else, so formancy.ai's own Worker and the examples' never see its
// requests and it never sees theirs, and /data itself stays formancy.ai's.
// Unlike the examples' Worker this one runs code, so the config it accepts
// is exactly the demo's: one Worker, its routes, its assets, one container
// of one image and size and cap, one Durable Object class, observability
// off, and nothing else -- no variable, secret or binding of any kind.
//
// The page is the host page built in its demo mode, with a relative base,
// so one build is right under /data/demo/ and at the root of `vite
// preview`; it is staged under that path in apps/live-demo/.cloudflare,
// the directory the config names, with the `_headers` file at its root, and
// the staging is removed afterwards. The image is built from its Dockerfile
// by Wrangler, from the repository root, so Docker must answer, in the dry
// run too: Wrangler 4.146.0 builds a Dockerfile's image for a dry run and
// pushes nothing ("deploying (even in dry-run mode)" in its
// buildDeployContainerImages; read in its published wrangler-dist/cli.js,
// not run, on 2026-10-16), and asks for no login (`requireAuth` only when
// not a dry run). `--containers-rollout=immediate` replaces every running
// container at once when the image changes, which a demo whose data resets
// anyway can afford.
//
// Cloudflare's Workers Builds runs this on every push to main, as the
// deploy command after `pnpm build` (.github/REPO-METADATA.md), with the API
// token it generates. By hand it needs a Cloudflare login that can edit
// Workers and Containers on formancy.ai's account and zone, `npx --yes
// <WRANGLER> login` once, and a clean checkout: the deployment's message
// names the commit it is. GitHub's workflows hold no Cloudflare token and
// never run it.

import { cpSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IDLE_MINUTES, MAX_INSTANCES, PREFIX, SESSION_PATH } from '../apps/live-demo/dist/worker/pure.mjs'
import { buildProblems, run, WRANGLER } from './demo.mjs'
import { LIVE_ALLOWED, LIVE_POLICY, liveHeadersFile } from './live-demo-headers.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(repo, 'apps', 'live-demo')
const host = join(repo, 'apps', 'host')

/** The config Wrangler is given, from the repository root. */
export const LIVE_CONFIG = 'apps/live-demo/wrangler.json'

/** Where the host page's demo build is written (`build:demo`). */
export const DEMO_BUILD = 'apps/host/dist-demo'

/** The site the demo is a path of: formancy.ai's zone. */
const HOST = 'formancy.ai'

/**
 * The live demo's Worker. Wrangler deploys to whichever Worker the config
 * names: `formancy-ai` would put this in place of formancy.ai's whole site,
 * `formancy-data-examples` in place of the examples page.
 */
export const LIVE_WORKER = 'formancy-data-demo'

/** The Worker's code, which Wrangler bundles from source. */
const MAIN = 'src/worker.ts'

/** The directory the config gives Wrangler, where the build is staged under the demo's path. */
const STAGE = './.cloudflare'

/** The Durable Object class the container is attached to, and the binding the Worker reaches it by (worker.ts). */
const CLASS = 'DemoServer'
const BINDING = 'DEMO'

/** The image, built from the repository root so .dockerignore applies, at the size its Dockerfile's header measured for (0070). */
const CONTAINER = Object.freeze({ class_name: CLASS, image: '../../deploy/demo/Dockerfile', image_build_context: '../..', instance_type: 'basic', max_instances: MAX_INSTANCES })

/** Everything the live demo's config may say. Anything else -- a variable, a secret, a binding of any kind -- is more than the demo has. */
const KEYS = ['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'routes', 'assets', 'containers', 'durable_objects', 'exports', 'observability']
const ASSET_KEYS = ['directory', 'html_handling', 'not_found_handling', 'run_worker_first']

/** The paths the Worker runs before the assets: the session, and the runtime plane under the demo's path (worker/routes.ts). */
const WORKER_FIRST = [SESSION_PATH, `${PREFIX}/v1/*`]

/** apps/live-demo/wrangler.json, as Wrangler reads it. */
export function readLiveDemoConfig() {
  return JSON.parse(readFileSync(join(repo, LIVE_CONFIG), 'utf8'))
}

/** The path the demo is served under, with both its slashes: the Worker's PREFIX and a slash, `/data/demo/`. */
export const liveDemoBase = () => `${PREFIX}/`

/** The address a reader opens. */
export const liveDemoUrl = () => `https://${HOST}${liveDemoBase()}`

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const shown = (value) => JSON.stringify(value) ?? 'nothing'

/** What would make the routes anything but the demo's two: the path and everything under it, on formancy.ai's zone, by route and never by domain. */
function routeProblems(routes) {
  const problems = []
  const expected = [`${HOST}${PREFIX}/*`, `${HOST}${PREFIX}`]
  for (const route of routes) {
    if (route.custom_domain !== undefined) problems.push(`the route ${String(route.pattern)} sets custom_domain: a Custom Domain takes a whole hostname, and the demo is one path of ${HOST}`)
    else if (route.zone_name !== HOST) problems.push(`the route ${String(route.pattern)} is on the zone ${String(route.zone_name)}, not ${HOST}`)
    else if (!expected.includes(route.pattern)) problems.push(`the route ${String(route.pattern)} is not the demo's path: it would send the demo's Worker more of ${HOST} than ${liveDemoBase()}`)
    for (const key of Object.keys(route)) if (!['pattern', 'zone_name', 'custom_domain'].includes(key)) problems.push(`the route ${String(route.pattern)} has ${key}, which the demo's routes do not`)
  }
  for (const pattern of expected) {
    if (!routes.some((route) => route.pattern === pattern && route.zone_name === HOST && route.custom_domain === undefined)) problems.push(`no route ${pattern} on the zone ${HOST}: ${pattern.endsWith('*') ? 'the page, its files and its Worker' : `the path without its slash, which the assets send to ${liveDemoBase()},`} would be answered by formancy.ai's site`)
  }
  return problems
}

/** What would make the one container anything but the demo's image, at its size and cap, with no way in but its Worker. */
function containerProblems(containers) {
  if (!Array.isArray(containers) || containers.length !== 1) return [`the config has ${Array.isArray(containers) ? String(containers.length) : 'no list of'} containers, and the demo has exactly one`]
  const [container] = containers
  const problems = []
  for (const key of Object.keys(container)) {
    if (!(key in CONTAINER)) problems.push(`the container has ${key}, which the demo's does not: its image, size and cap are the Dockerfile's and the Worker's, and nothing reaches it but its Durable Object`)
  }
  for (const [key, value] of Object.entries(CONTAINER)) {
    if (container[key] !== value) problems.push(`the container's ${key} is ${shown(container[key])}, not ${shown(value)}${key === 'max_instances' ? ", the Worker's MAX_INSTANCES, which its start failure tells a visitor" : ''}`)
  }
  return problems
}

/**
 * What would deploy anything but the live demo, or more than it, at
 * formancy.ai/data/demo/: one sentence per problem, none when the config is
 * the demo's.
 */
export function liveConfigProblems(config) {
  const problems = []
  if (config.name !== LIVE_WORKER) problems.push(`the config names the Worker ${String(config.name)}, not ${LIVE_WORKER}: the deploy would replace whatever that Worker serves`)
  if (config.main !== MAIN) problems.push(`the config's main is ${String(config.main)}, not ${MAIN}, the Worker and its Durable Object`)
  for (const key of Object.keys(config)) if (!KEYS.includes(key)) problems.push(`the config has ${key}, which the live demo's Worker does not: it has its assets, its container and its Durable Object, and no variable, secret or other binding`)
  if (config.workers_dev !== false) problems.push('workers_dev is not false: the demo would answer on a workers.dev address beside formancy.ai')
  if (config.preview_urls !== false) problems.push('preview_urls is not false: every version would answer on an address of its own')
  problems.push(...routeProblems(config.routes ?? []))
  const assets = config.assets ?? {}
  for (const key of Object.keys(assets)) if (!ASSET_KEYS.includes(key)) problems.push(`the config has assets.${key}, which the live demo's Worker does not: no code reads the page's files`)
  if (assets.directory !== STAGE) problems.push(`assets.directory is ${String(assets.directory)}, not ${STAGE}: the deploy stages the build there, under the demo's path`)
  if (assets.html_handling !== 'auto-trailing-slash') problems.push(`assets.html_handling is ${String(assets.html_handling)}, not auto-trailing-slash, which sends the path without its slash to the page and its relative files`)
  if (assets.not_found_handling !== 'none') problems.push(`assets.not_found_handling is ${String(assets.not_found_handling)}, not none: a path the build does not have is the Worker's 404, never the page`)
  if (!same(assets.run_worker_first, WORKER_FIRST)) problems.push(`assets.run_worker_first is ${shown(assets.run_worker_first)}, not ${shown(WORKER_FIRST)}: the Worker runs before the files for the session and the runtime plane, and for nothing else`)
  problems.push(...containerProblems(config.containers))
  if (!same(config.durable_objects, { bindings: [{ name: BINDING, class_name: CLASS }] })) problems.push(`durable_objects is ${shown(config.durable_objects)}: the Worker has one binding, ${BINDING}, to its own ${CLASS}`)
  if (!same(config.exports, { [CLASS]: { type: 'durable-object', storage: 'sqlite' } })) problems.push(`exports is ${shown(config.exports)}: the one export is ${CLASS}, a Durable Object with SQLite storage, which a container needs`)
  if (!same(config.observability, { enabled: false })) problems.push(`observability is ${shown(config.observability)}, not {"enabled":false}: Cloudflare would keep the Worker's and the containers' logs of every visitor's requests`)
  return problems
}

/** Wrangler's arguments for the deploy of `commit`, or its dry run. */
export function deployArguments(commit, dryRun) {
  return ['--yes', WRANGLER, 'deploy', '--config', LIVE_CONFIG, '--message', `formancy.ai-data@${commit}`, '--containers-rollout=immediate', ...(dryRun ? ['--dry-run'] : [])]
}

async function main(args) {
  const unknown = args.filter((arg) => arg !== '--dry-run')
  if (unknown.length > 0) throw new Error(`unknown argument ${unknown.join(' ')}; usage: node scripts/live-demo.mjs [--dry-run]`)
  const dryRun = args.includes('--dry-run')
  const config = readLiveDemoConfig()
  const problems = liveConfigProblems(config)
  if (problems.length > 0) throw new Error(`${LIVE_CONFIG} is not the live demo's:\n  ${problems.join('\n  ')}`)
  const changed = run('git', ['status', '--porcelain'])
  if (changed !== '' && !dryRun) throw new Error(`the checkout has changes, and the deployment would name a commit that does not hold them; commit them first:\n${changed}`)
  try {
    run('docker', ['info', '--format', '{{.ServerVersion}}'])
  } catch {
    throw new Error('Docker does not answer: Wrangler builds the image from deploy/demo/Dockerfile, in the dry run too')
  }
  run('pnpm', ['--filter', '@formancy/data-host', 'build:demo'], { stdio: 'inherit' })
  const dist = join(repo, DEMO_BUILD)
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${DEMO_BUILD}/index.html is not there after build:demo`)
  const built = await buildProblems(dist, liveDemoUrl(), { root: host, mode: 'demo', name: "the host page's demo build", policy: LIVE_POLICY, allowed: LIVE_ALLOWED })
  if (built.length > 0) throw new Error(`the build is not the live demo's:\n  ${built.join('\n  ')}`)
  const commit = run('git', ['rev-parse', 'HEAD'])
  const stage = join(app, STAGE)
  rmSync(stage, { recursive: true, force: true })
  try {
    cpSync(dist, join(stage, liveDemoBase()), { recursive: true })
    writeFileSync(join(stage, '_headers'), liveHeadersFile(liveDemoBase()))
    run('npx', deployArguments(commit, dryRun), { stdio: 'inherit' })
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  console.log(
    dryRun
      ? `\nchecked, and nothing uploaded: ${commit}${changed === '' ? '' : ', with uncommitted changes'} would be served at ${liveDemoUrl()}`
      : `\n${commit} is served at ${liveDemoUrl()}, each visitor's server stopping ${String(IDLE_MINUTES)} minutes after their last request, at most ${String(MAX_INSTANCES)} at once`,
  )
}

// Run as a program, and only as one, compared by real path as
// scripts/demo.mjs's guard is, and for its reason: through a linked
// directory a guard that compared the paths as given did nothing and
// exited 0.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    console.error(`\nthe live demo was not deployed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
