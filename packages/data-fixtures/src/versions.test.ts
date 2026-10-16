import { existsSync, readFileSync } from 'node:fs'
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

/** A single-quoted string literal on one line, its contents captured. */
const LITERAL = String.raw`'((?:[^'\\\n]|\\.)*)'`

/**
 * Whether `title` is a test's or a describe's title in `source`: a literal
 * that opens a call's arguments, or such a literal with one `%s`, as
 * `describe.each` and `test.each` write a title, whose gap is another literal
 * of the file.
 */
function titled(source: string, title: string): boolean {
  const titles = [...source.matchAll(new RegExp(String.raw`\(\s*${LITERAL}`, 'g'))].map((match) => match[1] ?? '')
  if (titles.includes(title)) return true
  const literals = new Set([...source.matchAll(new RegExp(LITERAL, 'g'))].map((match) => match[1] ?? ''))
  return titles.some((template) => {
    const parts = template.split('%s')
    if (parts.length !== 2) return false
    const [before = '', after = ''] = parts
    return title.length >= before.length + after.length && title.startsWith(before) && title.endsWith(after) && literals.has(title.slice(before.length, title.length - after.length))
  })
}

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
  // A source or a measurement left empty is a value nobody can check, which
  // the type alone lets through.
  test('gives each fact a value, a source and a measurement for the major of every image of its engine’s matrix', () => {
    for (const [name, fact] of Object.entries(VERSION_FACTS)) {
      expect(fact.source.trim(), `${name}'s source`).not.toBe('')
      for (const major of MATRIX_IMAGES[fact.engine].map((image) => imageMajor(fact.engine, image))) {
        expect(typeof fact.values[major], `${name} on ${String(major)}`).toBe('boolean')
        expect(fact.measured[major]?.trim() ?? '', `${name} on ${String(major)}`).not.toBe('')
      }
    }
  })

  // A row whose test is gone, or renamed, is a sentence no leg holds: the
  // file is read, and the test's title must be one of its titles -- a
  // literal opening a call, as `test(` and `describe(` take it, or a `%s`
  // title of `.each` with one of the file's literals in its place. What it
  // cannot show is that the test asserts the fact; review holds that.
  test('names, for each fact, a test file that exists and a test that file has', () => {
    for (const [name, fact] of Object.entries(VERSION_FACTS)) {
      const file = `${REPO}${fact.heldBy.file}`
      expect(existsSync(file), `${name}: ${fact.heldBy.file}`).toBe(true)
      expect(titled(readFileSync(file, 'utf8'), fact.heldBy.test), `${name}: ${fact.heldBy.file} has no test "${fact.heldBy.test}"`).toBe(true)
    }
  })

  // The value is the major's, not the image's or the engine's: a lookup by
  // tag, or by the other engine's major, would hold a leg to another
  // version's value, and a 16 leg would assert 17's timeout.
  test('answers each value by the major the server answered', () => {
    expect(versionFact('transactionTimeout', record('postgres', '16.15'))).toBe(false)
    expect(versionFact('transactionTimeout', record('postgres', '17.11'))).toBe(true)
  })
})
