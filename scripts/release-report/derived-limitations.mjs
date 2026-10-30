// The limitations a run shows (0035), section 9a of the release report and
// the release body's list: fixed sentences, each with only the run's facts
// inserted, so a limitation the run shows cannot be left out by somebody
// forgetting it.

import { BROWSERS, browserName, FACTS, launchedBuild } from '../browsers.mjs'
import { answer, code, prose, stated } from './markdown.mjs'
import { engineName } from './problems.mjs'

const ran = (image) => (image.callers.length === 0 ? 'a file no record names' : prose(image.callers.map(code)))
const answered = (image) => `${code(image.image)} (${prose(image.tested.map(answer))})`

/** The files that started any of `images`, each once: who ran on the images outside the matrix. */
function filesOf(images) {
  const files = [...new Set(images.flatMap((image) => image.callers))].map(code)
  return prose(images.some((image) => image.callers.length === 0) ? [...files, 'a file no record names'] : files)
}

/**
 * What the matrix's other images ran (0067), from their servers' records:
 * for each group of images the same suites ran on in their own legs, those
 * suites and what each image answered; every image of the matrix that no
 * leg of its own ran on but a file of another leg did, with that file; and
 * every image of the matrix nothing ran on. Each clause begins `; `.
 */
function matrixClauses(images) {
  const groups = new Map()
  for (const image of images.filter((entry) => entry.tested.length > 0)) {
    const who = image.suites.length === 0 ? `the tests in ${ran(image)}` : `the ${image.suites.length === 1 ? 'suite' : 'suites'} of ${prose(image.suites.map(code))}`
    groups.set(who, [...(groups.get(who) ?? []), image])
  }
  const clauses = [...groups].map(([who, ranOn]) => `; ${who} also ran on ${prose(ranOn.map(answered))}`)
  const none = images.filter((entry) => entry.tested.length === 0)
  for (const image of none.filter((entry) => (entry.aside?.tested ?? []).length > 0)) {
    clauses.push(`; no leg of the matrix ran on ${code(image.image)}, though the tests in ${prose(image.aside.callers.map(code))} did (${prose(image.aside.tested.map(answer))})`)
  }
  const nothing = none.filter((entry) => (entry.aside?.tested ?? []).length === 0)
  if (nothing.length > 0) clauses.push(`; no test ran on ${prose(nothing.map((entry) => code(entry.image)))}, ${nothing.length === 1 ? 'an image' : 'images'} of the matrix`)
  return clauses.join('')
}

/**
 * The sentences each engine gets. First what its default image answered,
 * what the other images of its matrix ran and answered, the files whose
 * tests ran elsewhere, and the composed stack, ending that no other version
 * was tested when any of those was. Then one sentence for each image outside
 * the matrix: what it answered, the files that named it, and that the
 * release was not tested on it -- after the tested ones, because named
 * before "No other version … was tested" it would read as one of them (0067
 * narrows 0003). A default or an image of the matrix that never answered
 * fails the run; what the tests ran on instead is still said.
 */
function engineSentences(engine) {
  const name = engineName(engine.engine)
  const fallback = engine.images.find((image) => image.default)
  const matrix = engine.images.filter((image) => image.matrix && !image.default)
  const others = engine.images.filter((image) => !image.matrix && image.tested.length > 0)
  const away = `the tests in ${filesOf(others)}`
  const outsideImages = `${others.length === 1 ? 'an image' : 'images'} outside the matrix`
  const any = (fallback?.tested.length ?? 0) > 0
  let sentence
  if (any) {
    sentence = `Every ${name} test ran on ${code(fallback.image)}, which answered ${prose(fallback.tested.map(answer))} in this run`
    if (others.length > 0) sentence += `, except ${away}, which ran on ${outsideImages}`
  } else if (others.length > 0) {
    sentence = `No ${name} test ran on the default ${code(engine.defaultImage)} in this run; ${away} ran on ${outsideImages}`
  } else sentence = `No ${name} server answered a test in this run`
  sentence += matrixClauses(matrix)
  const composed = engine.images.filter((entry) => entry.composed.length > 0)
  for (const image of composed) {
    sentence += `; the getting-started job ran ${code(image.image)} through compose, which answered ${prose([...new Set(image.composed.map((entry) => entry.version))])}`
  }
  const tested = any || composed.length > 0 || matrix.some((image) => image.tested.length > 0)
  const outside = others.map(
    (other) =>
      `${answered(other)} is outside the matrix: only the tests in ${ran(other)} ran on it, and they show what ${other.callers.length === 1 ? 'that file shows' : 'those files show'}; this release was not tested on it.`,
  )
  return [tested ? `${sentence}. No other version, edition or managed service was tested.` : `${sentence}.`, ...outside]
}

