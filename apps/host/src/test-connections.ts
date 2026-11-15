/**
 * Every connection a test file opens is closed by the file's end, or the
 * file fails, naming the test that opened it.
 *
 * The suite's files open the databases through the real drivers -- the
 * server's pools, the plane's own owners -- and close them in their
 * `afterAll`. A connection that outlives its file is seen nowhere else: on
 * CI run 43421963967 every test passed, and the run failed afterwards on an
 * unhandled `ReferenceError: process is not defined` from tedious, a SQL
 * Server connection whose connect failed after Vitest had torn the file's
 * environment down, with no file or test named. Here each client socket a
 * file opens is noted with the test that was running when it opened, from
 * Node's `net.client.socket` diagnostics channel, so no driver is patched;
 * and after the file's own `afterAll` -- Vitest runs after-hooks in the
 * reverse of their order, and a setup file's are registered first -- every
 * one must have closed.
 *
 * What it does not see: a connection opened after the check, by a request
 * the file left still being answered when it closed its server. Waiting
 * for those before closing is each file's part, as the plane's
 * (test-plane.ts) and the temporal page's are.
 *
 * The second of its two whole runs here, on 2026-11-15, failed the temporal
 * page's file: a SQL Server connection opened during its last case was
 * still open two seconds after its `afterAll`. What left it open was not
 * reproduced; the file now waits for its requests before it closes, and
 * its `pressSave` for the save's own answer, which it had not.
 *
 * A socket a pool closes is destroyed at once or soon after its last
 * packet, so the check waits for that before it fails a file. Measured in
 * that run: 929 sockets in the 87 files that passed, each destroyed within
 * 6 ms of its file's `afterAll`, and 55 of those files with none open by
 * then. `SETTLE_MS` is far past that, so a slower runner does not fail a
 * file for a socket it closed, and a file that leaks waits two seconds
 * more to be told.
 */
import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import type { Socket } from 'node:net'
import { afterAll, expect } from 'vitest'

/** How long a socket a file closed may take to be destroyed. */
const SETTLE_MS = 2_000

interface Opened {
  socket: Socket
  /** The test running when it opened, or the hook's place when none was. */
  during: string
  /** Where it was connecting, once Node said so. */
  to?: string
}

const opened: Opened[] = []

const noted = (message: unknown): void => {
  const { socket } = message as { socket: Socket }
  const entry: Opened = { socket, during: expect.getState().currentTestName ?? 'a hook, before or after every test' }
  socket.once('connectionAttempt', (ip: string, port: number) => {
    entry.to = `${ip}:${String(port)}`
  })
  opened.push(entry)
}

subscribe('net.client.socket', noted)

afterAll(async () => {
  unsubscribe('net.client.socket', noted)
  const open = (): Opened[] => opened.filter(({ socket }) => !socket.destroyed)
  const deadline = Date.now() + SETTLE_MS
  while (open().length > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  const left = open()
  if (left.length === 0) return
  const said = left.map(
    ({ socket, during, to }) => `${socket.connecting ? 'still connecting' : 'open'}${to === undefined ? '' : ` to ${to}`}, opened during "${during}"`,
  )
  throw new Error(`${String(left.length)} connection(s) this file opened outlived it: ${said.join('; ')}`)
})
