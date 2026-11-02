import { describe, expect, test } from 'vitest'
import type { ListView } from '../runtime.js'
import { listColumns } from './list.js'
import { OWN_VIEWS_LIMIT, ownViewsProblems, readOwnView, removedOwnView, savedOwnView } from './own-views.js'
import { CLERK_FIELDS, PG_ORDER } from './test-support.js'

/*
 * A person's own list views (0126), as data: read from what a page sends,
 * fitted to what the person's list offers them, saved among theirs and
 * removed, and read back from the server's file. Over the order form's
 * bindings and the clerk's readable fields, as the views' own cases are.
 */

const PLACED: ListView = { name: 'Placed', filter: [{ field: 'status', op: 'equals', value: 'placed' }], sort: [] }
const LARGE: ListView = {
  name: 'Large',
  filter: [{ field: 'amount', op: 'range', from: '1000', to: null }],
  sort: [{ field: 'order_date', direction: 'desc' }],
}
const COLUMNS = listColumns(PG_ORDER, CLERK_FIELDS, [])

describe('readOwnView', () => {
  // What a page sends is read as a list request reads it, so a view saved
  // is one the list route would run: a contains trimmed, as the route
  // trims it. Watched failing with the filter kept as sent: the stored
  // contains had its spaces.
  test('reads { name, filter, sort } as a list request reads them', () => {
    expect(readOwnView(PLACED)).toEqual({ ok: true, view: PLACED })
    expect(readOwnView({ name: 'Noted', filter: [{ field: 'notes', op: 'contains', text: ' rush ' }], sort: [] })).toEqual({
      ok: true,
      view: { name: 'Noted', filter: [{ field: 'notes', op: 'contains', text: 'rush' }], sort: [] },
    })
  })

  // Each refusal is something a page could send that no picker could show
  // or no list request could carry; a default or roles are how an
  // administrator offers a view to others, never a person's own.
  test('refuses anything else, in words for the person', () => {
    expect(readOwnView({ ...PLACED, default: true })).toEqual({
      ok: false,
      message: 'A view is { name, filter, sort } and nothing else: default is not one of them.',
    })
    expect(readOwnView({ ...PLACED, name: ' ' })).toEqual({ ok: false, message: "A view's name needs words a person can read." })
    expect(readOwnView({ ...PLACED, name: 'x'.repeat(81) })).toEqual({ ok: false, message: "A view's name is at most 80 characters." })
    expect(readOwnView({ name: 'Placed', sort: [] })).toEqual({ ok: false, message: 'The filter is a list of { field, op, … }.' })
    expect(readOwnView({ name: 'Placed', filter: [] })).toEqual({ ok: false, message: 'The sort is a list of { field, direction }.' })
    expect(readOwnView({ name: 'Nothing', filter: [], sort: [] })).toEqual({
      ok: false,
      message: 'A view with no condition and no sort is every record: All records is that already.',
    })
    expect(readOwnView({ ...PLACED, filter: [{ field: 'status', op: 'equals', value: { today: 0 } }] }).ok).toBe(false)
  })
})

