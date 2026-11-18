import { describe, expect, test } from 'vitest'
import type { RecordFailure, RecordFailureCode } from '../records/types.js'
import { runFailure, unmovedFailure } from './failure.js'

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

describe('a run that locked fewer records than it addressed', () => {
  // A selection can meet a refusal about the run beside the records' own --
  // the table moved under it -- and the run's is the answer, whatever the
  // order: a stale record named before it would send a person to reload a
  // record when an administrator must review the form. Watched failing on
  // 2026-11-17 with the records' codes asked first: "expected { ok: false,
  // code: 'stale', …(2) } to deeply equal { ok: false, …(2) }".
  test('is the refusal about the run where a read told one, the first in the request’s order', () => {
    expect(unmovedFailure([failure('stale'), undefined, failure('schema-changed'), failure('unavailable')])).toEqual({
      ok: false,
      code: 'schema-changed',
      message: 'a schema-changed',
    })
  })

  // Otherwise one code names the records it is about, by their positions:
  // a record gone or out of reach before one ended, before one changed,
  // whatever order they were sent in, so both engines answer one selection
  // alike and a page knows which records to read again. Watched failing on
  // 2026-11-17 with the first explained record's code the answer: "expected
  // { ok: false, code: 'stale', …(2) } to match object { ok: false, code:
  // 'not-found', …(1) }"; and with every unmoved record named, whatever its
  // code: "expected { ok: false, code: 'not-found', …(2) } to match object {
  // ok: false, code: 'not-found', …(1) }".
  test('names every record of the first of not-found, version-ended and stale it met', () => {
    const answered = unmovedFailure([failure('stale'), failure('not-found'), undefined, failure('not-found')])
    expect(answered).toMatchObject({ ok: false, code: 'not-found', records: [1, 3] })
    expect(answered.message).toBe('a not-found (2 of the 4 records addressed; the run was rolled back)')
    expect(unmovedFailure([undefined, failure('stale'), failure('version-ended')])).toMatchObject({ code: 'version-ended', records: [2] })
    expect(unmovedFailure([failure('stale')])).toEqual({ ok: false, code: 'stale', message: 'a stale', records: [0] })
  })

  // A read that told nothing apart -- every record locked by the count
  // short of them -- is no run that committed: refused, never done, and no
  // record named that the read did not name. Watched failing on 2026-11-17
  // with it answered stale over no record: "expected 'stale' to be
  // 'refused'".
  test('is refused where the read told none of them apart', () => {
    expect(unmovedFailure([undefined, undefined]).code).toBe('refused')
  })
})
