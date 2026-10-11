import { describe, expect, test } from 'vitest'
import { SMOKE_PROTOCOL } from './protocol.js'
import type { Results } from './results.js'
import { publishedResults } from './test-results.js'
import { validateResults } from './validate.js'

/** The problems a changed copy of the published fixture is refused with. */
function problems(change: (results: Results) => void, published = true): string[] {
  const results = structuredClone(publishedResults())
  change(results)
  const outcome = validateResults(results, { published })
  return outcome.ok ? [] : outcome.problems
}

describe('a published result', () => {
  // The fixture every refusal below is a single change of: if it did not
  // pass, every refusal would pass for the wrong reason.
  test('passes as it was measured', () => {
    expect(validateResults(publishedResults(), { published: true })).toEqual({ ok: true })
  })

  // A smoke run proves the harness runs, on five samples and a busy machine.
  // Committed as the page's figures, it would publish noise as a measurement.
  test('refuses the smoke protocol', () => {
    expect(problems((r) => (r.protocol = { ...SMOKE_PROTOCOL }))).toContain('protocol.name: smoke, where a published result is measured with the publish protocol')
  })

  // A block the catalogue names and the run never measured would leave a
  // row of the page blank, or worse, filled from elsewhere.
  test('refuses a missing engine, scenario and in-flight block, naming it', () => {
    expect(problems((r) => (r.scenarios = r.scenarios.filter((s) => !(s.engine === 'ms' && s.scenario === 'create' && s.concurrency === 8))))).toContain(
      'scenarios: no ms create at 8 in flight, which the catalogue names',
    )
  })

  // And a block measured twice, or one no catalogue entry names.
  test('refuses a block twice or one the catalogue does not name', () => {
    expect(problems((r) => r.scenarios.push({ ...(r.scenarios[0] as Results['scenarios'][number]) }))).toContain('scenarios[52]: pg health at 1 in flight, a second time')
    expect(problems((r) => r.scenarios.push({ ...(r.scenarios[0] as Results['scenarios'][number]), scenario: 'export' }))).toContain('scenarios[52]: pg export at 1 in flight, which the catalogue does not name')
  })

  // Percentiles of one sample set never decrease; a p90 below the p50 is a
  // summary computed from two different sets, or edited by hand.
  test('refuses a p90 below its p50', () => {
    expect(problems((r) => ((r.scenarios[3] as Results['scenarios'][number]).p90 = 0.5))).toContain('scenarios[3].p90: 0.5 is below p50')
  })

  // The pins are what explains the figures. A result whose counted round
  // trips differ from its own catalogue was measured against something else.
  test('refuses counted round trips that differ from the pins', () => {
    expect(problems((r) => ((r.scenarios[4] as Results['scenarios'][number]).roundTrips = 4))).toContain('scenarios[4].roundTrips: counted 4, the catalogue pins 2')
    expect(problems((r) => (r.components.floor.ms.roundTrips = 3))).toContain('components.floor.ms.roundTrips: counted 3, the catalogue pins 2')
  })

  // A refusal is counted and never timed: what a write the runtime stops
  // still asks the database (0041). One the run never counted would leave
  // its row blank, one counted twice or under another name was not this
  // catalogue's, and one counted against other pins was measured against
  // something else.
  test('refuses a refusal missing, twice, unnamed, or counted against other pins', () => {
    const first = (r: Results): Results['refusals'][number] => r.refusals[0] as Results['refusals'][number]
    expect(problems((r) => (r.refusals = r.refusals.filter((entry) => !(entry.engine === 'ms' && entry.scenario === 'update-drifted'))))).toContain(
      'refusals: no ms update-drifted, which the catalogue names',
    )
    expect(problems((r) => r.refusals.push({ ...first(r) }))).toContain('refusals[4]: pg create-drifted, a second time')
    expect(problems((r) => r.refusals.push({ ...first(r), scenario: 'delete-drifted' }))).toContain('refusals[4]: pg delete-drifted, which the catalogue does not name')
    expect(problems((r) => ((r.refusals[1] as Results['refusals'][number]).roundTrips = 4))).toContain('refusals[1].roundTrips: counted 4, the catalogue pins 2')
  })

  // The answer is half of what a refusal shows: a stopped write answered
  // anything but the catalogue's refusal reached the database, or was
  // refused for some other reason, and its count is of another path.
  test('refuses a refusal answered otherwise than the catalogue says', () => {
    expect(problems((r) => Object.assign(r.refusals[0] as Results['refusals'][number], { status: 201, code: 'created' }))).toContain(
      'refusals[0]: pg create-drifted answered 201 created, where the catalogue says 409 drift',
    )
  })

  // "On what" is half the claim: a figure with no machine is not publishable.
  test('refuses an empty machine field', () => {
    expect(problems((r) => (r.machine.cpu.model = ''))).toContain('machine.cpu.model: empty')
    expect(problems((r) => (r.machine.os.kernel = ' '))).toContain('machine.os.kernel: empty')
  })

  // A hypervisor that reports no steal since boot has said nothing; a 0
  // printed for it would claim the host took nothing away.
  test('refuses a steal of 0 where steal was not reported', () => {
    expect(problems((r) => ((r.scenarios[0] as Results['scenarios'][number]).run = { ...(r.scenarios[0] as Results['scenarios'][number]).run, steal: 0 }))).toContain(
      'scenarios[0].run.steal: 0, where this hypervisor reports no steal',
    )
  })

  // The round's client token is minted per run and never written down; one
  // in the committed file would be a credential in the repository.
  test('refuses a string that looks like a token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjbGVyay0xIn0.c2lnbmF0dXJlLWJ5dGVz'
    expect(problems((r) => (r.server.settings = [...r.server.settings, jwt]))).toContain('server.settings[2]: looks like a token')
  })

  // The proxy settings are recorded with their credentials cut, and the page
  // prints each one. A value that still has a user's `@` in it reached the
  // file past that cut; the validator is the second line, not the first.
  test('refuses a proxy setting that still carries a user', () => {
    expect(problems((r) => (r.network.client.proxy = { ...r.network.client.proxy, HTTPS_PROXY: 'alice:s3cret@proxy.example:3128' }))).toContain(
      'network.client.proxy.HTTPS_PROXY: carries a user and perhaps a password',
    )
  })

  // The hop is there to add D to every answer and nothing else. Undelayed, a
  // request through it that took more than D longer than the same request
  // direct was measuring the hop -- Nagle's algorithm did that, 92 ms against
  // 13.7 -- and the difference beside it is not what the page says it is.
  test('refuses a hop that, undelayed, added more than the delay it is there to add', () => {
    const outcome = problems((r) => {
      const entry = r.latency.find((candidate) => candidate.engine === 'ms' && candidate.scenario === 'resolve-100')
      const direct = r.scenarios.find((candidate) => candidate.engine === 'ms' && candidate.scenario === 'resolve-100' && candidate.concurrency === 1)
      if (entry === undefined || direct === undefined) throw new Error('no resolve-100')
      entry.undelayedMs = (direct.p50 as number) + r.protocol.latency.delayMs + 0.5
    })
    expect(outcome.filter((problem) => problem.includes('through the hop'))).toHaveLength(1)
    expect(outcome.find((problem) => problem.includes('through the hop'))).toMatch(/^latency\[\d+\]\.undelayedMs: ms resolve-100 took .* through the hop undelayed and .* direct, more than the 5 ms it adds/)
  })

  // A run that started beside another container measured that container too.
  test('refuses containers running before the run', () => {
    expect(problems((r) => (r.machine.quiet.containersBefore = ['demo-postgres']))).toContain('machine.quiet.containersBefore: demo-postgres was running before the run started')
  })

  // The audit reconciliation is a check the run makes on itself: every
  // request it sent is an event in the server's log. A difference means
  // requests the harness did not count, or events the server did not write.
  test('refuses runtime events that differ from requests', () => {
    expect(problems((r) => ((r.checks.runtimeEvents[1] as Results['checks']['runtimeEvents'][number]).count = 24_439))).toContain(
      'checks.runtimeEvents: lookup-query pg-order 200 is 24439 events for 24440 requests',
    )
  })

  // Without P13's tolerance the calibration repeated nothing and refused
  // nothing, so a block the host slowed down would be published.
  test('refuses a missing calibration tolerance', () => {
    expect(problems((r) => (r.protocol.calibration = { ...r.protocol.calibration, tolerance: null }))).toContain('protocol.calibration.tolerance: none, which P13 sets before a publish run')
  })

  // Rendering trusts the shape; a field of the wrong type is named before it can print as "undefined".
  test('refuses a field of the wrong type, naming its path', () => {
    expect(problems((r) => ((r.engines.pg as unknown as Record<string, unknown>)['memoryBytes'] = '300MB'))).toContain('engines.pg.memoryBytes: expected a number')
    expect(problems((r) => delete (r as unknown as Record<string, unknown>)['commit'])).toContain('commit: expected a string')
  })
})

describe('a smoke result', () => {
  // The harness test's own check: the same structure, pins and
  // reconciliation, without the quiet machine or the tolerance.
  test('validates in smoke mode and is refused as published', () => {
    const smoke = structuredClone(publishedResults())
    smoke.protocol = { ...SMOKE_PROTOCOL }
    smoke.machine.quiet = { ...smoke.machine.quiet, enforced: false, containersBefore: ['demo-postgres'] }
    smoke.scenarios = smoke.scenarios.filter((s) => s.concurrency !== 8).concat(smoke.scenarios.filter((s) => s.concurrency === 8).map((s) => ({ ...s, concurrency: 2 })))
    smoke.latency = smoke.latency.map((entry) => ({ ...entry, rounds: entry.rounds.slice(0, 1) }))
    expect(validateResults(smoke, { published: false })).toEqual({ ok: true })
    const refused = validateResults(smoke, { published: true })
    expect(refused.ok).toBe(false)
  })
})
