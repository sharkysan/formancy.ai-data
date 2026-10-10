import { describe, expect, test } from 'vitest'
import { DEFAULT_RATE_LIMIT, RATE_LIMIT_REFUSAL, rateLimitSetting } from './rate-limit.js'

/*
 * FORMANCY_DATA_RATE_LIMIT, as the composition root reads it: requests a
 * minute per client address. A setting an operator writes into a compose file
 * is parsed here, and anything that is not plainly a whole number of at least
 * one stops the process rather than starting a server with a limit nobody
 * chose.
 */

describe('rateLimitSetting', () => {
  // An operator who sets nothing keeps the limit every earlier release had.
  // A default that moved with this setting would change a running deployment's
  // behaviour on upgrade without a line in its configuration.
  test('unset is the default, 600 a minute', () => {
    expect(rateLimitSetting(undefined)).toEqual({ ok: true, rateLimit: { max: 600, timeWindowMs: 60_000 } })
    expect(DEFAULT_RATE_LIMIT).toEqual({ max: 600, timeWindowMs: 60_000 })
  })

  // The two ends a deployment uses: one request a minute, which a test of the
  // limit itself sets, and the measurement's ten million, which must not be
  // refused or rounded.
  test('accepts a whole number from one up, per minute', () => {
    expect(rateLimitSetting('1')).toEqual({ ok: true, rateLimit: { max: 1, timeWindowMs: 60_000 } })
    expect(rateLimitSetting('10000000')).toEqual({ ok: true, rateLimit: { max: 10_000_000, timeWindowMs: 60_000 } })
  })

  // `Number(text)` alone reads '' as 0, '1.5' as a fraction of a request and
  // 2^53 + 1 as 2^53: an empty variable in a compose file, a typo and a value
  // past what a number holds would each start a server with a limit nobody
  // wrote. Each is refused with the one sentence main.ts prints.
  test.each(['', '0', '-1', '1.5', 'abc', '9007199254740993', ' 600', '600 ', '6e2', '0x10'])('refuses %j with the sentence that names the setting', (text) => {
    expect(rateLimitSetting(text)).toEqual({ ok: false, problem: RATE_LIMIT_REFUSAL })
  })

  // The sentence is what an operator reads in the container's log; it names
  // the variable and what it holds, so the fix is in the message.
  test('the refusal names the setting and its unit', () => {
    expect(RATE_LIMIT_REFUSAL).toBe('FORMANCY_DATA_RATE_LIMIT is a whole number of requests a minute per client address, at least 1.')
  })
})
