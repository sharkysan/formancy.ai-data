import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * The size budget `CLAUDE.md` sets, as a gate: 600 lines for a source file,
 * tests excluded.
 *
 * formancy.ai's `apps/docs/src/size.test.ts`, brought with the first UI as
 * `CLAUDE.md` asks. Size is a signal rather than a verdict, so this is not a
 * rule against long files; it is a rule against a file quietly becoming *the
 * place things go*, which is how every file on upstream's ceiling list got
 * there. Nothing here is over the budget, so there is no such list: a file
 * that reaches it is split by the reason to change, not exempted.
 *
 * Counted the way `wc -l` counts, so the number in a failure is the number a
 * person checking it by hand gets.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Lines, for a file that is one subject read top to bottom. */
const BUDGET = 600

/** Where a person writes code: the packages, the apps, and the repository's own scripts. */
const ROOTS = ['packages', 'apps', 'scripts']

/** Installed, built or measured, never written. A dot-directory is a tool's. */
const SKIP = new Set(['node_modules', 'dist', 'coverage'])

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const NOT_SOURCE = /\.(test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/

/** Every source file a person maintains: no tests, no declarations, no build output. */
function sources() {
  const found = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (SKIP.has(entry) || entry.startsWith('.')) continue
      const full = join(directory, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!SOURCE.test(entry) || NOT_SOURCE.test(entry)) continue
      const text = readFileSync(full, 'utf8')
      const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      found.push({ path: relative(repo, full).replaceAll('\\', '/'), lines })
    }
  }
  for (const root of ROOTS) walk(join(repo, root))
  return found
}

describe('how big a source file may be', () => {
  // A guard on the guard: the assertion below is about absence, so a walk that
  // found nothing -- a root renamed, an extension pattern that matched no
  // `.tsx` -- would pass it forever. One file of each kind it must see.
  test('is reading the repository at all', () => {
    const paths = sources().map(({ path }) => path)
    expect(paths.length).toBeGreaterThan(50)
    expect(paths).toContain('packages/data-core/src/generate/generate.ts')
    expect(paths).toContain('apps/examples/src/app.tsx')
    expect(paths).toContain('scripts/check-cla.mjs')
    expect(paths.filter((path) => NOT_SOURCE.test(path))).toEqual([])
  })

  // The failure this prevents is slow: a file that took one more concern every
  // week, each change small enough to pass review, until it held five. Said as
  // the list of offenders, so a failure names the file and its size.
  test(`is at most ${String(BUDGET)} lines`, () => {
    const over = sources()
      .filter(({ lines }) => lines > BUDGET)
      .map(({ path, lines }) => `${path} (${String(lines)})`)
    expect(over, 'over the budget: split it by the reason to change').toEqual([])
  })
})
