// Upstream is depended on, never copied, and at an exact version.
//
// 0002: this repository builds on the released @formancy/* packages and carries
// none of their code. Two things would quietly break that. A `workspace:`,
// `link:`, `file:` or git specifier would resolve an upstream package from a
// checkout rather than from the registry, so the build would depend on what
// happened to be on one machine. A range (`^0.3.0`) would let the lockfile
// move upstream under this repository without a commit saying so -- and the
// package APIs upstream are not frozen before 1.0, so a minor is allowed to
// break this one. An exact version is a decision somebody made, in a diff
// somebody can read.
//
// 0055: a release is adopted the day it is published by exempting each of its
// exact versions from pnpm's minimum release age, and nothing else is exempt.
// An exemption for a package outside upstream, for a name or a pattern rather
// than a version, or for a version the lockfile no longer installs is refused.
//
// Run as `node scripts/upstream-deps.mjs`, and by `scripts/upstream-deps.test.mjs`
// against both fixtures and the real tree.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The scope upstream publishes under -- and the one this repository publishes under too. */
export const UPSTREAM_SCOPE = '@formancy/'

/** A released version and nothing else: no range, no protocol, no tag. */
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** Every workspace manifest, read from disk. */
export function workspaceManifests(repoRoot = root) {
  const found = []
  for (const group of ['packages', 'apps']) {
    if (!existsSync(join(repoRoot, group))) continue
    for (const name of readdirSync(join(repoRoot, group)).sort()) {
      try {
        found.push(JSON.parse(readFileSync(join(repoRoot, group, name, 'package.json'), 'utf8')))
      } catch {
        // A directory without a manifest is not a package.
      }
    }
  }
  return found
}

/**
 * What is wrong with how these manifests depend on upstream, each named once.
 *
 * A package in the same scope that is also in this workspace is a sibling, not
 * upstream, and `workspace:*` is exactly right for it. Everything else in the
 * scope comes from the registry at a version written down.
 *
 * Pure over the manifests, so the tests can hand it ones this repository does
 * not have.
 */
export function upstreamDependencyProblems(manifests) {
  const local = new Set(manifests.map((manifest) => manifest.name))
  const problems = []
  for (const manifest of manifests) {
    for (const field of FIELDS) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        if (!name.startsWith(UPSTREAM_SCOPE) || local.has(name)) continue
        if (!EXACT.test(String(spec))) {
          problems.push(`${manifest.name}: ${field} ${name}@${String(spec)} is not an exact released version`)
        }
      }
    }
  }
  return problems
}

/** What `pnpm-workspace.yaml` exempts from pnpm's minimum release age, as written. */
export function releaseAgeExemptions(repoRoot = root) {
  const workspace = YAML.parse(readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')) ?? {}
  return (workspace.minimumReleaseAgeExclude ?? []).map(String)
}

/**
 * Every `name@version` the lockfile installs from a registry. pnpm writes the
 * lockfile as two documents, pnpm's own installation first and the
 * workspace's second, and both are read.
 */
export function lockedPackages(repoRoot = root) {
  const documents = YAML.parseAllDocuments(readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8'))
  return new Set(documents.flatMap((document) => Object.keys(document.toJS()?.packages ?? {})))
}

/**
 * What is wrong with the exemptions from pnpm's minimum release age, each
 * named once (0055).
 *
 * An exemption is an upstream package at the exact version the lockfile
 * installs: pnpm writes one for each package of a release adopted on the day
 * it is published, transitive ones included. Anything else admits a package
 * nobody here chose on its first day, or outlives the version it was for.
 *
 * Pure over what it is handed, so the tests can hand it exemptions this
 * repository does not have.
 */
export function releaseAgeExemptionProblems(exempt, locked, siblings) {
  const problems = []
  for (const entry of exempt) {
    const at = entry.lastIndexOf('@')
    const name = at > 0 ? entry.slice(0, at) : entry
    const version = at > 0 ? entry.slice(at + 1) : ''
    if (!name.startsWith(UPSTREAM_SCOPE) || siblings.has(name) || !EXACT.test(version)) {
      problems.push(`minimumReleaseAgeExclude ${entry} is not an upstream package at an exact version`)
    } else if (!locked.has(entry)) {
      problems.push(`minimumReleaseAgeExclude ${entry} is not a version the lockfile installs; remove it`)
    }
  }
  return problems
}

// `node scripts/upstream-deps.mjs`
if (process.argv[1]?.endsWith('upstream-deps.mjs')) {
  const manifests = workspaceManifests()
  const siblings = new Set(manifests.map((manifest) => manifest.name))
  const problems = [...upstreamDependencyProblems(manifests), ...releaseAgeExemptionProblems(releaseAgeExemptions(), lockedPackages(), siblings)]
  if (problems.length > 0) {
    console.error('Upstream dependency check failed:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log('upstream: every @formancy/* dependency outside this workspace is an exact released version')
  console.log('upstream: only upstream versions the lockfile installs are exempt from the minimum release age')
}
