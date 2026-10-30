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
  const {
    alive,
    deadlineMs = START_DEADLINE_MS,
    pollMs = POLL_MS,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options
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
export type FailedStart = { step: 'start' | 'inactivity-timeout' | 'other'; error: unknown } | { step: 'health'; wait: HealthWait; restarts?: number }

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
  const again = failure.step === 'health' && (failure.restarts ?? 0) > 0 ? `; ${startedAgain(failure.restarts ?? 0)}` : ''
  const line = `live demo: a start failed: ${what}${last}${again}`
  return key === undefined || key === '' ? line : line.replaceAll(key, '<key>')
}

/**
 * Whether `error`, as `ctx.container.monitor()` rejected, is Cloudflare
 * having no instance to give this start (0087): "There is no container
 * instance that can be provided to this Durable Object, try again later",
 * which Cloudflare's own Container class meets by starting again. Told by
 * its words, which nothing documents but cloudflare/containers#262; any
 * other rejection is a container that failed, which a new start would not
 * mend.
 */
export function noInstance(error: unknown): boolean {
  return error instanceof Error && /no container instance/i.test(error.message)
}

/**
 * What the wait for /health is told when `ctx.container.monitor()` rejected
 * with anything but Cloudflare having no instance: the failed start's line
 * quotes it, and it is all the live log shows of the rejection. An error
 * is said in its own words, its message; any other value as `errorText`
 * says a thrown one.
 */
export function monitorRejected(refused: unknown): string {
  return `monitor() rejected: ${refused instanceof Error ? refused.message : errorText(refused)}`
}

/**
 * The line a start that answered writes (0087): how long it took, which no
 * gate measures on Cloudflare, and how often it was started again; the
 * deadline is to be set from these lines.
 */
export function startedLine(wait: HealthWait, restarts: number): string {
  return `live demo: a start answered after ${String(wait.elapsedMs)} ms, after ${probes(wait.probes)}${restarts > 0 ? `, ${startedAgain(restarts)}` : ''}`
}

/** How often a start was started again for want of an instance. */
function startedAgain(restarts: number): string {
  return `started again ${restarts === 1 ? 'once' : `${String(restarts)} times`} after Cloudflare had no instance`
}

/** A count of probes, in the singular for one. */
function probes(count: number): string {
  return `${String(count)} probe${count === 1 ? '' : 's'}`
}

/**
 * An error as `Name: message`, or a thrown value that is no error as
 * `String` spells it: an error from another realm, which is no `Error`
 * here, by its own `toString`, and a string as itself. A value `String`
 * cannot spell -- an object with no prototype, or whose `toString` throws
 * -- is named by its tag, so saying an error never throws one.
 */
function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  try {
    return String(error)
  } catch {
    return Object.prototype.toString.call(error)
  }
}
