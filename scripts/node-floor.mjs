import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseAllDocuments } from 'yaml'
import { dockerfileStages } from './release-report/tested-on.mjs'

/*
 * Two Node versions are claims about packages this repository installs
 * (0148), and a package moving its own floor makes either false without a
 * word:
 *
 * - the workspace's, `engines.node` in the root package.json: every Node it
 *   admits is one a contributor may install, build and test on, so every
 *   package the lockfile installs must accept the lowest release of each
 *   major it admits. undici 8.12 reads `zlib.createZstdDecompress` as it
 *   loads, which Node 22.14 does not have, and the suites that load jsdom
 *   stopped there;
 * - the server image's, the `node:` tag its last stage is built FROM:
 *   every package `pnpm --filter @formancy/data-server --prod deploy` puts
 *   in the image must accept the oldest release that tag names.
 *
 * Ranges are read as npm reads an `engines` field, as far as the lockfile
 * uses them: alternatives joined by `||`, each a set of comparators joined
 * by spaces (`>=`, `>`, `<=`, `<`, `=` or none, and a caret), a version
 * with `x` or `*` for a part, or a part left out. A range this reader
 * cannot read, a pre-release among them, throws, as does a lockfile entry
 * or a Dockerfile stage it cannot follow: each fails the guard rather than
 * passing it.
 */

/** A version as three numbers, a part left out or given as `x` or `*` as null. */
function partsOf(text) {
  const match = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/u.exec(text)
  if (match === null) throw new Error(`not a version this reader knows: ${text}`)
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

/**
 * The lowest release of each major the floor admits, from its lowest major
 * to `last`: `^22.22.3 || ^24.15.0 || >=26.0.0` admits 22.22.3, 24.15.0,
 * 26.0.0 and every major after. A floor is alternatives of `^X.Y.Z` or
 * `>=X.Y.Z`; anything else throws, since its lowest releases would be a
 * guess.
 */
export function admitted(floor, last) {
  const lowest = new Map()
  const keep = (major, version) => {
    const kept = lowest.get(major)
    if (kept === undefined || compare(partsOf(version), partsOf(kept)) < 0) lowest.set(major, version)
  }
  for (const alternative of floor.split('||')) {
    const match = /^(\^|>=)\s*(\d+)\.(\d+)\.(\d+)$/u.exec(alternative.trim())
    if (match === null || (match[1] === '^' && match[2] === '0')) throw new Error(`not a floor of ^X.Y.Z or >=X.Y.Z alternatives: ${floor}`)
    const major = Number(match[2])
    keep(major, `${match[2]}.${match[3]}.${match[4]}`)
    if (match[1] === '>=') for (let next = major + 1; next <= last; next += 1) keep(next, `${String(next)}.0.0`)
  }
  return [...lowest.entries()].sort(([left], [right]) => left - right).map(([, version]) => version)
}

/** The lockfile's documents: pnpm writes its own tools in a document of their own, beside the workspace's. */
const documentsOf = (lockText) => parseAllDocuments(lockText).map((document) => document.toJS() ?? {})

/** The highest major any package's `engines.node` names, in any of the lockfile's documents. */
export function newestMajor(lockText) {
  const majors = documentsOf(lockText).flatMap((document) =>
    Object.values(document.packages ?? {}).flatMap((entry) => {
      const range = entry?.engines?.node
      return typeof range === 'string' ? [...range.matchAll(/(\d+)(?:\.(?:\d+|[xX*]))*/gu)].map((match) => Number(match[1])) : []
    }),
  )
  return Math.max(0, ...majors)
}

/** Each package `entries` holds whose `engines.node` refuses `version`, with the range it asks for. */
function refusals(version, entries) {
  return entries.flatMap(([name, entry]) => {
    const range = entry?.engines?.node
    return typeof range === 'string' && !satisfies(version, range) ? [{ name, range }] : []
  })
}

/** Each package the lockfile installs, in any of its documents, that refuses `version`. */
export function refusing(version, lockText) {
  return refusals(
    version,
    documentsOf(lockText).flatMap((document) => Object.entries(document.packages ?? {})),
  )
}

/** Each release the floor admits that a package the lockfile installs refuses, with the package and its range. */
export function floorRefusals(floor, lockText) {
  return admitted(floor, newestMajor(lockText) + 1).flatMap((version) => refusing(version, lockText).map((found) => ({ version, ...found })))
}

/**
 * Each stage of a Dockerfile with the oldest Node its image names:
 * `node:22.12-alpine` names 22.12.0, and a stage built FROM an earlier
 * one's name has that one's Node. A stage on any other image throws, so a
 * runtime the guard cannot read fails it rather than passing as another
 * stage's Node.
 */
export function stageNodes(dockerfile) {
  const stages = dockerfileStages(dockerfile)
  if (stages.length === 0) throw new Error('the Dockerfile has no FROM')
  const named = new Map()
  return stages.map(({ image, alias }) => {
    const tag = /^node:(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[\w.-]+)?(?:@sha256:[0-9a-f]{64})?$/u.exec(image)
    const node = named.get(image.toLowerCase()) ?? (tag === null ? null : [tag[1], tag[2] ?? '0', tag[3] ?? '0'].join('.'))
    if (node === null) throw new Error(`a stage is built FROM ${image}, which names no Node this guard can read`)
    if (alias !== null) named.set(alias.toLowerCase(), node)
    return { image, alias, node }
  })
}

/**
 * The lockfile's key for a dependency: `name@version`, or for an alias --
 * `string-width-cjs: string-width@4.2.3` -- the package it stands for,
 * told from a version by an `@` past its first character before any peers
 * a version carries, `3.0.1(ajv@8.20.0)`.
 */
const keyOf = (name, version) => (version.split('(')[0].lastIndexOf('@') > 0 ? version : `${name}@${version}`)

/**
 * The packages a production deploy of the project at `importer` installs,
 * as their lockfile keys: its dependencies and optional dependencies, those
 * of every workspace project it links, and theirs, never a devDependency.
 * An entry the lockfile does not hold throws.
 */
export function productionClosure(lockText, importer) {
  const lock = documentsOf(lockText).find((document) => document.importers?.[importer] !== undefined)
  if (lock === undefined) throw new Error(`the lockfile has no project ${importer}`)
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
    const key = keyOf(name, version)
    if (installed.has(key)) continue
    const snapshot = lock.snapshots?.[key]
    if (snapshot === undefined) throw new Error(`the lockfile has no snapshot of ${key}`)
    installed.add(key)
    for (const [child, childVersion] of Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies }))
      queue.push({ name: child, version: childVersion, from })
  }
  return { lock, installed }
}

