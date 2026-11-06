import { describe, expect, test } from 'vitest'
import { hiddenWell, sizing } from './grid-sizing.js'
import type { SizeState } from './grid-sizing.js'

/*
 * When a grid sizes its columns to its rows (0047), now that a grid can be
 * drawn in a tab another hides (0142): AG Grid measures a cell in a hidden
 * panel as nothing, so a grid sized there set every column to its least
 * width, its header's longest word, and kept it -- a date cut to "2026-1…".
 * Sized only where it is drawn; where it is not, it owes the size, paid
 * when it is shown.
 */

const page = (state: Partial<SizeState> = {}): SizeState => ({ loaded: true, rows: 3, sized: false, owed: false, ...state })

describe('sizing', () => {
  // The first page with rows, landing after the person moved to another
  // tab: sized there, its columns would keep their least widths, since a
  // grid is sized once. It owes the size instead, and pays it when shown.
  test('owes the first page’s size while hidden, and pays it once shown', () => {
    expect(sizing(page(), 'page', true)).toEqual({ size: false, owed: true })
    expect(sizing(page({ owed: true }), 'shown', false)).toEqual({ size: true, owed: false })
    expect(sizing(page(), 'page', false)).toEqual({ size: true, owed: false })
  })

  // Letting go of the separator fits every grid of the lanes again, a
  // hidden tab's too: fitted there, it collapsed; it owes it instead.
  test('owes a refit while hidden, and pays it once shown', () => {
    expect(sizing(page({ sized: true }), 'refit', true)).toEqual({ size: false, owed: true })
    expect(sizing(page({ sized: true, owed: true }), 'shown', false)).toEqual({ size: true, owed: false })
    expect(sizing(page({ sized: true }), 'refit', false)).toEqual({ size: true, owed: false })
  })

  // Columns shown while nothing was listed are sized to the next page's
  // rows; hidden then, the whole grid owes its size.
  test('owes the columns shown while nothing was listed, while hidden', () => {
    expect(sizing(page({ sized: true }), 'added', true)).toEqual({ size: false, owed: true })
    expect(sizing(page({ sized: true }), 'added', false)).toEqual({ size: true, owed: false })
  })

  // Paging never makes the columns jump: a later page sizes nothing, and a
  // grid resized with nothing owed -- its well fitted to a page, a window
  // made narrower -- keeps its columns as they are.
  test('sizes nothing for a later page, or a resize with nothing owed', () => {
    expect(sizing(page({ sized: true }), 'page', false)).toEqual({ size: false, owed: false })
    expect(sizing(page({ sized: true }), 'shown', false)).toEqual({ size: false, owed: false })
    expect(sizing(page({ owed: true }), 'shown', true)).toEqual({ size: false, owed: true })
  })

  // Nothing to size to: no page yet, or one with no rows. What is owed
  // waits for rows.
  test('sizes nothing with no rows to size to', () => {
    expect(sizing(page({ loaded: false }), 'page', false)).toEqual({ size: false, owed: false })
    expect(sizing(page({ rows: 0 }), 'refit', false)).toEqual({ size: false, owed: false })
    expect(sizing(page({ rows: 0, owed: true }), 'shown', false)).toEqual({ size: false, owed: true })
  })
})

describe('hiddenWell', () => {
  // The page hides a view, a Drill down level and a tab's panel by the
  // `hidden` attribute (workspace.css makes it display: none): a well
  // under any of them is drawn nowhere, however deep it is.
  test('is a well under a hidden element, and no other', () => {
    document.body.innerHTML = '<div id="panel"><section><div id="well"></div></section></div><div id="shown"><div id="other"></div></div>'
    const well = document.getElementById('well')
    expect(hiddenWell(well)).toBe(false)
    document.getElementById('panel')?.setAttribute('hidden', '')
    expect(hiddenWell(well)).toBe(true)
    expect(hiddenWell(document.getElementById('other'))).toBe(false)
    expect(hiddenWell(null)).toBe(true)
  })
})
