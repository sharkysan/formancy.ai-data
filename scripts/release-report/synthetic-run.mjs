// A whole green run, made by hand, for report.test.mjs and render.test.mjs:
// the inputs buildReport takes, as small as they can be and still hold every
// part of the report. Test support only. Each test copies it and introduces
// one defect, so a check is seen to fire on that defect and on nothing else.
//
// Pure logic over hand-made results; no database or driver is mocked, because
// none is involved -- what the report reads are files the suites wrote.

import { FACTS } from '../browsers.mjs'

const T0 = Date.parse('2026-10-09T10:00:00Z')

/** The checks that hold 0058's FACTS rows in `app`'s gate, which a green run's gate of it makes in every browser. */
export const heldChecks = (app) => Object.values(FACTS).flatMap((fact) => (fact.heldBy.gate === app ? fact.heldBy.checks : []))
export const DIST = 'sha256:aaaa111122223333444455556666777788889999aaaabbbbccccddddeeeeffff'

const runner = { node: 'v22.20.0', platform: 'linux', arch: 'x64', image: 'ubuntu24', imageVersion: '20261005.1', docker: '29.8.1' }
const base = (key, job) => ({ schema: 1, job, key, runner, commit: 'c0ffee', run: { id: '42', attempt: '1' }, collectedAt: new Date(T0 + 3_600_000).toISOString(), suites: [], servers: [], browserGates: [], install: null, container: null, dist: [], tarballs: [], missing: [] })

const test = (name, meta = {}) => ({ name, status: 'passed', durationMs: 5, meta })
const file = (path, tests) => ({ file: path, status: 'passed', startTime: T0 + 1000, endTime: T0 + 2000, tests })
const suite = (name, path, files) => ({
  package: name,
  path,
  success: true,
  numTotalTests: files.reduce((total, entry) => total + entry.tests.length, 0),
  numFailedTestSuites: 0,
  startTime: T0,
  files,
  task: { startTime: T0 - 5000, endTime: T0 + 9000, cache: 'MISS' },
  coverage: { lines: { pct: 91.2 }, branches: { pct: 80 }, functions: { pct: 95 }, statements: { pct: 90.1 } },
})
export const server = (overrides) => ({
  engine: 'postgres',
  image: 'postgres:17-alpine',
  version: '17.11',
  updateLevel: null,
  edition: null,
  description: 'PostgreSQL 17.11',
  caller: 'packages/data-postgres/src/parity.integration.test.ts',
  script: 'test-coverage',
  at: new Date(T0 + 500).toISOString(),
  package: '@formancy/data-postgres',
  digest: 'postgres@sha256:b0f9',
  imageId: 'sha256:b0f9',
  ...overrides,
})
const SQLSERVER = { engine: 'sqlserver', image: 'mcr.microsoft.com/mssql/server:2022-latest', version: '16.0.4295.3', updateLevel: 'CU20', edition: 'Developer Edition (64-bit)', digest: 'mcr.microsoft.com/mssql/server@sha256:4402' }

export const CASES = ['edge: orderDate', 'filter: tenant_code = "acme"']
const PUBLISHED = ['@formancy/data-core', '@formancy/data-postgres', '@formancy/data-sqlserver']
/** Each job's own record of what it built: new objects every time, so a test that changes one job's changes no other's. */
const dist = (names = PUBLISHED) => names.map((name) => ({ package: name, distHash: DIST }))

