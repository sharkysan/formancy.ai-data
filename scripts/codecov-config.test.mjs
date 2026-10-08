import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { codecovConfig, coveredPackages } from './codecov-config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('codecov.yml', () => {
  // A package added without a component is absent from the report, silently.
  // The committed file is compared to the generator's output rather than
  // parsed for a count, so a hand edit to any line is a failure too.
  test('is what the generator produces -- run "node scripts/codecov-config.mjs --write" otherwise', () => {
    const committed = readFileSync(join(root, 'codecov.yml'), 'utf8').replaceAll('\r\n', '\n')
    expect(committed).toBe(codecovConfig())
  })

  // Every package with a suite, by name. A generator that found
  // none would produce a valid file with no components, which is the silent
  // failure in a different costume.
  test('names every package that produces coverage', () => {
    const ids = coveredPackages().map((entry) => entry.id)
    expect(ids).toEqual(['data-core', 'data-fixtures', 'data-postgres', 'data-server', 'data-sqlserver'])
  })
})
