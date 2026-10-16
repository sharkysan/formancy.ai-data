import { describe, expect, test } from 'vitest'
import type { NormalizedType, NormalizedTypeKind } from '../metadata.js'
import { SEARCHABLE_KINDS, searchableDisplay } from './searchable.js'

/*
 * Which kinds a typed search matches, decided here apart from the code that
 * decides it. The generator draws a lookup as a typeahead exactly when
 * `searchableDisplay` finds a column, and `buildLookupConfig` searches what it
 * finds (0066), so the two can only agree on what this file holds: a rule
 * both share and get wrong is caught here and nowhere else.
 *
 * One row per kind of `NormalizedType`, so a kind added to the metadata fails
 * this file's type check until somebody says whether a search matches it.
 */
type Decided = { [K in NormalizedTypeKind]: { type: Extract<NormalizedType, { kind: K }>; searchable: boolean } }

const DECIDED: Decided = {
  text: { type: { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }, searchable: true },
  // Matched as its canonical text, never through an implicit conversion (0028).
  integer: { type: { kind: 'integer', min: '-2147483648', max: '2147483647' }, searchable: true },
  // Many spellings, none settled for both engines.
  boolean: { type: { kind: 'boolean' }, searchable: false },
  // A label's "12.50" is SQL Server's spelling and not PostgreSQL's of every numeric.
  decimal: { type: { kind: 'decimal', precision: 14, scale: 2 }, searchable: false },
  float: { type: { kind: 'float', bits: 64 }, searchable: false },
  // PostgreSQL spells a date as its session's DateStyle says.
  date: { type: { kind: 'date' }, searchable: false },
  time: { type: { kind: 'time', precision: 6 }, searchable: false },
  timestamp: { type: { kind: 'timestamp', withTimeZone: true, precision: 6 }, searchable: false },
  // Upper case on SQL Server, lower case on PostgreSQL.
  uuid: { type: { kind: 'uuid' }, searchable: false },
  binary: { type: { kind: 'binary', maxLength: null, fixedLength: false }, searchable: false },
  rowversion: { type: { kind: 'rowversion' }, searchable: false },
  unsupported: { type: { kind: 'unsupported' }, searchable: false },
}

const kinds = Object.keys(DECIDED) as NormalizedTypeKind[]

describe('searchableDisplay', () => {
  // A kind searched that the engines spell apart would match a row on one
  // engine and not the other, and a typeahead drawn over it would answer
  // differently per database; a kind left out would be drawn as a plain
  // list of one page though the server would search it. The set and the
  // function each answer for every kind, so a function that read the set
  // wrongly fails here as surely as a set that holds the wrong kinds.
  test('searches text and whole numbers, and no other kind', () => {
    expect(kinds.filter((kind) => SEARCHABLE_KINDS.has(kind))).toEqual(['text', 'integer'])
    for (const kind of kinds) {
      const { type, searchable } = DECIDED[kind]
      expect(SEARCHABLE_KINDS.has(kind), kind).toBe(searchable)
      expect(searchableDisplay([{ name: kind, type }]), kind).toEqual(searchable ? [{ name: kind, type }] : [])
    }
    // Nothing in the set that this table does not decide.
    expect([...SEARCHABLE_KINDS].every((kind) => DECIDED[kind].searchable)).toBe(true)
  })

  // A label may show a column twice. Searched twice, the search would be
  // refused by the config's own rule (`once`), and the generator's note would
  // say "searching name, name". The columns come in the order the label shows
  // them, each with its type: an integer that lost its type would be matched
  // through an implicit conversion (0028). A display with nothing searchable
  // gives nothing, which is what draws a plain select.
  test('gives each searchable column once, in the order the label shows it, with its type', () => {
    const name = DECIDED.text.type
    const number = DECIDED.integer.type
    const shown = [
      { name: 'name', type: name },
      { name: 'order_date', type: DECIDED.date.type },
      { name: 'customer_no', type: number },
      { name: 'name', type: name },
      { name: 'customer_no', type: number },
    ]
    expect(searchableDisplay(shown)).toEqual([
      { name: 'name', type: name },
      { name: 'customer_no', type: number },
    ])
    expect(searchableDisplay([{ name: 'order_date', type: DECIDED.date.type }, { name: 'amount', type: DECIDED.decimal.type }])).toEqual([])
  })
})
