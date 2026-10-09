import { describe, expect, test } from 'vitest'
import type { TextLengthUnit } from '../metadata.js'
import type { LookupKeyType } from './types.js'
import { isKeyValue } from './values.js'

/** U+00A0, which neither engine treats as padding (C1b). Spelled by its code point so the source shows it. */
const NO_BREAK_SPACE = String.fromCodePoint(0xa0)

const text = (maxLength: number, lengthUnit: TextLengthUnit, fixedLength = false): LookupKeyType => ({ kind: 'text', maxLength, lengthUnit, fixedLength })

describe('isKeyValue', () => {
  // A token or a trusted filter value is measured as the column measures it.
  // Counted in UTF-16 units, a UTF-8 varchar(4) would take three é — a key the
  // database could never hold, so never match — and a PostgreSQL varchar(3)
  // would refuse é é and an emoji, a key it can hold and so might match.
  test("a key value is measured in its column's unit", () => {
    expect(isKeyValue(text(4, 'utf8-bytes'), 'ééé')).toBe(false)
    expect(isKeyValue(text(4, 'utf8-bytes'), 'éé')).toBe(true)
    expect(isKeyValue(text(3, 'code-points'), 'éé😀')).toBe(true)
    expect(isKeyValue(text(3, 'utf16-code-units'), 'éé😀')).toBe(false)
    expect(isKeyValue(text(3, 'code-page-bytes'), 'abcd')).toBe(false)
  })

  // Both engines pad a fixed-length column and ignore the padding, so its
  // canonical value never ends in a space (0028). A token or a filter value
  // that does would be asked about on SQL Server, whose `=` ignores it, and
  // match nothing as exact text: one engine's row, the other's silence. A
  // variable-length column holds the space, and it counts.
  test('a fixed-length text value ending in a space is not a key value; a variable-length one is', () => {
    expect(isKeyValue(text(3, 'code-points', true), 'AB')).toBe(true)
    expect(isKeyValue(text(3, 'code-points', true), 'AB ')).toBe(false)
    expect(isKeyValue(text(3, 'code-points', true), ' AB')).toBe(true)
    // Only U+0020 is padding; a no-break space is a character the column holds.
    expect(isKeyValue(text(3, 'code-points', true), `AB${NO_BREAK_SPACE}`)).toBe(true)
    expect(isKeyValue(text(5, 'code-points'), 'acme ')).toBe(true)
  })

  // postgres.js sends a parameter as UTF-8, which turns an unpaired surrogate
  // into U+FFFD; tedious sends UTF-16, which keeps it. One trusted value
  // would then select the rows holding U+FFFD on PostgreSQL — another
  // tenant's — and its own on SQL Server. The codec and the token refuse such
  // text already; a key or filter value is refused the same way.
  test('text holding an unpaired surrogate is not a key value; a paired one is', () => {
    expect(isKeyValue(text(5, 'utf16-code-units'), 'x\uD800')).toBe(false)
    expect(isKeyValue(text(5, 'utf16-code-units'), '\uDC00x')).toBe(false)
    expect(isKeyValue(text(5, 'utf16-code-units'), 'x😀')).toBe(true)
  })
})
