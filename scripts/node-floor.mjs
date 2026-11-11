import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseAllDocuments } from 'yaml'

/*
 * Two Node versions are claims about packages this repository installs
 * (0148), and a package moving its own floor makes either false without a
 * word:
 *
 * - the workspace's floor, `engines.node` in the root package.json: the
 *   oldest Node a contributor may install, build and test on, so every
 *   package the lockfile installs must accept it. undici 8.12 reads
 *   `zlib.createZstdDecompress` as it loads, which Node 22.18 does not
 *   have, and the suites that load jsdom stop there;
 * - the server image's Node, the `node:` tag its Dockerfile is built FROM:
 *   every package `pnpm --filter @formancy/data-server --prod deploy` puts
 *   in the image must accept the oldest release that tag names.
 *
 * Ranges are read as npm reads an `engines` field, as far as the lockfile
 * uses them: alternatives joined by `||`, each a set of comparators joined
 * by spaces (`>=`, `>`, `<=`, `<`, `=` or none, and a caret), a version
 * with `x` or `*` for a part, or a part left out. A range this reader
 * cannot read throws, so it fails the guard rather than passing it.
 */

/** A version as three numbers, a part left out or given as `x` or `*` as null. */
function partsOf(text) {
  const match = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?$/u.exec(text)
  if (match === null) throw new Error(`not a version: ${text}`)
  return match.slice(1, 4).map((part) => (part === undefined || /^[xX*]$/u.test(part) ? null : Number(part)))
}

function compare(left, right) {
  for (let at = 0; at < 3; at += 1) if (left[at] !== right[at]) return left[at] - right[at]
  return 0
}

/** The lowest version `parts` names, and the one every version it names is below: null where it names one version alone. */
function bounds([major, minor, patch]) {
  if (major === null) return { low: [0, 0, 0], high: [Infinity, 0, 0] }
  if (minor === null) return { low: [major, 0, 0], high: [major + 1, 0, 0] }
  if (patch === null) return { low: [major, minor, 0], high: [major, minor + 1, 0] }
  return { low: [major, minor, patch], high: null }
}

/** Whether `version` meets one comparator. */
function meets(version, comparator) {
  const match = /^(>=|<=|>|<|=|\^)?(\S+)$/u.exec(comparator)
  if (match === null) throw new Error(`not a comparator: ${comparator}`)
  const [, operator = '=', text] = match
  const { low, high } = bounds(partsOf(text))
  switch (operator) {
    case '>=':
      return compare(version, low) >= 0
    case '>':
      return compare(version, high ?? low) >= (high === null ? 1 : 0)
    case '<':
      return compare(version, low) < 0
    case '<=':
      return high === null ? compare(version, low) <= 0 : compare(version, high) < 0
    case '^': {
      const ceiling = low[0] > 0 ? [low[0] + 1, 0, 0] : low[1] > 0 ? [0, low[1] + 1, 0] : [0, 0, low[2] + 1]
      return compare(version, low) >= 0 && compare(version, ceiling) < 0
    }
    default:
      return high === null ? compare(version, low) === 0 : compare(version, low) >= 0 && compare(version, high) < 0
  }
}

/** Whether `version` satisfies `range`, read as the header says. */
export function satisfies(version, range) {
  const parts = partsOf(version)
  return range.split('||').some((alternative) =>
    alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^)\s+/gu, '$1')
      .split(/\s+/u)
      .filter((comparator) => comparator !== '')
      .every((comparator) => meets(parts, comparator)),
  )
}

/** The lowest version a floor such as `>=22.22.3` admits; anything but a plain floor throws. */
export function lowest(floor) {
  const match = /^>=\s*(\d+\.\d+\.\d+)$/u.exec(floor.trim())
  if (match === null) throw new Error(`not a plain floor: ${floor}`)
  return match[1]
}

