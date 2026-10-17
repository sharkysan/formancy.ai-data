import { Wait } from 'testcontainers'
import { describe, expect, test } from 'vitest'
import type { UnreadyInspection } from './unready.js'
import { logLines, reportingUnready, unreadyReport } from './unready.js'

/**
 * How a container that never became ready is reported (0082): the frames of
 * a log Docker answers unfollowed, the sentence Docker's state becomes, and
 * the timeout reaching the strategy that waits. Pure, over bytes laid out as
 * Docker's engine API documents its multiplexed stream and over states
 * shaped as `docker inspect` answers them. That a real container killed or
 * removed while it starts is reported so is unready.integration.test.ts's.
 */

/** One frame of Docker's multiplexed log: the stream (1 stdout, 2 stderr), three zero bytes, the length big-endian, the payload. */
function frame(stream: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const header = Buffer.alloc(8)
  header.writeUInt8(stream, 0)
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

const IMAGE = 'mcr.microsoft.com/mssql/server:2025-latest'
const STATE: UnreadyInspection['State'] = {
  Status: 'exited',
  Running: false,
  ExitCode: 137,
  OOMKilled: true,
  Error: '',
  StartedAt: '2026-10-17T10:29:44.1Z',
  FinishedAt: '2026-10-17T10:29:51.9Z',
}

/** As Docker's inspect answers, as much of it as the report reads. */
const inspected = (state: Partial<UnreadyInspection['State']> = {}): UnreadyInspection => ({ Id: '5f3805f3f3b4c0ffee', Config: { Image: IMAGE }, State: { ...STATE, ...state } })

describe('logLines', () => {
  // The header is eight bytes the reader must skip: read as text, each line
  // would start with a stream byte and a length, and a payload length taken
  // little-endian would swallow every frame after the first.
  test('reads the payloads of both streams in the order they were written, one line each', () => {
    const log = Buffer.concat([frame(1, 'SQL Server 2025 will run as non-root by default.\n'), frame(2, 'sqlservr: This program requires a machine with at least 2000 megabytes of memory.\n'), frame(1, 'done\n')])
    expect(logLines(log)).toEqual(['SQL Server 2025 will run as non-root by default.', 'sqlservr: This program requires a machine with at least 2000 megabytes of memory.', 'done'])
  })

  // Docker frames a write, not a line: a line the server wrote in two
  // writes arrives in two frames, and cut at the frame it would read as two
  // lines, the second without its start.
  test('joins a line written in two frames, and drops the empty lines and the carriage returns', () => {
    const log = Buffer.concat([frame(1, '2026-10-17 10:29:50.11 Server      Setup step is copy'), frame(1, "ing system data file 'master.mdf'.\r\n\n"), frame(1, 'last')])
    expect(logLines(log)).toEqual(["2026-10-17 10:29:50.11 Server      Setup step is copying system data file 'master.mdf'.", 'last'])
  })

  // A log cut mid-frame -- the container killed while it wrote -- would
  // otherwise read past the buffer or throw where the report is made.
  test('reads what there is of a frame the buffer ends inside', () => {
    const whole = frame(1, 'complete line\n')
    const cut = frame(2, 'cut off here').subarray(0, 8 + 3)
    expect(logLines(Buffer.concat([whole, cut]))).toEqual(['complete line', 'cut'])
  })

  test('reads an empty log as no lines', () => {
    expect(logLines(Buffer.alloc(0))).toEqual([])
  })
})

describe('unreadyReport', () => {
  // The facts that tell an OOM kill from a crash from a stop: which
  // container of which image, whether it ran, how it exited, whether the
  // OOM killer stopped it, and when. A report that said "stopped" and
  // nothing else would leave the next CI occurrence as silent as the last.
  test('says how a stopped container ended, and quotes its last lines', () => {
    expect(unreadyReport(inspected(), ['first', 'last'])).toBe(
      `container 5f3805f3f3b4 of ${IMAGE} had stopped (exited): exit code 137, killed by the OOM killer, started 2026-10-17T10:29:44.1Z and finished 2026-10-17T10:29:51.9Z. Its last 2 log lines:\nfirst\nlast`,
    )
  })

  // Docker's own error is what it says when the runtime, not the process,
  // failed: a reader needs it verbatim. And a kill that was no OOM kill is
  // said to be none, so 137 alone is never read as memory.
  test("names Docker's error, and an exit the OOM killer did not cause", () => {
    expect(unreadyReport(inspected({ ExitCode: 1, OOMKilled: false, Error: 'cgroup: no such file' }), [])).toBe(
      `container 5f3805f3f3b4 of ${IMAGE} had stopped (exited): exit code 1, not killed by the OOM killer, Docker's error "cgroup: no such file", started 2026-10-17T10:29:44.1Z and finished 2026-10-17T10:29:51.9Z. It wrote no log.`,
    )
  })

  // A log stream that ended while the container ran is not the container
  // stopping, and a timeout leaves it running too: said as such, never as
  // an exit code 0 nobody exited with.
  test('says a container that is still running is still running', () => {
    expect(unreadyReport(inspected({ Status: 'running', Running: true, ExitCode: 0, OOMKilled: false, FinishedAt: '0001-01-01T00:00:00Z' }), ['only'])).toBe(
      `container 5f3805f3f3b4 of ${IMAGE} was still running (running), started 2026-10-17T10:29:44.1Z. Its last 1 log lines:\nonly`,
    )
  })
})

describe('reportingUnready', () => {
  // The module sets SQL Server's startup timeout, 120 s, on the strategy it
  // is given. Kept by the wrapper and not passed on, the log strategy would
  // wait its own default, 60 s, and a start slower than that would fail.
  test('passes the startup timeout to the strategy it reports for', () => {
    const inner = Wait.forLogMessage(/ready/, 1)
    const reporting = reportingUnready(inner)
    expect(reporting.isStartupTimeoutSet()).toBe(false)
    expect(reporting.withStartupTimeout(120_000)).toBe(reporting)
    expect({ inner: inner.getStartupTimeout(), set: inner.isStartupTimeoutSet(), reporting: reporting.getStartupTimeout() }).toEqual({ inner: 120_000, set: true, reporting: 120_000 })
  })
})
