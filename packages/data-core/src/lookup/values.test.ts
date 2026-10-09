import { describe, expect, test } from 'vitest'
import type { TextLengthUnit } from '../metadata.js'
import type { LookupKeyType } from './types.js'
import { isKeyValue } from './values.js'

const text = (maxLength: number, lengthUnit: TextLengthUnit): LookupKeyType => ({ kind: 'text', maxLength, lengthUnit, fixedLength: false })

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
})
