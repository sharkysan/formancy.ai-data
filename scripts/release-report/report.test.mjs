import { describe, expect, test } from 'vitest'
import { buildReport } from './report.mjs'
import { CASES, ciJob, copy, DIST, greenCiRun, greenRun, job, server } from './synthetic-run.mjs'

/**
 * What fails a run (0035), for what the report shows of versions, results,
 * shared cases, the browser matrix, build identity and the limitations: a
 * run made by hand in which everything passed, and each defect introduced
 * into a copy of it once, giving exactly its sentence. Pure logic over
 * hand-made results files.
 */
const problemsOf = (inputs) => buildReport(inputs).problems

/** `greenRun()` with `change` applied to a copy. */
function withDefect(change) {
  const inputs = copy(greenRun())
  change(inputs)
  return problemsOf(inputs)
}

describe('a green run', () => {
  // A check that is red on good input is noise, and gets switched off.
  test('has no problems', () => {
    expect(problemsOf(greenRun())).toEqual([])
  })
})

describe('a package’s suite', () => {
  // A package whose job left nothing would be a package nobody tested, in a
  // report that said nothing about it.
  test('with no results fails the run', () => {
    expect(withDefect((inputs) => (inputs.results = inputs.results.filter((result) => result.key !== 'test-app-host')))).toEqual(['@formancy/data-host: no results from its suite'])
  })

  // CLAUDE.md: a suite that can be skipped is a suite that is skipped.
  test('with a skipped test fails the run', () => {
    expect(
      withDefect((inputs) => {
        job(inputs, 'test-data-core').suites[0].files[0].tests[0].status = 'skipped'
      }),
    ).toEqual(['@formancy/data-core: 1 test(s) did not run (skipped), and a suite that can be skipped is a suite that is skipped: packages/data-core/src/a.test.ts › parses an amount'])
  })

  test('with a failed test fails the run', () => {
    expect(
      withDefect((inputs) => {
        const file = job(inputs, 'test-data-core').suites[0].files[0]
        file.tests[0].status = 'failed'
        file.status = 'failed'
        job(inputs, 'test-data-core').suites[0].success = false
      }),
    ).toEqual([
      '@formancy/data-core: 1 test(s) failed: packages/data-core/src/a.test.ts › parses an amount',
      '@formancy/data-core: packages/data-core/src/a.test.ts failed',
      '@formancy/data-core: vitest reported the run unsuccessful',
    ])
  })

  // An afterAll that threw, or a file that failed to collect, leaves every
  // test it reached passed and the file failed: green counts over a red file.
  test('with a failed file whose tests all passed fails the run', () => {
    expect(
      withDefect((inputs) => {
        job(inputs, 'test-data-core').suites[0].files[0].status = 'failed'
      }),
    ).toEqual(['@formancy/data-core: packages/data-core/src/a.test.ts failed though every test in it passed: a collection error, or a hook that threw'])
  })

  test('that vitest called unsuccessful fails the run', () => {
    expect(
      withDefect((inputs) => {
        job(inputs, 'test-data-core').suites[0].success = false
      }),
    ).toEqual(['@formancy/data-core: vitest reported the run unsuccessful'])
  })

  // What collect expected and did not find -- a turbo summary, a gate's
  // file, a stale result in local mode -- is not results at all.
  test('whose job missed a file fails the run', () => {
    expect(withDefect((inputs) => job(inputs, 'test-data-core').missing.push('packages/data-core/test-results/vitest.json'))).toEqual([
      'test-data-core: expected and not found: packages/data-core/test-results/vitest.json',
    ])
  })
})

