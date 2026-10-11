import { CATALOGUE } from './catalogue.js'
import { PUBLISH_PROTOCOL } from './protocol.js'
import type { EngineKey, LatencyResult, RefusalResult, Results, RunFacts, ScenarioResult, SizeFacts } from './results.js'
import { ENGINE_KEYS, expectedBlocks } from './results.js'

/*
 * A complete, valid published result, made up, for the validator's and the
 * renderer's suites: every block the catalogue and the publish protocol call
 * for, with figures that are deterministic and plainly not measurements.
 * Test support; never part of the package's output.
 */

const RUN: Record<EngineKey, RunFacts> = {
  pg: { machineBusyPct: 6.25, steal: 'not reported', generatorLagP99Ms: 1.2, loadAvgAtStart: 0.12, calibrationRatio: 1.02, repeated: false, disturbances: { autovacuum: 0, autoanalyze: 0 }, reconnects: 0 },
  ms: { machineBusyPct: 7.5, steal: 'not reported', generatorLagP99Ms: 1.4, loadAvgAtStart: 0.2, calibrationRatio: 1.03, repeated: false, disturbances: { recompiles: 0, statisticsUpdated: 0 }, reconnects: 0 },
}

function sizes(orders: number): SizeFacts {
  return {
    customerRows: { total: 1_000_002, perTenant: { '1': 100_001, '2': 900_001 } },
    customerDataBytes: 104_857_600,
    customerIndexBytes: 31_457_280,
    orderRows: orders,
    databaseBytes: 159_383_552 + orders * 100,
    detail: {},
  }
}

