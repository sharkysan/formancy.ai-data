import { describe, expect, test } from 'vitest'
import { bytes, figure, grouped, setting } from './format.js'

describe('a figure on the page', () => {
  // Zero is a measured zero -- no round trips, no reconnects -- and prints as one.
  test('prints 0 as 0', () => {
    expect(figure(0)).toBe('0')
  })

  // toPrecision(3) of 0.0004 is "0.000400", three figures of a value the
  // clock cannot resolve; the page says it is below what it prints.
  test('prints a value below 0.001 as <0.001', () => {
    expect(figure(0.0004)).toBe('<0.001')
  })

  // Three significant figures below 1,000, which is what toPrecision gives
  // without an exponent in that range.
  test('prints three significant figures below 1,000', () => {
    expect(figure(0.412)).toBe('0.412')
    expect(figure(4.123)).toBe('4.12')
    expect(figure(41.2)).toBe('41.2')
    expect(figure(412)).toBe('412')
    expect(figure(0.001)).toBe('0.00100')
  })

  // toPrecision(3) of 1234 is "1.23e+3" and of 999.5 is "1.00e+3": a page
  // that printed every value that way would publish exponents. At and above
  // 1,000 after rounding, a whole number with commas, from a fixed function
  // rather than toLocaleString, so the machine's locale cannot change it.
  test('prints a whole number with commas once rounding reaches 1,000', () => {
    expect(figure(999.4)).toBe('999')
    expect(figure(999.5)).toBe('1,000')
    expect(figure(1234)).toBe('1,234')
    expect(figure(1234567.8)).toBe('1,234,568')
  })

  // A latency difference can come out below zero; the sign is kept.
  test('keeps a negative sign', () => {
    expect(figure(-41.2)).toBe('-41.2')
    expect(figure(-1234)).toBe('-1,234')
  })

  // A NaN on the page is a harness defect that would otherwise print as "NaN".
  test('refuses what is not a finite number', () => {
    expect(() => figure(Number.NaN)).toThrow()
    expect(() => figure(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe('a setting on the page', () => {
  // A configured value is what was typed, not a measurement: D is "5", not
  // the three significant figures a measured "5.00" would claim.
  test('prints a whole number as written and anything else as a figure', () => {
    expect(setting(5)).toBe('5')
    expect(setting(10_000_000)).toBe('10,000,000')
    expect(setting(1.1)).toBe('1.10')
  })
})

describe('bytes on the page', () => {
  // MiB with one decimal for reading, and the exact count beside it, so
  // nothing is lost to the rounding; below a MiB in KiB, so a published
  // version of a few dozen kilobytes does not read as "0.0 MiB".
  test('print as MiB or KiB and the exact count', () => {
    expect(bytes(159_383_552)).toBe('152.0 MiB (159,383,552 bytes)')
    expect(bytes(1_048_576)).toBe('1.0 MiB (1,048,576 bytes)')
    expect(bytes(45_626)).toBe('44.6 KiB (45,626 bytes)')
    expect(bytes(1023)).toBe('1,023 bytes')
    expect(bytes(0)).toBe('0 bytes')
  })

  test('group whole numbers by thousands', () => {
    expect(grouped(0)).toBe('0')
    expect(grouped(999)).toBe('999')
    expect(grouped(1000)).toBe('1,000')
    expect(grouped(1_000_002)).toBe('1,000,002')
    expect(() => grouped(1.5)).toThrow()
  })
})
