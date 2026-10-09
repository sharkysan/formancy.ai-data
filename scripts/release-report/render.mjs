// The report as Markdown (0035), from the built report, and the summary a
// release body carries.
//
// Every value is the report's; the only text written here is the fixed
// sentences of the derived limitations, each with only facts inserted, so a
// limitation the run shows cannot be left out by somebody forgetting it, and
// the line per section saying where it comes from.

import { engineName } from './problems.mjs'

const code = (text) => `\`${text}\``
const cell = (text) => String(text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n')
const prose = (items) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)
const seconds = (ms) => (ms === null || ms === undefined || Number.isNaN(ms) ? '' : `${(ms / 1000).toFixed(1)} s`)
const browserName = (name) => (name === 'chromium' ? 'Chromium' : name === 'firefox' ? 'Firefox' : name === 'webkit' ? 'WebKit' : name)

/** `17.11`, or `16.0.4295.3 (CU20, Developer Edition (64-bit))`: an answer as a reader reads it. */
const answer = (entry) => {
  const extra = [entry.updateLevel, entry.edition].filter((value) => value !== null && value !== undefined)
  return extra.length === 0 ? entry.version : `${entry.version} (${extra.join(', ')})`
}

/**
 * The sentence each engine gets: what its default image answered, every
 * other image and the files that ran on it, and the composed stack. A
 * default that never answered fails the run; what the tests ran on instead
 * is still said.
 */
function engineSentence(engine) {
  const name = engineName(engine.engine)
  const fallback = engine.images.find((image) => image.default)
  const others = engine.images.filter((image) => !image.default && image.tested.length > 0)
  const ran = (image) => (image.callers.length === 0 ? 'a file no record names' : prose(image.callers.map(code)))
  const answered = (fallback?.tested.length ?? 0) > 0
  let sentence
  if (answered) {
    sentence = `Every ${name} test ran on ${code(fallback.image)}, which answered ${prose(fallback.tested.map(answer))} in this run`
    for (const other of others) sentence += `, except the tests in ${ran(other)}, which ran on ${code(other.image)} (${prose(other.tested.map(answer))})`
  } else if (others.length > 0) {
    sentence = `No ${name} test ran on the default ${code(engine.defaultImage)} in this run; ${others.map((other) => `the tests in ${ran(other)} ran on ${code(other.image)} (${prose(other.tested.map(answer))})`).join('; ')}`
  } else sentence = `No ${name} server answered a test in this run`
  const composed = engine.images.filter((entry) => entry.composed.length > 0)
  for (const image of composed) {
    sentence += `; the getting-started job ran ${code(image.image)} through compose, which answered ${prose([...new Set(image.composed.map((entry) => entry.version))])}`
  }
  return answered || others.length > 0 || composed.length > 0 ? `${sentence}. No other version, edition or managed service was tested.` : `${sentence}.`
}

/** The snapshots an app's files hold, as "PostgreSQL 17.11 and SQL Server 16.0.4295.3". */
function snapshotsOf(report, app) {
  const own = report.testedOn.snapshots.filter((snapshot) => snapshot.file.startsWith(`${app}/`))
  return prose([...new Set(own.map((snapshot) => `${engineName(snapshot.kind)} ${snapshot.serverVersion}`))])
}