/** The inputs of a run in which everything passed. */
export function greenRun() {
  const verify = { ...base('verify', 'verify'), suites: [suite(null, '.', [file('scripts/check-cla.test.mjs', [test('records a signature')])])], dist: dist() }
  const core = { ...base('test-data-core', 'test'), package: '@formancy/data-core', suites: [suite('@formancy/data-core', 'packages/data-core', [file('packages/data-core/src/a.test.ts', [test('parses an amount')]), file('packages/data-core/src/labels.test.ts', [test('labels two customers alike')])])] }
  const pg = {
    ...base('test-data-postgres', 'test'),
    package: '@formancy/data-postgres',
    suites: [
      suite('@formancy/data-postgres', 'packages/data-postgres', [
        file('packages/data-postgres/src/parity.integration.test.ts', [test('acme', { engine: 'postgres', covers: [CASES[1]] })]),
        file('packages/data-postgres/src/records.integration.test.ts', [test('edge values', { engine: 'postgres', covers: [CASES[0]] })]),
      ]),
    ],
    // A server per file, as every adapter file starts its own fixture: a
    // shared case counts for the image its own file's server answered on.
    servers: [server({}), server({ caller: 'packages/data-postgres/src/records.integration.test.ts' })],
    dist: dist(PUBLISHED.slice(0, 1)),
  }
  const ms = {
    ...base('test-data-sqlserver', 'test'),
    package: '@formancy/data-sqlserver',
    suites: [
      suite('@formancy/data-sqlserver', 'packages/data-sqlserver', [
        file('packages/data-sqlserver/src/parity.integration.test.ts', [test('acme', { engine: 'sqlserver', covers: [CASES[1]] })]),
        file('packages/data-sqlserver/src/records.integration.test.ts', [test('edge values', { engine: 'sqlserver', covers: [CASES[0]] })]),
      ]),
    ],
    servers: [
      server({ ...SQLSERVER, caller: 'packages/data-sqlserver/src/parity.integration.test.ts', package: '@formancy/data-sqlserver' }),
      server({ ...SQLSERVER, caller: 'packages/data-sqlserver/src/records.integration.test.ts', package: '@formancy/data-sqlserver' }),
    ],
    dist: dist(PUBLISHED.slice(0, 1)),
  }
  const host = {
    ...base('test-app-host', 'test'),
    package: '@formancy/data-host',
    suites: [suite('@formancy/data-host', 'apps/host', [file('apps/host/src/page.test.tsx', [test('loads a record')])])],
    servers: [server({ caller: 'apps/host/src/test-databases.ts', package: '@formancy/data-host' }), server({ ...SQLSERVER, caller: 'apps/host/src/test-databases.ts', package: '@formancy/data-host' })],
  }
  const browser = {
    ...base('browser-chromium', 'browser'),
    variant: 'chromium',
    browserGates: [
      {
        gate: 'apps/host',
        asked: 'chromium',
        startedAt: new Date(T0).toISOString(),
        finishedAt: new Date(T0 + 30_000).toISOString(),
        browser: { name: 'chromium', version: '153.0.8010.12', headless: true, options: { headless: true }, platform: 'linux', arch: 'x64' },
        environment: {
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36',
          platform: 'Linux x86_64',
          maxTouchPoints: 0,
          pointerFine: true,
          hover: true,
          system: { fallback: { family: 'DejaVu Sans' }, packages: [] },
        },
        axe: '4.14.0',
        widths: [320, 1440],
        passes: 2,
        made: [
          { label: 'reflow, 320', width: 320, checks: ['Signed out: no sideways scroll', ...heldChecks('apps/host')] },
          { label: 'laptop, 1440', width: 1440, checks: ['Signed out: no sideways scroll', ...heldChecks('apps/host')] },
        ],
        checks: { ok: 40, failed: [] },
        measurements: [
          { name: 'Chromium resent the create after its connection closed', value: 12.4, unit: 'ms' },
          { name: 'Chromium resent the create after its connection closed', value: 9.6, unit: 'ms' },
        ],
      },
    ],
    servers: [server({ caller: 'apps/host/scripts/browser-test.mjs', script: 'test-browser', package: 'apps/host' })],
    dist: dist(),
  }
  const install = {
    ...base('install', 'install'),
    install: {
      startedAt: new Date(T0).toISOString(),
      passed: true,
      node: 'v22.20.0',
      npm: '10.9.0',
      resolved: [
        { name: 'postgres', version: '3.4.9' },
        { name: 'fastify', version: '5.12.5' },
      ],
      tarballs: PUBLISHED.map((name) => ({ name, version: '0.1.0', file: `${name.slice(1).replace('/', '-')}-0.1.0.tgz`, sha256: 'ab'.repeat(32), integrity: 'sha512-x', distHash: DIST })),
    },
    dist: dist(),
  }
  const container = { ...base('container', 'container'), container: { image: 'formancy/data-server:ci', size: 210_000_000, node: 'v22.12.0', user: 'node' } }
  return {
    results: [verify, core, pg, ms, host, browser, install, container],
    facts: {
      engines: ['postgres', 'sqlserver'],
      images: { postgres: 'postgres:17-alpine', sqlserver: 'mcr.microsoft.com/mssql/server:2022-latest' },
      // The defaults alone, so a defect elsewhere gives its own sentence and
      // nothing else; withImageLeg() adds an image and its leg.
      matrix: { postgres: ['postgres:17-alpine'], sqlserver: ['mcr.microsoft.com/mssql/server:2022-latest'] },
      runtime: [
        { package: '@formancy/data-postgres', name: 'postgres', range: '^3.4.9', loaded: '3.4.9' },
        { package: '@formancy/data-server', name: 'fastify', range: '^5.12.5', loaded: '5.12.5' },
      ],
      upstream: [{ name: '@formancy/spec', version: '0.3.0', declared: '0.3.0', direct: true }],
      node: { engines: '>=22.12.0', dockerfile: ['node:22.12-alpine', 'node:22.12-alpine'], ci: [{ workflow: 'gates.yml', job: 'verify', version: '22' }], declared: [] },
      browser: { playwright: '1.63.0', pins: [{ browser: 'chromium', name: 'chromium-headless-shell', revision: '1243', browserVersion: '153.0.8010.12' }] },
      tooling: [{ name: 'jsdom', versions: [{ version: '30.1.2', from: ['apps/host'] }] }],
      snapshots: [{ file: 'apps/studio/src/fixtures/postgres-owner.json', kind: 'postgres', serverVersion: '17.11' }],
    },
    cases: [...CASES],
    covered: [
      { path: 'packages/data-core', id: 'data-core', name: '@formancy/data-core' },
      { path: 'packages/data-postgres', id: 'data-postgres', name: '@formancy/data-postgres' },
      { path: 'packages/data-sqlserver', id: 'data-sqlserver', name: '@formancy/data-sqlserver' },
      { path: 'apps/host', id: 'app-host', name: '@formancy/data-host' },
    ],
    published: [...PUBLISHED],
    browserApps: ['apps/host'],
    apps: [{ path: 'apps/host', name: '@formancy/data-host', renderers: [{ name: 'React', version: '19.3.0' }, { name: 'Angular', version: '22.2.1' }], jsdom: '30.1.2' }],
    register: {
      records: {
        '0012': {
          reviewed: 'sha256:12',
          limitations: [{ area: 'forms', says: 'Lookup labels are not unique.', heldBy: 'packages/data-core/src/labels.test.ts' }],
        },
      },
    },
    records: [{ number: '0012', file: '0012-a-lookup-token.md', title: 'A lookup token is a reference', status: 'accepted', hash: 'sha256:12' }],
    jobs: [...JOBS],
    // Evidence no other test's defect touches, so each defect still gives
    // exactly its own sentence; gates.test.mjs and the gate tests here change it.
    gatesRegister: {
      gates: Array.from({ length: 12 }, (_, index) => ({ gate: index + 1, open: 'Nothing to test yet.' })).map((entry) => (EVIDENCE[entry.gate] === undefined ? entry : { gate: entry.gate, evidence: EVIDENCE[entry.gate] })),
    },
    documents: { [FIGURES]: { sha: '1234567890abcdef1234567890abcdef12345678', date: '2026-10-01T12:00:00+02:00', behind: 3 } },
    exists: () => true,
    repository: 'https://github.com/sharkysan/formancy.ai-data',
    commit: 'c0ffee',
    version: '0.1.0',
    release: '',
    changelog: ['# Changelog', '', '## Unreleased', '', 'Something changed.', '', '## 0.2.0', '', 'Ahead of the manifests.', '', '## 0.1.0', '', 'The first.', ''].join('\n'),
    generatedAt: new Date(T0 + 3_700_000).toISOString(),
  }
}

