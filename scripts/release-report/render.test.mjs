import { describe, expect, test } from 'vitest'
import { derivedLimitations, renderContent, renderReport, renderSummary } from './render.mjs'
import { buildReport } from './report.mjs'
import { copy, greenCiRun, greenRun, job, server } from './synthetic-run.mjs'

/**
 * The report's derived limitations and its Markdown (0035), over a run made
 * by hand. A limitation the run shows is a fixed sentence with the run's
 * facts in it; each test here fails when its sentence's template is gone,
 * which is how a limitation stops being said without anybody deciding so.
 */
const report = (change = () => {}) => {
  const inputs = copy(greenRun())
  change(inputs)
  return buildReport(inputs)
}

describe('the limitations a run shows', () => {
  // The host page's gate starts PostgreSQL only (0029). Said by the run, a
  // gate that someday starts both stops saying it without an edit here.
  test('name a gate that ran against fewer engines than the product speaks', () => {
    expect(derivedLimitations(report())).toContain('The browser gate of apps/host ran against PostgreSQL only.')
  })

  // An app whose suite starts no database renders from captured snapshots,
  // and the reader is told from what.
  test('say an environment started no database, and which snapshots it runs on', () => {
    const sentences = derivedLimitations(
      report((inputs) => {
        inputs.apps.push({ path: 'apps/studio', name: '@formancy/data-studio', renderers: [{ name: 'React', version: '19.3.0' }], jsdom: '30.1.2' })
        inputs.covered.push({ path: 'apps/studio', id: 'app-studio', name: '@formancy/data-studio' })
        inputs.results.push({ ...job(inputs, 'test-app-host'), key: 'test-app-studio', servers: [], suites: [{ ...job(inputs, 'test-app-host').suites[0], package: '@formancy/data-studio', path: 'apps/studio' }] })
      }),
    )
    expect(sentences).toContain('The suite of apps/studio, in jsdom 30.1.2, started no database; it runs on snapshots captured from PostgreSQL 17.11.')
  })

  // 0003: an image a test starts is part of what is tested, for that test.
  // The sentence names the file and what its server answered, and never
  // calls it a probe or something outside the matrix.
  test('name the tests that ran on an image other than the default, and what it answered', () => {
    const sentences = derivedLimitations(
      report((inputs) => job(inputs, 'test-data-postgres').servers.push(server({ image: 'postgres:18-alpine', version: '18.6', caller: 'packages/data-postgres/src/discovery-pg18.integration.test.ts' }))),
    )
    const postgres = sentences.find((sentence) => sentence.startsWith('Every PostgreSQL test'))
    expect(postgres).toBe(
      'Every PostgreSQL test ran on `postgres:17-alpine`, which answered 17.11 in this run, except the tests in `packages/data-postgres/src/discovery-pg18.integration.test.ts`, which ran on `postgres:18-alpine` (18.6). No other version, edition or managed service was tested.',
    )
    expect(postgres).not.toMatch(/probe|not part of/)
    expect(sentences.find((sentence) => sentence.startsWith('Every SQL Server test'))).toBe(
      'Every SQL Server test ran on `mcr.microsoft.com/mssql/server:2022-latest`, which answered 16.0.4295.3 (CU20, Developer Edition (64-bit)) in this run. No other version, edition or managed service was tested.',
    )
  })

  // A run whose default image never answered fails (report.test.mjs), and
  // what it did run on is still said: "no server answered" beside a table
  // of answers would be false, and only a red report would show it.
  test('say what the tests ran on when the default image never answered', () => {
    const sentences = derivedLimitations(
      report((inputs) => {
        for (const result of inputs.results) result.servers = result.servers.map((entry) => (entry.engine === 'postgres' ? { ...entry, image: 'postgres:18-alpine', version: '18.6' } : entry))
      }),
    )
    expect(sentences.find((sentence) => sentence.includes('PostgreSQL test'))).toBe(
      'No PostgreSQL test ran on the default `postgres:17-alpine` in this run; the tests in `apps/host/scripts/browser-test.mjs`, `apps/host/src/test-databases.ts` and `packages/data-postgres/src/parity.integration.test.ts` ran on `postgres:18-alpine` (18.6). No other version, edition or managed service was tested.',
    )
    const none = derivedLimitations(report((inputs) => (inputs.results = inputs.results.map((result) => ({ ...result, servers: result.servers.filter((entry) => entry.engine !== 'postgres') })))))
    expect(none).toContain('No PostgreSQL server answered a test in this run.')
  })

  // A published range admits versions no suite ran; a clean install on the
  // day of the run is the evidence of one.
  test('name a dependency a clean install resolved past what the suites ran', () => {
    const sentences = derivedLimitations(report((inputs) => (job(inputs, 'install').install.resolved[1].version = '5.13.0')))
    expect(sentences).toContain('A clean npm install on 2026-10-09 resolved `fastify` 5.13.0 (the suites ran 5.12.5), which no suite ran.')
    expect(derivedLimitations(report()).some((sentence) => sentence.startsWith('A clean npm install'))).toBe(false)
  })

  // Neither the suites' source-not-dist nor the gate's image being rebuilt
  // by the release may go unsaid.
  test("say the suites ran the source, which dist/ npm receives, and which image the container gate ran", () => {
    const sentences = derivedLimitations(report())
    // The jobs named are the ones that built every published package: the
    // adapters' test jobs built data-core only, and naming them would say
    // they built the adapters too.
    const identity = sentences.find((sentence) => sentence.includes('published dist/'))
    expect(identity).toBe(
      "Each package's own suites ran its source; the published dist/ was run by the install gate, and each package's is byte-identical to its dist/ built in browser, install and verify, and in every other job that built it (*Build identity* names them).",
    )
    expect(identity).not.toContain('test-data-')
    expect(sentences).toContain('The container gate ran the image it built from this commit; the release builds the published image again, named by its digest.')
    expect(sentences).toContain('The browser gates launched Chromium 153.0.8010.12 only.')
    expect(sentences).toContain('Every runtime dependency is published as a range; the suites ran the versions *Tested on* names.')
    expect(sentences).toContain('The suites ran on Node v22.20.0; the server image runs v22.12.0; no published package declares the Node versions it supports.')
  })
})

