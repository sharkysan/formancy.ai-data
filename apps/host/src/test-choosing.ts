import { expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { CLOSE_ALL_LABEL } from './test-actions.js'
import { gridSection } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import type { Plane } from './test-plane.js'

/**
 * How the suites drive an action over the records chosen of a page (0166):
 * the action order of the actions schema and its close-all
 * (test-actions.ts), through the boxes of the Records grid, the bar above
 * it and the region under the bar, by role and accessible name, as
 * test-acting.ts drives the open record's.
 */

const ARRIVES = { timeout: 15_000 }

/** The bar above the Records grid. */
export function choiceBar(): HTMLElement {
  return within(gridSection('Records')).getByRole('group', { name: 'Chosen records' })
}

/** What the bar's line says now. */
export function choiceSaid(): string {
  return within(choiceBar()).getByRole('status').textContent ?? ''
}

/** A record's box in the Records grid, by the words a row's Delete names its record with. */
export function box(record: string): HTMLInputElement {
  return within(gridSection('Records')).getByRole<HTMLInputElement>('checkbox', { name: `Choose Order ${record}` })
}

/** Tick each record's box, by a click. */
export async function choose(user: User, records: readonly string[]): Promise<void> {
  for (const record of records) await user.click(await waitFor(() => box(record), ARRIVES))
}

/** The region of close-all over `count` records, by its name: and a question mark while it confirms. */
export const closingAll = (count: number, confirming = false): string =>
  `${CLOSE_ALL_LABEL}: ${String(count)} ${count === 1 ? 'record' : 'records'}${confirming ? '?' : ''}`

/** The dialog's paper in the region `asking`, as the renderer `renderer` draws it. */
const paperIn = (asking: HTMLElement, renderer: RendererName): HTMLElement => within(asking).getByRole('form', { name: `${CLOSE_ALL_LABEL}, ${renderer}` })

/** Close the chosen orders asked for from the bar: its region, once the paper `renderer` draws holds the dialog's note. */
export async function openCloseAll(user: User, count: number, renderer: RendererName = 'React'): Promise<HTMLElement> {
  await user.click(within(choiceBar()).getByRole('button', { name: CLOSE_ALL_LABEL }))
  const asking = await screen.findByRole('region', { name: closingAll(count) }, ARRIVES)
  await waitFor(() => within(paperIn(asking, renderer)).getByRole('textbox', { name: /^Note\b/ }), ARRIVES)
  return asking
}

/** The dialog in `asking` answered: its note typed, and Continue -- the confirmation, once it is there. */
export async function continueCloseAll(user: User, asking: HTMLElement, count: number, note: string, renderer: RendererName = 'React'): Promise<HTMLElement> {
  await user.type(within(paperIn(asking, renderer)).getByRole('textbox', { name: /^Note\b/ }), note)
  await user.click(within(paperIn(asking, renderer)).getByRole('button', { name: 'Continue' }))
  return screen.findByRole('region', { name: closingAll(count, true) }, ARRIVES)
}

/** Close the chosen orders asked for from the bar and its dialog answered: the confirmation, once it is there. */
export async function askCloseAll(user: User, count: number, note: string, renderer: RendererName = 'React'): Promise<HTMLElement> {
  return continueCloseAll(user, await openCloseAll(user, count, renderer), count, note, renderer)
}

/** How many runs of close-all the page sent, of the requests `plane` saw since `from`: what the wire carried, which no role names. */
export function closeAllsSent(plane: Pick<Plane, 'sent'>, from = 0): number {
  return plane.sent.slice(from).filter((request) => request.method === 'POST' && /\/actions\/close-all\/run$/.test(request.path)).length
}

/** Wait until the bar's line says `said`. */
export async function barSays(said: string): Promise<void> {
  await waitFor(() => expect(choiceSaid()).toBe(said), ARRIVES)
}
