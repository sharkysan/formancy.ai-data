import { describe, expect, test } from 'vitest'
import { renderContent, renderSummary } from './render.mjs'
import { buildReport } from './report.mjs'
import { CASES, copy, greenRun, job, server, withImageLeg } from './synthetic-run.mjs'

/**
 * The report over a matrix of images (0067): every shared case on every
 * image of every engine's matrix, each test's image taken from the servers
 * its own leg recorded for its own file, never from a leg's name; a suite's
 * results per leg; and what fails the run when an image of the matrix left
 * nothing. A run made by hand, as report.test.mjs's, with PostgreSQL's
 * matrix holding 16 beside 17 and data-postgres's suite run again on it.
 */
const SIXTEEN = 'postgres:16-alpine'
const LEG = 'test-images-data-postgres-postgres-16-alpine'
const SQLSERVER = 'mcr.microsoft.com/mssql/server:2022-latest'

/** A green run with the 16 leg, and `change` applied to it. */
function withLeg(change = () => {}) {
  const inputs = withImageLeg(copy(greenRun()))
  change(inputs)
  return buildReport(inputs)
}

describe('a run with an image leg', () => {
  // The control for every case below: a check red on a run whose every leg
  // passed is noise, and gets switched off.
  test('in which every leg passed is a green run, with a column per image', () => {
    const report = withLeg()
    expect(report.problems).toEqual([])
    expect(report.sharedCases.columns).toEqual([
      { engine: 'postgres', image: 'postgres:17-alpine', default: true },
      { engine: 'postgres', image: SIXTEEN, default: false },
      { engine: 'sqlserver', image: SQLSERVER, default: true },
    ])
    expect(report.sharedCases.rows.map((row) => Object.values(row.cells).map((cell) => cell.state))).toEqual([
      ['passed', 'passed', 'passed'],
      ['passed', 'passed', 'passed'],
    ])
  })

  // A leg that never ran, or whose artefact never came: its image is a
  // version the release names and nothing tested, unless the run fails.
  test('fails when an image of the matrix left no results, and says which cases it is missing', () => {
    expect(withLeg((inputs) => (inputs.results = inputs.results.filter((result) => result.key !== LEG))).problems).toEqual([
      `${CASES[0]}: passed on postgres:17-alpine, missing on ${SIXTEEN}, passed on ${SQLSERVER} (declared with covers(); see packages/data-fixtures/README.md)`,
      `${CASES[1]}: passed on postgres:17-alpine, missing on ${SIXTEEN}, passed on ${SQLSERVER} (declared with covers(); see packages/data-fixtures/README.md)`,
      `PostgreSQL's matrix image ${SIXTEEN} never answered a test in this run`,
    ])
  })

  // The leg named 16 whose suite ran on 17 -- FORMANCY_IMAGES dropped on the
  // way -- would count every case it passed for 16 if the image came from
  // the leg's name. It comes from the servers that leg's files started.
  test('counts a case for the image its file’s server answered on, never for the leg’s name', () => {
    const report = withLeg((inputs) => {
      job(inputs, LEG).servers = job(inputs, LEG).servers.map((entry) => ({ ...entry, image: 'postgres:17-alpine', version: '17.11' }))
    })
    expect(report.sharedCases.rows.map((row) => row.cells[SIXTEEN].state)).toEqual(['missing', 'missing'])
    expect(report.sharedCases.rows.map((row) => row.cells['postgres:17-alpine'].tests)).toEqual([2, 2])
    expect(report.problems).toContain(`PostgreSQL's matrix image ${SIXTEEN} never answered a test in this run`)
  })

  // A case that fails on one version and passes on the others is a version
  // the release would otherwise call tested; the failure names its image.
  test('fails a shared case that failed on one image only, and names the leg’s suite by its image', () => {
    const report = withLeg((inputs) => {
      const file = job(inputs, LEG).suites[0].files[0]
      file.tests[0].status = 'failed'
      file.status = 'failed'
    })
    expect(report.problems).toEqual([
      '@formancy/data-postgres on postgres:16-alpine: 1 test(s) failed: packages/data-postgres/src/parity.integration.test.ts › acme',
      '@formancy/data-postgres on postgres:16-alpine: packages/data-postgres/src/parity.integration.test.ts failed',
      `${CASES[1]}: passed on postgres:17-alpine, failed on ${SIXTEEN}, passed on ${SQLSERVER}`,
      'gate 1: its evidence did not pass in this run: packages/data-postgres/src/parity.integration.test.ts did not pass',
    ])
  })

  // A test whose file no server record of its leg names ran on an image
  // nobody can say: counted for none, it would leave its cases missing with
  // no word of why.
  test('fails a declaration whose file no server record of its leg names', () => {
    const report = withLeg((inputs) => {
      job(inputs, LEG).servers = job(inputs, LEG).servers.filter((entry) => !entry.caller.endsWith('records.integration.test.ts'))
    })
    expect(report.problems).toEqual([
      `${CASES[0]}: passed on postgres:17-alpine, missing on ${SIXTEEN}, passed on ${SQLSERVER} (declared with covers(); see packages/data-fixtures/README.md)`,
      `packages/data-postgres/src/records.integration.test.ts › edge values declares shared cases on postgres in ${LEG}, and no server that leg recorded names its file, so no image can be said for it`,
    ])
  })

  // A file that started two images ran its tests against both, and counts
  // for both: counting it for one would leave the other missing.
  test('counts a file that started two images for both', () => {
    const report = withLeg((inputs) => {
      inputs.results = inputs.results.filter((result) => result.key !== LEG)
      for (const file of ['parity', 'records']) job(inputs, 'test-data-postgres').servers.push(server({ image: SIXTEEN, version: '16.15', caller: `packages/data-postgres/src/${file}.integration.test.ts` }))
    })
    expect(report.sharedCases.rows.map((row) => [row.cells['postgres:17-alpine'].state, row.cells[SIXTEEN].state])).toEqual([
      ['passed', 'passed'],
      ['passed', 'passed'],
    ])
    expect(report.problems).toEqual([])
  })
})

