import { describe, expect, test } from 'vitest'
import { answered, CANNOT_OPEN, columnsOf, listQuery, loading, rowsOf, sortOfModel } from './grid-datasource.js'
import type { PublishedForm } from '@formancy/data-client'

/*
 * What a grid asks the runtime plane for, and what its status line says
 * about the answer (0047): derived from the page's numbers -- where the page
 * starts, how many rows came, whether more follow -- never typed per state,
 * so "Rows 51-100" cannot say one thing while the grid shows another.
 */

describe('the status line', () => {
  // A page, the last page, and a page some of whose rows have no token.
  test('says the range shown and whether more follow', () => {
    expect(answered({ start: 0, count: 50, hasMore: true, search: '', untokened: 0, canCreate: true })).toEqual({
      text: 'Rows 1–50; more follow.',
      help: null,
      clear: false,
    })
    expect(answered({ start: 50, count: 23, hasMore: false, search: '', untokened: 0, canCreate: true }).text).toBe('Rows 51–73.')
    expect(answered({ start: 0, count: 5, hasMore: false, search: '', untokened: 1, canCreate: true }).text).toBe('Rows 1–5. 1 of these rows cannot be opened.')
  })

  // Nothing at all, and nothing that matches: the second echoes what was
  // searched for and offers to clear it, so "No records." never reads as
  // an empty table when it is an empty search.
  test('tells no records from no match', () => {
    expect(answered({ start: 0, count: 0, hasMore: false, search: '', untokened: 0, canCreate: true })).toEqual({
      text: 'No records.',
      help: 'New record starts the first one.',
      clear: false,
    })
    expect(answered({ start: 0, count: 0, hasMore: false, search: '', untokened: 0, canCreate: false }).help).toBeNull()
    expect(answered({ start: 0, count: 0, hasMore: false, search: ' Zug ', untokened: 0, canCreate: true })).toEqual({
      text: 'No records match “Zug”.',
      help: null,
      clear: true,
    })
  })

  // A child grid's sentences name it, so a screen reader hears whose rows.
  test("names a child's rows", () => {
    expect(answered({ start: 0, count: 5, hasMore: false, search: '', untokened: 0, canCreate: true, noun: 'Order line' }).text).toBe('Order line rows 1–5.')
    expect(answered({ start: 0, count: 0, hasMore: false, search: '', untokened: 0, canCreate: true, noun: 'Order line' })).toEqual({
      text: 'No Order line rows.',
      help: 'New Order line starts the first one.',
      clear: false,
    })
    expect(loading(50, 50, 'Order line')).toBe('Loading Order line rows 51–100.')
    expect(loading(0, 50)).toBe('Loading rows 1–50.')
  })

  // A filtered list says so, naming the fields the filter is on, after the
  // range and before the rows that cannot be opened; and a filtered list
  // nothing matches names what narrowed it -- the filter, or the search and
  // the filter -- so it never reads as an empty table, and offers to clear
  // the search only where there is one (watched failing with the filter
  // left out of the sentence: "Rows 1–3." for a filtered page, and "No
  // records." for an empty one).
  test('says the filter is on, and by which fields', () => {
    const filtered = ['Notes', 'Amount']
    expect(answered({ start: 0, count: 3, hasMore: false, search: '', filtered, untokened: 1, canCreate: true }).text).toBe(
      'Rows 1–3. Filtered by Notes and Amount. 1 of these rows cannot be opened.',
    )
    expect(answered({ start: 50, count: 50, hasMore: true, search: '', filtered: ['Order date'], untokened: 0, canCreate: true }).text).toBe(
      'Rows 51–100; more follow. Filtered by Order date.',
    )
    expect(answered({ start: 0, count: 0, hasMore: false, search: '', filtered, untokened: 0, canCreate: true })).toEqual({
      text: 'No records match the filter on Notes and Amount.',
      help: null,
      clear: false,
    })
    expect(answered({ start: 0, count: 0, hasMore: false, search: 'Zug', filtered, untokened: 0, canCreate: true })).toEqual({
      text: 'No records match “Zug” and the filter on Notes and Amount.',
      help: null,
      clear: true,
    })
    expect(answered({ start: 0, count: 0, hasMore: false, search: '', filtered: ['Carrier'], untokened: 0, canCreate: true, noun: 'Delivery' })).toEqual({
      text: 'No Delivery rows match the filter on Carrier.',
      help: null,
      clear: false,
    })
    expect(answered({ start: 0, count: 2, hasMore: false, search: '', filtered: [], untokened: 0, canCreate: true }).text).toBe('Rows 1–2.')
  })

  // A row whose key does not fit in a token cannot be opened; said in the
  // page's words, a click on it would otherwise do nothing a person can hear.
  test('says why a row without a token does not open', () => {
    expect(CANNOT_OPEN).toBe('This row cannot be opened: its key does not fit in a record token.')
  })
})

