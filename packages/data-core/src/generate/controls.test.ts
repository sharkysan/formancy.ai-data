import { describe, expect, test } from 'vitest'
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
    expect(controlFor({ kind: 'text', maxLength: 4000, fixedLength: false }, false)).toMatchObject({ field: { type: 'textarea', maxLength: 4000 } })
    expect(controlFor({ kind: 'binary', maxLength: 16 }, false)).toEqual({ exclude: 'binary data has no form control' })
    expect(controlFor({ kind: 'rowversion' }, false)).toEqual({ exclude: 'a rowversion is a concurrency token, never a field' })
  })

  // A bound that is not exactly representable cannot be a number field's min,
  // even when the range is small: '9007199254740993' rounds on parse.
  test('an integer whose bounds a JavaScript number cannot hold exactly is text', () => {
    const plan = controlFor({ kind: 'integer', min: '0', max: '18446744073709551615' }, false)
    expect(plan).toMatchObject({ field: { type: 'text', pattern: '^-?[0-9]{1,20}$' } })
    expect(controlFor({ kind: 'integer', min: '0', max: '255' }, false)).toMatchObject({ field: { type: 'number', min: 0, max: 255 } })
  })
})
