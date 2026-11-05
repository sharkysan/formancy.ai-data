import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

/**
 * The filter held as a section holds it, every change it is sent kept in
 * `sent`; each of `elsewhere` a button that sets the filter as a view or
 * a header would, "Elsewhere 1" and on.
 */
function Section({
  fields,
  start = [],
  empty = false,
  sent,
  elsewhere = [],
}: {
  fields: PanelField[]
  start?: ListFilterTerm[]
  empty?: boolean
  sent: ListFilterTerm[][]
  elsewhere?: ListFilterTerm[][]
}): ReactElement {
  const [filter, setFilter] = useState<ListFilterTerm[]>(start)
  return (
    <>
      {elsewhere.map((other, index) => (
        <button key={String(index)} type="button" onClick={() => setFilter(other)}>
          Elsewhere {index + 1}
        </button>
      ))}
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
    </>
  )
}

const line = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Filter' })
const chips = () =>
  within(screen.getByRole('list', { name: 'Filtered by' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

describe('the filter over fields left out of it (0123)', () => {
  // The line's completion offers what the filter offers, and not a field
  // the administrator left out. Watched failing, when the panel offered
  // fields, with its menu over every field filtered by: Notes was offered.
  test('offers in the line only the fields it offers', async () => {
    render(<Section fields={[STATUS, NOTES]} sent={[]} />)
    const user = userEvent.setup()
    await user.click(line())
    await user.keyboard('{ArrowDown}')
    expect(
      within(screen.getByRole('listbox', { name: 'What may come next' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['statusStatus'])
  })

  // With nothing to offer, there is no line, and a condition applied on a
  // field left out -- a view's -- is still a chip, with its Remove.
  // Watched failing, when the panel was drawn, with its toggle over no
  // field: a button opened an empty form.
  test('says a condition on a field it does not offer, and offers nothing where it offers none', () => {
    render(<Section fields={[NOTES]} start={[{ field: 'notes', op: 'contains', text: 'urgent' }]} sent={[]} />)
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

  // A line it cannot read sends nothing, keeps every character and the
  // caret, marks the ones it is about and says why, until the person types
  // again: a line sent half-read would filter by what nobody asked for.
  test('says why it cannot read a line, and sends nothing', async () => {
    const sent: ListFilterTerm[][] = []
    render(<Section fields={[STATUS, AMOUNT]} sent={sent} />)
    const user = userEvent.setup()
    await user.type(line(), 'amount > 1000,50{Enter}')
    expect(sent).toEqual([])
    expect(line().value).toBe('amount > 1000,50')
    expect(line().getAttribute('aria-invalid')).toBe('true')
    expect([line().selectionStart, line().selectionEnd]).toEqual([16, 16])
    expect(screen.getByRole('status', { name: 'Filter' }).querySelector('mark')?.textContent).toBe('1000,50')
    expect(screen.getByRole('status', { name: 'Filter' }).textContent).toContain('Write numbers with a point and no separators: 1000.50.')
    await user.type(line(), 'x')
    expect(line().getAttribute('aria-invalid')).toBeNull()
  })

  // What may come next is a listbox the keyboard moves through and takes
  // from: a state by its label, inserted as its value, the states an
  // administrator labelled first, in their order, then the rest as spelled.
  // A listbox the keyboard could not reach, or one that inserted a label,
  // would offer a value the server never stores (watched failing with the
  // moves' order: "placed" came first).
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
  // changes some other way; Clear filter likewise. Without it a slip of
  // the pointer loses a condition the person may have typed with care
  // (watched failing with Undo never offered).
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

  // A list nothing matches offers to try it without the last condition, so
  // an empty grid is never a dead end the person must reason their way out
  // of (watched failing with the offer on the first condition).
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

describe('the line and the filter it shows', () => {
  // A filter changed elsewhere -- a view picked, a header, the panel -- is
  // what the line shows once the person has left it, an edit they did not
  // apply dropped: kept, the line would say one filter and the chips
  // another, and Enter would put back what the view had replaced (watched
  // failing with the draft kept until Enter).
  test('shows a filter changed elsewhere, and says an edit is not applied yet', async () => {
    const sent: ListFilterTerm[][] = []
    const view: ListFilterTerm[] = [{ field: 'status', op: 'equals', value: 'on_hold' }]
    render(<Section fields={[STATUS, AMOUNT]} start={[{ field: 'status', op: 'equals', value: 'placed' }]} sent={sent} elsewhere={[view]} />)
    const user = userEvent.setup()
    await user.type(line(), ' and amount > 5')
    expect(screen.getByText('Not applied yet: Enter applies it, Esc puts back the filter.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Elsewhere 1' }))
    expect(line().value).toBe('status = on_hold')
    expect(chips()).toEqual(['Status is “on_hold”'])
    expect(screen.queryByText(/^Not applied yet/)).toBeNull()
    expect(sent).toEqual([])
  })

  // A refusal for a line not finished yet leaves the caret where it was,
  // so the person goes on typing: selected, the marked characters were
  // replaced by the next key, and "amount >" became "amount  5" (watched
  // failing that way).
  test('lets a person go on typing after a refusal', async () => {
    const sent: ListFilterTerm[][] = []
    render(<Section fields={[STATUS, AMOUNT]} sent={sent} />)
    const user = userEvent.setup()
    await user.type(line(), 'amount >{Enter}')
    expect(screen.getByRole('status', { name: 'Filter' }).textContent).toContain('Amount > needs a value.')
    // Typed on from where the keyboard is, without a click to place the caret.
    await user.keyboard(' 5{Enter}')
    expect(sent).toEqual([[{ field: 'amount', op: 'range', from: '5', to: null, exclusive: 'from' }]])
  })

  // While an input method composes a word, Enter and Esc are its: Enter
  // takes the word it composed, and must not apply half a line; Esc ends
  // the composition, and must not throw the line away (watched failing
  // with Enter applying "status = pla").
  test('leaves Enter and Esc to an input method while it composes', async () => {
    const sent: ListFilterTerm[][] = []
    render(<Section fields={[STATUS, AMOUNT]} sent={sent} />)
    await userEvent.setup().type(line(), 'status = pla')
    fireEvent.keyDown(line(), { key: 'Enter', isComposing: true, keyCode: 229 })
    fireEvent.keyDown(line(), { key: 'Escape', isComposing: true, keyCode: 229 })
    expect(sent).toEqual([])
    expect(line().value).toBe('status = pla')
  })

  // Clearing the line and pressing Enter removes every condition, which
  // Undo puts back like a chip's removal (watched failing with no Undo:
  // the filter was gone for good).
  test('offers Undo when the line is cleared and applied', async () => {
    const sent: ListFilterTerm[][] = []
    const start: ListFilterTerm[] = [{ field: 'status', op: 'equals', value: 'placed' }]
    render(<Section fields={[STATUS, AMOUNT]} start={start} sent={sent} />)
    const user = userEvent.setup()
    await user.clear(line())
    await user.keyboard('{Enter}')
    expect(sent).toEqual([[]])
    await user.click(screen.getByRole('button', { name: 'Undo clearing the filter' }))
    expect(sent.at(-1)).toEqual(start)
  })

  // The option the keyboard moved to is one the listbox shows: a caret
  // moved elsewhere offers other options, and the line must not point at
  // one that is gone (watched failing with aria-activedescendant naming
  // an option no longer drawn).
  test('points at no option once the caret moves', async () => {
    render(<Section fields={[STATUS, AMOUNT]} sent={[]} />)
    const user = userEvent.setup()
    await user.type(line(), 'st')
    await user.keyboard('{ArrowDown}')
    expect(line().getAttribute('aria-activedescendant')).not.toBeNull()
    await user.keyboard('{ArrowLeft}')
    expect(line().getAttribute('aria-activedescendant')).toBeNull()
  })

  // Undo is for the removal just made: once the filter changes some other
  // way it is gone, and does not come back if the filter later returns to
  // what the removal left (watched failing with Undo offered again).
  test('forgets Undo once the filter changes some other way', async () => {
    const start: ListFilterTerm[] = [
      { field: 'status', op: 'equals', value: 'placed' },
      { field: 'amount', op: 'equals', value: '5' },
    ]
    render(<Section fields={[STATUS, AMOUNT]} start={start} sent={[]} elsewhere={[[], start.slice(1)]} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove Status is “placed”' }))
    expect(screen.getByRole('button', { name: 'Undo removing Status is “placed”' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Elsewhere 1' }))
    await user.click(screen.getByRole('button', { name: 'Elsewhere 2' }))
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })
})
