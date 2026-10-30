import { DEFAULT_LOOKUP_DEADLINE_MS, MAX_LOOKUP_DEADLINE_MS } from '@formancy/data-core'
import { describe, expect, test, vi } from 'vitest'
import { createDataServer } from './app.js'
import { createFileConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'
import { lookupDeadline, lookupDeadlineSetting } from './lookup-deadline.js'

/*
 * FORMANCY_DATA_LOOKUP_DEADLINE_MS, as the composition root reads it: how
 * long a lookup statement may run before the server stops it (0061). An
 * operator's setting is parsed here, and anything but a whole number of
 * milliseconds a Node timer can hold stops the process, rather than starting
 * a server whose every lookup is refused or never bounded.
 */

describe('lookupDeadlineSetting', () => {
  // An operator who sets nothing gets the default the measurement derived;
  // a server that read "unset" as no deadline would let every scan run to
  // its end, which is what 0061 removes.
  test('unset is the measured default', () => {
    expect(lookupDeadlineSetting(undefined)).toEqual({ ok: true, ms: DEFAULT_LOOKUP_DEADLINE_MS })
  })

  // Both ends are a deployment's: one millisecond, which a test of the
  // deadline itself may set, and the longest a timer holds, which the
  // performance harness sets so nothing it measures is cut.
  test('accepts a whole number of milliseconds from 1 to the longest a timer holds', () => {
    expect(lookupDeadlineSetting('250')).toEqual({ ok: true, ms: 250 })
    expect(lookupDeadlineSetting('1')).toEqual({ ok: true, ms: 1 })
    expect(lookupDeadlineSetting(String(MAX_LOOKUP_DEADLINE_MS))).toEqual({ ok: true, ms: MAX_LOOKUP_DEADLINE_MS })
  })

  // `Number(text)` alone reads '' as 0 and '1.5' as a fraction: a deadline of
  // 0 refuses every lookup before it is sent, junk does the same or nothing,
  // and 2^31 ms is a timer Node fires at once -- the opposite of what the
  // operator wrote. Each is refused with a sentence naming the variable.
  test.each(['', '0', '-1', '1.5', 'abc', ' 536', '536 ', '5e2', '0x10', '2147483648'])('refuses %j, naming the variable and what it holds', (text) => {
    expect(lookupDeadlineSetting(text)).toEqual({
      ok: false,
      problem: `FORMANCY_DATA_LOOKUP_DEADLINE_MS is a whole number of milliseconds from 1 to 2147483647; it is ${JSON.stringify(text)}.`,
    })
  })
})

describe('createDataServer runtime.lookupDeadlineMs', () => {
  // The option is exported and documented beside the variable, and a server
  // built in code skips main.ts. Unchecked, 0 or 2^31 refused every lookup at
  // once quoting the impossible number, and 1.5, -1 or NaN made every lookup
  // route and every write with a lookup field fail with a 500 from Node's
  // timer (2026-10-15 review). The rule is the variable's, and the server
  // refuses to start, as it does an origin list nobody could have meant.
  const registry: ConnectionRegistry = {
    ids: () => [],
    scope: () => undefined,
    open: async () => {
      throw new Error('no connections')
    },
    close: async () => {},
  }
  const verifyIdentity = async () => ({ ok: false as const, reason: 'none' })
  test.each([0, -1, 1.5, Number.NaN, MAX_LOOKUP_DEADLINE_MS + 1, Number.POSITIVE_INFINITY])('refuses %s at construction, naming the option', async (ms) => {
    const store = createFileConfigurationStore('unused')
    await expect(createDataServer({ verifyIdentity, runtime: { registry, store, lookupDeadlineMs: ms } })).rejects.toThrow(
      `runtime.lookupDeadlineMs is a whole number of milliseconds from 1 to 2147483647; it is ${String(ms)}.`,
    )
  })

  // Both ends are the variable's too.
  test('accepts both ends', async () => {
    const store = createFileConfigurationStore('unused')
    for (const ms of [1, MAX_LOOKUP_DEADLINE_MS]) await (await createDataServer({ verifyIdentity, runtime: { registry, store, lookupDeadlineMs: ms } })).close()
  })
})

describe('lookupDeadline', () => {
  // The signal a lookup statement is handed: the deadline's TimeoutError, or
  // the client's leaving, whichever comes first, with the reason that came.
  // The route tells a deadline from a database failure by that identity.
  test('aborts with a TimeoutError once the time passes, or with the reason of the signal it is given', async () => {
    const timed = lookupDeadline(20)
    await new Promise((resolve) => timed.signal.addEventListener('abort', resolve, { once: true }))
    expect(timed.signal.reason).toMatchObject({ name: 'TimeoutError' })
    const left = new AbortController()
    const within = lookupDeadline(60_000, left.signal)
    const reason = new Error('the client left')
    left.abort(reason)
    expect(within.signal.reason).toBe(reason)
    within.clear()
    const gone = new AbortController()
    gone.abort(reason)
    const already = lookupDeadline(60_000, gone.signal)
    expect(already.signal.reason).toBe(reason)
    already.clear()
  })

  // Cleared once its route has answered, a deadline holds nothing: no timer,
  // and no listener on the request's signal. AbortSignal.any over
  // AbortSignal.timeout kept each request's signals, about 730 bytes, until
  // the timer fired -- for up to 24.8 days at the longest deadline, which the
  // performance harness sets (2026-10-15 review, Node 24.21.0) -- and a
  // timeout signal cannot be cleared, so this one is a timer of its own.
  test('once cleared, never aborts and leaves no listener behind', async () => {
    const left = new AbortController()
    let listening = 0
    const counted = {
      get aborted() {
        return left.signal.aborted
      },
      get reason(): unknown {
        return left.signal.reason
      },
      addEventListener: (type: 'abort', listener: () => void, options?: { once?: boolean }) => {
        listening += 1
        left.signal.addEventListener(type, listener, options)
      },
      removeEventListener: (type: 'abort', listener: () => void) => {
        listening -= 1
        left.signal.removeEventListener(type, listener)
      },
    } as unknown as AbortSignal
    const deadline = lookupDeadline(20, counted)
    expect(listening).toBe(1)
    deadline.clear()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(deadline.signal.aborted).toBe(false)
    expect(listening).toBe(0)
  })
})

describe('MAX_LOOKUP_DEADLINE_MS', () => {
  // The bound is Node's, not a choice: one millisecond more and setTimeout
  // fires at once, with a TimeoutOverflowWarning, so a deadline past it
  // would refuse every lookup immediately. Asked of the timer itself, so the
  // claim in limits.ts is held by what Node does.
  test('is the longest delay a Node timer holds: one more fires at once', async () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    let longest = false
    let past = false
    const a = setTimeout(() => (longest = true), MAX_LOOKUP_DEADLINE_MS)
    const b = setTimeout(() => (past = true), MAX_LOOKUP_DEADLINE_MS + 1)
    try {
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect({ longest, past }).toEqual({ longest: false, past: true })
    } finally {
      clearTimeout(a)
      clearTimeout(b)
      warn.mockRestore()
    }
  })
})