describe('the shared cases', () => {
  // Release gate 1 as a check: a case asserted through one adapter only.
  test('fail the run for a case no SQL Server test declares', () => {
    expect(
      withDefect((inputs) => {
        for (const entry of job(inputs, 'test-data-sqlserver').suites[0].files) for (const one of entry.tests) one.meta.covers = one.meta.covers.filter((id) => id !== CASES[1])
      }),
    ).toEqual([`${CASES[1]}: passed on postgres, missing on sqlserver (declared with covers(); see packages/data-fixtures/README.md)`])
  })

  // An id typed by hand, or left behind when the data changed, is a
  // declaration that counts for nothing.
  test('fail the run for a declared id that is no shared case', () => {
    expect(
      withDefect((inputs) => {
        job(inputs, 'test-data-postgres').suites[0].files[0].tests[0].meta.covers.push('filter: tenant_code = "nobody"')
      }),
    ).toEqual(['packages/data-postgres/src/parity.integration.test.ts › acme declares "filter: tenant_code = "nobody"", which is no shared case'])
  })
})

describe('versions', () => {
  // The browser that ran is the one Playwright pins, or the report names a
  // browser nobody chose.
  test('fail the run when a gate launched a browser other than the pin', () => {
    expect(
      withDefect((inputs) => {
        job(inputs, 'browser').browserGates[0].browser.version = '152.0.7000.1'
      }),
    ).toEqual(['the browser gates of apps/host launched chromium 152.0.7000.1, not the 153.0.8010.12 Playwright 1.63.0 pins'])
  })

  // A run whose PostgreSQL tests all started another image would report the
  // default as tested on the README's word alone.
  test('fail the run when an engine’s default image never answered a test', () => {
    expect(
      withDefect((inputs) => {
        for (const result of inputs.results) {
          result.servers = result.servers.map((entry) => (entry.engine === 'postgres' ? { ...entry, image: 'postgres:18-alpine' } : entry))
        }
      }),
    ).toEqual(["PostgreSQL's default image postgres:17-alpine never answered a test in this run"])
  })

  // A server whose record names no file cannot be said to have run any test.
  test('fail the run for a server on another image that no file asked for', () => {
    expect(withDefect((inputs) => job(inputs, 'test-data-postgres').servers.push(server({ image: 'postgres:18-alpine', version: '18.6', caller: null })))).toEqual([
      'PostgreSQL on postgres:18-alpine answered a test whose file no record names',
    ])
  })
})

describe('build identity', () => {
  // Two jobs with different bytes for one package mean the dist/ a
  // dependent's suite ran is not the one npm receives.
  test('fails the run when two jobs built different dist/ bytes', () => {
    const other = `sha256:${'b'.repeat(64)}`
    expect(
      withDefect((inputs) => {
        job(inputs, 'test-data-postgres').dist[0].distHash = other
      }),
    ).toEqual([
      `@formancy/data-core: two jobs built different dist/ bytes: verify, test-data-sqlserver, browser, install built ${DIST.slice(0, 19)}; test-data-postgres built ${other.slice(0, 19)}`,
    ])
  })

  // One number for every package is what a release publishes (bump.mjs); a
  // tarball at another is found on the pull request, not at the tag.
  test("fails the run when a tarball's version is not data-core's", () => {
    expect(
      withDefect((inputs) => {
        job(inputs, 'install').install.tarballs[1].version = '0.2.0'
      }),
    ).toEqual(["the install gate packed @formancy/data-postgres 0.2.0, where every published package is at data-core's version, 0.1.0"])
  })

  // A tarball whose package no job recorded building is compared with
  // nothing, and an identity rule that passes on nothing says the published
  // dist/ is a build no job made.
  test("fails the run when no job recorded a published package's dist/", () => {
    expect(
      withDefect((inputs) => {
        for (const result of inputs.results) result.dist = result.dist.filter((entry) => entry.package !== '@formancy/data-sqlserver')
      }),
    ).toEqual(['@formancy/data-sqlserver: no job recorded its dist/, so the dist/ in its tarball is compared with nothing'])
  })

  // The tarball is what npm receives; its dist/ must be every job's.
  test("fails the run when a tarball's dist/ differs from verify's", () => {
    expect(
      withDefect((inputs) => {
        job(inputs, 'install').install.tarballs[1].distHash = `sha256:${'c'.repeat(64)}`
      }),
    ).toEqual(['@formancy/data-postgres: the dist/ in its tarball differs from the dist/ built in verify, browser, install'])
  })
})

