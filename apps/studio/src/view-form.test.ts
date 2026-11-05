// @vitest-environment node
//
// Node rather than jsdom: nothing here renders. A stored view whose range
// leaves out a bound (0130) through the form that edits it -- a view the
// studio does not author but reads, from a version imported or published
// by another client.
import { describe, expect, test } from 'vitest'
import type { FilterableField, StoredListView } from '@formancy/data-core'
import { hintOf } from './condition-draft.js'
import { draftOfView, sayViewCondition, viewOf } from './view-form.js'

const AMOUNT: FilterableField = { field: 'amount', offered: true, operators: ['equals', 'range', 'null', 'not-null'], input: 'decimal', days: null }
const ORDER_DATE: FilterableField = { field: 'order_date', offered: true, operators: ['equals', 'range'], input: 'date', days: null }
const OFFERS = [AMOUNT, ORDER_DATE]

describe('a view whose range leaves out a bound', () => {
  // Opened and saved again, renamed and nothing else, the view is the one
  // stored: a form that rebuilt the range from its two boxes would publish
  // `amount from 1000`, a wider view than the one it was asked to rename,
  // without a word.
  test('keeps what it leaves out through being edited', () => {
    const stored: StoredListView = {
      name: 'Large',
      filter: [
        { field: 'amount', op: 'range', from: '1000', to: null, exclusive: 'from' },
        { field: 'order_date', op: 'range', from: { today: -7 }, to: { today: 0 }, exclusive: 'both' },
      ],
      sort: [],
    }
    const draft = draftOfView(stored)
    expect(viewOf({ ...draft, name: 'Larger' }, OFFERS)).toEqual({ ...stored, name: 'Larger' })
  })

  // A bound the person empties takes its exclusion with it: what is left
  // says only the bound still there, and a range with none left out is the
  // inclusive range it always was. Kept, the view would name a bound it has
  // not got, which the server refuses.
  test('leaves out only a bound still there', () => {
    const draft = draftOfView({ name: 'Between', filter: [{ field: 'amount', op: 'range', from: '1', to: '9', exclusive: 'both' }], sort: [] })
    const [row] = draft.filter
    if (row === undefined) throw new Error('the draft has no row')
    expect(viewOf({ ...draft, filter: [{ ...row, to: '' }] }, OFFERS).filter).toEqual([
      { field: 'amount', op: 'range', from: '1', to: null, exclusive: 'from' },
    ])
    expect(viewOf({ ...draft, filter: [{ ...row, from: '', to: '' }] }, OFFERS).filter).toEqual([{ field: 'amount', op: 'range', from: null, to: null }])
  })

  // The list of views says what a view finds: `amount from 1000` for a
  // view that leaves 1000 out would tell the administrator it holds an
  // order it does not.
  test('is said by what it leaves out', () => {
    expect(sayViewCondition('Amount', { op: 'range', from: '1000', to: null, exclusive: 'from' })).toBe('Amount > 1000')
    expect(sayViewCondition('Amount', { op: 'range', from: '1', to: '9', exclusive: 'both' })).toBe('Amount > 1 and < 9')
    expect(sayViewCondition('Order date', { op: 'range', from: '2026-10-01', to: '2026-11-01', exclusive: 'to' })).toBe(
      'Order date >= 2026-10-01 and < 2026-11-01',
    )
    expect(sayViewCondition('Order date', { op: 'range', from: { today: -7 }, to: null, exclusive: 'from' })).toBe('Order date > 7 days before today')
    expect(sayViewCondition('Amount', { op: 'range', from: '1', to: '9' })).toBe('Amount from 1 to 9')
  })

  // The hint under the boxes describes them: "From and To are both
  // included" over a view that leaves From out is the one sentence on the
  // form that is false.
  test('is described under its boxes by what they leave out', () => {
    expect(hintOf('Amount', AMOUNT, 'range', 'from')).toBe('From is left out and To included, and either may be left empty.')
    expect(hintOf('Amount', AMOUNT, 'range', 'both')).toBe('From and To are both left out, and either may be left empty.')
    expect(hintOf('Created', { ...AMOUNT, input: 'date', days: 'utc' }, 'range', 'to')).toBe(
      'Created is filtered by whole days in UTC: from the start of the day From names, and before the day To names. Either may be left empty.',
    )
    expect(hintOf('Amount', AMOUNT, 'range')).toBe('From and To are both included, and either may be left empty.')
  })
})
