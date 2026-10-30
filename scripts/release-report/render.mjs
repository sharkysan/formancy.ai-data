// The report as Markdown (0035), from the built report, and the summary a
// release body carries.
//
// Every value is the report's; the only text written here is the fixed
// sentences of the derived limitations (derived-limitations.mjs), each with
// only facts inserted, so a limitation the run shows cannot be left out by
// somebody forgetting it, and the line per section saying where it comes from.

import { BROWSERS, browserName, FACTS } from '../browsers.mjs'
import { derivedLimitations } from './derived-limitations.mjs'
import { answer, code, prose, seconds, stated, table } from './markdown.mjs'
import { engineName } from './problems.mjs'

/** How one evidence item stood in the run. */
function evidenceCell(item) {
  const what =
    item.kind === 'file'
      ? code(item.value)
      : item.kind === 'browserGate'
        ? `the browser gate of ${item.value}`
        : item.kind === 'job'
          ? `the ${code(item.value)} job`
          : item.kind === 'sharedCases'
            ? 'every shared case on every image of the matrix'
            : code(item.value)
  if (item.kind === 'document') return stated(item)
  const where = item.missing === undefined ? '' : ` in ${prose(item.missing.map(browserName))}`
  return `${what}: ${item.outcome === 'absent' ? `did not run${where}` : item.kind === 'job' && item.outcome === 'failed' ? `ended ${String(item.result)}` : item.outcome}`
}

const GATE_STATE = {
  passed: 'evidence passed in this run',
  failed: 'evidence did not pass in this run',
  stated: 'stated, not exercised by this run',
  open: 'open',
}

/** Section 8: each release gate, as this run leaves it; never "met". */
function gatesSection({ gates }) {
  return [
    '## Release gates',
    '',
    'The delivery plan’s gates by number (`docs/release/gates.json`). A document is stated evidence, never passed in a run, and no gate is called met.',
    '',
    table(
      ['Gate', 'State', 'Evidence'],
      (gates ?? []).map((gate) => [String(gate.gate), GATE_STATE[gate.state], gate.state === 'open' ? gate.open : gate.evidence.map(evidenceCell).join('; ')]),
    ),
  ].join('\n')
}

/** Section 11: where each section comes from, one line each. */
const METHOD = [
  [
    'Subject',
    'the GitHub run’s environment (`GITHUB_SHA`, `GITHUB_RUN_ID`), the report job’s `needs`, `packages/data-core/package.json`, and each job’s results file',
  ],
  [
    'Tested on',
    '`scripts/release-report/tested-on.mjs` over the checkout, and every `test-results/servers/*.json` a job left: data-fixtures’ `recordServer` for each container a suite or gate started, and the getting-started journey for each composed database, each with `docker image inspect` for its digest',
  ],
  [
    'Results',
    'each package’s `test-results/vitest.json` and `coverage/coverage-summary.json`, turbo’s run summary (`--summarize`), each app’s `test-results/browser-<browser>.json` for each browser the gates run in, the install gate’s `test-results/install.json`, and `collect.mjs --job container`',
  ],
  [
    'Shared cases',
    '`sharedCases()` from data-fixtures against the `covers()` each test declared, in vitest’s JSON, on each image of data-fixtures’ `MATRIX_IMAGES`, a test counting for the images its own leg’s servers answered on for its file',
  ],
  ['The browser matrix', 'jsdom as each app loads it, each browser a gate launched, the renderers each app declares, and the engines its servers ran'],
  [
    'What the browsers disagree on',
    '`FACTS` in `scripts/browsers.mjs`; what each browser said it was, under *Tested on*, is each gate’s recorded `environment`',
  ],
  ['Build identity', '`scripts/release-report/dist-hash.mjs` over every published package’s `dist/` in every job, and over each tarball’s `package/dist/`'],
  ['Release gates', '`docs/release/gates.json`, the report job’s `needs`, and `git log` for a document’s last change'],
  [
    'Known limitations',
    'the fixed sentences of `scripts/release-report/derived-limitations.mjs` with this run’s facts, then `docs/release/limitations.json`, held to the decision records by hash',
  ],
  ['Observations', 'each browser gate’s `measure()`'],
  [
    'Problems',
    '`scripts/release-report/problems.mjs`, `artefacts.mjs`, `gates.mjs` and `limitations.mjs`, and the release body from `scripts/release-notes.mjs`',
  ],
]

