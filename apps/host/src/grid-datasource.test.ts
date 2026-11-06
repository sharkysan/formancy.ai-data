import { describe, expect, test } from 'vitest'
import type { IGetRowsParams } from 'ag-grid-community'
import { answered, CANNOT_OPEN, columnsOf, createDatasource, listQuery, loading, rowsOf, sortOfModel } from './grid-datasource.js'
import type { DatasourceHooks, GridRow, ListClient } from './grid-datasource.js'
import type { Outcome, PublishedForm, RecordList, RecordListQuery } from '@formancy/data-client'

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

/**
 * A client that answers each list from `answers`, in turn, and keeps what it
 * was asked: the datasource's own decisions -- what it asks, and when it
 * asks nothing -- with no server. What the server answers is the page
 * suites' (workspace.test.tsx, held-rows.test.tsx), against the real one.
 */
function answering(answers: Array<Outcome<RecordList>>): { client: ListClient; asked: Array<Partial<RecordListQuery>> } {
  const asked: Array<Partial<RecordListQuery>> = []
  const client: ListClient = {
    list: (_formId, query = {}) => {
      asked.push(query)
      const answer = answers.shift()
      return answer === undefined ? Promise.reject(new Error('nothing more to answer')) : Promise.resolve(answer)
    },
    resolve: () => Promise.reject(new Error('no lookup column asks')),
  }
  return { client, asked }
}

const page = (ids: readonly number[], next: string | null): Outcome<RecordList> => ({
  ok: true,
  value: { rows: ids.map((id) => ({ record: `k1:${String(id)}`, version: '1', answers: { id: String(id) } })), hasMore: next !== null, next },
})

/** The hooks a datasource tells, each call kept by its name, and the list each says it came from. */
function told(): { hooks: DatasourceHooks; calls: Array<[string, ...unknown[]]>; from: unknown[] } {
  const calls: Array<[string, ...unknown[]]> = []
  const from: unknown[] = []
  return {
    calls,
    from,
    hooks: {
      loading: (start, end, ahead, source) => {
        calls.push(['loading', start, end, ahead])
        from.push(source)
      },
      answered: (start, rows, _hasMore, _filter, source) => {
        calls.push(['answered', start, rows.length])
        from.push(source)
      },
      refused: (message, code, ahead, source) => {
        calls.push(['refused', message, code, ahead])
        from.push(source)
      },
      restart: (source) => {
        calls.push(['restart'])
        from.push(source)
      },
    },
  }
}

/** A block as AG Grid asks for it, and what it was answered: the rows and the last row, or failed. */
function block(
  startRow: number,
  sortModel: IGetRowsParams['sortModel'] = [],
): { params: IGetRowsParams; got: { rows: GridRow[]; last: number | undefined } | 'failed' | null } {
  const at: { params: IGetRowsParams; got: { rows: GridRow[]; last: number | undefined } | 'failed' | null } = {
    got: null,
    params: {
      startRow,
      endRow: startRow + 50,
      sortModel,
      filterModel: {},
      context: undefined,
      successCallback: (rows, last) => {
        at.got = { rows: rows as GridRow[], last }
      },
      failCallback: () => {
        at.got = 'failed'
      },
      // The grid's API, which the datasource never reads.
    } as IGetRowsParams,
  }
  return at
}

