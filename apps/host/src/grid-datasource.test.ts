import { describe, expect, test } from 'vitest'
import { answered, CANNOT_OPEN, columnsOf, listQuery, loading, rowsOf } from './grid-datasource.js'
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
    expect(answered({ start: 0, count: 50, hasMore: true, search: '', untokened: 0, canCreate: true })).toEqual({ text: 'Rows 1–50; more follow.', help: null, clear: false })
    expect(answered({ start: 50, count: 23, hasMore: false, search: '', untokened: 0, canCreate: true }).text).toBe('Rows 51–73.')
    expect(answered({ start: 0, count: 5, hasMore: false, search: '', untokened: 1, canCreate: true }).text).toBe('Rows 1–5. 1 of these rows cannot be opened.')
  })

  // Nothing at all, and nothing that matches: the second echoes what was
  // searched for and offers to clear it, so "No records." never reads as
  // an empty table when it is an empty search.
  test('tells no records from no match', () => {
    expect(answered({ start: 0, count: 0, hasMore: false, search: '', untokened: 0, canCreate: true })).toEqual({ text: 'No records.', help: 'New record starts the first one.', clear: false })
    expect(answered({ start: 0, count: 0, hasMore: false, search: '', untokened: 0, canCreate: false }).help).toBeNull()
    expect(answered({ start: 0, count: 0, hasMore: false, search: ' Zug ', untokened: 0, canCreate: true })).toEqual({ text: 'No records match “Zug”.', help: null, clear: true })
  })

  // A child grid's sentences name it, so a screen reader hears whose rows.
  test("names a child's rows", () => {
    expect(answered({ start: 0, count: 5, hasMore: false, search: '', untokened: 0, canCreate: true, noun: 'Order line' }).text).toBe('Order line rows 1–5.')
    expect(answered({ start: 0, count: 0, hasMore: false, search: '', untokened: 0, canCreate: true, noun: 'Order line' })).toEqual({ text: 'No Order line rows.', help: 'New Order line starts the first one.', clear: false })
    expect(loading(50, 50, 'Order line')).toBe('Loading Order line rows 51–100.')
    expect(loading(0, 50)).toBe('Loading rows 1–50.')
  })

  // A row whose key does not fit in a token cannot be opened; said in the
  // page's words, a click on it would otherwise do nothing a person can hear.
  test('says why a row without a token does not open', () => {
    expect(CANNOT_OPEN).toBe('This row cannot be opened: its key does not fit in a record token.')
  })
})

describe('what a grid asks for', () => {
  // The grid's own numbers become the route's: its sort model becomes the
  // sort, its start row the offset and the block the limit; the search is
  // the one submitted, never per keystroke.
  test('is the sort, the page and the parent the grid shows', () => {
    expect(listQuery({ search: 'Zug', sortModel: [{ colId: 'order_date', sort: 'desc' }], parent: null, startRow: 50, endRow: 100 })).toEqual({
      search: 'Zug',
      sort: [{ field: 'order_date', direction: 'desc' }],
      parent: null,
      offset: 50,
      limit: 50,
    })
    expect(listQuery({ search: '', sortModel: [], parent: { field: 'order', record: 'k1:1' }, startRow: 0, endRow: 50 }).parent).toEqual({ field: 'order', record: 'k1:1' })
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
})
