import type { WaitStrategy } from 'testcontainers'

/*
 * What a container that never became ready says about itself (0082).
 *
 * testcontainers stops and removes a container whose wait strategy fails,
 * then rethrows the strategy's own error, which for SQL Server is "Log
 * stream ended and message ... was not received": the log closed, and
 * nothing of why. On CI, where the container is gone with the runner, that
 * sentence was all two failed starts left. So the strategy is wrapped, and
 * before its error leaves, while the container still exists, Docker is
 * asked how it ended -- running or not, its exit code, whether the OOM
 * killer stopped it, when -- and for the last lines it wrote. Of a
 * container Docker no longer knows, the report is Docker's own answer.
 */

/** The container a wait strategy is handed: dockerode's, as testcontainers' interface names it. */
type Waited = Parameters<WaitStrategy['waitUntilReady']>[0]

/** How many of its last log lines a container that never became ready reports. */
const UNREADY_LOG_LINES = 40

/** As much of Docker's inspection of a container as says which it was and how it ended. */
export interface UnreadyInspection {
  Id: string
  Config: { Image: string }
  State: { Status: string; Running: boolean; ExitCode: number; OOMKilled: boolean; Error: string; StartedAt: string; FinishedAt: string }
}

/**
 * The lines of a log Docker answers unfollowed for a container without a
 * terminal, which is a run of frames: an eight-byte header -- the stream,
 * three zero bytes, the payload's length big-endian -- then the payload. A
 * frame is a write, not a line, so the payloads are joined before the text
 * is split; a frame the buffer ends inside is read as far as it goes.
 */
export function logLines(frames: Buffer): string[] {
  const payloads: Buffer[] = []
  for (let offset = 0; offset + 8 <= frames.length;) {
    const end = offset + 8 + frames.readUInt32BE(offset + 4)
    payloads.push(frames.subarray(offset + 8, end))
    offset = end
  }
  return Buffer.concat(payloads)
    .toString('utf8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '')
}

/** One sentence: which container, how Docker says it ended, and the lines it wrote last. */
export function unreadyReport(inspection: UnreadyInspection, lines: readonly string[]): string {
  const state = inspection.State
  const which = `container ${inspection.Id.slice(0, 12)} of ${inspection.Config.Image}`
  const ended = state.Running
    ? `was still running (${state.Status}), started ${state.StartedAt}`
    : `had stopped (${state.Status}): exit code ${state.ExitCode}, ${state.OOMKilled ? 'killed' : 'not killed'} by the OOM killer, ${state.Error === '' ? '' : `Docker's error "${state.Error}", `}started ${state.StartedAt} and finished ${state.FinishedAt}`
  const tail = lines.length === 0 ? 'It wrote no log.' : `Its last ${lines.length} log lines:\n${lines.join('\n')}`
  return `${which} ${ended}. ${tail}`
}

/**
 * What Docker says of a container that never became ready, or, in Docker's
 * words, why it could not say: a 404 is a container removed while it
 * started, by Ryuk -- which removes a session's containers once every
 * connection to it has closed -- or by anything else that removes them.
 */
async function askDocker(container: Waited): Promise<string> {
  try {
    const [inspection, log] = await Promise.all([container.inspect(), container.logs({ stdout: true, stderr: true, follow: false, tail: UNREADY_LOG_LINES })])
    return unreadyReport(inspection, logLines(log))
  } catch (error) {
    return `Docker could not say how container ${container.id.slice(0, 12)} ended: ${(error as Error).message}`
  }
}

/**
 * `strategy`, and when it fails, its own error with Docker's account of the
 * container after it, asked before testcontainers removes the container.
 * The startup timeout the module sets is passed on to `strategy`, which is
 * the one that waits.
 */
export function reportingUnready(strategy: WaitStrategy): WaitStrategy {
  const reporting: WaitStrategy = {
    async waitUntilReady(container, boundPorts, startTime) {
      try {
        await strategy.waitUntilReady(container, boundPorts, startTime)
      } catch (error) {
        throw new Error(`${(error as Error).message}; ${await askDocker(container)}`, { cause: error })
      }
    },
    withStartupTimeout(startupTimeoutMs) {
      strategy.withStartupTimeout(startupTimeoutMs)
      return reporting
    },
    isStartupTimeoutSet: () => strategy.isStartupTimeoutSet(),
    getStartupTimeout: () => strategy.getStartupTimeout(),
  }
  return reporting
}
