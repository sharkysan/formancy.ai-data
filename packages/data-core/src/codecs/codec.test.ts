import { describe, expect, test } from 'vitest'
import type { ColumnMeta, NormalizedType } from '../metadata.js'
import { controlFor } from '../generate/controls.js'
import { codecFor } from './codec.js'
import { decodeRowversion, encodeRowversion } from './rowversion.js'

function column(type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: 'c',
    ordinal: 1,
    databaseType: type.kind,
    type,
    nullable: false,
    hasDefault: false,
    defaultExpression: null,
    generated: 'none',
    comment: null,
    ...extra,
  }
}

const INT64: NormalizedType = { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' }
const AMOUNT: NormalizedType = { kind: 'decimal', precision: 18, scale: 4 }

const parse = (type: NormalizedType, value: unknown, extra: Partial<ColumnMeta> = {}) => codecFor(column(type, extra)).parse(value)
const accepted = (type: NormalizedType, value: unknown) => {
  const outcome = parse(type, value)
  return outcome.ok ? outcome.value : `refused:${outcome.code}`
}

describe('decimals', () => {
  // The fixture's largest numeric(18,4) (sales.order.amount). Through a double
  // it would come back as 100000000000000.
  test('the largest amount survives exactly, as a string', () => {
    expect(accepted(AMOUNT, '99999999999999.9999')).toBe('99999999999999.9999')
    expect(accepted({ kind: 'decimal', precision: 14, scale: 2 }, '999999999999.99')).toBe('999999999999.99')
  })

  // A JSON number has been through a double before this sees it, so its digits
  // are not necessarily the client's. Refused rather than trusted.
  test('a JSON number is refused, however innocent it looks', () => {
    expect(accepted(AMOUNT, 0.1)).toBe('refused:type')
    expect(accepted(AMOUNT, 0.1 + 0.2)).toBe('refused:type')
  })

  // Canonical is what the database returns on read, so a write followed by a
  // read is not a change. 12.5 in numeric(14,2) reads back 12.50.
  test('canonicalises to the column scale: padding, leading zeros, negative zero', () => {
    const money: NormalizedType = { kind: 'decimal', precision: 14, scale: 2 }
    expect(accepted(money, '12.5')).toBe('12.50')
    expect(accepted(money, '12')).toBe('12.00')
    expect(accepted(money, '007.10')).toBe('7.10')
    expect(accepted(money, '.5')).toBe('0.50')
    expect(accepted(money, '12.')).toBe('12.00')
    expect(accepted(money, '-0')).toBe('0.00')
    expect(accepted(money, '-0.00')).toBe('0.00')
    expect(accepted(money, '-0.01')).toBe('-0.01')
    expect(accepted({ kind: 'decimal', precision: null, scale: null }, '12.50')).toBe('12.50')
    expect(accepted({ kind: 'decimal', precision: 5, scale: 0 }, '00012')).toBe('12')
  })

  // Rounding is a business rule. Applying one silently is how a ledger stops balancing.
  test('never rounds: an extra fractional digit or whole digit is refused', () => {
    expect(accepted(AMOUNT, '1.23456')).toBe('refused:too-many-fraction-digits')
    expect(accepted(AMOUNT, '100000000000000')).toBe('refused:too-many-integer-digits')
    expect(accepted({ kind: 'decimal', precision: 2, scale: 2 }, '1.00')).toBe('refused:too-many-integer-digits')
    expect(accepted({ kind: 'decimal', precision: 2, scale: 2 }, '0.99')).toBe('0.99')
  })

  // Every JavaScript and locale trap a person or a client produces.
  test('refuses exponents, signs, spaces, separators and empty strings', () => {
    for (const text of ['1e3', '+5', ' 12', '12 ', '1,000.00', '1_000', '', '-', '.', '--1', '0x10', 'NaN', 'Infinity', '١٢']) {
      expect(accepted(AMOUNT, text), JSON.stringify(text)).toBe('refused:not-a-decimal')
    }
  })
})

describe('integers', () => {
  // 2^53 + 1, the fixture's sales.order.id. As a JSON number it has already
  // been rounded to 2^53 by the time anything can look at it.
  test('beyond 2^53, a string is exact and a number is refused', () => {
    expect(accepted(INT64, '9007199254740993')).toBe('9007199254740993')
    expect(accepted(INT64, 9007199254740993)).toBe('refused:not-an-integer')
    expect(accepted(INT64, '9223372036854775807')).toBe('9223372036854775807')
    expect(accepted(INT64, '9223372036854775808')).toBe('refused:out-of-range')
  })

  // A safe integer may travel as a number, and -0 is not a different integer.
  test('accepts safe integers as numbers, and normalises negative zero', () => {
    const int32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
    expect(accepted(int32, 42)).toBe('42')
    expect(accepted(int32, -0)).toBe('0')
    expect(accepted(int32, 2147483648)).toBe('refused:out-of-range')
    expect(accepted({ kind: 'integer', min: '0', max: '255' }, -1)).toBe('refused:out-of-range')
  })

  // A non-canonical spelling of an integer is a different string for the same
  // number, and accepting it makes two writes of one value look different.
  test('refuses fractions and non-canonical spellings', () => {
    for (const value of [1.5, '1.0', '+5', '007', '-0', ' 1', '1e3', true, null]) {
      expect(accepted(INT64, value), JSON.stringify(value)).toMatch(/^refused:/)
    }
  })
})

describe('text', () => {
  // formancy's maxLength counts JavaScript length, UTF-16 code units. Counting
  // the same unit means the browser and the server agree; it is also never
  // fewer than characters, so the value fits either engine's column.
  test('length is counted in UTF-16 code units, as the browser counts it', () => {
    const short: NormalizedType = { kind: 'text', maxLength: 2, fixedLength: false }
    expect(accepted(short, 'ab')).toBe('ab')
    expect(accepted(short, 'abc')).toBe('refused:too-long')
    // One emoji is two code units: it fits two and not one.
    expect(accepted(short, '😀')).toBe('😀')
    expect(accepted({ kind: 'text', maxLength: 1, fixedLength: false }, '😀')).toBe('refused:too-long')
  })

  // PostgreSQL cannot store NUL in text. Refused on both engines, so one value
  // means one thing on either.
  test('refuses NUL, and anything that is not a string', () => {
    const any: NormalizedType = { kind: 'text', maxLength: null, fixedLength: false }
    expect(accepted(any, 'a\u0000b')).toBe('refused:invalid-character')
    expect(accepted(any, 12)).toBe('refused:type')
    expect(accepted(any, '')).toBe('')
  })
})

describe('null and absence', () => {
  // Null is a value a nullable column can hold. An empty string is not null,
  // for any type, and absence is the caller's business, never a guess here.
  test('null only where nullable; empty string is not null; undefined is not a value', () => {
    expect(parse(AMOUNT, null, { nullable: true })).toEqual({ ok: true, value: null })
    expect(parse(AMOUNT, null)).toMatchObject({ ok: false, code: 'required' })
    expect(parse(AMOUNT, '', { nullable: true })).toMatchObject({ ok: false, code: 'not-a-decimal' })
    expect(parse(AMOUNT, undefined, { nullable: true })).toMatchObject({ ok: false, code: 'type' })
  })
})

describe('dates, times and instants', () => {
  // The shape is formancy's; whether the day exists is checked here, before a
  // database refuses it after the person has moved on.
  test('a date must be a real day', () => {
    expect(accepted({ kind: 'date' }, '2026-10-08')).toBe('2026-10-08')
    expect(accepted({ kind: 'date' }, '2024-02-29')).toBe('2024-02-29')
    for (const text of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '0000-01-01', '2026-1-8', '2026-10-08T00:00:00Z']) {
      expect(accepted({ kind: 'date' }, text), text).toBe('refused:not-a-date')
    }
    expect(accepted({ kind: 'date' }, '1900-02-29')).toBe('refused:not-a-date')
    expect(accepted({ kind: 'date' }, '2000-02-29')).toBe('2000-02-29')
  })

  // formancy's time is HH:MM on a 24-hour clock with no 24:00.
  test('a time is HH:MM', () => {
    expect(accepted({ kind: 'time', precision: 7 }, '23:59')).toBe('23:59')
    for (const text of ['24:00', '9:30', '09:30:00', '09:60']) expect(accepted({ kind: 'time', precision: 7 }, text), text).toBe('refused:not-a-time')
  })

  // An instant is UTC with seconds and Z, exactly formancy's datetime.
  test('an instant is YYYY-MM-DDTHH:MM:SSZ on a real day', () => {
    const zoned: NormalizedType = { kind: 'timestamp', withTimeZone: true, precision: 6 }
    expect(accepted(zoned, '2026-10-08T12:34:56Z')).toBe('2026-10-08T12:34:56Z')
    for (const text of ['2026-10-08T12:34Z', '2026-10-08T12:34:56+02:00', '2026-10-08T12:34:56.5Z', '2026-02-30T00:00:00Z']) {
      expect(accepted(zoned, text), text).toBe('refused:not-an-instant')
    }
  })
})

