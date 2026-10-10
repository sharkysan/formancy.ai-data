import { Worker } from 'node:worker_threads'

/*
 * The calibration probe (0034): a fixed CPU-bound workload, timed on a
 * worker thread every interval for the whole run. The hypervisor reports no
 * steal, so nothing else in the VM can see the host taking CPU away; a probe
 * that ran slower than the quiet baseline ran on a slower machine.
 *
 * It slows under the run's own load as well -- the vCPUs are hyperthreads
 * whose siblings the guest cannot see, and the clock drops as more cores
 * work -- so it cannot tell a block's own load from someone else's. The run
 * reads it only in idle gaps around each block, with nothing in flight, and
 * contention during a block's own load goes unseen; the page says so. It
 * sees only the vCPU it ran on.
 *
 * The worker's code is a string, evaluated, so the same probe runs from
 * source under the test and from `dist/` in the measurement, with no file
 * to find beside either.
 */

/** SHA-256 of a fixed 64 KiB buffer, 64 times: a few milliseconds of one CPU, the same work every time. */
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads')
const { createHash } = require('node:crypto')
const buffer = Buffer.alloc(64 * 1024, 7)
function probe() {
  const start = process.hrtime.bigint()
  for (let i = 0; i < 64; i += 1) createHash('sha256').update(buffer).digest()
  parentPort.postMessage({ start, end: process.hrtime.bigint() })
}
probe()
setInterval(probe, workerData.intervalMs)
`

export interface Calibration {
  /** Every probe so far, as `process.hrtime.bigint()` readings. */
  probes(): ReadonlyArray<{ start: bigint; end: bigint }>
  /** The median duration, in ms, of the probes that ran wholly between `from` and `to` (process.hrtime.bigint()), or null if none did. */
  medianBetween(from: bigint, to: bigint): number | null
  stop(): Promise<void>
}

/** The middle value of `values` by nearest rank, or null when there are none. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.trunc((50 * sorted.length + 99) / 100) - 1] as number
}

/** The medians of the whole windows of `ms` the probes fall in, by when each started; the last window, cut short by the end, is not whole. */
function windowMedians(probes: ReadonlyArray<{ start: bigint; end: bigint }>, ms: number): number[] {
  const origin = probes[0]?.start ?? 0n
  const span = Number((probes[probes.length - 1]?.end ?? origin) - origin) / 1e6
  const groups = new Map<number, number[]>()
  for (const probe of probes) {
    const at = Math.floor(Number(probe.start - origin) / 1e6 / ms)
    if ((at + 1) * ms > span) continue
    groups.set(at, [...(groups.get(at) ?? []), Number(probe.end - probe.start) / 1e6])
  }
  return [...groups.values()].map((group) => medianOf(group) as number)
}

/**
 * P13 (0034): over an idle run, the statistic the measurement judges -- a
 * gap's median against the quiet baseline's, a window of the quiet check's
 * length -- at its worst: the slowest gap against the fastest baseline
 * window, because the run's baseline is one such window, whichever it
 * happened to be, and its error is in every ratio. The tolerance must clear
 * this, or the publish run repeats and refuses blocks nobody disturbed.
 */
export function calibrationSpread(
  probes: ReadonlyArray<{ start: bigint; end: bigint }>,
  windows: { baselineMs: number; gapMs: number },
): { probes: number; medianMs: number; baselineMs: number; baselineWindows: number; gapMs: number; gapWindows: number; worstRatio: number } {
  const median = medianOf(probes.map((probe) => Number(probe.end - probe.start) / 1e6))
  if (median === null) throw new Error('no probes ran, so there is no spread to report')
  const baselines = windowMedians(probes, windows.baselineMs)
  const gaps = windowMedians(probes, windows.gapMs)
  for (const [ms, found] of [
    [windows.baselineMs, baselines],
    [windows.gapMs, gaps],
  ] as const) {
    if (found.length === 0) throw new Error(`no whole ${String(ms)} ms window of probes, so there is no spread to report`)
  }
  return {
    probes: probes.length,
    medianMs: median,
    baselineMs: windows.baselineMs,
    baselineWindows: baselines.length,
    gapMs: windows.gapMs,
    gapWindows: gaps.length,
    worstRatio: Math.max(...gaps) / Math.min(...baselines),
  }
}

export async function startCalibration(intervalMs: number): Promise<Calibration> {
  const probes: Array<{ start: bigint; end: bigint }> = []
  const worker = new Worker(WORKER, { eval: true, workerData: { intervalMs } })
  worker.on('message', (message: { start: bigint; end: bigint }) => probes.push(message))
  // The first probe, so a run never starts before the probe does.
  await new Promise<void>((resolve, reject) => {
    worker.once('message', () => resolve())
    worker.once('error', reject)
  })
  return {
    probes: () => probes,
    medianBetween(from, to) {
      return medianOf(probes.filter((probe) => probe.start >= from && probe.end <= to).map((probe) => Number(probe.end - probe.start) / 1e6))
    },
    async stop() {
      await worker.terminate()
    },
  }
}
