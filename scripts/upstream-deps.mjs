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
// Run as `node scripts/upstream-deps.mjs`, and by `scripts/upstream-deps.test.mjs`
// against both fixtures and the real tree.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// `node scripts/upstream-deps.mjs`
if (process.argv[1]?.endsWith('upstream-deps.mjs')) {
  const problems = upstreamDependencyProblems(workspaceManifests())
  if (problems.length > 0) {
    console.error('Upstream dependency check failed:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log('upstream: every @formancy/* dependency outside this workspace is an exact released version')
}
