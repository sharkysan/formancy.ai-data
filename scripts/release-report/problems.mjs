// What fails the report (0035), for what it shows of versions, results,
// shared cases, the browser matrix, build identity and the limitations: one
// sentence each, written into the report's `problems` and making the job exit
// 1. Both files are still written, so a red run says why.
//
// Pure over a built report. `allowMissing` names what a local, partial report
// may lack (verify, browser, install, container, getting-started); CI allows
// none.

/** Readable names for the engines; a third engine without one shows its own name. */
const ENGINE = { postgres: 'PostgreSQL', sqlserver: 'SQL Server' }
export const engineName = (engine) => ENGINE[engine] ?? engine

const list = (items, most = 5) => (items.length <= most ? items.join('; ') : `${items.slice(0, most).join('; ')}; and ${String(items.length - most)} more`)

/** Each package's suite: present, ran something, every test passed, every file passed, vitest said success. */
function suiteProblems(row) {
  const name = row.package ?? 'the repository guards'
  if (!row.present) return [`${name}: no results from its suite`]
  const problems = []
  if (row.tests === 0) problems.push(`${name}: its suite ran no tests`)
  const failed = row.notPassed.filter((test) => test.status === 'failed')
  const skipped = row.notPassed.filter((test) => test.status !== 'failed')
  if (failed.length > 0) problems.push(`${name}: ${String(failed.length)} test(s) failed: ${list(failed.map((test) => `${test.file} › ${test.name}`))}`)
  if (skipped.length > 0) {
    problems.push(`${name}: ${String(skipped.length)} test(s) did not run (${[...new Set(skipped.map((test) => test.status))].join(', ')}), and a suite that can be skipped is a suite that is skipped: ${list(skipped.map((test) => `${test.file} › ${test.name}`))}`)
  }
  for (const file of row.failedFiles) {
    problems.push(file.testsPassed ? `${name}: ${file.file} failed though every test in it passed: a collection error, or a hook that threw` : `${name}: ${file.file} failed`)
  }
  if (!row.success) problems.push(`${name}: vitest reported the run unsuccessful`)
  if (row.numFailedTestSuites > 0) problems.push(`${name}: vitest counted ${String(row.numFailedTestSuites)} failed suite(s)`)
  return problems
}

/** Every browser gate an app with `test:browser` has: present, no error, no failed check, the pinned browser. */
function gateProblems(report, browserApps, allowMissing) {
  const problems = []
  const gates = report.results.browserGates
  for (const app of browserApps) {
    const ran = gates.filter((gate) => gate.gate === app)
    if (ran.length === 0 && !allowMissing.includes('browser')) problems.push(`the browser gate of ${app} left no results`)
    for (const gate of ran) {
      if (gate.error !== null) problems.push(`the browser gate of ${app} ended with an error: ${gate.error}`)
      if (gate.failed.length > 0) problems.push(`the browser gate of ${app} failed ${String(gate.failed.length)} check(s): ${list(gate.failed)}`)
      if (gate.browser === null) problems.push(`the browser gate of ${app} says no browser was launched`)
    }
  }
  for (const browser of report.testedOn.browsers) {
    if (browser.pin !== null && browser.version !== browser.pin) {
      problems.push(`the browser gates of ${browser.gates.join(', ')} launched ${browser.name} ${browser.version}, not the ${browser.pin} Playwright ${report.testedOn.playwright.playwright} pins`)
    }
  }
  return problems
}

/** The install gate passed and packed one tarball per published package, each at data-core's version; the container gate left its results. */
function packagingProblems(report, published, allowMissing) {
  const problems = []
  const { install, container } = report.results
  if (install === null) {
    if (!allowMissing.includes('install')) problems.push('the install gate left no results')
  } else {
    if (!install.passed) problems.push(`the install gate did not pass: ${install.error ?? 'no error was recorded'}`)
    const packed = install.tarballs.map((tarball) => tarball.name).sort()
    if (packed.join() !== [...published].sort().join()) problems.push(`the install gate packed ${packed.join(', ') || 'nothing'}, where every published package needs exactly one tarball: ${[...published].sort().join(', ')}`)
    // One number for every package, data-core's (bump.mjs), so a tarball at
    // another is found on the pull request rather than at the tag.
    for (const tarball of install.tarballs) {
      if (tarball.version !== report.subject.version) problems.push(`the install gate packed ${tarball.name} ${String(tarball.version)}, where every published package is at data-core's version, ${report.subject.version}`)
    }
  }
  if (container === null && !allowMissing.includes('container')) problems.push('the container gate left no results')
  return problems
}

