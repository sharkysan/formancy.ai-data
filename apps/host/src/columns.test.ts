import { describe, expect, test } from 'vitest'
import type { ListColumns, ListFilterTerm, ListView } from '@formancy/data-client'
import { arrange, defaultChoices, keptOf, mergeChoices, moveChoice, openGrid, parseKept, showChoice } from './columns.js'
import type { ColumnChoice, GridState, KeptGrid } from './columns.js'
import type { GridColumn } from './grid-datasource.js'

/*
 * A grid's columns as a person arranges them, and what one viewer's browser
 * keeps of a grid (0106), as data: what a kept arrangement becomes over the
 * columns a form offers now, which values the reader takes, what is written
 * for a view, a sort and a filter of the person's own, and what a section
 * opens on. Pure; columns-panel.test.tsx and remembered.test.tsx hold the
 * page to the real server on both engines.
 */

const column = (key: string, label: string, sortable = true): GridColumn => ({ key, label, sortable, source: null })
const COLUMNS = [column('id', 'Id'), column('customer', 'Customer', false), column('order_date', 'Order date'), column('amount', 'Amount'), column('notes', 'Notes')]
const choice = (field: string, shown = true): ColumnChoice => ({ field, shown })

const NEWEST: ListView = { name: 'Newest first', filter: [], sort: [{ field: 'id', direction: 'desc' }], default: true }
const LARGE: ListView = { name: 'Large orders', filter: [{ field: 'amount', op: 'range', from: '1000', to: null }], sort: [{ field: 'amount', direction: 'desc' }] }
const LIST: ListColumns = { searchable: ['notes'], sortable: ['id', 'order_date', 'amount', 'notes'], filterable: [], views: [NEWEST, LARGE] }

describe('a kept arrangement over the columns a form offers now', () => {
  // The form changes under what was kept: a column dropped from the policy
  // or the form, one added. A kept field the form no longer offers drawn
  // would be a column the server never fills; a new one left out, one the
  // person never chose to hide (watched failing with the fields no longer
  // offered kept: "status" in the arrangement; and with the new ones not
  // appended: three columns where the form offers five).
  test('drops the columns no longer offered and appends the new ones, shown, in the form’s order', () => {
    const kept = [choice('amount'), choice('status'), choice('id', false), choice('customer')]
    expect(mergeChoices(kept, COLUMNS)).toEqual([choice('amount'), choice('id', false), choice('customer'), choice('order_date'), choice('notes')])
  })

  // A kept arrangement whose shown columns have all gone leaves a grid of
  // the columns added since, or none: nobody chose that, so the form's own
  // is used, and is not the person's to keep (watched failing with the
  // merge never giving way: Customer, Order date and Notes alone shown,
  // which nobody chose).
  test('gives way to the form’s columns when none of the kept ones is shown', () => {
    expect(mergeChoices([choice('status'), choice('id', false), choice('amount', false)], COLUMNS)).toBeNull()
    expect(arrange(COLUMNS, [choice('status'), choice('id', false)]).map(({ key, shown }) => [key, shown])).toEqual(COLUMNS.map(({ key }) => [key, true]))
    const opened = openGrid({ version: 1, columns: [choice('status'), choice('id', false)] }, COLUMNS, LIST)
    expect({ choices: opened.choices, columnsKept: opened.columnsKept }).toEqual({ choices: defaultChoices(COLUMNS), columnsKept: false })
  })
})