/** Every promise the datasource has chained, settled. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const COLUMNS = [{ key: 'id', label: 'Id', sortable: true, source: null }]

function datasource(client: ListClient, hooks: DatasourceHooks): ReturnType<typeof createDatasource> {
  return createDatasource({ client, formId: 'pg-order', columns: COLUMNS, search: '', parent: null, filter: [], sort: [], hooks })
}

describe('the rows on screen while the next are asked for (0146)', () => {
  // Next rows asks the server before AG Grid is shown the page, so the rows
  // shown stay until it answers: the page asked for after the row the page
  // before ended with, and then given to the grid from that one answer --
  // asked twice, the server would list the page again and the grid would
  // blank while it did (watched failing with the kept answer ignored: two
  // requests for rows 51-100, and the grid's block unanswered until the
  // second came).
  test('asks for a page first, once, and the grid takes that answer', async () => {
    // A page that has more after it is a whole page: the next starts at row 50.
    const whole = Array.from({ length: 50 }, (_, index) => index + 1)
    const { client, asked } = answering([page(whole, 'c1:50'), page([51], null)])
    const { hooks, calls } = told()
    const source = datasource(client, hooks)
    const first = block(0)
    source.getRows(first.params)
    await settled()
    expect(first.got).toMatchObject({ last: undefined })
    expect(await source.askFirst(50, 100)).toBe('ready')
    expect(asked.map((query) => query.after)).toEqual([null, 'c1:50'])
    // Asked, not shown: the grid has not taken the rows, so the line has not said them.
    expect(calls.map(([name]) => name)).toEqual(['loading', 'answered', 'loading'])
    expect(calls[2]).toEqual(['loading', 50, 100, true])
    const second = block(50)
    source.getRows(second.params)
    expect(second.got).toMatchObject({ rows: [{ record: 'k1:51' }], last: 51 })
    expect(asked).toHaveLength(2)
    expect(calls.at(-1)).toEqual(['answered', 50, 1])
  })

  // What was asked first is the grid's once: a page asked for again -- after
  // a save, a delete or Ask again -- asks the server, never shows the rows
  // it showed before (watched failing with the answer kept after it was
  // taken: the second block was answered with the first answer's rows,
  // and nothing was asked).
  test('gives the grid what it asked first once, and asks again after', async () => {
    const { client, asked } = answering([page([1], null), page([2], null)])
    const { hooks } = told()
    const source = datasource(client, hooks)
    expect(await source.askFirst(0, 50)).toBe('ready')
    source.getRows(block(0).params)
    const again = block(0)
    source.getRows(again.params)
    await settled()
    expect(asked).toHaveLength(2)
    expect(again.got).toMatchObject({ rows: [{ record: 'k1:2' }] })
  })

  // A header pressed, or a view's sort shown on the headers, starts AG Grid's
  // list again under an order this list is not in, before the section's new
  // list has answered: the rows on screen are the answer, asking nothing, so
  // the grid keeps them, dimmed, until the new list's first page replaces
  // them (watched failing with that block failed, as before 0146: the grid
  // was left with no rows).
  test('answers a block asked under another order with the rows on screen, asking nothing', async () => {
    const { client, asked } = answering([page([1, 2], null)])
    const { hooks, calls } = told()
    const source = datasource(client, hooks)
    source.getRows(block(0).params)
    await settled()
    const resorted = block(0, [{ colId: 'id', sort: 'desc' }])
    source.getRows(resorted.params)
    expect(resorted.got).toMatchObject({ rows: [{ record: 'k1:1' }, { record: 'k1:2' }], last: 2 })
    expect(asked).toHaveLength(1)
    expect(calls).toHaveLength(2)
  })

  // Rows on screen that had more after them are answered as having more:
  // answered as the last, AG Grid would count one page and clamp the next
  // page turned to back to it, and never ask for it (watched failing with
  // their count given as the last row: 50).
  test('answers the rows on screen as having more where they had', async () => {
    const whole = Array.from({ length: 50 }, (_, index) => index + 1)
    const { client } = answering([page(whole, 'c1:50')])
    const source = datasource(client, told().hooks)
    source.getRows(block(0).params)
    await settled()
    const resorted = block(0, [{ colId: 'id', sort: 'desc' }])
    source.getRows(resorted.params)
    expect(resorted.got).toMatchObject({ last: undefined })
  })

  // A page asked first that AG Grid was never moved to is dropped, so a
  // block it asks for later at that row asks the server, never shows rows
  // from before (watched failing with the drop doing nothing: the kept
  // rows answered it, and nothing was asked).
  test('drops a page asked first, and asks the server for that block after', async () => {
    const whole = Array.from({ length: 50 }, (_, index) => index + 1)
    const { client, asked } = answering([page(whole, 'c1:50'), page([51], null), page([52], null)])
    const source = datasource(client, told().hooks)
    source.getRows(block(0).params)
    await settled()
    expect(await source.askFirst(50, 100)).toBe('ready')
    source.drop()
    const later = block(50)
    source.getRows(later.params)
    await settled()
    expect({ asked: asked.length, got: later.got }).toMatchObject({ asked: 3, got: { rows: [{ record: 'k1:52' }] } })
  })

  // Every hook says which list it comes from, so the grid can hear the list
  // shown and the list asked for and no other (use-held-rows.ts) (watched
  // failing with the list left unsaid: undefined).
  test('says which list each word comes from', async () => {
    const { client } = answering([page([1], null), { ok: false, status: 503, code: 'unavailable', message: 'The database cannot be reached.' }])
    const { hooks, from } = told()
    const source = datasource(client, hooks)
    source.getRows(block(0).params)
    await settled()
    await source.askFirst(0, 50)
    expect(from).toEqual([source, source, source, source])
  })

  // A page asked first that the server refuses is said as one asked first --
  // the rows on screen are still there, so the grid neither forgets them nor
  // shrinks to none -- and nothing of it is kept for the grid (watched
  // failing with the refusal told as the grid's own: `ahead` false).
  test('says a refusal of a page asked first as one, and keeps nothing of it', async () => {
    const { client, asked } = answering([{ ok: false, status: 503, code: 'unavailable', message: 'The database cannot be reached.' }, page([1], null)])
    const { hooks, calls } = told()
    const source = datasource(client, hooks)
    expect(await source.askFirst(0, 50)).toBe('refused')
    expect(calls.at(-1)).toEqual(['refused', 'The database cannot be reached.', 'unavailable', true])
    const after = block(0)
    source.getRows(after.params)
    await settled()
    expect(asked).toHaveLength(2)
    expect(after.got).toMatchObject({ rows: [{ record: 'k1:1' }] })
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
          { key: 'line_no', type: 'number', label: 'Line' },
          { key: 'quantity', type: 'number', label: 'Quantity' },
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
