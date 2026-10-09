import type { ViteUserConfig } from 'vitest/config'

/**
 * One coverage policy for every package, and the reasons for its exclusions.
 *
 * Written once because it is an argument, not a setting: a coverage number is
 * only worth reading if what it counts is defensible, and three copies of a list
 * drift until nobody can say what the number means. Taken from formancy.ai,
 * whose reasoning this repository shares.
 *
 * What is excluded, and why:
 *
 * - **Barrels** (`index.ts` that only re-exports). They have no behaviour, and
 *   nothing in a package imports its own barrel, so v8 reports every line as
 *   uncovered and the number goes down for a file that cannot be wrong.
 * - **Composition roots** (`main.ts`). Reading environment variables, opening a
 *   connection and wiring adapters together. A unit test of one asserts the
 *   wiring it just wrote; they are covered where it counts, by the thing
 *   actually starting.
 * - **Declaration files**, which have no source to cover.
 *
 * Everything else counts, including the parts that are awkward to reach. When a
 * file is hard to cover that is usually the file saying something about its own
 * design.
 */
export const coverage: NonNullable<NonNullable<ViteUserConfig['test']>['coverage']> = {
  provider: 'v8',
  // `json-summary` writes coverage/coverage-summary.json, whose totals the
  // release report shows per package -- reported there as here, never gated (0035).
  reporter: ['text', ['lcov', { projectRoot: '../..' }], 'json-summary'],
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/index.ts', 'src/main.ts'],
}
