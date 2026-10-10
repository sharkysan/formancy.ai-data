import type { Catalogue, CatalogueRefusal, CatalogueScenario, EngineKey, Protocol, Results } from './results.js'
import { ENGINE_KEYS, expectedBlocks } from './results.js'

/*
 * Whether a results document may be rendered, and whether it may be
 * published (0034). Checked against the catalogue and protocol the result
 * carries, never against today's `catalogue.ts`: a pull request that changes
 * a pin does not turn the page's test red for want of a re-measurement --
 * the release's stale check catches that, because `catalogue.ts` is part of
 * the product it digests.
 *
 * Node built-ins only, so `scripts/performance-doc.test.mjs` imports it as
 * source. Every problem names its path.
 */

export type Validation = { ok: true } | { ok: false; problems: string[] }

type Check = (value: unknown, path: string, problems: string[]) => void

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const str: Check = (value, path, problems) => {
  if (typeof value !== 'string') problems.push(`${path}: expected a string`)
}
const num: Check = (value, path, problems) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${path}: expected a number`)
}
const bool: Check = (value, path, problems) => {
  if (typeof value !== 'boolean') problems.push(`${path}: expected true or false`)
}
const nullable = (check: Check): Check => (value, path, problems) => {
  if (value !== null) check(value, path, problems)
}
const oneOf = (...allowed: readonly unknown[]): Check => (value, path, problems) => {
  if (!allowed.includes(value)) problems.push(`${path}: expected one of ${allowed.map((entry) => JSON.stringify(entry)).join(', ')}`)
}
const either = (a: Check, b: Check): Check => (value, path, problems) => {
  const first: string[] = []
  a(value, path, first)
  if (first.length === 0) return
  const second: string[] = []
  b(value, path, second)
  if (second.length > 0) problems.push(...first)
}
const arr = (check: Check): Check => (value, path, problems) => {
  if (!Array.isArray(value)) return void problems.push(`${path}: expected a list`)
  value.forEach((entry, index) => check(entry, `${path}[${String(index)}]`, problems))
}
const rec = (check: Check): Check => (value, path, problems) => {
  if (!isObject(value)) return void problems.push(`${path}: expected an object`)
  for (const [key, entry] of Object.entries(value)) check(entry, `${path}.${key}`, problems)
}
const obj = (fields: Record<string, Check>): Check => (value, path, problems) => {
  if (!isObject(value)) return void problems.push(`${path}: expected an object`)
  for (const [key, check] of Object.entries(fields)) check(value[key], path === '' ? key : `${path}.${key}`, problems)
}
const engines = (check: Check): Check => obj(Object.fromEntries(ENGINE_KEYS.map((engine) => [engine, check])))

const budget = obj({ requests: num, seconds: num, atLeast: num })
const summary = { n: num, p50: nullable(num), p90: nullable(num), p99: nullable(num), max: num, mean: num }
const runFacts = obj({
  machineBusyPct: num,
  steal: either(num, oneOf('not reported')),
  generatorLagP99Ms: num,
  loadAvgAtStart: num,
  calibrationRatio: num,
  repeated: bool,
  disturbances: rec(num),
  reconnects: num,
})
const sizeFacts = obj({ customerRows: obj({ total: num, perTenant: rec(num) }), customerDataBytes: num, customerIndexBytes: num, orderRows: num, databaseBytes: num, detail: rec(num) })
const tally = arr(obj({ operation: str, form: str, status: num, count: num }))
const catalogueScenario = obj({
  name: str,
  label: str,
  form: oneOf('order', 'order-unfiltered', null),
  inFlight: oneOf('all', 'one'),
  latency: bool,
  roundTrips: engines(num),
  rowsRead: either(oneOf(null), either(obj({ exactly: num }), obj({ atMost: num }))),
})
const catalogueRefusal = obj({ name: str, label: str, answer: obj({ status: num, code: str }), roundTrips: engines(num) })

const SHAPE: Check = obj({
  format: oneOf(1),
  measuredAt: str,
  finishedAt: str,
  durationSeconds: num,
  protocol: obj({
    name: oneOf('publish', 'smoke'),
    warmup: budget,
    samples: budget,
    percentiles: arr(num),
    rounds: num,
    concurrency: arr(num),
    latency: obj({ delayMs: num, warmup: budget, samples: num }),
    components: obj({ warmup: num, samples: num }),
    calibration: obj({ intervalMs: num, gapMs: num, tolerance: either(num, oneOf(null, 'unbounded')) }),
    quiet: obj({ enforced: bool, loadAverageBelow: num, busyVcpusAtMost: num, windowSeconds: num, giveUpSeconds: num }),
    tokenSeconds: num,
  }),
  commit: str,
  catalogue: obj({ scenarios: arr(catalogueScenario), refusals: arr(catalogueRefusal), floor: obj({ label: str, roundTrips: engines(num) }) }),
  product: obj({ files: rec(str), packages: rec(str), build: rec(str) }),
  machine: obj({
    cpu: obj({ model: str, vcpus: num, sockets: num, coresPerSocket: num, threadsPerCore: num, hypervisor: nullable(str) }),
    memoryBytes: num,
    os: obj({ prettyName: str, kernel: str, clkTck: num }),
    cgroup: obj({ path: str, cpuMax: str }),
    docker: obj({ version: str, os: str, storageDriver: str, cgroupDriver: str, ncpu: num, memTotalBytes: num }),
    databaseLimits: engines(obj({ nanoCpus: num, cpuQuota: num, cpuPeriod: num, memoryBytes: num })),
    node: str,
    quiet: obj({ enforced: bool, containersBefore: arr(str), loadAverage: num, busyVcpusMax: num, stealReported: bool, calibrationBaselineMs: num, seconds: num }),
  }),
  network: obj({
    client: obj({ transport: str, address: str, tls: oneOf(false), proxy: rec(nullable(str)) }),
    engines: engines(obj({ host: str, lookup: arr(str), port: num, dockerProxy: bool, tls: oneOf(false) })),
    hopDelayMs: num,
  }),
  server: obj({ entry: str, node: str, settings: arr(str), rateLimit: num, logger: bool, auditKeyed: bool, account: engines(str), logLinesPerRequest: num }),
  engines: engines(
    obj({
      image: str,
      imageId: str,
      repoDigests: arr(str),
      version: str,
      settings: rec(str),
      text: nullable(obj({ codePointOrder: bool, lowerFoldsUmlaut: bool })),
      sizes: obj({ before: sizeFacts, after: sizeFacts }),
      memoryBytes: num,
    }),
  ),
  bundle: rec(obj({ versionBytes: num, snapshotBytes: num, snapshotObjects: num })),
  sizedTable: obj({ generator: str, rows: num, perTenant: rec(num), digest: str, loadSeconds: engines(num) }),
  containers: arr(obj({ role: str, id: str, image: str, imageId: str, repoDigests: arr(str) })),
  components: obj({
    verifyToken: obj({ label: str, ...summary }),
    readBundle: engines(obj({ label: str, form: str, ...summary })),
    floor: engines(obj({ ...summary, roundTrips: num, perRoundTripMs: nullable(num) })),
  }),
  scenarios: arr(
    obj({
      engine: oneOf(...ENGINE_KEYS),
      scenario: str,
      concurrency: num,
      ...summary,
      rounds: arr(nullable(num)),
      throughput: num,
      roundTrips: num,
      rowsAnswered: num,
      serverCpuMsPerRequest: num,
      databaseCpuMsPerRequest: num,
      databaseIdleCpuMsPerSecond: num,
      run: runFacts,
    }),
  ),
  latency: arr(
    obj({
      engine: oneOf(...ENGINE_KEYS),
      scenario: str,
      roundTrips: num,
      rounds: arr(obj({ undelayed: obj({ n: num, p50: nullable(num) }), delayed: obj({ n: num, p50: nullable(num) }), differenceMs: nullable(num) })),
      undelayedMs: nullable(num),
      delayedMs: nullable(num),
      differenceMs: nullable(num),
      spreadMs: nullable(num),
      expectedMs: num,
      ratio: nullable(num),
      run: runFacts,
    }),
  ),
  refusals: arr(obj({ engine: oneOf(...ENGINE_KEYS), scenario: str, roundTrips: num, status: num, code: str })),
  checks: obj({ requests: tally, runtimeEvents: tally, adminRequests: num, adminEvents: num, unexpected: num, errorLines: num, writes: num, createdCustomers: engines(num) }),
})

/** A JSON Web Token's shape: a base64url JSON header, a payload and a signature. */
const TOKEN = /eyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*/

function strings(value: unknown, path: string, found: (text: string, path: string) => void): void {
  if (typeof value === 'string') return found(value, path)
  if (Array.isArray(value)) return value.forEach((entry, index) => strings(entry, `${path}[${String(index)}]`, found))
  if (isObject(value)) for (const [key, entry] of Object.entries(value)) strings(entry, path === '' ? key : `${path}.${key}`, found)
}

/** Percentiles of one set never decrease, and none passes the largest sample. */
function ordered(entry: { p50: number | null; p90: number | null; p99: number | null; max: number }, path: string, problems: string[]): void {
  let below: { name: string; value: number } | undefined
  for (const name of ['p50', 'p90', 'p99', 'max'] as const) {
    const value = entry[name]
    if (value === null) continue
    if (below !== undefined && value < below.value) problems.push(`${path}.${name}: ${String(value)} is below ${below.name}`)
    below = { name, value }
  }
}

function blocks(results: Results, problems: string[]): void {
  const byName = new Map(results.catalogue.scenarios.map((scenario) => [scenario.name, scenario]))
  const wanted = new Set(expectedBlocks(results.catalogue, results.protocol).map(({ engine, scenario, concurrency }) => `${engine} ${scenario.name} ${String(concurrency)}`))
  const seen = new Set<string>()
  results.scenarios.forEach((entry, index) => {
    const path = `scenarios[${String(index)}]`
    const key = `${entry.engine} ${entry.scenario} ${String(entry.concurrency)}`
    const named = `${entry.engine} ${entry.scenario} at ${String(entry.concurrency)} in flight`
    if (!wanted.has(key)) return void problems.push(`${path}: ${named}, which the catalogue does not name`)
    if (seen.has(key)) return void problems.push(`${path}: ${named}, a second time`)
    seen.add(key)
    ordered(entry, path, problems)
    pinned(byName.get(entry.scenario) as CatalogueScenario, entry.engine, entry.roundTrips, `${path}.roundTrips`, problems)
  })
  for (const key of wanted) {
    if (seen.has(key)) continue
    const [engine, scenario, concurrency] = key.split(' ')
    problems.push(`scenarios: no ${String(engine)} ${String(scenario)} at ${String(concurrency)} in flight, which the catalogue names`)
  }
}

function pinned(scenario: { roundTrips: Readonly<Record<EngineKey, number>> }, engine: EngineKey, counted: number, path: string, problems: string[]): void {
  const pin = scenario.roundTrips[engine]
  if (counted !== pin) problems.push(`${path}: counted ${String(counted)}, the catalogue pins ${String(pin)}`)
}

function latency(results: Results, problems: string[]): void {
  const byName = new Map(results.catalogue.scenarios.map((scenario) => [scenario.name, scenario]))
  const wanted = new Set(ENGINE_KEYS.flatMap((engine) => results.catalogue.scenarios.filter((scenario) => scenario.latency).map((scenario) => `${engine} ${scenario.name}`)))
  const seen = new Set<string>()
  results.latency.forEach((entry, index) => {
    const path = `latency[${String(index)}]`
    const key = `${entry.engine} ${entry.scenario}`
    if (!wanted.has(key)) return void problems.push(`${path}: ${key} with added latency, which the catalogue does not name`)
    if (seen.has(key)) return void problems.push(`${path}: ${key} with added latency, a second time`)
    seen.add(key)
    pinned(byName.get(entry.scenario) as CatalogueScenario, entry.engine, entry.roundTrips, `${path}.roundTrips`, problems)
    if (entry.rounds.length !== results.protocol.rounds) problems.push(`${path}.rounds: ${String(entry.rounds.length)} rounds, the protocol runs ${String(results.protocol.rounds)}`)
  })
  for (const key of wanted) if (!seen.has(key)) problems.push(`latency: no ${key} with added latency, which the catalogue names`)
}

/** Every refusal the catalogue names, once per engine, counted as it pins and answered as it says. */
function refusals(results: Results, problems: string[]): void {
  const byName = new Map(results.catalogue.refusals.map((refusal) => [refusal.name, refusal]))
  const wanted = new Set(ENGINE_KEYS.flatMap((engine) => results.catalogue.refusals.map((refusal) => `${engine} ${refusal.name}`)))
  const seen = new Set<string>()
  results.refusals.forEach((entry, index) => {
    const path = `refusals[${String(index)}]`
    const key = `${entry.engine} ${entry.scenario}`
    if (!wanted.has(key)) return void problems.push(`${path}: ${key}, which the catalogue does not name`)
    if (seen.has(key)) return void problems.push(`${path}: ${key}, a second time`)
    seen.add(key)
    const refusal = byName.get(entry.scenario) as CatalogueRefusal
    pinned(refusal, entry.engine, entry.roundTrips, `${path}.roundTrips`, problems)
    if (entry.status !== refusal.answer.status || entry.code !== refusal.answer.code) {
      problems.push(`${path}: ${key} answered ${String(entry.status)} ${entry.code}, where the catalogue says ${String(refusal.answer.status)} ${refusal.answer.code}`)
    }
  })
  for (const key of wanted) if (!seen.has(key)) problems.push(`refusals: no ${key}, which the catalogue names`)
}

function steal(results: Results, problems: string[]): void {
  const reported = results.machine.quiet.stealReported
  const each = (run: { steal: number | 'not reported' }, path: string): void => {
    if (!reported && run.steal !== 'not reported') problems.push(`${path}.run.steal: ${String(run.steal)}, where this hypervisor reports no steal`)
    if (reported && run.steal === 'not reported') problems.push(`${path}.run.steal: not reported, where this hypervisor reports steal`)
  }
  results.scenarios.forEach((entry, index) => each(entry.run, `scenarios[${String(index)}]`))
  results.latency.forEach((entry, index) => each(entry.run, `latency[${String(index)}]`))
}

function reconciled(results: Results, problems: string[]): void {
  const key = (row: { operation: string; form: string; status: number }): string => `${row.operation} ${row.form} ${String(row.status)}`
  const sent = new Map(results.checks.requests.map((row) => [key(row), row.count]))
  const written = new Map(results.checks.runtimeEvents.map((row) => [key(row), row.count]))
  for (const name of new Set([...sent.keys(), ...written.keys()])) {
    const requests = sent.get(name) ?? 0
    const events = written.get(name) ?? 0
    if (requests !== events) problems.push(`checks.runtimeEvents: ${name} is ${String(events)} events for ${String(requests)} requests`)
  }
  if (results.checks.adminEvents !== results.checks.adminRequests) problems.push(`checks.adminEvents: ${String(results.checks.adminEvents)} events for ${String(results.checks.adminRequests)} requests`)
  if (results.checks.unexpected !== 0) problems.push(`checks.unexpected: ${String(results.checks.unexpected)} answers the scenarios did not expect`)
  if (results.checks.errorLines !== 0) problems.push(`checks.errorLines: ${String(results.checks.errorLines)} lines at level 50 or above in the server's log`)
}

