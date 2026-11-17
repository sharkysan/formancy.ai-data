// The report's results (0035): each package's suite, the repository's guards,
// the browser gates in each browser, the install and container gates, the
// build identity of every published package, and what the gates measured on
// the way, per browser.
//
// Pure over the run's results. A package's suite has a row per leg it ran
// in: the `test` job's, on the default images, and one per image of the
// matrix the `test-images` job ran it on (0067), so no test is counted
// twice in a row and no two legs' wall times, which ran side by side, are
// added. A suite the `test` job runs in shards is one row of all of them
// (0164): each file and test once, its times the longest shard's, since the
// shards ran side by side too, and no coverage, since each shard's counts
// only the lines its own files reached and totals do not add up to a union.
// Two times are shown for a suite, each named for what it is: the task's
// wall time from turbo's run summary, and vitest's span from the first
// test's start to the last test's end, which leaves out container starts,
// hooks and teardown.

import { serversOf } from './versions.mjs'

const distinct = (values) => [...new Set(values)]

/** A test's status, as the report counts it: anything but passed or failed is skipped, as vitest's pending and todo are. */
const kind = (status) => (status === 'passed' || status === 'failed' ? status : status === 'todo' ? 'todo' : 'skipped')

/** A suite's span, from its first file's start to its last file's end; null when no file says. */
function spanOf(suite) {
  const starts = suite.files.map((file) => file.startTime).filter(Number.isFinite)
  const ends = suite.files.map((file) => file.endTime).filter(Number.isFinite)
  return starts.length === 0 || ends.length === 0 ? null : Math.max(...ends) - Math.min(...starts)
}

/**
 * A suite's shards as the report holds them (0164), or null for a suite no
 * leg ran in shards: each leg as `<index>/<count>`, or `whole` for one that
 * ran it all; whether those are anything but 1/N to N/N, each once; the
 * shards of that count no leg left results of; and each file of the suite
 * -- every one its legs listed as vitest resolves them -- that no shard
 * ran, or that more than one did.
 *
 * The list is held too, since every file is held to it: a file a leg ran
 * that no list names, which a list shorter than the run's would leave
 * unheld; a list given that names no file while a leg ran some, which
 * would hold nothing; and each file one shard's list names and another's
 * does not, lists vitest may have divided two ways. A leg that wrote no
 * list is in the run's `missing` already, which fails it, and its null is
 * compared with nothing.
 */
function shardsOf(suites) {
  if (suites.every((suite) => suite.shard == null)) return null
  const legs = suites.map((suite) => (suite.shard == null ? 'whole' : `${String(suite.shard.index)}/${String(suite.shard.count)}`))
  const counts = distinct(suites.filter((suite) => suite.shard != null).map((suite) => suite.shard.count))
  const all = counts.length === 1 ? Array.from({ length: counts[0] }, (_, at) => `${String(at + 1)}/${String(counts[0])}`) : []
  const ran = new Map()
  suites.forEach((suite, at) => {
    for (const file of suite.files) ran.set(file.file, [...(ran.get(file.file) ?? []), legs[at]])
  })
  const lists = suites.flatMap((suite, at) => (suite.shard?.suiteFiles == null ? [] : [{ leg: legs[at], files: distinct(suite.shard.suiteFiles).sort() }]))
  const listed = distinct(lists.flatMap((entry) => entry.files)).sort()
  const empty = lists.length > 0 && listed.length === 0 && ran.size > 0
  return {
    legs: [...legs].sort(),
    mixed: legs.includes('whole') || counts.length !== 1 || distinct(legs).length !== legs.length,
    absent: all.filter((leg) => !legs.includes(leg)),
    unrun: listed.filter((file) => !ran.has(file)),
    twice: [...ran].filter(([, by]) => by.length > 1).map(([file, by]) => ({ file, by: [...by].sort() })),
    empty,
    unlisted: empty ? [] : [...ran.keys()].filter((file) => !listed.includes(file)).sort(),
    differing: listed
      .filter((file) => lists.some((entry) => !entry.files.includes(file)))
      .map((file) => ({
        file,
        by: lists
          .filter((entry) => entry.files.includes(file))
          .map((entry) => entry.leg)
          .sort(),
      })),
  }
}

/**
 * One row per package with a `test:coverage` script and leg -- `image` null
 * for the default leg -- or per suite of `path` for the repository's guards.
 */
function suiteRow(suites, servers, { name, path, published, image = null }) {
  if (suites.length === 0) return { package: name, path, published, image, present: false }
  const jobs = distinct(suites.map((suite) => suite.job))
  const files = suites.flatMap((suite) => suite.files)
  const tests = files.flatMap((file) => file.tests.map((test) => ({ ...test, file: file.file })))
  const count = (wanted) => tests.filter((test) => kind(test.status) === wanted).length
  const tasks = suites.map((suite) => suite.task).filter((task) => task != null && task.endTime != null)
  const spans = suites.map(spanOf).filter((span) => span !== null)
  const shards = shardsOf(suites)
  const coverage = shards === null ? (suites.find((suite) => suite.coverage != null)?.coverage ?? null) : null
  const pct = (metric) => (coverage?.[metric]?.pct === undefined ? null : coverage[metric].pct)
  return {
    package: name,
    path,
    published,
    image,
    present: true,
    jobs,
    files: files.length,
    tests: tests.length,
    passed: count('passed'),
    failed: count('failed'),
    skipped: count('skipped'),
    todo: count('todo'),
    notPassed: tests.filter((test) => test.status !== 'passed').map((test) => ({ file: test.file, name: test.name, status: test.status })),
    failedFiles: files
      .filter((file) => file.status === 'failed')
      .map((file) => ({ file: file.file, testsPassed: file.tests.every((test) => test.status === 'passed') })),
    success: suites.every((suite) => suite.success === true),
    numFailedTestSuites: suites.reduce((total, suite) => total + (suite.numFailedTestSuites ?? 0), 0),
    wallMs: tasks.length === 0 ? null : Math.max(...tasks.map((task) => task.endTime - task.startTime)),
    spanMs: spans.length === 0 ? null : Math.max(...spans),
    shards,
    engines: distinct(
      servers.filter((server) => server.package === name && server.package !== null && jobs.includes(server.job)).map((server) => server.engine),
    ).sort(),
    coverage: coverage === null ? null : { lines: pct('lines'), branches: pct('branches'), functions: pct('functions'), statements: pct('statements') },
  }
}