describe('the Markdown', () => {
  // A gate's timing on a shared runner is an observation, not a performance
  // figure (0034): shown labelled as that, and kept out of a release's body.
  test('shows a measurement as an observation, and leaves it out of the summary', () => {
    const built = report()
    const markdown = renderContent(built)
    const observations = markdown.slice(markdown.indexOf('## Observations on a shared runner'), markdown.indexOf('## Problems'))
    expect(observations).toContain('Not a performance figure (0034)')
    expect(observations).toContain('| apps/host | Chromium resent the create after its connection closed | 12.4, 9.6 | ms | 2 | ubuntu24 20261005.1 |')
    expect(renderSummary(built)).not.toContain('Chromium resent the create')
    expect(markdown).toContain('None: nothing here fails the run.')
  })

  // A blank cell reads as nothing to report; a wall time or a coverage no
  // file of this run gave is said to be not measured.
  test('says a wall time or a coverage this run has no file for is not measured', () => {
    const markdown = renderContent(
      report((inputs) => {
        const suite = job(inputs, 'test-data-core').suites[0]
        suite.task = null
        suite.coverage = null
      }),
    )
    const row = markdown.split('\n').find((line) => line.startsWith('| @formancy/data-core |'))
    expect(row).toMatch(/\| not measured \| [\d.]+ s \| {2}\| not measured \|$/)
  })

  // Every register line names the record that states it, and a held line
  // says its test passed in this run.
  test('prints a stated limitation with its record, its status and its test', () => {
    // A Status line's relative link to a later record is made absolute: from a report, a relative one goes nowhere.
    const narrowed = renderContent(report((inputs) => (inputs.records[0].status = 'accepted; narrowed by [0028](0028-filters.md)')))
    expect(narrowed).toContain('(accepted; narrowed by [0028](https://github.com/sharkysan/formancy.ai-data/blob/c0ffee/docs/decisions/0028-filters.md))')
    expect(renderContent(report())).toContain(
      '- Lookup labels are not unique. — stated by [0012 A lookup token is a reference](https://github.com/sharkysan/formancy.ai-data/blob/c0ffee/docs/decisions/0012-a-lookup-token.md#consequences) (accepted); held by `packages/data-core/src/labels.test.ts`, passed in this run',
    )
  })
})

