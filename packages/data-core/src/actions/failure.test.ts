import { describe, expect, test } from 'vitest'
import type { RecordFailure, RecordFailureCode } from '../records/types.js'
import { runFailure } from './failure.js'

/*
 * What a record failure is as a run's (0160): one mapping both adapters
 * answer a run's refused statement with, so the two cannot read one
 * refusal two ways. Each case was watched failing on 2026-11-16 with its
 * rule taken out.
 */

const failure = (code: RecordFailureCode): RecordFailure => ({ ok: false, code, message: `a ${code}` })

describe('a record failure as a run’s', () => {
  // The codes the action port has mean what they mean for a write: a run's
  // `stale` or `not-found` is the read after its lock's, and a lost answer
  // is unknown. Answered as `refused`, a person would be told the database
  // refused a run that was only stale. Watched failing with every code
  // answered `refused`: "expected { ok: false, code: 'refused', …(1) } to
  // deeply equal { ok: false, code: 'not-found', …(1) }".
  test('keeps every code the action port has', () => {
    for (const code of ['not-found', 'stale', 'version-ended', 'schema-changed', 'permission-denied', 'refused', 'unavailable', 'unknown-outcome'] as const) {
      expect(runFailure(failure(code))).toEqual({ ok: false, code, message: `a ${code}` })
    }
  })

  // A constraint's or a value's refusal in a run is the deployment's -- the
  // run writes nothing of its own but the version -- and the port has no
  // code for it: `refused`, the code kept in the log's sentence. Passed
  // through, it would reach the route as a code the action port does not
  // declare. Watched failing with every code passed through: "expected
  // 'chain-exists' to be 'refused'".
  test('is refused for a constraint’s or a value’s refusal, the code named in its sentence', () => {
    for (const code of [
      'chain-exists',
      'unique-violation',
      'foreign-key-violation',
      'not-null-violation',
      'check-violation',
      'too-long',
      'out-of-range',
    ] as const) {
      const run = runFailure(failure(code))
      expect(run.code).toBe('refused')
      expect(run.message).toContain(`(${code})`)
    }
  })

  // `declined` keeps the deployment's reason and the column it names, for
  // the person alone (0156), and adds nothing when there is none. Watched
  // failing with the reason left out: "expected { ok: false, code:
  // 'declined', …(2) } to deeply equal { ok: false, code: 'declined', …(3)
  // }".
  test('keeps a declined reason and its column, and adds none', () => {
    const declined: RecordFailure = { ok: false, code: 'declined', message: 'worded', reason: 'Not now.', column: 'note' }
    expect(runFailure(declined)).toEqual({ ok: false, code: 'declined', message: 'worded', reason: 'Not now.', column: 'note' })
    expect(runFailure({ ok: false, code: 'declined', message: 'worded' })).toEqual({ ok: false, code: 'declined', message: 'worded' })
  })
})
