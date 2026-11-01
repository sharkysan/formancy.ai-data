import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { FilterPanel } from './filter-panel.js'
import type { PanelField } from './filter-terms.js'

/*
 * The Filter panel over fields its administrator left out (0123), without a
 * server: what its Field menu offers, and what it says of a condition on a
 * field it does not offer -- a view's. What the server marks offered is the
 * list route suites' (runtime-lists.test.ts) and the page's against it
 * (filter.test.tsx).
 */

afterEach(cleanup)

const STATUS: PanelField = { field: 'status', label: 'Status', offered: true, operators: ['equals', 'contains'], input: 'text', days: null }
const NOTES: PanelField = { field: 'notes', label: 'Notes', offered: false, operators: ['equals', 'contains', 'null', 'not-null'], input: 'text', days: null }

describe('the Filter panel over fields left out of it (0123)', () => {
  // Its Field menu offers what the panel offers, and not a field the
  // administrator left out. Watched failing with the menu over every field
  // filtered by: Notes was offered.
  test('offers in its Field menu only the fields it offers', async () => {
    render(<FilterPanel idBase="panel" fields={[STATUS, NOTES]} filter={[]} onFilter={() => {}} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Filter' }))
    const menu = screen.getByRole('combobox', { name: 'Field' })
    expect(
      within(menu)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Status'])
  })

  // With nothing to offer, there is no form to open, and a condition
  // applied on a field left out -- a view's -- is still said, with its
  // Remove. Watched failing with the toggle drawn over no field: a Filter
  // button opened an empty form.
  test('says a condition on a field it does not offer, and opens no form where it offers none', () => {
    render(<FilterPanel idBase="panel" fields={[NOTES]} filter={[{ field: 'notes', op: 'contains', text: 'urgent' }]} onFilter={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull()
    const applied = within(screen.getByRole('list', { name: 'Filtered by' })).getAllByRole('listitem')
    expect(applied.map((item) => item.textContent)).toEqual(['Notes contains “urgent”Remove'])
    expect(screen.getByRole('button', { name: 'Remove the condition on Notes' })).toBeTruthy()
  })
})
