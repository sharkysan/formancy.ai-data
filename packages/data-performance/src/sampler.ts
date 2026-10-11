import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { DockerReader } from '@formancy/data-fixtures'
import type { Calibration } from './calibration.js'
import type { Observer } from './engine-postgres.js'
import { busyBetween, readLoadAverage, readPidTicks, readProcStat } from './machine.js'
import type { Budget } from './results.js'
import type { Executable } from './scenarios.js'

/*
 * One block (0034): a scenario at one in-flight level, warmed up, then
 * sampled closed loop -- each lane sends its next request when its last
 * answer is checked -- with what was going on around it read before and
 * after the timed window and never inside it, and an idle gap, nothing in
 * flight, before the warm-up and after the window.
 *
 * A sample is the time from the client call to its parsed answer
 * (`process.hrtime.bigint()`); the content check runs after the timer.
 * Excluded: the warm-up, the checks, the gaps and the counter reads. Not
 * excluded: GC, the server's logging and audit, the generator's own event
 * loop (its delay is recorded).
 *
 * The gaps are where the calibration probe is read, because under the
 * block's own load it slows too, and where the database's idle CPU is read,
 * because its container works on its own and its CPU over a block carries
 * that.
 */

/** What a block's counters read around the timed window. */
export interface BlockCounters {
  machineBusyPct: number
  /** Percent, or null when the hypervisor reports no steal. */
  stealPct: number | null
  serverCpuMs: number
  databaseCpuMs: number
  generatorLagP99Ms: number
  loadAvgAtStart: number
  idle: IdleGaps
  disturbances: Record<string, number>
  reconnects: number
}

/** The two idle gaps of a block, nothing in flight: the probe's median in each, and the database container's CPU and the seconds over both. */
export interface IdleGaps {
  probeBeforeMs: number
  probeAfterMs: number
  databaseCpuMs: number
  seconds: number
}

export interface BlockResult {
  /** Milliseconds, in completion order. */
  samples: number[]
  /** Wall-clock seconds of the timed window. */
  seconds: number
  rowsAnswered: number
  counters: BlockCounters
}

/** Where a block reads its counters: the server's process, the engine's container and owner, the probe. */
export interface BlockContext {
  serverPid: number
  clkTck: number
  docker: DockerReader
  containerId: string
  observer: Observer
  calibration: Calibration
  /** How long each idle gap lasts. */
  gapMs: number
  stealReported: boolean
}

const elapsedMs = (since: bigint): number => Number(process.hrtime.bigint() - since) / 1e6

/**
 * Sends `scenario` closed loop with `lanes` in flight until the budget ends:
 * its requests, or its seconds once at least `atLeast` were sent.
 */
export async function closedLoop(scenario: Executable, lanes: number, budget: Budget, samples?: number[]): Promise<{ sent: number; rowsAnswered: number }> {
  const started = process.hrtime.bigint()
  let sent = 0
  let rowsAnswered = 0
  // One lane's unexpected answer ends the block for every lane, not just its own.
  let failed = false
  const more = (): boolean => !failed && sent < budget.requests && (sent < budget.atLeast || elapsedMs(started) < budget.seconds * 1000)
  await Promise.all(
    Array.from({ length: lanes }, async (_, lane) => {
      try {
        while (more()) {
          sent += 1
          const before = process.hrtime.bigint()
          const answer = await scenario.send(lane)
          const took = elapsedMs(before)
          rowsAnswered = scenario.check(answer, lane)
          samples?.push(took)
        }
      } catch (error) {
        failed = true
        throw error
      }
    }),
  )
  return { sent, rowsAnswered }
}

/**
 * One idle gap: nothing in flight for `gapMs`, and longer if no whole probe
 * has run in it yet -- the probe's thread was held up -- so the gap is judged
 * by a probe that ran inside it and never by one that ran under the next
 * block's warm-up. The database container's CPU is read across it. A probe
 * that reports nothing for `waitMs` past the gap stops the run.
 */
