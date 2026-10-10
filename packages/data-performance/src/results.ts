/*
 * What a measurement records: `docs/performance/results.json`, format 1
 * (0034). The page's generated region is rendered from it and from nothing
 * else, and `validate.ts` decides whether it may be published.
 *
 * Node built-ins only, like `validate.ts`, `format.ts` and `render.ts`, so
 * the repository's own guards import these as source without a build. The
 * catalogue and protocol types live here for that reason: a result carries
 * the catalogue and protocol it was measured with, and is checked against
 * those, never against today's `catalogue.ts`.
 */

/** The two engines, as the forms and connections name them: `pg-order`, `ms-order`. */
export type EngineKey = 'pg' | 'ms'
export const ENGINE_KEYS: readonly EngineKey[] = ['pg', 'ms']
export const ENGINE_NAMES: Readonly<Record<EngineKey, string>> = { pg: 'PostgreSQL', ms: 'SQL Server' }

/** Rows the database reads for one request, derived from the generator and held by the adapters' sized suites. */
export type RowsRead = { exactly: number } | { atMost: number }

/** One request a host sends, as the measurement names, counts and runs it. */
export interface CatalogueScenario {
  /** Stable, kebab-case: `lookup-first-page`. */
  name: string
  /** What the page calls it. */
  label: string
  /** The form it runs against: the tenant-filtered order form, the one with no tenant row filter, or none. */
  form: 'order' | 'order-unfiltered' | null
  /** At every in-flight level the protocol names, or one request at a time only. */
  inFlight: 'all' | 'one'
  /** Whether it runs in the added-latency block. */
  latency: boolean
  /** Database round trips one request makes, per engine, as the hop counts them: pinned. */
  roundTrips: Readonly<Record<EngineKey, number>>
  /** What the database reads, or null where no suite holds it. */
  rowsRead: RowsRead | null
}

/** A request the server refuses, counted through the hop and never timed: what a stopped request still asks the database. */
export interface CatalogueRefusal {
  /** Stable, kebab-case: `create-drifted`. */
  name: string
  /** What the page calls it. */
  label: string
  /** What the server must answer; any other answer stops the run. */
  answer: { status: number; code: string }
  /** Database round trips one request makes, per engine, as the hop counts them: pinned. */
  roundTrips: Readonly<Record<EngineKey, number>>
}

export interface Catalogue {
  scenarios: readonly CatalogueScenario[]
  refusals: readonly CatalogueRefusal[]
  /** One parameterised select through the adapter package's own connection, as the writer: the adapters' statement shape. */
  floor: { label: string; roundTrips: Readonly<Record<EngineKey, number>> }
}

/** How long a phase lasts: requests, or seconds, whichever ends first, but at least `atLeast` requests. */
export interface Budget {
  requests: number
  seconds: number
  atLeast: number
}

export interface Protocol {
  /** A smoke result can never validate as a published one. */
  name: 'publish' | 'smoke'
  warmup: Budget
  samples: Budget
  /** Whole percents, so ranks are integer arithmetic. */
  percentiles: readonly number[]
  rounds: number
  /** Requests kept in flight, closed loop. */
  concurrency: readonly number[]
  /** The added-latency block: D, and the samples of each pass. */
  latency: { delayMs: number; warmup: Budget; samples: number }
  /** In-process components: warm-up and samples. */
  components: { warmup: number; samples: number }
  /**
   * The probe's interval; the idle gap, nothing in flight, taken before each
   * block's warm-up and after its timed window, in which the probe and the
   * database's idle CPU are read; and how far a gap's median may sit from the
   * quiet baseline before the block runs again. The tolerance is `null` until
   * P13 measures it, and a publish run refuses to start without it;
   * `unbounded` is smoke's.
   */
  calibration: { intervalMs: number; gapMs: number; tolerance: number | 'unbounded' | null }
  /**
   * The quiet check. `enforced` false records it and refuses nothing: the
   * smoke run shares a machine. A published result must have enforced it.
   */
  quiet: { enforced: boolean; loadAverageBelow: number; busyVcpusAtMost: number; windowSeconds: number; giveUpSeconds: number }
  /** How long the round's client token lives, longer than a round. */
  tokenSeconds: number
}

