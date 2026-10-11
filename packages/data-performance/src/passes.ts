import { connectPostgres } from '@formancy/data-postgres'
import { createFileConfigurationStore, createIdentityVerifier, validateBundle } from '@formancy/data-server'
import { connectSqlServer } from '@formancy/data-sqlserver'
import type { TcpHop } from '@formancy/data-fixtures'
import type { Catalogue, ComponentResult, EngineKey, FloorResult, Protocol } from './results.js'
import { ENGINE_KEYS, ENGINE_NAMES } from './results.js'
import type { RefusalExecutable } from './drifted.js'
import type { Executable } from './scenarios.js'
import type { WriterEndpoint } from './stack.js'
import { AUDIENCE, ISSUER } from './stack.js'
import { summarise } from './stats.js'

/*
 * The passes that are not rounds (0034): the counting pass, which holds
 * every scenario's and every refusal's database round trips to the
 * catalogue's pins through the hop, and the fixed costs measured in-process
 * -- token verification, the store read and check `loadPublished` does, and
 * the database floor.
 */

/** The adapters' statement shape with nothing behind it: one parameterised select as the writer, through the adapter package's own connection. */
export interface Floor {
  send(): Promise<unknown>
  check(answer: unknown): void
  close(): Promise<void>
}

/**
 * Through `connectPostgres` and `connectSqlServer`, so the floor runs on the
 * adapters' own driver copies and settings (0025): postgres.js unprepared
 * with a parameter, as `sql.unsafe` sends every adapter statement; mssql's
 * pool with its connection check, one parameter whose type the pool's own
 * copy infers from the value.
 */
export async function openFloor(engine: EngineKey, endpoint: WriterEndpoint): Promise<Floor> {
  if (engine === 'pg') {
    const sql = connectPostgres({ ...endpoint, tls: { enabled: false, rejectUnauthorized: false } })
    return {
      send: () => sql.unsafe('select $1::pg_catalog.int4 as v', ['1']),
      check(answer) {
        if ((answer as Array<{ v: number }>)[0]?.v !== 1) throw new Error('the PostgreSQL floor did not answer 1')
      },
      close: () => sql.end({ timeout: 5 }),
    }
  }
  const pool = await connectSqlServer({ ...endpoint, encrypt: false, trustServerCertificate: true })
  return {
    send: () => pool.request().input('v', '1').query('select @v as v'),
    check(answer) {
      if ((answer as { recordset: Array<{ v: string }> }).recordset[0]?.v !== '1') throw new Error('the SQL Server floor did not answer 1')
    },
    close: () => pool.close(),
  }
}

/** Each scenario's, each refusal's and the floor's round trips, per engine, counted through the hop; a refusal with what answered it. */
export type Counted = Record<EngineKey, { scenarios: Record<string, number>; refusals: Record<string, { roundTrips: number; status: number; code: string }>; floor: number }>

/**
 * One warm-up request, then one counted: the hop counts turns, the client
 * speaking again after it heard the server, on every connection. Anything
 * other than the catalogue's pin refuses the run, naming each difference.
 */
