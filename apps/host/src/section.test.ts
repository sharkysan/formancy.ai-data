import { describe, expect, test } from 'vitest'
import { sectionShown } from './section.js'

/*
 * Whether a section shows under a record (0109), from the record as stored.
 */
describe('sectionShown', () => {
  // The answer compared is the stored record's, as its own field holds it:
  // a yes/no as its control's `true` or `false`, a whole number as a number.
  test('is the stored answer compared with the condition, as the record holds it', () => {
    const when = { field: 'kind', equals: 'company' }
    expect(sectionShown({ when }, { kind: 'company' })).toBe(true)
    expect(sectionShown({ when }, { kind: 'person' })).toBe(false)
    expect(sectionShown({ when }, {})).toBe(false)
    expect(sectionShown({ when: { field: 'no', equals: 1001 } }, { no: '1001' })).toBe(false)
  })

  // A section with no condition, or under a record whose stored answers are
  // not known -- a new one -- is shown: what a page shows is never a
  // permission, and a section hidden by mistake hides what its own policy
  // lets the person read.
  test('is shown with no condition, and where the stored answers are not known', () => {
    expect(sectionShown({ when: null }, { kind: 'person' })).toBe(true)
    expect(sectionShown({ when: { field: 'kind', equals: 'company' } }, null)).toBe(true)
  })
})
