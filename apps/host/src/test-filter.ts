import { expect } from 'vitest'
import { waitFor, within } from '@testing-library/react'
import type { RecordListQuery } from '@formancy/data-client'
import { gridSection } from './test-host.js'
import type { User } from './test-host.js'
import type { Sent } from './test-fetch.js'

/*
 * How the suites drive a grid's filter (0104) -- its line, its chips and
 * the panel that builds a condition -- as a person does: by role and
 * accessible name (formancy.ai 0034), inside the section whose heading
 * names the grid -- the Records panel, or a child section, each with a
 * filter of its own.
 */

/** A condition as a person sets it: the field by its label, the condition by its word, and what is typed. */
export interface Asked {
  field: string
  condition: 'is' | 'is between' | 'contains' | 'has no value' | 'has a value'
  /** What Value or Text is given: typed, or for a yes-or-no field chosen. */
  value?: string
  from?: string
  to?: string
}

/** The panel of the grid `heading` names, open: Build a condition pressed when it is not expanded. */
export async function openFilter(user: User, heading: string): Promise<HTMLElement> {
  const section = gridSection(heading)
  const button = within(section).getByRole('button', { name: 'Build a condition' })
  if (button.getAttribute('aria-expanded') !== 'true') await user.click(button)
  return section
}

/**
 * A box of the open panel, by its label. By label rather than role, because
 * a date input has none in ARIA ("no corresponding role" in HTML-AAM), as
 * test-host.ts's `control` says.
 */
export function filterBox(heading: string, label: 'Value' | 'Text' | 'From' | 'To'): HTMLInputElement {
  return within(gridSection(heading)).getByLabelText<HTMLInputElement>(label, { exact: true })
}

/** Clear a box and type into it, where there is something to type. */
async function typeInto(user: User, box: HTMLInputElement, text: string): Promise<void> {
  await user.clear(box)
  if (text !== '') await user.type(box, text)
}

/** Set a condition in the grid's panel -- the field, the condition, then each box -- and press Apply. Nothing is waited for. */
export async function applyCondition(user: User, heading: string, asked: Asked): Promise<void> {
  const section = await openFilter(user, heading)
  await user.selectOptions(within(section).getByRole('combobox', { name: 'Field' }), asked.field)
  await user.selectOptions(within(section).getByRole('combobox', { name: 'Condition' }), asked.condition)
  if (asked.condition === 'is between') {
    await typeInto(user, filterBox(heading, 'From'), asked.from ?? '')
    await typeInto(user, filterBox(heading, 'To'), asked.to ?? '')
  } else if (asked.value !== undefined) {
    const choice = within(section).queryByRole('combobox', { name: 'Value' })
    if (choice !== null) await user.selectOptions(choice, asked.value)
    else await typeInto(user, filterBox(heading, asked.condition === 'contains' ? 'Text' : 'Value'), asked.value)
  }
  await user.click(within(section).getByRole('button', { name: 'Apply' }))
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
