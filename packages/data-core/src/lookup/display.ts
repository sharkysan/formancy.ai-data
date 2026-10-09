import type { ApiValue } from '../codecs/codec.js'
import { canonicalFloat32 } from '../codecs/numbers.js'
import type { LookupDisplayType } from './types.js'

/*
 * What a label shows for one value, spelled once for both engines (0028).
 *
 * An adapter reads a display column with its record reader, so the value here
 * is canonical: what a record read returns for it. Before, each adapter
 * spelled labels its own way — PostgreSQL's `to_jsonb` in the session's
 * TimeZone and `extra_float_digits` (C6-pg), SQL Server's style 126 with bit
 * `1`, an upper-case uuid, scientific floats and an offset in the stored zone
 * (C6) — and a person read two answers for one row.
 *
 * A label is for recognising a row, not for writing it back, so a time is
 * shown to the minute and an instant to the second: cut, never rounded,
 * because rounding moves a value into a minute or second the row does not
 * hold. Labels are not localised.
 */

/** An instant as both readers spell one inside years 1–9999, its fraction apart. */
const INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/
/** A zoneless timestamp, likewise. */
const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?$/
/** What PostgreSQL's reader returns for a float JSON has no number for. */
const NOT_A_NUMBER: ReadonlySet<string> = new Set(['NaN', 'Infinity', '-Infinity'])

function wrongType(type: LookupDisplayType, value: ApiValue): Error {
  return new Error(`A ${type.kind} display value cannot be a ${typeof value}: the adapter decoded it with another column's type.`)
}

function text(type: LookupDisplayType, value: ApiValue): string {
  if (typeof value !== 'string') throw wrongType(type, value)
  return value
}

/** To the second, cut; a value outside the shape — an era, `infinity` — is shown as read. */
function toTheSecond(shape: RegExp, value: string, zone: string): string {
  const match = shape.exec(value)
  return match === null ? value : `${match[1] as string}${zone}`
}

/**
 * The text a label shows for one display value, or null for SQL NULL.
 *
 * - text, integer, decimal, uuid, date: the canonical string unchanged
 *   (`12.50`, a lower-case uuid).
 * - boolean: `true` or `false`.
 * - a double: `String(n)`; a real: `String(canonicalFloat32(n))`, which is
 *   idempotent whichever layer already applied it. NaN and the infinities,
 *   which PostgreSQL returns as text, are shown as that text.
 * - time: `HH:MM`, the first five characters.
 * - timestamp: `YYYY-MM-DDTHH:MM:SS`, with `Z` for an instant, the fraction cut.
 *
 * Throws on a value of the wrong JavaScript type for its kind.
 */
export function displayText(type: LookupDisplayType, value: ApiValue): string | null {
  if (value === null) return null
  switch (type.kind) {
    case 'text':
    case 'integer':
    case 'decimal':
    case 'uuid':
    case 'date':
      return text(type, value)
    case 'boolean':
      if (typeof value !== 'boolean') throw wrongType(type, value)
      return String(value)
    case 'float':
      if (typeof value === 'string' && NOT_A_NUMBER.has(value)) return value
      if (typeof value !== 'number') throw wrongType(type, value)
      return String(type.bits === 32 ? canonicalFloat32(value) : value)
    case 'time':
      return text(type, value).slice(0, 5)
    case 'timestamp':
      return type.withTimeZone ? toTheSecond(INSTANT, text(type, value), 'Z') : toTheSecond(WALL_CLOCK, text(type, value), '')
  }
}
