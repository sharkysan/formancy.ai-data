import { describe, expect, test } from 'vitest'
import { nearestRank, rank, summarise, supported } from './stats.js'

describe('nearest rank', () => {
  // The published percentile is a sample that was measured, never an
  // interpolation between two: the rank is ⌈q·n/100⌉. A floor instead of the
  // ceiling would report the sample below it, a faster figure than measured.
  test('is the sample at ⌈q·n/100⌉, counted from one', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(nearestRank(sorted, 50)).toBe(5)
    expect(nearestRank(sorted, 90)).toBe(9)
    expect(nearestRank(sorted, 99)).toBe(10)
    expect(nearestRank([10, 20, 30], 50)).toBe(20)
    expect(nearestRank([10, 20, 30, 40, 50, 60, 70], 90)).toBe(70)
  })

  // One sample is every percentile of itself; a rank of 0 would read past the start.
  test('of one sample is that sample', () => {
    expect(nearestRank([42], 50)).toBe(42)
    expect(nearestRank([42], 99)).toBe(42)
  })

  // Ranks are integer arithmetic, so 0.9 × 100 can never become 90.00000000000001.
  test('ranks by integers', () => {
    expect(rank(100, 90)).toBe(90)
    expect(rank(1000, 99)).toBe(990)
    expect(rank(7, 50)).toBe(4)
  })

  // A percentile asked of nothing, or a percent that is not whole, is a
  // harness defect, not a figure.
  test('refuses an empty sample, an unsorted one and a percent that is not whole', () => {
    expect(() => nearestRank([], 50)).toThrow()
    expect(() => nearestRank([2, 1], 50)).toThrow()
    expect(() => rank(10, 99.9)).toThrow()
    expect(() => rank(10, 0)).toThrow()
    expect(() => rank(0, 50)).toThrow()
  })
})

describe('whether a percentile is supported', () => {
  // A p99 of 899 samples rests on the nine above it, which is a guess about
  // the tail; at 900 there are ten. "n too small" is printed instead.
  test('needs ten samples at or above the rank', () => {
    expect(supported(900, 99)).toBe(true)
    expect(supported(899, 99)).toBe(false)
    expect(supported(10, 50)).toBe(false)
    expect(supported(19, 50)).toBe(true)
  })

  // The floating-point trap: 100 × (1 − 0.9) is 9.999999999999998, so a rule
  // computed as n·(1 − p) ≥ 10 refuses a p90 of 100 samples, whose rank 90
  // has exactly eleven samples at or above it.
  test('of p90 at 100 samples, which floating point gets wrong', () => {
    expect(supported(100, 90)).toBe(true)
  })
})

describe('a summary', () => {
  // The published row: n, the supported percentiles, max and mean. A
  // percentile without ten samples above it is null, never a number.
  test('holds the supported percentiles and nulls the rest', () => {
    const samples = Array.from({ length: 100 }, (_, i) => 100 - i)
    expect(summarise(samples)).toEqual({ n: 100, p50: 50, p90: 90, p99: null, max: 100, mean: 50.5 })
  })

  // The samples arrive in completion order; a summary that sorted the
  // caller's array would reorder the raw samples written beside it.
  test('leaves the samples in the order they were taken', () => {
    const samples = [3, 1, 2]
    summarise(samples)
    expect(samples).toEqual([3, 1, 2])
  })
})
