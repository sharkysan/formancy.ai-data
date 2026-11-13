import { describe, expect, test } from 'vitest'
import type { GridColumn } from './grid-datasource.js'
import { headerFloor, NARROWEST, offeredWidths, readWidths, stepWidth, WIDEST, WIDTH_STEP, widthSaid, withWidths } from './widths.js'

/*
 * A column's width as a person sets it (0151), as data: which widths a
 * browser's kept value holds, what is left of them over the columns a form
 * offers now, a width set and taken away, a press of Wider or Narrower, the
 * floor a header's words set, and what the Columns panel says of each. Pure;
 * column-widths.test.tsx holds the panel's keys and words without a server,
 * and columns-panel.test.tsx and grid-keys.test.tsx the page's grid against
 * the real server on both engines.
 */

const column = (key: string, label: string): GridColumn => ({ key, label, sortable: true, source: null })
const COLUMNS = [column('id', 'Id'), column('amount', 'Amount'), column('notes', 'Notes')]

describe('the widths a browser kept', () => {
  // Every width this release writes is read back as written: one the
  // reader dropped would be a width the person set and the next opening
  // forgot (watched failing with the reader giving nothing back).
  test('reads back each width in the range, in its order', () => {
    const kept = [
      { field: 'notes', width: 480 },
      { field: 'id', width: NARROWEST },
      { field: 'amount', width: WIDEST },
    ]
    expect(readWidths(kept)).toEqual(kept)
  })

  // A width is the least of what is kept: one this release would not
  // write -- a negative, a fraction, a number in a string, past the widest,
  // a field named twice or not at all, a key it does not write -- is
  // dropped alone, and so is a list that is no list, never thrown on and
  // never taking the columns or the view kept beside it (watched failing
  // with the whole-number, range, field-once and key checks taken out in
  // turn: the width each guards read back).
  test('drops a width this release would not write, alone', () => {
    const kept = [
      { field: 'id', width: -40 },
      { field: 'id', width: 120.5 },
      { field: 'id', width: '120' },
      { field: 'id', width: WIDEST + 1 },
      { field: 'id', width: NARROWEST - 1 },
      { field: '', width: 120 },
      { width: 120 },
      { field: 'id', width: 120, shown: true },
      null,
      'id',
      { field: 'amount', width: 200 },
      { field: 'amount', width: 240 },
    ]
    expect(readWidths(kept)).toEqual([{ field: 'amount', width: 200 }])
    for (const value of [undefined, null, 'wide', 3, { amount: 200 }]) expect(readWidths(value)).toEqual([])
  })

  // A field the form no longer offers has no column to be wide: its width
  // is dropped as a kept column's choice is (mergeChoices), and the rest
  // kept (watched failing with the widths left unnarrowed: "status" among
  // them).
  test('keeps the widths of the columns the form offers now', () => {
    const kept = [
      { field: 'status', width: 200 },
      { field: 'notes', width: 480 },
    ]
    expect(offeredWidths(kept, COLUMNS)).toEqual([{ field: 'notes', width: 480 }])
  })
})

describe('a width set or taken away', () => {
  // A drag or a press sets one column's width, in place where it had one
  // and after the others where it had none; a width taken away -- Fit --
  // leaves the others; a width past either end is kept at it, and a
  // fraction, which a drag at a zoom gives, as a whole number, so what is
  // written is what the reader takes (watched failing with the fraction
  // kept: 152.5, which readWidths then dropped).
  test('sets, replaces and removes a column’s width, whole and in range', () => {
    const kept = [
      { field: 'id', width: 80 },
      { field: 'notes', width: 480 },
    ]
    expect(withWidths(kept, [{ field: 'amount', width: 152.5 }])).toEqual([...kept, { field: 'amount', width: 153 }])
    expect(withWidths(kept, [{ field: 'id', width: 120 }])).toEqual([
      { field: 'id', width: 120 },
      { field: 'notes', width: 480 },
    ])
    expect(withWidths(kept, [{ field: 'id', width: null }])).toEqual([{ field: 'notes', width: 480 }])
    expect(
      withWidths(kept, [
        { field: 'id', width: 1 },
        { field: 'notes', width: 99_999 },
      ]),
    ).toEqual([
      { field: 'id', width: NARROWEST },
      { field: 'notes', width: WIDEST },
    ])
    expect(withWidths(kept, [{ field: 'amount', width: null }])).toEqual(kept)
  })
})

describe('a press of Wider or Narrower', () => {
  // One step, within the column's own floor and the widest; at either end
  // the width it has, so the panel can say why nothing moved (watched
  // failing with the step taken past the floor: 52 for a header whose
  // words need 66).
  test('moves one step, and not past the floor or the widest', () => {
    const at = (width: number) => ({ width, min: 66, max: WIDEST })
    expect(stepWidth(at(120), 1)).toBe(120 + WIDTH_STEP)
    expect(stepWidth(at(120), -1)).toBe(120 - WIDTH_STEP)
    expect(stepWidth(at(92), -1)).toBe(66)
    expect(stepWidth(at(66), -1)).toBe(66)
    expect(stepWidth(at(WIDEST - 10), 1)).toBe(WIDEST)
    expect(stepWidth(at(WIDEST), 1)).toBe(WIDEST)
    expect(stepWidth(at(120.4), 1)).toBe(120 + WIDTH_STEP)
  })
})

describe('the floor a header sets', () => {
  // A column is never narrower than its header's longest word, the cell's
  // padding and, where it sorts, the sort's icon: a header wraps between
  // its words (WCAG 1.4.12) and never cuts one. jsdom has no canvas, so the
  // estimate stands here; the browser gate measures the words whole at the
  // floor (scripts/browser/widths.mjs). Nothing is narrower than NARROWEST,
  // which the reader holds a kept width to (watched failing with NARROWEST
  // left without the slack every floor has: 24, where an empty header's
  // floor is 28).
  test('is the longest word, the padding and the sort’s icon', () => {
    expect(headerFloor('Order date', true)).toBe(headerFloor('Order', true))
    expect(headerFloor('Order date', true)).toBeGreaterThan(headerFloor('Order date', false))
    expect(headerFloor('Customer', false)).toBeGreaterThan(headerFloor('Id', false))
    expect(headerFloor('', false)).toBe(NARROWEST)
  })
})

describe('what the panel says', () => {
  // A width changed is said in pixels; nothing changed is said with why, so
  // a person who cannot see the header learns the end from the press
  // (watched failing with an end said as a change: "Amount is 960 pixels
  // wide." at the widest).
  test('says the width set, an end reached and a column fitted', () => {
    expect(widthSaid('Amount', 160, 'set')).toBe('Amount is 160 pixels wide.')
    expect(widthSaid('Amount', WIDEST, 'widest')).toBe(`Amount is as wide as a column goes: ${String(WIDEST)} pixels.`)
    expect(widthSaid('Amount', 66, 'narrowest')).toBe('Amount is as narrow as its header lets it be: 66 pixels.')
    expect(widthSaid('Amount', 0, 'fitted')).toBe('Amount is sized to its content.')
  })
})
