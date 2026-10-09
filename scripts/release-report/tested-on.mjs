// What this checkout is tested on, as far as the tree itself can say (0035):
// the images the suites start unless a file names another, every runtime
// dependency a published package declares and the version the suites load,
// the upstream packages, Node, the browser the gates launch, and the tools.
//
// Static facts, derived: nothing here is typed except NESTED, and a guard
// holds that. What a run actually met -- each server's own version and image
// digest, every other image a test started, the Node and the Chromium it
// launched -- comes from that run's results, in the report; this is what the
// README's generated table and the report's "range -> loaded" columns read.
//
// Run after `pnpm install` and `pnpm build`: the images and the engines come
// from data-fixtures' and data-core's built output, the code that uses them.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { installed, mustBeInstalled } from './installed.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The one typed list: a dependency that is a facade over the package that
 * does the work, and that package. mssql is the API data-sqlserver calls;
 * tedious is what speaks TDS to the server, and its version is the one a
 * protocol question turns on. tested-on.test.mjs fails when an entry is not
 * a dependency of its parent as installed.
 */
export const NESTED = { mssql: ['tedious'] }

/** What the report and the README call tooling, and where each is resolved from: the apps that declare it, or one directory. */
const TOOLING = [
  { name: 'jsdom', apps: true },
  { name: 'react', apps: true },
  { name: '@angular/core', apps: true },
  { name: 'axe-core', apps: true },
  { name: 'typescript', dir: '.' },
  { name: 'vitest', dir: '.' },
  { name: 'testcontainers', dir: 'packages/data-fixtures' },
]

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** Every workspace package: `{ dir, manifest }`, dir repository-relative, in path order. */
export function workspace(root = repo) {
  const found = []
  for (const group of ['packages', 'apps']) {
    if (!existsSync(join(root, group))) continue
    for (const name of readdirSync(join(root, group)).sort()) {
      const file = join(root, group, name, 'package.json')
      if (existsSync(file)) found.push({ dir: `${group}/${name}`, manifest: readJson(file) })
    }
  }
  return found
}

/** The packages a release publishes: every package under packages/ that is not private. */
export function published(root = repo) {
  return workspace(root).filter(({ dir, manifest }) => dir.startsWith('packages/') && manifest.private !== true)
}

/** The built module of a workspace package, imported: what the suites and gates run. */
async function built(root, dir) {
  const file = join(root, dir, 'dist', 'index.mjs')
  if (!existsSync(file)) throw new Error(`${dir} is not built: run pnpm build`)
  return import(pathToFileURL(file).href)
}

/** Every runtime dependency of every published package: the range it is published with and the version the suites load. */
function runtime(root, packages, local) {
  const entries = []
  for (const { dir, manifest } of [...packages].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))) {
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (local.has(name) || String(range).startsWith('workspace:') || name.startsWith('@formancy/')) continue
      const found = mustBeInstalled(join(root, dir), name)
      entries.push({ package: manifest.name, name, range, loaded: found.version })
      for (const inner of NESTED[name] ?? []) {
        const parent = readJson(join(found.dir, 'package.json'))
        const below = mustBeInstalled(found.dir, inner)
        entries.push({ package: manifest.name, name: inner, under: name, range: parent.dependencies?.[inner] ?? null, loaded: below.version })
      }
    }
  }
  return entries
}

