import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, test } from 'vitest'
import { coveredPackages } from './codecov-config.mjs'
import { imageMatrix, readWorkflow, testMatrix } from './release-report/workflows.mjs'

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

/**
 * data-fixtures as built: the images and the variable the suites read
 * (0067). Run after `pnpm build`, as `pnpm test:repo` is. Imported once,
 * with a minute for it: the module loads testcontainers and both drivers.
 */
let fixtures
beforeAll(async () => {
  fixtures = await import(pathToFileURL(join(root, 'packages', 'data-fixtures', 'dist', 'index.mjs')).href)
}, 60_000)

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

describe('the image legs', () => {
  // The `test` job runs every suite on the default images; `test-images`
  // runs data-fixtures and the engine's adapter suite once on each other
  // image of MATRIX_IMAGES (0067). An image of the matrix with no leg is a
  // version the release names and nothing runs, with nothing red; a leg on
  // an image the matrix does not list is a run the report holds to nothing.
  test('run data-fixtures and each engine’s adapter on every image of the matrix but the default, and nothing else', () => {
    const { DEFAULT_IMAGES, MATRIX_IMAGES } = fixtures
    const needed = Object.entries(MATRIX_IMAGES).flatMap(([engine, images]) =>
      images.filter((image) => image !== DEFAULT_IMAGES[engine]).flatMap((image) => ['@formancy/data-fixtures', `@formancy/data-${engine}`].map((name) => `${name} on ${image}`)),
    )
    const legs = imageMatrix(readWorkflow(root)).map((leg) => `${leg.package} on ${leg.image}`)
    expect([...legs].sort()).toEqual([...needed].sort())
    expect(new Set(legs).size).toBe(legs.length)
    // The guard on the guard: a matrix of defaults alone needs no leg, and
    // both lists empty would pass.
    expect(needed.length).toBeGreaterThan(0)
    for (const name of new Set(imageMatrix(readWorkflow(root)).map((leg) => leg.package))) expect(packagesWithSuites(), name).toContain(name)
  })

  // turbo runs `test` and `test:coverage` in strict mode, where a variable it
  // is not told of never reaches the task: every leg would run the defaults
  // under its image's name. Under `passThroughEnv` alone it would reach the
  // task unhashed, and a cached run on 17 would be replayed for 16.
  test('reach the suites through turbo, which hashes FORMANCY_IMAGES for test and test:coverage', () => {
    const { IMAGES_VARIABLE } = fixtures
    const turbo = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8'))
    for (const task of ['test', 'test:coverage']) expect(turbo.tasks[task].env ?? [], task).toContain(IMAGES_VARIABLE)
  })
})
