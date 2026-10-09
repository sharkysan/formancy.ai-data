import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { audit, focusedName, paragraphs, unnamed } from './test-accessible.js'
import { answer, answerable, chooseCustomer, load, mount, notice, openForm, pane, paper, rendered, RENDERERS, said, save, shows, signIn, unknownNotice } from './test-host.js'
import { EDGES, ENGINES, losingWrites, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'
import { CHANGED_SINCE_UNKNOWN } from './session.js'

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

/** A fresh order of tenant 1's, made beside the page: the case is what happens to it, not how it was made. */
async function freshOrder(formId: string): Promise<string> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  const name = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(formId, name, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1' })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return created.value.record
}

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

  // A save whose answer was lost is not "Not saved" (0031): it may have been,
  // and the page says so, in the client's words, in a region the keyboard is
  // taken to. The create holds the form: a press sends nothing and says why.
  // An order's key is numbered by the database, so checking says nobody here
  // can tell, and one more create goes through only after the person has
  // confirmed it -- and the notice holds the floor in each of those states.
  test('a save whose answer is lost says it may have been saved, holds the create, and passes the floor', async () => {
    const losing = losingWrites(plane.fetch, { when: 'after' })
    const user = mount(losing.fetch)
    await signIn(user, TOKENS.clerk, formId)
    await rendered()
    const notes = `lost on the page ${connection} ${String(Date.now())}`
    await chooseCustomer(user, 'React', 'Muster', 'Muster AG')
    await answer(user, 'React', 'Order date', EDGES.orderDate)
    await answer(user, 'React', 'Amount', '31')
    await answer(user, 'React', 'Notes', notes)
    await save(user, 'React')

    await waitFor(() => expect(unknownNotice('React')).not.toBeNull())
    const lost = unknownNotice('React') as HTMLElement
    expect(paragraphs(lost)[0]).toBe('The answer to this save was lost between this page and the data server. It may have been saved.')
    await waitFor(() => expect(focusedName()).toBe('React It may have been saved'))
    expect(notice('React')).toBeNull()
    expect(within(pane('React')).queryByRole('alert')).toBeNull()
    expect(await floor('unknown notice')).toEqual(CLEAN('unknown notice'))

    await save(user, 'React')
    await said('React', /^Nothing was sent: the last save may have been stored\. Check whether it was saved first\.$/)
    expect(await plane.db.countOrders(connection, notes)).toBe(1)

    await user.click(within(lost).getByRole('button', { name: 'Check whether it was saved' }))
    await said('React', /^This form cannot tell: the answer was lost before the server could say which record it made\./)
    // Asked once more, with the keyboard on the answer; Cancel takes it back.
    await user.click(within(lost).getByRole('button', { name: 'Enter it again anyway' }))
    await waitFor(() => expect(focusedName()).toBe('Allow saving it again'))
    await user.click(within(lost).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(focusedName()).toBe('Enter it again anyway'))
    expect(within(lost).queryByRole('group')).toBeNull()
    await user.click(within(lost).getByRole('button', { name: 'Enter it again anyway' }))
    const confirm = within(lost).getByRole('group', { name: /entering it again may store it twice\.$/ })
    await waitFor(() => expect(focusedName()).toBe('Allow saving it again'))
    expect(await floor('unknown notice, confirming')).toEqual(CLEAN('unknown notice, confirming'))

    await user.click(within(confirm).getByRole('button', { name: 'Allow saving it again' }))
    await said('React', /^Press Save to enter it again\.$/)
    await save(user, 'React')
    await said('React', /^Created record k1:\S+\.$/)
    expect(await plane.db.countOrders(connection, notes)).toBe(2)
  })

  // A second save into a notice that is already open is a new unknown save,
  // and the notice must start again for it: kept, it went on saying "Press
  // Save to enter it again." over a create that holds again, with the
  // confirmation gone for good -- the only way out was to throw the draft
  // away. And the keyboard follows "Enter it again anyway" every time it is
  // pressed, a check in between included, rather than falling to the page.
  test('a second unknown save starts the notice again, and the keyboard follows each "Enter it again anyway"', async () => {
    const losing = losingWrites(plane.fetch, { when: 'after', times: 2 })
    const user = mount(losing.fetch)
    await signIn(user, TOKENS.clerk, formId)
    await rendered()
    const notes = `lost twice on the page ${connection} ${String(Date.now())}`
    await chooseCustomer(user, 'React', 'Muster', 'Muster AG')
    await answer(user, 'React', 'Order date', EDGES.orderDate)
    await answer(user, 'React', 'Amount', '32')
    await answer(user, 'React', 'Notes', notes)
    await save(user, 'React')
    await waitFor(() => expect(unknownNotice('React')).not.toBeNull())
    let lost = unknownNotice('React') as HTMLElement

    await user.click(within(lost).getByRole('button', { name: 'Check whether it was saved' }))
    await user.click(await within(lost).findByRole('button', { name: 'Enter it again anyway' }))
    await waitFor(() => expect(focusedName()).toBe('Allow saving it again'))
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(focusedName()).toBe('Check whether it was saved')
    await user.keyboard('{Enter}')
    await user.click(await within(lost).findByRole('button', { name: 'Enter it again anyway' }))
    await waitFor(() => expect(focusedName()).toBe('Allow saving it again'))

    await user.click(within(lost).getByRole('button', { name: 'Allow saving it again' }))
    await said('React', /^Press Save to enter it again\.$/)
    await save(user, 'React')
    await waitFor(() => expect(losing.lost).toHaveLength(2))
    await waitFor(() => expect(focusedName()).toBe('React It may have been saved'))
    lost = unknownNotice('React') as HTMLElement
    expect(within(lost).getByRole('status').textContent).toBe('')
    await save(user, 'React')
    await said('React', /^Nothing was sent: the last save may have been stored\./)
    await user.click(within(lost).getByRole('button', { name: 'Check whether it was saved' }))
    await within(lost).findByRole('button', { name: 'Enter it again anyway' })
    expect(await plane.db.countOrders(connection, notes)).toBe(2)
  })

  // An update protects itself, so nothing is held. Lost after the server
  // stored it, a Save with the version it sent is stale by its own doing and
  // still unknown; the check finds the record moved on, and "Load the saved
  // record" replaces the draft with it, says so on the pane's line and
  // leaves the keyboard on the pane's heading, as after a stale save.
  test('an update whose answer is lost checks as changed, and loads the saved record', async () => {
    const record = await freshOrder(formId)
    const losing = losingWrites(plane.fetch, { when: 'after' })
    const user = mount(losing.fetch)
    await signIn(user, TOKENS.clerk, formId)
    await rendered()
    await load(user, record)
    await shows('React', 'Amount', '1.0000')
    const notes = `lost update on the page ${connection} ${String(Date.now())}`
    await answer(user, 'React', 'Notes', notes)
    await save(user, 'React')
    await waitFor(() => expect(unknownNotice('React')).not.toBeNull())
    let lost = unknownNotice('React') as HTMLElement

    // Saved again as the 502 invites, and stale by its own doing: still the
    // unknown notice, never a "Not saved" over a change that is stored.
    await save(user, 'React')
    await waitFor(() => expect(paragraphs(unknownNotice('React') as HTMLElement)[0]).toBe(CHANGED_SINCE_UNKNOWN))
    expect(notice('React')).toBeNull()
    lost = unknownNotice('React') as HTMLElement

    await user.click(within(lost).getByRole('button', { name: 'Check whether it was saved' }))
    await said('React', /^The record has changed since it was read, by this save or by someone else\.$/)
    await user.click(within(lost).getByRole('button', { name: 'Load the saved record' }))
    await shows('React', 'Notes', notes)
    await said('React', /^Loaded the saved record\. Your changes were discarded\.$/)
    expect(unknownNotice('React')).toBeNull()
    await waitFor(() => expect(focusedName()).toBe('React'))
  })

  // Lost before it reached the server: a check that cannot read says so and
  // that the outcome is still unknown -- never "absent" or "not saved" --
  // and once the database answers, the record is still at the version sent,
  // so pressing Save sends it again with that version, and it is saved.
  test('an update lost before it was sent checks as unchanged, a failed check says it is still unknown, and Save then saves', async () => {
    const record = await freshOrder(formId)
    const losing = losingWrites(plane.fetch, { when: 'before' })
    const user = mount(losing.fetch)
    await signIn(user, TOKENS.clerk, formId)
    await rendered()
    await load(user, record)
    await shows('React', 'Amount', '1.0000')
    await answer(user, 'React', 'Amount', '7')
    await save(user, 'React')
    await waitFor(() => expect(unknownNotice('React')).not.toBeNull())
    const lost = unknownNotice('React') as HTMLElement

    plane.unreachable.add(connection)
    try {
      await user.click(within(lost).getByRole('button', { name: 'Check whether it was saved' }))
      await said('React', /^It could not be checked: The database cannot be reached\. Nothing was saved\. Whether the save was stored is still unknown\.$/)
    } finally {
      plane.unreachable.delete(connection)
    }
    await user.click(within(lost).getByRole('button', { name: 'Check whether it was saved' }))
    await said('React', /^Not in the record yet\. Saving again is safe: press Save; it is stored at most once\.$/)
    await save(user, 'React')
    await said('React', /^Saved\.$/)
    const stored = await plane.clerk.read(formId, record)
    expect(stored.ok && stored.value.answers['amount']).toBe('7.0000')
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