describe('what a grid asks for', () => {
  // The grid's block becomes the route's: the cursor it continues after
  // (0108) and its size the limit; the sort is the section's, which the headers show
  // (0105); the search is the one submitted, never per keystroke, and the
  // filter the one applied, on every block, not only the first (watched
  // failing with the filter left out of the request: "filter": []).
  test('is the sort, the page, the parent and the filter the grid shows', () => {
    const filter = [
      { field: 'notes', op: 'contains' as const, text: 'Zug' },
      { field: 'amount', op: 'range' as const, from: '2', to: null },
    ]
    const sort = [
      { field: 'order_date', direction: 'desc' as const },
      { field: 'id', direction: 'asc' as const },
    ]
    expect(listQuery({ search: 'Zug', sort, parent: null, filter, after: 'c1:50', size: 50 })).toEqual({
      search: 'Zug',
      sort,
      parent: null,
      filter,
      after: 'c1:50',
      limit: 50,
    })
    expect(listQuery({ search: '', sort: [], parent: { field: 'order', record: 'k1:1' }, filter: [], after: null, size: 50 })).toMatchObject({
      parent: { field: 'order', record: 'k1:1' },
      filter: [],
      after: null,
    })
  })

  // AG Grid's sort model, in its order, is what the datasource holds to the
  // section's sort before it asks: a column and its direction each (watched
  // failing with the direction read as AG Grid's sort type: "direction":
  // undefined).
  test("reads AG Grid's sort model as a list request's sort", () => {
    expect(
      sortOfModel([
        { colId: 'amount', sort: 'desc' },
        { colId: 'id', sort: 'asc' },
      ]),
    ).toEqual([
      { field: 'amount', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ])
    expect(sortOfModel([])).toEqual([])
  })

  // A row's id is its token, so the page can find the open record's row;
  // a row with none gets one of its own, never null, in its place.
  test('gives every row an id, its token where it has one', () => {
    const rows = rowsOf(
      [
        { record: 'k1:1', version: '1', answers: { id: '1' } },
        { record: null, version: null, answers: { id: '2' } },
      ],
      100,
    )
    expect(rows.map((row) => row.id)).toEqual(['k1:1', 'row-101'])
  })
})

describe("a grid's columns", () => {
  const definition = {
    form: {
      specVersion: '3',
      id: 'pg-order-line',
      title: 'Order line',
      model: {
        fields: [
          { key: 'order', type: 'select', label: 'Order', optionsSource: 'pg-order-line.order' },
          { key: 'line_no', type: 'integer', label: 'Line' },
          { key: 'quantity', type: 'integer', label: 'Quantity' },
          { key: 'secret', type: 'text', label: 'Secret' },
        ],
      },
    },
    operations: ['read'],
    readable: ['order', 'line_no', 'quantity'],
    list: { searchable: ['line_no', 'quantity'], sortable: ['line_no'] },
  } as unknown as PublishedForm

  // One column per field the person may read, in the form's order, sortable
  // only where the server says a list may sort; a child grid leaves out the
  // field that points at its parent, which every row shares.
  test('are the readable fields, the parent left out of a child grid', () => {
    expect(columnsOf(definition, null).map((column) => [column.key, column.label, column.sortable, column.source])).toEqual([
      ['order', 'Order', false, 'pg-order-line.order'],
      ['line_no', 'Line', true, null],
      ['quantity', 'Quantity', false, null],
    ])
    expect(columnsOf(definition, 'order').map((column) => column.key)).toEqual(['line_no', 'quantity'])
  })

  // A label may be `{ $t }`, a reference into a catalogue the page cannot
  // read (0079): the column is headed by the key, as the export heads its
  // own, and not "[object Object]" (watched failing with `String(label)`).
  test('are headed by the key where the label is a message reference', () => {
    const referenced = {
      ...definition,
      form: { ...definition.form, model: { fields: [{ key: 'quantity', type: 'integer', label: { $t: 'line.quantity' } }] } },
      readable: ['quantity'],
    } as unknown as PublishedForm
    expect(columnsOf(referenced, null).map((column) => column.label)).toEqual(['quantity'])
  })
})
