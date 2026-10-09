import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { coveredPackages } from '../codecov-config.mjs'
import { evaluateGates, gatesProblems, readGates } from './gates.mjs'
import { workspace } from './tested-on.mjs'
import { gateJobs, readWorkflow } from './workflows.mjs'

/**
 * The release gates' register (0035), docs/release/gates.json: held to the
 * repository -- every file a test of a package with a suite, every browser
 * gate an app's, every job one gates.yml runs, every document committed -- and
 * the evaluator that says where a run leaves each gate, which never calls a
 * document passed.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const here = {
  covered: coveredPackages(repo).map((entry) => entry.path),
  browserApps: workspace(repo)
    .filter(({ dir, manifest }) => dir.startsWith('apps/') && manifest.scripts?.['test:browser'] !== undefined)
    .map(({ dir }) => dir),
  jobs: gateJobs(readWorkflow(repo)),
  exists: (path) => existsSync(join(repo, path)),
}

/** The real register with `change` applied to a copy, validated against this repository. */
function problemsWith(change) {
  const register = structuredClone(readGates(repo))
  change(register.gates)
  return gatesProblems(register, here)
}

const gate = (gates, number) => gates.find((entry) => entry.gate === number)

describe('docs/release/gates.json', () => {
  // A validator that only ever saw fixtures proves nothing about the
  // committed file, and the report fails a run whose register does not hold.
  test('holds against this repository', () => {
    expect(gatesProblems(readGates(repo), here)).toEqual([])
  })

  // The plan numbers twelve gates; a gate dropped from the register is one
  // the report never shows as open, stated or passed.
  test('fails without one of the twelve, or with them out of order', () => {
    expect(problemsWith((gates) => gates.splice(6, 1))).toEqual(['the gates are 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, where the plan numbers 1 to 12, each once and in order'])
    expect(problemsWith((gates) => gates.reverse())[0]).toMatch(/^the gates are 12, 11, /)
  })

  // A gate with evidence and a reason it is open is two answers to one
  // question, and the report would print one of them.
  test('fails a gate with both evidence and a reason it is open, or with neither', () => {
    expect(problemsWith((gates) => (gate(gates, 8).evidence = [{ sharedCases: true }]))).toEqual(['gate 8 has both evidence and a reason it is open; it needs exactly one'])
    expect(problemsWith((gates) => delete gate(gates, 12).open)).toEqual(['gate 12 has neither evidence nor a reason it is open; it needs exactly one'])
  })

  // A file renamed, or one outside a package with a suite, would be evidence
  // no run can ever pass -- or one that never runs at all.
  test('fails file evidence that is not a test of a package with a suite', () => {
    const renamed = (gates) => (gate(gates, 2).evidence = gate(gates, 2).evidence.map((item) => (item.file === 'apps/host/src/in-flight.test.tsx' ? { file: 'apps/host/src/in-flite.test.tsx' } : item)))
    expect(problemsWith(renamed)).toEqual(["gate 2's evidence: apps/host/src/in-flite.test.tsx is not a test file of a package with a suite"])
    expect(problemsWith((gates) => gate(gates, 3).evidence.push({ file: 'scripts/check-cla.test.mjs' }))).toEqual(["gate 3's evidence: scripts/check-cla.test.mjs is not a test file of a package with a suite"])
  })

  // Each other kind names something a run can produce, or a committed file.
  test('fails a browser gate, a job or a document that is not there, and an unknown kind', () => {
    expect(problemsWith((gates) => gate(gates, 2).evidence.push({ browserGate: 'apps/nowhere' }))).toEqual(["gate 2's evidence: apps/nowhere is not an app with a test:browser script"])
    expect(problemsWith((gates) => (gate(gates, 9).evidence = [{ job: 'report' }]))).toEqual(["gate 9's evidence: report is not a job of .github/workflows/gates.yml that leaves results"])
    expect(problemsWith((gates) => gate(gates, 7).evidence.push({ document: 'docs/release/figures.md' }))).toEqual(["gate 7's evidence: docs/release/figures.md is not a committed file"])
    expect(problemsWith((gates) => gate(gates, 7).evidence.push({ file: 'a.test.ts', job: 'verify' }))).toEqual([`gate 7's evidence: {"file":"a.test.ts","job":"verify"} is not exactly one of file, browserGate, job, sharedCases, document`])
  })

  // The plan is a working document kept out of the repository; a gate's
  // wording copied into the register would publish it.
  test('carries no gate’s wording', () => {
    expect(problemsWith((gates) => (gate(gates, 1).says = 'Both adapters pass.'))).toEqual([
      'gate 1 carries "says", and a gate carries only its number, its evidence or why it is open: the plan\'s wording stays out of the repository',
    ])
  })
})