export interface Summary {
  n: number
  /** Null when fewer than ten samples sit at or above the rank: "n too small". */
  p50: number | null
  p90: number | null
  p99: number | null
  max: number
  mean: number
}

/** What was going on around one block, aggregated over its rounds. */
export interface RunFacts {
  /** Mean share of the machine's vCPUs busy while the block ran, in percent. */
  machineBusyPct: number
  /** Most steal seen in percent, or `not reported` when the hypervisor reports none since boot. */
  steal: number | 'not reported'
  /** Worst p99 of the generator's event-loop delay, in ms. */
  generatorLagP99Ms: number
  loadAvgAtStart: number
  /**
   * Worst ratio of the calibration probe's median in an idle gap around the
   * block, before or after it, to the quiet baseline. Never the probe under
   * the block's own load, which slows with the run itself.
   */
  calibrationRatio: number
  /** Whether any round of the block was run again for a calibration miss. */
  repeated: boolean
  /** PostgreSQL: autovacuum and autoanalyze runs. SQL Server: recompilations and statistics updated. */
  disturbances: Record<string, number>
  /** Writer sessions present at a block's end and not at its start. */
  reconnects: number
}

export interface ScenarioResult extends Summary {
  engine: EngineKey
  scenario: string
  concurrency: number
  /** Each round's p50. */
  rounds: Array<number | null>
  /** Requests per second over the measured windows. */
  throughput: number
  /** Counted through the hop in the counting pass. */
  roundTrips: number
  rowsAnswered: number
  serverCpuMsPerRequest: number
  /** The database container's CPU over the timed windows, over the requests: what the engine did on its own included. */
  databaseCpuMsPerRequest: number
  /** The database container's CPU over the idle gaps around the block, per second of gap: what it does with nothing in flight. */
  databaseIdleCpuMsPerSecond: number
  run: RunFacts
}

export interface LatencyRound {
  undelayed: { n: number; p50: number | null }
  delayed: { n: number; p50: number | null }
  /** Delayed p50 less undelayed p50, or null when either is. */
  differenceMs: number | null
}

export interface LatencyResult {
  engine: EngineKey
  scenario: string
  roundTrips: number
  rounds: LatencyRound[]
  /** The median of the rounds' p50s, by nearest rank: undelayed, and with D on every answer. */
  undelayedMs: number | null
  delayedMs: number | null
  /** The median of the rounds' differences, by nearest rank. */
  differenceMs: number | null
  /** Largest less smallest round difference: P14 holds it under a tenth of D. */
  spreadMs: number | null
  /** D × the counted round trips. */
  expectedMs: number
  /** differenceMs / expectedMs, or null with no round trips or no difference. */
  ratio: number | null
  run: RunFacts
}

/** One refusal on one engine, as the counting pass counted it and the server answered it. */
export interface RefusalResult {
  engine: EngineKey
  scenario: string
  roundTrips: number
  status: number
  code: string
}

export interface ComponentResult extends Summary {
  label: string
}

export interface FloorResult extends Summary {
  roundTrips: number
  /** The floor's p50 over its counted round trips. */
  perRoundTripMs: number | null
}

export interface BundleFacts {
  versionBytes: number
  snapshotBytes: number
  snapshotObjects: number
}

/** Rows and bytes, the same shape on both engines; what differs is in `detail`. */
export interface SizeFacts {
  customerRows: { total: number; perTenant: Record<string, number> }
  customerDataBytes: number
  customerIndexBytes: number
  orderRows: number
  databaseBytes: number
  detail: Record<string, number>
}

export interface EngineFacts {
  image: string
  imageId: string
  repoDigests: string[]
  /** `version()`, or SQL Server's product version, edition and update level. */
  version: string
  /** The settings 0034 lists, by name. */
  settings: Record<string, string>
  /** PostgreSQL's text behaviour as observed; empty on SQL Server, whose collation is a setting. */
  text: { codePointOrder: boolean; lowerFoldsUmlaut: boolean } | null
  sizes: { before: SizeFacts; after: SizeFacts }
  memoryBytes: number
}

