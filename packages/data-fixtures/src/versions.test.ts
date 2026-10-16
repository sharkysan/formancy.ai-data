import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { imageMajor, MATRIX_IMAGES } from './images.js'
import type { ServerRecord } from './servers.js'
import { serverMajor, VERSION_FACTS, versionFact } from './versions.js'

/**
 * What the versions of one engine disagree on (0067), each named, as 0026
 * names what the engines disagree on and 0058 what the browsers do: pure,
 * over the table and records this file writes. That each value holds on its
 * version is the test each row names, run on every leg of the matrix.
 */
const REPO = fileURLToPath(new URL('../../../', import.meta.url))

const record = (engine: ServerRecord['engine'], version: string): ServerRecord => ({
  engine,
  version,
  image: 'an image',
  compatibility: null,
  updateLevel: null,
  edition: null,
  description: null,
  caller: null,
  script: 'test',
  at: '2026-10-16T12:00:00.000Z',
})

describe('a server’s major', () => {
  // The value a fact is looked up by is what the server answered, never its
  // image's tag: a tag that moved to another major would otherwise hold the
  // server to the old one's facts.
  test('is read from what the server answered, on either engine', () => {
    expect(serverMajor(record('postgres', '16.15'))).toBe(16)
    expect(serverMajor(record('postgres', '18.6'))).toBe(18)
    // Debian's packages answer with their build after the version.
    expect(serverMajor(record('postgres', '16.4 (Debian 16.4-1.pgdg120+1)'))).toBe(16)
    expect(serverMajor(record('sqlserver', '15.0.4430.1'))).toBe(15)
  })

  // A version string that names no major would otherwise read as NaN, which
  // no fact has a value for, and fail somewhere far from the cause.
  test('is refused when the answer names none', () => {
    expect(() => serverMajor(record('postgres', 'devel'))).toThrow('the postgres server answered devel, which names no major version')
  })
})

describe('VERSION_FACTS', () => {
  // A leg on a major the row has no value for asserts nothing about it, and
  // the leg must not pass quietly: the lookup refuses, naming the row, so the
  // value is measured and written before the leg can be green.
  test('refuses a major a fact has no value for, and a server of another engine', () => {
    expect(() => versionFact('transactionTimeout', record('postgres', '14.19'))).toThrow(
      "VERSION_FACTS.transactionTimeout has no value for postgres 14: measure it on that version and add it, or leave the version out of the matrix",
    )
    expect(() => versionFact('transactionTimeout', record('sqlserver', '16.0.4295.3'))).toThrow('VERSION_FACTS.transactionTimeout is a postgres fact, and this server is sqlserver')
  })

  // A row without a value for an image of the matrix is a leg that fails on
  // the lookup above; held here too, so the matrix and the table move
  // together without a run. SQL Server's tags name a year, which
  // SQLSERVER_RELEASES turns into the major its server answers (imageMajor).
  test('gives each fact a value, a source and a measurement for the major of every image of its engine’s matrix', () => {
    for (const [name, fact] of Object.entries(VERSION_FACTS)) {
      for (const major of MATRIX_IMAGES[fact.engine].map((image) => imageMajor(fact.engine, image))) {
        expect(typeof fact.values[major], `${name} on ${String(major)}`).toBe('boolean')
        expect(fact.measured[major], `${name} on ${String(major)}`).toEqual(expect.any(String))
      }
    }
  })

  // A row whose test is gone, or renamed, is a sentence no leg holds.
  test('names, for each fact, a test file that exists', () => {
    for (const [name, fact] of Object.entries(VERSION_FACTS)) expect(existsSync(`${REPO}${fact.heldBy.file}`), `${name}: ${fact.heldBy.file}`).toBe(true)
  })

  test('answers each value by the major the server answered', () => {
    expect(versionFact('transactionTimeout', record('postgres', '16.15'))).toBe(false)
    expect(versionFact('transactionTimeout', record('postgres', '17.11'))).toBe(true)
  })
})