describe('evaluateGates', () => {
  const run = (overrides = {}) => ({ fileOutcome: () => 'passed', browserGates: [], needs: { 'getting-started': { result: 'success' } }, sharedCasesPassed: true, documents: {}, ...overrides })
  const history = { sha: 'abcdef1234567890abcdef1234567890abcdef12', date: '2026-10-01T10:00:00Z', behind: 4 }

  // A figures file from another commit read as "passed in this run" would be
  // a measurement the run never made, reported as if it had (0034).
  test('gives a gate whose only evidence is a document the state stated, never passed', () => {
    const [stated] = evaluateGates({ gates: [{ gate: 11, evidence: [{ document: 'docs/release/figures.md' }] }] }, run({ documents: { 'docs/release/figures.md': history } }))
    expect(stated).toEqual({ gate: 11, state: 'stated', evidence: [{ kind: 'document', value: 'docs/release/figures.md', outcome: 'stated', history }] })
  })

  // Evidence that ran and passed passes the gate; one item that did not
  // fails it, and a document beside them neither helps nor hurts.
  test('passes a gate only when every item that runs passed', () => {
    const register = { gates: [{ gate: 9, evidence: [{ job: 'getting-started' }, { document: 'docs/getting-started.md' }] }, { gate: 1, evidence: [{ sharedCases: true }, { file: 'a.test.ts' }] }] }
    expect(evaluateGates(register, run()).map((entry) => entry.state)).toEqual(['passed', 'passed'])
    expect(evaluateGates(register, run({ needs: { 'getting-started': { result: 'failure' } } }))[0].evidence[0]).toEqual({ kind: 'job', value: 'getting-started', outcome: 'failed', result: 'failure' })
    expect(evaluateGates(register, run({ sharedCasesPassed: false })).map((entry) => entry.state)).toEqual(['passed', 'failed'])
    expect(evaluateGates(register, run({ fileOutcome: () => 'absent' }))[1].evidence[1]).toEqual({ kind: 'file', value: 'a.test.ts', outcome: 'absent' })
  })

  // Locally there are no needs: a job's evidence did not run, which is not a pass.
  test('leaves a job unpassed where there are no needs, and a gate with a reason open', () => {
    const [nine, eight] = evaluateGates({ gates: [{ gate: 9, evidence: [{ job: 'getting-started' }] }, { gate: 8, open: 'Nothing to test.' }] }, run({ needs: null }))
    expect(nine.state).toBe('failed')
    expect(nine.evidence[0].outcome).toBe('absent')
    expect(eight).toEqual({ gate: 8, state: 'open', open: 'Nothing to test.', evidence: [] })
  })

  // A browser gate passes only when it ran, without an error and without a failed check.
  test('judges a browser gate by its checks and its error', () => {
    const register = { gates: [{ gate: 2, evidence: [{ browserGate: 'apps/host' }] }] }
    const green = { gate: 'apps/host', error: null, failed: [] }
    expect(evaluateGates(register, run({ browserGates: [green] }))[0].state).toBe('passed')
    expect(evaluateGates(register, run({ browserGates: [{ ...green, failed: ['contrast'] }] }))[0].state).toBe('failed')
    expect(evaluateGates(register, run({ browserGates: [{ ...green, error: 'timeout' }] }))[0].state).toBe('failed')
    expect(evaluateGates(register, run())[0].evidence[0].outcome).toBe('absent')
  })
})
