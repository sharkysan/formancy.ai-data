import { expect } from 'vitest'
import { waitFor, within } from '@testing-library/react'
import type { RecordListQuery } from '@formancy/data-client'
import { gridSection } from './test-host.js'
import type { User } from './test-host.js'
import type { Sent } from './test-fetch.js'

/*
 * How the suites drive a grid's filter (0104) -- its line, its chips and
 * its columns' header boxes (0132) -- as a person does: by role and
 * accessible name (formancy.ai 0034), inside the section whose heading
 * names the grid -- the Records panel, or a child section, each with a
 * filter of its own.
 */

/** A condition as a person sets it: the field by its label, the condition by its word, and what is typed. */
export interface Asked {
  field: string
  condition: 'is' | 'is between' | 'contains' | 'has no value' | 'has a value'
  /** The value the condition holds: typed into the box, or for a field with values chosen. */
  value?: string
  from?: string
  to?: string
}

/** A value quoted as the line writes one that must be: one value whatever it holds. */
const quoted = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** What a column's header box is typed with for `asked`: the line's condition without the field's name. */
function boxText(asked: Asked): string {
  switch (asked.condition) {
    case 'is':
      return `= ${quoted(asked.value ?? '')}`
    case 'contains':
      return `contains ${quoted(asked.value ?? '')}`
    case 'has no value':
      return 'is empty'
    case 'has a value':
      return 'is not empty'
    case 'is between':
      return [
        asked.from === undefined || asked.from === '' ? null : `>= ${quoted(asked.from)}`,
        asked.to === undefined || asked.to === '' ? null : `<= ${quoted(asked.to)}`,
      ]
        .filter((part) => part !== null)
        .join(' and ')
  }
}

/**
 * Set a condition on the grid's column `asked.field` names, in place of
 * the one it had, as a person does in its header box (0132): typed and
 * Enter, or a value chosen where the box is a select. Nothing is waited
 * for.
 */
export async function applyCondition(user: User, heading: string, asked: Asked): Promise<void> {
  const section = gridSection(heading)
  const choice = within(section).queryByRole('combobox', { name: `Filter ${asked.field}` })
  if (choice !== null && asked.condition === 'is' && asked.value !== undefined) {
    const wanted = asked.value.toLowerCase()
    const option = within(choice)
      .getAllByRole('option')
      .find((each) => each.textContent?.toLowerCase() === wanted || (each as HTMLOptionElement).value === asked.value)
    if (option === undefined) throw new Error(`Filter ${asked.field} offers no ${asked.value}`)
    await user.selectOptions(choice, option)
    return
  }
  const box = within(section).getByRole<HTMLInputElement>('textbox', { name: `Filter ${asked.field}` })
  await user.clear(box)
  await user.type(box, boxText(asked))
  await user.keyboard('{Enter}')
}

/** The header box of the grid `heading` names over the column labelled `field`. */
export function headerBox(heading: string, field: string): HTMLInputElement {
  return within(gridSection(heading)).getByRole<HTMLInputElement>('textbox', { name: `Filter ${field}` })
}

/** The filter line of the grid `heading` names: a combobox, its accessible name the line's label. */
export function filterLine(heading: string): HTMLInputElement {
  return within(gridSection(heading)).getByRole<HTMLInputElement>('combobox', { name: 'Filter' })
}

/** Type `text` into the grid's filter line, in place of what it shows, and press Enter. Nothing is waited for. */
export async function typeFilter(user: User, heading: string, text: string): Promise<void> {
  const line = filterLine(heading)
  await user.clear(line)
  if (text !== '') await user.type(line, text)
  await user.keyboard('{Enter}')
}

/** The Remove of the chip that reads `words`, in the grid `heading` names. */
export function chipRemove(heading: string, words: string): HTMLElement {
  return within(gridSection(heading)).getByRole('button', { name: `Remove ${words}` })
}

/** The conditions the grid lists as applied, each as its chip reads; none when it lists none. */
export function applied(heading: string): string[] {
  const list = within(gridSection(heading)).queryByRole('list', { name: 'Filtered by' })
  return list === null
    ? []
    : within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent ?? '')
}

/** Wait until the grid lists exactly these conditions as applied, each a chip that reads it. */
export async function listsApplied(heading: string, summaries: readonly string[]): Promise<void> {
  await waitFor(() => expect(applied(heading)).toEqual(summaries), { timeout: 15_000 })
}

/** What the page sent to a form's list route, each body read. */
export function listsSent(sent: readonly Sent[], formId: string): Array<{ url: string; body: RecordListQuery }> {
  return sent
    .filter((request) => request.method === 'POST' && request.path === `/v1/forms/${formId}/records/list`)
    .map((request) => ({ url: request.url, body: JSON.parse(request.body ?? '{}') as RecordListQuery }))
}
