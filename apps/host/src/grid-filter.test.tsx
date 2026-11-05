import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { ListFilterTerm, StateMoves } from '@formancy/data-client'
import { GridFilter } from './grid-filter.js'
import type { PanelField } from './filter-terms.js'

/*
 * A grid's filter -- its line, its chips and its condition builder --
 * without a server: what each offers, what each sends to the one filter,
 * and how each shows it whatever changed it. What the server lists for a
 * filter, and that the terms reach it in the body alone, is the page's
 * against it (filter-line.test.tsx, filter.test.tsx).
 */

afterEach(cleanup)

const STATUS: PanelField = { field: 'status', label: 'Status', offered: true, operators: ['equals', 'contains'], input: 'text', days: null }
const AMOUNT: PanelField = { field: 'amount', label: 'Amount', offered: true, operators: ['equals', 'range'], input: 'decimal', days: null }
const NOTES: PanelField = { field: 'notes', label: 'Notes', offered: false, operators: ['equals', 'contains', 'null', 'not-null'], input: 'text', days: null }
const MOVES: StateMoves = {
  field: 'status',
  moves: [
    { from: null, to: 'placed' },
    { from: 'placed', to: 'on_hold' },
  ],
  labels: [{ state: 'on_hold', label: 'On hold' }],
}

/** The filter held as a section holds it, every change it is sent kept in `sent`. */
function Section({
  fields,
  start = [],
  empty = false,
  sent,
}: {
  fields: PanelField[]
  start?: ListFilterTerm[]
  empty?: boolean
  sent: ListFilterTerm[][]
}): ReactElement {
  const [filter, setFilter] = useState<ListFilterTerm[]>(start)
  return (
    <GridFilter
      idBase="grid"
      fields={fields}
      moves={MOVES}
      filter={filter}
      empty={empty}
      onFilter={(next) => {
        sent.push(next)
        setFilter(next)
      }}
    />
  )
}

const line = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Filter' })
const chips = () =>
  within(screen.getByRole('list', { name: 'Filtered by' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

describe('the condition builder over fields left out of it (0123)', () => {
  // Its Field menu offers what the panel offers, and not a field the
  // administrator left out. Watched failing with the menu over every field
  // filtered by: Notes was offered.
  test('offers in its Field menu only the fields it offers', async () => {
    render(<Section fields={[STATUS, NOTES]} sent={[]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Build a condition' }))
    const menu = screen.getByRole('combobox', { name: 'Field' })
    expect(
      within(menu)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Status'])
  })

  // With nothing to offer, there is no line and no builder, and a
  // condition applied on a field left out -- a view's -- is still a chip,
  // with its Remove. Watched failing with the toggle drawn over no field:
  // a button opened an empty form.
  test('says a condition on a field it does not offer, and offers nothing where it offers none', () => {
    render(<Section fields={[NOTES]} start={[{ field: 'notes', op: 'contains', text: 'urgent' }]} sent={[]} />)
    expect(screen.queryByRole('button', { name: 'Build a condition' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Filter' })).toBeNull()
    expect(chips()).toEqual(['Notes contains “urgent”'])
    expect(screen.getByRole('button', { name: 'Remove Notes contains “urgent”' })).toBeTruthy()
  })
})

describe('the filter line', () => {
  // Enter sends what the line reads, after a condition on a field the line
  // does not offer, which it keeps; the line then shows the filter applied,
  // written as the reader writes it (watched failing with no line).
  test('sends what it reads, keeping a condition it does not offer', async () => {
    const sent: ListFilterTerm[][] = []
    render(<Section fields={[STATUS, AMOUNT, NOTES]} start={[{ field: 'notes', op: 'contains', text: 'urgent' }]} sent={sent} />)
    const user = userEvent.setup()
    expect(line().value).toBe('')
    await user.type(line(), 'Status = "On hold" and amount>1000{Enter}')
    expect(sent).toEqual([
      [
        { field: 'notes', op: 'contains', text: 'urgent' },
        { field: 'status', op: 'equals', value: 'on_hold' },
        { field: 'amount', op: 'range', from: '1000', to: null, exclusive: 'from' },
      ],
    ])
    expect(line().value).toBe('status = on_hold and amount > 1000')
    expect(chips()).toEqual(['Notes contains “urgent”', 'Status is “on_hold”', 'Amount is over 1000'])
  })

  // A line it cannot read sends nothing, keeps every character, selects
  // the ones it is about and says why, until the person types again.
  test('says why it cannot read a line, and sends nothing', async () => {
    const sent: ListFilterTerm[][] = []
    render(<Section fields={[STATUS, AMOUNT]} sent={sent} />)
    const user = userEvent.setup()
    await user.type(line(), 'amount > 1000,50{Enter}')
    expect(sent).toEqual([])
    expect(line().value).toBe('amount > 1000,50')
    expect(line().getAttribute('aria-invalid')).toBe('true')
    expect([line().selectionStart, line().selectionEnd]).toEqual([9, 16])
    expect(screen.getByRole('status', { name: 'Filter' }).textContent).toContain('Write numbers with a point and no separators: 1000.50.')
    await user.type(line(), 'x')
    expect(line().getAttribute('aria-invalid')).toBeNull()
  })

  // What may come next is a listbox the keyboard moves through and takes
  // from: a state by its label, inserted as its value, the states an
  // administrator labelled first, in their order, then the rest as spelled.
  test('completes from the keyboard', async () => {
    render(<Section fields={[STATUS, AMOUNT]} sent={[]} />)
    const user = userEvent.setup()
    await user.type(line(), 'status = ')
    const options = within(screen.getByRole('listbox', { name: 'What may come next' })).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['On holdon_hold', 'placedplaced'])
    await user.keyboard('{ArrowDown}')
    expect(line().getAttribute('aria-activedescendant')).toBe(options[0]?.id)
    await user.keyboard('{Enter}')
    expect(line().value).toBe('status = on_hold ')
    await user.keyboard('{Escape}')
    expect(line().getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the chips', () => {
  // A chip removed is Undo's to put back, in its place, until the filter
  // changes some other way; Clear filter likewise.
  test('remove a condition, and Undo puts it back', async () => {
    const sent: ListFilterTerm[][] = []
    const start: ListFilterTerm[] = [
      { field: 'status', op: 'equals', value: 'placed' },
      { field: 'amount', op: 'range', from: '1', to: '9', exclusive: 'both' },
    ]
    render(<Section fields={[STATUS, AMOUNT]} start={start} sent={sent} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove Status is “placed”' }))
    expect(chips()).toEqual(['Amount is over 1 and under 9'])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Amount is over 1 and under 9' }))
    await user.click(screen.getByRole('button', { name: 'Undo removing Status is “placed”' }))
    expect(sent.at(-1)).toEqual(start)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Status is “placed”' }))
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.queryByRole('list', { name: 'Filtered by' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo clearing the filter' }))
    await user.type(line(), 'amount = 5{Enter}')
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  // A list nothing matches offers to try it without the last condition.
  test('offer a way out of a list nothing matches', async () => {
    const sent: ListFilterTerm[][] = []
    const start: ListFilterTerm[] = [
      { field: 'status', op: 'equals', value: 'placed' },
      { field: 'amount', op: 'range', from: '100', to: null, exclusive: 'from' },
    ]
    render(<Section fields={[STATUS, AMOUNT]} start={start} empty sent={sent} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try without Amount is over 100' }))
    expect(sent).toEqual([start.slice(0, 1)])
  })
})