/** Section 8a: the limitations this run shows, each a fixed sentence with only its facts inserted. */
export function derivedLimitations(report) {
  const { testedOn, results, browserMatrix } = report
  const all = testedOn.engines.map((engine) => engine.engine)
  const sentences = testedOn.engines.map(engineSentence)

  sentences.push(
    testedOn.browsers.length === 0
      ? 'The browser gates launched no browser in this run.'
      : `The browser gates launched ${prose(testedOn.browsers.map((browser) => `${browserName(browser.name)} ${browser.version}`))} only.`,
  )

  for (const row of browserMatrix.filter((entry) => entry.engines.length < all.length)) {
    const label = row.source === 'gate' ? `The browser gate of ${row.app}` : `The suite of ${row.app}, in ${row.environment},`
    if (row.engines.length > 0) sentences.push(`${label} ran against ${prose(row.engines.map(engineName))} only.`)
    else {
      const snapshots = snapshotsOf(report, row.app)
      sentences.push(snapshots === '' ? `${label} started no database.` : `${label} started no database; it runs on snapshots captured from ${snapshots}.`)
    }
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

/** A document as evidence: where it is stated and when it last changed. */
function stated(item) {
  const history = item.history
  if (history === null || history === undefined) return `stated in ${code(item.value)}, whose history this checkout does not have`
  return `stated in ${code(item.value)}, last changed ${history.date.slice(0, 10)} at ${code(history.sha.slice(0, 7))}, ${String(history.behind)} commit(s) before this one`
}

/** How one evidence item stood in the run. */
function evidenceCell(item) {
  const what = item.kind === 'file' ? code(item.value) : item.kind === 'browserGate' ? `the browser gate of ${item.value}` : item.kind === 'job' ? `the ${code(item.value)} job` : item.kind === 'sharedCases' ? 'every shared case on every engine' : code(item.value)
  if (item.kind === 'document') return stated(item)
  return `${what}: ${item.outcome === 'absent' ? 'did not run' : item.kind === 'job' && item.outcome === 'failed' ? `ended ${String(item.result)}` : item.outcome}`
}

const GATE_STATE = { passed: 'evidence passed in this run', failed: 'evidence did not pass in this run', stated: 'stated, not exercised by this run', open: 'open' }

/** Section 7: each release gate, as this run leaves it; never "met". */
function gatesSection({ gates }) {
  return [
    '## Release gates',
    '',
    'The delivery plan’s gates by number (`docs/release/gates.json`). A document is stated evidence, never passed in a run, and no gate is called met.',
    '',
    table(['Gate', 'State', 'Evidence'], (gates ?? []).map((gate) => [String(gate.gate), GATE_STATE[gate.state], gate.state === 'open' ? gate.open : gate.evidence.map(evidenceCell).join('; ')])),
  ].join('\n')
}

/** Section 10: where each section comes from, one line each. */
const METHOD = [
  ['Subject', 'the GitHub run’s environment (`GITHUB_SHA`, `GITHUB_RUN_ID`), the report job’s `needs`, `packages/data-core/package.json`, and each job’s results file'],
  ['Tested on', '`scripts/release-report/tested-on.mjs` over the checkout, and every `test-results/servers/*.json` a job left: data-fixtures’ `recordServer` for each container a suite or gate started, and the getting-started journey for each composed database, each with `docker image inspect` for its digest'],
  ['Results', 'each package’s `test-results/vitest.json` and `coverage/coverage-summary.json`, turbo’s run summary (`--summarize`), each app’s `test-results/browser.json`, the install gate’s `test-results/install.json`, and `collect.mjs --job container`'],
  ['Shared cases', '`sharedCases()` from data-fixtures against the `covers()` each test declared, in vitest’s JSON'],
  ['The browser matrix', 'jsdom as each app loads it, each browser a gate launched, the renderers each app declares, and the engines its servers ran'],
  ['Build identity', '`scripts/release-report/dist-hash.mjs` over every published package’s `dist/` in every job, and over each tarball’s `package/dist/`'],
  ['Release gates', '`docs/release/gates.json`, the report job’s `needs`, and `git log` for a document’s last change'],
  ['Known limitations', 'the fixed sentences of `scripts/release-report/render.mjs` with this run’s facts, then `docs/release/limitations.json`, held to the decision records by hash'],
  ['Observations', 'each browser gate’s `measure()`'],
  ['Problems', '`scripts/release-report/problems.mjs`, `artefacts.mjs`, `gates.mjs` and `limitations.mjs`, and the release body from `scripts/release-notes.mjs`'],
]

/** Section 2: Tested on. */
function testedOnSection({ testedOn }) {
  const images = testedOn.engines.flatMap((engine) =>
    engine.images.map((image) => [
      engineName(engine.engine),
      `${code(image.image)}${image.default ? ', the default' : ''}`,
      prose(image.answers.map(answer)) || 'never answered',
      [...new Set(image.answers.map((entry) => entry.digest).filter((digest) => digest !== null))].map(code).join(', '),
      prose(image.startedBy.map((entry) => (entry.package === null ? entry.job : `${entry.package} (${entry.job})`))),
      image.default ? '' : image.callers.map(code).join(', '),
    ]),
  )
  return [
    '## Tested on',
    '',
    table(['Engine', 'Image', 'Answered', 'Digest', 'Started by', 'Files'], images),
    '',
    table(
      ['Dependency', 'Declared by', 'Published as', 'Loaded by the suites', 'A clean install'],
      testedOn.runtime.map((entry) => [code(entry.name), entry.under === undefined ? entry.package : `${entry.package}, under ${entry.under}`, entry.range ?? '', entry.loaded, entry.fresh ?? 'not reported']),
    ),
    '',
    table(['Upstream', 'Loaded', 'A clean install'], testedOn.upstream.map((entry) => [`${code(entry.name)}${entry.direct ? '' : ' (transitive)'}`, entry.version, entry.fresh ?? 'not installed by a consumer'])),
    '',
    `Node: the workspace declares ${code(testedOn.node.engines)}; the server image's stages are ${prose(testedOn.node.dockerfile.map(code))}; CI sets up ${prose([...new Set(testedOn.node.ci.map((entry) => entry.version))])}; this run's jobs ran ${prose(testedOn.node.ran)}${testedOn.node.image === null ? '' : `, and the gate's server image ${testedOn.node.image}`}.`,
    '',
    table(['Browser', 'Launched', 'Playwright pins', 'Gates'], testedOn.browsers.map((browser) => [browserName(browser.name), browser.version, browser.pin ?? '', browser.gates.join(', ')])),
    '',
    `axe-core as run in the page: ${prose(testedOn.axe) || 'not recorded'}. Tools: ${testedOn.tooling.map((tool) => `${tool.name} ${tool.versions.map((entry) => entry.version).join('/')}`).join(', ')}.`,
    '',
    table(['Captured snapshot', 'Captured from', 'This run answered'], testedOn.snapshots.map((snapshot) => [snapshot.file, `${engineName(snapshot.kind)} ${snapshot.serverVersion}`, prose(snapshot.answered) || 'nothing'])),
  ].join('\n')
}

const pct = (coverage) => (coverage === null ? '' : ['lines', 'branches', 'functions', 'statements'].map((metric) => (coverage[metric] === null ? '-' : String(coverage[metric]))).join(' / '))

/** Section 3: results per package, the repository's guards and the gates. */
function resultsSection({ results }) {
  const rows = results.packages.map((row) =>
    row.present
      ? [row.package, row.published ? 'yes' : 'no', row.files, row.tests, row.passed, row.failed, row.skipped + row.todo, row.failedFiles.length, seconds(row.wallMs) || 'not measured', seconds(row.spanMs), row.engines.join(', '), pct(row.coverage) || 'not measured']
      : [row.package, row.published ? 'yes' : 'no', 'no results', '', '', '', '', '', '', '', '', ''],
  )
  const repository = results.repository
  const install = results.install
  return [
    '## Results',
    '',
    table(['Package', 'Published', 'Files', 'Tests', 'Passed', 'Failed', 'Skipped or todo', 'Failed files', "Task's wall time (turbo)", 'First test start to last test end (vitest)', 'Engines started', 'Coverage, lines / branches / functions / statements (reported, never gated)'], rows),
    '',
    repository.present ? `The repository's guards (\`pnpm test:repo\`): ${String(repository.passed)} of ${String(repository.tests)} passed in ${String(repository.files)} files.` : "The repository's guards left no results.",
    '',
    table(
      ['Browser gate', 'Checks ok', 'Checks failed', 'Widths', 'Engines started', 'Browser', 'axe', 'Wall time'],
      results.browserGates.map((gate) => [gate.gate, gate.ok, gate.failed.length + (gate.error === null ? 0 : 1), gate.widths.join(', '), gate.engines.join(', ') || 'none', gate.browser === null ? 'none' : `${gate.browser.name} ${gate.browser.version}`, gate.axe ?? '', seconds(gate.wallMs)]),
    ),
    '',
    install === null ? 'The install gate left no results.' : `The install gate ${install.passed ? 'passed' : 'failed'} with npm ${String(install.npm)} on Node ${String(install.node)}.`,
    '',
    results.container === null
      ? 'The container gate left no results.'
      : `The image the container gate built from this commit (${code(results.container.image)}; the release builds and pushes its own and names it by digest): ${String(results.container.size)} bytes, Node ${results.container.node}, user ${code(results.container.user)}.`,
  ].join('\n')
}

/** Sections 4 to 6: the shared cases, the browser matrix and build identity. */
function matricesSection({ sharedCases, browserMatrix, results, testedOn }) {
  const engines = testedOn.engines.map((engine) => engine.engine)
  return [
    '## Shared cases on both engines',
    '',
    table(['Case', ...engines], sharedCases.rows.map((row) => [row.id, ...engines.map((engine) => row.cells[engine].state)])),
    '',
    '## The browser matrix',
    '',
    table(['Environment', 'App', 'Renderers', 'Engines'], browserMatrix.map((row) => [row.environment, row.app, row.renderers.map((renderer) => `${renderer.name} ${renderer.version}`).join(', '), row.engines.map(engineName).join(', ') || 'none'])),
    '',
    '## Build identity',
    '',
    table(
      ['Package', 'Tarball', 'Tarball sha256', 'Its dist/', 'Jobs that built the same dist/'],
      results.buildIdentity.map((entry) => [
        entry.package,
        entry.tarball?.file ?? 'none',
        entry.tarball?.sha256 ?? '',
        entry.tarball?.distHash ?? '',
        entry.builds.filter((build) => build.distHash === entry.tarball?.distHash).map((build) => build.job).join(', '),
      ]),
    ),
  ].join('\n')
}

/** Sections 7 to 9 and the problems: limitations, observations, and what failed the run. */
function closingSection(report) {
  const stated = report.limitations.stated.flatMap((group) => [
    '',
    `### ${group.area}`,
    '',
    ...group.lines.map((line) => `- ${line.says} — stated by [${line.number} ${line.title}](${line.link}) (${line.status})${line.heldBy === undefined ? '' : `; held by ${code(line.heldBy)}, ${line.held === 'passed' ? 'passed in this run' : line.held === 'absent' ? 'which did not run' : 'which did not pass'}`}`),
  ])
  return [
    '## Known limitations',
    '',
    'Shown by this run:',
    '',
    ...derivedLimitations(report).map((sentence) => `- ${sentence}`),
    '',
    'Stated in the decision records, as each record states it:',
    ...stated,
    '',
    '## Observations on a shared runner',
    '',
    'Not a performance figure (0034): what the gates measured on whatever machine ran them.',
    '',
    table(['Gate', 'Observation', 'Values', 'Unit', 'Passes', 'Runner'], report.results.observations.map((entry) => [entry.gate, entry.name, entry.values.map((value) => String(Math.round(value * 100) / 100)).join(', '), entry.unit, entry.passes, entry.runner ?? ''])),
    '',
    '## How this report was made',
    '',
    ...METHOD.map(([section, source]) => `- **${section}:** ${source}.`),
    '',
    '## Problems',
    '',
    report.problems.length === 0 ? 'None: nothing here fails the run.' : report.problems.map((problem) => `- ${problem}`).join('\n'),
  ].join('\n')
}

/** Sections 2 to 11 of the report: everything after the subject. */
export function renderContent(report) {
  return [testedOnSection(report), resultsSection(report), matricesSection(report), gatesSection(report), closingSection(report)].join('\n\n')
}

/** What is being released, as the subject's first line says it. */
function releaseName(subject) {
  if (subject.release === null) return subject.run === null ? 'a local run' : 'a CI run; nothing is released from it'
  return subject.release === 'dry-run' ? 'a rehearsal (`dry-run`); nothing is published from it' : `the release ${code(subject.release)}`
}

/** Section 1: which version, release, commit and run this is, and each job's machine. */
function subjectSection({ subject }) {
  const run = subject.run === null ? '' : ` Run [${String(subject.run.id)}](${subject.run.url}) of ${subject.run.workflow ?? 'the gates workflow'}, attempt ${String(subject.run.attempt ?? '?')}.`
  return [
    `Formancy Data ${subject.version}, ${releaseName(subject)}. Commit ${code(subject.commit)}${subject.dirty === true ? ', with uncommitted changes' : ''}.${run} Generated ${subject.generatedAt}.`,
    '',
    table(
      ['Job', 'Attempt', 'Runner image', 'Node', 'Platform', 'Docker'],
      subject.jobs.map((entry) => [entry.key, entry.attempt ?? '', [entry.runner?.image, entry.runner?.imageVersion].filter((value) => value != null).join(' '), entry.runner?.node ?? '', entry.runner ? `${entry.runner.platform} ${entry.runner.arch}` : '', entry.runner?.docker ?? '']),
    ),
  ].join('\n')
}

/** The whole report as Markdown: the title, a local run's banner, the subject and every section. */
export function renderReport(report, { local = false, partial = [] } = {}) {
  const banner = local ? [`local: no NEEDS, no artefacts${partial.length === 0 ? '' : `; partial: ${partial.join(', ')} allowed missing`}.`, ''] : []
  return `${['# Release report', '', ...banner, subjectSection(report), '', renderContent(report)].join('\n')}\n`
}

/**
 * What a release body carries of the report, after the changelog's
 * `section`: where the full report is (`link`), the counts and the derived
 * limitations; never the observations, which are not figures (0034).
 */
export function renderSummary(report, { section = null, link = null } = {}) {
  const packages = report.results.packages.filter((row) => row.present)
  const passed = packages.reduce((total, row) => total + row.passed, 0)
  const tests = packages.reduce((total, row) => total + row.tests, 0)
  const cases = report.sharedCases.rows
  return [
    ...(link === null ? [] : [`The full report of the run that gated this: ${link}`, '']),
    ...(section === null ? [] : [`The notes above are CHANGELOG.md’s ${code(section)} section.`, '']),
    `${String(passed)} of ${String(tests)} tests passed across ${String(packages.length)} packages; ${String(cases.filter((row) => Object.values(row.cells).every((entry) => entry.state === 'passed')).length)} of ${String(cases.length)} shared cases passed on every engine.`,
    '',
    ...derivedLimitations(report).map((sentence) => `- ${sentence}`),
  ].join('\n')
}