/** Section 2: Tested on. */
function testedOnSection({ testedOn, results }) {
  const images = testedOn.engines.flatMap((engine) =>
    engine.images.map((image) => [
      engineName(engine.engine),
      `${code(image.image)}${image.default ? ', the default' : ''}`,
      prose(image.answers.map(answer)) || 'never answered',
      [...new Set(image.answers.map((entry) => entry.digest).filter((digest) => digest !== null))].map(code).join(', '),
      prose(image.startedBy.map((entry) => (entry.package === null ? entry.job : `${entry.package} (${entry.job})`))),
      image.default ? '' : [...new Set([...image.callers, ...(image.aside?.callers ?? [])])].map(code).join(', '),
    ]),
  )
  return [
    '## Tested on',
    '',
    table(['Engine', 'Image', 'Answered', 'Digest', 'Started by', 'Files'], images),
    '',
    table(
      ['Dependency', 'Declared by', 'Published as', 'Loaded by the suites', 'A clean install'],
      testedOn.runtime.map((entry) => [
        code(entry.name),
        entry.under === undefined ? entry.package : `${entry.package}, under ${entry.under}`,
        entry.range ?? '',
        entry.loaded,
        entry.fresh ?? 'not reported',
      ]),
    ),
    '',
    table(
      ['Upstream', 'Loaded', 'A clean install'],
      testedOn.upstream.map((entry) => [
        `${code(entry.name)}${entry.direct ? '' : ' (transitive)'}`,
        entry.version,
        entry.fresh ?? 'not installed by a consumer',
      ]),
    ),
    '',
    `Node: the workspace declares ${code(testedOn.node.engines)}; the server image's stages are ${prose(testedOn.node.dockerfile.map(code))}; CI sets up ${prose([...new Set(testedOn.node.ci.map((entry) => entry.version))])}; this run's jobs ran ${prose(testedOn.node.ran)}${testedOn.node.image === null ? '' : `, and the gate's server image ${testedOn.node.image}`}.`,
    '',
    table(
      ['Browser', 'Launched', 'Playwright pins', 'Gates'],
      testedOn.browsers.map((browser) => [browserName(browser.name), browser.version, browser.pin ?? '', browser.gates.join(', ')]),
    ),
    '',
    saidSection(results.browserGates),
    '',
    `axe-core as run in the page: ${prose(testedOn.axe) || 'not recorded'}. Tools: ${testedOn.tooling.map((tool) => `${tool.name} ${tool.versions.map((entry) => entry.version).join('/')}`).join(', ')}.`,
    '',
    table(
      ['Captured snapshot', 'Captured from', 'This run answered'],
      testedOn.snapshots.map((snapshot) => [snapshot.file, `${engineName(snapshot.kind)} ${snapshot.serverVersion}`, prose(snapshot.answered) || 'nothing']),
    ),
  ].join('\n')
}

const yesNo = (value) => (value === true ? 'yes' : value === false ? 'no' : '')

/** What each browser said it was to the page, and the system's fallback family, as its gates recorded them: one row per browser and distinct answer. */
function saidSection(gates) {
  const rows = new Map()
  for (const gate of gates.filter((entry) => entry.environment !== null)) {
    const { userAgent, platform, maxTouchPoints, pointerFine, hover, system } = gate.environment
    const cells = [
      browserName(gate.asked),
      userAgent,
      platform,
      maxTouchPoints,
      yesNo(pointerFine),
      yesNo(hover),
      system?.fallback?.family ?? `none: ${String(system?.fallback?.why ?? 'not recorded')}`,
    ]
    const key = JSON.stringify(cells)
    rows.set(key, { cells, gates: [...(rows.get(key)?.gates ?? []), gate.gate] })
  }
  return [
    'What each browser said it was, to the page and of the machine (0058):',
    '',
    table(
      ['Browser', 'Gates', 'User agent', 'Platform', 'Touch points', 'Pointer fine', 'Hover', 'Fallback family'],
      [...rows.values()].map(({ cells: [browser, ...rest], gates: named }) => [browser, named.join(', '), ...rest]),
    ),
  ].join('\n')
}

/** A fact's value as the table prints it. */
const factValue = (value) => (typeof value === 'boolean' ? yesNo(value) : String(value))