describe('a suite’s results, per leg', () => {
  // One row for a package's legs together would count each test once per
  // image and add the legs' wall times, which ran beside each other: a
  // figure of no run.
  test('are one row per leg, each with its own counts and wall time', () => {
    const rows = withLeg().results.packages.filter((row) => row.package === '@formancy/data-postgres')
    expect(rows.map(({ image, jobs, tests, wallMs }) => ({ image, jobs, tests, wallMs }))).toEqual([
      { image: null, jobs: ['test-data-postgres'], tests: 2, wallMs: 14_000 },
      { image: SIXTEEN, jobs: [LEG], tests: 2, wallMs: 14_000 },
    ])
  })

  // The release body's count is of tests, each once; an image leg's runs are
  // said apart, so the same test passing twice is not two tests.
  test('are counted apart from the default legs in the summary', () => {
    const summary = renderSummary(withLeg())
    expect(summary).toContain('7 of 7 tests passed across 4 packages; 2 of 2 shared cases passed on every image of the matrix.')
    expect(summary).toContain('The suite of `@formancy/data-postgres` ran again on `postgres:16-alpine`: 2 of 2 tests passed.')
  })
})

describe('the report’s words for the matrix', () => {
  // What the matrix ran on is said from the servers' answers, per image,
  // with the suites that ran there; a reader is otherwise left with the
  // default's sentence for a run that tested more.
  test('name every image of the matrix, what it answered and which suites ran on it', () => {
    const markdown = renderContent(withLeg())
    expect(markdown).toContain(
      'Every PostgreSQL test ran on `postgres:17-alpine`, which answered 17.11 in this run; the suite of `@formancy/data-postgres` also ran on `postgres:16-alpine` (16.15). No other version, edition or managed service was tested.',
    )
    expect(markdown).toContain(`| Case | postgres:17-alpine | ${SIXTEEN} | ${SQLSERVER} |`)
    expect(markdown).toContain('| @formancy/data-postgres on postgres:16-alpine | yes |')
  })

  // A red run still says what ran: an image of the matrix nothing answered on
  // is named, beside the problem that fails the run.
  test('say an image of the matrix nothing ran on', () => {
    const markdown = renderContent(withLeg((inputs) => (inputs.results = inputs.results.filter((result) => result.key !== LEG))))
    expect(markdown).toContain('Every PostgreSQL test ran on `postgres:17-alpine`, which answered 17.11 in this run; no test ran on `postgres:16-alpine`, an image of the matrix. No other version')
  })
})

describe('a local run', () => {
  // One machine runs the defaults unless FORMANCY_IMAGES says otherwise; a
  // local report that allows the image legs missing says so in its banner,
  // and still fails a case that failed on an image it did run.
  test('may allow the image legs missing, and then holds only the images that ran', () => {
    const local = (allowMissing, change = () => {}) => {
      const inputs = withImageLeg(copy(greenRun()))
      inputs.results = inputs.results.filter((result) => result.key !== LEG)
      inputs.allowMissing = allowMissing
      change(inputs)
      return buildReport(inputs).problems
    }
    expect(local(['test-images'])).toEqual([])
    expect(local([])).toContain(`PostgreSQL's matrix image ${SIXTEEN} never answered a test in this run`)
    expect(
      local(['test-images'], (inputs) => {
        const file = job(inputs, 'test-data-postgres').suites[0].files[1]
        file.tests[0].status = 'failed'
        file.status = 'failed'
      }),
    ).toContain(`${CASES[0]}: failed on postgres:17-alpine, missing on ${SIXTEEN}, passed on ${SQLSERVER}`)
  })
})
