import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { AgGridReact } from 'ag-grid-react'
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { LineField, ListFilterTerm } from '@formancy/data-client'
import type { ArrangedColumn } from './columns.js'
import { columnDefsOf } from './grid-options.js'
import { HeaderFilterContext } from './header-filter.js'

/*
 * Each column header's filter box (0132), without a server: AG Grid's
 * floating filter row holding the page's own control, named for its
 * column, that reads what is typed as the filter line would with the
 * column's name in front, and shows whatever condition the column has.
 * What the server lists for it is the page's against it
 * (filter-line.test.tsx).
 */

afterEach(cleanup)

const column = (key: string, label: string): ArrangedColumn => ({ key, label, sortable: true, source: null, shown: true })
const COLUMNS = [column('notes', 'Notes'), column('amount', 'Amount'), column('status', 'Status'), column('customer', 'Customer')]
const FIELDS: LineField[] = [
  { field: 'notes', label: 'Notes', operators: ['equals', 'contains', 'null', 'not-null'], input: 'text' },
  { field: 'amount', label: 'Amount', operators: ['equals', 'range'], input: 'decimal' },
  { field: 'status', label: 'Status', operators: ['equals'], input: 'text', values: [{ value: 'on_hold', label: 'On hold' }] },
]

/** A grid's headers over `start`, every filter they send kept in `sent` and every refusal in `refusals`; Elsewhere sets the filter as the line would. */
function Grid({
  start = [],
  sent,
  refusals = [],
  elsewhere = [],
}: {
  start?: ListFilterTerm[]
  sent: ListFilterTerm[][]
  refusals?: string[]
  elsewhere?: ListFilterTerm[]
}): ReactElement {
  const [filter, setFilter] = useState(start)
  const onFilter = (next: ListFilterTerm[]): void => {
    sent.push(next)
    setFilter(next)
  }
  return (
    <HeaderFilterContext.Provider value={{ fields: FIELDS, filter, onFilter, refused: (message) => refusals.push(message) }}>
      <button type="button" onClick={() => setFilter(elsewhere)}>
        Elsewhere
      </button>
      <div style={{ width: 800, height: 300 }}>
        <AgGridReact rowModelType="infinite" columnDefs={columnDefsOf(COLUMNS, undefined, new Set(FIELDS.map((field) => field.field)))} />
      </div>
    </HeaderFilterContext.Provider>
  )
}

const box = async (name: string) => screen.findByRole<HTMLInputElement>('textbox', { name })

describe('a column header’s filter box', () => {
  // A box per column the line may name, by its column's label; none for
  // one it may not -- a lookup -- where a box would offer a condition the
  // server refuses (watched failing with no floating row at all).
  test('is offered on each column the line may name, by its label', async () => {
    render(<Grid sent={[]} />)
    expect((await box('Filter Notes')).value).toBe('')
    expect(await box('Filter Amount')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filter Status' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Filter Customer' })).toBeNull()
  })

  // Enter or leaving the box applies it, as the line would read it with
  // the column's name in front; a bare value is found anywhere in text.
  test('applies what is typed, on Enter or on leaving it', async () => {
    const sent: ListFilterTerm[][] = []
    render(<Grid sent={sent} />)
    const user = userEvent.setup()
    await user.type(await box('Filter Amount'), '> 1000{Enter}')
    expect(sent.at(-1)).toEqual([{ field: 'amount', op: 'range', from: '1000', to: null, exclusive: 'from' }])
    await user.type(await box('Filter Notes'), 'urgent')
    await user.tab()
    expect(sent.at(-1)).toEqual([
      { field: 'amount', op: 'range', from: '1000', to: null, exclusive: 'from' },
      { field: 'notes', op: 'contains', text: 'urgent' },
    ])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter Status' }), 'On hold')
    expect(sent.at(-1)?.at(-1)).toEqual({ field: 'status', op: 'equals', value: 'on_hold' })
    await user.clear(await box('Filter Amount'))
    await user.keyboard('{Enter}')
    expect(sent.at(-1)?.map((term) => term.field)).toEqual(['notes', 'status'])
  })

  // A box the line would refuse sends nothing, says why where the grid
  // speaks, and keeps what was typed to correct.
  test('refuses what the line refuses, keeping what was typed', async () => {
    const sent: ListFilterTerm[][] = []
    const refusals: string[] = []
    render(<Grid sent={sent} refusals={refusals} />)
    const user = userEvent.setup()
    await user.type(await box('Filter Amount'), '1000,50{Enter}')
    expect(sent).toEqual([])
    expect(refusals).toEqual(['Write numbers with a point and no separators: 1000.50.'])
    expect((await box('Filter Amount')).value).toBe('1000,50')
  })

  // A condition applied some other way -- the line, a chip, a view -- is
  // what the box shows once it is left: the three are one filter.
  test('shows the condition its column has, however it was applied', async () => {
    render(
      <Grid
        sent={[]}
        start={[{ field: 'notes', op: 'equals', value: 'rush' }]}
        elsewhere={[{ field: 'amount', op: 'range', from: '1', to: '9', exclusive: 'both' }]}
      />,
    )
    expect((await box('Filter Notes')).value).toBe('= rush')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Elsewhere' }))
    await waitFor(async () => expect((await box('Filter Amount')).value).toBe('> 1 and < 9'))
    expect((await box('Filter Notes')).value).toBe('')
  })
})