/** The gates workflow's jobs that leave results, as greenCiRun() runs them. */
const JOBS = ['verify', 'test', 'browser', 'install', 'container', 'getting-started']
/** A committed figures document, as gate 11's evidence will be (0034). */
export const FIGURES = 'docs/release/figures.md'
const EVIDENCE = {
  1: [{ file: 'packages/data-postgres/src/parity.integration.test.ts' }],
  2: [{ browserGate: 'apps/host' }],
  3: [{ file: 'packages/data-sqlserver/src/records.integration.test.ts' }],
  5: [{ file: 'packages/data-core/src/labels.test.ts' }],
  11: [{ document: FIGURES }],
}

/**
 * greenRun() as the report job sees it in CI: every job's results in an
 * artefact of its own name, the getting-started job's among them, every
 * job's result in `needs` a success, this run's id, and gate 9 resting on
 * the getting-started job.
 */
export function greenCiRun() {
  const { results, ...inputs } = greenRun()
  const all = [...results, { ...base('getting-started-runner', 'getting-started'), variant: 'runner' }]
  inputs.gatesRegister.gates[8] = { gate: 9, evidence: [{ job: 'getting-started' }] }
  return {
    ...inputs,
    mode: 'ci',
    artefacts: all.map((result) => ({ name: `release-results-${result.key}`, files: [{ file: `${result.key}.json`, result }] })),
    expected: all.map(({ key, job }) => ({ key, job })),
    needs: Object.fromEntries(JOBS.map((name) => [name, { result: 'success', outputs: {} }])),
    run: { id: '42', attempt: '1', workflow: 'CI', url: 'https://github.com/sharkysan/formancy.ai-data/actions/runs/42' },
  }
}