/** Every case on every engine, every declaration known, and every engine's default image answered. */
function caseProblems(report) {
  const problems = []
  for (const row of report.sharedCases.rows) {
    const cells = Object.entries(row.cells)
    if (cells.every(([, cell]) => cell.state === 'passed')) continue
    const said = cells.map(([engine, cell]) => `${cell.state} on ${engine}`).join(', ')
    problems.push(`${row.id}: ${said}${cells.some(([, cell]) => cell.state === 'missing') ? ' (declared with covers(); see packages/data-fixtures/README.md)' : ''}`)
  }
  for (const entry of report.sharedCases.unknown) problems.push(`${entry.file} › ${entry.name} declares "${entry.id}", which is no shared case`)
  for (const entry of report.sharedCases.withoutEngine) problems.push(`${entry.file} › ${entry.name} declares shared cases on ${String(entry.engine)}, which is no engine`)
  for (const engine of report.testedOn.engines) {
    const image = engine.images.find((entry) => entry.default)
    if (image === undefined || image.tested.length === 0) problems.push(`${engineName(engine.engine)}'s default image ${engine.defaultImage} never answered a test in this run`)
    for (const other of engine.images) {
      if (other.callers.length === 0 && other.tested.length > 0) problems.push(`${engineName(engine.engine)} on ${other.image} answered a test whose file no record names`)
    }
  }
  return problems
}

/** One `dist/` per published package, whichever job built it and in the tarball npm receives. */
function identityProblems(report) {
  const problems = []
  for (const entry of report.results.buildIdentity) {
    // One hash among none is identical to itself: a tarball no job's build
    // is recorded beside is compared with nothing, and says nothing of it.
    if (entry.tarball !== null && entry.builds.length === 0) problems.push(`${entry.package}: no job recorded its dist/, so the dist/ in its tarball is compared with nothing`)
    if (entry.identical) continue
    const byHash = new Map()
    for (const build of entry.builds) byHash.set(build.distHash, [...(byHash.get(build.distHash) ?? []), build.job])
    const tarball = entry.tarball?.distHash
    if (tarball !== undefined && !byHash.has(tarball)) {
      problems.push(`${entry.package}: the dist/ in its tarball differs from the dist/ built in ${entry.builds.map((build) => build.job).join(', ')}`)
    }
    if (byHash.size > 1) problems.push(`${entry.package}: two jobs built different dist/ bytes: ${[...byHash].map(([hash, jobs]) => `${jobs.join(', ')} built ${hash.slice(0, 19)}`).join('; ')}`)
  }
  return problems
}

/** A limitation held by a test that did not pass, and a register that does not hold. */
function limitationProblems(report) {
  const problems = report.limitations.registerProblems.map((problem) => `docs/release/limitations.json: ${problem}`)
  for (const group of report.limitations.stated) {
    for (const line of group.lines) {
      if (line.heldBy !== undefined && line.held !== 'passed') problems.push(`${line.number}'s "${line.says}" is held by ${line.heldBy}, which ${line.held === 'absent' ? 'did not run' : 'did not pass'} in this run`)
    }
  }
  return problems
}

/** Every job of the gates workflow that leaves results, as the report's `needs` say it ended: anything but success fails the run. */
export function needsProblems(needs, jobs) {
  return jobs.flatMap((job) => {
    const result = needs?.[job]?.result
    if (result === undefined) return [`the report's needs do not name the ${job} job, so how it ended is unknown`]
    return result === 'success' ? [] : [`the ${job} job ended ${String(result)}`]
  })
}

/** How an evidence item that did not pass is said. */
const unpassed = (item) => {
  const what = item.kind === 'file' ? item.value : item.kind === 'browserGate' ? `the browser gate of ${item.value}` : item.kind === 'job' ? `the ${item.value} job` : item.kind === 'sharedCases' ? 'the shared cases' : item.value
  return `${what} ${item.outcome === 'absent' ? 'did not run' : item.kind === 'job' ? `ended ${String(item.result)}` : 'did not pass'}`
}

/**
 * Each gate whose evidence did not pass in this run. Locally, where there is
 * no `needs`, a job's evidence cannot pass, and a browser gate may not have
 * run: what `allowMissing` names is left out, as the partial banner says.
 */
export function releaseGateProblems(gates, allowMissing = []) {
  return gates
    .filter((gate) => gate.state === 'failed')
    .flatMap((gate) => {
      const allowed = (item) => item.outcome === 'absent' && ((item.kind === 'job' && allowMissing.includes(item.value)) || (item.kind === 'browserGate' && allowMissing.includes('browser')))
      const items = gate.evidence.filter((item) => item.kind !== 'document' && item.outcome !== 'passed' && !allowed(item))
      return items.length === 0 ? [] : [`gate ${String(gate.gate)}: its evidence did not pass in this run: ${list(items.map(unpassed))}`]
    })
}

/** Every problem of sections 2 to 8 of the report. */
export function contentProblems(report, { published, browserApps, allowMissing = [] }) {
  return [
    ...report.results.missing.map(({ job, what }) => `${job}: expected and not found: ${what}`),
    ...report.results.packages.flatMap(suiteProblems),
    ...(report.results.repository.present || !allowMissing.includes('verify') ? suiteProblems(report.results.repository) : []),
    ...gateProblems(report, browserApps, allowMissing),
    ...packagingProblems(report, published, allowMissing),
    ...caseProblems(report),
    ...identityProblems(report),
    ...limitationProblems(report),
  ]
}
