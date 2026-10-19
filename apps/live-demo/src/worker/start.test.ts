import { createIdentityVerifier } from '@formancy/data-server'
import { describe, expect, test } from 'vitest'
import { AUDIENCE, ISSUER, MIN_KEY_BYTES, TENANT_CLAIM } from '../token.js'
import { POLL_MS, START_DEADLINE_MS } from './limits.js'
import { failedStartLine, newKey, noInstance, startedLine, untilStopped, waitUntilHealthy } from './start.js'

/**
 * How the Durable Object starts a visitor's server (0070): with a key made
 * for that start alone, and judged started only when the server answers
 * /health within the deadline. The Durable Object itself (worker.ts) is
 * held by review; what it decides with is here.
 */
describe("a start's key", () => {
  // 32 random bytes as base64url: 43 ASCII characters, so 43 UTF-8 bytes,
  // over the 32 the server refuses to start below (KeySet.fromSecret). A
  // key the server refused would be a container that never answers.
  test('is 32 random bytes as base64url, which the server starts with', async () => {
    const keys = Array.from({ length: 50 }, () => newKey())
    for (const key of keys) {
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(new TextEncoder().encode(key).byteLength).toBeGreaterThanOrEqual(MIN_KEY_BYTES)
    }
    expect(Buffer.from(keys[0] ?? '', 'base64url').byteLength).toBe(32)
    expect(new Set(keys).size).toBe(keys.length)
    await expect(createIdentityVerifier({ key: { kind: 'secret', secret: newKey() }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: TENANT_CLAIM } })).resolves.toBeTypeOf('function')
  })
})

/** A clock that only moves when the code under test sleeps. */
function clock() {
  let now = 0
  const slept: number[] = []
  return {
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms)
      now += ms
    },
    advance: (ms: number) => {
      now += ms
    },
    slept,
  }
}

describe('waiting for a started server', () => {
  // The server takes seconds to answer; a start judged by start() returning
  // alone would hand the page a token for a server that refuses its first
  // request. Asked every POLL_MS until it answers.
  test('asks until the server answers, every POLL_MS', async () => {
    const time = clock()
    let asked = 0
    const { healthy } = await waitUntilHealthy(async () => (asked += 1) >= 5, { alive: () => true, now: time.now, sleep: time.sleep })
    expect(healthy).toBe(true)
    expect(asked).toBe(5)
    expect(time.slept).toEqual([POLL_MS, POLL_MS, POLL_MS, POLL_MS])
  })

  // A start that never answers -- Cloudflare had no instance to give, the
  // image failed -- is a failure the page hears about within the deadline,
  // not a request held for ever.
  test('gives up at the deadline', async () => {
    const time = clock()
    let asked = 0
    const { healthy } = await waitUntilHealthy(
      async () => {
        asked += 1
        return false
      },
      { alive: () => true, now: time.now, sleep: time.sleep },
    )
    expect(healthy).toBe(false)
    expect(time.now()).toBeGreaterThanOrEqual(START_DEADLINE_MS)
    expect(time.now()).toBeLessThan(START_DEADLINE_MS + POLL_MS)
    expect(asked).toBe(START_DEADLINE_MS / POLL_MS)
  })

  // Each request is given what is left of the deadline, so one that hangs
  // cannot carry the wait past it.
  test('gives each request only what is left of the deadline', async () => {
    const time = clock()
    const given: number[] = []
    await waitUntilHealthy(
      async (remaining) => {
        given.push(remaining)
        time.advance(10_000)
        return false
      },
      { alive: () => true, now: time.now, sleep: time.sleep },
    )
    expect(given[0]).toBe(START_DEADLINE_MS)
    expect(given[1]).toBe(START_DEADLINE_MS - 10_000 - POLL_MS)
    for (const each of given) expect(each).toBeGreaterThan(0)
  })

  // A container that stopped while starting will never answer: waiting out
  // the deadline for it would keep the visitor half a minute for nothing.
  test('gives up as soon as the container is no longer running', async () => {
    const time = clock()
    let checks = 0
    const { healthy } = await waitUntilHealthy(async () => false, { alive: () => (checks += 1) < 3, now: time.now, sleep: time.sleep })
    expect(healthy).toBe(false)
    expect(time.now()).toBeLessThan(5 * POLL_MS)
  })

  // The Durable Object waits on the platform's own clock and timers.
  test('waits in real time when given no clock', async () => {
    let asked = 0
    const started = Date.now()
    expect((await waitUntilHealthy(async () => (asked += 1) >= 3, { alive: () => true, pollMs: 5 })).healthy).toBe(true)
    expect(Date.now() - started).toBeGreaterThanOrEqual(9)
  })

  // Whether a container reads as running at once after start() returns is
  // not documented: one that does not yet is still starting, and only one
  // that ran and stopped will never answer.
  test('counts a container as starting until it has been seen running, and as gone once it stops after that', () => {
    const states = [false, false, true, true, false, false]
    let at = 0
    const alive = untilStopped(() => states[Math.min(at, states.length - 1)] ?? false)
    const seen: boolean[] = []
    for (at = 0; at < states.length; at += 1) seen.push(alive())
    expect(seen).toEqual([true, true, true, true, false, false])
  })

  // A request that throws -- "Container is not listening to port 4390"
  // until the server is up, as Cloudflare's local-development guide says --
  // is the server not answering yet, not a failed start.
  test('counts a request that throws as not answering yet', async () => {
    const time = clock()
    let asked = 0
    const { healthy } = await waitUntilHealthy(
      async () => {
        asked += 1
        if (asked < 3) throw new Error('Container is not listening to port 4390')
        return true
      },
      { alive: () => true, now: time.now, sleep: time.sleep },
    )
    expect(healthy).toBe(true)
  })

  // What a failed start's log line is made from (0086): a wait that gave up
  // said only false, so a start that failed on Cloudflare -- every sign-in of
  // the first deploy, on 2026-10-19 -- could not be told from one whose
  // container stopped, nor what the probe had last been told.
  test('says how it ended, after how many probes and how long, and what the last probe that threw said', async () => {
    const time = clock()
    let asked = 0
    const answered = await waitUntilHealthy(async () => (asked += 1) >= 2, { alive: () => true, now: time.now, sleep: time.sleep })
    expect(answered).toEqual({ healthy: true, ended: 'answered', probes: 2, elapsedMs: POLL_MS, lastError: undefined })
    const deadline = await waitUntilHealthy(
      async () => {
        throw new TypeError('Container is not listening to port 4390')
      },
      { alive: () => true, now: time.now, sleep: time.sleep },
    )
    expect(deadline).toEqual({ healthy: false, ended: 'deadline', probes: START_DEADLINE_MS / POLL_MS, elapsedMs: START_DEADLINE_MS, lastError: 'TypeError: Container is not listening to port 4390' })
    let checks = 0
    const stopped = await waitUntilHealthy(async () => false, { alive: () => (checks += 1) < 3, now: time.now, sleep: time.sleep })
    expect(stopped).toMatchObject({ healthy: false, ended: 'stopped', probes: 2, lastError: undefined })
  })
})

