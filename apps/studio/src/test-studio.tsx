import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import { computeAccessibleName } from 'dom-accessibility-api'
import { ACCESSIBILITY_EXCLUSIONS, ACCESSIBILITY_TAGS, ACCESSIBILITY_UNMEASURABLE_IN_JSDOM } from '@formancy/conformance'
import { Studio } from './studio.js'
import type { TestPlane } from './test-server.js'
import { TOKENS } from './test-server.js'

/**
 * How the suite drives the studio: as a person would, by role and accessible
 * name (formancy.ai 0034), against the real server behind `plane.fetch`.
 */

export type User = ReturnType<typeof userEvent.setup>

/**
 * The document the studio is served as, applied to jsdom's, so the audit
 * checks the language and title index.html actually carries.
 */
export function servedDocument(): void {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8')
  const served = new DOMParser().parseFromString(html, 'text/html')
  document.documentElement.lang = served.documentElement.lang
  document.title = served.title
}

/**
 * The studio, mounted where index.html mounts it: in a `#root`. Not in a bare
 * container, because then an element of the studio's own with the id `root`
 * would be the only one, and a label pointing at it would work here and label
 * the mount point in the browser -- which is how the root table's select lost
 * its name, found by the browser gate.
 */
export function mount(fetch: typeof globalThis.fetch): void {
  const root = document.createElement('div')
  root.id = 'root'
  render(<Studio fetch={fetch} />, { container: document.body.appendChild(root) })
}

/** The studio, rendered and signed in with `token`, at the first step. */
export async function signIn(plane: TestPlane, token: string = TOKENS.admin): Promise<User> {
  servedDocument()
  const user = userEvent.setup()
  mount(plane.fetch)
  await user.type(screen.getByLabelText('Host token'), token)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('navigation', { name: 'Steps' })
  return user
}

/** The step on screen: the main landmark, named by the step's heading. */
export function step(name: string): HTMLElement {
  return screen.getByRole('main', { name })
}

/** Go to a step through the step list, as a keyboard user's Enter on the button would. */
export async function goTo(user: User, name: string): Promise<HTMLElement> {
  await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: new RegExp(`^\\d+\\. ${name}`) }))
  return step(name)
}

/** Connect `connection` and discover it, from the Connect step. */
export async function discover(user: User, connection = 'fixture'): Promise<void> {
  const row = screen.getByRole('group', { name: connection })
  await user.click(within(row).getByRole('button', { name: `Discover ${connection}` }))
  await screen.findByRole('region', { name: `What ${connection} can see` })
}

/**
 * The order form the journey builds, from the Connect step: the fixture
 * discovered, the customer lookup, the tenant pinned, and the version column
 * confirmed, so create and update are both offered.
 */
export async function chooseOrder(user: User): Promise<HTMLElement> {
  await discover(user)
  await user.click(screen.getByRole('button', { name: 'Choose a root' }))
  const choose = step('Choose')
  await user.selectOptions(within(choose).getByLabelText('Root table or view'), 'sales.order')
  await user.click(within(choose).getByRole('checkbox', { name: 'Offer fk_order_customer as a lookup' }))
  await user.click(within(choose).getByRole('checkbox', { name: 'Pin tenant_id' }))
  await user.selectOptions(within(choose).getByLabelText('Version column'), 'row_version')
  return choose
}

/** Choose the order and generate it, landing on the Generate step. */
export async function generateOrder(user: User): Promise<HTMLElement> {
  const choose = await chooseOrder(user)
  await user.click(within(choose).getByRole('button', { name: 'Generate the form' }))
  return screen.findByRole('main', { name: 'Generate' })
}

/**
 * A policy for the order that fits it: clerks may do everything, every field
 * readable, every writable one writable, and the customer list pinned to the
 * clerk's tenant, as validatePolicy demands for a lookup that sets a pinned
 * column.
 */
export async function writeOrderPolicy(user: User): Promise<HTMLElement> {
  const policy = await goTo(user, 'Policy')
  for (const operation of ['read', 'create', 'update']) {
    await user.type(within(policy).getByLabelText(`Roles that may ${operation}`), 'clerk')
  }
  await user.click(within(policy).getByRole('button', { name: 'Fill every field from the operations' }))
  await waitFor(() => expect(within(within(policy).getByRole('region', { name: 'Policy check' })).getByRole('status').textContent).toMatch(/fits this form/))
  return policy
}

/**
 * axe over the whole document at WCAG 2.2 AA, with only what jsdom cannot
 * measure switched off, and the page-structure rules a form fragment is
 * excused from upstream -- this is an application, not a fragment.
 */
export async function audit(): Promise<string[]> {
  const wcag = await axe.run(document, {
    runOnly: { type: 'tag', values: [...ACCESSIBILITY_TAGS] },
    rules: Object.fromEntries(Object.keys(ACCESSIBILITY_UNMEASURABLE_IN_JSDOM).map((rule) => [rule, { enabled: false }])),
  })
  const structure = await axe.run(document, { runOnly: { type: 'rule', values: Object.keys(ACCESSIBILITY_EXCLUSIONS) } })
  return [...wcag.violations, ...structure.violations].map((violation) => `${violation.id}: ${violation.nodes[0]?.html.slice(0, 120) ?? ''}`)
}

/** Every link, button and control on the page whose accessible name is empty. */
export function unnamed(): string[] {
  const roles = ['link', 'button', 'textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'spinbutton', 'switch'] as const
  return roles
    .flatMap((role) => screen.queryAllByRole(role))
    .filter((element) => computeAccessibleName(element).trim() === '')
    .map((element) => element.outerHTML.slice(0, 100))
}

/**
 * Enter on `button`, as a keyboard user presses it: focused first, so where
 * the focus goes afterwards is the studio's doing and not the pointer's.
 */
export async function pressEnter(user: User, button: HTMLElement): Promise<void> {
  button.focus()
  await user.keyboard('{Enter}')
}

/** The accessible name of what has the keyboard's focus; the page itself when nothing does. */
export function focusedName(): string {
  const element = document.activeElement
  return element === null || element === document.body ? 'the page itself' : computeAccessibleName(element)
}

/** What the paragraphs in `container` say, in order: prose has a role and no name. */
export function paragraphs(container: HTMLElement): string[] {
  return within(container)
    .queryAllByRole('paragraph')
    .map((paragraph) => paragraph.textContent ?? '')
}
