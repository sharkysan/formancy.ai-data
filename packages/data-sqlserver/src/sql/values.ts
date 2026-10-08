import type { ApiValue, NormalizedType } from '@formancy/data-core'
import mssql from 'mssql'
import type { Parameters } from './statement.js'

/**
 * How a value crosses between SQL Server and the API, in both directions, for
 * every kind the contract names. One module for the lookup half and the record
 * half, because two spellings of one decimal inside one adapter is the
 * divergence the core exists to prevent.
 *
 * Out of the database, every value is converted to text BY THE SERVER, into
 * exactly what `codecFor(column).parse` returns, and the driver only ever
 * carries a string. `tedious` returns `decimal(18,4)` as a lossy JavaScript
 * number and `date` as midnight UTC (0007); a string it cannot misread.
 *
 * Into the database, every value except a boolean and a float travels as
 * nvarchar text and is converted by the server to the column's type. Not
 * through the driver's typed parameters: `tedious` binds a `Decimal` parameter
 * through a JavaScript number, so `1234567890123.4567` is stored as
 * `1234567890123.4568` (the records suite holds it), and the largest
 * `decimal(18,4)` is refused outright (8023, measured once on 2026-10-09).
 */

/** nvarchar(n) holds at most 4000 UTF-16 units; anything wider is nvarchar(max). */
const NVARCHAR_LIMIT = 4000

/** SQL Server's integer types, narrowest first, by the range the snapshot gives each. */
const INTEGER_TYPES: ReadonlyArray<readonly [name: string, min: bigint, max: bigint]> = [
  ['tinyint', 0n, 255n],
  ['smallint', -32768n, 32767n],
  ['int', -2147483648n, 2147483647n],
  ['bigint', -9223372036854775808n, 9223372036854775807n],
]

type Kind<K extends NormalizedType['kind']> = Extract<NormalizedType, { kind: K }>

function nvarchar(maxLength: number | null): string {
  return maxLength === null || maxLength > NVARCHAR_LIMIT ? 'nvarchar(max)' : `nvarchar(${String(maxLength)})`
}

/** The integer type a column of this range is: a key compared with its own type is a seek, not a conversion of every row. */
function integerType(type: Kind<'integer'>): string {
  const min = BigInt(type.min)
  const max = BigInt(type.max)
  const found = INTEGER_TYPES.find(([, low, high]) => low <= min && max <= high)
  if (found === undefined) throw new Error(`No SQL Server integer type holds ${type.min} to ${type.max}`)
  return found[0]
}

function decimalType(type: Kind<'decimal'>): string {
  // An unconstrained numeric is PostgreSQL's; every SQL Server decimal has both.
  if (type.precision === null || type.scale === null) throw new Error('A SQL Server decimal has a precision and a scale')
  return `decimal(${String(type.precision)}, ${String(type.scale)})`
}

function noValue(type: NormalizedType): Error {
  return new Error(`A ${type.kind} column has no canonical API value, so it can be neither read nor written as one`)
}

/**
 * SQL that reads `expression` as the text of its canonical API value.
 *
 * - text: itself, as nvarchar, so a `varchar` is decoded by the server's code
 *   page and not by the driver's.
 * - integer: the decimal string, whatever its width.
 * - decimal: padded to the column's scale. Through `decimal(p, s)` first, so a
 *   `money` column — 19,4 in the snapshot — keeps four digits: its own default
 *   conversion rounds to two.
 * - boolean: `1` or `0`, which `fromCanonicalText` makes `true` or `false`.
 * - float: style 3, seventeen significant digits, which a double round-trips through.
 * - date `YYYY-MM-DD`; time `HH:MM`; an instant `YYYY-MM-DDTHH:MM:SSZ` in UTC;
 *   a zoneless timestamp the same without the `Z`. Each is formancy's shape,
 *   and a time's seconds and a timestamp's fraction are cut off, not rounded,
 *   because the shapes cannot hold them (0017).
 * - uuid: lower case, as the codec spells it; SQL Server prints upper case.
 */
