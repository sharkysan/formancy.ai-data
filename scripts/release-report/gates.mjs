// The release gates (0035): docs/release/gates.json, the delivery plan's
// twelve by number, each with the evidence a run must pass or the reason it
// has none. The plan is a working document kept out of the repository, so the
// register carries no gate's wording: the report prints "gate N" with its
// evidence, and a key other than `gate`, `evidence` and `open` fails here.
//
// Evidence comes in five kinds:
//
//   { "file": "<repo-relative test file>" }   every test in it passed in this run
//   { "browserGate": "<app dir>" }             that app's browser gate, no failed check and no error
//   { "job": "<gates.yml job id>" }            that job's result in the report's needs is success
//   { "sharedCases": true }                    every shared case passed on every engine
//   { "document": "<committed file>" }         stated: shown with its last change, never as passed
//
// A gate is "passed" in a run when it has evidence other than documents and
// all of it passed; "stated" when its only evidence is documents; "open" when
// it has a reason instead; and "failed" otherwise, which fails the run. The
// report never says a gate is met.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const GATES_REGISTER = 'docs/release/gates.json'
export const KINDS = ['file', 'browserGate', 'job', 'sharedCases', 'document']
export const GATE_COUNT = 12

const TEST_FILE = /\.test\.tsx?$/
const KEYS = new Set(['gate', 'evidence', 'open'])

/** The register, parsed. */
export function readGates(root = repo) {
  return JSON.parse(readFileSync(join(root, GATES_REGISTER), 'utf8'))
}

/** An evidence item's kind and value, or undefined when it is not exactly one known kind. */
export function evidenceKind(item) {
  const keys = Object.keys(item ?? {})
  if (keys.length !== 1 || !KINDS.includes(keys[0])) return undefined
  return { kind: keys[0], value: item[keys[0]] }
}

/** Why one evidence item cannot be judged, or undefined when it can. */
function itemProblem({ kind, value }, { covered, browserApps, jobs, exists }) {
  if (kind === 'file') {
    const file = String(value)
    if (!TEST_FILE.test(file) || !covered.some((path) => file.startsWith(`${path}/`)) || !exists(file)) return `${file} is not a test file of a package with a suite`
  } else if (kind === 'browserGate') {
    if (!browserApps.includes(value)) return `${String(value)} is not an app with a test:browser script`
  } else if (kind === 'job') {
    if (!jobs.includes(value)) return `${String(value)} is not a job of .github/workflows/gates.yml that leaves results`
  } else if (kind === 'sharedCases') {
    if (value !== true) return 'sharedCases is true or absent'
  } else if (typeof value !== 'string' || !exists(value)) {
    return `${String(value)} is not a committed file`
  }
  return undefined
}

/**
 * What is wrong with `register`, as sentences. Pure: `covered` is the paths
 * of the packages with a test:coverage script, `browserApps` the paths of the
 * apps with a test:browser script, `jobs` the gates workflow's jobs that
 * leave results, and `exists(path)` whether a repository path is a file.
 */
export function gatesProblems(register, context) {
  const problems = []
  const gates = Array.isArray(register?.gates) ? register.gates : []
  const numbers = gates.map((entry) => entry?.gate)
  const wanted = Array.from({ length: GATE_COUNT }, (_, index) => index + 1)
  if (numbers.join() !== wanted.join()) problems.push(`the gates are ${numbers.join(', ') || 'none'}, where the plan numbers 1 to ${String(GATE_COUNT)}, each once and in order`)
  for (const entry of gates) {
    const at = `gate ${String(entry?.gate)}`
    for (const key of Object.keys(entry ?? {}).filter((name) => !KEYS.has(name))) {
      problems.push(`${at} carries "${key}", and a gate carries only its number, its evidence or why it is open: the plan's wording stays out of the repository`)
    }
    const evidence = Array.isArray(entry?.evidence) && entry.evidence.length > 0
    const open = typeof entry?.open === 'string' && entry.open.trim() !== ''
    if (evidence === open) problems.push(`${at} has ${evidence ? 'both evidence and a reason it is open' : 'neither evidence nor a reason it is open'}; it needs exactly one`)
    for (const item of evidence ? entry.evidence : []) {
      const known = evidenceKind(item)
      const problem = known === undefined ? `${JSON.stringify(item)} is not exactly one of ${KINDS.join(', ')}` : itemProblem(known, context)
      if (problem !== undefined) problems.push(`${at}'s evidence: ${problem}`)
    }
  }
  return problems
}

/** What a run says of one evidence item: passed, failed or absent; a document is stated, with its history. */
function outcomeOf({ kind, value }, run) {
  if (kind === 'file') return { outcome: run.fileOutcome(value) }
  if (kind === 'browserGate') {
    const ran = run.browserGates.filter((gate) => gate.gate === value)
    if (ran.length === 0) return { outcome: 'absent' }
    return { outcome: ran.every((gate) => gate.error === null && gate.failed.length === 0) ? 'passed' : 'failed' }
  }
  if (kind === 'job') {
    const result = run.needs?.[value]?.result
    return { outcome: result === undefined ? 'absent' : result === 'success' ? 'passed' : 'failed', ...(result === undefined ? {} : { result }) }
  }
  if (kind === 'sharedCases') return { outcome: run.sharedCasesPassed ? 'passed' : 'failed' }
  return { outcome: 'stated', history: run.documents?.[value] ?? null }
}

/**
 * Each gate as this run leaves it: `{ gate, state, evidence, open? }`, with
 * state `passed`, `failed`, `stated` or `open`. Pure. `run` gives
 * `fileOutcome(file)`, the run's `browserGates`, its `needs` (null locally),
 * whether `sharedCasesPassed`, and `documents`: each document's last change,
 * `{ sha, date, behind }`, or null when git has none.
 */
export function evaluateGates(register, run) {
  return (register?.gates ?? []).map((entry) => {
    if (typeof entry.open === 'string') return { gate: entry.gate, state: 'open', open: entry.open, evidence: [] }
    const evidence = (entry.evidence ?? []).map((item) => {
      const known = evidenceKind(item) ?? { kind: 'unknown', value: JSON.stringify(item) }
      return { ...known, ...(known.kind === 'unknown' ? { outcome: 'failed' } : outcomeOf(known, run)) }
    })
    const exercised = evidence.filter((item) => item.kind !== 'document')
    const state = exercised.length === 0 ? 'stated' : exercised.every((item) => item.outcome === 'passed') ? 'passed' : 'failed'
    return { gate: entry.gate, state, evidence }
  })
}