describe('savedOwnView', () => {
  // A view is saved last, and saved again under its name -- case aside --
  // in its place, so a person corrects one without reordering theirs.
  // Watched failing with every save appended: "placed" was a second view.
  test('saves a view last, and in place of theirs named alike', () => {
    const saved = savedOwnView([PLACED], LARGE, PG_ORDER, COLUMNS)
    expect(saved).toEqual({ ok: true, views: [PLACED, LARGE] })
    const again = { ...PLACED, name: 'placed', sort: [{ field: 'amount', direction: 'asc' as const }] }
    expect(savedOwnView([PLACED, LARGE], again, PG_ORDER, COLUMNS)).toEqual({ ok: true, views: [again, LARGE] })
  })

  // A view of theirs is what their own list could run: a field they may
  // not read, or one the list cannot sort by, is refused in the words a
  // write of an administrator's view is (0105). Watched failing with no
  // fit: the auditor's view on an amount they may not read was saved.
  test('refuses a view their list could not run', () => {
    const auditor = listColumns(PG_ORDER, ['id', 'order_date', 'status'], [])
    expect(savedOwnView([], LARGE, PG_ORDER, auditor)).toEqual({ ok: false, message: 'amount is not a field this list is filtered by.' })
  })

  // Two choices a picker could not tell apart: one asking what a view the
  // form offers them asks, whatever its name, or what another of theirs
  // asks. Watched failing with the asks unread: the second "Placed" was
  // saved under another name.
  test('refuses a view asking what an offered view or another of theirs asks', () => {
    const offered = listColumns(PG_ORDER, CLERK_FIELDS, [{ ...PLACED, name: 'Open orders' }])
    expect(savedOwnView([], { ...PLACED, name: 'Mine' }, PG_ORDER, offered)).toEqual({
      ok: false,
      message: 'It asks what the view “Open orders” asks: pick that one.',
    })
    expect(savedOwnView([PLACED], { ...PLACED, name: 'Again' }, PG_ORDER, COLUMNS)).toEqual({ ok: false, message: 'It asks what your view “Placed” asks.' })
  })

  // The limit counts views, so one saved again in its place is never the
  // one past it. Watched failing with the limit asked before the name: a
  // full list refused a correction.
  test('keeps at most the limit, and a view saved again in its place is not one more', () => {
    const full: ListView[] = Array.from({ length: OWN_VIEWS_LIMIT }, (_, index) => ({
      name: `View ${String(index)}`,
      filter: [{ field: 'id', op: 'equals', value: String(index + 1) }],
      sort: [],
    }))
    expect(savedOwnView(full, LARGE, PG_ORDER, COLUMNS)).toEqual({
      ok: false,
      message: `You keep ${String(OWN_VIEWS_LIMIT)} views of this form: remove one first.`,
    })
    expect(savedOwnView(full, { ...LARGE, name: 'view 3' }, PG_ORDER, COLUMNS).ok).toBe(true)
  })
})

describe('removedOwnView', () => {
  // Named as the picker shows it, case aside; a name that is not theirs
  // leaves them as they were, so a remove sent twice answers alike.
  test('removes theirs named alike, and nothing where none is', () => {
    expect(removedOwnView([PLACED, LARGE], 'PLACED')).toEqual([LARGE])
    expect(removedOwnView([LARGE], 'Placed')).toEqual([LARGE])
  })
})

describe('listColumns, own', () => {
  // Offered again only while their list could run it: a view on a field
  // they may no longer read is not offered, and not offered without that
  // condition. Watched failing with own passed through unfitted.
  test('offers a person their views their list could run, in their order', () => {
    expect(listColumns(PG_ORDER, CLERK_FIELDS, [], [], [LARGE, PLACED]).own).toEqual([LARGE, PLACED])
    expect(listColumns(PG_ORDER, ['id', 'order_date', 'status'], [], [], [LARGE, PLACED]).own).toEqual([PLACED])
  })
})

describe('ownViewsProblems', () => {
  // The file is the server's own, written from what these functions
  // return: read back, anything else is damage, and nothing is offered
  // from it. Watched failing with the views read without their names
  // compared: two "Placed" were offered.
  test('reads back what is written, and nothing else', () => {
    expect(ownViewsProblems({ views: [PLACED, LARGE] })).toEqual([])
    expect(ownViewsProblems({ views: [] })).toEqual([])
    expect(ownViewsProblems([PLACED])).toEqual(['a person’s views are { views: [ … ] } and nothing else'])
    expect(ownViewsProblems({ views: [PLACED, { ...LARGE, name: 'placed' }] })).toEqual(['/views/1: “placed” is another view’s name'])
    expect(ownViewsProblems({ views: [{ ...PLACED, filter: [{ field: 'notes', op: 'contains', text: ' x ' }] }] })).toEqual([
      '/views/0: not as a view is stored',
    ])
    expect(ownViewsProblems({ views: Array.from({ length: OWN_VIEWS_LIMIT + 1 }, (_, index) => ({ ...PLACED, name: String(index) })) })).toContain(
      `more than ${String(OWN_VIEWS_LIMIT)} views`,
    )
  })
})
