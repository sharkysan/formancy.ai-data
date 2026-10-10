import { canonicalFloat32 } from '@formancy/data-core'
import type { ApiValue, NormalizedType } from '@formancy/data-core'
import { op } from './catalog.js'

/**
 * Values between canonical API text and PostgreSQL, in both directions,
 * converted by the server and never by the driver (0008, 0015).
 *
 * The read side is SQL: each column becomes the text `codecFor(column).parse`
 * would return, written so that no session setting can change it. Not
 * `::text` for everything — `date::text` follows DateStyle ('08/10/2026'
 * under 'SQL, DMY'), `timestamptz::text` follows TimeZone, and a float's text
 * follows `extra_float_digits`, and each is the composition root's to set.
 * Every function, operator and type is named in pg_catalog, because the
 * search path is the composition root's to set too (`catalog.ts`).
 */

/** The days formancy's date shape can name, which both engines store (0008). */
const FIRST_DAY = `'0001-01-01'`
const LAST_DAY = `'9999-12-31'`

/**
 * A date as `YYYY-MM-DD`, from `to_char`, which ignores DateStyle.
 *
 * `to_char` alone is wrong at the edges, plausibly: it drops the era, so 44
 * BC reads as AD 44, and returns NULL for `infinity`. Outside the range the
 * shape can name, the value is spelled with its era, or as `infinity`: text
 * the codec refuses, so it is shown and can never be written back as
 * something else.
 */
function dateText(column: string): string {
  return `case
    when ${column} ${op('>=')} ${FIRST_DAY}::pg_catalog.date and ${column} ${op('<=')} ${LAST_DAY}::pg_catalog.date then pg_catalog.to_char(${column}, 'YYYY-MM-DD')
    when pg_catalog.isfinite(${column}) then pg_catalog.to_char(${column}, 'YYYY-MM-DD BC')
    else ${column}::pg_catalog.text end`
}

/**
 * A timestamp as `YYYY-MM-DDTHH:MM:SS`, with `Z` when it is an instant.
 *
 * An instant is first moved to UTC with `at time zone 'UTC'`, which does not
 * depend on the session's TimeZone, and read to the second: formancy's
 * instant has whole seconds, and SQL Server reads its own to the second too
 * (0040). A fraction -- what `now()` writes -- is cut, never rounded, so the
 * read is a value its field accepts; `planUpdate` removes an unedited echo
 * of it from an update, so the fraction the row holds is never written
 * over. Outside years 1 to 9999 the era is spelled with the fraction, as for
 * a date, and `infinity` as itself: text the codec refuses, which no cut
 * could make true.
 *
 * A zoneless timestamp is spelled the same, without the `Z`, and keeps its
 * fraction, trailing zeros dropped, never rounded, and none on a whole
 * second. That is the spelling both adapters give it (0026), held by the
 * shared FIRST_SHIPMENT and SECOND_SHIPMENT; SQL Server reaches it with a
 * trim over style 126, this one with `rtrim` over the microseconds. It has
 * no field that writes it, so nothing is cut.
 */
