import { connectDocker } from '@formancy/data-fixtures'
import { calibrationSpread, startCalibration } from './calibration.js'
import { PUBLISH_PROTOCOL } from './protocol.js'
import { preconditions } from './quiet.js'

/*
 * P13 (0034): `pnpm --filter @formancy/data-performance run calibrate`, on
 * the quiet machine, before the first publish run. Runs the calibration
 * probe for ten minutes, or the seconds given, at the publish protocol's
 * interval, and prints the statistic the run judges at its worst: the
 * slowest idle gap's median, a gap as long as the protocol's, against the
 * fastest baseline window's, a window as long as the quiet check's. The
 * tolerance written into `protocol.ts`, with this output beside it, must
 * clear it, or the publish run repeats and refuses blocks nobody disturbed.
 * Refuses while any container runs, as the publish run does.
 */
const seconds = Number(process.argv[2] ?? 600)
if (!Number.isInteger(seconds) || seconds < 10) {
  console.error('calibrate takes the seconds to sample, at least 10; 600 when none is given')
  process.exit(2)
}

const docker = await connectDocker()
const problems = preconditions({ platform: process.platform, containers: await docker.running(), dirtyFiles: [], env: process.env, missingImages: [], tolerance: 'unbounded' })
if (problems.length > 0) {
  console.error(`The calibration did not start:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

const { intervalMs, gapMs } = PUBLISH_PROTOCOL.calibration
const calibration = await startCalibration(intervalMs)
const started = new Date().toISOString()
await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
await calibration.stop()
const windows = { baselineMs: PUBLISH_PROTOCOL.quiet.windowSeconds * 1000, gapMs }
console.log(JSON.stringify({ started, finished: new Date().toISOString(), intervalMs, ...calibrationSpread(calibration.probes(), windows) }, null, 2))
