/*
 * What the Durable Object decides a start with (0070): a key made for that
 * start alone, and when the server counts as started. worker.ts does the
 * starting; this is the part of it that can be run without Cloudflare.
 */
import { POLL_MS, START_DEADLINE_MS } from './limits.js'

/**
 * A new identity key: 32 random bytes as base64url, 43 ASCII characters,
 * so 43 UTF-8 bytes, over the 32 the server starts with (KeySet.fromSecret).
 * One per start, so a token from before a restart is refused after it.
 */
export function newKey(): string {
  let binary = ''
  for (const byte of crypto.getRandomValues(new Uint8Array(32))) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * Whether a starting container may still answer, from `running` as
 * `ctx.container.running` reads: until it has been seen running, yes --
 * whether it reads running at once after start() returns is not
 * documented, and a start judged failed before its machine booted would
 * fail every start -- and once it has, only while it still runs. A
 * container that stopped will never answer, and waiting out the deadline
 * for it would keep the visitor for nothing.
 */
export function untilStopped(running: () => boolean): () => boolean {
  let seen = false
  return () => {
    if (running()) seen = true
    return running() || !seen
  }
}

export interface WaitOptions {
  /** Whether the container is still running: once it is not, it will never answer. */
  alive: () => boolean
  deadlineMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** How a wait for /health ended (0086): answered, or why it gave up, after how many probes and how long, and what the last probe that threw said. */
export interface HealthWait {
  healthy: boolean
  ended: 'answered' | 'deadline' | 'stopped'
  probes: number
  elapsedMs: number
  lastError: string | undefined
}

/**
 * Whether the server answers `probe` -- its /health, asked with what is
 * left of the deadline -- before START_DEADLINE_MS has passed, asking every
 * POLL_MS. A probe that throws has not answered yet: the container refuses
 * a connection until the server listens. Not healthy as soon as the
 * container stops, and at the deadline; either way the answer says which,
 * for the line a failed start writes.
 */
export async function waitUntilHealthy(probe: (remainingMs: number) => Promise<boolean>, options: WaitOptions): Promise<HealthWait> {
  const { alive, deadlineMs = START_DEADLINE_MS, pollMs = POLL_MS, now = Date.now, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options
  const started = now()
  let probes = 0
  let lastError: string | undefined
  const ended = (healthy: boolean, how: HealthWait['ended']): HealthWait => ({ healthy, ended: how, probes, elapsedMs: now() - started, lastError })
  for (;;) {
    const remaining = deadlineMs - (now() - started)
    if (remaining <= 0) return ended(false, 'deadline')
    if (!alive()) return ended(false, 'stopped')
    probes += 1
    try {
      if (await probe(remaining)) return ended(true, 'answered')
    } catch (error) {
      // Not listening yet.
      lastError = errorText(error)
    }
    await sleep(pollMs)
  }
}

/** A start that failed, at the step it failed: one that threw, or the wait for /health. */
export type FailedStart = { step: 'start' | 'inactivity-timeout' | 'other'; error: unknown } | { step: 'health'; wait: HealthWait }

/**
 * The line the Durable Object writes when a start fails (0086), which
 * `wrangler tail` shows and nothing keeps: the step and what the platform
 * said, or how the wait for /health ended. Never the key the start was
 * made with, cut out wherever an error quoted it, and nothing a visitor
 * sent.
 */
export function failedStartLine(failure: FailedStart, key: string | undefined): string {
  const what =
    failure.step !== 'health'
      ? `${failure.step} threw ${errorText(failure.error)}`
      : failure.wait.ended === 'stopped'
        ? `the container stopped after ${String(failure.wait.elapsedMs)} ms, before /health answered, after ${probes(failure.wait.probes)}`
        : `/health did not answer within ${String(failure.wait.elapsedMs)} ms, after ${probes(failure.wait.probes)}`
  const last = failure.step === 'health' && failure.wait.lastError !== undefined ? `; the last threw ${failure.wait.lastError}` : ''
  const line = `live demo: a start failed: ${what}${last}`
  return key === undefined || key === '' ? line : line.replaceAll(key, '<key>')
}

/** A count of probes, in the singular for one. */
function probes(count: number): string {
  return `${String(count)} probe${count === 1 ? '' : 's'}`
}

/** An error as `Name: message`, or a thrown value that is no error as itself. */
function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