export async function countingPass(
  catalogue: Catalogue,
  through: (engine: EngineKey) => Map<string, Executable>,
  refused: (engine: EngineKey) => Map<string, RefusalExecutable>,
  hops: Record<EngineKey, TcpHop>,
  floorThroughHop: (engine: EngineKey) => Promise<Floor>,
): Promise<Counted> {
  const counted = {} as Counted
  const problems: string[] = []
  for (const engine of ENGINE_KEYS) {
    const scenarios = through(engine)
    counted[engine] = { scenarios: {}, refusals: {}, floor: 0 }
    for (const entry of catalogue.scenarios) {
      const scenario = scenarios.get(entry.name)
      if (scenario === undefined) throw new Error(`no executable for ${entry.name}`)
      scenario.check(await scenario.send(0), 0)
      const turns = hops[engine].countRoundTrips()
      const answer = await scenario.send(0)
      const n = turns()
      scenario.check(answer, 0)
      counted[engine].scenarios[entry.name] = n
      if (n !== entry.roundTrips[engine]) problems.push(`${ENGINE_NAMES[engine]} ${entry.name}: counted ${String(n)} round trips, the catalogue pins ${String(entry.roundTrips[engine])}`)
    }
    // A refusal answers as the catalogue says or the run stops, and is counted like a scenario.
    const refusals = refused(engine)
    for (const entry of catalogue.refusals) {
      const refusal = refusals.get(entry.name)
      if (refusal === undefined) throw new Error(`no request for the refusal ${entry.name}`)
      refusal.check(await refusal.send())
      const turns = hops[engine].countRoundTrips()
      const answer = await refusal.send()
      const n = turns()
      counted[engine].refusals[entry.name] = { roundTrips: n, ...refusal.check(answer) }
      if (n !== entry.roundTrips[engine]) problems.push(`${ENGINE_NAMES[engine]} ${entry.name}: counted ${String(n)} round trips, the catalogue pins ${String(entry.roundTrips[engine])}`)
    }
    const floor = await floorThroughHop(engine)
    try {
      floor.check(await floor.send())
      const turns = hops[engine].countRoundTrips()
      const answer = await floor.send()
      counted[engine].floor = turns()
      floor.check(answer)
    } finally {
      await floor.close()
    }
    if (counted[engine].floor !== catalogue.floor.roundTrips[engine]) problems.push(`${ENGINE_NAMES[engine]} floor: counted ${String(counted[engine].floor)} round trips, the catalogue pins ${String(catalogue.floor.roundTrips[engine])}`)
  }
  if (problems.length > 0) throw new Error(`The round trips differ from catalogue.ts; explain the change and update the pins:\n  ${problems.join('\n  ')}`)
  return counted
}

/** `samples` timings of `call`, after `warmup` untimed ones, in ms. */
async function time(budget: Protocol['components'], call: () => Promise<void>): Promise<number[]> {
  for (let i = 0; i < budget.warmup; i += 1) await call()
  const samples: number[] = []
  for (let i = 0; i < budget.samples; i += 1) {
    const started = process.hrtime.bigint()
    await call()
    samples.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  return samples
}

export interface ComponentInputs {
  protocol: Protocol
  secret: string
  token: string
  storeDir: string
  /** The form each engine's store read uses: `<engine>-order`. */
  forms: Record<EngineKey, string>
  writers: Record<EngineKey, WriterEndpoint>
  floorRoundTrips: Record<EngineKey, number>
}

/** The fixed costs, in this process: what the server pays per request before and beside the database. */
export async function components(inputs: ComponentInputs): Promise<{ verifyToken: ComponentResult; readBundle: Record<EngineKey, ComponentResult & { form: string }>; floor: Record<EngineKey, FloorResult> }> {
  const { protocol } = inputs
  const verify = await createIdentityVerifier({ key: { kind: 'secret', secret: inputs.secret }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: 'tid' } })
  const verifyToken = {
    label: 'Verify a host token',
    ...summarise(
      await time(protocol.components, async () => {
        if (!(await verify(inputs.token)).ok) throw new Error('the round token did not verify')
      }),
    ),
  }
  // What `loadPublished` does on every request (0019): the newest version, read, parsed and checked.
  const store = createFileConfigurationStore(inputs.storeDir)
  const readBundle = {} as Record<EngineKey, ComponentResult & { form: string }>
  const floor = {} as Record<EngineKey, FloorResult>
  for (const engine of ENGINE_KEYS) {
    const form = inputs.forms[engine]
    const samples = await time(protocol.components, async () => {
      const version = await store.latest(form)
      if (version === null || !validateBundle(await store.read(form, version)).ok) throw new Error(`${form} did not read back valid`)
    })
    readBundle[engine] = { label: 'Read and check the published version', form, ...summarise(samples) }
    const open = await openFloor(engine, inputs.writers[engine])
    try {
      const summary = summarise(
        await time(protocol.components, async () => {
          open.check(await open.send())
        }),
      )
      const roundTrips = inputs.floorRoundTrips[engine]
      floor[engine] = { ...summary, roundTrips, perRoundTripMs: summary.p50 === null || roundTrips === 0 ? null : summary.p50 / roundTrips }
    } finally {
      await open.close()
    }
  }
  return { verifyToken, readBundle, floor }
}
