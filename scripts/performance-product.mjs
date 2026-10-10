// What the published performance figures were measured on, as content (0034):
// the source files the measurement runs, the installed runtime dependencies of
// the server and the client, and the build inputs that turn one into the
// other. `compareProduct` names how it differs from what results.json
// recorded, `performance-stale.mjs` is the command that runs it, and the
// release refuses while they differ.
//
// Node built-ins only, so it runs in the release's `check` job without a
// build and is tested on a temporary tree with no pnpm.
//
// **Files** are found by following imports, not by listing directories:
// from the server's composition root and the measurement's entry, relative
// imports to their `.ts` files, and a workspace package (`@formancy/data-*`)
// into its `src/index.ts`, following only the re-exports that export a name
// the importer asked for -- `export *` and a namespace import take everything.
// `import type` is skipped, because types do not run. A pattern, not a
// TypeScript parser: the repository's test holds what it finds.
//
// **Packages** are found by walking up `node_modules` from each requiring
// package's real path and reading `<dir>/node_modules/<name>/package.json`
// directly. Resolving `<name>/package.json` through an exports map throws for
// `postgres` and `@formancy/spec`, whose maps do not export it.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/** Where the measurement starts: the server the harness runs as a child, and the harness. */
export const ENTRIES = ['packages/data-server/src/main.ts', 'packages/data-performance/src/measure.ts']

/** Files the measurement reads by name rather than by import: the fixture the databases load. */
const BY_NAME = [{ directory: 'packages/data-fixtures/fixtures', pattern: /\.sql$/ }]

/** Whose installed dependency tree runs inside a timed sample. */
const RUNTIME = ['@formancy/data-server', '@formancy/data-client']

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const toPosix = (path) => path.replaceAll('\\', '/')

/** Every workspace package by name: its directory, relative to the root. */
function workspace(root) {
  const packages = new Map()
  for (const group of ['packages', 'apps']) {
    if (!existsSync(join(root, group))) continue
    for (const name of readdirSync(join(root, group)).sort()) {
      const file = join(root, group, name, 'package.json')
      if (existsSync(file)) packages.set(JSON.parse(readFileSync(file, 'utf8')).name, `${group}/${name}`)
    }
  }
  return packages
}

/** `import`/`export … from` statements, multi-line braces included, and bare `import '…'`. */
const FROM = /^[ \t]*(import|export)[ \t]+(type[ \t]+)?(\{[^}]*\}|\*(?:[ \t]+as[ \t]+[\w$]+)?|[\w$]+(?:[ \t]*,[ \t]*(?:\{[^}]*\}|\*[ \t]+as[ \t]+[\w$]+))?)[ \t]*from[ \t]*['"]([^'"]+)['"]/gm
const BARE = /^[ \t]*import[ \t]+['"]([^'"]+)['"]/gm

/**
 * One statement's names: for an import, the names asked of the source; for a
 * re-export, a map from the name it exports to the name in the source; all
 * for a namespace or `export *`. Entries written `type X` are types.
 */
function clauseNames(kind, clause) {
  if (clause.startsWith('*')) return { all: true, names: new Map() }
  const names = new Map()
  const braces = /\{([^}]*)\}/.exec(clause)
  const bare = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
  if (bare.startsWith('*')) return { all: true, names }
  if (bare !== '') names.set(kind === 'import' ? 'default' : bare, 'default')
  for (const part of (braces?.[1] ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')) {
    if (/^type\s/.test(part)) continue
    const [source, , alias] = part.split(/\s+/)
    names.set(alias ?? source, source)
  }
  return { all: false, names }
}

/** The statements of one module: what it imports or re-exports, from where, with which names. */
function statements(text) {
  const found = []
  for (const match of text.matchAll(FROM)) {
    const [, kind, type, clause, specifier] = match
    if (type !== undefined) continue
    const { all, names } = clauseNames(kind, clause.trim())
    if (!all && names.size === 0) continue
    found.push({ kind, specifier, all, names })
  }
  for (const match of text.matchAll(BARE)) found.push({ kind: 'import', specifier: match[1], all: true, names: new Map() })
  return found
}

/** A relative specifier as the `.ts` file it names: `./x.js` is `./x.ts`. */
function relativeFile(root, from, specifier) {
  const target = resolve(dirname(join(root, from)), specifier)
  const candidates = [target.replace(/\.(m?js)$/, '.ts'), target, `${target}.ts`, join(target, 'index.ts')]
  const found = candidates.find((candidate) => existsSync(candidate) && candidate.endsWith('.ts'))
  if (found === undefined) throw new Error(`${from} imports ${specifier}, which is no .ts file`)
  return toPosix(relative(root, found))
}

/**
 * The source files the measurement runs, sorted: every module reached from
 * `ENTRIES`, and the files read by name. Tests are never reached; if one
 * were, it is left out all the same.
 */
