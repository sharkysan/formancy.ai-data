import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { AgGridReact } from 'ag-grid-react'
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { LineField, ListFilterTerm, LookupRow } from '@formancy/data-client'
import type { ArrangedColumn } from './columns.js'
import { columnDefsOf } from './grid-options.js'
import { HeaderFilterContext } from './header-filter.js'

/*
 * A lookup column's filter box (0135), without a server: a combobox that
 * searches the lookup as the person types, offers the records it finds by
 * their labels -- and whether the field refers to a record at all -- and
 * applies the one picked as the record the column refers to. What the
 * server lists for it is the page's against it (filter.test.tsx).
 */

afterEach(cleanup)

const CUSTOMER: LineField = {
  field: 'customer',
  label: 'Customer',
  operators: ['equals', 'null', 'not-null'],
  input: 'lookup',
  values: [{ value: 'k1:1', label: 'Muster AG' }],
}
const RECORDS: LookupRow[] = [
  { token: 'k1:1', label: 'Muster AG' },
  { token: 'k1:2', label: 'Grace Trading' },
  { token: 'k1:3', label: 'Graceland GmbH' },
]
const column = (key: string, label: string): ArrangedColumn => ({ key, label, sortable: true, source: key === 'customer' ? 'customer' : null, shown: true })

/** A grid with a Customer lookup column, its search over RECORDS, every filter sent kept in `sent`, every record heard of in `heard`, every refusal in `refusals`. */
function Grid({
  sent,
  heard = [],
  refusals = [],
  start = [],
  search = async (_field: string, text: string) => RECORDS.filter((row) => row.label.toLowerCase().includes(text.toLowerCase())),
}: {
  sent: ListFilterTerm[][]
  heard?: LookupRow[]
  refusals?: string[]
  start?: ListFilterTerm[]
  search?: (field: string, text: string, signal: AbortSignal) => Promise<readonly LookupRow[] | string>
}): ReactElement {
  const [filter, setFilter] = useState(start)
  return (
    <HeaderFilterContext.Provider
      value={{
        fields: [CUSTOMER],
        filter,
        onFilter: (next) => {
          sent.push(next)
          setFilter(next)
        },
        refused: (message) => refusals.push(message),
        records: search,
        heard: (_field, rows) => heard.push(...rows),
      }}
    >
      <div style={{ width: 800, height: 300 }}>
        <AgGridReact
          rowModelType="infinite"
          columnDefs={columnDefsOf([column('id', 'Id'), column('customer', 'Customer')], undefined, new Set(['customer']))}
        />
      </div>
    </HeaderFilterContext.Provider>
  )
}

const box = async () => screen.findByRole<HTMLInputElement>('combobox', { name: 'Filter Customer' })
const options = () =>
  within(screen.getByRole('listbox', { name: 'Records of Customer' }))
    .getAllByRole('option')
    .map((option) => option.textContent)

describe('a lookup column’s box', () => {
  // The box finds records by what the person reads -- a label -- and the
  // record picked is the condition, by its token, never the text typed;
  // the page hears of the record, so the line can say it by its label
  // (each case here watched failing with the lookup's column given the
  // select its known records would draw: no search, and no listbox).
  test('searches its lookup as typed, and applies the record picked', async () => {
    const sent: ListFilterTerm[][] = []
    const heard: LookupRow[] = []
    render(<Grid sent={sent} heard={heard} />)
    const user = userEvent.setup()
    await user.type(await box(), 'gra')
    await waitFor(() => expect(options()).toEqual(['Grace Trading', 'Graceland GmbH']))
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(sent).toEqual([[{ field: 'customer', op: 'equals', value: 'k1:3' }]])
    expect(heard).toContainEqual({ token: 'k1:3', label: 'Graceland GmbH' })
    expect((await box()).value).toBe('Graceland GmbH')
  })

  // An empty box offers whether the field refers to a record, the words
  // the line reads; typed, they apply as the line's would.
  test('offers and reads whether the field refers to a record', async () => {
    const sent: ListFilterTerm[][] = []
    render(<Grid sent={sent} />)
    const user = userEvent.setup()
    await user.click(await box())
    await user.keyboard('{ArrowDown}')
    expect(options()).toEqual(['is empty', 'is not empty'])
    await user.keyboard('{ArrowDown}{Enter}')
    expect(sent).toEqual([[{ field: 'customer', op: 'not-null' }]])
    await user.clear(await box())
    await user.type(await box(), 'is empty{Enter}')
    expect(sent.at(-1)).toEqual([{ field: 'customer', op: 'null' }])
  })

  // Enter on a label the page knows applies its record; on one it does
  // not, the line's refusal, the text kept and nothing sent; Esc gives an
  // edit up and shows the condition the column has.
  test('applies a known label, refuses an unknown one, and gives up with Esc', async () => {
    const sent: ListFilterTerm[][] = []
    const refusals: string[] = []
    render(<Grid sent={sent} refusals={refusals} search={async () => []} />)
    const user = userEvent.setup()
    await user.type(await box(), 'muster ag{Enter}')
    expect(sent).toEqual([[{ field: 'customer', op: 'equals', value: 'k1:1' }]])
    await user.clear(await box())
    await user.type(await box(), 'Nobody{Enter}')
    expect(refusals).toEqual(["No record of Customer shown here is called Nobody: pick one in its column's box."])
    expect(sent).toHaveLength(1)
    expect((await box()).value).toBe('Nobody')
    await user.keyboard('{Escape}')
    await waitFor(async () => expect((await box()).value).toBe('Muster AG'))
  })

  // A search the server refuses is said where the grid speaks, and offers
  // nothing to pick.
  test('says a search the server refuses', async () => {
    const refusals: string[] = []
    render(<Grid sent={[]} refusals={refusals} search={async () => 'The lookup is not answering.'} />)
    await userEvent.setup().type(await box(), 'gra')
    await waitFor(() => expect(refusals).toEqual(['The lookup is not answering.']))
  })
})