describe('a column moved or shown', () => {
  // One place, the neighbour taking the other; at an end the same
  // arrangement, by identity, so the panel sends nothing to keep (watched
  // failing with a move at the top wrapped round to the end).
  test('moves one place, and not past either end', () => {
    const choices = defaultChoices(COLUMNS)
    expect(moveChoice(choices, 'amount', -1).map((each) => each.field)).toEqual(['id', 'customer', 'amount', 'order_date', 'notes'])
    expect(moveChoice(choices, 'amount', 1).map((each) => each.field)).toEqual(['id', 'customer', 'order_date', 'notes', 'amount'])
    expect(moveChoice(choices, 'id', -1)).toBe(choices)
    expect(moveChoice(choices, 'notes', 1)).toBe(choices)
  })

  // A row is opened through its cells: a grid with no column shown has none
  // to open it through, so hiding the last shown column is no change at
  // all, whichever column it is (watched failing with every hide applied:
  // nothing shown).
  test('hides any column but the last shown', () => {
    const one = [choice('id', false), choice('amount'), choice('notes', false)]
    expect(showChoice(one, 'amount', false)).toBe(one)
    expect(showChoice(one, 'notes', true)).toEqual([choice('id', false), choice('amount'), choice('notes')])
    expect(showChoice(showChoice(one, 'notes', true), 'amount', false)).toEqual([choice('id', false), choice('amount', false), choice('notes')])
  })
})

describe('the value a browser keeps', () => {
  // Every shape this release writes is read back as written.
  test('is read back in each shape it is written in', () => {
    const values: KeptGrid[] = [
      { version: 1, columns: [choice('notes'), choice('id', false)] },
      { version: 1, view: 'Large orders' },
      { version: 1, columns: [choice('id')], sort: [{ field: 'amount', direction: 'asc' }] },
      { version: 1, sort: [] },
    ]
    for (const value of values) expect(parseKept(JSON.stringify(value))).toEqual(value)
  })

  // Anything else -- another release's, a hand edit, a value cut short --
  // is nothing kept, never half of one: a field twice would draw a column
  // twice, a sort on a field twice is refused by the server (0105), and a
  // view and a sort at once says two lists (watched failing with each check
  // taken out in turn: the shape it guards read back -- or, for a sort that
  // is not an array, "sort.every is not a function").
  test('refuses anything but exactly that shape, as nothing kept', () => {
    const refused = [
      null,
      'not json',
      '[]',
      'null',
      '{"columns":[{"field":"id","shown":true}]}',
      '{"version":2}',
      '{"version":"1"}',
      '{"version":1,"filter":[{"field":"notes","op":"contains","text":"secret"}]}',
      '{"version":1,"columns":{"id":true}}',
      '{"version":1,"columns":[{"field":"id","shown":"yes"}]}',
      '{"version":1,"columns":[{"field":"","shown":true}]}',
      '{"version":1,"columns":[{"field":"id","shown":true,"width":120}]}',
      '{"version":1,"columns":[{"field":"id","shown":true},{"field":"id","shown":false}]}',
      '{"version":1,"view":""}',
      '{"version":1,"view":3}',
      '{"version":1,"sort":[{"field":"id","direction":"up"}]}',
      '{"version":1,"sort":[{"field":"id","direction":"asc"},{"field":"id","direction":"desc"}]}',
      '{"version":1,"sort":{"field":"id","direction":"asc"}}',
      '{"version":1,"view":"Large orders","sort":[]}',
    ]
    for (const text of refused) expect({ text, read: parseKept(text) }).toEqual({ text, read: null })
  })
})