/**
 * The hop adds D to every database answer and is otherwise meant to be
 * loopback. Undelayed, a request through it that took more than D longer
 * than the same request sent directly measured the hop -- as Nagle's
 * algorithm on its sockets did -- and the difference beside it would not be
 * the delay's. D is the bound because it is the size of what the block
 * measures; a p50 too small to print is not compared.
 */
function transparentHop(results: Results, problems: string[]): void {
  const delay = results.protocol.latency.delayMs
  results.latency.forEach((entry, index) => {
    const direct = results.scenarios.find((candidate) => candidate.engine === entry.engine && candidate.scenario === entry.scenario && candidate.concurrency === 1)
    if (entry.undelayedMs === null || direct?.p50 === null || direct === undefined) return
    if (entry.undelayedMs - direct.p50 > delay) {
      problems.push(`latency[${String(index)}].undelayedMs: ${entry.engine} ${entry.scenario} took ${String(entry.undelayedMs)} ms through the hop undelayed and ${String(direct.p50)} ms direct, more than the ${String(delay)} ms it adds`)
    }
  })
}

/** What only a published result must also be: the publish protocol, measured on a quiet machine, every machine field said, through a hop that adds only its delay. */
function publishable(results: Results, problems: string[]): void {
  transparentHop(results, problems)
  const protocol: Protocol = results.protocol
  if (protocol.name !== 'publish') problems.push(`protocol.name: ${protocol.name}, where a published result is measured with the publish protocol`)
  if (typeof protocol.calibration.tolerance !== 'number') problems.push(`protocol.calibration.tolerance: ${protocol.calibration.tolerance === null ? 'none' : protocol.calibration.tolerance}, which P13 sets before a publish run`)
  if (!protocol.quiet.enforced || !results.machine.quiet.enforced) problems.push('machine.quiet.enforced: the quiet check was recorded and not enforced')
  for (const name of results.machine.quiet.containersBefore) problems.push(`machine.quiet.containersBefore: ${name} was running before the run started`)
  strings(results.machine, 'machine', (text, path) => {
    if (text.trim() === '') problems.push(`${path}: empty`)
  })
}

