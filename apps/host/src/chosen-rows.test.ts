import { describe, expect, test } from 'vitest'
import { clearedText, createChosenRows, NONE_CHOSEN } from './chosen-rows.js'
import type { GridRow } from './grid-datasource.js'

/*
 * The choice of a page's records (0166), as a table of what each page
 * drawn, box ticked and version heard leaves chosen, and what the bar's
 * line says of it. Pure: the column that draws it is choose-column.test.tsx's,
 * and what a run over it sends against the real server actions.test.tsx's.
 */

const row = (record: string | null, version: string | null = '1'): GridRow => ({ id: record ?? 'row-9', record, version, answers: {}, labels: {} })
const PAGE = [row('k1:1'), row('k1:2'), row('k1:3'), row(null, null)]

/** Two lists, as two datasources a search or a sort makes. */
const LIST = {}
const OTHER = {}

describe('the records chosen of a page', () => {
  // A choice is of the page shown: another page of the list, or the first
  // page of another -- a search, a filter, a sort, a view -- clears it, and
  // the line says it did and why; nothing chosen, nothing is said (watched
  // failing with a page compared by where it starts alone: "expected [
  // 'k1:3' ] to deeply equal []").
  test('is cleared by another page or another list, and says so', () => {
    const choice = createChosenRows('Order')
    choice.page(LIST, 0, PAGE)
    choice.toggle(PAGE[0] as GridRow)
    choice.toggle(PAGE[1] as GridRow)
    expect(choice.now().said).toBe('2 chosen.')
    choice.page(LIST, 50, [row('k1:51')])
    expect([...choice.now().chosen]).toEqual([])
    expect(choice.now().said).toBe(clearedText(2))
    expect(clearedText(2)).toBe('The choice of 2 records was cleared: a choice is of the page shown. Nothing chosen.')

    choice.page(LIST, 0, PAGE)
    choice.toggle(PAGE[2] as GridRow)
    choice.page(OTHER, 0, PAGE)
    expect([...choice.now().chosen]).toEqual([])
    choice.page(LIST, 0, PAGE)
    expect(choice.now().said).toBe(clearedText(1))
  })

  // The same page drawn again -- after a save, a delete, Ask again -- keeps
  // the choice, each record at the version that read gave it; a version
  // the detail heard since moves it too; a record gone from the page is
  // no longer chosen, and named; and the records are sent in the page's
  // order, whatever order they were ticked in (watched failing with the
  // versions kept from the first read: "expected [ …(3) ] to deeply equal
  // [ …(3) ]").
  test('is kept by its page drawn again, at the versions read and heard since', () => {
    const choice = createChosenRows('Order')
    choice.page(LIST, 0, PAGE)
    choice.toggle(PAGE[2] as GridRow)
    choice.toggle(PAGE[0] as GridRow)
    choice.toggle(PAGE[1] as GridRow)
    choice.page(LIST, 0, [row('k1:1', '2'), row('k1:2'), row('k1:3', '4')])
    choice.heard('k1:2', '7')
    expect(choice.records()).toEqual([
      { record: 'k1:1', version: '2' },
      { record: 'k1:2', version: '7' },
      { record: 'k1:3', version: '4' },
    ])
    choice.page(LIST, 0, [row('k1:1', '2'), row('k1:3', '4')])
    expect(choice.records().map((each) => each.record)).toEqual(['k1:1', 'k1:3'])
    expect(choice.now().said).toBe('Order k1:2 is no longer on this page, so not chosen. 2 chosen.')
  })

  // A row whose key fits no token, or that has no version, is no record a
  // run could address: no press chooses it, and Choose every record on
  // this page leaves it out; Clear the choice says nothing is chosen
  // (watched failing with every row chosen: "expected [ 'k1:1', 'k1:2',
  // 'k1:3', null ] to deeply equal [ 'k1:1', 'k1:2', 'k1:3' ]").
  test('holds only records a run could address, all of a page at once, and none once cleared', () => {
    const choice = createChosenRows('Order')
    choice.page(LIST, 0, PAGE)
    choice.toggle(PAGE[3] as GridRow)
    expect(choice.now().chosen.size).toBe(0)
    choice.all()
    expect([...choice.now().chosen]).toEqual(['k1:1', 'k1:2', 'k1:3'])
    expect(choice.now().said).toBe('3 chosen.')
    choice.clear()
    expect(choice.now()).toEqual({ chosen: new Set(), said: NONE_CHOSEN })
    expect(choice.name('k1:1')).toBe('Order k1:1')
  })
})