describe('what is written for a list', () => {
  const state = (filter: ListFilterTerm[], sort: GridState['sort'], kept: Partial<GridState> = {}): GridState => ({ choices: defaultChoices(COLUMNS), filter, sort, columnsKept: false, listKept: true, ...kept })

  // A view is kept by its name, so an administrator's change to it reaches
  // the person (watched failing with the view's sort kept instead:
  // "sort" and no "view").
  test('a view is kept by its name', () => {
    expect(keptOf(state(LARGE.filter, LARGE.sort), LIST.views)).toEqual({ version: 1, view: LARGE.name })
  })

  // No filter: the sort as it is, `[]` included, which is "All records"
  // and must outlast a default view (watched failing with an empty sort
  // left unwritten: { version: 1 }, and no list kept).
  test('an empty filter keeps its sort, an empty one too', () => {
    expect(keptOf(state([], [{ field: 'notes', direction: 'asc' }]), LIST.views)).toEqual({ version: 1, sort: [{ field: 'notes', direction: 'asc' }] })
    expect(keptOf(state([], []), LIST.views)).toEqual({ version: 1, sort: [] })
  })

  // A filter of the person's own is never written: no value typed into it
  // reaches storage (0104), only the sort (watched failing with the filter
  // written beside the sort: the filter, and "secret" in it, kept).
  test('a filter of the person’s own keeps its sort alone, and no typed value', () => {
    const own: ListFilterTerm[] = [{ field: 'notes', op: 'contains', text: 'secret' }, ...LARGE.filter]
    const kept = keptOf(state(own, LARGE.sort), LIST.views)
    expect(kept).toEqual({ version: 1, sort: LARGE.sort })
    expect(JSON.stringify(kept)).not.toMatch(/secret|1000/)
  })

  // What the person never chose is not kept: an opening on the default
  // view writes nothing, so the form's default stays the form's, and Reset
  // columns forgets the columns but not the list (watched failing with
  // the list written whatever: "view": "Newest first" kept for a person
  // who only moved a column).
  test('keeps only what the person chose', () => {
    expect(keptOf(state(NEWEST.filter, NEWEST.sort, { listKept: false }), LIST.views)).toBeNull()
    const moved = [choice('notes'), ...defaultChoices(COLUMNS).slice(0, -1)]
    expect(keptOf(state(NEWEST.filter, NEWEST.sort, { listKept: false, columnsKept: true, choices: moved }), LIST.views)).toEqual({ version: 1, columns: moved })
    expect(keptOf(state([], [], { columnsKept: false }), LIST.views)).toEqual({ version: 1, sort: [] })
  })
})

describe('what a section opens on', () => {
  // Nothing kept: the default view (0105), the form's columns, nothing
  // the person's.
  test('opens on the default view when nothing is kept', () => {
    expect(openGrid(null, COLUMNS, LIST)).toEqual({ choices: defaultChoices(COLUMNS), filter: [], sort: NEWEST.sort, columnsKept: false, listKept: false })
  })

  // A view kept by a name still offered is that view; one no longer
  // offered -- renamed, removed, or on a field this person may no longer
  // read -- is the default view, and no longer the person's (watched
  // failing with the kept name looked for nowhere: the default view for
  // "Large orders").
  test('opens on a kept view still offered, and on the default otherwise', () => {
    expect(openGrid({ version: 1, view: LARGE.name }, COLUMNS, LIST)).toMatchObject({ filter: LARGE.filter, sort: LARGE.sort, listKept: true })
    expect(openGrid({ version: 1, view: 'Gone' }, COLUMNS, LIST)).toMatchObject({ filter: [], sort: NEWEST.sort, listKept: false })
  })

  // A kept sort opens with no filter, its terms that are still sortable
  // kept and the others dropped, which the server would refuse; `[]` is
  // "All records" over the default view (watched failing with the kept
  // sort sent as kept: "status", which the list no longer sorts by; and
  // with an empty sort taken as nothing kept: the default view's).
  test('opens on a kept sort’s terms that are still sortable, with no filter', () => {
    const kept: KeptGrid = { version: 1, sort: [{ field: 'status', direction: 'asc' }, { field: 'amount', direction: 'desc' }] }
    expect(openGrid(kept, COLUMNS, LIST)).toMatchObject({ filter: [], sort: [{ field: 'amount', direction: 'desc' }], listKept: true })
    expect(openGrid({ version: 1, sort: [] }, COLUMNS, LIST)).toMatchObject({ filter: [], sort: [], listKept: true })
    expect(openGrid({ version: 1, sort: [{ field: 'amount', direction: 'desc' }] }, COLUMNS, null)).toMatchObject({ filter: [], sort: [] })
  })
})
