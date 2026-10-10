import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { CATALOGUE } from './catalogue.js'
import { SMOKE_PROTOCOL } from './protocol.js'
import type { Results } from './results.js'
import { ENGINE_KEYS } from './results.js'
import { runMeasurement } from './run.js'
import { validateResults } from './validate.js'

/**
 * The whole harness, briefly, on both engines (0034): the shipped server as
 * a child, both fixtures with the sized customers, the eight forms published
 * through the administrator's plane and the two the refusals use, whose
 * table the owner then changes, the counting pass, the fixed costs, one
 * round at one and two in flight and the added-latency block -- with the
 * smoke protocol's handful of samples, on whatever machine runs it. It
 * proves the harness runs and checks what it says it checks; it never
 * asserts a time, and its result can never be published.
 *
 * One run, in `beforeAll`; each case reads its result. In containers of its
 * own, so no other suite sees the sized table.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url))
let runDir: string
let results: Results | undefined
let failure: unknown

beforeAll(async () => {
  runDir = mkdtempSync(join(tmpdir(), 'formancy-performance-'))
  try {
    results = await runMeasurement(SMOKE_PROTOCOL, { root, runDir, progress: (line) => console.log(`${new Date().toISOString()} ${line}`) })
  } catch (error) {
    failure = error
  }
})

afterAll(() => {
  rmSync(runDir, { recursive: true, force: true })
})

/** The run's result; a run that refused fails every case with its own sentence. */
function measured(): Results {
  if (results === undefined) throw failure instanceof Error ? failure : new Error(String(failure))
  return results
}

describe('the harness, run with the smoke protocol', () => {
  // Every content check passed, or the run would have ended naming the
  // scenario: both engines answered every lookup exactly as the generator
  // says, so their first pages are the same page. A page that drifted from
  // the generator would make every count a count of the wrong statement.
  test('runs every scenario on both engines, every answer checked', () => {
    const run = measured()
    for (const engine of ENGINE_KEYS) {
      const first = run.scenarios.find((entry) => entry.engine === engine && entry.scenario === 'lookup-first-page' && entry.concurrency === 1)
      expect(first?.rowsAnswered, engine).toBe(50)
      expect(run.scenarios.find((entry) => entry.engine === engine && entry.scenario === 'resolve-100' && entry.concurrency === 1)?.rowsAnswered, engine).toBe(100)
    }
  })

  // All eight forms publish through the administrator's plane, and the two
  // the refusals use: a proposal and a version each, every one an audit
  // event. The unfiltered form is a different policy, not the tenant form
  // with one rule removed, which the server refuses to publish.
  test('publishes the eight forms and the two the refusals use', () => {
    expect(measured().checks).toMatchObject({ adminRequests: 20, adminEvents: 20 })
  })

  // The counting pass ran through the hop before anything was timed and
  // would have refused on a difference; the result carries the counts.
  test("counts each scenario's round trips as the catalogue pins them, unfiltered forms and floor included", () => {
    const run = measured()
    for (const engine of ENGINE_KEYS) {
      for (const entry of CATALOGUE.scenarios) {
        for (const result of run.scenarios.filter((candidate) => candidate.engine === engine && candidate.scenario === entry.name)) expect(result.roundTrips, `${engine} ${entry.name}`).toBe(entry.roundTrips[engine])
      }
      expect(run.components.floor[engine].roundTrips, `${engine} floor`).toBe(CATALOGUE.floor.roundTrips[engine])
    }
  })

  // A write drift review stops (0041) is answered 409 drift and sends the
  // database nothing past the description it was decided over: a create
  // its one describe, an update the read it makes anyway. Counted through the
  // hop like every scenario, never timed.
  test('counts each refusal as the catalogue pins it, answered as the catalogue says', () => {
    const run = measured()
    expect(run.refusals).toEqual(
      ENGINE_KEYS.flatMap((engine) => CATALOGUE.refusals.map((entry) => ({ engine, scenario: entry.name, roundTrips: entry.roundTrips[engine], status: entry.answer.status, code: entry.answer.code }))),
    )
  })

  // One customer for every create would measure PostgreSQL's foreign-key
  // lock on that row, written into it by every insert, not the product.
  test('creates orders for more than one customer', () => {
    for (const engine of ENGINE_KEYS) expect(measured().checks.createdCustomers[engine], engine).toBeGreaterThan(1)
  })

  // The server's own trail holds one runtime event for every runtime
  // request the harness sent -- setup, warm-up, counting and measured -- by
  // operation, form and status: nothing was sent that the server did not
  // see, and nothing was seen that the harness did not count.
  test("reconciles every runtime request with the server's audit trail", () => {
    const run = measured()
    expect(run.checks.runtimeEvents).toEqual(run.checks.requests)
    expect(run.checks.requests.reduce((sum, row) => sum + row.count, 0)).toBeGreaterThan(0)
    expect(run.checks.errorLines).toBe(0)
  })

  // Every block is judged by the probe in the idle gaps around it, and the
  // database's CPU in those gaps is recorded beside its CPU per request: a
  // block whose gaps were never taken would be judged by nothing, and its
  // CPU per request would carry the engine's own work with nothing to say how
  // much.
  test("reads the probe and the database's idle CPU in the gaps around every block", () => {
    for (const entry of measured().scenarios) {
      const name = `${entry.engine} ${entry.scenario} at ${String(entry.concurrency)}`
      expect(entry.run.calibrationRatio, name).toBeGreaterThan(0)
      expect(entry.databaseIdleCpuMsPerSecond, name).toBeGreaterThanOrEqual(0)
    }
  })

  // A smoke result proves the harness runs; published, it would be noise.
  test('validates as a smoke result and is refused as a published one', () => {
    expect(validateResults(measured(), { published: false })).toEqual({ ok: true })
    const published = validateResults(measured(), { published: true })
    expect(published.ok).toBe(false)
    expect(published.ok ? [] : published.problems).toContain('protocol.name: smoke, where a published result is measured with the publish protocol')
  })
})