/** The oldest Node the `node:` tag of every FROM in a Dockerfile names: `node:22.12-alpine` names 22.12.0. */
export function imageNode(dockerfile) {
  const tags = [...dockerfile.matchAll(/^FROM\s+node:(\d+)(?:\.(\d+))?(?:\.(\d+))?\S*/gmu)].map((match) =>
    [match[1], match[2] ?? '0', match[3] ?? '0'].join('.'),
  )
  if (tags.length === 0) throw new Error('the Dockerfile is built FROM no node: image')
  if (new Set(tags).size > 1) throw new Error(`the Dockerfile's stages are built on different Node: ${[...new Set(tags)].join(', ')}`)
  return tags[0]
}

/**
 * The lockfile's documents, and the one that names the project at
 * `importer`: pnpm writes its own tools in a document of their own, with
 * importers of its own.
 */
function workspaceLock(lockText, importer = '.') {
  const documents = parseAllDocuments(lockText).map((document) => document.toJS() ?? {})
  const lock = documents.find((document) => document.importers?.[importer] !== undefined)
  if (lock === undefined) throw new Error(`the lockfile has no project ${importer}`)
  return { documents, lock }
}

/** Each package `packages` holds whose `engines.node` refuses `version`, with the range it asks for. */
function refusals(version, packages) {
  return packages.flatMap(([name, entry]) => {
    const range = entry?.engines?.node
    return typeof range === 'string' && !satisfies(version, range) ? [{ name, range }] : []
  })
}

/** Each package the lockfile installs, in any of its documents, that refuses `version`. */
export function refusing(version, lockText) {
  const { documents } = workspaceLock(lockText)
  return refusals(
    version,
    documents.flatMap((document) => Object.entries(document.packages ?? {})),
  )
}

/**
 * The packages a production deploy of the project at `importer` installs,
 * as `name@version`: its dependencies and optional dependencies, those of
 * every workspace project it links, and theirs, never a devDependency.
 */
export function productionClosure(lockText, importer) {
  const { lock } = workspaceLock(lockText, importer)
  const installed = new Set()
  const projects = new Set()
  const queue = []
  const enter = (path) => {
    const project = lock.importers[path]
    if (project === undefined) throw new Error(`the lockfile has no project ${path}, which ${importer} links`)
    projects.add(path)
    for (const [name, spec] of Object.entries({ ...project.dependencies, ...project.optionalDependencies }))
      queue.push({ name, version: spec.version, from: path })
  }
  enter(importer)
  while (queue.length > 0) {
    const { name, version, from } = queue.pop()
    if (version.startsWith('link:')) {
      const target = new URL(`${version.slice('link:'.length)}/`, `file:///${from}/`).pathname.slice(1, -1)
      if (!projects.has(target)) enter(target)
      continue
    }
    const key = `${name}@${version}`
    if (installed.has(key)) continue
    installed.add(key)
    const snapshot = lock.snapshots?.[key] ?? {}
    for (const [child, childVersion] of Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies }))
      queue.push({ name: child, version: childVersion, from })
  }
  return installed
}

/** Each package of the production deploy of `importer` that refuses `version`. */
export function deployRefusing(version, lockText, importer) {
  const { lock } = workspaceLock(lockText, importer)
  // A snapshot's key carries its peers, `name@1.0.0(peer@2.0.0)`; its
  // package entry, which holds `engines`, is keyed without them.
  const entries = [...productionClosure(lockText, importer)].map((key) => {
    const bare = key.replace(/\(.*$/u, '')
    return [bare, lock.packages?.[bare]]
  })
  return refusals(version, entries)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('..', import.meta.url)
  const read = (path) => readFileSync(new URL(path, root), 'utf8')
  const lockText = read('pnpm-lock.yaml')
  const floor = lowest(JSON.parse(read('package.json')).engines.node)
  const image = imageNode(read('packages/data-server/Dockerfile'))
  const workspace = refusing(floor, lockText)
  const deployed = deployRefusing(image, lockText, 'packages/data-server')
  for (const { name, range } of workspace) console.log(`the workspace's Node ${floor}: ${name} asks for ${range}`)
  for (const { name, range } of deployed) console.log(`the server image's Node ${image}: ${name} asks for ${range}`)
  console.log(`${String(workspace.length + deployed.length)} refusals`)
  process.exitCode = workspace.length + deployed.length === 0 ? 0 : 1
}
