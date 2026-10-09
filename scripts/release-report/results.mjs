// The report's results (0035): each package's suite, the repository's guards,
// the browser, install and container gates, the build identity of every
// published package, and what the gates measured on the way.
//
// Pure over the run's results. Two times are shown for a suite, each named
// for what it is: the task's wall time from turbo's run summary, and vitest's
// span from the first test's start to the last test's end, which leaves out
// container starts, hooks and teardown.

import { serversOf } from './versions.mjs'

const distinct = (values) => [...new Set(values)]

/** A test's status, as the report counts it: anything but passed or failed is skipped, as vitest's pending and todo are. */
const kind = (status) => (status === 'passed' || status === 'failed' ? status : status === 'todo' ? 'todo' : 'skipped')

/** One row per package with a `test:coverage` script, or per suite of `path` for the repository's guards. */
function suiteRow(suites, servers, { name, path, published }) {
  if (suites.length === 0) return { package: name, path, published, present: false }
  const files = suites.flatMap((suite) => suite.files)
  const tests = files.flatMap((file) => file.tests.map((test) => ({ ...test, file: file.file })))
  const count = (wanted) => tests.filter((test) => kind(test.status) === wanted).length
  const tasks = suites.map((suite) => suite.task).filter((task) => task != null && task.endTime != null)
  const starts = files.map((file) => file.startTime).filter(Number.isFinite)
  const ends = files.map((file) => file.endTime).filter(Number.isFinite)
  const coverage = suites.find((suite) => suite.coverage != null)?.coverage ?? null
  const pct = (metric) => (coverage?.[metric]?.pct === undefined ? null : coverage[metric].pct)
  return {
    package: name,
    path,
    published,
    present: true,
    jobs: distinct(suites.map((suite) => suite.job)),
    files: files.length,
    tests: tests.length,
    passed: count('passed'),
    failed: count('failed'),
    skipped: count('skipped'),
    todo: count('todo'),
    notPassed: tests.filter((test) => test.status !== 'passed').map((test) => ({ file: test.file, name: test.name, status: test.status })),
    failedFiles: files.filter((file) => file.status === 'failed').map((file) => ({ file: file.file, testsPassed: file.tests.every((test) => test.status === 'passed') })),
    success: suites.every((suite) => suite.success === true),
    numFailedTestSuites: suites.reduce((total, suite) => total + (suite.numFailedTestSuites ?? 0), 0),
    wallMs: tasks.length === 0 ? null : tasks.reduce((total, task) => total + (task.endTime - task.startTime), 0),
    spanMs: starts.length === 0 || ends.length === 0 ? null : Math.max(...ends) - Math.min(...starts),
    engines: distinct(servers.filter((server) => server.package === name && server.package !== null).map((server) => server.engine)).sort(),
    coverage: coverage === null ? null : { lines: pct('lines'), branches: pct('branches'), functions: pct('functions'), statements: pct('statements') },
  }
}

/** The suites of the run, each with the key of the results file it came in. */
const suitesOf = (results) => results.flatMap((result) => (result.suites ?? []).map((suite) => ({ ...suite, job: result.key })))

/** Every package's row, the repository's guards, the three gates, build identity and the observations. */
export function resultsInRun({ results, covered, published }) {
  const suites = suitesOf(results)
  const servers = serversOf(results)
  const gates = results.flatMap((result) => (result.browserGates ?? []).map((gate) => ({ ...gate, job: result.key, runner: result.runner ?? null })))
  const install = results.map((result) => result.install).find((entry) => entry != null) ?? null
  const container = results.map((result) => result.container).find((entry) => entry != null) ?? null
  return {
    packages: covered.map((entry) => suiteRow(suites.filter((suite) => suite.package === entry.name), servers, { ...entry, published: published.includes(entry.name) })),
    repository: suiteRow(suites.filter((suite) => suite.package === null), servers, { name: null, path: '.', published: false }),
    browserGates: gates.map((gate) => ({
      gate: gate.gate,
      job: gate.job,
      ok: gate.checks?.ok ?? 0,
      failed: gate.checks?.failed ?? [],
      error: gate.error ?? null,
      widths: gate.widths ?? [],
      passes: gate.passes ?? 0,
      browser: gate.browser ?? null,
      axe: gate.axe ?? null,
      wallMs: Date.parse(gate.finishedAt) - Date.parse(gate.startedAt),
      engines: distinct(servers.filter((server) => server.package === gate.gate).map((server) => server.engine)).sort(),
    })),
    install:
      install === null
        ? null
        : { passed: install.passed === true, error: install.error ?? null, node: install.node, npm: install.npm, resolved: install.resolved ?? [], tarballs: install.tarballs ?? [] },
    container,
    missing: results.flatMap((result) => (result.missing ?? []).map((what) => ({ job: result.key, what }))),
    buildIdentity: published.map((name) => {
      const builds = results.flatMap((result) => (result.dist ?? []).filter((entry) => entry.package === name).map((entry) => ({ job: result.key, distHash: entry.distHash })))
      const tarball = (install?.tarballs ?? []).find((entry) => entry.name === name) ?? null
      const hashes = distinct([...builds.map((build) => build.distHash), ...(tarball === null ? [] : [tarball.distHash])])
      return { package: name, tarball: tarball === null ? null : { file: tarball.file, sha256: tarball.sha256, distHash: tarball.distHash }, builds, identical: hashes.length <= 1 }
    }),
    observations: observationsOf(gates),
  }
}

/** Every measurement a gate recorded, grouped by gate, name and unit, with each value and the runner it was taken on. */
function observationsOf(gates) {
  const groups = new Map()
  for (const gate of gates) {
    for (const measurement of gate.measurements ?? []) {
      const key = `${gate.gate}\0${measurement.name}\0${measurement.unit}`
      const runner = gate.runner?.image == null ? gate.runner?.platform ?? null : `${gate.runner.image} ${gate.runner.imageVersion ?? ''}`.trim()
      const group = groups.get(key) ?? { gate: gate.gate, name: measurement.name, unit: measurement.unit, values: [], passes: gate.passes ?? 0, runner }
      group.values.push(measurement.value)
      groups.set(key, group)
    }
  }
  return [...groups.values()]
}

/**
 * What the run says of one test file: `passed` when it appears with at least
 * one test, every test passed and the file passed; `absent` when it does not
 * appear; `failed` otherwise. How a gate's file evidence and a limitation's
 * `heldBy` are judged.
 */
export function fileOutcome(results, file) {
  const found = results.flatMap((result) => (result.suites ?? []).flatMap((suite) => suite.files.filter((entry) => entry.file === file)))
  if (found.length === 0) return 'absent'
  const passed = found.every((entry) => entry.status === 'passed' && entry.tests.length > 0 && entry.tests.every((test) => test.status === 'passed'))
  return passed ? 'passed' : 'failed'
}
