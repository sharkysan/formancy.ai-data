import { gapRatio } from './quiet.js'
import type { EngineKey, LatencyResult, RunFacts, ScenarioResult } from './results.js'
import type { BlockResult } from './sampler.js'
import { summarise } from './stats.js'

/*
 * A block's rounds into the published entry (0034): percentiles over every
 * round's samples pooled, each round's own p50 beside them, throughput and
 * CPU over requests, and what went on around the block aggregated -- the
 * worst calibration, the most steal, every disturbance and reconnect.
 */

/** One round of a block, and whether it was the second attempt after a calibration miss. */
export interface Measured {
  block: BlockResult
  repeated?: boolean
}

/** The middle of a few round values by nearest rank, or null if any round had none: medians over rounds, not over samples. */
function middle(values: ReadonlyArray<number | null>): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null
  const sorted = (values as number[]).slice().sort((a, b) => a - b)
  return sorted[Math.trunc((50 * sorted.length + 99) / 100) - 1] as number
}

export function runFactsOf(rounds: readonly Measured[], baselineMs: number): RunFacts {
  const all = rounds.map((round) => round.block.counters)
  const steals = all.map((counter) => counter.stealPct)
  const disturbances: Record<string, number> = {}
  for (const counter of all) for (const [name, count] of Object.entries(counter.disturbances)) disturbances[name] = (disturbances[name] ?? 0) + count
  return {
    machineBusyPct: all.reduce((sum, counter) => sum + counter.machineBusyPct, 0) / all.length,
    steal: steals.some((steal) => steal === null) ? 'not reported' : Math.max(...(steals as number[])),
    generatorLagP99Ms: Math.max(...all.map((counter) => counter.generatorLagP99Ms)),
    loadAvgAtStart: Math.max(...all.map((counter) => counter.loadAvgAtStart)),
    calibrationRatio: Math.max(...all.map((counter) => gapRatio(counter.idle, baselineMs))),
    repeated: rounds.some((round) => round.repeated === true),
    disturbances,
    reconnects: all.reduce((sum, counter) => sum + counter.reconnects, 0),
  }
}

export function scenarioResult(engine: EngineKey, scenario: string, concurrency: number, roundTrips: number, rounds: readonly Measured[], baselineMs: number): ScenarioResult {
  const samples = rounds.flatMap((round) => round.block.samples)
  const seconds = rounds.reduce((sum, round) => sum + round.block.seconds, 0)
  const sum = (pick: (round: Measured) => number): number => rounds.reduce((total, round) => total + pick(round), 0)
  return {
    engine,
    scenario,
    concurrency,
    ...summarise(samples),
    rounds: rounds.map((round) => summarise(round.block.samples).p50),
    throughput: samples.length / seconds,
    roundTrips,
    rowsAnswered: rounds[rounds.length - 1]?.block.rowsAnswered ?? 0,
    serverCpuMsPerRequest: sum((round) => round.block.counters.serverCpuMs) / samples.length,
    databaseCpuMsPerRequest: sum((round) => round.block.counters.databaseCpuMs) / samples.length,
    databaseIdleCpuMsPerSecond: sum((round) => round.block.counters.idle.databaseCpuMs) / sum((round) => round.block.counters.idle.seconds),
    run: runFactsOf(rounds, baselineMs),
  }
}

export function latencyResult(
  engine: EngineKey,
  scenario: string,
  roundTrips: number,
  delayMs: number,
  rounds: ReadonlyArray<{ undelayed: Measured; delayed: Measured }>,
  baselineMs: number,
): LatencyResult {
  const entries = rounds.map(({ undelayed, delayed }) => {
    const before = summarise(undelayed.block.samples)
    const after = summarise(delayed.block.samples)
    return {
      undelayed: { n: before.n, p50: before.p50 },
      delayed: { n: after.n, p50: after.p50 },
      differenceMs: before.p50 === null || after.p50 === null ? null : after.p50 - before.p50,
    }
  })
  const differences = entries.map((entry) => entry.differenceMs)
  const differenceMs = middle(differences)
  const expectedMs = delayMs * roundTrips
  return {
    engine,
    scenario,
    roundTrips,
    rounds: entries,
    undelayedMs: middle(entries.map((entry) => entry.undelayed.p50)),
    delayedMs: middle(entries.map((entry) => entry.delayed.p50)),
    differenceMs,
    spreadMs: differenceMs === null ? null : Math.max(...(differences as number[])) - Math.min(...(differences as number[])),
    expectedMs,
    ratio: differenceMs === null || expectedMs === 0 ? null : differenceMs / expectedMs,
    run: runFactsOf(
      rounds.flatMap(({ undelayed, delayed }) => [undelayed, delayed]),
      baselineMs,
    ),
  }
}
