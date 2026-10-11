import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { compareProduct, describeProduct, productFiles, runtimeClosure } from './performance-product.mjs'
import { readWorkflow } from './release-report/workflows.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * A repository in miniature: the server's composition root and the
 * measurement's entry, a workspace package reached through its index, a
 * fixture file, an installed dependency tree, and the build inputs. Small
 * enough to change one thing at a time and see what the stale check says.
 */
let root
const write = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const manifest = (name, version, dependencies = {}, extra = {}) => JSON.stringify({ name, version, dependencies, ...extra })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'performance-product-'))
  write('tsconfig.base.json', '{}\n')
  write('packages/data-server/package.json', manifest('@formancy/data-server', '0.1.0', { '@formancy/data-core': 'workspace:*', fastify: '^5.0.0' }))
  write('packages/data-server/tsdown.config.ts', 'export default {}\n')
  write('packages/data-server/tsconfig.json', '{}\n')
  write('packages/data-server/src/main.ts', "import { createApp } from './app.js'\nimport type { Unused } from './types.js'\ncreateApp()\n")
  write('packages/data-server/src/app.ts', "import { plan, type Plan } from '@formancy/data-core'\nimport Fastify from 'fastify'\nexport const createApp = () => plan(Fastify)\n")
  write('packages/data-server/src/types.ts', 'export type Unused = string\n')
  write('packages/data-server/src/app.test.ts', "import { createApp } from './app.js'\n")
  write('packages/data-server/src/unreached.ts', 'export const nobody = 1\n')
  write('packages/data-client/package.json', manifest('@formancy/data-client', '0.1.0', { '@formancy/data-core': 'workspace:*' }))
  write('packages/data-client/src/index.ts', 'export const client = 1\n')
  write('packages/data-core/package.json', manifest('@formancy/data-core', '0.1.0', { '@formancy/spec': '0.3.0', '@types/node': '22.0.0' }))
  write('packages/data-core/tsdown.config.ts', 'export default {}\n')
  write('packages/data-core/src/index.ts', "export { plan } from './plan.js'\nexport { MODEL } from './model.js'\nexport type { Plan } from './plan.js'\n")
  write('packages/data-core/src/plan.ts', "import { helper } from './helper.js'\nexport type Plan = string\nexport const plan = (x: unknown) => helper(x)\n")
  write('packages/data-core/src/helper.ts', 'export const helper = (x: unknown) => x\n')
  write('packages/data-core/src/model.ts', 'export const MODEL = 1\n')
  write('packages/data-fixtures/package.json', manifest('@formancy/data-fixtures', '0.1.0'))
  write('packages/data-fixtures/fixtures/postgres.sql', 'create table t ();\n')
  write('packages/data-performance/package.json', manifest('@formancy/data-performance', '0.1.0', { '@formancy/data-core': 'workspace:*' }))
  write('packages/data-performance/src/measure.ts', "import * as core from '@formancy/data-core'\nexport const all = core\n")
  write('node_modules/fastify/package.json', manifest('fastify', '5.12.5', { pino: '^10.0.0' }, { optionalDependencies: { 'not-installed': '1.0.0' }, peerDependencies: { 'absent-peer': '1.0.0' } }))
  write('node_modules/pino/package.json', manifest('pino', '10.4.0'))
  write('node_modules/@formancy/spec/package.json', manifest('@formancy/spec', '0.3.0', {}, { exports: { '.': './dist/index.js' } }))
  write('node_modules/@types/node/package.json', manifest('@types/node', '22.20.5'))
  write('node_modules/typescript/package.json', manifest('typescript', '6.0.3'))
  write('node_modules/tsdown/package.json', manifest('tsdown', '0.23.0'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** What the stale check says after `change`, against the product described before it. */
function staleAfter(change) {
  const before = describeProduct(root)
  change()
  return compareProduct(before, describeProduct(root))
}

describe('the stale check on a repository in miniature', () => {
  // The measured product changed: the figures describe code that no longer
  // ships, and the release must re-measure. Named, so the reader knows why.
  test('names a changed byte of an imported source file', () => {
    expect(staleAfter(() => write('packages/data-core/src/helper.ts', 'export const helper = (x: unknown) => [x]\n'))).toEqual(['changed: packages/data-core/src/helper.ts'])
  })

  // None of these runs inside a timed sample: a test, a file nothing the
  // measurement runs imports, a type-only import, a declaration package
  // in the dependency tree, and a version bump, which
  // `bump.mjs` makes on every release and which would otherwise make every
  // release stale for nothing.
  test('ignores a test, an unreached file, a type, a declaration package, and a package version alone', () => {
    expect(
      staleAfter(() => {
        write('packages/data-server/src/app.test.ts', '// changed\n')
        write('packages/data-server/src/unreached.ts', 'export const nobody = 2\n')
        write('packages/data-server/src/types.ts', 'export type Unused = number\n')
        write('node_modules/@types/node/package.json', manifest('@types/node', '22.20.6'))
        write('packages/data-server/package.json', manifest('@formancy/data-server', '0.2.0', { '@formancy/data-core': 'workspace:*', fastify: '^5.0.0' }))
      }),
    ).toEqual([])
  })

  // Only the names the server asked for, through the index: `MODEL` is
  // exported there and nobody measured imports it.
  test('follows only the re-exports the importers asked for, unless one takes everything', () => {
    const files = productFiles(root)
    expect(files).toContain('packages/data-core/src/helper.ts')
    expect(files).toContain('packages/data-core/src/model.ts')
    write('packages/data-performance/src/measure.ts', "import { plan } from '@formancy/data-core'\nexport const one = plan\n")
    expect(productFiles(root)).not.toContain('packages/data-core/src/model.ts')
  })

  test('names an imported file added or removed', () => {
    expect(
      staleAfter(() => {
        write('packages/data-core/src/extra.ts', 'export const extra = 1\n')
        write('packages/data-core/src/plan.ts', "import { helper } from './helper.js'\nimport { extra } from './extra.js'\nexport type Plan = string\nexport const plan = (x: unknown) => helper([x, extra])\n")
      }),
    ).toEqual(['added: packages/data-core/src/extra.ts', 'changed: packages/data-core/src/plan.ts'])
    expect(
      staleAfter(() => {
        write('packages/data-core/src/plan.ts', 'export type Plan = string\nexport const plan = (x: unknown) => x\n')
        rmSync(join(root, 'packages/data-core/src/helper.ts'))
      }),
    ).toEqual(['changed: packages/data-core/src/plan.ts', 'removed: packages/data-core/src/extra.ts', 'removed: packages/data-core/src/helper.ts'])
  })

  // A lockfile refresh under a caret range changes what runs without a
  // line of this repository changing: pino under fastify here.
  test('names a transitive dependency whose version changed, with both versions', () => {
    expect(staleAfter(() => write('node_modules/pino/package.json', manifest('pino', '10.5.0')))).toEqual(['pino: measured 10.4.0, installed 10.5.0'])
  })

  // The build turns the source into what runs; its configuration is part of it.
  test("names a change to a reached package's build configuration", () => {
    expect(staleAfter(() => write('packages/data-core/tsdown.config.ts', 'export default { minify: true }\n'))).toEqual(['build input changed: packages/data-core/tsdown.config.ts'])
    expect(staleAfter(() => write('node_modules/typescript/package.json', manifest('typescript', '6.0.4')))).toEqual(['build input changed: typescript'])
  })

  // A dependency the server needs and cannot find is a broken install, not a smaller product.
  test('refuses a required dependency that is not installed, naming it', () => {
    rmSync(join(root, 'node_modules/pino'), { recursive: true })
    expect(() => runtimeClosure(root)).toThrow(/pino/)
  })
})

/** `node <scripts>/performance-stale.mjs` in the miniature, as the release and RELEASING's step 2b run it: its exit code and what it said. */
function staleCommand(scripts = join(root, 'scripts')) {
  const run = spawnSync(process.execPath, [join(scripts, 'performance-stale.mjs')], { cwd: root, encoding: 'utf8' })
  return { status: run.status, said: `${run.stdout}${run.stderr}` }
}

describe('the stale check, as a command', () => {
  // The scripts themselves, in the miniature, with the figures recorded on it
  // as it stands: the command is what the release runs, so it is what must
  // refuse. A comparison only ever tested as a function leaves the command
  // free to do nothing and exit 0 -- which it did, run through any path that
  // was not its real one.
  beforeEach(() => {
    mkdirSync(join(root, 'scripts'))
    for (const name of ['performance-stale.mjs', 'performance-product.mjs']) copyFileSync(join(repo, 'scripts', name), join(root, 'scripts', name))
    write('docs/performance/results.json', JSON.stringify({ product: describeProduct(root) }))
  })

  // A gate that refused a product the figures describe would block every
  // release for nothing, and be switched off.
  test('passes while the figures describe the product', () => {
    expect(staleCommand()).toEqual({ status: 0, said: 'The published performance figures describe this product.\n' })
  })

  // The refusal the release rests on, by the path the release uses and by a
  // symlinked one, which a main-module check comparing paths passed as 0.
  test('exits 1 naming a changed file, however the script is reached', () => {
    write('packages/data-core/src/helper.ts', 'export const helper = (x: unknown) => [x]\n')
    const direct = staleCommand()
    expect(direct.status).toBe(1)
    expect(direct.said).toContain('changed: packages/data-core/src/helper.ts')
    const link = join(root, '..', `${basename(root)}-link`)
    symlinkSync(root, link)
    try {
      expect(staleCommand(join(link, 'scripts'))).toEqual(direct)
    } finally {
      rmSync(link)
    }
  })

  // No figures at all is not "nothing changed".
  test('exits 1 when no figures were ever published', () => {
    rmSync(join(root, 'docs/performance/results.json'))
    const run = staleCommand()
    expect(run.status).toBe(1)
    expect(run.said).toContain('docs/performance/results.json does not exist')
  })
})

describe('the product on this repository', () => {
  // What the measurement runs, derived from its imports: the lookup's
  // query rules in the core, the runtime's drift decision (0041), the hop,
  // the fixture the databases load, the shared drift case the refusals run
  // over, and the catalogue whose pins the run is held to.
  test('includes what the server and the harness run', () => {
    const files = productFiles(repo)
    for (const path of [
      'packages/data-core/src/lookup/query.ts',
      'packages/data-core/src/records/drift.ts',
      'packages/data-fixtures/src/tcp-hop.ts',
      'packages/data-fixtures/src/drifting.ts',
      'packages/data-fixtures/fixtures/postgres.sql',
      'packages/data-performance/src/catalogue.ts',
      'packages/data-server/src/main.ts',
    ]) {
      expect(files, path).toContain(path)
    }
  })

  // And not what it does not run: the fixture model only the conformance
  // suites read, the page's renderer, and every test.
  test('excludes the fixture model, the renderer and every test', () => {
    const files = productFiles(repo)
    expect(files).not.toContain('packages/data-fixtures/src/model.ts')
    expect(files).not.toContain('packages/data-performance/src/render.ts')
    expect(files.filter((path) => /\.test\./.test(path))).toEqual([])
  })

  // The drivers and the server's libraries, found by walking node_modules
  // rather than through an exports map, which refuses package.json for
  // postgres and @formancy/spec.
  test('finds the runtime libraries, each with a version', () => {
    const packages = runtimeClosure(repo)
    for (const name of ['postgres', 'mssql', 'tedious', 'fastify', 'pino', '@formancy/spec']) expect(packages[name], name).toMatch(/^\d+\.\d+\.\d+/)
  })
})

/** Every step of every job of a parsed workflow, with its job's id. */
const steps = (workflow) => Object.entries(workflow.jobs).flatMap(([job, definition]) => (definition.steps ?? []).map((step) => ({ job, step })))

/** The jobs a job's `needs` names: one, a list, or none. */
const needs = (job) => (job?.needs === undefined ? [] : [job.needs].flat().map(String))

/** The comparison as the release and RELEASING's step 2b run it: the command and nothing else. */
const COMPARES = (step) => String(step.run ?? '').trim() === 'node scripts/performance-stale.mjs'

describe('the release', () => {
  // RELEASING.md, the CHANGELOG and 0034 say a release is refused while the
  // figures describe another product. That holds only while the job that
  // publishes waits, through `needs`, on a job that runs the comparison --
  // not `--describe`, which prints the product and passes whatever it finds,
  // and not a step allowed to fail, nor one skipped by an `if:` on the job or
  // on the step, which passes the job green without running it. Without
  // this, a reshuffle of the workflow that dropped the job from `needs`
  // would publish over stale figures with nothing red.
  test('publishes only after the stale check has passed', () => {
    const release = readWorkflow(repo, '.github/workflows/release.yml')
    const checking = steps(release).filter(({ step }) => COMPARES(step))
    const publishing = Object.entries(release.jobs).filter(([, job]) => (job.steps ?? []).some((step) => /\bscripts\/release-report\/publish\.mjs\b/.test(String(step.run ?? '')))).map(([id]) => id)
    expect(checking.map(({ job }) => job)).toHaveLength(1)
    expect(publishing).toHaveLength(1)
    const waitedOn = new Set()
    const queue = needs(release.jobs[publishing[0]])
    while (queue.length > 0) {
      const name = queue.shift()
      if (waitedOn.has(name)) continue
      waitedOn.add(name)
      queue.push(...needs(release.jobs[name]))
    }
    const [{ job, step }] = checking
    expect([...waitedOn]).toContain(job)
    expect(Object.keys(release.jobs[job]).filter((key) => key === 'if' || key === 'continue-on-error'), `the ${job} job`).toEqual([])
    expect(Object.keys(step).filter((key) => key === 'if' || key === 'continue-on-error'), 'the step that compares').toEqual([])
  })

  // The comparison holds a release, never a pull request: run in the gates,
  // it would block every product change until somebody re-measured on a
  // quiet machine, which 0034 rejects. So CI's workflows do not run it at
  // all, `--describe` included, and the release's one step is the only one.
  test('is not run by the gates or by CI', () => {
    for (const file of ['.github/workflows/gates.yml', '.github/workflows/ci.yml']) {
      const named = steps(readWorkflow(repo, file)).filter(({ step }) => String(step.run ?? '').includes('performance-stale'))
      expect(named.map(({ job }) => `${file}: ${job}`)).toEqual([])
    }
  })

  // A guard on the guard: a reader that found no jobs, or no `needs`, would
  // fail the tests above for the wrong reason, or a change to them could pass.
  test('is reading the workflows at all', () => {
    const release = readWorkflow(repo, '.github/workflows/release.yml')
    expect(Object.keys(release.jobs)).toEqual(expect.arrayContaining(['check', 'publish']))
    expect(needs(release.jobs.publish)).toEqual(expect.arrayContaining(['gates', 'check']))
    expect(steps(readWorkflow(repo, '.github/workflows/gates.yml')).length).toBeGreaterThan(10)
  })
})
