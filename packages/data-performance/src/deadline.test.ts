import { readFileSync } from 'node:fs'
import { DEFAULT_LOOKUP_DEADLINE_MS } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { CATALOGUE } from './catalogue.js'
import { lookupDeadlineFrom } from './deadline.js'
import type { Catalogue, Results, ScenarioResult } from './results.js'

/*
 * The default lookup deadline is measured, not chosen (0061): the slowest
 * lookup or resolve answer the published figures hold, rounded up to the
 * millisecond, so no lookup or resolve answer the measurement timed would
 * have been refused.
 */

/** A scenario result with only what the derivation reads set apart from zero. */
function result(engine: 'pg' | 'ms', scenario: string, concurrency: number, max: number): ScenarioResult {
  return {
    engine,
    scenario,
    concurrency,
    max,
    n: 3000,
    p50: 1,
    p90: 1,
    p99: 1,
    mean: 1,
    rounds: [1],
    throughput: 1,
    roundTrips: 2,
    rowsAnswered: 1,
    serverCpuMsPerRequest: 0,
    databaseCpuMsPerRequest: 0,
    databaseIdleCpuMsPerSecond: 0,
    run: {} as ScenarioResult['run'],
  }
}

const scenario = (name: string, operation: string | null | undefined): Catalogue['scenarios'][number] => ({
  name,
  label: name,
  form: 'order',
  inFlight: 'all',
  latency: true,
  roundTrips: { pg: 2, ms: 2 },
  rowsRead: null,
  ...(operation === undefined ? {} : { operation }),
})

const catalogue = (entries: Catalogue['scenarios']): Catalogue => ({
  scenarios: entries,
  refusals: [],
  floor: { label: 'floor', roundTrips: { pg: 2, ms: 2 } },
})

describe('lookupDeadlineFrom', () => {
  // Only what a lookup route answers sets the deadline: a create is slower
  // than any search, and a deadline taken from it would let a scan run as
  // long as a write. Every engine and every in-flight level counts, because
  // a deadline that refused the slowest measured answer on either engine
  // would refuse what the figures say this machine serves. A fraction rounds
  // up, never down, for the same reason.
  test('is the slowest lookup or resolve answer, on either engine at any level, rounded up', () => {
    const entries = catalogue([
      scenario('lookup-absent', 'lookup-query'),
      scenario('resolve-100', 'lookup-resolve'),
      scenario('create', 'create'),
      scenario('health', null),
    ])
    const scenarios = [
      result('pg', 'lookup-absent', 1, 190.2),
      result('ms', 'lookup-absent', 8, 535.0001),
      result('ms', 'resolve-100', 1, 410),
      result('pg', 'create', 8, 9_000),
      result('ms', 'health', 8, 700),
    ]
    expect(lookupDeadlineFrom(scenarios, entries)).toEqual({ ms: 536, engine: 'ms', scenario: 'lookup-absent', concurrency: 8 })
    expect(lookupDeadlineFrom([...scenarios, result('pg', 'resolve-100', 8, 600)], entries)).toEqual({
      ms: 600,
      engine: 'pg',
      scenario: 'resolve-100',
      concurrency: 8,
    })
  })

  // A catalogue measured before 0061 names no operation, and a derivation
  // that guessed one from a scenario's name would rest on wording, which the
  // repository does not let a guard rest on. It refuses, naming the entry.
  test('refuses a catalogue that names no operation for a scenario the results hold', () => {
    expect(() => lookupDeadlineFrom([result('pg', 'lookup-absent', 1, 190)], catalogue([scenario('lookup-absent', undefined)]))).toThrow(
      /lookup-absent names no operation/,
    )
  })

  // A results set with no lookup in it has no slowest lookup; a deadline of
  // zero or minus infinity would refuse every search.
  test('refuses results that hold no lookup answer', () => {
    expect(() => lookupDeadlineFrom([result('pg', 'create', 1, 9)], catalogue([scenario('create', 'create')]))).toThrow(/no lookup or resolve answer/)
  })
})

describe('DEFAULT_LOOKUP_DEADLINE_MS', () => {
  // The default in data-core is what the committed figures derive, through
  // today's catalogue, which names each scenario's operation. Typed by hand,
  // it would be a chosen number in a measured place; left behind after a
  // re-measurement, it would describe a run nobody has any more. After
  // \`pnpm performance\`, this fails until the constant follows.
  test('is what docs/performance/results.json derives', () => {
    const results = JSON.parse(readFileSync(new URL('../../../docs/performance/results.json', import.meta.url), 'utf8')) as Results
    const derived = lookupDeadlineFrom(results.scenarios, CATALOGUE)
    expect(DEFAULT_LOOKUP_DEADLINE_MS, `derived from ${derived.engine} ${derived.scenario} at ${String(derived.concurrency)} in flight`).toBe(derived.ms)
  })
})
