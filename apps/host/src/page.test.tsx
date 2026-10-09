import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { audit, focusedName, paragraphs, unnamed } from './test-accessible.js'
import { answer, answerable, chooseCustomer, load, mount, notice, openForm, pane, paper, RENDERERS, said, save, shows, signIn } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The page around the forms: that it opens what the server publishes, says
 * what the server refuses in the server's words, keeps the token where it
 * says it does, and can be used -- every state a person reaches held to axe
 * at WCAG 2.2 AA and to a name on every control.
 *
 * Everything is found by role and accessible name (formancy.ai 0034). What
 * jsdom cannot see -- layout, colour, the keyboard in a real browser -- is
 * scripts/browser-test.mjs's.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

afterEach(cleanup)

/** The state's name, and what axe and the name check found in it: both empty, or the state says which failed. */
async function floor(state: string): Promise<{ state: string; axe: string[]; unnamed: string[] }> {
  return { state, axe: await audit(), unnamed: unnamed() }
}

const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })

// Signed out is the same page whatever database is behind it: one form, two
// fields and a button, and the first thing a keyboard meets after the skip
// link is the token.
test('signed out, the page asks for a token and a form id, and passes the floor', async () => {
  mount(plane.fetch)
  expect(screen.getByRole('heading', { level: 1, name: 'A published form, in both renderers' })).toBeTruthy()
  screen.getByRole('link', { name: 'Skip to the form' })
  screen.getByLabelText('Host token')
  screen.getByRole('textbox', { name: 'Form id' })
  screen.getByRole('button', { name: 'Open the form' })
  expect(await floor('signed out')).toEqual(CLEAN('signed out'))
})

describe.each(ENGINES)('the page on $engine', ({ connection, formId }) => {
  // The definition is the server's: every field it publishes, in both
  // renderers, by the label it carries -- a field one renderer dropped, or
  // a renderer that never started, is a name missing from one list.
  test('opens the form, and both panes draw every field by its label', async () => {
    await openForm(plane, formId)
    const definition = await plane.clerk.form(formId)
    if (!definition.ok) throw new Error(definition.message)
    const labels = definition.value.form.model.fields.map((field) => String(field.label)).sort()
    for (const renderer of RENDERERS) {
      const names = answerable(paper(renderer), labels)
        .map((element) => computeAccessibleName(element))
        .sort()
      expect({ renderer, names }).toEqual({ renderer, names: labels })
    }
    // What the definition allows, said from the server's answer.
    expect(paragraphs(screen.getByRole('main'))).toContain(`${formId}: you may read, create and update records with this form.`)
    expect(focusedName()).toBe('Record token')
  })

  // Every state a person reaches is held to the floor, not the first one
  // only: a notice, an error summary and a field error each add markup, and
  // each is where a missing name or a broken reference turns up.
  test('passes the floor open, loaded, saved, after a stale save and after a refused selection', async () => {
    const user = await openForm(plane, formId)
    expect(await floor('open')).toEqual(CLEAN('open'))

    await load(user, EDGES.seededOrder)
    for (const renderer of RENDERERS) await shows(renderer, 'Customer', 'Muster AG')
    expect(await floor('loaded')).toEqual(CLEAN('loaded'))

    await answer(user, 'React', 'Notes', 'from the page suite')
    await save(user, 'React')
    await said('React', /^Saved\.$/)
    expect(await floor('saved')).toEqual(CLEAN('saved'))

    await answer(user, 'Angular', 'Notes', 'a stale change')
    await save(user, 'Angular')
    await waitFor(() => expect(notice('Angular')).not.toBeNull())
    expect(await floor('stale notice')).toEqual(CLEAN('stale notice'))

    const no = connection === 'pg' ? 8301 : 8302
    await plane.db.insertCustomer(connection, no, `Seiten Kunde ${String(no)}`)
    await chooseCustomer(user, 'React', 'Seiten', `Seiten Kunde ${String(no)}`)
    await plane.db.deleteCustomer(connection, no)
    await save(user, 'React')
    await said('React', /^Not saved\./)
    expect(await floor('refused selection')).toEqual(CLEAN('refused selection'))
  })

  // The server's refusal, in its words, where the person asked: a page that
  // said "something went wrong" would leave them unable to tell a bad token
  // from a missing form.
  test('a token the server does not accept is its sentence, at open', async () => {
    const user = mount(plane.fetch)
    await signIn(user, 'not-a-host-token', formId)
    expect((await screen.findByRole('alert')).textContent).toBe('A valid host token is required.')
    expect(screen.queryByRole('region', { name: 'React' })).toBeNull()
  })

  // A record the person may not see does not exist for them: tenant 1's
  // seeded order, loaded by tenant 2's clerk, is the server's 404 sentence,
  // and neither pane changes.
  test('a record that is not there is the server sentence, on load', async () => {
    const user = await openForm(plane, formId, TOKENS.otherClerk)
    await load(user, EDGES.seededOrder)
    const bar = screen.getByRole('region', { name: 'Record' })
    expect((await within(bar).findByRole('alert')).textContent).toBe('No such record.')
    for (const renderer of RENDERERS) expect(within(pane(renderer)).getByRole('combobox', { name: 'Customer' })).toHaveProperty('value', '')
  })

  // New empties both panes for a new record, and the next save creates one:
  // a pane that kept the loaded record's token would update it instead.
  test('New record empties both panes, and a save then creates', async () => {
    const user = await openForm(plane, formId)
    await load(user, EDGES.seededOrder)
    for (const renderer of RENDERERS) await shows(renderer, 'Customer', 'Muster AG')
    const bar = screen.getByRole('region', { name: 'Record' })
    await user.click(within(bar).getByRole('button', { name: 'New record' }))
    for (const renderer of RENDERERS) {
      await shows(renderer, 'Customer', '')
      await shows(renderer, 'Amount', '')
    }
    await chooseCustomer(user, 'Angular', 'Muster', 'Muster AG')
    await answer(user, 'Angular', 'Order date', EDGES.orderDate)
    await answer(user, 'Angular', 'Amount', '2')
    await save(user, 'Angular')
    await said('Angular', /^Created record k1:\S+\.$/)
  })

  // Signing out forgets the client, and the token with it: the page is back
  // at the question, with nothing filled in, and the forms are gone. The
  // button the keyboard was on went with them, so the keyboard goes to the
  // question -- as opening the form takes it to the record token -- rather
  // than to the top of the page, a whole page of Tabs from anything.
  test('Sign out goes back to the question, with the token forgotten', async () => {
    const user = await openForm(plane, formId)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.queryByRole('region', { name: 'React' })).toBeNull()
    expect((screen.getByLabelText('Host token') as HTMLInputElement).value).toBe('')
    expect(focusedName()).toBe('Host token')
    expect(document.documentElement.outerHTML).not.toContain(TOKENS.clerk)
  })

  // The token is held in the client's closure and nowhere a script, an
  // extension or the next person at the machine could read it back.
  test('the token is in no storage, no cookie, no address and nowhere in the document', async () => {
    await openForm(plane, formId)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    expect(window.location.href).not.toContain(TOKENS.clerk)
    expect(document.documentElement.outerHTML).not.toContain(TOKENS.clerk)
  })
})