export async function idleGap(context: Pick<BlockContext, 'docker' | 'containerId' | 'calibration' | 'gapMs'>, waitMs = 10_000): Promise<{ probeMs: number; databaseCpuMs: number; seconds: number }> {
  const from = process.hrtime.bigint()
  const before = (await context.docker.usage(context.containerId)).cpuNs
  await new Promise((resolve) => setTimeout(resolve, context.gapMs))
  const deadline = Date.now() + waitMs
  let probeMs = context.calibration.medianBetween(from, process.hrtime.bigint())
  while (probeMs === null) {
    if (Date.now() > deadline) throw new Error(`the calibration probe has not reported for ${String(waitMs)} ms past an idle gap`)
    await new Promise((resolve) => setTimeout(resolve, 10))
    probeMs = context.calibration.medianBetween(from, process.hrtime.bigint())
  }
  const after = (await context.docker.usage(context.containerId)).cpuNs
  const to = process.hrtime.bigint()
  return { probeMs, databaseCpuMs: (after - before) / 1e6, seconds: Number(to - from) / 1e9 }
}

/** An idle gap, the warm-up, the timed window between two reads of every counter, and another idle gap. */
export async function runBlock(scenario: Executable, lanes: number, warmup: Budget, budget: Budget, context: BlockContext): Promise<BlockResult> {
  const gapBefore = await idleGap(context)
  await closedLoop(scenario, lanes, warmup)

  // The owner's queries first and the CPU counters last, so the observer's
  // own work on the database falls outside the CPU it is charged.
  const disturbanceBefore = await context.observer.disturbance()
  const sessionsBefore = await context.observer.writerSessions()
  const databaseBefore = (await context.docker.usage(context.containerId)).cpuNs
  const serverBefore = await readPidTicks(context.serverPid)
  const statBefore = await readProcStat()
  const load = await readLoadAverage()
  const lag = monitorEventLoopDelay({ resolution: 1 })
  lag.enable()

  const samples: number[] = []
  const started = process.hrtime.bigint()
  const { rowsAnswered } = await closedLoop(scenario, lanes, budget, samples)
  const ended = process.hrtime.bigint()

  lag.disable()
  const statAfter = await readProcStat()
  const serverAfter = await readPidTicks(context.serverPid)
  const databaseAfter = (await context.docker.usage(context.containerId)).cpuNs
  // Before the owner's queries, so their work on the database is in neither the window nor the gap.
  const gapAfter = await idleGap(context)
  const sessionsAfter = await context.observer.writerSessions()
  const disturbanceAfter = await context.observer.disturbance()

  const busy = busyBetween(statBefore, statAfter)
  const serverTicks = serverAfter.utime + serverAfter.stime - (serverBefore.utime + serverBefore.stime)
  return {
    samples,
    seconds: Number(ended - started) / 1e9,
    rowsAnswered,
    counters: {
      machineBusyPct: busy.busyPct,
      stealPct: context.stealReported ? busy.stealPct : null,
      serverCpuMs: (serverTicks / context.clkTck) * 1000,
      databaseCpuMs: (databaseAfter - databaseBefore) / 1e6,
      // An empty histogram -- a block shorter than its resolution -- has no delay to report.
      generatorLagP99Ms: lag.count === 0 ? 0 : lag.percentile(99) / 1e6,
      loadAvgAtStart: load.one,
      idle: { probeBeforeMs: gapBefore.probeMs, probeAfterMs: gapAfter.probeMs, databaseCpuMs: gapBefore.databaseCpuMs + gapAfter.databaseCpuMs, seconds: gapBefore.seconds + gapAfter.seconds },
      disturbances: context.observer.disturbances(disturbanceBefore, disturbanceAfter),
      reconnects: [...sessionsAfter].filter((session) => !sessionsBefore.has(session)).length,
    },
  }
}