describe("a failed start's log line (0086)", () => {
  const key = newKey()

  // Which step failed and what the platform said: start() and
  // setInactivityTimeout() throw on Cloudflare, and the line is all the
  // live log shows of it.
  test("names the step that threw and the platform's error", () => {
    expect(failedStartLine({ step: 'start', error: new Error('the start was refused') }, key)).toBe('live demo: a start failed: start threw Error: the start was refused')
    expect(failedStartLine({ step: 'inactivity-timeout', error: new RangeError('no') }, key)).toBe('live demo: a start failed: inactivity-timeout threw RangeError: no')
    expect(failedStartLine({ step: 'other', error: 'a string' }, key)).toBe('live demo: a start failed: other threw a string')
  })

  // A wait for /health that gave up says why, how long and how often it
  // asked, and what it was last refused with.
  test('says how the wait for /health ended', () => {
    expect(failedStartLine({ step: 'health', wait: { healthy: false, ended: 'deadline', probes: 60, elapsedMs: 30_000, lastError: 'TypeError: Container is not listening to port 4390' } }, key)).toBe(
      'live demo: a start failed: /health did not answer within 30000 ms, after 60 probes; the last threw TypeError: Container is not listening to port 4390',
    )
    expect(failedStartLine({ step: 'health', wait: { healthy: false, ended: 'stopped', probes: 3, elapsedMs: 1_000, lastError: undefined } }, key)).toBe(
      'live demo: a start failed: the container stopped after 1000 ms, before /health answered, after 3 probes',
    )
  })

  // The key the start was made with signs every token of that visitor: a
  // platform error that quoted the container's environment would put it in
  // the log. It is cut out, wherever it appears.
  test("never carries the start's key, even when the error quoted it", () => {
    const line = failedStartLine({ step: 'start', error: new Error(`refused env {"FORMANCY_DATA_IDENTITY_SECRET":"${key}"} and again ${key}`) }, key)
    expect(line).not.toContain(key)
    expect(line).toContain('<key>')
  })
})

describe('a start Cloudflare has no instance for (0087)', () => {
  // Cloudflare says it had no instance for a start only by rejecting
  // monitor() with this sentence, which its own Container class meets by
  // starting again; any other rejection is a container that failed, which
  // starting again would not mend.
  test("is told by monitor()'s words, and nothing else is", () => {
    expect(noInstance(new Error('There is no container instance that can be provided to this Durable Object, try again later'))).toBe(true)
    expect(noInstance(new Error('the image failed'))).toBe(false)
    expect(noInstance('There is no container instance that can be provided to this Durable Object')).toBe(false)
    expect(noInstance(undefined)).toBe(false)
  })

  // A start that answered says how long it took on Cloudflare, which no
  // gate measures, and how often it was started again; the deadline is to
  // be set from these lines.
  test('a start that answered says how long it took, and how often it was started again', () => {
    const wait = { healthy: true, ended: 'answered', probes: 30, elapsedMs: 21_400, lastError: undefined } as const
    expect(startedLine(wait, 0)).toBe('live demo: a start answered after 21400 ms, after 30 probes')
    expect(startedLine(wait, 2)).toBe('live demo: a start answered after 21400 ms, after 30 probes, started again 2 times after Cloudflare had no instance')
    expect(startedLine(wait, 1)).toBe('live demo: a start answered after 21400 ms, after 30 probes, started again once after Cloudflare had no instance')
  })

  // A start that still failed says how often it was started again.
  test('a failed wait says how often it was started again', () => {
    expect(failedStartLine({ step: 'health', wait: { healthy: false, ended: 'deadline', probes: 240, elapsedMs: 60_000, lastError: 'Error: Cloudflare had no container instance; started again' }, restarts: 3 }, newKey())).toBe(
      'live demo: a start failed: /health did not answer within 60000 ms, after 240 probes; the last threw Error: Cloudflare had no container instance; started again; started again 3 times after Cloudflare had no instance',
    )
  })
})