/** The suites of the run, each with the key of the results file it came in, for an image leg its image, and for a shard its shard. */
const suitesOf = (results) =>
  results.flatMap((result) =>
    (result.suites ?? []).map((suite) => ({
      ...suite,
      job: result.key,
      image: result.job === 'test-images' ? (result.variant ?? null) : null,
      shard: result.shard ?? null,
    })),
  )

/** A package's rows: its default leg, present or not, then each image leg it ran in. */
function packageRows(suites, servers, entry) {
  const own = suites.filter((suite) => suite.package === entry.name)
  const images = distinct(own.map((suite) => suite.image).filter((image) => image !== null))
  return [
    suiteRow(
      own.filter((suite) => suite.image === null),
      servers,
      entry,
    ),
    ...images.map((image) =>
      suiteRow(
        own.filter((suite) => suite.image === image),
        servers,
        { ...entry, image },
      ),
    ),
  ]
}

/** Every package's row, the repository's guards, the three gates, build identity and the observations. */
export function resultsInRun({ results, covered, published }) {
  const suites = suitesOf(results)
  const servers = serversOf(results)
  const gates = results.flatMap((result) => (result.browserGates ?? []).map((gate) => ({ ...gate, job: result.key, runner: result.runner ?? null })))
  const install = results.map((result) => result.install).find((entry) => entry != null) ?? null
  const container = results.map((result) => result.container).find((entry) => entry != null) ?? null
  return {
    packages: covered.flatMap((entry) => packageRows(suites, servers, { ...entry, published: published.includes(entry.name) })),
    repository: suiteRow(
      suites.filter((suite) => suite.package === null),
      servers,
      { name: null, path: '.', published: false },
    ),
    browserGates: gates.map((gate) => ({
      gate: gate.gate,
      asked: gate.asked ?? null,
      job: gate.job,
      ok: gate.checks?.ok ?? 0,
      failed: gate.checks?.failed ?? [],
      error: gate.error ?? null,
      widths: gate.widths ?? [],
      passes: gate.passes ?? 0,
      made: gate.made ?? [],
      browser: gate.browser ?? null,
      environment: gate.environment ?? null,
      axe: gate.axe ?? null,
      wallMs: Date.parse(gate.finishedAt) - Date.parse(gate.startedAt),
      engines: distinct(servers.filter((server) => server.package === gate.gate).map((server) => server.engine)).sort(),
    })),
    install:
      install === null
        ? null
        : {
            passed: install.passed === true,
            error: install.error ?? null,
            node: install.node,
            npm: install.npm,
            resolved: install.resolved ?? [],
            tarballs: install.tarballs ?? [],
          },
    container,
    missing: results.flatMap((result) => (result.missing ?? []).map((what) => ({ job: result.key, what }))),
    buildIdentity: published.map((name) => {
      const builds = results.flatMap((result) =>
        (result.dist ?? []).filter((entry) => entry.package === name).map((entry) => ({ job: result.key, distHash: entry.distHash })),
      )
      const tarball = (install?.tarballs ?? []).find((entry) => entry.name === name) ?? null
      const hashes = distinct([...builds.map((build) => build.distHash), ...(tarball === null ? [] : [tarball.distHash])])
      return {
        package: name,
        tarball: tarball === null ? null : { file: tarball.file, sha256: tarball.sha256, distHash: tarball.distHash },
        builds,
        identical: hashes.length <= 1,
      }
    }),
    observations: observationsOf(gates),
  }
}

/**
 * What a browser gate's row says it did not do, which a gate that measured
 * anything does: make a check, and make one in a pass at a viewport width.
 * Each a phrase; none for a gate that did both. problems.mjs fails a run on
 * each and gates.mjs a gate's evidence, so the two cannot disagree.
 */
export const unmeasured = (row) => [
  ...(row.ok + row.failed.length === 0 ? ['made no check'] : []),
  ...(row.passes === 0 ? ['made no pass at a viewport width'] : []),
]

/**
 * Every measurement a gate recorded, grouped by gate, browser, name and unit,
 * with each value and the runner it was taken on: two browsers' measurements
 * of one name are two observations, each on its own leg's runner.
 */
function observationsOf(gates) {
  const groups = new Map()
  for (const gate of gates) {
    for (const measurement of gate.measurements ?? []) {
      const browser = gate.asked ?? null
      const key = `${gate.gate}\0${String(browser)}\0${measurement.name}\0${measurement.unit}`
      const runner = gate.runner?.image == null ? (gate.runner?.platform ?? null) : `${gate.runner.image} ${gate.runner.imageVersion ?? ''}`.trim()
      const group = groups.get(key) ?? {
        gate: gate.gate,
        browser,
        name: measurement.name,
        unit: measurement.unit,
        values: [],
        passes: gate.passes ?? 0,
        runner,
      }
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
