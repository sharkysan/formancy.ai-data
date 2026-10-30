import { expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { discover, goTo, signIn } from './test-studio.js'
import type { User } from './test-studio.js'
import { TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * How the Browse step's suites drive it (0099): by role and accessible name
 * (formancy.ai 0034), signed in as a holder of a browse role, against the
 * real server behind `plane.fetch` -- a page, its grid, its status line and
 * a row's related rows (0103), shared by the step's suite and its filter's
 * (0104).
 */

/** The step on screen. */
export const browseStep = (): HTMLElement => screen.getByRole('main', { name: 'Browse' })

/** What the page's status line, the live region a screen reader announces, says. */
export const status = (): string | null => within(browseStep()).getByRole('status').textContent

/** Waits for the status line to say `text`. */
export const statusSays = (text: string): Promise<void> => waitFor(() => expect(status()).toBe(text))

/** The object the selector names. */
export const chosen = (): string => within(browseStep()).getByLabelText<HTMLSelectElement>('Table or view').value

/** Every browse the studio asked the plane for, in order. */
export const browseRequests = (plane: TestPlane): TestPlane['requests'] => plane.requests.filter((request) => request.path.endsWith('/browse'))

/** The grid's rows as the cells' text, the header row first. */
export function grid(): string[][] {
  // The grid's own region, named by its caption -- "sales.country, rows 1 to 2" -- beside the section named by its heading.
  const table = within(screen.getByRole('region', { name: /^sales\.[^ ]+, / })).getByRole('table')
  return within(table)
    .getAllByRole('row')
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
