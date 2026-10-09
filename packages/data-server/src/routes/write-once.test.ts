import { describe, expect, test } from 'vitest'
import { createWriteOnce, KEEP_MS, MAX_KEPT, MAX_KEPT_BYTES } from './write-once.js'
import type { WriteAnswer } from './write-once.js'

/*
 * The bounds of what the server keeps to answer a write sent again (0031),
 * with a clock of the test's own: the routes' suite proves what a repeat is
 * answered with; this proves the store forgets, so a server that runs for
 * weeks does not hold every answer it ever gave, and that it forgets the
 * oldest first.
 */

const scope = (id: string, body: unknown = { answers: { n: 1 } }) => ({ actor: 'c', form: 'customer', operation: 'create' as const, id, body })

/** A perform that counts its calls and answers `body`. */
function counting(body: unknown = { record: 'k1:1' }): { perform: () => Promise<WriteAnswer>; calls: () => number } {
  let calls = 0
  return {
    perform: async () => {
      calls += 1
      return { status: 201, body }
    },
    calls: () => calls,
  }
}

describe('what is kept for a write sent again', () => {
  // Kept for ever, an answer would hold its record's values in memory for
  // the life of the process; past KEEP_MS, the same id is a write again.
  test('an answer is kept for KEEP_MS, and after that the same id is performed again', async () => {
    let clock = 0
    const writes = createWriteOnce(() => clock)
    const { perform, calls } = counting()
    await writes.once(scope('a'), perform)
    clock = KEEP_MS - 1
    expect(await writes.once(scope('a'), perform)).toMatchObject({ repeated: true })
    expect(calls()).toBe(1)
    clock = KEEP_MS
    expect(await writes.once(scope('a'), perform)).toMatchObject({ repeated: false })
    expect(calls()).toBe(2)
  })

  // A person sending writes under fresh ids could otherwise make the server
  // keep any number of answers within the window. The oldest goes first:
  // a resend arrives soon after its first sending, so the newest are the
  // ones still worth keeping.
  test('past MAX_KEPT answers, the oldest is dropped first', async () => {
    const writes = createWriteOnce(() => 0)
    const { perform, calls } = counting()
    for (let n = 0; n <= MAX_KEPT; n += 1) await writes.once(scope(`id-${String(n)}`), perform)
    await writes.once(scope('one more'), perform)
    expect(await writes.once(scope(`id-${String(MAX_KEPT)}`), perform)).toMatchObject({ repeated: true })
    expect(await writes.once(scope('id-0'), perform)).toMatchObject({ repeated: false })
    expect(calls()).toBe(MAX_KEPT + 3)
  })

  // A form's answers are small, but the body limit is a megabyte: the count
  // alone would let ten thousand large answers be kept.
  test('past MAX_KEPT_BYTES of answers, the oldest is dropped first', async () => {
    const writes = createWriteOnce(() => 0)
    const large = counting({ notes: 'x'.repeat(MAX_KEPT_BYTES / 2) })
    for (const id of ['first', 'second', 'third']) await writes.once(scope(id), large.perform)
    await writes.once(scope('small'), counting().perform)
    expect(await writes.once(scope('third'), large.perform)).toMatchObject({ repeated: true })
    expect(await writes.once(scope('first'), large.perform)).toMatchObject({ repeated: false })
    expect(large.calls()).toBe(4)
  })

  // A first sending that failed outright -- a server error -- is answered
  // the same way to its resend, not performed again behind it.
  test('a first sending that threw is thrown again to its resend, and not performed again', async () => {
    const writes = createWriteOnce(() => 0)
    let calls = 0
    const failing = async (): Promise<WriteAnswer> => {
      calls += 1
      throw new Error('the adapter threw')
    }
    await expect(writes.once(scope('a'), failing)).rejects.toThrow('the adapter threw')
    await expect(writes.once(scope('a'), failing)).rejects.toThrow('the adapter threw')
    expect(calls).toBe(1)
  })
})