/** Every upstream @formancy/* package a workspace manifest names, and theirs, recursively; each as Node loads it. */
function upstream(root, packages, local) {
  const seen = new Map()
  const visit = (fromDir, name, declared, direct) => {
    const found = mustBeInstalled(fromDir, name)
    const key = `${name}@${found.version}`
    const entry = seen.get(key) ?? { name, version: found.version, declared: null, direct: false }
    if (declared !== null) entry.declared = declared
    entry.direct ||= direct
    if (seen.has(key)) return
    seen.set(key, entry)
    for (const [inner] of Object.entries(readJson(join(found.dir, 'package.json')).dependencies ?? {})) {
      if (inner.startsWith('@formancy/')) visit(found.dir, inner, null, false)
    }
  }
  for (const { dir, manifest } of packages) {
    for (const field of FIELDS) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        if (name.startsWith('@formancy/') && !local.has(name)) visit(join(root, dir), name, String(spec), true)
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/** Every `node-version` an `actions/setup-node` step of a workflow sets, with where. */
export function setupNodeVersions(root = repo) {
  const dir = join(root, '.github', 'workflows')
  const found = []
  for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort()) {
    const workflow = YAML.parse(readFileSync(join(dir, file), 'utf8'))
    for (const [job, definition] of Object.entries(workflow?.jobs ?? {})) {
      for (const step of definition?.steps ?? []) {
        if (String(step.uses ?? '').startsWith('actions/setup-node') && step.with?.['node-version'] !== undefined) {
          found.push({ workflow: file, job, version: String(step.with['node-version']) })
        }
      }
    }
  }
  return found
}

/** Every stage's base image of a Dockerfile, a `--platform=` or other flag skipped. */
export function dockerfileImages(text) {
  return [...text.matchAll(/^FROM\s+(?:--\S+\s+)*(\S+)/gim)].map((match) => match[1])
}

/** The tools, each with every version the directories that use it load, and which directories those are. */
function tooling(root, packages) {
  const apps = packages.filter(({ dir }) => dir.startsWith('apps/'))
  return TOOLING.map(({ name, apps: fromApps, dir }) => {
    const dirs = fromApps ? apps.filter(({ manifest }) => FIELDS.some((field) => manifest[field]?.[name] !== undefined)).map((app) => app.dir) : [dir]
    if (dirs.length === 0) throw new Error(`no app declares ${name}, which the report names as tooling`)
    const versions = new Map()
    for (const from of dirs) {
      const { version } = mustBeInstalled(join(root, from), name)
      versions.set(version, [...(versions.get(version) ?? []), from])
    }
    return { name, versions: [...versions].map(([version, from]) => ({ version, from })) }
  })
}

/** Playwright as the gates load it, and the Chromium build it pins: the headless shell `chromium.launch()` starts. */
function browser(root) {
  const playwright = mustBeInstalled(join(root, 'apps', 'examples'), 'playwright')
  const core = mustBeInstalled(playwright.dir, 'playwright-core')
  const pins = readJson(join(core.dir, 'browsers.json')).browsers
  const shell = pins.find((entry) => entry.name === 'chromium-headless-shell')
  if (shell === undefined) throw new Error(`playwright-core ${core.version} pins no chromium-headless-shell`)
  return { playwright: playwright.version, chromium: { name: shell.name, revision: shell.revision, browserVersion: shell.browserVersion } }
}

/** The package manager corepack runs, from the root's `packageManager`: `pnpm@12.4.2` is pnpm 12.4.2, a `+sha…` suffix dropped. */
function packageManager(manifest) {
  const declared = manifest.packageManager
  const match = /^(@?[^@]+)@([^+]+)/.exec(String(declared ?? ''))
  if (match === null) throw new Error('the root package.json declares no packageManager, which corepack runs')
  return { name: match[1], version: match[2], declared }
}

/** Every committed snapshot an app renders from: the server version it was captured from. */
function snapshots(root, kinds) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.json')) {
        const value = readJson(full)
        if (kinds.includes(value?.kind) && typeof value.serverVersion === 'string' && Array.isArray(value.objects)) {
          found.push({ file: relative(root, full).replaceAll('\\', '/'), kind: value.kind, serverVersion: value.serverVersion })
        }
      }
    }
  }
  for (const { dir } of workspace(root).filter((entry) => entry.dir.startsWith('apps/'))) {
    if (existsSync(join(root, dir, 'src'))) walk(join(root, dir, 'src'))
  }
  return found.sort((a, b) => a.file.localeCompare(b.file))
}

/** Everything above, for `root`. Throws, naming the package, when a lookup finds nothing. */
export async function testedOn(root = repo) {
  const packages = workspace(root)
  const local = new Set(packages.map(({ manifest }) => manifest.name))
  const { DEFAULT_IMAGES } = await built(root, 'packages/data-fixtures')
  const { DATABASE_KINDS } = await built(root, 'packages/data-core')
  const rootManifest = readJson(join(root, 'package.json'))
  return {
    engines: [...DATABASE_KINDS],
    images: { ...DEFAULT_IMAGES },
    runtime: runtime(root, published(root), local),
    upstream: upstream(root, packages, local),
    node: {
      engines: rootManifest.engines?.node ?? null,
      dockerfile: dockerfileImages(readFileSync(join(root, 'packages', 'data-server', 'Dockerfile'), 'utf8')),
      ci: setupNodeVersions(root),
      declared: published(root)
        .filter(({ manifest }) => manifest.engines?.node !== undefined)
        .map(({ manifest }) => ({ package: manifest.name, node: manifest.engines.node })),
    },
    packageManager: packageManager(rootManifest),
    browser: browser(root),
    tooling: tooling(root, packages),
    snapshots: snapshots(root, [...DATABASE_KINDS]),
  }
}

export { installed }