/** The snapshots an app's files hold, as "PostgreSQL 17.11 and SQL Server 16.0.4295.3". */
function snapshotsOf(report, app) {
  const own = report.testedOn.snapshots.filter((snapshot) => snapshot.file.startsWith(`${app}/`))
  return prose([...new Set(own.map((snapshot) => `${engineName(snapshot.kind)} ${snapshot.serverVersion}`))])
}

/** `apps/host in Chromium`: a gate's row, as a sentence names it. */
const gateIn = (gate) => `${gate.gate} in ${browserName(gate.asked ?? gate.browser?.name)}`

/**
 * How and where every browser gate ran, from what each recorded of its
 * launch: headless on linux-x64 is what 0058's facts were measured in, and a
 * run that launched otherwise says which gates did.
 */
function launchSentences(gates) {
  const launched = gates.filter((gate) => gate.browser !== null)
  if (launched.length === 0) return []
  const groups = new Map()
  for (const gate of launched) {
    const way = `${launchedBuild(gate.browser).how} on ${String(gate.browser.platform)}-${String(gate.browser.arch)}`
    groups.set(way, [...(groups.get(way) ?? []), gateIn(gate)])
  }
  if (groups.size === 1) return [`Every browser gate ran ${[...groups.keys()][0]}.`]
  return [`The browser gates ran ${prose([...groups].map(([way, named]) => `${way} (${named.join(', ')})`))}.`]
}

/** A package as a run recorded it: its version, or why it has none. */
const recorded = (entry) => (entry.version === null ? `${entry.name}, whose version ${entry.why}` : `${entry.name} ${entry.version}`)

/**
 * The system packages each browser's gates took from the runner and not
 * from Playwright, as its gates recorded them (scripts/browser-gate.mjs's
 * systemOf), and the facts of 0058 that rest on them: an image update can
 * move those with no change in the repository.
 */
function systemSentences(gates) {
  const sentences = []
  for (const browser of BROWSERS) {
    const seen = new Map()
    for (const gate of gates.filter((entry) => entry.asked === browser)) {
      for (const entry of gate.environment?.system?.packages ?? []) seen.set(JSON.stringify(entry), entry)
    }
    if (seen.size === 0) continue
    const packages = [...seen.values()]
    const gives = prose([...new Set(packages.map((entry) => entry.gives))])
    const resting = Object.entries(FACTS).filter(([, fact]) => (fact.restsOn?.[browser] ?? []).length > 0)
    const rests = resting.length === 0 ? '' : `; 0058's ${prose(resting.map(([id]) => id))} rest on ${prose([...new Set(resting.flatMap(([, fact]) => fact.restsOn[browser]))])}`
    sentences.push(`${browserName(browser)}'s ${gives} were the runner's, not Playwright's: ${prose(packages.map(recorded))}${rests}.`)
  }
  return sentences
}

