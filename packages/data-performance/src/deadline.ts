import type { Catalogue, EngineKey, Results } from './results.js'

/*
 * The default lookup deadline, derived from a measurement (0061): the
 * slowest timed answer to a request addressing a lookup route, across both
 * engines, every block and every form, rounded up to the millisecond, so no
 * lookup or resolve answer the measurement timed would have been refused.
 * Only timed samples are read: a block's warm-up, which opens the pool's
 * connections, is not, and neither is a create's or an update's membership
 * check, which the deadline also bounds. data-core's
 * DEFAULT_LOOKUP_DEADLINE_MS is held to it by deadline.test.ts.
 *
 * Node built-ins only, like render.ts, which prints the derivation; so the
 * catalogue is passed in, never imported.
 */

/** The runtime operations a lookup deadline bounds: the two lookup routes. */
const LOOKUP_OPERATIONS: ReadonlySet<string> = new Set(['lookup-query', 'lookup-resolve'])

/** The derived deadline, and the measured block it comes from. */
export interface DerivedDeadline {
  ms: number
  engine: EngineKey
  scenario: string
  concurrency: number
}

/**
 * The slowest lookup or resolve answer in `scenarios`, rounded up. Which
 * scenario is a lookup is the catalogue's `operation`, never its name;
 * a catalogue measured before 0061 names none, and is refused.
 */
export function lookupDeadlineFrom(scenarios: Results['scenarios'], catalogue: Catalogue): DerivedDeadline {
  const operations = new Map(catalogue.scenarios.map((entry) => [entry.name, entry.operation]))
  let slowest: Results['scenarios'][number] | undefined
  for (const entry of scenarios) {
    if (!operations.has(entry.scenario)) throw new Error(`the results hold ${entry.scenario}, which the catalogue does not name`)
    const operation = operations.get(entry.scenario)
    if (operation === undefined) throw new Error(`${entry.scenario} names no operation in this catalogue: it was measured before 0061`)
    if (operation === null || !LOOKUP_OPERATIONS.has(operation)) continue
    if (slowest === undefined || entry.max > slowest.max) slowest = entry
  }
  if (slowest === undefined) throw new Error('these results hold no lookup or resolve answer to derive a deadline from')
  return { ms: Math.ceil(slowest.max), engine: slowest.engine, scenario: slowest.scenario, concurrency: slowest.concurrency }
}
