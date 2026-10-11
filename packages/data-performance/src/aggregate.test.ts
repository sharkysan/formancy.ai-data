import { describe, expect, test } from 'vitest'
import { latencyResult, runFactsOf, scenarioResult } from './aggregate.js'
import type { Measured } from './aggregate.js'
import type { BlockCounters } from './sampler.js'

const counters = (over: Partial<BlockCounters> = {}): BlockCounters => ({
  machineBusyPct: 5,
  stealPct: null,
  serverCpuMs: 30,
  databaseCpuMs: 60,
  generatorLagP99Ms: 1,
  loadAvgAtStart: 0.1,
  idle: { probeBeforeMs: 4, probeAfterMs: 4, databaseCpuMs: 8, seconds: 4 },
  disturbances: { autovacuum: 0, autoanalyze: 0 },
  reconnects: 0,
  ...over,
})

/** A round of `n` samples valued `from` to `from + n − 1` ms, over `seconds`. */
const round = (from: number, n: number, seconds: number, over: Partial<BlockCounters> = {}, repeated = false): Measured => ({
  block: { samples: Array.from({ length: n }, (_, i) => from + i), seconds, rowsAnswered: 50, counters: counters(over) },
  repeated,
})

describe('a scenario over its rounds', () => {
  // The published percentiles pool every round's samples -- not the middle
  // of the rounds' p50s, which is 110 here -- and each round's own p50 is
  // printed beside them, so drift between rounds is visible rather than
  // averaged away.
  test('pools the rounds for percentiles and keeps each round p50', () => {
    const result = scenarioResult('pg', 'lookup-common', 1, 2, [round(1, 20, 2), round(101, 20, 2), round(102, 20, 2)], 4)
    expect(result).toMatchObject({ n: 60, p50: 106, p90: null, p99: null, max: 121, rounds: [10, 110, 111], roundTrips: 2, rowsAnswered: 50 })
  })

  // Throughput is requests over the seconds they took, all rounds together;
  // CPU per request is CPU over requests, never a mean of the rounds' own
  // ratios, which would weigh a short round like a long one (0.2 and 0.4 here).
  test('divides by requests and seconds, not by rounds', () => {
    const result = scenarioResult('ms', 'read', 8, 2, [round(1, 100, 1), round(1, 300, 3)], 4)
    expect(result.throughput).toBe(100)
    expect(result.serverCpuMsPerRequest).toBe(0.15)
    expect(result.databaseCpuMsPerRequest).toBe(0.3)
  })

  // The database's container works on its own too -- autovacuum, a
  // checkpoint, its background workers -- and a block's CPU over its
  // requests carries that. What the container used per second in the idle
  // gaps around each round, nothing in flight, is recorded beside it: CPU
  // over gap seconds, all rounds together (1 ms a second over 2 s and 9 over
  // 6 s here: 7, not 5, the mean of the rounds' rates).
  test("records the database's CPU per second in the idle gaps beside its CPU per request", () => {
    const result = scenarioResult('pg', 'health', 1, 0, [round(1, 100, 1, { idle: { probeBeforeMs: 4, probeAfterMs: 4, databaseCpuMs: 2, seconds: 2 } }), round(1, 100, 1, { idle: { probeBeforeMs: 4, probeAfterMs: 4, databaseCpuMs: 54, seconds: 6 } })], 4)
    expect(result.databaseIdleCpuMsPerSecond).toBe(7)
  })
})

describe('what went on around a block', () => {
  // Steal the hypervisor never reported is recorded in words; a block that
  // ran twice says so; disturbances and reconnects add up over the rounds.
  test('is aggregated over the rounds', () => {
    const run = runFactsOf([round(1, 10, 1, { machineBusyPct: 4, disturbances: { autovacuum: 1, autoanalyze: 0 }, reconnects: 1 }), round(1, 10, 1, { machineBusyPct: 6, generatorLagP99Ms: 3 }, true)], 4)
    expect(run).toEqual({ machineBusyPct: 5, steal: 'not reported', generatorLagP99Ms: 3, loadAvgAtStart: 0.1, calibrationRatio: 1, repeated: true, disturbances: { autovacuum: 1, autoanalyze: 0 }, reconnects: 1 })
  })

  // The calibration figure is the worst idle gap of any round against the
  // quiet baseline -- before a block or after it -- never the probe under
  // the block's own load, which slows with the run itself.
  test('takes the calibration from the worse idle gap of the worst round', () => {
    const gaps = (probeBeforeMs: number, probeAfterMs: number) => ({ idle: { probeBeforeMs, probeAfterMs, databaseCpuMs: 0, seconds: 4 } })
    expect(runFactsOf([round(1, 10, 1, gaps(4, 4.4)), round(1, 10, 1, gaps(5, 4))], 4).calibrationRatio).toBe(1.25)
  })

  test('reports the most steal when the hypervisor reports it', () => {
    expect(runFactsOf([round(1, 10, 1, { stealPct: 0.5 }), round(1, 10, 1, { stealPct: 1.5 })], 4).steal).toBe(1.5)
  })
})

describe('the added-latency block', () => {
  // The difference is the median of the rounds' differences of p50s; with
  // no round trips there is nothing for it to be a multiple of, so the
  // ratio is absent rather than infinite.
  test('takes the median of the rounds and has no ratio without round trips', () => {
    const rounds = [0, 1, 2].map((r) => ({ undelayed: round(10 + r, 20, 1), delayed: round(20 + 3 * r, 20, 1) }))
    const four = latencyResult('pg', 'read', 2, 5, rounds, 4)
    expect(four).toMatchObject({ undelayedMs: 20, delayedMs: 32, differenceMs: 12, spreadMs: 4, expectedMs: 10, ratio: 1.2 })
    expect(four.rounds.map((entry) => entry.differenceMs)).toEqual([10, 12, 14])
    const none = latencyResult('pg', 'health', 0, 5, rounds, 4)
    expect(none.ratio).toBeNull()
    expect(none.expectedMs).toBe(0)
  })

  // Five samples have no supported p50, so a smoke pass has no difference to report.
  test('reports no difference from passes too small for a p50', () => {
    const tiny = latencyResult('ms', 'read', 2, 5, [{ undelayed: round(1, 5, 1), delayed: round(11, 5, 1) }], 4)
    expect(tiny).toMatchObject({ undelayedMs: null, delayedMs: null, differenceMs: null, spreadMs: null, ratio: null })
  })
})
