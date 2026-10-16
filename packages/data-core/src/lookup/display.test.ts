import { describe, expect, test } from 'vitest'
import type { ApiValue } from '../codecs/codec.js'
import type { NormalizedType, NormalizedTypeKind } from '../metadata.js'
import { displayText, isDisplayType, NO_TEXT_KINDS } from './display.js'
import type { LookupDisplayType } from './types.js'

const TEXT: LookupDisplayType = { kind: 'text', maxLength: 5, lengthUnit: 'code-points', fixedLength: true }
const INSTANT: LookupDisplayType = { kind: 'timestamp', withTimeZone: true, precision: 3 }
const WALL_CLOCK: LookupDisplayType = { kind: 'timestamp', withTimeZone: false, precision: 3 }

/*
 * A label is spelled here once for both engines, from the canonical value the
 * adapter's record reader returns (0028). Before, each adapter spelled its
 * own: PostgreSQL's `to_jsonb` in the session's TimeZone and float digits,
 * SQL Server's style 126 with bit `1`, an upper-case uuid and scientific
 * floats (C6, C6-pg). One case per kind.
 */
describe('displayText', () => {
  // Exact kinds are already one spelling on both engines: shown as read.
  test('shows text, integers, decimals, uuids and dates as their canonical text', () => {
    expect(displayText(TEXT, 'AB')).toBe('AB')
    expect(displayText({ kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }, '9007199254740993')).toBe('9007199254740993')
    expect(displayText({ kind: 'decimal', precision: 14, scale: 2 }, '12.50')).toBe('12.50')
    expect(displayText({ kind: 'uuid' }, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
    expect(displayText({ kind: 'date' }, '2026-10-08')).toBe('2026-10-08')
  })

  // SQL Server's style 126 printed a bit as `1`; a person reads `true`.
  test('shows a boolean as true or false', () => {
    expect(displayText({ kind: 'boolean' }, true)).toBe('true')
    expect(displayText({ kind: 'boolean' }, false)).toBe('false')
  })

  // A real is shown as the float it is, whichever layer already made it
  // canonical: 0.1, never the double 0.10000000149011612 or style 3's
  // `1.0000000e-001`. NaN and the infinities, which PostgreSQL can hold and
  // JSON cannot, arrive as text and are shown as such.
  test('shows a float as its shortest decimal, a real through canonicalFloat32, and NaN as text', () => {
    expect(displayText({ kind: 'float', bits: 64 }, 0.1)).toBe('0.1')
    expect(displayText({ kind: 'float', bits: 32 }, 0.10000000149011612)).toBe('0.1')
    expect(displayText({ kind: 'float', bits: 32 }, 0.1)).toBe('0.1')
    for (const special of ['NaN', 'Infinity', '-Infinity']) expect(displayText({ kind: 'float', bits: 64 }, special)).toBe(special)
  })

  // Cut, never rounded: 10:34:59.999 rounded is 10:35, a minute the row does
  // not hold. PostgreSQL's reader returns the seconds when there are any.
  test('shows a time to the minute, cut', () => {
    expect(displayText({ kind: 'time', precision: 3 }, '10:34:59.999')).toBe('10:34')
    expect(displayText({ kind: 'time', precision: 0 }, '10:34')).toBe('10:34')
  })

  // To the second, cut: .9995 rounded would move a label into the next second.
  // An instant outside the shape — an era, `infinity` — is shown as read.
  test('shows a timestamp to the second, cut, and passes through what has no such shape', () => {
    expect(displayText(INSTANT, '2026-10-08T08:34:59.9995Z')).toBe('2026-10-08T08:34:59Z')
    expect(displayText(INSTANT, '2026-10-08T08:34:56Z')).toBe('2026-10-08T08:34:56Z')
    expect(displayText(WALL_CLOCK, '2026-10-08T10:34:56.789')).toBe('2026-10-08T10:34:56')
    expect(displayText(WALL_CLOCK, '2026-10-08T10:34:56')).toBe('2026-10-08T10:34:56')
    for (const value of ['0044-03-15T00:00:00.000000Z BC', 'infinity', '-infinity']) expect(displayText(INSTANT, value)).toBe(value)
    expect(displayText(WALL_CLOCK, '0044-03-15T00:00:00.000000 BC')).toBe('0044-03-15T00:00:00.000000 BC')
  })

  // SQL NULL is no label text; formatLabel decides what a row of them shows.
  test('shows NULL as null', () => {
    expect(displayText(TEXT, null)).toBeNull()
    expect(displayText({ kind: 'boolean' }, null)).toBeNull()
  })

  // A value of the wrong JavaScript type is an adapter that decoded with
  // another column's type; showing it would put a guess in front of a person.
  test('refuses a value of the wrong JavaScript type for its kind', () => {
    expect(() => displayText({ kind: 'boolean' }, 'true')).toThrow(/boolean/)
    expect(() => displayText(TEXT, 1)).toThrow(/text/)
    expect(() => displayText({ kind: 'float', bits: 64 }, '0.1')).toThrow(/float/)
    expect(() => displayText({ kind: 'float', bits: 64 }, true)).toThrow(/float/)
    expect(() => displayText(INSTANT, 0)).toThrow(/timestamp/)
  })
})

/*
 * Which kinds a label can show, decided here apart from the code that
 * decides it, one row per kind of `NormalizedType`: a kind added to the
 * metadata fails this file's type check until somebody says whether a label
 * can show it. A kind a label can show comes with a value `displayText`
 * spells, so a kind let through that nothing spells fails too.
 */
type Shown = { [K in NormalizedTypeKind]: { type: Extract<NormalizedType, { kind: K }>; value: ApiValue | undefined } }

const SHOWN: Shown = {
  text: { type: { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }, value: 'Muster AG' },
  integer: { type: { kind: 'integer', min: '-2147483648', max: '2147483647' }, value: '1001' },
  boolean: { type: { kind: 'boolean' }, value: true },
  decimal: { type: { kind: 'decimal', precision: 14, scale: 2 }, value: '12.50' },
  float: { type: { kind: 'float', bits: 64 }, value: 0.5 },
  date: { type: { kind: 'date' }, value: '2026-10-08' },
  time: { type: { kind: 'time', precision: 0 }, value: '10:34' },
  timestamp: { type: { kind: 'timestamp', withTimeZone: true, precision: 6 }, value: '2026-10-08T08:34:56Z' },
  uuid: { type: { kind: 'uuid' }, value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
  // No canonical text: bytes, a counter the database writes, a type with no codec.
  binary: { type: { kind: 'binary', maxLength: null, fixedLength: false }, value: undefined },
  rowversion: { type: { kind: 'rowversion' }, value: undefined },
  unsupported: { type: { kind: 'unsupported' }, value: undefined },
}

describe('isDisplayType', () => {
  // The generator, `buildLookupConfig` and the studio's display choice all
  // ask this (0066). A kind let through that has no text is a lookup the
  // generator writes and the config refuses: a form published over a list
  // that never comes. A kind kept out that a label can spell is a column
  // nobody may show though the server would. The set and the function each
  // answer for every kind (watched failing with `unsupported` left out of
  // the set).
  test('lets a label show every kind with a canonical text, and no bytes, rowversion or type without a codec', () => {
    const kinds = Object.keys(SHOWN) as NormalizedTypeKind[]
    expect(kinds.filter((kind) => !isDisplayType(SHOWN[kind].type))).toEqual(['binary', 'rowversion', 'unsupported'])
    expect(kinds.filter((kind) => NO_TEXT_KINDS.has(kind))).toEqual(['binary', 'rowversion', 'unsupported'])
    for (const kind of kinds) {
      const { type, value } = SHOWN[kind]
      expect(isDisplayType(type), kind).toBe(value !== undefined)
      if (isDisplayType(type) && value !== undefined) expect(typeof displayText(type, value), kind).toBe('string')
    }
  })
})
