import type { ViteUserConfig } from 'vitest/config'
import { configDefaults } from 'vitest/config'

/**
 * vitest's own reporters, GitHub's annotations included, plus the JSON the
 * release report reads (0035).
 *
 * Spread from `configDefaults` rather than named: a `reporters` list replaces
 * vitest's, and naming `default` here would drop the `github-actions`
 * reporter vitest adds on CI, and with it every failure's annotation on the
 * pull request.
 *
 * The JSON keeps two keys of each test's `meta`, the engine and the shared
 * cases it declares with `covers()` (packages/data-fixtures/src/cases.ts):
 * the report's matrix of every shared case on both engines is built from
 * them. Written to `test-results/`, which turbo never caches, so a report
 * never reads an earlier run's results replayed as this one's.
 */
export const reporters: NonNullable<NonNullable<ViteUserConfig['test']>['reporters']> = [
  ...configDefaults.reporters,
  ['json', { outputFile: 'test-results/vitest.json', filterMeta: (key: string) => key === 'engine' || key === 'covers' }],
]
