// What fails the report (0035), for what it shows of versions, results,
// shared cases, the browser matrix, build identity and the limitations: one
// sentence each, written into the report's `problems` and making the job exit
// 1. Both files are still written, so a red run says why.
//
// Pure over a built report. `allowMissing` names what a local, partial report
// may lack (verify, browser, install, container, getting-started, and
// test-images, the image legs of the matrix); CI allows none.

import { browserName, FACTS, launchedBuild, prose } from '../browsers.mjs'
import { heldCells } from './matrix.mjs'
import { unmeasured } from './results.mjs'

/** Readable names for the engines; a third engine without one shows its own name. */
const ENGINE = { postgres: 'PostgreSQL', sqlserver: 'SQL Server' }
export const engineName = (engine) => ENGINE[engine] ?? engine

const list = (items, most = 5) => (items.length <= most ? items.join('; ') : `${items.slice(0, most).join('; ')}; and ${String(items.length - most)} more`)

/** Each package's suite in each leg: present, ran something, every test passed, every file passed, vitest said success. */
function suiteProblems(row) {
  const name = row.package === null ? 'the repository guards' : row.image == null ? row.package : `${row.package} on ${row.image}`
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

/**
 * Every browser gate an app with `test:browser` has, in every browser the
 * gates run in (the browsers testedOn() pins): present, no error, no failed
 * check, a check made in a pass at a width, and launched as the build
 * Playwright pins for its browser; and every browser launched held to its
 * pin's version, one with no pin failing.
 */
function gateProblems(report, browserApps, allowMissing) {
  const problems = []
  const gates = report.results.browserGates
  const { playwright } = report.testedOn
  const gated = playwright.pins.map((pin) => pin.browser)
  for (const app of browserApps) {
    for (const browser of gated) {
      if (!allowMissing.includes('browser') && !gates.some((gate) => gate.gate === app && gate.asked === browser)) problems.push(`the browser gate of ${app} left no results in ${browserName(browser)}`)
    }
    for (const gate of gates.filter((entry) => entry.gate === app)) {
      const which = `the browser gate of ${app} in ${browserName(gate.asked)}`
      if (gate.error !== null) problems.push(`${which} ended with an error: ${gate.error}`)
      if (gate.failed.length > 0) problems.push(`${which} failed ${String(gate.failed.length)} check(s): ${list(gate.failed)}`)
      // One that ended in an error measured nothing for a reason it says.
      if (gate.error === null) for (const what of unmeasured(gate)) problems.push(`${which} ${what}`)
      if (gate.browser === null) problems.push(`${which} says no browser was launched`)
      else problems.push(...buildProblems(which, gate.browser, playwright))
    }
  }
  for (const app of browserApps) {
    // Gates that ended in an error stopped where they stopped; their error is already a problem.
    const ran = gated.flatMap((browser) => gates.filter((gate) => gate.gate === app && gate.asked === browser && gate.error === null))
    problems.push(...sameChecks(app, ran), ...unheldFacts(app, ran))
  }
  for (const browser of report.testedOn.browsers) {
    const launched = `the browser gates of ${browser.gates.join(', ')} launched ${browser.name} ${browser.version}`
    if (browser.pin === null) problems.push(`${launched}, which no gate here runs: the gates hold only ${prose(gated.map(browserName))} to a build Playwright ${playwright.playwright} pins`)
    else if (browser.version !== browser.pin) problems.push(`${launched}, not the ${browser.pin} Playwright ${playwright.playwright} pins`)
  }
  return problems
}

const NOBODY_CHECKED = 'a check made in one browser and not another is a claim made for that browser by nobody'
const NOBODY_MEASURED = 'a pass made in one browser and not another is a width measured for that browser by nobody'
const passName = (label) => (label === null ? '(before any pass)' : `"${label}"`)
const times = (count) => `${String(count)} ${count === 1 ? 'time' : 'times'}`

/** How often each check was made in one pass: name -> count. */
const tally = (checks) => checks.reduce((counts, name) => counts.set(name, (counts.get(name) ?? 0) + 1), new Map())

/**
 * One app's gates, one per browser in the order the gates run in, compared
 * with the first (0058): the same passes, by label and in order, and in
 * each pass the same checks by name, as often. A gate's check names carry
 * no value of its run, so the names alone say whether two browsers were
 * asked the same questions; a difference in an answer is a failed check,
 * never a missing one.
 */
function sameChecks(app, ran) {
  const [first, ...others] = ran
  const problems = []
  for (const other of others) {
    const [a, b] = [first, other].map((gate) => gate.made.map((entry) => entry.label))
    const [one, two] = [browserName(first.asked), browserName(other.asked)]
    if (a.join('\0') !== b.join('\0')) {
      problems.push(`the browser gate of ${app} made its passes as ${a.map(passName).join(', ')} in ${one} and as ${b.map(passName).join(', ')} in ${two}: ${NOBODY_MEASURED}`)
      continue
    }
    for (const [at, entry] of first.made.entries()) {
      const [counts, theirs] = [tally(entry.checks), tally(other.made[at].checks)]
      for (const name of new Set([...counts.keys(), ...theirs.keys()])) {
        const [x, y] = [counts.get(name) ?? 0, theirs.get(name) ?? 0]
        if (x === y) continue
        const where = `"${name}" at ${passName(entry.label)}`
        const said = y === 0 ? `${where} in ${one} and not in ${two}` : x === 0 ? `${where} in ${two} and not in ${one}` : `${where} ${times(x)} in ${one} and ${times(y)} in ${two}`
        problems.push(`the browser gate of ${app} made ${said}: ${NOBODY_CHECKED}`)
      }
    }
  }
  return problems
}

/**
 * Each of 0058's FACTS rows whose `heldBy` names `app`'s gate, against that
 * gate's run in each browser (`ran`, none in an error): every check the row
 * names, made in some pass. sameChecks compares the browsers with each
 * other, so a check taken out of the gate in every browser at once is no
 * difference there; here it is a row nobody holds.
 */
function unheldFacts(app, ran) {
  const problems = []
  for (const [id, fact] of Object.entries(FACTS)) {
    if (fact.heldBy.gate !== app) continue
    for (const gate of ran) {
      const made = new Set(gate.made.flatMap((entry) => entry.checks))
      for (const name of fact.heldBy.checks) {
        if (!made.has(name)) problems.push(`the browser gate of ${app} in ${browserName(gate.asked)} never made "${name}", which holds 0058's ${id}: a row no check holds is a sentence nobody measured`)
      }
    }
  }
  return problems
}

/**
 * A launched browser whose launch started another build than its pin's: the
 * version check above cannot see it, as Playwright pins Chromium's headless
 * shell and its full browser at one version. A browser with no pin is
 * failed above.
 */
function buildProblems(which, browser, playwright) {
  const pin = playwright.pins.find((entry) => entry.browser === browser.name)
  if (pin === undefined) return []
  const { build, how } = launchedBuild(browser)
  if (build === pin.name) return []
  return [`${which} launched ${browser.name} ${browser.version} ${how}${build === null ? '' : `, which starts ${build}`}, not the ${pin.name} Playwright ${playwright.playwright} pins`]
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

/**
 * Every case on every image of every engine's matrix, every declaration
 * known and of a file its leg's servers name, and every image of the matrix
 * answered: the default always, the others unless a local run allowed the
 * image legs missing.
 */
function caseProblems(report, allowMissing) {
  const problems = []
  const { columns } = report.sharedCases
  for (const row of report.sharedCases.rows) {
    const held = heldCells(row, columns, allowMissing)
    if (held.every(([, cell]) => cell.state === 'passed')) continue
    const said = Object.entries(row.cells).map(([image, cell]) => `${cell.state} on ${image}`).join(', ')
    problems.push(`${row.id}: ${said}${held.some(([, cell]) => cell.state === 'missing') ? ' (declared with covers(); see packages/data-fixtures/README.md)' : ''}`)
  }
  for (const entry of report.sharedCases.unknown) problems.push(`${entry.file} › ${entry.name} declares "${entry.id}", which is no shared case`)
  for (const entry of report.sharedCases.withoutEngine) problems.push(`${entry.file} › ${entry.name} declares shared cases on ${String(entry.engine)}, which is no engine`)
  for (const entry of report.sharedCases.withoutImage) {
    problems.push(`${entry.file} › ${entry.name} declares shared cases on ${entry.engine} in ${entry.leg}, and no server that leg recorded names its file, so no image can be said for it`)
  }
  for (const engine of report.testedOn.engines) {
    const image = engine.images.find((entry) => entry.default)
    if (image === undefined || image.tested.length === 0) problems.push(`${engineName(engine.engine)}'s default image ${engine.defaultImage} never answered a test in this run`)
    for (const other of engine.images.filter((entry) => entry.matrix && !entry.default && entry.tested.length === 0)) {
      if (!allowMissing.includes('test-images')) problems.push(`${engineName(engine.engine)}'s matrix image ${other.image} never answered a test in this run`)
    }
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

/** How an evidence item that did not pass is said; a browser gate that ran in some browsers and not others names the others. */
const unpassed = (item) => {
  const what = item.kind === 'file' ? item.value : item.kind === 'browserGate' ? `the browser gate of ${item.value}` : item.kind === 'job' ? `the ${item.value} job` : item.kind === 'sharedCases' ? 'the shared cases' : item.value
  const where = item.missing === undefined ? '' : ` in ${item.missing.map(browserName).join(', ')}`
  return `${what} ${item.outcome === 'absent' ? `did not run${where}` : item.kind === 'job' ? `ended ${String(item.result)}` : 'did not pass'}`
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
    ...caseProblems(report, allowMissing),
    ...identityProblems(report),
    ...limitationProblems(report),
  ]
}
