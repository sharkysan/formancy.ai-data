import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { namedPackages } from './collect.mjs'
import { BUILT_INPUTS, workspace } from './tested-on.mjs'
import { collectStep, expectedKeys, gateJobs, imageMatrix, readWorkflow } from './workflows.mjs'

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

  // The SBOM describes what a consumer installs (0092): the tarballs the
  // install gate ran, installed by npm into a project of their own outside
  // the checkout, with no lifecycle script and the peers left to the host,
  // and cdxgen over that project. The workspace is not installed in `check`,
  // so nothing reads it in place of what ships: read off the workspace,
  // 0.2.0's SBOM named vitest and Playwright and left out tedious and every
  // package it published. The check holds the SBOM to npm's lockfile of
  // that install (watched failing against the workflow as v0.2.0 ran it).
  test('makes the SBOM of the tarballs installed as a consumer installs them, never of the workspace', () => {
    const check = release.jobs.check
    expect(check.steps.filter((step) => /\bpnpm\b|corepack/.test(String(step.run)))).toEqual([])
    const sbom = String(check.steps.find((step) => step.id === 'sbom').run)
    expect(sbom).toMatch(/cd "\$\{RUNNER_TEMP\}\/formancy-data-sbom"/)
    expect(sbom).toContain('npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund "${GITHUB_WORKSPACE}"/release-tarballs/*.tgz')
    expect(sbom).toMatch(/cdxgen@[\d.]+ \\\s+--type javascript \\\s+--required-only/)
    expect(sbom.trim().endsWith('.')).toBe(true)
    expect(String(check.steps.find((step) => step.id === 'sbom-checked').run)).toContain('--installed "${RUNNER_TEMP}/formancy-data-sbom/package-lock.json"')
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
  // The report reads what each environment was tested on from built code
  // (tested-on.mjs's BUILT_INPUTS). A package it reads that the job never
  // built stops the report with "is not built" on every pull request, which
  // is how data-sqlserver's logins first reached it. What a filter builds is
  // derived as turbo derives it: the package, and every workspace package
  // it depends on, since build depends on ^build.
  test('builds every package the report reads built', () => {
    const packages = workspace(repo)
    const dirOf = new Map(packages.map(({ dir, manifest }) => [manifest.name, dir]))
    const dependsOn = new Map(packages.map(({ dir, manifest }) => [dir, Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((name) => dirOf.has(name)).map((name) => dirOf.get(name))]))
    const build = gates.jobs.report.steps.map((step) => String(step.run ?? '')).find((run) => run.startsWith('pnpm exec turbo run build'))
    const filtered = [...String(build).matchAll(/--filter=(\S+)/g)].map((found) => dirOf.get(found[1]))
    const built = new Set()
    const visit = (dir) => {
      if (dir === undefined || built.has(dir)) return
      built.add(dir)
      for (const next of dependsOn.get(dir) ?? []) visit(next)
    }
    filtered.forEach(visit)
    expect(BUILT_INPUTS.filter((dir) => !built.has(dir))).toEqual([])
    expect(filtered).not.toContain(undefined)
  })

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
  // jobs give one per package, one per image leg, one per browser and one
  // per Compose. No two share a key: the uploads overwrite, so that a job run
  // again replaces its own earlier attempt, and a key two jobs wrote would
  // leave only one of them -- which, for the browser legs, is one browser's
  // results reported as another's, and for the image legs one image's.
  test('gives the report one key per job, package, image leg, browser and Compose, and no key twice', () => {
    const expected = expectedKeys(gates, namedPackages())
    const keys = expected.map((entry) => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(expect.arrayContaining(['verify', 'browser-chromium', 'browser-firefox', 'browser-webkit', 'pictures', 'install', 'container', 'getting-started-runner', 'getting-started-2.20.3', 'live-demo']))
    expect(keys).not.toContain('browser')
    const of = (job) => expected.filter((entry) => entry.job === job).map((entry) => entry.key)
    expect(of('test').sort()).toEqual(namedPackages().map((entry) => `test-${entry.id}`).sort())
    // Each leg's key names its package and its image, so the report expects
    // every pair the job lists and no two legs share one.
    expect(of('test-images')).toEqual(expect.arrayContaining(['test-images-data-fixtures-postgres-16-alpine', 'test-images-data-sqlserver-mcr.microsoft.com-mssql-server-2019-latest']))
    expect(of('test-images')).toHaveLength(imageMatrix(gates).length)
  })

  // A job keyed by a package and an image runs the pairs it lists; read as a
  // cross of two lists, or with a pair missing a value, the report would
  // expect artefacts no leg leaves, or miss one a leg does.
  test('reads a job keyed by two values as its include pairs, and refuses any other matrix', () => {
    const leg = (matrix) => ({
      jobs: {
        legs: {
          strategy: { matrix },
          steps: [{ id: 'collect', run: 'node scripts/release-report/collect.mjs --job legs --package "$PACKAGE" --variant "$IMAGE"', env: { PACKAGE: '${{ matrix.package }}', IMAGE: '${{ matrix.image }}' } }],
        },
      },
    })
    const named = namedPackages()
    expect(expectedKeys(leg({ include: [{ package: '@formancy/data-postgres', image: 'postgres:16-alpine' }] }), named)).toEqual([{ key: 'legs-data-postgres-postgres-16-alpine', job: 'legs' }])
    expect(() => expectedKeys(leg({ package: ['@formancy/data-postgres'], include: [{ package: '@formancy/data-postgres', image: 'postgres:16-alpine' }] }), named)).toThrow(/its matrix lists package beside include/)
    expect(() => expectedKeys(leg({ include: [{ package: '@formancy/data-postgres' }] }), named)).toThrow(/include entry 1 gives no image/)
  })

  // The image legs are the test job's command on another image (0067): a
  // leg without --force could replay the default's cached run under its
  // image's name, and one without FORMANCY_IMAGES runs the default. Coverage
  // is the default leg's to upload: an image leg covers the same lines, and
  // Codecov merges by commit.
  test('runs each image leg as the test job runs its package, on the leg’s image, uploading no coverage', () => {
    const job = gates.jobs['test-images']
    const run = job.steps.find((step) => String(step.run).includes('turbo run test:coverage'))
    expect(run.run).toBe(gates.jobs.test.steps.find((step) => String(step.run).includes('turbo run test:coverage')).run)
    expect(run.env).toEqual({ PACKAGE: '${{ matrix.package }}', FORMANCY_IMAGES: '${{ matrix.image }}' })
    expect(job.steps.filter((step) => String(step.uses).startsWith('codecov/'))).toEqual([])
    expect(collectStep(job).run).toBe('node scripts/release-report/collect.mjs --job test-images --package "$PACKAGE" --variant "$IMAGE"')
    expect(collectStep(job).env).toEqual({ PACKAGE: '${{ matrix.package }}', IMAGE: '${{ matrix.image }}' })
    expect(job.strategy['fail-fast']).toBe(false)
  })

  // The README's pictures are one look, Chromium's (0038): their check runs
  // in a job of its own, which the report waits for and expects a results
  // key from, never as a step of one browser's leg that a rename could skip,
  // and never in the gates, which run in every browser (0058).
  test('checks every app’s pictures in the pictures job, in Chromium, and in no browser leg', () => {
    const apps = ['examples', 'host', 'studio'].map((app) => JSON.parse(readFileSync(join(repo, 'apps', app, 'package.json'), 'utf8')))
    for (const manifest of apps) {
      expect(manifest.scripts['test:pictures'], manifest.name).toBe('node scripts/pictures.mjs --check')
      expect(manifest.scripts['test:browser'], manifest.name).not.toContain('pictures')
    }
    const runs = (id) => gates.jobs[id].steps.map((step) => step.run).filter(Boolean)
    expect(runs('pictures')).toContain('pnpm test:pictures')
    expect(runs('pictures')).toContain('pnpm --filter @formancy/data-examples exec playwright install chromium')
    expect(runs('browser').filter((run) => run.includes('pictures'))).toEqual([])
    expect(gates.jobs.report.needs).toContain('pictures')
  })

  // The live demo's gate (0070) builds its image and drives its page in
  // Chromium against it: a job of its own, in the report's needs, so an
  // image that no longer builds fails CI before Workers Builds deploys it
  // from main, where the deploy is not transactional.
  test('runs the live demo’s gate in a job of its own, with Chromium from the host app, and the report waits for it', () => {
    const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    expect(manifest.scripts['test:live-demo']).toBe('node scripts/live-demo-gate.mjs')
    const runs = gates.jobs['live-demo'].steps.map((step) => step.run).filter(Boolean)
    expect(runs).toContain('pnpm --filter @formancy/data-host exec playwright install chromium')
    expect(runs).toContain('pnpm test:live-demo')
    expect(runs.indexOf('pnpm test:live-demo')).toBeGreaterThan(runs.findIndex((run) => run.startsWith('pnpm exec turbo run build')))
    expect(gates.jobs['live-demo']['timeout-minutes']).toBeGreaterThan(0)
    expect(gates.jobs.report.needs).toContain('live-demo')
  })

  // WebKit's networking, EGL and fallback fonts are the runner image's: a
  // label that moved would move 0058's facts under the WebKit leg with no
  // change in the repository, and the pictures' fonts with them.
  test('runs the browser legs and the pictures on a pinned image, and installs system libraries for WebKit alone', () => {
    expect(gates.jobs.browser['runs-on']).toBe('ubuntu-24.04')
    expect(gates.jobs.pictures['runs-on']).toBe('ubuntu-24.04')
    const deps = gates.jobs.browser.steps.filter((step) => String(step.run).includes('install-deps') || String(step.run).includes('--with-deps'))
    expect(deps.map((step) => ({ if: step.if, run: step.run }))).toEqual([{ if: "matrix.browser == 'webkit'", run: 'pnpm --filter @formancy/data-examples exec playwright install-deps webkit' }])
  })

  // The runner's Ubuntu mirror has crawled for whole runs -- ten packages in
  // twelve minutes on 2026-10-26 -- and no time limit fixes a download that
  // never ends. The packages apt fetched are kept, and put where apt looks
  // before it downloads: it takes one only when its checksum is the index's,
  // so the versions installed, which 0058's facts rest on, are the ones a
  // download would have brought. Never in a release, which restores no cache.
  test("keeps WebKit's system packages between runs, seeded before apt and saved after it, never in a release", () => {
    const browser = gates.jobs.browser.steps
    const at = (predicate) => browser.findIndex(predicate)
    const install = at((step) => String(step.run).includes('install-deps webkit'))
    const restore = at((step) => String(step.uses).startsWith('actions/cache/restore@'))
    // What each step does to apt's archive: copies into it, or reads from it.
    const seed = at((step) => String(step.run).includes('cp -t /var/cache/apt/archives'))
    const keep = at((step) => String(step.run).includes('find /var/cache/apt/archives'))
    const save = at((step) => String(step.uses).startsWith('actions/cache/save@'))
    expect({ restore: restore >= 0, seed: seed >= 0, keep: keep >= 0, save: save >= 0 }).toEqual({ restore: true, seed: true, keep: true, save: true })
    expect([restore, seed, install, keep, save]).toEqual([...[restore, seed, install, keep, save]].sort((a, b) => a - b))
    for (const index of [restore, seed, keep, save]) {
      expect(browser[index].if, browser[index].name).toContain("matrix.browser == 'webkit'")
      expect(browser[index].if, browser[index].name).toContain("inputs.release == ''")
    }
    expect(browser[restore].with.path).toBe(browser[save].with.path)
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
  // the lockfile, as the release did before these gates were shared. The
  // condition is that check alone, or that check first and more after it,
  // joined by && only: an || anywhere could let a release through.
  test('restores no cache in a release or a rehearsal', () => {
    const caches = steps(gates).filter(({ step }) => String(step.uses).startsWith('actions/cache'))
    expect(caches.length).toBeGreaterThan(0)
    const guarded = (condition) => condition === "inputs.release == ''" || (typeof condition === 'string' && condition.startsWith("inputs.release == '' && ") && !condition.includes('||'))
    expect(caches.filter(({ step }) => !guarded(step.if)).map(({ job, step }) => `${job}: ${step.name ?? step.with?.path}`)).toEqual([])
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