export function publishedResults(): Results {
  const protocol = { ...PUBLISH_PROTOCOL, calibration: { ...PUBLISH_PROTOCOL.calibration, tolerance: 1.1 } }
  const scenarios: ScenarioResult[] = expectedBlocks(CATALOGUE, protocol).map(({ engine, scenario, concurrency }, index) => {
    const base = 1 + index / 10
    return {
      engine,
      scenario: scenario.name,
      concurrency,
      n: 3000,
      p50: base,
      p90: base * 1.5,
      p99: base * 3,
      max: base * 10,
      mean: base * 1.2,
      rounds: [base * 0.98, base, base * 1.03],
      throughput: (concurrency * 1000) / base,
      roundTrips: scenario.roundTrips[engine],
      rowsAnswered: scenario.name.startsWith('lookup-absent') ? 0 : 1,
      serverCpuMsPerRequest: 0.4,
      databaseCpuMsPerRequest: 0.6,
      databaseIdleCpuMsPerSecond: 12,
      run: RUN[engine],
    }
  })
  const latency: LatencyResult[] = ENGINE_KEYS.flatMap((engine) =>
    CATALOGUE.scenarios
      .filter((scenario) => scenario.latency)
      .map((scenario) => {
        const roundTrips = scenario.roundTrips[engine]
        const expectedMs = protocol.latency.delayMs * roundTrips
        const rounds = [0, 1, 2].map((r) => ({ undelayed: { n: 200, p50: 2 + r / 100 }, delayed: { n: 200, p50: 2 + r / 100 + expectedMs + 0.1 }, differenceMs: expectedMs + 0.1 }))
        return { engine, scenario: scenario.name, roundTrips, rounds, undelayedMs: 2.01, delayedMs: 2.11 + expectedMs, differenceMs: expectedMs + 0.1, spreadMs: 0, expectedMs, ratio: roundTrips === 0 ? null : (expectedMs + 0.1) / expectedMs, run: RUN[engine] }
      }),
  )
  const refusals: RefusalResult[] = ENGINE_KEYS.flatMap((engine) =>
    CATALOGUE.refusals.map((refusal) => ({ engine, scenario: refusal.name, roundTrips: refusal.roundTrips[engine], status: refusal.answer.status, code: refusal.answer.code })),
  )
  const summary = { n: 2000, p50: 0.05, p90: 0.07, p99: 0.12, max: 0.9, mean: 0.06 }
  const tally = [
    { operation: 'form', form: 'pg-order', status: 200, count: 3110 },
    { operation: 'lookup-query', form: 'pg-order', status: 200, count: 24_440 },
  ]
  return {
    format: 1,
    measuredAt: '2026-10-10T08:00:00.000Z',
    finishedAt: '2026-10-10T09:30:00.000Z',
    durationSeconds: 5400,
    protocol,
    commit: '0123456789abcdef0123456789abcdef01234567',
    catalogue: CATALOGUE,
    product: { files: { 'packages/data-server/src/main.ts': 'a'.repeat(64) }, packages: { postgres: '3.4.9' }, build: { 'tsconfig.base.json': 'b'.repeat(64) } },
    machine: {
      cpu: { model: 'Intel(R) Core(TM) i9-10900K CPU @ 3.70GHz', vcpus: 20, sockets: 1, coresPerSocket: 20, threadsPerCore: 1, hypervisor: 'Microsoft' },
      memoryBytes: 16_000_000_000,
      os: { prettyName: 'Ubuntu 26.04.1 LTS', kernel: '7.0.14', clkTck: 100 },
      cgroup: { path: '/docker/abc', cpuMax: 'max 100000' },
      docker: { version: '29.8.1', os: 'Ubuntu 26.04.1 LTS (containerized)', storageDriver: 'overlayfs', cgroupDriver: 'cgroupfs', ncpu: 20, memTotalBytes: 16_000_000_000 },
      databaseLimits: { pg: { nanoCpus: 0, cpuQuota: 0, cpuPeriod: 0, memoryBytes: 0 }, ms: { nanoCpus: 0, cpuQuota: 0, cpuPeriod: 0, memoryBytes: 0 } },
      node: 'v22.22.1',
      quiet: { enforced: true, containersBefore: [], loadAverage: 0.08, busyVcpusMax: 0.21, stealReported: false, calibrationBaselineMs: 4.2, seconds: 10 },
    },
    network: {
      client: { transport: 'HTTP/1.1, keep-alive', address: '127.0.0.1', tls: false, proxy: { HTTP_PROXY: null, HTTPS_PROXY: null, NO_PROXY: null } },
      engines: {
        pg: { host: 'localhost', lookup: ['127.0.0.1'], port: 32768, dockerProxy: true, tls: false },
        ms: { host: 'localhost', lookup: ['127.0.0.1'], port: 32769, dockerProxy: true, tls: false },
      },
      hopDelayMs: protocol.latency.delayMs,
    },
    server: {
      entry: 'packages/data-server/dist/main.mjs',
      node: 'v22.22.1',
      settings: ['FORMANCY_DATA_ISSUER', 'FORMANCY_DATA_RATE_LIMIT'],
      rateLimit: 10_000_000,
      logger: true,
      auditKeyed: true,
      account: { pg: 'formancy_writer', ms: 'formancy_writer' },
      logLinesPerRequest: 3,
    },
    engines: {
      pg: { image: 'postgres:17-alpine', imageId: 'sha256:1', repoDigests: ['postgres@sha256:2'], version: 'PostgreSQL 17.11 on x86_64-pc-linux-musl', settings: { shared_buffers: '128MB' }, text: { codePointOrder: true, lowerFoldsUmlaut: false }, sizes: { before: sizes(2), after: sizes(30_002) }, memoryBytes: 300_000_000 },
      ms: { image: 'mcr.microsoft.com/mssql/server:2022-latest', imageId: 'sha256:3', repoDigests: ['mcr.microsoft.com/mssql/server@sha256:4'], version: '16.0.4295.3 Developer Edition (64-bit) CU27', settings: { maxdop: '0' }, text: null, sizes: { before: sizes(2), after: sizes(30_002) }, memoryBytes: 900_000_000 },
    },
    bundle: { 'pg-order': { versionBytes: 60_000, snapshotBytes: 40_000, snapshotObjects: 9 }, 'ms-order': { versionBytes: 61_000, snapshotBytes: 41_000, snapshotObjects: 9 } },
    sizedTable: { generator: 'sales.customer sized 1', rows: 1_000_002, perTenant: { '1': 100_001, '2': 900_001 }, digest: 'c'.repeat(64), loadSeconds: { pg: 35.2, ms: 15.1 } },
    containers: [{ role: 'pg', id: 'd1', image: 'postgres:17-alpine', imageId: 'sha256:1', repoDigests: ['postgres@sha256:2'] }],
    components: {
      verifyToken: { label: 'Verify a host token', ...summary },
      readBundle: { pg: { label: 'Read and check the published version', form: 'pg-order', ...summary }, ms: { label: 'Read and check the published version', form: 'ms-order', ...summary } },
      floor: { pg: { ...summary, roundTrips: 2, perRoundTripMs: 0.025 }, ms: { ...summary, roundTrips: 2, perRoundTripMs: 0.025 } },
    },
    scenarios,
    latency,
    refusals,
    checks: { requests: tally, runtimeEvents: tally.map((row) => ({ ...row })), adminRequests: 20, adminEvents: 20, unexpected: 0, errorLines: 0, writes: 30_000, createdCustomers: { pg: 100, ms: 100 } },
  }
}
