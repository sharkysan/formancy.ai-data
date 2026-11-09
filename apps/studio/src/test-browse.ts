import { expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { discover, goTo, signIn } from './test-studio.js'
import type { User } from './test-studio.js'
import { TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * How the Browse step's suites drive it (0099): by role and accessible name
 * (formancy.ai 0034), signed in as a holder of a browse role, against the
 * real server behind `plane.fetch` -- a page, its grid, its status line, a
 * row's related rows (0103), and its filter (0104): the line, the chips and
 * the columns' header boxes (0147) -- shared by the step's suite and its
 * filter's.
 */

/** The step on screen. */
export const browseStep = (): HTMLElement => screen.getByRole('main', { name: 'Browse' })

/** What the page's status line, the live region a screen reader announces, says: the step's one status with no name, the filter line's being named by its label. */
export const status = (): string | null => within(browseStep()).getByRole('status', { name: '' }).textContent

/** Waits for the status line to say `text`. */
export const statusSays = (text: string): Promise<void> => waitFor(() => expect(status()).toBe(text))

/** The object the selector names. */
export const chosen = (): string => within(browseStep()).getByLabelText<HTMLSelectElement>('Table or view').value

/** Every browse the studio asked the plane for, in order. */
export const browseRequests = (plane: TestPlane): TestPlane['requests'] => plane.requests.filter((request) => request.path.endsWith('/browse'))

/** The grid's region, named by its caption -- "sales.country, rows 1 to 2" -- beside the section named by its heading. */
export const rowsRegion = (): HTMLElement => screen.getByRole('region', { name: /^sales\.[^ ]+, / })

/**
 * The grid's rows as the cells' text, the header row first; the row of
 * header boxes (0147), which holds controls rather than text, left out --
 * told apart by the text boxes and selects in it, which no other row has.
 */
export function grid(): string[][] {
  const table = within(rowsRegion()).getByRole('table')
  return within(table)
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('textbox').length + within(row).queryAllByRole('combobox').length === 0)
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''))
}

/** `object` chosen, `search` typed, and Show rows pressed, once its page is on screen. */
export async function show(user: User, object: string, search = ''): Promise<void> {
  const browse = browseStep()
  await user.selectOptions(within(browse).getByLabelText('Table or view'), object)
  const box = within(browse).getByLabelText('Search')
  await user.clear(box)
  if (search !== '') await user.type(box, search)
  await user.click(within(browse).getByRole('button', { name: 'Show rows' }))
  await screen.findByRole('region', { name: new RegExp(`^${object.replace('.', '\\.')},`) })
}

/** Signed in as a browser, the fixture discovered, on the Browse step. */
export async function browsing(plane: TestPlane): Promise<User> {
  const user = await signIn(plane, TOKENS.browser)
  await discover(user)
  await goTo(user, 'Browse')
  return user
}

/** A row's related rows opened by its button, and the section that says them. */
export async function openRelated(user: User, row: number): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: `Related to row ${String(row)}` }))
  return screen.getByRole('region', { name: new RegExp(`^Related to row ${String(row)} of `) })
}

/** What a list of the step offers, each entry as its text. */
export const entries = (name: string): Array<string | null> =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

/** The page's own heading, which a follow and a Back put the keyboard on. */
export const pageHeading = (name: string): HTMLElement => screen.getByRole('heading', { level: 3, name })

/** The filter line (0147): a combobox, named by its label. */
export const filterLine = (): HTMLInputElement => within(browseStep()).getByRole<HTMLInputElement>('combobox', { name: 'Filter' })

/** Why the line could not be read, as the status under it says: a live region named by the line's label. */
export const lineProblem = (): string | null => within(browseStep()).getByRole('status', { name: 'Filter' }).textContent

/** `text` typed into the line in place of what it shows, and Enter pressed. Nothing is waited for. */
export async function typeFilter(user: User, text: string): Promise<void> {
  const line = filterLine()
  await user.clear(line)
  if (text !== '') await user.type(line, text)
  await user.keyboard('{Enter}')
}

/** The text box under the header of `column` (0147). */
export const headerBox = (column: string): HTMLInputElement => within(rowsRegion()).getByRole<HTMLInputElement>('textbox', { name: `Filter ${column}` })

/** The conditions the page is filtered by, each as its chip's Remove names it, without the word Remove; none when there are none. */
export function applied(): string[] {
  const list = within(browseStep()).queryByRole('list', { name: 'Filtered by' })
  return list === null
    ? []
    : within(list)
        .getAllByRole('button')
        .map((button) => computeAccessibleName(button).replace(/^Remove /, ''))
}

/** The options completion offers, each as its text: what is inserted, then what it means where that says more. */
export const offered = (): string[] =>
  within(within(browseStep()).getByRole('listbox', { name: 'What may come next' }))
    .queryAllByRole('option')
    .map((option) => option.textContent ?? '')
