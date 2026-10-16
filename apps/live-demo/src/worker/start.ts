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

/**
 * Whether the server answers `probe` -- its /health, asked with what is
 * left of the deadline -- before START_DEADLINE_MS has passed, asking every
 * POLL_MS. A probe that throws has not answered yet: the container refuses
 * a connection until the server listens. False as soon as the container
 * stops, and at the deadline.
 */
export async function waitUntilHealthy(probe: (remainingMs: number) => Promise<boolean>, options: WaitOptions): Promise<boolean> {
  const { alive, deadlineMs = START_DEADLINE_MS, pollMs = POLL_MS, now = Date.now, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options
  const started = now()
  for (;;) {
    const remaining = deadlineMs - (now() - started)
    if (remaining <= 0 || !alive()) return false
    try {
      if (await probe(remaining)) return true
    } catch {
      // Not listening yet.
    }
    await sleep(pollMs)
  }
}
