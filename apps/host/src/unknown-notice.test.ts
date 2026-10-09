import { describe, expect, test } from 'vitest'
import type { FormRecord } from '@formancy/data-client'
import { verdict } from './unknown-notice.js'

/*
 * What the notice says a check found, as words: only what the read showed.
 * A pure function, tested as one, because two of its answers no host suite
 * can reach -- no form the host's plane publishes names its own key, so a
 * create there is never `present` or `absent` (0031). The page suites hold
 * the rest of what the notice says, by role and name.
 */

const STORED: FormRecord = { record: 'k1:1,8', version: '00000000000007d1', answers: { name: 'Neu GmbH' } }

describe('what a check found, in words', () => {
  // The read finds a row with the key the create named; it does not show
  // that this save stored it -- another person's create of the same key is
  // found the same way. "It was saved" would tell the person their answers
  // are in, and they may not be.
  test('present says a record with this key is stored, not that this save stored it', () => {
    const { text } = verdict({ ok: true, state: 'present', current: STORED }, 'database')
    expect(text).toBe('A record with this key is stored, record k1:1,8. Load it to see whether it holds what was entered here.')
    expect(text).not.toMatch(/was saved/)
  })

  // A 404 is what the read shows through this person's read filter, and a
  // create is under no such filter: a stored row the filter hides is "not
  // found" too. Saying it is not in the record would be a claim about the
  // database the read cannot make; saying it again is safe stays true,
  // because the key stops a second row either way.
  test('absent says this form cannot find it, not that it is not stored', () => {
    const { text } = verdict({ ok: true, state: 'absent' }, 'database')
    expect(text).toBe('This form cannot find a record with its key. Saving it again is safe: the key stops a second copy.')
    expect(text).not.toMatch(/not in the record/)
  })
})
