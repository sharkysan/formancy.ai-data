import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { namedPackages } from './collect.mjs'
import { collectStep, expectedKeys, gateJobs, readWorkflow } from './workflows.mjs'

/**
 * The shape of the three workflows a release depends on (0035), parsed with
 * `yaml`: CI and the release run one gates workflow; the release decides once
 * whether it publishes; every check on what it would publish runs in a job
 * that holds `contents: read` and no secret, and pins what it checked; and
 * everything permanent is in one job behind one condition, which publishes
 * only what was pinned, in the order that leaves npm, which nothing can undo,
 * as late as it can be. This holds the shape, not the behaviour: the publish
 * job has never run, and a rehearsal exercises everything else.
 */
const gates = readWorkflow(undefined, '.github/workflows/gates.yml')
const ci = readWorkflow(undefined, '.github/workflows/ci.yml')
const release = readWorkflow(undefined, '.github/workflows/release.yml')

const PUBLISHING = "${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') }}"
const ONLY_WHEN_PUBLISHING = "needs.tag.outputs.publishing == 'true'"

/** Every step of every job of a workflow, with its job's id. */
const steps = (workflow) => Object.entries(workflow.jobs).flatMap(([job, definition]) => (definition.steps ?? []).map((step) => ({ job, step })))

/** Every string a step hands to the runner: its run, each `with` and each `env` value. */
const handed = (step) => [step.run, ...Object.values(step.with ?? {}), ...Object.values(step.env ?? {})].filter((value) => typeof value === 'string')

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** What a module imports by name, statically or with a literal `import()`, outside the files of the repository: `node:` built-ins and packages. */
function foreignImports(file, seen = new Set()) {
  if (seen.has(file)) return []
  seen.add(file)
  const text = readFileSync(file, 'utf8')
  const specifiers = [...text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((match) => match[1] ?? match[2] ?? match[3])
  return specifiers.flatMap((specifier) => (specifier.startsWith('.') ? foreignImports(resolve(dirname(file), specifier), seen) : specifier.startsWith('node:') ? [] : [`${file.slice(repo.length + 1).replaceAll('\\', '/')} imports ${specifier}`]))
}

describe('the jobs that install nothing', () => {
  // The container and getting-started gates, and the release's publish job,
  // run with Node and no install: a script of theirs that imported a package
  // would fail there and nowhere else -- in publish, at the first tag. Every
  // script such a job runs, and everything it imports from the repository,
  // imports only Node's built-ins.
  test('run scripts that import nothing but Node’s built-ins', () => {
    const scripts = []
    for (const workflow of [gates, release]) {
      for (const [id, job] of Object.entries(workflow.jobs)) {
        if (job.steps === undefined || job.steps.some((step) => /\b(?:pnpm|npm) (?:install|ci)\b/.test(String(step.run)))) continue
        for (const step of job.steps) for (const [, script] of String(step.run ?? '').matchAll(/\bnode (scripts\/\S+\.mjs)/g)) scripts.push({ id, script })
      }
    }
    expect(scripts.map(({ id, script }) => `${id}: ${script}`)).toEqual(expect.arrayContaining(['publish: scripts/release-report/verify-publish.mjs', 'publish: scripts/release-report/publish.mjs', 'container: scripts/release-report/collect.mjs', 'getting-started: scripts/getting-started.mjs']))
    expect(scripts.flatMap(({ script }) => foreignImports(join(repo, script)))).toEqual([])
  })
})

describe('ci.yml', () => {
  // CI and the release must run the same gates; two copies of them drift.
  // A secret is handed over by name: `secrets: inherit` would give the gates
  // every secret the repository holds.
  test('is one job that runs gates.yml with the coverage token and nothing else', () => {
    expect(Object.keys(ci.jobs)).toEqual(['gates'])
    expect(ci.jobs.gates.uses).toBe('./.github/workflows/gates.yml')
    expect(ci.jobs.gates.secrets).toEqual({ CODECOV_TOKEN: '${{ secrets.CODECOV_TOKEN }}' })
  })
})

describe('release.yml', () => {
  // A job added beside these would run with whatever it is given, outside
  // the order this file is about.
  test('has exactly its five jobs, on a version tag and on a dispatch', () => {
    expect(Object.keys(release.jobs)).toEqual(['tag', 'npm-token', 'gates', 'check', 'publish'])
    expect(release.on.push.tags).toEqual(['v*'])
    expect(Object.keys(release.on)).toEqual(['push', 'workflow_dispatch'])
    expect(release.permissions).toEqual({ contents: 'read' })
  })

  // The condition written twice is two conditions, one day different; a
  // dispatch must never satisfy it, and a missing output must not either.
  test('decides once, in the tag job, whether this run publishes', () => {
    const mode = release.jobs.tag.steps.find((step) => step.id === 'mode')
    expect(mode.env.PUBLISHING).toBe(PUBLISHING)
    expect(mode.run).toContain('publishing=$PUBLISHING')
    expect(Object.keys(release.jobs.tag.outputs).sort()).toEqual(['publishing', 'release', 'version'])
    expect(JSON.stringify(release).split('startsWith(github.ref').length - 1).toBe(1)
  })

  // The token is checked beside the gates, and read by no job but the two
  // that run only on a tag's push.
  test('reads NPM_TOKEN only in the npm-token and publish jobs, each behind the one condition', () => {
    expect(release.jobs['npm-token'].if).toBe(ONLY_WHEN_PUBLISHING)
    expect(release.jobs.publish.if).toBe(ONLY_WHEN_PUBLISHING)
    const reading = Object.entries(release.jobs).filter(([, job]) => JSON.stringify(job).includes('secrets.NPM_TOKEN')).map(([id]) => id)
    expect(reading).toEqual(['npm-token', 'publish'])
  })

  // The job that installs and builds holds nothing it could misuse; only the
  // job behind the condition may write, sign or push.
  test('gives publish, and only publish, more than reading the repository', () => {
    for (const [id, job] of Object.entries(release.jobs)) {
      if (id === 'publish' || id === 'gates') continue
      expect(job.permissions ?? { contents: 'read' }, id).toEqual({ contents: 'read' })
    }
    expect(release.jobs.check.permissions).toEqual({ contents: 'read' })
    expect(release.jobs.publish.permissions).toEqual({ contents: 'write', 'id-token': 'write', packages: 'write' })
  })

  // A release passes no secret to the gates, so the coverage upload never
  // runs in one, and its gates are CI's with the release named.
  test('runs the gates with the release named and no secret', () => {
    expect(release.jobs.gates.uses).toBe('./.github/workflows/gates.yml')
    expect(release.jobs.gates.with).toEqual({ release: '${{ needs.tag.outputs.release }}' })
    expect(release.jobs.gates).not.toHaveProperty('secrets')
  })

  // Every check on the content -- the gates, the report, the tarballs, the
  // SBOM, the body -- runs before the first permanent step, and npm, whose
  // versions nothing can delete, comes after signatures and the image.
  test('publishes after every check, in one job, with npm second to last', () => {
    const publish = release.jobs.publish
    expect(publish.needs).toEqual(expect.arrayContaining(['tag', 'npm-token', 'gates', 'check']))
    expect(publish.steps.filter((step) => step.if !== undefined).map((step) => step.id ?? step.name)).toEqual([])
    const ids = publish.steps.map((step) => step.id)
    const order = ['downloads-checked', 'sign-sbom', 'sign-report', 'image', 'sign-image', 'attest-sbom', 'npm-publish', 'github-release']
    expect(ids.filter((id) => order.includes(id))).toEqual(order)
  })

  // Every job of a run can write to its artefacts, `check` included, and
  // cdxgen, which `check` runs, has dependencies nothing locks. So `check`
  // pins the report and the tarballs before cdxgen runs, the SBOM after it
  // is checked, and `publish` refuses, before it signs anything and again
  // before npm, whatever it downloads that is not what was pinned.
  test('pins what check checked before cdxgen runs, and publishes nothing else', () => {
    const check = release.jobs.check
    expect(check.outputs).toEqual({ checked: '${{ steps.report-checked.outputs.checked }}', sbom: '${{ steps.sbom-checked.outputs.checked }}' })
    const ids = check.steps.map((step) => step.id)
    expect(ids.filter((id) => ['report-checked', 'sbom', 'sbom-checked'].includes(id))).toEqual(['report-checked', 'sbom', 'sbom-checked'])
    expect(check.steps.slice(0, ids.indexOf('report-checked')).filter((step) => /cdxgen|npx/.test(String(step.run)))).toEqual([])
    expect(check.steps.find((step) => step.id === 'report-checked').run).toContain('--stage content')
    expect(check.steps.find((step) => step.id === 'sbom-checked').run).toContain('--stage sbom')
    const publish = release.jobs.publish
    expect(publish.env).toMatchObject({ CHECKED: '${{ needs.check.outputs.checked }}', CHECKED_SBOM: '${{ needs.check.outputs.sbom }}', VERSION: '${{ needs.tag.outputs.version }}' })
    const downloads = publish.steps.findIndex((step) => step.id === 'downloads-checked')
    expect(publish.steps[downloads].run).toContain('--stage downloads')
    expect(publish.steps.slice(downloads + 1).filter((step) => String(step.uses).startsWith('actions/download-artifact'))).toEqual([])
    expect(publish.steps.find((step) => step.id === 'npm-publish').run).toContain('scripts/release-report/publish.mjs')
  })

  // A repository secret is readable by a workflow on any branch a
  // collaborator pushes; one in an environment whose deployment policy
  // admits only `v*` tags is not. The policy is a repository setting no test
  // here can see (REPO-METADATA.md); that the two jobs ask for it is held here.
  test('reads the npm token from the npm environment, in the two jobs that need it and no other', () => {
    expect(Object.entries(release.jobs).filter(([, job]) => job.environment !== undefined).map(([id, job]) => `${id}: ${String(job.environment)}`)).toEqual(['npm-token: npm', 'publish: npm'])
  })

  // A file named from a ref is a path a dispatch from `feat/x` gives a `/`;
  // every name comes from the tag job's `release` instead.
  test('names nothing from a ref outside the tag job’s mode step', () => {
    const ref = /GITHUB_REF(?:_NAME)?\b|github\.ref(?:_name)?\b/
    const naming = steps(release)
      .filter(({ job, step }) => !(job === 'tag' && step.id === 'mode'))
      .filter(({ step }) => handed(step).some((value) => ref.test(value)))
      .map(({ job, step }) => `${job}: ${step.id ?? step.name ?? step.uses}`)
    expect(naming).toEqual([])
    expect(Object.values(release.jobs).filter((job) => Object.values(job.env ?? {}).some((value) => ref.test(String(value))))).toEqual([])
  })

  // The release carries the report it was gated by, signed, beside the SBOM;
  // a file missing is a release without it, so a missing match fails.
  test('attaches the report and its signatures to the GitHub release', () => {
    const step = release.jobs.publish.steps.find((entry) => entry.id === 'github-release')
    const files = step.with.files.split('\n').map((line) => line.trim()).filter(Boolean)
    for (const kind of ['md', 'json']) {
      expect(files).toContain(`formancy-data-*-release-report.${kind}`)
      expect(files).toContain(`formancy-data-*-release-report.${kind}.sigstore`)
    }
    expect(step.with.fail_on_unmatched_files).toBe(true)
    expect(step.with.body_path).toBe('release-report/RELEASE_NOTES.md')
  })
})

describe('gates.yml', () => {
  // A job whose results the report never waits for is a job whose failure
  // it cannot see; one that is cancelled must still leave the report to run.
  test('ends in a report that waits for every other job and runs unless cancelled', () => {
    expect([...gates.jobs.report.needs].sort()).toEqual(gateJobs(gates).sort())
    expect(gates.jobs.report.if).toContain('!cancelled()')
    expect(gates.on.workflow_call.inputs.release).toMatchObject({ type: 'string', default: '' })
    expect(gates.on.workflow_call.secrets).toEqual({ CODECOV_TOKEN: { required: false } })
    expect(gates.permissions).toEqual({ contents: 'read' })
  })

  // A job that collects nothing, or uploads under a name the report cannot
  // match, leaves the report reading nothing for it; and a red job must
  // still say what it found.
  test('has every job collect what it found and upload it under the key collect gives', () => {
    for (const id of gateJobs(gates)) {
      const jobSteps = gates.jobs[id].steps
      const collect = collectStep(gates.jobs[id])
      expect(collect?.run, id).toMatch(new RegExp(`^node scripts/release-report/collect\\.mjs --job ${id}\\b`))
      expect(collect.if, id).toContain('!cancelled()')
      const upload = jobSteps[jobSteps.indexOf(collect) + 1]
      expect(upload.uses, id).toMatch(/^actions\/upload-artifact@/)
      expect(upload.if, id).toContain('!cancelled()')
      expect(upload.with, id).toEqual({ name: 'release-results-${{ steps.collect.outputs.key }}', path: 'release-results/', 'if-no-files-found': 'error', overwrite: true })
    }
  })

  // Every artefact the report expects is derived from this file; the matrix
  // jobs give one per package and one per Compose. No two share a key: the
  // uploads overwrite, so that a job run again replaces its own earlier
  // attempt, and a key two jobs wrote would leave only one of them.
  test('gives the report one key per job, package and Compose, and no key twice', () => {
    const keys = expectedKeys(gates, namedPackages()).map((entry) => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(expect.arrayContaining(['verify', 'browser', 'install', 'container', 'getting-started-runner', 'getting-started-2.20.3']))
    expect(keys.filter((key) => key.startsWith('test-')).sort()).toEqual(namedPackages().map((entry) => `test-${entry.id}`).sort())
  })

  // Without --force a suite's results could be a cached replay of another
  // commit's; without --summarize the report has no wall time for it.
  test('runs each package fresh, with its own timing, the package from the environment', () => {
    const run = gates.jobs.test.steps.find((step) => String(step.run).includes('turbo run test:coverage'))
    expect(run.run).toBe('pnpm exec turbo run test:coverage --filter="$PACKAGE" --force --summarize')
    expect(run.env).toEqual({ PACKAGE: '${{ matrix.package }}' })
  })

  // An expression inside a script is text a matrix value or a tag name can
  // write shell into; through `env` it is only ever a value.
  test('puts no expression inside a script, here or in the release', () => {
    for (const workflow of [gates, release]) {
      expect(steps(workflow).filter(({ step }) => String(step.run ?? '').includes('${{')).map(({ job, step }) => `${job}: ${step.name ?? step.run}`)).toEqual([])
    }
  })

  // gates.yml is code a release runs with its permissions, and a tag is a
  // pointer whoever owns the action can move.
  test('pins every third-party action to a commit, here and in the release', () => {
    for (const workflow of [gates, release]) {
      const loose = steps(workflow)
        .map(({ step }) => step.uses)
        .filter((uses) => typeof uses === 'string' && !uses.startsWith('actions/') && !uses.startsWith('./'))
        .filter((uses) => !/@[0-9a-f]{40}$/.test(uses))
      expect(loose).toEqual([])
    }
  })

  // A tag's run may restore a cache a main-branch run saved, and a cache is
  // what any code that ran in that job left in the store: a dependency the
  // tests execute could reach the dist/ npm receives through it. CI keeps
  // its caches; a release or a rehearsal installs from the registry against
  // the lockfile, as the release did before these gates were shared.
  test('restores no cache in a release or a rehearsal', () => {
    const caches = steps(gates).filter(({ step }) => String(step.uses).startsWith('actions/cache'))
    expect(caches.length).toBeGreaterThan(0)
    expect(caches.filter(({ step }) => step.if !== "inputs.release == ''").map(({ job, step }) => `${job}: ${step.name ?? step.with?.path}`)).toEqual([])
    expect(steps(release).filter(({ step }) => String(step.uses).startsWith('actions/cache')).map(({ job }) => job)).toEqual([])
  })

  // Merged, two jobs that wrote one key would overwrite each other before
  // the report could see there were two.
  test('downloads every job’s results into a directory of its own', () => {
    const download = gates.jobs.report.steps.find((step) => String(step.uses).startsWith('actions/download-artifact'))
    expect(download.with).toEqual({ pattern: 'release-results-*', path: 'release-results' })
  })

  // The tarballs a release publishes are the ones this job installed and ran.
  test('keeps the tarballs the install gate packed, installed and ran', () => {
    const install = gates.jobs.install.steps
    expect(install.map((step) => step.run).filter(Boolean)).toContain('node scripts/install-test.mjs --keep-tarballs release-tarballs')
    expect(install.find((step) => step.with?.name === 'release-tarballs')?.with).toEqual({ name: 'release-tarballs', path: 'release-tarballs/', 'if-no-files-found': 'error', overwrite: true })
  })
})
