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
 * their heading names, so a helper here cannot favour one renderer.
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

/** Type a token and a form id into the sign-in form and open it. Nothing is waited for. */
export async function signIn(user: User, token: string, formId: string): Promise<void> {
  await user.type(screen.getByLabelText('Host token'), token)
  await user.type(screen.getByLabelText('Form id'), formId)
  await user.click(screen.getByRole('button', { name: 'Open the form' }))
}

/** The page, signed in as `token` with `formId` open, once both renderers have drawn it. */
export async function openForm(plane: Plane, formId: string, token: string = TOKENS.clerk): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, token, formId)
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

/** Load a record into both panes through the record bar. Nothing is waited for: the caller says what it expects to see. */
export async function load(user: User, record: string): Promise<void> {
  const bar = screen.getByRole('region', { name: 'Record' })
  const box = within(bar).getByRole('textbox', { name: 'Record token' })
  await user.clear(box)
  await user.type(box, record)
  await user.click(within(bar).getByRole('button', { name: 'Load' }))
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
