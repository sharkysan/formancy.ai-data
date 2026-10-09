// Which version of a package Node loads from a directory (0035).
//
// Node's own lookup for a bare specifier: from `fromDir` up, the first
// `node_modules/<name>/package.json`. It reads that manifest's `version` and
// answers the real directory, so a lookup from there continues where Node
// would -- tedious from mssql's directory, say, which under pnpm is not the
// package's that declared mssql.
//
// Deliberately not `require.resolve`: a package's `exports` may not export
// its package.json (playwright-core's does not), and resolving an entry
// point says nothing a version needs. Not the lockfile either, which is an
// internal format that changes with pnpm's majors. This is what the suites
// imported, by the rule they imported it with.

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** `{ version, dir }` of `name` as Node finds it from `fromDir`, or undefined when nothing is installed. */
export function installed(fromDir, name) {
  let dir = resolve(fromDir)
  for (;;) {
    const manifest = join(dir, 'node_modules', ...name.split('/'), 'package.json')
    if (existsSync(manifest)) {
      const { version } = JSON.parse(readFileSync(manifest, 'utf8'))
      return { version, dir: realpathSync(dirname(manifest)) }
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** As `installed`, and throws a sentence naming the package when nothing is there. */
export function mustBeInstalled(fromDir, name) {
  const found = installed(fromDir, name)
  if (found === undefined) throw new Error(`${name} is not installed where ${fromDir} would load it from: run pnpm install`)
  return found
}