describe('the limitations', () => {
  // A line held by a test is printed with "passed in this run"; when that
  // test failed, the line may no longer hold, and the run says so.
  test('fail the run when the test a line is held by did not pass', () => {
    expect(
      withDefect((inputs) => {
        const held = job(inputs, 'test-data-core').suites[0].files[1]
        held.tests[0].status = 'failed'
        held.status = 'failed'
      }),
    ).toContain('0012\'s "Lookup labels are not unique." is held by packages/data-core/src/labels.test.ts, which did not pass in this run')
  })
})

describe('a local run', () => {
  // A local report that allowed getting-started missing did not run it: a
  // composed record found on the machine -- left by another run, or written
  // by hand -- would be reported as a compose run nobody made.
  test('says nothing of a composed database when getting-started is allowed missing', () => {
    const composed = (allowMissing) => {
      const inputs = copy(greenRun())
      inputs.allowMissing = allowMissing
      job(inputs, 'verify').servers.push(server({ script: 'getting-started', caller: 'scripts/getting-started.mjs', package: null }))
      return buildReport(inputs).testedOn.engines.flatMap((engine) => engine.images.flatMap((image) => image.composed))
    }
    expect(composed(['getting-started'])).toEqual([])
    expect(composed([])).toEqual([{ version: '17.11', job: 'verify' }])
  })
})

/** A CI run's problems after `change` to a copy of greenCiRun(). */
function ciDefect(change) {
  const inputs = copy(greenCiRun())
  change(inputs)
  return problemsOf(inputs)
}

describe('a green CI run', () => {
  // Every job's artefact, every need a success: a check red here is noise.
  test('has no problems, and its subject is that run', () => {
    const report = buildReport(greenCiRun())
    expect(report.problems).toEqual([])
    expect(report.subject).toMatchObject({ version: '0.1.0', release: null, commit: 'c0ffee', run: { id: '42' } })
    expect(report.subject.jobs.map((entry) => entry.key)).toContain('getting-started-runner')
  })
})

describe('the run', () => {
  // A job that failed or was cancelled may still have uploaded results that
  // look green; the job's own result is the last word.
  test('fails when a job of the gates ended other than success', () => {
    expect(ciDefect((inputs) => (inputs.needs.browser.result = 'failure'))).toEqual(['the browser job ended failure'])
  })

  // A job missing from the report's needs is one whose end it never waited for.
  test('fails when the report’s needs do not name a job', () => {
    expect(ciDefect((inputs) => delete inputs.needs.container)).toEqual(['the report\'s needs do not name the container job, so how it ended is unknown'])
  })

  // An artefact uploaded twice under one name -- a job re-run that kept both
  // -- would be two answers for one job, one of them read.
  test('fails an artefact that appears twice', () => {
    expect(ciDefect((inputs) => inputs.artefacts.push(structuredClone(inputs.artefacts.find((entry) => entry.name === 'release-results-container'))))).toEqual([
      'release-results-container appears 2 times, where one job leaves it once',
    ])
  })

  // A name the workflow does not give is results the report would read as
  // nobody's, and the job it should have been is then missing.
  test('fails an artefact no job leaves, and names the job whose artefact is then missing', () => {
    expect(ciDefect((inputs) => (inputs.artefacts.find((entry) => entry.name === 'release-results-container').name = 'release-results-containr'))).toEqual([
      'container: its job left no artefact release-results-container',
      'release-results-containr is no artefact a job of .github/workflows/gates.yml leaves',
    ])
  })

  // A directory holding another key's file is a job reported under the
  // wrong name.
  test('fails an artefact whose results are another job’s', () => {
    expect(
      ciDefect((inputs) => {
        const artefact = inputs.artefacts.find((entry) => entry.name === 'release-results-container')
        artefact.files[0].result.job = 'install'
      }),
    ).toEqual(['release-results-container holds container.json, the results of key container from job install, where it holds container.json from job container'])
  })

  // Results from another run -- a re-run's leftovers, or another commit's --
  // describe a run that is not this one.
  test('fails results from another run or another commit', () => {
    expect(ciDefect((inputs) => (ciJob(inputs, 'test-data-core').run.id = '41'))).toEqual(['release-results-test-data-core is from run 41, not this run\'s 42'])
    expect(ciDefect((inputs) => (ciJob(inputs, 'install').commit = 'decaf'))).toEqual(['release-results-install is from commit decaf, not this run\'s c0ffee'])
  })
})

