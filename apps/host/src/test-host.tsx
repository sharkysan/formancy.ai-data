import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { getRole, isInaccessible } from 'dom-accessibility-api'
import { Host } from './host.js'
import type { Plane } from './test-plane.js'
import { TOKENS } from './test-plane.js'

/**
 * How the suites drive the host page: as a person would, by role and
 * accessible name (formancy.ai 0034), against the real server behind
 * `plane.fetch`. Both panes are reached the same way, through the region
 * their heading names, so a helper here cannot favour one renderer -- with
 * the renderer switch on Both, which is how the suites hold 0029's promise
 * that both renderers behave the same (0047).
 */

export type User = ReturnType<typeof userEvent.setup>

export const RENDERERS = ['React', 'Angular'] as const
export type RendererName = (typeof RENDERERS)[number]

/** How long Angular may take to arrive after a mount: it bootstraps asynchronously, a whole application per pane. */
const ARRIVES_WITHIN = { timeout: 15_000 }

/** The document the page is served as, applied to jsdom's, so the audit checks the language and title index.html carries. */
export function servedDocument(): void {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8')
  const served = new DOMParser().parseFromString(html, 'text/html')
  document.documentElement.lang = served.documentElement.lang
  document.title = served.title
}

/** The page, mounted where index.html mounts it, in a `#root`, as the studio's suite does and for its reason. */
export function mount(fetch: typeof globalThis.fetch): User {
  servedDocument()
  const root = document.createElement('div')
  root.id = 'root'
  render(<Host fetch={fetch} />, { container: document.body.appendChild(root) })
  return userEvent.setup()
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Type a token into the sign-in form and sign in. Nothing is waited for. */
export async function signIn(user: User, token: string): Promise<void> {
  await user.type(screen.getByLabelText('Host token'), token)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

/** A form's link under Forms: named by its title, then its id. */
export async function formLink(formId: string): Promise<HTMLElement> {
  const nav = await screen.findByRole('navigation', { name: 'Forms' }, ARRIVES_WITHIN)
  return within(nav).getByRole('link', { name: new RegExp(` ${escaped(formId)}$`) })
}

/** Choose a form under Forms, and wait until its Records grid has answered. */
export async function chooseForm(user: User, formId: string): Promise<void> {
  await user.click(await formLink(formId))
  await screen.findByRole('heading', { level: 2, name: new RegExp(` ${escaped(formId)}$`) }, ARRIVES_WITHIN)
  await answeredOnce('Records')
}

/** Wait until the status line of the grid named `heading` says something other than that it is loading. */
export async function answeredOnce(heading: string): Promise<string> {
  let said = ''
  await waitFor(() => {
    const status = within(gridSection(heading)).getAllByRole('status')[0]
    said = status?.textContent ?? ''
    expect(said === '' || /^Loading/.test(said), `the ${heading} grid still says "${said}"`).toBe(false)
  }, ARRIVES_WITHIN)
  return said
}

/** The section a grid's heading names: the Records panel, or a child section. */
export function gridSection(heading: string): HTMLElement {
  return screen.getByRole('region', { name: heading })
}

/** The renderer switch set to `choice`: Both, so every helper below finds both panes. */
export async function chooseRenderer(user: User, choice: 'React' | 'Angular' | 'Both' = 'Both'): Promise<void> {
  const radio = screen.getByRole('radio', { name: choice })
  if (!(radio as HTMLInputElement).checked) await user.click(radio)
}

/**
 * The page, signed in as `token`, with `formId` chosen under Forms, both
 * renderers on, and New record pressed: the form open in both panes for a
 * new record, once both renderers have drawn it.
 */
export async function openForm(plane: Plane, formId: string, token: string = TOKENS.clerk): Promise<User> {
  return openWith(plane.fetch, formId, token)
}

/** `openForm`, with the page given `fetch`: one that holds or loses writes. */
export async function openWith(fetch: typeof globalThis.fetch, formId: string, token: string = TOKENS.clerk): Promise<User> {
  const user = mount(fetch)
  await signIn(user, token)
  await chooseForm(user, formId)
  await chooseRenderer(user)
  await newRecord(user)
  await rendered()
  return user
}

/** One renderer's half of the page: the region its heading names. */
export function pane(renderer: RendererName): HTMLElement {
  return screen.getByRole('region', { name: renderer })
}

/** The white paper in a pane: the form landmark, named for the document and the renderer. */
export function paper(renderer: RendererName): HTMLElement {
  return within(pane(renderer)).getByRole('form', { name: `Order, ${renderer}` })
}

/** Wait until both renderers have drawn the form: the customer chooser, by role and name, in each paper. */
export async function rendered(): Promise<void> {
  await waitFor(() => {
    for (const renderer of RENDERERS) expect(within(paper(renderer)).queryByRole('combobox', { name: 'Customer' }), `${renderer} never drew the form`).not.toBeNull()
  }, ARRIVES_WITHIN)
}

/**
 * The control in a paper with exactly this accessible name. By label rather
 * than role, because the date input has none in ARIA ("no corresponding role"
 * in HTML-AAM); the name is the only handle the tree offers on it.
 */
export function control(renderer: RendererName, name: string): HTMLInputElement {
  return within(paper(renderer)).getByLabelText(name, { exact: true }) as HTMLInputElement
}

/** Wait until a control shows `value`: Angular redraws on its own schedule. */
export async function shows(renderer: RendererName, name: string, value: string): Promise<void> {
  await waitFor(() => expect({ renderer, name, value: control(renderer, name).value }).toEqual({ renderer, name, value }), ARRIVES_WITHIN)
}

/** Clear a text control and type `value`, as a person does. */
export async function answer(user: User, renderer: RendererName, name: string, value: string): Promise<void> {
  const element = control(renderer, name)
  await user.clear(element)
  await user.type(element, value)
}

/** Search the customer typeahead for `search` and choose the option called `label`. */
export async function chooseCustomer(user: User, renderer: RendererName, search: string, label: string): Promise<void> {
  const box = within(paper(renderer)).getByRole('combobox', { name: 'Customer' })
  await user.clear(box)
  await user.type(box, search)
  const option = await within(paper(renderer)).findByRole('option', { name: label }, ARRIVES_WITHIN)
  await user.click(option)
  await shows(renderer, 'Customer', label)
}

/** Press Save in a pane's paper. */
export async function save(user: User, renderer: RendererName): Promise<void> {
  await user.click(within(paper(renderer)).getByRole('button', { name: 'Save' }))
}

/** What every status line in a pane says: the pane's own and the typeahead's. */
export function statuses(renderer: RendererName): string[] {
  return within(pane(renderer))
    .queryAllByRole('status')
    .map((status) => status.textContent ?? '')
}

/** Wait until a pane's status says something matching `said`, and return it. */
export async function said(renderer: RendererName, pattern: RegExp): Promise<string> {
  let found = ''
  await waitFor(() => {
    found = statuses(renderer).find((text) => pattern.test(text)) ?? ''
    expect({ renderer, statuses: found === '' ? statuses(renderer) : 'found' }).toEqual({ renderer, statuses: 'found' })
  }, ARRIVES_WITHIN)
  return found
}

/** The notice a refused save opens in a pane, named by the pane and the notice's heading; null when there is none. */
export function notice(renderer: RendererName): HTMLElement | null {
  return within(pane(renderer)).queryByRole('region', { name: `${renderer} Not saved` })
}

/** The notice a save whose outcome is unknown opens in a pane (0031); null when there is none. */
export function unknownNotice(renderer: RendererName): HTMLElement | null {
  return within(pane(renderer)).queryByRole('region', { name: `${renderer} It may have been saved` })
}

/** Open the record-token tool if it is closed. */
export async function openTokenTool(user: User): Promise<void> {
  const disclosure = screen.getByRole('button', { name: 'Open by record token' })
  if (disclosure.getAttribute('aria-expanded') !== 'true') await user.click(disclosure)
}

/** Load a record into both panes by its token. Nothing is waited for: the caller says what it expects to see. */
export async function load(user: User, record: string): Promise<void> {
  await openTokenTool(user)
  const box = screen.getByRole('textbox', { name: 'Record token' })
  await user.clear(box)
  await user.type(box, record)
  await user.click(screen.getByRole('button', { name: 'Load' }))
}

/**
 * Wait until the detail says `record` was loaded. A pane already showing the
 * record -- one that followed a create in the other pane (0047) -- is no sign
 * that the Load has answered, and what is typed before it does is asked
 * about when it does.
 */
export async function loaded(record: string, title = 'Order'): Promise<void> {
  await waitFor(() => expect(within(screen.getByRole('region', { name: `${title} ${record}` })).getAllByRole('status')[0]?.textContent).toMatch(new RegExp(`^Loaded record ${escaped(record)} into `)), ARRIVES_WITHIN)
}

/**
 * Words only the records one test makes carry, written into their notes, so
 * the test finds them as a person finds what they made: by searching for
 * it. A page holds `LIST_PAGE_SIZE` rows in key order, and every file adds
 * its orders to the one database the run shares, in an order nothing fixes
 * -- so a new row looked for on the first page unsearched is there or not by
 * how many orders other files made first (PR #57's CI: the first page held
 * fifty older orders). Letters among the digits, so no integer column's
 * digits contain them, and nothing a LIKE pattern reads.
 */
export function stamp(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** The first cell of every data row in the Records grid: a record's key, as the grid shows it. */
export function recordKeys(): string[] {
  const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
  return within(grid)
    .getAllByRole('row')
    .flatMap((row) => {
      const cells = within(row).queryAllByRole('gridcell')
      return cells.length === 0 ? [] : [cells[0]?.textContent ?? '']
    })
}

/**
 * Search the Records grid for `words`, typed into Search and submitted, and
 * wait until it lists exactly the records `keys` names, in order: the page
 * the search asked for, and not the one it replaces, whose rows a test could
 * otherwise click as they went.
 */
export async function searchRecords(user: User, words: string, keys: readonly string[]): Promise<void> {
  const search = screen.getByRole('search', { name: 'Search records' })
  const box = within(search).getByRole('textbox', { name: 'Search' })
  await user.clear(box)
  await user.type(box, words)
  await user.click(within(search).getByRole('button', { name: 'Search' }))
  await waitFor(() => expect({ words, keys: recordKeys() }).toEqual({ words, keys }), ARRIVES_WITHIN)
}

/** Press New record in the Records panel: both panes empty for a new record. Nothing is waited for. */
export async function newRecord(user: User): Promise<void> {
  await user.click(within(gridSection('Records')).getByRole('button', { name: 'New record' }))
}

/** The unsaved-changes notice, or null when the page is not asking. */
export function unsavedNotice(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Unsaved changes' })
}

/** The roles ARIA gives a control a person answers with, as the examples page lists them. */
const ANSWERING_ROLES = ['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider', 'checkbox', 'switch', 'radio'] as const

/**
 * Every control in `container` a person answers with, by role -- and, for the
 * inputs ARIA gives no role, the date among them, by the names the caller
 * expects. The examples page's `answerable`, for its reason.
 */
export function answerable(container: HTMLElement, names: readonly string[]): HTMLElement[] {
  const scope = within(container)
  const byRole = ANSWERING_ROLES.flatMap((role) => scope.queryAllByRole(role))
  const byName = names.flatMap((name) => scope.queryAllByLabelText(name, { exact: true })).filter((element) => getRole(element) === null)
  return [...new Set([...byRole, ...byName])].filter((element) => !isInaccessible(element))
}