export function canonicalText(type: NormalizedType, expression: string): string {
  switch (type.kind) {
    case 'text':
      return `convert(${nvarchar(type.maxLength)}, ${expression})`
    case 'integer':
      return `convert(nvarchar(20), ${expression})`
    case 'decimal':
      return `convert(nvarchar(50), convert(${decimalType(type)}, ${expression}))`
    case 'boolean':
      return `convert(nchar(1), ${expression})`
    case 'float':
      return `convert(nvarchar(30), ${expression}, 3)`
    case 'date':
      return `convert(nchar(10), ${expression}, 23)`
    case 'time':
      return `convert(nchar(5), ${expression}, 108)`
    case 'timestamp':
      return type.withTimeZone
        ? `convert(nchar(19), switchoffset(${expression}, '+00:00'), 126) + N'Z'`
        : `convert(nchar(19), ${expression}, 126)`
    case 'uuid':
      return `lower(convert(nchar(36), ${expression}))`
    case 'binary':
    case 'rowversion':
    case 'unsupported':
      throw noValue(type)
  }
}

/** The API value for text `canonicalText` produced: a boolean and a float become JSON's own; everything else stays a string. */
export function fromCanonicalText(type: NormalizedType, text: string | null): ApiValue {
  if (text === null) return null
  if (type.kind === 'boolean') return text === '1'
  if (type.kind === 'float') return Number(text)
  return text
}

function requireType(ok: boolean, type: NormalizedType): void {
  if (!ok) throw new Error(`A value for a ${type.kind} column is not the canonical value a codec returns`)
}

/** As text, for the server to convert: the one way into the database that loses nothing. */
function asText(parameters: Parameters, value: ApiValue): string {
  return parameters.add(mssql.NVarChar(mssql.MAX), value)
}

/**
 * Binds one canonical value and returns the SQL expression that is it, typed
 * as its column: `convert(decimal(18, 4), @p3)`. Null is bound with the same
 * type, so it is a typed NULL.
 *
 * Text is bound as nvarchar(max), never with the column's length: a parameter
 * declared shorter than its value is truncated by the server without a word,
 * and the column's own length check is the one that should refuse.
 *
 * A value of the wrong JavaScript type is a programming error, refused before
 * anything is sent: the record port's values arrive as a codec returned them.
 */
export function bindValue(parameters: Parameters, type: NormalizedType, value: ApiValue): string {
  const given = value === null ? null : typeof value
  switch (type.kind) {
    case 'text':
      requireType(given === null || given === 'string', type)
      return asText(parameters, value)
    case 'integer':
      requireType(given === null || given === 'string' || (given === 'number' && Number.isSafeInteger(value)), type)
      return `convert(${integerType(type)}, ${asText(parameters, value === null ? null : String(value))})`
    case 'decimal':
      requireType(given === null || given === 'string', type)
      return `convert(${decimalType(type)}, ${asText(parameters, value)})`
    case 'boolean':
      requireType(given === null || given === 'boolean', type)
      return parameters.add(mssql.Bit, value)
    case 'float':
      requireType(given === null || (given === 'number' && Number.isFinite(value)), type)
      return parameters.add(mssql.Float, value)
    case 'date':
      requireType(given === null || given === 'string', type)
      return `convert(date, ${asText(parameters, value)}, 23)`
    case 'time':
      requireType(given === null || given === 'string', type)
      return `convert(time, ${asText(parameters, value)})`
    case 'timestamp':
      // A zoneless timestamp is read-only: formancy's datetime is an instant (0009).
      if (!type.withTimeZone) throw noValue(type)
      requireType(given === null || given === 'string', type)
      return `convert(datetimeoffset, ${asText(parameters, value)}, 127)`
    case 'uuid':
      requireType(given === null || given === 'string', type)
      return `convert(uniqueidentifier, ${asText(parameters, value)})`
    case 'binary':
    case 'rowversion':
    case 'unsupported':
      throw noValue(type)
  }
}

/**
 * A collation that compares code point by code point, so a case- or
 * accent-insensitive column collation cannot call two different strings
 * equal. Trailing spaces still compare equal, as they do under every SQL
 * Server collation, which is also what lets a char(n) pad what it stores.
 */
export const EXACT_COLLATION = 'Latin1_General_100_BIN2'

/**
 * Binds a row filter's value, which is trusted text from the policy context.
 * The filter names a column and not its type, so the server converts the text
 * to a non-text column's type. Against a text column it compares exactly, not
 * by the column's collation: under a case-insensitive one, the tenant `acme`
 * would otherwise read the rows of `ACME`, which an application may hold to be
 * another tenant. Narrower is the side to fail on, and it is what PostgreSQL's
 * default collation does. The cost is that an index on a text filter column
 * is not used for a seek unless its collation is binary (0017).
 */
export function bindFilterValue(parameters: Parameters, value: string): string {
  return `${asText(parameters, value)} collate ${EXACT_COLLATION}`
}