/** A measurement as the table prints it: when and by what, or that the row stands on its source. */
const factMeasured = (entry) => (entry.on === null ? `by source only (${entry.why})` : `${entry.on}: ${entry.by}`)

/** Section 6: each fact the browsers disagree on, with every browser's value, source and measurement (0058). */
function factsSection() {
  const rows = Object.entries(FACTS).flatMap(([id, fact]) =>
    BROWSERS.map((browser) => {
      const byConnection = (field, show) => fact.connections.map((connection) => `${connection}: ${show(fact[field][browser][connection])}`).join('; ')
      return [
        id,
        browserName(browser),
        fact.connections === undefined ? factValue(fact.values[browser]) : byConnection('values', factValue),
        fact.source[browser],
        fact.connections === undefined ? factMeasured(fact.measured[browser]) : byConnection('measured', factMeasured),
      ]
    }),
  )
  return [
    '## What the browsers disagree on',
    '',
    `scripts/browsers.mjs's FACTS (0058), each held by the checks it names, which its gate makes under one name in every browser and which the run fails without: ${Object.entries(
      FACTS,
    )
      .map(([id, fact]) => `${code(id)}, held by ${fact.heldBy.gate}’s ${prose(fact.heldBy.checks.map((name) => `"${name}"`))}: ${fact.says}`)
      .join('; ')}.`,
    '',
    table(['Fact', 'Browser', 'Value', 'Source', 'Measured'], rows),
  ].join('\n')
}

/** A suite's row as the table names it: the package, and the image of an image leg (0067). */
const leg = (row) => (row.image == null ? row.package : `${row.package} on ${row.image}`)

const pct = (coverage) =>
  coverage === null
    ? ''
    : ['lines', 'branches', 'functions', 'statements'].map((metric) => (coverage[metric] === null ? '-' : String(coverage[metric]))).join(' / ')

/** Section 3: results per package, the repository's guards and the gates. */
function resultsSection({ results }) {
  const rows = results.packages.map((row) =>
    row.present
      ? [
          leg(row),
          row.published ? 'yes' : 'no',
          row.files,
          row.tests,
          row.passed,
          row.failed,
          row.skipped + row.todo,
          row.failedFiles.length,
          seconds(row.wallMs) || 'not measured',
          seconds(row.spanMs),
          row.engines.join(', '),
          pct(row.coverage) || 'not measured',
        ]
      : [leg(row), row.published ? 'yes' : 'no', 'no results', '', '', '', '', '', '', '', '', ''],
  )
  const repository = results.repository
  const install = results.install
  return [
    '## Results',
    '',
    table(
      [
        'Package',
        'Published',
        'Files',
        'Tests',
        'Passed',
        'Failed',
        'Skipped or todo',
        'Failed files',
        "Task's wall time (turbo)",
        'First test start to last test end (vitest)',
        'Engines started',
        'Coverage, lines / branches / functions / statements (reported, never gated)',
      ],
      rows,
    ),
    '',
    repository.present
      ? `The repository's guards (\`pnpm test:repo\`): ${String(repository.passed)} of ${String(repository.tests)} passed in ${String(repository.files)} files.`
      : "The repository's guards left no results.",
    '',
    table(
      ['Browser gate', 'Checks ok', 'Checks failed', 'Widths', 'Engines started', 'Browser', 'axe', 'Wall time'],
      results.browserGates.map((gate) => [
        gate.gate,
        gate.ok,
        gate.failed.length + (gate.error === null ? 0 : 1),
        gate.widths.join(', '),
        gate.engines.join(', ') || 'none',
        gate.browser === null ? 'none' : `${gate.browser.name} ${gate.browser.version}`,
        gate.axe ?? '',
        seconds(gate.wallMs),
      ]),
    ),
    '',
    install === null
      ? 'The install gate left no results.'
      : `The install gate ${install.passed ? 'passed' : 'failed'} with npm ${String(install.npm)} on Node ${String(install.node)}.`,
    '',
    results.container === null
      ? 'The container gate left no results.'
      : `The image the container gate built from this commit (${code(results.container.image)}; the release builds and pushes its own and names it by digest): ${String(results.container.size)} bytes, Node ${results.container.node}, user ${code(results.container.user)}.`,
  ].join('\n')
}