/** Each package of the production deploy of `importer` that refuses `version`. */
export function deployRefusing(version, lockText, importer) {
  const { lock, installed } = productionClosure(lockText, importer)
  // A snapshot's key carries its peers, `name@1.0.0(peer@2.0.0)`; its
  // package entry, which holds `engines`, is keyed without them.
  const entries = [...installed].map((key) => {
    const bare = key.replace(/\(.*$/u, '')
    const entry = lock.packages?.[bare]
    if (entry === undefined) throw new Error(`the lockfile has no package entry for ${bare}`)
    return [bare, entry]
  })
  return refusals(version, entries)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('..', import.meta.url)
  const read = (path) => readFileSync(new URL(path, root), 'utf8')
  const lockText = read('pnpm-lock.yaml')
  const floor = JSON.parse(read('package.json')).engines.node
  const runtime = stageNodes(read('packages/data-server/Dockerfile')).at(-1).node
  const workspace = floorRefusals(floor, lockText)
  const deployed = deployRefusing(runtime, lockText, 'packages/data-server')
  for (const { version, name, range } of workspace) console.log(`the workspace admits Node ${version}: ${name} asks for ${range}`)
  for (const { name, range } of deployed) console.log(`the server image runs Node ${runtime}: ${name} asks for ${range}`)
  console.log(`${String(workspace.length + deployed.length)} refusals`)
  process.exitCode = workspace.length + deployed.length === 0 ? 0 : 1
}
