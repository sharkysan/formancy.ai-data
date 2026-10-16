import { createIdentityVerifier } from '@formancy/data-server'
import { describe, expect, test } from 'vitest'
import { AUDIENCE, ISSUER, MIN_KEY_BYTES, TENANT_CLAIM } from '../token.js'
import { POLL_MS, START_DEADLINE_MS } from './limits.js'
import { newKey, untilStopped, waitUntilHealthy } from './start.js'

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
    const healthy = await waitUntilHealthy(async () => (asked += 1) >= 5, { alive: () => true, now: time.now, sleep: time.sleep })
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
    const healthy = await waitUntilHealthy(
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
    const healthy = await waitUntilHealthy(async () => false, { alive: () => (checks += 1) < 3, now: time.now, sleep: time.sleep })
    expect(healthy).toBe(false)
    expect(time.now()).toBeLessThan(5 * POLL_MS)
  })

  // The Durable Object waits on the platform's own clock and timers.
  test('waits in real time when given no clock', async () => {
    let asked = 0
    const started = Date.now()
    expect(await waitUntilHealthy(async () => (asked += 1) >= 3, { alive: () => true, pollMs: 5 })).toBe(true)
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
    const healthy = await waitUntilHealthy(
      async () => {
        asked += 1
        if (asked < 3) throw new Error('Container is not listening to port 4390')
        return true
      },
      { alive: () => true, now: time.now, sleep: time.sleep },
    )
    expect(healthy).toBe(true)
  })
})