describe('the release gates, as a report shows them', () => {
  // A figures document from another commit is stated, with when it last
  // changed and how far behind this commit it is, and never "passed" (0034).
  test('show a gate whose only evidence is a document as stated, with its last change', () => {
    const built = report()
    const markdown = renderContent(built)
    const gates = markdown.slice(markdown.indexOf('## Release gates'), markdown.indexOf('## Known limitations'))
    expect(gates).toContain('| 11 | stated, not exercised by this run | stated in `docs/release/figures.md`, last changed 2026-10-01 at `1234567`, 3 commit(s) before this one |')
    expect(gates).not.toMatch(/\| \d+ \| [^|]*\bmet\b/)
    expect(derivedLimitations(built)).toContain('Release gate 11 is stated in `docs/release/figures.md`, last changed 2026-10-01 at `1234567`, 3 commit(s) before this one; not exercised by this run.')
  })

  // An open gate is a limitation of every release until it closes; said by
  // the register, it stops being said only when the register changes.
  test('say every open gate as a limitation, with its reason', () => {
    expect(derivedLimitations(report())).toContain('Release gate 8 is open: Nothing to test yet.')
    expect(renderContent(report())).toContain('| 3 | evidence passed in this run | `packages/data-sqlserver/src/records.integration.test.ts`: passed |')
  })
})

describe('the subject and the summary', () => {
  // A report that does not say which run, commit and release it is of
  // cannot be told apart from another one.
  test('name the version, the release, the commit and the run', () => {
    const inputs = copy(greenCiRun())
    inputs.release = 'dry-run'
    const markdown = renderReport(buildReport(inputs))
    expect(markdown).toContain('Formancy Data 0.1.0, a rehearsal (`dry-run`); nothing is published from it. Commit `c0ffee`. Run [42](https://github.com/sharkysan/formancy.ai-data/actions/runs/42) of CI, attempt 1.')
    expect(markdown).toContain('| getting-started-runner | 1 | ubuntu24 20261005.1 | v22.20.0 | linux x64 | 29.8.1 |')
    expect(renderReport(report(), { local: true, partial: ['install'] })).toContain('local: no NEEDS, no artefacts; partial: install allowed missing.')
    // A local run of a tree with uncommitted changes did not run that commit.
    const dirty = report((inputs) => (inputs.results[0].dirty = true))
    expect(renderReport(dirty, { local: true })).toContain('Commit `c0ffee`, with uncommitted changes.')
    expect(renderReport(report(), { local: true })).toContain('Commit `c0ffee`. Generated')
  })

  // The body says where the whole report is and which changelog section it
  // opens with; a release reader otherwise cannot find either.
  test('carries the link to the full report and the section the notes are from', () => {
    const summary = renderSummary(report(), { section: 'Unreleased', link: 'https://example.invalid/report.md' })
    expect(summary).toContain('The full report of the run that gated this: https://example.invalid/report.md')
    expect(summary).toContain('The notes above are CHANGELOG.md’s `Unreleased` section.')
  })

  // Every section names where it comes from, so a reader can check one.
  test('say how each section was made', () => {
    const markdown = renderContent(report())
    const method = markdown.slice(markdown.indexOf('## How this report was made'), markdown.indexOf('## Problems'))
    for (const section of ['Subject', 'Tested on', 'Results', 'Shared cases', 'Build identity', 'Release gates', 'Known limitations']) expect(method).toContain(`- **${section}:**`)
  })
})
