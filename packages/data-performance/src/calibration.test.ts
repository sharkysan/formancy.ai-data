import { describe, expect, test } from 'vitest'
import { calibrationSpread, medianOf } from './calibration.js'

/** A probe that started `at` ms into the run and took `ms`. */
const probe = (at: number, ms: number) => ({ start: BigInt(at * 1e6), end: BigInt(Math.round((at + ms) * 1e6)) })

describe('the calibration probe', () => {
  // A gap is judged by the median of the probes inside it, against the
  // median of the quiet check's: the middle sample, never a mean one slow
  // probe drags.
  test('takes the median by nearest rank', () => {
    expect(medianOf([3, 1, 2])).toBe(2)
    expect(medianOf([4, 1, 3, 2])).toBe(2)
    expect(medianOf([])).toBeNull()
  })

  // P13 measures the statistic the run judges, on an idle machine: a gap's
  // median against a baseline window's median, both drawn as the run draws
  // them. The worst gap against the lowest baseline window, because the run's
  // baseline is one window of the quiet check's length, whichever it was, and
  // its own error is part of every ratio the run computes. Here the second
  // gap of 1 s runs at 5 ms and the third baseline window of 2 s at 3.125 ms:
  // 1.6. Each window's median against the whole run's median says 1.25 and
  // leaves the baseline's error out. The last window of each length, cut
  // short by the end of the probes, is not a window the run would judge.
  test("gives the worst ratio of a gap's median to a baseline window's", () => {
    const durations = [4, 4, 4, 4, 5, 5, 4, 4, 3.125, 3.125, 3.125, 3.125, 4, 4, 4, 4]
    const probes = durations.map((ms, index) => probe(index * 500, ms))
    expect(calibrationSpread(probes, { baselineMs: 2000, gapMs: 1000 })).toEqual({
      probes: 16,
      medianMs: 4,
      baselineMs: 2000,
      baselineWindows: 3,
      gapMs: 1000,
      gapWindows: 7,
      worstRatio: 1.6,
    })
  })

  // Too few probes to say anything is not a spread of 1.
  test('refuses to report a spread without a whole window of each length', () => {
    expect(() => calibrationSpread([], { baselineMs: 2000, gapMs: 1000 })).toThrow(/no probes ran/)
    expect(() => calibrationSpread([probe(0, 4), probe(500, 4)], { baselineMs: 2000, gapMs: 500 })).toThrow(/no whole 2000 ms window/)
  })
})
