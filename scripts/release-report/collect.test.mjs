import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { collect, keyFor } from './collect.mjs'

/**
 * collect.mjs over a workspace this file writes in a temporary directory:
 * two packages, one app with a browser gate, and the files each suite and
 * gate leaves. Docker and git are functions that answer what a machine would
 * -- collect asks them for an image's digest and the commit, nothing a test
 * here is about.
 */
let roots = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

const T0 = Date.parse('2026-10-09T10:00:00Z')
const at = (minutes) => new Date(T0 + minutes * 60_000).toISOString()

function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
}

const record = (overrides) => ({
  engine: 'postgres',
  image: 'postgres:17-alpine',
  version: '17.11',
  updateLevel: null,
  edition: null,
  description: 'PostgreSQL 17.11',
  caller: null,
  script: 'test-coverage',
  at: at(1),
  ...overrides,
})

/** A workspace: data-core (published) and data-host (an app with a gate), with what a run of each left. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'formancy-data-collect-'))
  roots.push(root)
  put(root, 'packages/data-core/package.json', { name: '@formancy/data-core', scripts: { 'test:coverage': 'vitest run --coverage' } })
  put(root, 'packages/data-core/dist/index.mjs', 'export {}\n')
  put(root, 'apps/host/package.json', { name: '@formancy/data-host', private: true, scripts: { 'test:coverage': 'vitest run --coverage', 'test:browser': 'node scripts/browser-test.mjs' } })
  put(root, 'apps/host/test-results/vitest.json', {
    success: true,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    startTime: T0,
    testResults: [
      {
        name: join(root, 'apps/host/src/page.test.tsx'),
        status: 'passed',
        startTime: T0 + 1000,
        endTime: T0 + 2000,
        assertionResults: [{ fullName: 'the page loads', status: 'passed', duration: 1000, meta: {} }],
      },
    ],
    coverageMap: { 'apps/host/src/page.tsx': { s: { 0: 1 } } },
  })
  put(root, 'apps/host/coverage/coverage-summary.json', { total: { lines: { pct: 90 } }, 'src/page.tsx': {} })
  put(root, 'apps/host/test-results/browser.json', { gate: 'apps/host', startedAt: at(30), finishedAt: at(40), checks: { ok: 1, failed: [] } })
  put(root, 'apps/host/test-results/servers/test-coverage-postgres-1-1.json', record({ caller: join(root, 'apps/host/src/test-databases.ts') }))
  put(root, 'apps/host/test-results/servers/test-browser-postgres-2-1.json', record({ script: 'test-browser', at: at(31), caller: join(root, 'apps/host/scripts/browser-test.mjs') }))
  put(root, 'apps/host/test-results/servers/snapshot-postgres-3-1.json', record({ script: 'snapshot', at: at(2) }))
  put(root, 'apps/host/test-results/servers/test-coverage-postgres-4-1.json', record({ at: at(-60) }))
  put(root, '.turbo/runs/one.json', { execution: { startTime: T0 - 5000 }, tasks: [{ taskId: '@formancy/data-host#test:coverage', execution: { startTime: T0 - 4000, endTime: T0 + 9000 }, cache: { status: 'MISS' } }] })
  return root
}

const machine = {
  env: { GITHUB_SHA: 'abc123', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1' },
  docker: (args) => (args[0] === 'image' ? '["postgres@sha256:b0f9"] sha256:b0f9\n' : '29.8.1\n'),
  git: () => 'abc123\n',
  now: () => new Date(T0 + 50 * 60_000),
}

describe('a job’s key', () => {
  // The artefact is named release-results-<key>, and the report expects one
  // per package with a suite, keyed as codecov-config.mjs keys it. A name
  // the report cannot match is a missing package to it.
  test('is test-<id> for a package’s suite, and carries a matrix value', () => {
    const covered = [{ path: 'apps/host', id: 'app-host', name: '@formancy/data-host' }]
    expect(keyFor({ job: 'test', pkg: '@formancy/data-host' }, covered)).toBe('test-app-host')
    expect(keyFor({ job: 'getting-started', variant: '2.20.3' }, covered)).toBe('getting-started-2.20.3')
    expect(keyFor({ job: 'verify' }, covered)).toBe('verify')
    expect(() => keyFor({ job: 'test', pkg: '@formancy/nothing' }, covered)).toThrow(/no workspace package/)
  })
})

describe('a test job’s results', () => {
  // The report counts what the suite ran, and which servers it started.
  // The coverage map is megabytes nobody reads; a server another script
  // started -- a snapshot capture, the browser gate -- or one from before
  // the run would be counted as this suite's.
  test('keep the suite and its own servers, and drop the coverage map', () => {
    const root = workspace()
    const result = collect({ root, job: 'test', pkg: '@formancy/data-host', ...machine })
    expect(result).toMatchObject({ schema: 1, key: 'test-app-host', commit: 'abc123', run: { id: '42', attempt: '1' }, missing: [] })
    const [suite] = result.suites
    expect(suite).not.toHaveProperty('coverageMap')
    expect(suite.files).toEqual([{ file: 'apps/host/src/page.test.tsx', status: 'passed', startTime: T0 + 1000, endTime: T0 + 2000, tests: [{ name: 'the page loads', status: 'passed', durationMs: 1000, meta: {} }] }])
    expect(suite.task).toEqual({ startTime: T0 - 4000, endTime: T0 + 9000, cache: 'MISS' })
    expect(suite.coverage).toEqual({ lines: { pct: 90 } })
    expect(result.servers).toEqual([
      expect.objectContaining({ script: 'test-coverage', at: at(1), package: '@formancy/data-host', caller: 'apps/host/src/test-databases.ts', digest: 'postgres@sha256:b0f9', imageId: 'sha256:b0f9' }),
    ])
    expect(result.dist).toEqual([{ package: '@formancy/data-core', distHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }])
  })

  // Two writers make server records: data-fixtures and the getting-started
  // journey. If they ever disagree, this is where anybody finds out.
  test('refuse a malformed server record, naming its file', () => {
    const root = workspace()
    put(root, 'apps/host/test-results/servers/test-coverage-sqlserver-9-1.json', { engine: 'sqlserver', image: 'mcr.microsoft.com/mssql/server:2022-latest', version: 16 })
    expect(() => collect({ root, job: 'test', pkg: '@formancy/data-host', ...machine })).toThrow(/apps\/host\/test-results\/servers\/test-coverage-sqlserver-9-1\.json is not a server record: version is not a string/)
  })
})

describe('the browser job’s results', () => {
  // The gate's servers are the ones its script started while it ran.
  test('keep each gate and the servers it started', () => {
    const root = workspace()
    const result = collect({ root, job: 'browser', ...machine })
    expect(result.browserGates.map((gate) => gate.gate)).toEqual(['apps/host'])
    expect(result.servers.map((server) => [server.script, server.package, server.caller])).toEqual([['test-browser', 'apps/host', 'apps/host/scripts/browser-test.mjs']])
  })
})

describe('the getting-started job’s results', () => {
  // The journey records each composed database it talked to; a run in which
  // it recorded none -- the call removed, or the journey ending before it --
  // would leave the report silent on what the guide ran, with the job green.
  test('keep each composed database’s record, and name every connection of the journey without one', () => {
    const root = workspace()
    put(root, 'scripts/getting-started/journey.json', { forms: [{ connection: 'pg' }, { connection: 'ms' }] })
    put(root, 'deploy/connections.json', [{ id: 'pg', kind: 'postgres' }, { id: 'ms', kind: 'sqlserver' }])
    expect(collect({ root, job: 'getting-started', variant: 'runner', ...machine }).missing).toEqual([
      'a record of the composed postgres database behind the journey’s connection pg, which scripts/getting-started.mjs writes after the journey',
      'a record of the composed sqlserver database behind the journey’s connection ms, which scripts/getting-started.mjs writes after the journey',
    ])
    put(root, 'test-results/servers/getting-started-postgres-7-1.json', record({ script: 'getting-started', caller: 'scripts/getting-started.mjs', at: at(45) }))
    const result = collect({ root, job: 'getting-started', variant: 'runner', ...machine })
    expect(result.servers.map((server) => [server.engine, server.script])).toEqual([['postgres', 'getting-started']])
    expect(result.missing).toEqual(['a record of the composed sqlserver database behind the journey’s connection ms, which scripts/getting-started.mjs writes after the journey'])
  })
})

describe('local results', () => {
  // On one machine every file is whatever the last run left. A gate's file
  // from yesterday read as today's would report a browser nobody launched.
  test('refuse a file that started before --since, and say so', () => {
    const root = workspace()
    const result = collect({ root, local: true, since: at(10), ...machine, env: {} })
    expect(result.browserGates.map((gate) => gate.gate)).toEqual(['apps/host'])
    expect(result.suites.map((suite) => suite.path)).toEqual([])
    expect(result.missing).toEqual(expect.arrayContaining([`stale: apps/host/test-results/vitest.json started ${at(0)}, before --since`]))
    const later = collect({ root, local: true, since: at(35), ...machine, env: {} })
    expect(later.browserGates).toEqual([])
    expect(later.missing).toEqual(expect.arrayContaining([`stale: apps/host/test-results/browser.json started ${at(30)}, before --since`]))
  })

  // A fresh vitest.json beside yesterday's turbo summary and coverage would
  // print yesterday's wall time and coverage as this run's: every file a
  // suite's row is built from is held to --since, not only the first.
  test('refuse a turbo summary or a coverage summary from before --since, and say so', () => {
    const root = workspace()
    const yesterday = T0 - 86_400_000
    put(root, '.turbo/runs/one.json', { execution: { startTime: yesterday }, tasks: [{ taskId: '@formancy/data-host#test:coverage', execution: { startTime: yesterday, endTime: yesterday + 600_000 }, cache: { status: 'MISS' } }] })
    utimesSync(join(root, 'apps/host/coverage/coverage-summary.json'), new Date(yesterday), new Date(yesterday))
    const result = collect({ root, local: true, since: at(-1), ...machine, env: {} })
    expect(result.suites.map((suite) => [suite.path, suite.task, suite.coverage])).toEqual([['apps/host', null, null]])
    expect(result.missing).toEqual(
      expect.arrayContaining([
        `stale: turbo's run summary for @formancy/data-host#test:coverage started ${new Date(yesterday).toISOString()}, before --since`,
        `stale: apps/host/coverage/coverage-summary.json written ${new Date(yesterday).toISOString()}, before --since`,
      ]),
    )
  })

  // A local run tests whatever the tree holds, committed or not; naming
  // HEAD alone would name code that did not run.
  test('record whether the tree had uncommitted changes', () => {
    const root = workspace()
    const git = (status) => (args) => (args[0] === 'status' ? status : 'abc123\n')
    expect(collect({ root, local: true, since: at(-1), ...machine, env: {}, git: git(' M README.md\n') })).toMatchObject({ commit: 'abc123', dirty: true })
    expect(collect({ root, local: true, since: at(-1), ...machine, env: {}, git: git('') })).toMatchObject({ commit: 'abc123', dirty: false })
  })

  // Without a time, local mode would have no way to tell a stale file from a fresh one.
  test('need --since', () => {
    expect(() => collect({ root: workspace(), local: true, ...machine })).toThrow(/needs --since/)
  })
})

describe('the command line', () => {
  // `--out` names where the results go. Joined to the checkout rather than
  // resolved against it, an absolute directory became a directory of that
  // name inside the checkout -- a stray tree no ignore rule covers -- and the
  // line it printed named release-results/ whatever --out said. Run as the
  // jobs run it, on this checkout; the install gate's job reads only files a
  // run may or may not have left, so it writes either way.
  test('writes into an absolute --out, and names the file it wrote', () => {
    const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const out = mkdtempSync(join(tmpdir(), 'formancy-data-collect-out-'))
    roots.push(out)
    // A step's outputs are the workflow's; this run is not a step of one.
    const { GITHUB_OUTPUT: _, ...env } = process.env
    const printed = execFileSync(process.execPath, [join(repo, 'scripts', 'release-report', 'collect.mjs'), '--job', 'install', '--out', out], { cwd: repo, encoding: 'utf8', env })
    expect(existsSync(join(out, 'install.json'))).toBe(true)
    expect(existsSync(join(repo, out))).toBe(false)
    expect(printed.startsWith(`${relative(repo, join(out, 'install.json')).replaceAll('\\', '/')}: `)).toBe(true)
  })
})
