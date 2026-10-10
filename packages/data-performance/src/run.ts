import { appendFileSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { createDataClient } from '@formancy/data-client'
import type { FormRecord } from '@formancy/data-core'
import { connectDocker, POSTGRES_IMAGE, SIZED_CUSTOMERS, SQLSERVER_IMAGE } from '@formancy/data-fixtures'
import type { DockerReader } from '@formancy/data-fixtures'
import { latencyResult, scenarioResult } from './aggregate.js'
import type { Measured } from './aggregate.js'
import { startCalibration } from './calibration.js'
import type { Calibration } from './calibration.js'
import { CATALOGUE } from './catalogue.js'
import { alterDrifted, publishDrifted, readDrifted, refusalsFor } from './drifted.js'
import type { Observer } from './engine-postgres.js'
import { observePostgres } from './engine-postgres.js'
import { observeSqlServer } from './engine-sqlserver.js'
import { bundleFacts, describeProduct, dirtyFiles, gitCommit, networkFacts, quietCheck } from './facts.js'
import { clockTicks, describeMachine } from './machine.js'
import { components, countingPass, openFloor } from './passes.js'
import { clerkClaims, mintToken, publishForms } from './publish.js'
import { containerSetChange, judged, measuredPaths, preconditions, Refusal } from './quiet.js'
import type { RunningContainer } from './quiet.js'
import type { ContainerFacts, EngineFacts, EngineKey, LatencyResult, Machine, Protocol, RefusalResult, Results, ScenarioResult } from './results.js'
import { ENGINE_KEYS } from './results.js'
import type { BlockContext, BlockResult } from './sampler.js'
import { runBlock } from './sampler.js'
import { expectedAnswers, scenariosFor, slotOf } from './scenarios.js'
import type { Executable, Orders, ScenarioContext } from './scenarios.js'
import { readServerLog, routeOf, tallyKey, tallyRows } from './server-log.js'
import { startStack } from './stack.js'
import type { Stack } from './stack.js'

/*
 * One measurement, start to finish (0034): preconditions, the stack, the
 * quiet check, setup through the administrator's plane, the counting pass,
 * the fixed costs, the rounds and the added-latency block, and the audit
 * reconciliation -- into a results document. `measure.ts` runs it with the
 * publish protocol and writes the document; the harness test runs it with
 * the smoke protocol and checks it.
 */

/** Far above anything the run sends, so the per-address limit never answers 429 inside it; set as an operator sets it. */
export const RATE_LIMIT = 10_000_000

export interface RunOptions {
  /** The repository's root: git, the stale check and paths in the result are relative to it. */
  root: string
  /** Where the store, the connections file, the server's log and the raw samples go. */
  runDir: string
  progress?: (line: string) => void
}

/** The engine's container role, from the fixture's container id, for the recorded set. */
function roleOf(container: RunningContainer, stack: Stack): string {
  if (stack.pg.containerId.startsWith(container.id)) return 'pg'
  if (stack.ms.containerId.startsWith(container.id)) return 'ms'
  return container.image.includes('ryuk') ? 'reaper' : 'other'
}

export async function runMeasurement(protocol: Protocol, options: RunOptions): Promise<Results> {
  const say = options.progress ?? (() => {})
  const measuredAt = new Date().toISOString()
  const started = process.hrtime.bigint()
  const docker = await connectDocker()
  const product = await describeProduct(options.root)
  const containersBefore = await docker.running()
  const problems = preconditions({
    platform: process.platform,
    containers: containersBefore,
    dirtyFiles: await dirtyFiles(options.root, measuredPaths(product)),
    env: process.env,
    missingImages: (await Promise.all([POSTGRES_IMAGE, SQLSERVER_IMAGE].map(async (image) => ((await docker.hasImage(image)) ? undefined : image)))).filter((image) => image !== undefined),
    tolerance: protocol.calibration.tolerance,
  })
  if (protocol.quiet.enforced && problems.length > 0) throw new Refusal(`The measurement did not start:\n  ${problems.join('\n  ')}`)

  // Computed before anything is timed: a content check compares with these.
  const expected = expectedAnswers()
  const calibration = await startCalibration(protocol.calibration.intervalMs)
  say('starting both databases and loading the sized customers')
  let stack: Stack | undefined
  const observers: Partial<Record<EngineKey, Observer>> = {}
  try {
    stack = await startStack({ runDir: options.runDir, rateLimit: RATE_LIMIT })
    observers.pg = observePostgres(stack.pg.admin)
    observers.ms = await observeSqlServer(stack.ms.admin)
    return await measureOn(protocol, options, { docker, stack, calibration, observers: observers as Record<EngineKey, Observer>, expected, product, measuredAt, started, containersBefore, say })
  } finally {
    await Promise.all(Object.values(observers).map((observer) => observer.close().catch(() => {})))
    await stack?.stop()
    await calibration.stop()
  }
}

interface Setup {
  docker: DockerReader
  stack: Stack
  calibration: Calibration
  observers: Record<EngineKey, Observer>
  expected: ReturnType<typeof expectedAnswers>
  product: Results['product']
  measuredAt: string
  started: bigint
  containersBefore: RunningContainer[]
  say: (line: string) => void
}

async function measureOn(protocol: Protocol, options: RunOptions, setup: Setup): Promise<Results> {
  const { docker, stack, calibration, observers, say } = setup
  const recorded = await docker.running()
  const containers: ContainerFacts[] = []
  const limits = {} as Machine['databaseLimits']
  for (const container of recorded) {
    const { limits: limit, ...described } = await docker.describe(container.id)
    const facts = { role: roleOf(container, stack), ...described }
    containers.push(facts)
    if (facts.role === 'pg' || facts.role === 'ms') limits[facts.role] = limit
  }
  const checkContainers = async (): Promise<void> => {
    if (!protocol.quiet.enforced) return
    const change = containerSetChange(recorded, await docker.running())
    if (change !== undefined) throw new Refusal(`The run stopped: ${change}.`)
  }
  const facts = { pg: await observers.pg.facts(), ms: await observers.ms.facts() }
  const sizesBefore = { pg: await observers.pg.sizes(), ms: await observers.ms.sizes() }

  // Every request to the server, tallied by the route it addressed and the status that answered.
  const tally = new Map<string, number>()
  let adminRequests = 0
  const spied: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const route = routeOf(init?.method ?? 'GET', url.pathname)
    if (route.plane === 'runtime') {
      const key = tallyKey(route.operation, route.form, response.status)
      tally.set(key, (tally.get(key) ?? 0) + 1)
    } else if (route.plane === 'admin') adminRequests += 1
    return response
  }
  const base = stack.server.base
  const adminToken = await mintToken(stack.secret, 'admin-1', { roles: ['data-admin'] }, 600)
  const admin = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const response = await spied(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const parsed = (await response.json()) as Record<string, unknown>
    if (!response.ok) throw new Error(`${path} answered ${String(response.status)}: ${JSON.stringify(parsed)}`)
    return parsed
  }
  let clerk = await mintToken(stack.secret, 'clerk-1', clerkClaims, protocol.tokenSeconds)
  const client = createDataClient({ token: () => clerk, base, fetch: spied })

  say('publishing the eight forms, and the two the refusals use')
  const forms = await publishForms(admin)
  const sources = Object.fromEntries(forms.map((form) => [form.formId, form.source]))
  await publishDrifted(admin)
  // Read before the owner changes the table, as a person would have opened the record.
  const drifted = await readDrifted(client)
  await alterDrifted({ pg: stack.pg.admin, ms: stack.ms.admin })

  const lanes = Math.max(...protocol.concurrency)
  const orders = {} as Record<EngineKey, Orders>
  for (const engine of ENGINE_KEYS) {
    const formId = `${engine}-order`
    const created: FormRecord[] = []
    for (let i = 0; i <= lanes; i += 1) {
      const outcome = await client.create(formId, { customer: setup.expected.rotation[50 + i] as string, order_date: '2026-10-09', status: 'placed', amount: '5', notes: 'performance setup' })
      if (!outcome.ok) throw new Error(`setup could not create an order on ${formId}: ${outcome.message}`)
      created.push(outcome.value)
    }
    const first = created[0] as FormRecord
    const read = await client.read(formId, first.record ?? '')
    if (!read.ok) throw new Error(`setup could not read its order on ${formId}: ${read.message}`)
    orders[engine] = { read: read.value, slots: created.slice(1).map(slotOf) }
  }
  const context: ScenarioContext = { client, base, fetch: spied, sources, expected: setup.expected, orders, creates: { pg: 0, ms: 0 } }

  // After setup and before anything is counted or timed.
  say('quiet check')
  const quiet = { ...(await quietCheck(protocol, calibration)), containersBefore: setup.containersBefore.map((container) => `${container.name} (${container.image})`) }

  say('counting round trips through the hop')
  const counted = await countingPass(
    CATALOGUE,
    (engine) => scenariosFor(engine, 'hop', context),
    (engine) => refusalsFor(engine, CATALOGUE.refusals, client, drifted[engine]),
    stack.hops,
    (engine) => openFloor(engine, { ...stack.writers[engine], host: '127.0.0.1', port: stack.hops[engine].port }),
  )

  say('fixed costs')
  const fixed = await components({
    protocol,
    secret: stack.secret,
    token: clerk,
    storeDir: stack.server.storeDir,
    forms: { pg: 'pg-order', ms: 'ms-order' },
    writers: stack.writers,
    floorRoundTrips: { pg: counted.pg.floor, ms: counted.ms.floor },
  })

  const baseline = quiet.calibrationBaselineMs
  const clkTck = await clockTicks()
  const blockContext = (engine: EngineKey): BlockContext => ({
    serverPid: stack.server.pid,
    clkTck,
    docker,
    containerId: engine === 'pg' ? stack.pg.containerId : stack.ms.containerId,
    observer: observers[engine],
    calibration,
    gapMs: protocol.calibration.gapMs,
    stealReported: quiet.stealReported,
  })
  const calibrated = (name: string, block: () => Promise<BlockResult>): Promise<Measured> => judged(name, block, baseline, protocol.calibration.tolerance)
  const raw = `${options.runDir}/samples.ndjson`
  const keep = (record: Record<string, unknown>, measured: Measured): void => appendFileSync(raw, `${JSON.stringify({ ...record, repeated: measured.repeated === true, samples: measured.block.samples })}\n`)

  const blocks = new Map<string, Measured[]>()
  const passes = new Map<string, Array<{ undelayed: Measured; delayed: Measured }>>()
  const sampleBudget = { requests: protocol.latency.samples, seconds: Number.POSITIVE_INFINITY, atLeast: protocol.latency.samples }
  for (let round = 0; round < protocol.rounds; round += 1) {
    // One token per round, minted outside every timed window.
    clerk = await mintToken(stack.secret, 'clerk-1', clerkClaims, protocol.tokenSeconds)
    for (const engine of round % 2 === 0 ? ENGINE_KEYS : [...ENGINE_KEYS].reverse()) {
      const where = blockContext(engine)
      const direct = scenariosFor(engine, 'direct', context)
      for (const concurrency of protocol.concurrency) {
        for (const entry of CATALOGUE.scenarios) {
          if (concurrency !== 1 && entry.inFlight === 'one') continue
          say(`round ${String(round + 1)}, ${engine}, ${entry.name} at ${String(concurrency)} in flight`)
          const name = `${engine} ${entry.name} at ${String(concurrency)} in flight`
          const measured = await calibrated(name, () => runBlock(direct.get(entry.name) as Executable, concurrency, protocol.warmup, protocol.samples, where))
          keep({ round, engine, scenario: entry.name, concurrency }, measured)
          const key = `${engine}\t${entry.name}\t${String(concurrency)}`
          blocks.set(key, [...(blocks.get(key) ?? []), measured])
          await checkContainers()
        }
      }
      const hop = stack.hops[engine]
      const throughHop = scenariosFor(engine, 'hop', context)
      for (const entry of CATALOGUE.scenarios.filter((scenario) => scenario.latency)) {
        say(`round ${String(round + 1)}, ${engine}, ${entry.name} with added latency`)
        const scenario = throughHop.get(entry.name) as Executable
        hop.delayAnswers(0)
        const undelayed = await calibrated(`${engine} ${entry.name} undelayed`, () => runBlock(scenario, 1, protocol.latency.warmup, sampleBudget, where))
        hop.delayAnswers(protocol.latency.delayMs)
        const delayed = await calibrated(`${engine} ${entry.name} delayed`, () => runBlock(scenario, 1, protocol.latency.warmup, sampleBudget, where))
        hop.delayAnswers(0)
        keep({ round, engine, scenario: entry.name, latency: 'undelayed' }, undelayed)
        keep({ round, engine, scenario: entry.name, latency: 'delayed' }, delayed)
        const key = `${engine}\t${entry.name}`
        passes.set(key, [...(passes.get(key) ?? []), { undelayed, delayed }])
        await checkContainers()
      }
    }
  }

  say('after the rounds')
  const sizesAfter = { pg: await observers.pg.sizes(), ms: await observers.ms.sizes() }
  const memory = { pg: (await docker.usage(stack.pg.containerId)).memoryBytes, ms: (await docker.usage(stack.ms.containerId)).memoryBytes }
  const createdCustomers = { pg: await observers.pg.createdCustomers(), ms: await observers.ms.createdCustomers() }
  // Stopped first, so every line it would write is in the file.
  await stack.stopServer()
  const log = readServerLog(readFileSync(stack.server.logFile, 'utf8'))
  const requests = tallyRows(tally)

  const scenarios: ScenarioResult[] = []
  for (const engine of ENGINE_KEYS) {
    for (const entry of CATALOGUE.scenarios) {
      for (const concurrency of entry.inFlight === 'all' ? protocol.concurrency : [1]) {
        const rounds = blocks.get(`${engine}\t${entry.name}\t${String(concurrency)}`) ?? []
        scenarios.push(scenarioResult(engine, entry.name, concurrency, counted[engine].scenarios[entry.name] as number, rounds, baseline))
      }
    }
  }
  const latency: LatencyResult[] = ENGINE_KEYS.flatMap((engine) =>
    CATALOGUE.scenarios
      .filter((entry) => entry.latency)
      .map((entry) => latencyResult(engine, entry.name, counted[engine].scenarios[entry.name] as number, protocol.latency.delayMs, passes.get(`${engine}\t${entry.name}`) ?? [], baseline)),
  )
  const refusals: RefusalResult[] = ENGINE_KEYS.flatMap((engine) =>
    CATALOGUE.refusals.map((entry) => ({ engine, scenario: entry.name, ...(counted[engine].refusals[entry.name] as { roundTrips: number; status: number; code: string }) })),
  )
  const imageOf = (engine: EngineKey): ContainerFacts => containers.find((container) => container.role === engine) as ContainerFacts
  const engines = {} as Record<EngineKey, EngineFacts>
  for (const engine of ENGINE_KEYS) {
    const image = imageOf(engine)
    engines[engine] = { image: image.image, imageId: image.imageId, repoDigests: image.repoDigests, ...facts[engine], sizes: { before: sizesBefore[engine], after: sizesAfter[engine] }, memoryBytes: memory[engine] }
  }
  if (stack.loads.pg.digest !== stack.loads.ms.digest) throw new Error('the two engines were loaded with different customers')
  const machine = await describeMachine()
  return {
    format: 1,
    measuredAt: setup.measuredAt,
    finishedAt: new Date().toISOString(),
    durationSeconds: Number(process.hrtime.bigint() - setup.started) / 1e9,
    protocol,
    commit: await gitCommit(options.root),
    catalogue: CATALOGUE,
    product: setup.product,
    machine: { ...machine, docker: await docker.facts(), databaseLimits: limits, node: process.version, quiet },
    network: await networkFacts(stack.writers, protocol.latency.delayMs),
    server: {
      entry: relative(options.root, stack.server.entry),
      node: process.version,
      settings: stack.server.settings,
      rateLimit: stack.server.rateLimit,
      logger: true,
      auditKeyed: true,
      account: { pg: stack.writers.pg.user, ms: stack.writers.ms.user },
      logLinesPerRequest: log.runtimeLines.requests === 0 ? 0 : log.runtimeLines.lines / log.runtimeLines.requests,
    },
    engines,
    bundle: { 'pg-order': await bundleFacts(stack.server.storeDir, 'pg-order'), 'ms-order': await bundleFacts(stack.server.storeDir, 'ms-order') },
    sizedTable: {
      generator: SIZED_CUSTOMERS.id,
      rows: stack.loads.pg.rows,
      perTenant: Object.fromEntries(Object.entries(stack.loads.pg.perTenant).map(([tenant, rows]) => [tenant, rows])),
      digest: stack.loads.pg.digest,
      loadSeconds: { pg: stack.loads.pg.seconds, ms: stack.loads.ms.seconds },
    },
    containers,
    components: fixed,
    scenarios,
    latency,
    refusals,
    checks: {
      requests,
      runtimeEvents: log.runtimeEvents,
      adminRequests,
      adminEvents: log.adminEvents,
      unexpected: 0,
      errorLines: log.errorLines,
      writes: requests.filter((row) => row.operation === 'create' || row.operation === 'update').reduce((sum, row) => sum + row.count, 0),
      createdCustomers,
    },
  }
}