/** Section 9a: the limitations this run shows, each a fixed sentence with only its facts inserted. */
export function derivedLimitations(report) {
  const { testedOn, results, browserMatrix } = report
  const all = testedOn.engines.map((engine) => engine.engine)
  const sentences = testedOn.engines.flatMap(engineSentences)

  sentences.push(
    testedOn.browsers.length === 0
      ? 'The browser gates launched no browser in this run.'
      : `The browser gates launched ${prose(testedOn.browsers.map((browser) => `${browserName(browser.name)} ${browser.version}`))} only.`,
  )

  sentences.push(...launchSentences(results.browserGates), ...systemSentences(results.browserGates))

  // One row per browser a gate ran in, and one sentence per app: the
  // engines are the app's, whichever browser drew the page.
  for (const row of browserMatrix.filter((entry) => entry.engines.length < all.length)) {
    const label = row.source === 'gate' ? `The browser gate of ${row.app}` : `The suite of ${row.app}, in ${row.environment},`
    let sentence
    if (row.engines.length > 0) sentence = `${label} ran against ${prose(row.engines.map(engineName))} only.`
    else {
      const snapshots = snapshotsOf(report, row.app)
      sentence = snapshots === '' ? `${label} started no database.` : `${label} started no database; it runs on snapshots captured from ${snapshots}.`
    }
    if (!sentences.includes(sentence)) sentences.push(sentence)
  }

  const direct = testedOn.runtime.filter((entry) => entry.under === undefined)
  const ranged = direct.filter((entry) => !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(entry.range)))
  sentences.push(
    ranged.length === direct.length
      ? 'Every runtime dependency is published as a range; the suites ran the versions *Tested on* names.'
      : `${prose(ranged.map((entry) => code(entry.name)))} are published as ranges; the suites ran the versions *Tested on* names.`,
  )
  const moved = [...testedOn.runtime, ...testedOn.upstream].filter((entry) => entry.fresh !== null && entry.fresh !== undefined && entry.fresh !== (entry.loaded ?? entry.version))
  if (moved.length > 0) {
    sentences.push(
      `A clean npm install on ${String(testedOn.installedAt).slice(0, 10)} resolved ${prose(moved.map((entry) => `${code(entry.name)} ${entry.fresh} (the suites ran ${entry.loaded ?? entry.version})`))}, which no suite ran.`,
    )
  }

  const declared = testedOn.node.declared.length === 0 ? 'no published package declares the Node versions it supports' : prose(testedOn.node.declared.map((entry) => `${code(entry.package)} declares Node ${code(entry.node)}`))
  const image = testedOn.node.image === null ? "the server image's Node was not recorded in this run" : `the server image runs ${testedOn.node.image}`
  sentences.push(`The suites ran on Node ${prose(testedOn.node.ran)}; ${image}; ${declared}.`)

  const identity = results.buildIdentity
  if (results.install === null) sentences.push("Each package's own suites ran its source; no install gate ran the packed dist/ in this run.")
  else if (identity.length > 0 && identity.every((entry) => entry.identical && entry.tarball !== null && entry.builds.length > 0)) {
    // Only the jobs that built every published package are named: a job
    // that built one, as an adapter's test job builds data-core, did not
    // build the others, and the table says which built what.
    const everywhere = identity.map((entry) => new Set(entry.builds.map((build) => build.job))).reduce((all, jobs) => new Set([...all].filter((job) => jobs.has(job))))
    const named = [...everywhere].sort()
    sentences.push(
      `Each package's own suites ran its source; the published dist/ was run by the install gate, and each package's is byte-identical to ${named.length === 0 ? 'the dist/ every job that built it built' : `its dist/ built in ${prose(named)}, and in every other job that built it`} (*Build identity* names them).`,
    )
  } else sentences.push("Each package's own suites ran its source; the published dist/ was run by the install gate, and is not shown byte-identical to every job's build (see *Build identity*).")

  sentences.push(
    results.container === null
      ? 'No container gate ran in this run.'
      : 'The container gate ran the image it built from this commit; the release builds the published image again, named by its digest.',
  )
  for (const gate of report.gates ?? []) {
    if (gate.state === 'open') sentences.push(`Release gate ${String(gate.gate)} is open: ${gate.open}`)
    if (gate.state === 'stated') sentences.push(`Release gate ${String(gate.gate)} is ${prose(gate.evidence.map(stated))}; not exercised by this run.`)
  }
  return sentences
}
