import { expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { pressEnter } from './test-studio.js'
import type { User } from './test-studio.js'

/**
 * How the suites drive the Presentation step's list views (0105): by role
 * and accessible name (formancy.ai 0034), a row's controls within the group
 * its legend names -- "Condition 2", "Sort 1" -- shared by the panel's suite
 * and the regeneration's. A select's option is chosen by its text, as a
 * person reads it; jsdom does not change a closed select from the arrow
 * keys, so a choice is the one step here a keyboard user takes otherwise.
 */

/** The panel, below the step's arrangement. */
export const viewsPanel = (): HTMLElement => screen.getByRole('region', { name: 'List views' })

/** The form that makes a view, or edits one. */
export const viewForm = (): HTMLElement => within(viewsPanel()).getByRole('form', { name: /^(New view|Editing view \d+, “.+”)$/ })

/** The saved views, each as its list says it in words. */
export function savedViews(): string[] {
  const list = within(viewsPanel()).queryByRole('list', { name: 'List views' })
  return list === null
    ? []
    : within(list)
        .getAllByRole('listitem')
        .map((item) => within(item).getAllByRole('paragraph')[0]?.textContent ?? '')
}

/** The form's rows of one kind, "Condition" or "Sort", in order. */
export function rows(kind: 'Condition' | 'Sort'): HTMLElement[] {
  return within(viewForm())
    .queryAllByRole('group')
    .filter((group) => new RegExp(`^${kind} \\d+$`).test(computeAccessibleName(group)))
}

/** Each of `values` typed into the box of that name in `row`, or chosen where it is a select. */
async function fill(user: User, row: HTMLElement, values: Record<string, string>): Promise<void> {
  for (const [name, value] of Object.entries(values)) {
    const control = within(row).getByLabelText(name)
    if (control instanceof HTMLSelectElement) {
      await user.selectOptions(control, value)
      continue
    }
    await user.clear(control)
    if (value !== '') await user.type(control, value)
  }
}

/** A condition added by Enter on its button, which leaves the keyboard on the new row's field, then filled: its row. */
export async function addCondition(user: User, field: string, op: string, values: Record<string, string> = {}): Promise<HTMLElement> {
  await pressEnter(user, within(viewForm()).getByRole('button', { name: 'Add condition' }))
  const row = rows('Condition').at(-1) as HTMLElement
  expect(document.activeElement).toBe(within(row).getByRole('combobox', { name: 'Field' }))
  await user.selectOptions(within(row).getByRole('combobox', { name: 'Field' }), field)
  await user.selectOptions(within(row).getByRole('combobox', { name: 'Condition' }), op)
  await fill(user, row, values)
  return row
}

/** A sort added by Enter on its button, which leaves the keyboard on the new row's field, then chosen: its row. */
export async function addSort(user: User, field: string, direction: 'Ascending' | 'Descending' = 'Ascending'): Promise<HTMLElement> {
  await pressEnter(user, within(viewForm()).getByRole('button', { name: 'Add sort' }))
  const row = rows('Sort').at(-1) as HTMLElement
  expect(document.activeElement).toBe(within(row).getByRole('combobox', { name: 'Sort by' }))
  await fill(user, row, { 'Sort by': field, Direction: direction })
  return row
}

/** The form's name typed afresh. */
export async function nameView(user: User, name: string): Promise<void> {
  const box = within(viewForm()).getByRole('textbox', { name: 'Name' })
  await user.clear(box)
  if (name !== '') await user.type(box, name)
}

/** The default checked or unchecked by Space, as a keyboard user does. */
export async function opensTheGrid(user: User, opens: boolean): Promise<void> {
  const box = within(viewForm()).getByRole<HTMLInputElement>('checkbox', { name: 'The grid opens on this view' })
  if (box.checked === opens) return
  box.focus()
  await user.keyboard(' ')
}

/** Enter on Save view. */
export const pressSave = (user: User): Promise<void> => pressEnter(user, within(viewForm()).getByRole('button', { name: 'Save view' }))

/** A view named `name` made in the form by `build`, then saved: what is asked of the panel, not checked here. */
export async function saveView(user: User, name: string, build: () => Promise<unknown>, opens = false): Promise<void> {
  await nameView(user, name)
  await build()
  await opensTheGrid(user, opens)
  await pressSave(user)
}
