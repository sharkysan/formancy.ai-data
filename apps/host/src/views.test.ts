import { describe, expect, test } from 'vitest'
import type { ListFilterTerm, ListSortTerm, ListView } from '@formancy/data-client'
import { openingView, sameSort, viewMatching } from './views.js'

/*
 * Which of a form's list views (0105) a grid's filter and sort are, and
 * which one a grid opens on: the picker's selection is derived from these
 * and never stored, so what it says and what the grid lists cannot part.
 * Pure; view-picker.test.tsx holds the picker to the real server on both
 * engines.
 */

const LARGE: ListView = {
  name: 'Large orders',
  filter: [{ field: 'amount', op: 'range', from: '1000', to: null }],
  sort: [{ field: 'amount', direction: 'desc' }],
}
const PLACED: ListView = {
  name: 'North, by date',
  filter: [
    { field: 'notes', op: 'contains', text: 'Zug' },
    { field: 'group', op: 'equals', value: 'North' },
  ],
  sort: [
    { field: 'order_date', direction: 'asc' },
    { field: 'id', direction: 'desc' },
  ],
  default: true,
}
const VIEWS = [LARGE, PLACED]

describe('the view a filter and a sort are', () => {
  // A filter is a set of conditions, one per field (0104): the panel lists
  // them in the order they were applied, so a person who applies a view's
  // conditions in another order has built that view (watched failing with
  // the filters compared as lists: null for the reordered conditions).
  test('compares the filter as a set by field', () => {
    const reordered = [PLACED.filter[1], PLACED.filter[0]] as ListFilterTerm[]
    expect(viewMatching(VIEWS, reordered, PLACED.sort)).toBe(PLACED)
    expect(viewMatching(VIEWS, LARGE.filter, LARGE.sort)).toBe(LARGE)
  })

  // A condition is the whole term: another bound, another operator, a
  // contains in another case or with a space the panel sends as typed is
  // another request, so "Your own filter and sort" and not the view, whose
  // list could differ (watched failing with the terms compared by field and
  // operator alone: LARGE for a range from 999).
  test('compares each condition whole', () => {
    expect(viewMatching(VIEWS, [{ field: 'amount', op: 'range', from: '999', to: null }], LARGE.sort)).toBeNull()
    expect(viewMatching(VIEWS, [{ field: 'amount', op: 'range', from: '1000', to: '5000' }], LARGE.sort)).toBeNull()
    expect(viewMatching(VIEWS, [{ field: 'amount', op: 'equals', value: '1000' }], LARGE.sort)).toBeNull()
    expect(viewMatching(VIEWS, [PLACED.filter[0] as ListFilterTerm, { field: 'notes', op: 'contains', text: 'zug' }], PLACED.sort)).toBeNull()
    expect(viewMatching(VIEWS, [PLACED.filter[0] as ListFilterTerm, { field: 'notes', op: 'contains', text: 'Zug ' }], PLACED.sort)).toBeNull()
  })

  // A condition more or fewer than the view's is not the view: the list is
  // narrower or wider than its name says -- whichever field the extra one
  // is on -- and a field twice is no filter a request carries, never a
  // view's (watched failing with only the view's conditions looked for in
  // the filter: PLACED for PLACED plus one more; and with the lengths left
  // uncompared: PLACED plus a condition on status, which sorts after both
  // of its own).
  test('holds every condition of the view and no other', () => {
    expect(viewMatching(VIEWS, [...PLACED.filter, { field: 'amount', op: 'null' }], PLACED.sort)).toBeNull()
    expect(viewMatching(VIEWS, [...PLACED.filter, { field: 'status', op: 'equals', value: 'placed' }], PLACED.sort)).toBeNull()
    expect(viewMatching(VIEWS, PLACED.filter.slice(0, 1), PLACED.sort)).toBeNull()
    expect(viewMatching(VIEWS, [PLACED.filter[0], PLACED.filter[0]] as ListFilterTerm[], PLACED.sort)).toBeNull()
  })

  // The sort is an order: by date then id is not by id then date, nor by
  // date alone, nor by date the other way (watched failing with the sorts
  // compared as sets: PLACED for its sort reversed).
  test('compares the sort in order, each direction', () => {
    expect(viewMatching(VIEWS, PLACED.filter, [...PLACED.sort].reverse())).toBeNull()
    expect(viewMatching(VIEWS, PLACED.filter, PLACED.sort.slice(0, 1))).toBeNull()
    expect(viewMatching(VIEWS, PLACED.filter, [{ field: 'order_date', direction: 'desc' }, PLACED.sort[1] as ListSortTerm])).toBeNull()
    expect(viewMatching(VIEWS, LARGE.filter, [])).toBeNull()
  })

  // Nothing applied is "All records", never a view: a view says something
  // (0105 refuses one that says nothing), and a form with no views has
  // none to match.
  test('is none for nothing applied, or a form with no views', () => {
    expect(viewMatching(VIEWS, [], [])).toBeNull()
    expect(viewMatching([], LARGE.filter, LARGE.sort)).toBeNull()
  })

  // What the grid and its datasource decide by too: equal sorts are equal
  // in order and direction, and the empty sort is the empty sort.
  test('says two sorts are one when they are in order and direction', () => {
    expect(sameSort([], [])).toBe(true)
    expect(
      sameSort(
        PLACED.sort,
        PLACED.sort.map((term) => ({ ...term })),
      ),
    ).toBe(true)
    expect(sameSort(PLACED.sort, [...PLACED.sort].reverse())).toBe(false)
    expect(sameSort(LARGE.sort, [{ field: 'amount', direction: 'asc' }])).toBe(false)
  })
})

describe('the view a grid opens on', () => {
  // The one view marked default, as the server offered it; none when the
  // server offered none with the mark -- a default on a field this person
  // may not read is withheld with its view, and the grid opens on every
  // record (watched failing with the first view taken: LARGE for a form
  // whose default was withheld).
  test('is the default the server offered, or none', () => {
    expect(openingView(VIEWS)).toBe(PLACED)
    expect(openingView([LARGE])).toBeNull()
    expect(openingView([])).toBeNull()
  })
})
