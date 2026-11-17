import { expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { CLOSE_WORDS, actionForm } from './test-actions.js'
import { chooseForm, chooseRenderer, load, loaded, mount, signIn } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/**
 * How the suites drive an action over the open record (0162): the action
 * order of the actions schema and its close (test-actions.ts), through its
 * button in the detail's header and the region under it, by role and
 * accessible name, as test-host.ts drives the rest of the page.
 */

const ARRIVES = { timeout: 15_000 }

/** The action region's name: the action and the record, and a question mark while it confirms. */
export const closing = (record: string, confirming = false): string => `${CLOSE_WORDS.label}: Order ${record}${confirming ? '?' : ''}`

/** The region asking, confirming, or done, by its name. */
export function closeRegion(record: string, confirming = false): HTMLElement {
  return screen.getByRole('region', { name: closing(record, confirming) })
}

/** Wait for the region `name` names, and return it. */
export async function region(name: string): Promise<HTMLElement> {
  return screen.findByRole('region', { name }, ARRIVES)
}

/**
 * The page on `engine`'s action order `record`, signed in as tenant 1's
 * clerk, the renderer switch on `renderer`, and the order loaded into the
 * detail by its token -- as the demo's Load opens it -- once it says so.
 */
export async function openActionOrder(
  fetch: typeof globalThis.fetch,
  engine: Pick<Engine, 'connection'>,
  record: string,
  renderer: RendererName | 'Both' = 'React',
): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await openOrderIn(user, engine, record, renderer)
  return user
}

/** `openActionOrder` on a page already signed in. */
export async function openOrderIn(user: User, engine: Pick<Engine, 'connection'>, record: string, renderer: RendererName | 'Both' = 'React'): Promise<void> {
  await chooseForm(user, actionForm(engine))
  await chooseRenderer(user, renderer)
  await load(user, record)
  await loaded(record)
}

/** The dialog's paper in the asking region: the form landmark the renderer draws it in. */
export function dialogPaper(record: string, renderer: RendererName): HTMLElement {
  return within(closeRegion(record)).getByRole('form', { name: `${CLOSE_WORDS.label}, ${renderer}` })
}

/**
 * Close the order asked for: its button in the header, the note typed into
 * the dialog the renderer draws, and Continue -- the confirmation, focused,
 * once it is there.
 */
export async function askClose(user: User, record: string, renderer: RendererName, note: string): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: CLOSE_WORDS.label }))
  await region(closing(record))
  const box = await waitFor(() => within(dialogPaper(record, renderer)).getByRole('textbox', { name: /^Note\b/ }), ARRIVES)
  await user.type(box, note)
  await user.click(within(dialogPaper(record, renderer)).getByRole('button', { name: 'Continue' }))
  return region(closing(record, true))
}

/** Run it, in the confirmation. Nothing is waited for. */
export async function runIt(user: User, record: string): Promise<void> {
  await user.click(within(closeRegion(record, true)).getByRole('button', { name: 'Run it' }))
}

/** Wait until the region says close ran, and return it. */
export async function closed(record: string): Promise<HTMLElement> {
  return waitFor(() => {
    const done = closeRegion(record)
    expect(within(done).getByText(CLOSE_WORDS.done)).toBeTruthy()
    return done
  }, ARRIVES)
}

/** How many runs of close the page sent, of the requests `plane` saw since `from`: what the wire carried, which no role names. */
export function runsSent(plane: Pick<Plane, 'sent'>, from = 0): number {
  return plane.sent.slice(from).filter((request) => request.method === 'POST' && /\/actions\/close\/run$/.test(request.path)).length
}
