import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { coveredPackages } from './codecov-config.mjs'
import { readWorkflow, testMatrix } from './release-report/workflows.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The `test` job's matrix as `.github/workflows/gates.yml` lists it, which
 * ci.yml and release.yml both run (0035), read with `yaml` as the report reads
 * it: the list the report expects a results artefact per package from.
 */
const matrix = () => testMatrix(readWorkflow(root))

/** Every workspace package with a coverage suite, by its npm name. */
function packagesWithSuites() {
  return coveredPackages().map((entry) => JSON.parse(readFileSync(join(root, entry.path, 'package.json'), 'utf8')).name)
}

describe('the CI test jobs', () => {
  // Each package's suite runs in a job of its own, on its own runner. All nine
  // at once on one four-CPU runner, beside their databases, took a studio test
  // that runs in 2 s locally past its 60 s limit on main (run 37940021594). A
  // package left out of the matrix would then never be tested in CI at all,
  // and nothing would be red.
  test('run every package that has a suite, and nothing else', () => {
    expect([...matrix()].sort()).toEqual([...packagesWithSuites()].sort())
  })

  // Listed twice is two runners doing one job; harmless, but a sign the list
  // was edited by hand past the point of reading it.
  test('run each package once', () => {
    const names = matrix()
    expect(names.length).toBe(new Set(names).size)
  })

  // A guard on the guard: a walk that found no suites would compare an empty
  // matrix with an empty list and pass.
  test('is reading the workspace at all', () => {
    expect(packagesWithSuites().length).toBeGreaterThan(5)
  })
})
