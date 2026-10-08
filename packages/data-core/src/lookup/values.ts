import { TEMPORAL_SHAPES } from '@formancy/spec'
import type { NormalizedType } from '../metadata.js'
import type { LookupKeyType } from './types.js'

/**
 * What one value of a lookup's key looks like, as an adapter reads it back:
 * the only spelling that can be a member, because `rejectedTokens` compares a
 * token with the re-encoded row exactly.
 *
 * A token is checked against this before anything is bound, because a value
 * of any other spelling is read differently by the two engines — `1e3` is a
 * numeric to PostgreSQL and a conversion error to SQL Server, and PostgreSQL
 * refuses a NUL in text that SQL Server binds — and an error would fail the
 * whole query where one token is the problem.
 */

const KEY_KINDS: ReadonlySet<NormalizedType['kind']> = new Set<LookupKeyType['kind']>(['text', 'integer', 'decimal', 'uuid', 'date'])

/** Whether a column of this type can be a lookup's key. */
export function isLookupKeyType(type: NormalizedType): type is LookupKeyType {
  return KEY_KINDS.has(type.kind)
}

/** No leading zero, no plus, no exponent, no whitespace. `-0` is refused separately. */
const INTEGER = /^-?(?:0|[1-9][0-9]*)$/
/** As INTEGER, with an optional fraction of at least one digit. */
const DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/
/** Lower case, hyphenated: how a UUID is spelled once it has been through a codec, on either engine. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** formancy's own date shape, read from `@formancy/spec` rather than restated (formancy.ai 0067). */
const DATE = new RegExp(TEMPORAL_SHAPES.date)
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isInteger(value: string, min: string, max: string): boolean {
  if (!INTEGER.test(value) || value === '-0') return false
  const number = BigInt(value)
  return number >= BigInt(min) && number <= BigInt(max)
}

/**
 * A decimal as both engines return it: the fraction padded to the column's
 * scale, as many whole digits as its precision leaves, and no negative zero.
 * An unconstrained numeric — PostgreSQL only — keeps the scale it was given,
 * so any fraction is a spelling a row can hold.
 */
function isDecimal(value: string, precision: number | null, scale: number | null): boolean {
  const match = DECIMAL.exec(value)
  if (match === null) return false
  const [, sign = '', whole = '', fraction = ''] = match
  if (scale !== null && fraction.length !== scale) return false
  if (sign === '-' && whole === '0' && /^0*$/.test(fraction)) return false
  if (precision === null) return true
  return (whole === '0' ? 0 : whole.length) <= precision - (scale ?? 0)
}

/** `YYYY-MM-DD`, naming a day that exists between 0001-01-01 and 9999-12-31, the range both engines store. */
function isDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  // Month 00 and month 13 both fall outside the table.
  const length = DAYS_IN_MONTH[month - 1]
  if (year < 1 || length === undefined || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return day <= (month === 2 && leap ? 29 : length)
}

/**
 * Whether a decoded token value is one a key column of this type can hold,
 * spelled as an adapter reads it back. Text is taken as it is, up to the
 * column's length in UTF-16 units and without a NUL.
 */
export function isKeyValue(type: LookupKeyType, value: string): boolean {
  switch (type.kind) {
    case 'text':
      return !value.includes('\u0000') && (type.maxLength === null || value.length <= type.maxLength)
    case 'integer':
      return isInteger(value, type.min, type.max)
    case 'decimal':
      return isDecimal(value, type.precision, type.scale)
    case 'uuid':
      return UUID.test(value)
    case 'date':
      return isDate(value)
  }
}