describe('everything else', () => {
  // One UUID has one spelling, so a comparison of stored values is a comparison of values.
  test('uuids are lower-cased, floats must be finite, booleans must be booleans', () => {
    expect(accepted({ kind: 'uuid' }, 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11')).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
    expect(accepted({ kind: 'uuid' }, 'not-a-uuid')).toBe('refused:not-a-uuid')
    expect(accepted({ kind: 'float', bits: 64 }, 0.5)).toBe(0.5)
    expect(accepted({ kind: 'float', bits: 64 }, '0.5')).toBe('refused:not-finite')
    expect(accepted({ kind: 'boolean' }, true)).toBe(true)
    expect(accepted({ kind: 'boolean' }, 'true')).toBe('refused:type')
  })

  // What the database writes is never written by a person, and a type with no
  // codec is never written at all. Each says why.
  test('generated, zoneless, rowversion, binary and unsupported columns are not editable, with a reason', () => {
    expect(codecFor(column(INT64, { generated: 'identity' }))).toMatchObject({ status: 'read-only', reason: expect.stringMatching(/identity/) })
    expect(codecFor(column({ kind: 'timestamp', withTimeZone: false, precision: 7 }))).toMatchObject({ status: 'read-only', reason: expect.stringMatching(/guess a zone/) })
    expect(codecFor(column({ kind: 'rowversion' }))).toMatchObject({ status: 'read-only' })
    expect(codecFor(column({ kind: 'binary', maxLength: null }))).toMatchObject({ status: 'unsupported' })
    const shape = codecFor(column({ kind: 'unsupported' }, { databaseType: 'geography' }))
    expect(shape).toMatchObject({ status: 'unsupported', reason: 'geography has no tested codec' })
    expect(shape.parse('POINT(0 0)')).toMatchObject({ ok: false, code: 'unsupported' })
  })
})

describe('agreement with the generated form', () => {
  // The browser checks the generated pattern and the server checks the codec.
  // If the codec refused something the pattern accepted, a person would pass
  // the form and fail the save. Every value the pattern accepts must pass here.
  test('every decimal the generated pattern accepts, the codec accepts', () => {
    for (const [precision, scale] of [[18, 4], [14, 2], [5, 0], [2, 2]] as const) {
      const type: NormalizedType = { kind: 'decimal', precision, scale }
      const plan = controlFor(type, false)
      if (!('field' in plan) || plan.field.pattern === undefined) throw new Error('a decimal must have a pattern')
      const pattern = new RegExp(plan.field.pattern)
      const candidates = ['0', '1', '-1', '12', '007', '-0', '12.5', '0.99', '.5', '-.5', '0.5', '99999', '99999999999999.9999', '999999999999.99', '1.2', '12.34']
      for (const text of candidates.filter((candidate) => pattern.test(candidate))) {
        expect(accepted(type, text), `${text} in numeric(${String(precision)},${String(scale)})`).not.toMatch(/^refused:/)
      }
    }
  })
})

describe('rowversion tokens', () => {
  // One value, one spelling: a token compared as a string must say "changed"
  // only when the row changed.
  test('eight bytes round-trip through sixteen lower-case hex characters, and nothing else decodes', () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 0, 0, 0x07, 0xd1])
    const token = encodeRowversion(bytes)
    expect(token).toBe('00000000000007d1')
    expect(decodeRowversion(token)).toEqual(bytes)
    for (const text of ['00000000000007D1', '0x00000000000007d1', '7d1', '00000000000007d1 ', 'AAAAAAAAB9E=']) {
      expect(decodeRowversion(text), text).toBeUndefined()
    }
    expect(() => encodeRowversion(new Uint8Array(4))).toThrow(/8 bytes/)
  })
})