/** Sections 4 to 7: the shared cases, the browser matrix, what the browsers disagree on and build identity. */
function matricesSection({ sharedCases, browserMatrix, results }) {
  const images = sharedCases.columns.map((column) => column.image)
  return [
    '## Shared cases on both engines',
    '',
    'One column per image of each engine’s matrix, the default first (0067); a test counts for each image its own leg’s servers answered on for its file.',
    '',
    table(
      ['Case', ...images],
      sharedCases.rows.map((row) => [row.id, ...images.map((image) => row.cells[image].state)]),
    ),
    '',
    '## The browser matrix',
    '',
    table(
      ['Environment', 'App', 'Renderers', 'Engines'],
      browserMatrix.map((row) => [
        row.environment,
        row.app,
        row.renderers.map((renderer) => `${renderer.name} ${renderer.version}`).join(', '),
        row.engines.map(engineName).join(', ') || 'none',
      ]),
    ),
    '',
    factsSection(),
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
        entry.builds
          .filter((build) => build.distHash === entry.tarball?.distHash)
          .map((build) => build.job)
          .join(', '),
      ]),
    ),
  ].join('\n')
}

/** Sections 9 to 11 and the problems: limitations, observations, and what failed the run. */
function closingSection(report) {
  const stated = report.limitations.stated.flatMap((group) => [
    '',
    `### ${group.area}`,
    '',
    ...group.lines.map(
      (line) =>
        `- ${line.says} — stated by [${line.number} ${line.title}](${line.link}) (${line.status})${line.heldBy === undefined ? '' : `; held by ${code(line.heldBy)}, ${line.held === 'passed' ? 'passed in this run' : line.held === 'absent' ? 'which did not run' : 'which did not pass'}`}`,
    ),
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
    table(
      ['Gate', 'Browser', 'Observation', 'Values', 'Unit', 'Passes', 'Runner'],
      report.results.observations.map((entry) => [
        entry.gate,
        entry.browser === null ? '' : browserName(entry.browser),
        entry.name,
        entry.values.map((value) => String(Math.round(value * 100) / 100)).join(', '),
        entry.unit,
        entry.passes,
        entry.runner ?? '',
      ]),
    ),
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
  const run =
    subject.run === null
      ? ''
      : ` Run [${String(subject.run.id)}](${subject.run.url}) of ${subject.run.workflow ?? 'the gates workflow'}, attempt ${String(subject.run.attempt ?? '?')}.`
  return [
    `Formancy Data ${subject.version}, ${releaseName(subject)}. Commit ${code(subject.commit)}${subject.dirty === true ? ', with uncommitted changes' : ''}.${run} Generated ${subject.generatedAt}.`,
    '',
    table(
      ['Job', 'Attempt', 'Runner image', 'Node', 'Platform', 'Docker'],
      subject.jobs.map((entry) => [
        entry.key,
        entry.attempt ?? '',
        [entry.runner?.image, entry.runner?.imageVersion].filter((value) => value != null).join(' '),
        entry.runner?.node ?? '',
        entry.runner ? `${entry.runner.platform} ${entry.runner.arch}` : '',
        entry.runner?.docker ?? '',
      ]),
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
  const present = report.results.packages.filter((row) => row.present)
  // Each test once: the default legs' counts, then the image legs' apart.
  const packages = present.filter((row) => row.image == null)
  const legs = present.filter((row) => row.image != null)
  const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0)
  const cases = report.sharedCases.rows
  const named = [...new Set(legs.map((row) => row.package))]
  const images = [...new Set(legs.map((row) => row.image))]
  const again =
    legs.length === 0
      ? []
      : [
          `The ${named.length === 1 ? 'suite' : 'suites'} of ${prose(named.map(code))} ran again on ${prose(images.map(code))}: ${String(sum(legs, 'passed'))} of ${String(sum(legs, 'tests'))} tests passed.`,
        ]
  return [
    ...(link === null ? [] : [`The full report of the run that gated this: ${link}`, '']),
    ...(section === null ? [] : [`The notes above are CHANGELOG.md’s ${code(section)} section.`, '']),
    [
      `${String(sum(packages, 'passed'))} of ${String(sum(packages, 'tests'))} tests passed across ${String(packages.length)} packages; ${String(cases.filter((row) => Object.values(row.cells).every((entry) => entry.state === 'passed')).length)} of ${String(cases.length)} shared cases passed on every image of the matrix.`,
      ...again,
    ].join(' '),
    '',
    ...derivedLimitations(report).map((sentence) => `- ${sentence}`),
  ].join('\n')
}
