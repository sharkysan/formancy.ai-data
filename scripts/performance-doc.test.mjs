import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { renderPerformance, replaceGenerated } from '../packages/data-performance/src/render.ts'
import { validateResults } from '../packages/data-performance/src/validate.ts'

/**
 * docs/performance.md against docs/performance/results.json (0034): the
 * page's figures are rendered from the measurement and from nothing else,
 * and what was measured may be published. Prose does not break when a
 * number in it goes stale; this does.
 *
 * Against the catalogue and protocol the result carries, never today's
 * `catalogue.ts`: a pull request that changes a pin is not red here for
 * want of a re-measurement. The release's stale check is what refuses a
 * product the figures no longer describe.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const RESULTS = join(root, 'docs', 'performance', 'results.json')
const PAGE = join(root, 'docs', 'performance.md')

function results() {
  if (!existsSync(RESULTS)) throw new Error('docs/performance/results.json does not exist: no figures have been measured. Run "pnpm performance" on a quiet Linux machine (RELEASING.md).')
  return JSON.parse(readFileSync(RESULTS, 'utf8'))
}

describe('the published performance figures', () => {
  // A figure edited by hand, or a page left behind after a new measurement,
  // would publish a number nobody measured.
  test('are what results.json renders -- run "pnpm --filter @formancy/data-performance render" otherwise', () => {
    const page = readFileSync(PAGE, 'utf8')
    expect(page).toBe(replaceGenerated(page, renderPerformance(results())))
  })

  // A smoke result, five samples on a machine nobody quieted, or a result
  // whose counted round trips are not its own catalogue's pins, is not a
  // measurement anybody may read figures from.
  test('validate as published, against the catalogue they were measured with', () => {
    expect(validateResults(results(), { published: true })).toEqual({ ok: true })
  })
})