describe('the release gates', () => {
  // Evidence that did not run is not evidence that passed.
  test('fail the run when a gate’s evidence file did not run', () => {
    expect(
      ciDefect((inputs) => {
        const suite = ciJob(inputs, 'test-data-sqlserver').suites[0]
        suite.files = suite.files.filter((entry) => !entry.file.endsWith('records.integration.test.ts'))
        for (const entry of suite.files) for (const one of entry.tests) one.meta.covers = [...one.meta.covers, 'edge: orderDate']
      }),
    ).toEqual(['gate 3: its evidence did not pass in this run: packages/data-sqlserver/src/records.integration.test.ts did not run'])
  })

  // Gate 9 rests on the getting-started job; a red job is a gate not passed.
  test('fail the run when a gate’s job did not succeed', () => {
    expect(ciDefect((inputs) => (inputs.needs['getting-started'].result = 'failure'))).toEqual([
      'the getting-started job ended failure',
      'gate 9: its evidence did not pass in this run: the getting-started job ended failure',
    ])
  })

  // The register is read every run; one that does not hold is a report of
  // gates nobody can judge.
  test('fail the run when the register does not hold', () => {
    expect(ciDefect((inputs) => inputs.gatesRegister.gates.splice(6, 1))).toEqual(['docs/release/gates.json: the gates are 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, where the plan numbers 1 to 12, each once and in order'])
  })

  // A document is stated, and a stated gate is a limitation, not a failure.
  test('show a gate whose evidence is a document as stated, without failing the run', () => {
    const report = buildReport(greenCiRun())
    expect(report.gates.find((entry) => entry.gate === 11).state).toBe('stated')
    expect(report.problems).toEqual([])
  })
})

describe('a release', () => {
  // A tag that disagrees with the manifests would publish the wrong version
  // under the right name; found here, before anything is published.
  test('fails when its tag is not data-core’s version', () => {
    expect(ciDefect((inputs) => (inputs.release = 'v0.2.0'))).toEqual(["the release v0.2.0 is not v0.1.0, data-core's version"])
  })

  // A tag whose version has no section would be released with no notes.
  test('fails when the changelog has no section for its version', () => {
    expect(
      ciDefect((inputs) => {
        inputs.release = 'v0.1.0'
        inputs.changelog = inputs.changelog.replace('## 0.1.0', '## 0.0.9')
      }),
    ).toEqual(['CHANGELOG.md has no section for 0.1.0'])
  })

  // A rehearsal renders the body that would be released: the version's
  // section when it has one, Unreleased otherwise, and with neither it fails.
  test('rehearses with the version’s section, then Unreleased, and fails with neither', () => {
    const rehearsal = (change = () => {}) => {
      const inputs = copy(greenCiRun())
      inputs.release = 'dry-run'
      change(inputs)
      return buildReport(inputs)
    }
    expect(rehearsal().release).toMatchObject({ release: 'dry-run', section: '0.1.0' })
    expect(rehearsal((inputs) => (inputs.changelog = inputs.changelog.replace('## 0.1.0', '## 0.0.9'))).release.section).toBe('Unreleased')
    expect(rehearsal((inputs) => (inputs.changelog = '# Changelog\n\n## 0.0.9\n\nOld.\n')).problems).toEqual(['CHANGELOG.md has no section for Unreleased'])
  })

  // GitHub refuses a body over 125,000 characters, after npm already holds
  // the version; the report refuses it first.
  test('fails a body longer than GitHub accepts, and CI only measures it', () => {
    const long = (release) =>
      ciDefect((inputs) => {
        inputs.release = release
        inputs.changelog = inputs.changelog.replace('The first.', 'x'.repeat(125_000))
      })
    expect(long('v0.1.0')).toEqual([expect.stringMatching(/^the release body is \d+ characters, over the 125000 GitHub accepts$/)])
    expect(long('')).toEqual([])
  })
})
