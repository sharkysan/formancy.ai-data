import type { Protocol } from './results.js'

/*
 * How a measurement runs, as code rather than flags (0034): the published
 * figures come from `PUBLISH_PROTOCOL` and nothing else, and a smoke result
 * names its protocol, so it can never validate as a published one.
 *
 * Every value is a choice, with its reason beside it; none is a measurement
 * except the calibration tolerance, which P13 sets before the publish run.
 */

export const PUBLISH_PROTOCOL: Protocol = {
  name: 'publish',
  // Absorbs JIT tiering, opening pool connections -- mssql evicts an idle one
  // after 30 s, postgres.js recycles after 30 to 60 minutes -- and warming
  // the page cache. Whether it was enough shows in the per-round p50s and the
  // reconnect count.
  warmup: { requests: 100, seconds: 5, atLeast: 10 },
  // Up to 3,000 samples over three rounds; the 60 s cap keeps the
  // full-table scenarios from taking the run over; at least 100 so the p90
  // of one round has ten samples at or above it.
  samples: { requests: 1000, seconds: 60, atLeast: 100 },
  percentiles: [50, 90, 99],
  // Engine order alternates by round, so drift favours neither engine.
  rounds: 3,
  // 8 is below both drivers' default pool of 10, so no request waits for a
  // connection; pool saturation is not measured, and the page says so.
  concurrency: [1, 8],
  // D: several times the loopback floor and Node's 1 ms timer granularity,
  // so the difference measured is the delay's and not noise. It stands for
  // no particular network. 200 samples per pass; P14 checks that is enough.
  latency: { delayMs: 5, warmup: { requests: 100, seconds: 5, atLeast: 10 }, samples: 200 },
  components: { warmup: 200, samples: 2000 },
  // The probe slows under the run's own load as well as under someone
  // else's (0034 has what was measured, and when), so it judges a block only
  // in idle gaps, nothing in flight, before the warm-up and after the timed
  // window. A gap is four intervals, so its median rests on several probes
  // rather than one; the gaps also read the database's idle CPU.
  // The tolerance is P13's: how far a gap's median strayed from a baseline
  // window's over ten idle minutes on the quiet machine,
  // `pnpm --filter @formancy/data-performance run calibrate`. Until it is
  // measured and written here with that output beside it, a publish run
  // refuses to start.
  calibration: { intervalMs: 500, gapMs: 2000, tolerance: null },
  // One rationale, a choice: nothing else holds a whole CPU.
  quiet: { enforced: true, loadAverageBelow: 1, busyVcpusAtMost: 1, windowSeconds: 10, giveUpSeconds: 180 },
  // Longer than a round; a round that outlived it ends with a 401 naming the scenario.
  tokenSeconds: 2 * 60 * 60,
}

/**
 * The harness test's protocol: every scenario, both engines, the counting
 * pass, every content check and the audit reconciliation, with too few
 * samples to mean anything and on a machine nobody quieted. It proves the
 * harness runs, never a figure.
 */
export const SMOKE_PROTOCOL: Protocol = {
  name: 'smoke',
  warmup: { requests: 2, seconds: 5, atLeast: 2 },
  samples: { requests: 5, seconds: 30, atLeast: 5 },
  percentiles: [50, 90, 99],
  rounds: 1,
  concurrency: [1, 2],
  latency: { delayMs: 5, warmup: { requests: 2, seconds: 5, atLeast: 2 }, samples: 5 },
  components: { warmup: 2, samples: 5 },
  // Short, so the gaps around a hundred blocks cost seconds, not minutes.
  calibration: { intervalMs: 50, gapMs: 200, tolerance: 'unbounded' },
  quiet: { enforced: false, loadAverageBelow: 1, busyVcpusAtMost: 1, windowSeconds: 2, giveUpSeconds: 2 },
  tokenSeconds: 60 * 60,
}