function timestampText(column: string, withTimeZone: boolean): string {
  const at = withTimeZone ? `(${column} at time zone 'UTC')` : column
  const zone = withTimeZone ? 'Z' : ''
  // to_char's SS is the seconds field, which the fraction never carries into.
  const spelled = withTimeZone
    ? `pg_catalog.to_char(${at}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
    : `pg_catalog.concat(pg_catalog.to_char(${at}, 'YYYY-MM-DD"T"HH24:MI:SS'), case
        when (extract(microseconds from ${at}) ${op('%')} 1000000) ${op('=')} 0 then ''
        else pg_catalog.concat('.', pg_catalog.rtrim(pg_catalog.to_char(${at}, 'US'), '0')) end)`
  return `case
    when ${at} ${op('>=')} ${FIRST_DAY}::pg_catalog.timestamp and ${at} ${op('<=')} '9999-12-31 23:59:59.999999'::pg_catalog.timestamp then ${spelled}
    when pg_catalog.isfinite(${at}) then pg_catalog.to_char(${at}, 'YYYY-MM-DD"T"HH24:MI:SS.US"${zone}" BC')
    else ${at}::pg_catalog.text end`
}

/**
 * A time as `HH:MM`, formancy's shape, read to the minute as SQL Server reads
 * one (0040): seconds and a fraction are cut, never rounded, and
 * `planUpdate` removes an unedited echo from an update, so the seconds the
 * row holds are never written over. `time` spells itself the same way in every
 * DateStyle. PostgreSQL's `24:00:00` reads `24:00`, which the codec refuses.
 */
function timeText(column: string): string {
  return `pg_catalog.substr(${column}::pg_catalog.text, 1, 5)`
}

/**
 * The SQL that reads one column as its canonical text.
 *
 * - text, integers, decimals, uuids: their own output, which no setting
 *   changes. A decimal keeps its scale (`12.50`); a uuid is lower case.
 *   char(n) is read as text, which drops the padding, as PostgreSQL's own
 *   char-to-text cast does: trailing blanks are not significant in char(n).
 * - boolean: `true` or `false`.
 * - float: the IEEE 754 bits, as hex, decoded below. Exact, and independent
 *   of `extra_float_digits`. A real is then given its canonical value,
 *   `canonicalFloat32` (0026), which is the one the codec accepts it as.
 * - date, time, timestamp: as above.
 */
export function canonicalText(type: NormalizedType, column: string): string {
  switch (type.kind) {
    case 'text':
    case 'integer':
    case 'decimal':
    case 'uuid':
    case 'boolean':
      return `${column}::pg_catalog.text`
    case 'float':
      return `pg_catalog.encode(pg_catalog.${type.bits === 32 ? 'float4send' : 'float8send'}(${column}), 'hex')`
    case 'date':
      return dateText(column)
    case 'time':
      return timeText(column)
    case 'timestamp':
      return timestampText(column, type.withTimeZone)
    case 'binary':
    case 'rowversion':
    case 'unsupported':
      throw new Error(`A ${type.kind} column has no canonical text to read.`)
  }
}

/**
 * A float from its bits. A finite one is a JSON number, as the codec takes
 * it: a double as itself, a real as `canonicalFloat32` names it — `0.1`, the
 * shortest decimal that is the same float, not the double
 * `0.10000000149011612` that is its exact value. Not PostgreSQL's own float4
 * text, which can differ in a last digit; the SQL Server adapter reads a real
 * through the same function, so the engines agree. The codec
 * gives a real the same value, so a read sent back unchanged is unchanged
 * (0026). NaN and the infinities have no JSON number — `JSON.stringify`
 * would write `null`, which is a different value — so they stay text.
 */
function floatOf(hex: string, bits: 32 | 64): ApiValue {
  const bytes = Buffer.from(hex, 'hex')
  const value = bits === 32 ? bytes.readFloatBE(0) : bytes.readDoubleBE(0)
  if (!Number.isFinite(value)) return String(value)
  return bits === 32 ? canonicalFloat32(value) : value
}

/** The API value for one column's canonical text, as `canonicalText` spelled it. */
export function decodeCanonical(type: NormalizedType, text: string | null): ApiValue {
  if (text === null) return null
  if (type.kind === 'boolean') return text === 'true'
  if (type.kind === 'float') return floatOf(text, type.bits)
  return text
}

/**
 * The text a value is bound from: exactly what the codec returned (0008).
 *
 * Throws on a value of the wrong shape for its kind — a decimal or an
 * integer as a JavaScript number, a boolean as text — because a codec never
 * returns one: it returns integers as decimal strings, and a number past
 * 2^53 would already have lost its digits.
 */
export function bindText(value: ApiValue, type: NormalizedType): string | null {
  if (value === null) return null
  switch (type.kind) {
    case 'boolean':
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      break
    case 'float':
      // Shortest round-trip spelling: the server reads back the same double.
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      break
    default:
      if (typeof value === 'string') return value
  }
  throw new Error(`A ${typeof value} is not a canonical value for a ${type.kind} column.`)
}