export function productFiles(root) {
  const packages = workspace(root)
  const indexes = new Map([...packages.entries()].map(([name, directory]) => [`${directory}/src/index.ts`, name]))
  const whole = new Set()
  const asked = new Map()
  const queue = ENTRIES.map((file) => ({ file, all: true, names: new Set() }))

  while (queue.length > 0) {
    const { file, all, names } = queue.shift()
    const text = readFileSync(join(root, file), 'utf8')
    const isIndex = indexes.has(file)
    if (!isIndex || all) {
      if (whole.has(file)) continue
      whole.add(file)
    } else {
      // An index reached by name: only the names nobody asked of it before.
      const before = asked.get(file) ?? new Set()
      const fresh = [...names].filter((name) => !before.has(name))
      if (fresh.length === 0 || whole.has(file)) continue
      asked.set(file, new Set([...before, ...fresh]))
      names.clear()
      for (const name of fresh) names.add(name)
    }
    for (const statement of statements(text)) {
      let target
      if (statement.specifier.startsWith('.')) target = relativeFile(root, file, statement.specifier)
      else if (packages.has(statement.specifier) && statement.specifier.startsWith('@formancy/data-')) target = `${packages.get(statement.specifier)}/src/index.ts`
      else continue
      if (isIndex && !all && statement.kind === 'export') {
        // A re-export line is followed only for the names it exports that were asked for.
        if (statement.all) {
          queue.push({ file: target, all: true, names: new Set() })
          continue
        }
        const wanted = [...statement.names.entries()].filter(([exported]) => names.has(exported)).map(([, source]) => source)
        if (wanted.length > 0) queue.push({ file: target, all: indexes.has(target) ? false : true, names: new Set(wanted) })
        continue
      }
      if (statement.kind === 'export' && !isIndex) {
        queue.push({ file: target, all: true, names: new Set() })
        continue
      }
      queue.push({ file: target, all: statement.all || !indexes.has(target), names: new Set(statement.names.values()) })
    }
  }
  const found = new Set([...whole, ...asked.keys()])
  for (const { directory, pattern } of BY_NAME) {
    if (!existsSync(join(root, directory))) continue
    for (const name of readdirSync(join(root, directory))) if (pattern.test(name)) found.add(`${directory}/${name}`)
  }
  return [...found].filter((file) => !/\.test\.[cm]?[jt]sx?$/.test(file)).sort()
}

/** The directory of `name` as `from` would load it: the first `node_modules/<name>` walking up from `from`'s real path. */
function installed(from, name) {
  for (let directory = realpathSync(from); ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(directory) === directory) return undefined
  }
}

/**
 * The installed runtime closure of the server and the client, `name` to
 * version: dependencies, optional dependencies that are installed, and peer
 * dependencies that are. Workspace packages are counted as files, not
 * versions, and `@types/*` not at all: a declaration package in the tree
 * (`@types/mssql`, which the SQL Server adapter's published types need)
 * runs nothing, as `import type` runs nothing. A required dependency that
 * is not installed throws.
 */
export function runtimeClosure(root) {
  const packages = workspace(root)
  const versions = new Map()
  const seen = new Set()
  const visit = (directory, name) => {
    if (seen.has(directory)) return
    seen.add(directory)
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (!packages.has(name)) versions.set(name, new Set([...(versions.get(name) ?? []), manifest.version]))
    const groups = [
      [manifest.dependencies, true],
      [manifest.optionalDependencies, false],
      [manifest.peerDependencies, false],
    ]
    for (const [dependencies, required] of groups) {
      for (const dependency of Object.keys(dependencies ?? {})) {
        if (dependency.startsWith('@types/')) continue
        const local = packages.get(dependency)
        const found = local === undefined ? installed(directory, dependency) : join(root, local)
        if (found === undefined) {
          if (required) throw new Error(`${name} depends on ${dependency}, which is not installed`)
          continue
        }
        visit(found, dependency)
      }
    }
  }
  for (const name of RUNTIME) visit(join(root, packages.get(name)), name)
  return Object.fromEntries(
    [...versions.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, set]) => [name, [...set].sort().join(', ')]),
  )
}

/** The build's inputs: each reached package's tsdown and TypeScript configuration, the base, and the two tools' versions. */
export function buildInputs(root, files) {
  const build = {}
  const reached = new Set(files.map((file) => file.split('/').slice(0, 2).join('/')).filter((directory) => directory.startsWith('packages/')))
  for (const directory of [...reached].sort()) {
    for (const name of ['tsdown.config.ts', 'tsconfig.json']) {
      const path = `${directory}/${name}`
      if (existsSync(join(root, path))) build[path] = sha256(join(root, path))
    }
  }
  build['tsconfig.base.json'] = sha256(join(root, 'tsconfig.base.json'))
  for (const tool of ['tsdown', 'typescript']) {
    const from = [...reached].map((directory) => installed(join(root, directory), tool)).find((found) => found !== undefined) ?? installed(root, tool)
    if (from === undefined) throw new Error(`${tool} is not installed`)
    build[tool] = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).version
  }
  return build
}

/** The product as results.json records it and the stale check compares it. */
export function describeProduct(root) {
  const files = productFiles(root)
  return {
    files: Object.fromEntries(files.map((file) => [file, sha256(join(root, file))])),
    packages: runtimeClosure(root),
    build: buildInputs(root, files),
  }
}

/** Every way `current` differs from `recorded`, as sentences in a fixed order; none when the figures still describe it. */
export function compareProduct(recorded, current) {
  const problems = []
  const keys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  for (const file of keys(recorded.files, current.files)) {
    if (!(file in recorded.files)) problems.push(`added: ${file}`)
    else if (!(file in current.files)) problems.push(`removed: ${file}`)
    else if (recorded.files[file] !== current.files[file]) problems.push(`changed: ${file}`)
  }
  for (const name of keys(recorded.packages, current.packages)) {
    if (recorded.packages[name] !== current.packages[name]) problems.push(`${name}: measured ${recorded.packages[name] ?? 'nothing'}, installed ${current.packages[name] ?? 'nothing'}`)
  }
  for (const input of keys(recorded.build, current.build)) {
    if (recorded.build[input] !== current.build[input]) problems.push(`build input changed: ${input}`)
  }
  return problems.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
