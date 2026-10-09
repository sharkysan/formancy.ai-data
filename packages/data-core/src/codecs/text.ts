import type { NormalizedType, TextLengthUnit } from '../metadata.js'

type TextType = Extract<NormalizedType, { kind: 'text' }>

export type TextOutcome = { ok: true; value: string } | { ok: false; code: string; message: string }

/**
 * A value's length as a column of this unit counts it (0026).
 *
 * - `utf16-code-units`: JavaScript's `length`, which is what SQL Server's
 *   nvarchar counts and what the browser's `maxLength` counts.
 * - `code-points` and `code-page-bytes`: characters. Exact for PostgreSQL; for
 *   a code page, a lower bound — one byte per character on a single-byte page,
 *   one or two on a double-byte one, and nothing here holds the table.
 * - `utf8-bytes`: one byte below U+0080, two below U+0800, three below
 *   U+10000, four above. `parseText` refuses a lone surrogate before it is
 *   counted, so none is measured here; a lookup key with one is refused by
 *   the token first.
 *
 * By hand, because data-core has no `TextEncoder` typing (formancy.ai 0008).
 */
export function textLength(value: string, unit: TextLengthUnit): number {
  if (unit === 'utf16-code-units') return value.length
  let length = 0
  for (const character of value) {
    if (unit !== 'utf8-bytes') {
      length += 1
      continue
    }
    const point = character.codePointAt(0) ?? 0
    length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
  }
  return length
}

/** What a person is told when a value is longer than its column holds, in the column's own unit. */
function tooLong(maxLength: number, unit: TextLengthUnit): string {
  const n = String(maxLength)
  switch (unit) {
    case 'code-points':
      return `At most ${n} characters.`
    case 'utf16-code-units':
      return `At most ${n} characters, counting an emoji as two.`
    case 'utf8-bytes':
      return `At most ${n} bytes of UTF-8: a letter such as é takes two, and an emoji four.`
    case 'code-page-bytes':
      // A lower bound: characters are counted. What is longer in the encoding's
      // bytes, or holds a character it lacks, is refused when it is saved.
      return `At most ${n} characters.`
  }
}

/** A UTF-16 surrogate without its pair. In `u` mode a paired one is a single astral code point and does not match. */
const LONE_SURROGATE = /\p{Cs}/u

/**
 * A text value for this column, counted in the unit the column counts.
 *
 * NUL is refused on both engines: PostgreSQL cannot store it in text at all,
 * so the same value means the same thing on either. An unpaired UTF-16
 * surrogate is refused for the same reason (0026): PostgreSQL stores U+FFFD in
 * its place and reports success, SQL Server's nvarchar keeps it, and its UTF-8
 * varchar stores U+FFFD, which the adapter refuses as not stored — one value,
 * three outcomes. The lookup token and search refuse it already.
 *
 * The length is checked in `lengthUnit`, so a UTF-8 varchar's overflow is a
 * field error here rather than SQL Server's 2628, and PostgreSQL takes the
 * emoji its column holds. A code-page column is checked by characters only.
 * Beyond that the save refuses it: a value too long in bytes by the database,
 * a character the encoding lacks by PostgreSQL itself, and on SQL Server —
 * which stores `?` or a best fit without an error — by the adapter's check
 * that the text was stored as sent.
 */
export function parseText(type: TextType, value: string): TextOutcome {
  if (value.includes('\u0000')) return { ok: false, code: 'invalid-character', message: 'Text cannot contain a NUL character.' }
  if (LONE_SURROGATE.test(value)) {
    return { ok: false, code: 'invalid-character', message: 'Text cannot contain an unpaired UTF-16 surrogate, which UTF-8 cannot carry.' }
  }
  if (type.maxLength !== null && textLength(value, type.lengthUnit) > type.maxLength) {
    return { ok: false, code: 'too-long', message: tooLong(type.maxLength, type.lengthUnit) }
  }
  return { ok: true, value }
}
