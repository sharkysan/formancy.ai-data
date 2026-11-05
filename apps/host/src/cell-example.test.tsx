import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { AgGridReact } from 'ag-grid-react'
import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { LineField, ListFilterTerm } from '@formancy/data-client'
import { exampleTerm, filterByExample } from './cell-example.js'
import type { ArrangedColumn } from './columns.js'
import type { GridRow } from './grid-datasource.js'
import { columnDefsOf, gridOptionsFor } from './grid-options.js'
import { HeaderFilterContext } from './header-filter.js'
import type { HeaderFilters } from './header-filter.js'

/*
 * Filter by example (0133), without a server: a cell's value made the
 * condition on its column, by `=` on the cell or by the button the cell
 * shows while it has the keyboard. What the server lists for it is the
 * page's against it (filter-line.test.tsx).
 */

afterEach(cleanup)

const STATUS: LineField = { field: 'status', label: 'Status', operators: ['equals', 'contains', 'null', 'not-null'], input: 'text' }
const AMOUNT: LineField = { field: 'amount', label: 'Amount', operators: ['equals', 'range'], input: 'decimal' }
const RUSH: LineField = { field: 'rush', label: 'Rush', operators: ['equals', 'null', 'not-null'], input: 'boolean' }
const CREATED: LineField = { field: 'created_at', label: 'Created at', operators: ['range', 'null', 'not-null'], input: 'date' }
const FIELDS = [STATUS, AMOUNT, RUSH, CREATED]

const row = (answers: Record<string, unknown>, labels: Record<string, string> = {}): GridRow => ({ id: 'k1:1', record: 'k1:1', version: null, answers, labels })

describe('exampleTerm', () => {
  // A value the line could say is equal to it, spelled as the row holds
  // it; none where the column offers no equality -- a timestamp's days --
  // or where the cell shows a lookup's label rather than its value, which
  // equality on the column would not find (watched failing with the label
  // taken for the value).
  test('says the condition a value puts on its column, or none', () => {
    expect(exampleTerm(row({ status: 'placed' }), STATUS)).toEqual({ field: 'status', op: 'equals', value: 'placed' })
    expect(exampleTerm(row({ amount: 1000.5 }), AMOUNT)).toEqual({ field: 'amount', op: 'equals', value: '1000.5' })
    expect(exampleTerm(row({ rush: true }), RUSH)).toEqual({ field: 'rush', op: 'equals', value: 'true' })
    expect(exampleTerm(row({ status: null }), STATUS)).toEqual({ field: 'status', op: 'null' })
    expect(exampleTerm(row({ amount: null }), AMOUNT)).toBeNull()
    expect(exampleTerm(row({ created_at: '2026-11-05T10:00:00Z' }), CREATED)).toBeNull()
    expect(exampleTerm(row({ status: 'k2:9' }, { status: 'Placed by Clara' }), STATUS)).toBeNull()
  })

  // The example takes the column's place in the filter, as a header box
  // does, so a person can point at one value after another.
  test('replaces the condition the column had', () => {
    const sent: ListFilterTerm[][] = []
    const headers: HeaderFilters = {
      fields: FIELDS,
      filter: [
        { field: 'status', op: 'equals', value: 'shipped' },
        { field: 'amount', op: 'range', from: '1', to: null },
      ],
      onFilter: (next) => sent.push(next),
      refused: () => {},
    }
    expect(filterByExample(headers, row({ status: 'placed' }), 'status')).toBe(true)
    expect(sent).toEqual([
      [
        { field: 'status', op: 'equals', value: 'placed' },
        { field: 'amount', op: 'range', from: '1', to: null },
      ],
    ])
    expect(filterByExample(headers, row({ created_at: '2026-11-05T10:00:00Z' }), 'created_at')).toBe(false)
  })
})

const column = (key: string, label: string): ArrangedColumn => ({ key, label, sortable: false, source: null, shown: true })
const ROWS = [row({ id: 7, status: 'placed', amount: '12.50' }), { ...row({ id: 8, status: 'shipped', amount: '3.00' }), id: 'k1:2', record: 'k1:2' }]

/** A grid of two rows under a section's filter, every filter it is sent kept in `sent`, wired as record-grid wires it. */
function Grid({ sent }: { sent: ListFilterTerm[][] }): ReactElement {
  const [filter, setFilter] = useState<ListFilterTerm[]>([])
  const headers: HeaderFilters = {
    fields: FIELDS,
    filter,
    onFilter: (next) => {
      sent.push(next)
      setFilter(next)
    },
    refused: () => {},
  }
  const now = useRef(headers)
  now.current = headers
  const [options] = useState(() =>
    gridOptionsFor({
      labelledBy: 'records',
      firstColumn: () => 'id',
      on: {
        openToken: () => null,
        ready: () => {},
        resized: () => {},
        asked: () => {},
        drilling: () => false,
        sorted: () => {},
        example: (at, colId) => filterByExample(now.current, at, colId),
      },
    }),
  )
  return (
    <HeaderFilterContext.Provider value={headers}>
      <h3 id="records">Records</h3>
      <div style={{ width: 800, height: 300 }}>
        <AgGridReact<GridRow>
          gridOptions={options}
          columnDefs={columnDefsOf([column('id', 'Id'), column('status', 'Status'), column('amount', 'Amount')], undefined, new Set(['status', 'amount']))}
          datasource={{ getRows: (params) => params.successCallback(ROWS, ROWS.length) }}
        />
      </div>
    </HeaderFilterContext.Provider>
  )
}

/** The cell of the row whose first cell says `first`, in column `colIndex` (1 first), as AG Grid numbers it. */
async function cell(first: string, colIndex: number): Promise<HTMLElement> {
  const found = await waitFor(() => {
    const at = within(screen.getByRole('grid', { name: 'Records' }))
      .getAllByRole('row')
      .find((each) => within(each).queryAllByRole('gridcell')[0]?.textContent === first)
    if (at === undefined) throw new Error(`no row starts with ${first}`)
    return at
  })
  return within(found)
    .getAllByRole('gridcell')
    .find((each) => each.getAttribute('aria-colindex') === String(colIndex)) as HTMLElement
}

describe('a cell’s example', () => {
  // `=` on a focused cell keeps the rows with its value: the keyboard's
  // way, since Enter opens the row (watched failing with no key: nothing
  // was sent).
  test('is applied by = on the cell', async () => {
    const sent: ListFilterTerm[][] = []
    render(<Grid sent={sent} />)
    const status = await cell('7', 2)
    status.focus()
    await userEvent.setup().keyboard('=')
    expect(sent).toEqual([[{ field: 'status', op: 'equals', value: 'placed' }]])
  })

  // A cell that has the keyboard shows a button, titled for what it keeps,
  // which a pointer presses; a cell without it shows none (watched failing
  // with no button drawn). The button is out of the accessibility tree, so
  // the cell's name stays its value (watched failing with the button read
  // into the cell's name); the tree cannot name what it leaves out, so the
  // button is found by its title, which a pointer's tooltip shows.
  test('is offered as a button while the cell has the keyboard', async () => {
    const sent: ListFilterTerm[][] = []
    render(<Grid sent={sent} />)
    const amount = await cell('8', 3)
    expect(within(amount).queryByRole('button')).toBeNull()
    amount.focus()
    const button = await within(amount).findByTitle('Only rows where Amount is 3.00')
    expect(within(amount).queryByRole('button')).toBeNull()
    await userEvent.setup().click(button)
    expect(sent).toEqual([[{ field: 'amount', op: 'equals', value: '3.00' }]])
  })
})
