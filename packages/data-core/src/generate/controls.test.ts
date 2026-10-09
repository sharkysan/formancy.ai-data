import { describe, expect, test } from 'vitest'
import type { TextLengthUnit } from '../metadata.js'
import { controlFor } from './controls.js'

/** The pattern a decimal of this shape gets, or a failure naming what came back instead. */
function pattern(precision: number | null, scale: number | null): string {
  const plan = controlFor({ kind: 'decimal', precision, scale }, false)
  if (!('field' in plan) || plan.field.pattern === undefined) throw new Error('a decimal must get a pattern')
  return plan.field.pattern
}

describe('controlFor', () => {
  // Each decimal shape is a different pattern, and each pattern is the whole
  // client-and-server check on the value. Wrong here is wrong everywhere.
  test('decimal patterns follow precision and scale exactly, including the edge shapes', () => {
    const matches = (source: string, value: string) => new RegExp(source).test(value)

    expect(pattern(5, 0)).toBe('^-?[0-9]{1,5}$')
    expect(matches(pattern(5, 0), '12345')).toBe(true)
    expect(matches(pattern(5, 0), '1.5')).toBe(false)

    // numeric(2,2): no whole digits at all, so 0.99 is the largest and 1 is too big.
    const fractionOnly = pattern(2, 2)
    expect(['0', '0.5', '.99', '-0.01'].map((value) => matches(fractionOnly, value))).toEqual([true, true, true, true])
    expect(['1', '0.999', '', '-'].map((value) => matches(fractionOnly, value))).toEqual([false, false, false, false])

    // PostgreSQL's unconstrained numeric: any digits, but still digits.
    expect(matches(pattern(null, null), '123456789012345678901234567890.123')).toBe(true)
    expect(matches(pattern(null, null), '1e3')).toBe(false)
  })

  // The remaining types each have exactly one control; a change to one should
  // be a decision, not a side effect.
  test('every other type has its control, or a reason it has none', () => {
    expect(controlFor({ kind: 'float', bits: 64 }, false)).toMatchObject({ field: { type: 'number' } })
    expect(controlFor({ kind: 'date' }, false)).toMatchObject({ field: { type: 'date' } })
    expect(controlFor({ kind: 'time', precision: 7 }, true)).toMatchObject({ field: { type: 'time' } })
    expect(controlFor({ kind: 'uuid' }, false)).toMatchObject({ field: { type: 'text', format: 'uuid' } })
    expect(controlFor({ kind: 'text', maxLength: 4000, lengthUnit: 'utf16-code-units', fixedLength: false }, false)).toMatchObject({ field: { type: 'textarea', maxLength: 4000 } })
    expect(controlFor({ kind: 'binary', maxLength: 16, fixedLength: false }, false)).toEqual({ exclude: 'binary data has no form control' })
    expect(controlFor({ kind: 'rowversion' }, false)).toEqual({ exclude: 'a rowversion is a concurrency token, never a field' })
  })

  // The browser's maxLength counts UTF-16 code units whatever the column
  // counts, and that is never more than code points, UTF-8 bytes or code-page
  // bytes: n can only be stricter than the column. What it cannot do — refuse a
  // UTF-8 overflow, take a third emoji PostgreSQL holds — has to be said on the
  // field, or the person reviewing the form believes the browser checks it.
  test('a bounded text keeps maxLength n in every unit, and says how that relates to the column', () => {
    const caveats: Record<TextLengthUnit, RegExp> = {
      'utf16-code-units': /^The browser's maxLength of 20 counts UTF-16 code units, the unit the column counts\.$/,
      'code-points': /an emoji counts twice in the browser, so the form can refuse a value the column would hold, never the reverse\.$/,
      'utf8-bytes': /^The column holds 20 bytes of UTF-8 .*Checked on the server only\.$/,
      // SQL Server stores ? or a best fit for a character its code page lacks,
      // without an error; the caveat must not say the database refuses it.
      'code-page-bytes': /^The column counts 20 in its code page, not in Unicode, .*or with a character the code page lacks, is refused when it is saved\.$/,
    }
    for (const [unit, caveat] of Object.entries(caveats) as Array<[TextLengthUnit, RegExp]>) {
      const plan = controlFor({ kind: 'text', maxLength: 20, lengthUnit: unit, fixedLength: false }, false)
      expect(plan, unit).toMatchObject({ field: { type: 'text', maxLength: 20 }, caveat: expect.stringMatching(caveat) })
    }
    // Unbounded, there is no maxLength to relate to the column.
    expect(controlFor({ kind: 'text', maxLength: null, lengthUnit: 'utf8-bytes', fixedLength: false }, false)).not.toHaveProperty('caveat')
  })

  // A real keeps about seven digits. Without the caveat a person typing
  // 0.123456789 would be surprised to see 0.12345679 come back.
  test('a 32-bit float says it keeps about seven digits; a 64-bit one is unchanged', () => {
    expect(controlFor({ kind: 'float', bits: 32 }, false)).toEqual({
      field: { type: 'number' },
      describe: 'a 32-bit floating-point number',
      caveat: 'A 32-bit float keeps about seven significant digits: the server saves the nearest one and answers with its shortest spelling, so 0.123456789 is saved as 0.12345679.',
    })
    expect(controlFor({ kind: 'float', bits: 64 }, false)).toEqual({ field: { type: 'number' }, describe: 'a floating-point number' })
  })

  // A bound that is not exactly representable cannot be a number field's min,
  // even when the range is small: '9007199254740993' rounds on parse.
  test('an integer whose bounds a JavaScript number cannot hold exactly is text', () => {
    const plan = controlFor({ kind: 'integer', min: '0', max: '18446744073709551615' }, false)
    expect(plan).toMatchObject({ field: { type: 'text', pattern: '^-?[0-9]{1,20}$' } })
    expect(controlFor({ kind: 'integer', min: '0', max: '255' }, false)).toMatchObject({ field: { type: 'number', min: 0, max: 255 } })
  })
})
