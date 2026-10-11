import type { Measured } from './aggregate.js'
import type { ProductDescription, Protocol } from './results.js'
import type { BlockResult } from './sampler.js'

/*
 * Whether the machine may be measured, decided from what the harness
 * gathered (0034): the preconditions before anything starts, the quiet
 * check before the rounds, the container set at every block boundary, and
 * the calibration verdict after each block. Pure, so each refusal is tested
 * without a machine to refuse.
 */

/** A sentence the run stops with, before or during the measurement, rather than publishing what it could not vouch for. */
export class Refusal extends Error {}

export interface RunningContainer {
  id: string
  name: string
  image: string
}

export interface PreconditionInputs {
  platform: string
  /** Every running container, before the run starts any. */
  containers: RunningContainer[]
  /** Product files, by repository path, that git does not report clean. */
  dirtyFiles: string[]
  env: Readonly<Record<string, string | undefined>>
  /** The database images the suites name that are not present locally. */
  missingImages: string[]
  tolerance: Protocol['calibration']['tolerance']
}

const describeContainer = (container: RunningContainer): string => `${container.name} (${container.image}, ${container.id})`

/** The proxy variables Node's fetch honours, and NODE_USE_ENV_PROXY, which turns that on. */
const PROXY_VARIABLES = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NODE_USE_ENV_PROXY'] as const

/** Every reason the run may not start, each a sentence; none when it may. */
export function preconditions(inputs: PreconditionInputs): string[] {
  const problems: string[] = []
  if (inputs.platform !== 'linux') problems.push(`The measurement reads /proc, so it runs on Linux; this is ${inputs.platform}.`)
  if (inputs.containers.length > 0) problems.push(`Stop every container first; running: ${inputs.containers.map(describeContainer).join(', ')}.`)
  if (inputs.dirtyFiles.length > 0) problems.push(`Commit or revert what the measurement runs first; changed: ${inputs.dirtyFiles.join(', ')}.`)
  const proxies = PROXY_VARIABLES.filter((name) => (inputs.env[name] ?? '') !== '')
  if (proxies.length > 0) {
    const listed = (inputs.env['NO_PROXY'] ?? inputs.env['no_proxy'] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
    if (!listed.includes('127.0.0.1') || !listed.includes('localhost')) {
      problems.push(`A proxy is set (${proxies.join(', ')}), so NO_PROXY must list both 127.0.0.1 and localhost; it lists ${listed.length === 0 ? 'nothing' : listed.join(', ')}.`)
    }
  }
  for (const image of inputs.missingImages) problems.push(`Pull ${image} before the run; it is not on this machine, and a pull must not happen inside it.`)
  if (inputs.tolerance === null) problems.push('The publish protocol has no calibration tolerance: measure P13 and write it into protocol.ts first.')
  return problems
}

/**
 * The repository files whose content the product digest records, which git
 * must report clean before a run: every source file, and every build input
 * recorded by its content's SHA-256 -- the configurations -- rather than by a
 * version, as the tools are.
 */
export function measuredPaths(product: ProductDescription): string[] {
  const digested = Object.entries(product.build).filter(([, value]) => /^[0-9a-f]{64}$/.test(value))
  return [...Object.keys(product.files), ...digested.map(([path]) => path)]
}

/** One second of the quiet check: the 1-minute load average then, and how many vCPUs' worth was busy in it. */
export interface QuietSample {
  loadAverage: number
  busyVcpus: number
}

/** Quiet when the load average stayed below the rule's and no second had more than its vCPUs busy. */
export function quietVerdict(samples: readonly QuietSample[], rule: Protocol['quiet']): { quiet: true } | { quiet: false; reason: string } {
  if (samples.length === 0) return { quiet: false, reason: 'no seconds were sampled' }
  const load = Math.max(...samples.map((sample) => sample.loadAverage))
  if (load >= rule.loadAverageBelow) return { quiet: false, reason: `the 1-minute load average reached ${String(load)}, at least ${String(rule.loadAverageBelow)}` }
  const busy = Math.max(...samples.map((sample) => sample.busyVcpus))
  if (busy > rule.busyVcpusAtMost) return { quiet: false, reason: `one second had ${String(busy)} vCPUs busy, more than ${String(rule.busyVcpusAtMost)}` }
  return { quiet: true }
}

/** What changed in the running containers since setup recorded them, as a sentence; undefined when nothing did. */
export function containerSetChange(recorded: readonly RunningContainer[], now: readonly RunningContainer[]): string | undefined {
  const before = new Set(recorded.map((container) => container.id))
  const after = new Set(now.map((container) => container.id))
  const started = now.filter((container) => !before.has(container.id))
  if (started.length > 0) return `a container started during the run: ${started.map(describeContainer).join(', ')}`
  const stopped = recorded.filter((container) => !after.has(container.id))
  if (stopped.length > 0) return `a container stopped during the run: ${stopped.map(describeContainer).join(', ')}`
  return undefined
}

/** After a block: within tolerance passes; past it, the first attempt repeats and the second refuses the run. */
export function calibrationVerdict(ratio: number, tolerance: Protocol['calibration']['tolerance'], attempt: 1 | 2): 'pass' | 'repeat' | 'refuse' {
  if (tolerance === null) throw new Error('a calibration verdict needs a tolerance')
  if (tolerance === 'unbounded' || ratio <= tolerance) return 'pass'
  return attempt === 1 ? 'repeat' : 'refuse'
}

/**
 * How much slower than the quiet baseline the probe ran in the worse of a
 * block's two idle gaps. Each gap is judged alone: contention there before a
 * block and gone after it, or come during it and stayed, shows in one.
 */
export function gapRatio(idle: BlockResult['counters']['idle'], baselineMs: number): number {
  return Math.max(idle.probeBeforeMs, idle.probeAfterMs) / baselineMs
}

/**
 * A block, judged by the calibration probe in the idle gaps around it
 * against the quiet baseline -- never under the block's own load, which
 * slows the probe too: within the tolerance it is kept; past it, it runs
 * once more and the second attempt is kept, marked repeated; a second miss
 * refuses the run.
 */
export async function judged(name: string, block: () => Promise<BlockResult>, baselineMs: number, tolerance: Protocol['calibration']['tolerance']): Promise<Measured> {
  const first = await block()
  if (calibrationVerdict(gapRatio(first.counters.idle, baselineMs), tolerance, 1) === 'pass') return { block: first }
  const second = await block()
  if (calibrationVerdict(gapRatio(second.counters.idle, baselineMs), tolerance, 2) === 'refuse') {
    throw new Refusal(`The run stopped: ${name}: the probe ran slower than the quiet baseline by more than the tolerance in the idle gaps around it, twice; something else is using the machine.`)
  }
  return { block: second, repeated: true }
}