export interface ContainerFacts {
  role: string
  id: string
  image: string
  imageId: string
  repoDigests: string[]
}

export interface Machine {
  cpu: { model: string; vcpus: number; sockets: number; coresPerSocket: number; threadsPerCore: number; hypervisor: string | null }
  memoryBytes: number
  os: { prettyName: string; kernel: string; clkTck: number }
  cgroup: { path: string; cpuMax: string }
  docker: { version: string; os: string; storageDriver: string; cgroupDriver: string; ncpu: number; memTotalBytes: number }
  /** Each database container's limits as Docker holds them: 0 is none. */
  databaseLimits: Record<EngineKey, { nanoCpus: number; cpuQuota: number; cpuPeriod: number; memoryBytes: number }>
  node: string
  quiet: {
    enforced: boolean
    /** Containers running before the run started anything: must be none to publish. */
    containersBefore: string[]
    loadAverage: number
    busyVcpusMax: number
    /** Whether the hypervisor reported any steal since boot. */
    stealReported: boolean
    calibrationBaselineMs: number
    seconds: number
  }
}

export interface Network {
  client: { transport: string; address: string; tls: false; proxy: Record<string, string | null> }
  engines: Record<EngineKey, { host: string; lookup: string[]; port: number; dockerProxy: boolean; tls: false }>
  hopDelayMs: number
}

export interface ServerFacts {
  entry: string
  node: string
  /** The settings it was started with, by name: never a value, so no secret. */
  settings: string[]
  rateLimit: number
  logger: boolean
  auditKeyed: boolean
  account: Record<EngineKey, string>
  logLinesPerRequest: number
}

export interface ProductDescription {
  files: Record<string, string>
  packages: Record<string, string>
  build: Record<string, string>
}

export interface RequestTally {
  operation: string
  form: string
  status: number
  count: number
}

export interface Checks {
  requests: RequestTally[]
  runtimeEvents: RequestTally[]
  adminRequests: number
  adminEvents: number
  /** Answers that were not what the scenario expected; a run stops at the first, so 0 in any result. */
  unexpected: number
  /** Server log lines at level 50 or above. */
  errorLines: number
  /** Creates and updates sent, for the write-id cache (0031). */
  writes: number
  /**
   * Distinct customers the run's orders reference, counted by the owner at the
   * end: creates rotate through them, because one referenced customer would
   * measure a PostgreSQL row lock -- the foreign-key check's FOR KEY SHARE --
   * rather than the product.
   */
  createdCustomers: Record<EngineKey, number>
}

export interface Results {
  format: 1
  measuredAt: string
  finishedAt: string
  durationSeconds: number
  protocol: Protocol
  commit: string
  catalogue: Catalogue
  product: ProductDescription
  machine: Machine
  network: Network
  server: ServerFacts
  engines: Record<EngineKey, EngineFacts>
  bundle: Record<string, BundleFacts>
  sizedTable: { generator: string; rows: number; perTenant: Record<string, number>; digest: string; loadSeconds: Record<EngineKey, number> }
  containers: ContainerFacts[]
  components: { verifyToken: ComponentResult; readBundle: Record<EngineKey, ComponentResult & { form: string }>; floor: Record<EngineKey, FloorResult> }
  scenarios: ScenarioResult[]
  latency: LatencyResult[]
  refusals: RefusalResult[]
  checks: Checks
}

/** The (engine, scenario, in flight) blocks a catalogue and protocol call for, in catalogue order. */
export function expectedBlocks(catalogue: Catalogue, protocol: Protocol): Array<{ engine: EngineKey; scenario: CatalogueScenario; concurrency: number }> {
  const blocks: Array<{ engine: EngineKey; scenario: CatalogueScenario; concurrency: number }> = []
  for (const engine of ENGINE_KEYS) {
    for (const scenario of catalogue.scenarios) {
      for (const concurrency of scenario.inFlight === 'all' ? protocol.concurrency : [1]) blocks.push({ engine, scenario, concurrency })
    }
  }
  return blocks
}