/** The results file of `key` in a CI run's artefacts. */
export const ciJob = (inputs, key) => inputs.artefacts.flatMap((artefact) => artefact.files).find((entry) => entry.result?.key === key)?.result

/** A deep copy of a run's inputs, for a test to change one thing in; `exists` is a function, and kept. */
export const copy = ({ exists, ...rest }) => ({ ...structuredClone(rest), exists })

/** The results file of `key` in `inputs`. */
export const job = (inputs, key) => inputs.results.find((result) => result.key === key)

/**
 * `inputs` (a copy of greenRun()) as a run in which the gates also run in
 * `browser`: pinned beside Chromium, and the browser job's leg of it, on a
 * runner of its own, with the host gate's same checks and same-named
 * measurements, which only the browser tells apart.
 */
export function withBrowser(inputs, { browser, revision, version, image, offset, value, environment }) {
  inputs.facts.browser.pins.push({ browser, name: browser, revision, browserVersion: version })
  const chromium = job(inputs, 'browser-chromium')
  const [gate] = chromium.browserGates
  inputs.results.push({
    ...structuredClone(chromium),
    key: `browser-${browser}`,
    variant: browser,
    runner: { ...runner, image },
    servers: [server({ caller: 'apps/host/scripts/browser-test.mjs', script: 'test-browser', package: 'apps/host', at: new Date(T0 + offset + 500).toISOString() })],
    browserGates: [
      {
        ...structuredClone(gate),
        asked: browser,
        startedAt: new Date(T0 + offset).toISOString(),
        finishedAt: new Date(T0 + offset + 30_000).toISOString(),
        browser: { ...gate.browser, name: browser, version },
        environment: { ...gate.environment, ...environment },
        measurements: [{ name: gate.measurements[0].name, value, unit: 'ms' }],
      },
    ],
  })
  return inputs
}

/**
 * `inputs` (a copy of greenRun()) as a run whose matrix has `image` beside
 * PostgreSQL's default, and in which data-postgres's suite ran again on it in
 * a leg of the test-images job (0067): the same files and tests, and each
 * file's server on `image`, answering `version`.
 */
export function withImageLeg(inputs, { image = 'postgres:16-alpine', version = '16.15' } = {}) {
  inputs.facts.matrix.postgres.push(image)
  const pg = job(inputs, 'test-data-postgres')
  inputs.results.push({
    ...structuredClone(pg),
    job: 'test-images',
    key: `test-images-data-postgres-${image.replaceAll(/[^A-Za-z0-9.]+/g, '-')}`,
    variant: image,
    servers: pg.servers.map((entry) => ({ ...entry, image, version, description: `PostgreSQL ${version}`, digest: `postgres@sha256:${version}` })),
  })
  return inputs
}

/** `inputs` as a run in which the gates run in Chromium and Firefox. */
export const withFirefox = (inputs) =>
  withBrowser(inputs, { browser: 'firefox', revision: '1543', version: '155.0', image: 'ubuntu24-firefox', offset: 60_000, value: 30.2, environment: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0' } })

/** `inputs` as a run in which the gates run in Chromium and WebKit. */
export const withWebKit = (inputs) =>
  withBrowser(inputs, {
    browser: 'webkit',
    revision: '2359',
    version: '26.6',
    image: 'ubuntu24-webkit',
    offset: 120_000,
    value: 41.7,
    environment: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15',
      system: {
        fallback: { family: 'DejaVu Sans' },
        packages: [
          { name: 'libsoup-3.0-0', gives: 'networking', version: '3.4.4-5ubuntu0.5' },
          { name: 'glib-networking', gives: 'TLS', version: '2.80.0-1build1' },
          { name: 'libegl-mesa0', gives: 'EGL', version: null, why: 'dpkg-query gave no version: dpkg-query: no packages found matching libegl-mesa0' },
        ],
      },
    },
  })