/**
 * Whether `json` is a results document the page can be rendered from, with
 * every reason it is not; `published` adds what only a published one must
 * be. The pins and the audit reconciliation are checked in both modes,
 * because the smoke run is what proves the harness checks them at all.
 */
export function validateResults(json: unknown, options: { published: boolean }): Validation {
  const problems: string[] = []
  SHAPE(json, '', problems)
  if (problems.length > 0) return { ok: false, problems }
  const results = json as Results
  const catalogue: Catalogue = results.catalogue
  blocks(results, problems)
  latency(results, problems)
  refusals(results, problems)
  for (const engine of ENGINE_KEYS) pinned(catalogue.floor, engine, results.components.floor[engine].roundTrips, `components.floor.${engine}.roundTrips`, problems)
  steal(results, problems)
  reconciled(results, problems)
  strings(results, '', (text, path) => {
    if (TOKEN.test(text)) problems.push(`${path}: looks like a token`)
  })
  // `network.ts` cuts everything before a proxy's last `@`; one left means a value reached the file past that cut.
  for (const [name, value] of Object.entries(results.network.client.proxy)) {
    if (value?.includes('@') === true) problems.push(`network.client.proxy.${name}: carries a user and perhaps a password`)
  }
  if (options.published) publishable(results, problems)
  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}
