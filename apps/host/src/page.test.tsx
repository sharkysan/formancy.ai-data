import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { audit, focusedName, paragraphs, unnamed } from './test-accessible.js'
import { answer, answerable, chooseCustomer, chooseForm, chooseRenderer, gridSection, load, mount, newRecord, notice, openForm, openWith, pane, paper, RENDERERS, said, save, shows, signIn, unknownNotice, unsavedNotice } from './test-host.js'
import { EDGES, ENGINES, holdingWrites, losingWrites, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'
import { PREFERENCES } from './prefs.js'
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
  plane = await startPlane({ children: true, deletes: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

/** The state's name, and what axe and the name check found in it: both empty, or the state says which failed. */
async function floor(state: string): Promise<{ state: string; axe: string[]; unnamed: string[] }> {
  return { state, axe: await audit(), unnamed: unnamed() }
}

const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })

/** A fresh order of tenant 1's, made beside the page: the case is what happens to it, not how it was made. `notes` finds it again. */
async function freshOrder(formId: string, notes?: string): Promise<string> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  const name = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(formId, name, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1', ...(notes === undefined ? {} : { notes }) })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return created.value.record
}

// Signed out is the same page whatever database is behind it: one field
// and a button -- the form is chosen from the menu once signed in -- and
// the first thing a keyboard meets after the skip link is the token.
test('signed out, the page asks for a token alone, and passes the floor', async () => {
  mount(plane.fetch)
  expect(screen.getByRole('heading', { level: 1, name: 'Published forms, in both renderers' })).toBeTruthy()
  screen.getByRole('link', { name: 'Skip to the workspace' })
  screen.getByLabelText('Host token')
  expect(screen.queryByRole('textbox', { name: 'Form id' })).toBeNull()
  screen.getByRole('button', { name: 'Sign in' })
  expect(await floor('signed out')).toEqual(CLEAN('signed out'))
})

describe.each(ENGINES)('the page on $engine', ({ connection, formId, lines }) => {
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
    // What the definition allows, said from the server's answer, as tags.
    expect(within(screen.getByRole('list', { name: 'Operations' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Read', 'Create', 'Update', 'Delete'])
    // New record took the keyboard to the record's heading.
    expect(focusedName()).toBe('New record')
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
    await waitFor(() => expect(notice('Angular')).not.toBeNull(), { timeout: 15_000 })
    expect(await floor('stale notice')).toEqual(CLEAN('stale notice'))

    const no = connection === 'pg' ? 8301 : 8302
    await plane.db.insertCustomer(connection, no, `Seiten Kunde ${String(no)}`)
    await chooseCustomer(user, 'React', 'Seiten', `Seiten Kunde ${String(no)}`)
    await plane.db.deleteCustomer(connection, no)
    await save(user, 'React')
    await said('React', /^Not saved\./)
    expect(await floor('refused selection')).toEqual(CLEAN('refused selection'))
  })

  // The workspace's own states, each held to the floor: signed in with no
  // form open, a form's records, a record open with its lines, a line open
  // under it, the unsaved-changes notice, the record view of Separate views,
  // and a refused list. Each adds markup -- a grid, a separator, a child's
  // panes, a notice -- where a missing name or a broken reference turns up.
  test("passes the floor in the workspace's states", async () => {
    // A list refused by the real server when the test says: its database unreachable for that one request.
    let refuse = false
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname
      if (!refuse || !path.endsWith('/records/list')) return plane.fetch(input, init)
      refuse = false
      plane.unreachable.add(connection)
      try {
        return await plane.fetch(input, init)
      } finally {
        plane.unreachable.delete(connection)
      }
    }
    const user = mount(fetch)
    await signIn(user, TOKENS.clerk)
    await screen.findByRole('heading', { level: 2, name: 'No form open' }, { timeout: 15_000 })
    expect(await floor('signed in, no form')).toEqual(CLEAN('signed in, no form'))
    await chooseForm(user, formId)
    await chooseRenderer(user)
    expect(await floor('records')).toEqual(CLEAN('records'))

    await load(user, EDGES.seededOrder)
    await shows('Angular', 'Customer', 'Muster AG')
    await waitFor(() => expect(within(gridSection('Order line')).getAllByRole('status')[0]?.textContent).toMatch(/^Order line rows 1–/), { timeout: 15_000 })
    expect(await floor('a record and its lines')).toEqual(CLEAN('a record and its lines'))

    const lines = within(gridSection('Order line')).getByRole('grid', { name: 'Order line' })
    await user.click(within(lines).getAllByRole('gridcell')[0] as HTMLElement)
    await waitFor(() => expect(screen.getByRole('region', { name: `Order line ${EDGES.seededOrder},1 Angular` })).toBeTruthy(), { timeout: 15_000 })
    await within(screen.getByRole('region', { name: `Order line ${EDGES.seededOrder},1 Angular` })).findByRole('spinbutton', { name: /^Quantity/ }, { timeout: 15_000 })
    expect(await floor('a line open')).toEqual(CLEAN('a line open'))

    await answer(user, 'React', 'Notes', 'a draft on the floor')
    await newRecord(user)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull())
    expect(await floor('unsaved notice')).toEqual(CLEAN('unsaved notice'))
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))

    await user.click(screen.getByRole('radio', { name: 'Separate views' }))
    expect(await floor('separate views, records')).toEqual(CLEAN('separate views, records'))
    refuse = true
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'placed')
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(within(gridSection('Records')).getAllByRole('status')[0]?.textContent).toBe('The database cannot be reached. Nothing was saved.'), { timeout: 15_000 })
    expect(await floor('a refused list')).toEqual(CLEAN('a refused list'))
  })

  // A delete's states, each held to the floor (0053): the record's
  // confirmation, and with a save of it out, Delete it waiting and described
  // by why; a row's, and on SQL Server a child row's and its row's,
  // "Not deleted", "Cannot find" and the grid saying the record was closed,
  // "It may have been deleted" before and after its check, and the grid
  // saying what was deleted. Their headings' levels are delete.test.tsx's
  // and delete-rows.test.tsx's to hold: axe's heading-order flags a level
  // skipped downwards, never one too high (seen: every confirmation an h4
  // passed here).
  test("passes the floor in a delete's states", async () => {
    let lose = false
    let hold = false
    const losing = losingWrites(plane.fetch, { when: 'before', writes: /\/records\/delete$/ })
    const holding = holdingWrites(plane.fetch)
    const fetch: typeof globalThis.fetch = (input, init) => (lose ? losing.fetch(input, init) : hold ? holding.fetch(input, init) : plane.fetch(input, init))
    const notes = `floor of a delete ${connection} ${String(Date.now())}`
    const kept = await freshOrder(formId, notes)
    const other = await freshOrder(formId, notes)
    if (connection === 'ms') await plane.clerk.create(lines, { order: kept, line_no: '1', quantity: '1', unit_price: '1.00' })
    const user = mount(fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, formId)
    await chooseRenderer(user)
    await user.type(screen.getByRole('textbox', { name: 'Search' }), notes)
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(within(gridSection('Records')).getAllByRole('status')[0]?.textContent).toBe('Rows 1–2.'), { timeout: 15_000 })
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    await user.click(within(grid).getAllByRole('gridcell')[0] as HTMLElement)
    await screen.findByRole('heading', { level: 3, name: `Order ${kept}` }, { timeout: 15_000 })
    await shows('Angular', 'Customer', 'Muster AG')
    const keep = async (question: string): Promise<void> => user.click(within(screen.getByRole('region', { name: question })).getByRole('button', { name: 'Keep it' }))

    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    expect(await floor('the record, confirming')).toEqual(CLEAN('the record, confirming'))
    hold = true
    await answer(user, 'React', 'Notes', `${notes} saving`)
    await save(user, 'React')
    await waitFor(() => expect(holding.held).toHaveLength(1), { timeout: 15_000 })
    await waitFor(() => expect(within(screen.getByRole('region', { name: `Delete Order ${kept}?` })).getByRole('button', { name: 'Delete it' }).getAttribute('aria-disabled')).toBe('true'))
    expect(await floor('the record, confirming while a save is out')).toEqual(CLEAN('the record, confirming while a save is out'))
    holding.answer()
    hold = false
    await said('React', /^Saved\./)
    await keep(`Delete Order ${kept}?`)
    // The save's answer lists the page again: its rows are drawn anew.
    await user.click(await within(grid).findByRole('button', { name: `Delete Order ${other}` }, { timeout: 15_000 }))
    expect(await floor('a row, confirming')).toEqual(CLEAN('a row, confirming'))
    await keep(`Delete Order ${other}?`)

    if (connection === 'ms') {
      const line = within(gridSection('Order line')).getByRole('grid', { name: 'Order line' })
      await waitFor(() => expect(within(line).queryAllByRole('gridcell').length).toBeGreaterThan(0), { timeout: 15_000 })
      await user.click(within(line).getAllByRole('gridcell')[0] as HTMLElement)
      await screen.findByRole('heading', { level: 5, name: `Order line ${kept},1` }, { timeout: 15_000 })
      await user.click(screen.getByRole('button', { name: 'Delete Order line' }))
      expect(await floor('a line, confirming')).toEqual(CLEAN('a line, confirming'))
      await keep(`Delete Order line ${kept},1?`)
      await user.click(within(line).getByRole('button', { name: `Delete Order line ${kept},1` }))
      expect(await floor("a line's row, confirming")).toEqual(CLEAN("a line's row, confirming"))
      await keep(`Delete Order line ${kept},1?`)
    }

    const theirs = await plane.clerk.read(formId, other)
    if (!theirs.ok || theirs.value.version === null) throw new Error('the other order did not read')
    await plane.clerk.delete(formId, { record: other, version: theirs.value.version })
    await user.click(within(grid).getByRole('button', { name: `Delete Order ${other}` }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${other}?` })).getByRole('button', { name: 'Delete it' }))
    await screen.findByRole('region', { name: `Cannot find Order ${other}` }, { timeout: 15_000 })
    expect(await floor('cannot find it')).toEqual(CLEAN('cannot find it'))
    await user.click(screen.getByRole('button', { name: 'Close the record' }))
    await waitFor(() => expect(within(gridSection('Records')).getAllByRole('status')[0]?.textContent).toMatch(/^Closed Order /), { timeout: 15_000 })
    expect(await floor('closed')).toEqual(CLEAN('closed'))

    const read = await plane.clerk.read(formId, kept)
    if (!read.ok || read.value.version === null) throw new Error('the order did not read')
    await plane.clerk.update(formId, { record: kept, version: read.value.version, answers: { notes: `${notes} moved` } })
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${kept}?` })).getByRole('button', { name: 'Delete it' }))
    await screen.findByRole('region', { name: 'Not deleted' }, { timeout: 15_000 })
    expect(await floor('not deleted')).toEqual(CLEAN('not deleted'))
    await user.click(within(screen.getByRole('region', { name: 'Not deleted' })).getByRole('button', { name: 'Load the saved record' }))
    await shows('Angular', 'Notes', `${notes} moved`)

    lose = true
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${kept}?` })).getByRole('button', { name: 'Delete it' }))
    await screen.findByRole('region', { name: 'It may have been deleted' }, { timeout: 15_000 })
    expect(await floor('may have been deleted')).toEqual(CLEAN('may have been deleted'))
    lose = false
    await user.click(screen.getByRole('button', { name: 'Check whether it was deleted' }))
    await screen.findByRole('button', { name: 'Delete it again' }, { timeout: 15_000 })
    expect(await floor('may have been deleted, checked')).toEqual(CLEAN('may have been deleted, checked'))
    await user.click(screen.getByRole('button', { name: 'Delete it again' }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${kept}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(within(gridSection('Records')).getAllByRole('status')[0]?.textContent).toMatch(/^Deleted Order /), { timeout: 15_000 })
    expect(await floor('deleted')).toEqual(CLEAN('deleted'))
  })

  // The server's refusal, in its words, where the person asked: a page that
  // said "something went wrong" would leave them unable to tell a bad token
  // from a missing form.
  test('a token the server does not accept is its sentence, at sign-in', async () => {
    const user = mount(plane.fetch)
    await signIn(user, 'not-a-host-token')
    expect((await screen.findByRole('alert')).textContent).toBe('A valid host token is required.')
    expect(screen.queryByRole('navigation', { name: 'Forms' })).toBeNull()
  })

  // A record the person may not see does not exist for them: tenant 1's
  // seeded order, loaded by tenant 2's clerk, is the server's 404 sentence,
  // and neither pane changes.
  test('a record that is not there is the server sentence, on load', async () => {
    const user = await openForm(plane, formId, TOKENS.otherClerk)
    await load(user, EDGES.seededOrder)
    expect((await screen.findByRole('alert')).textContent).toBe('No such record.')
    expect(screen.getByRole('button', { name: 'Open by record token' }).getAttribute('aria-expanded')).toBe('true')
    for (const renderer of RENDERERS) expect(within(pane(renderer)).getByRole('combobox', { name: 'Customer' })).toHaveProperty('value', '')
  })

  // New empties both panes for a new record, and the next save creates one:
  // a pane that kept the loaded record's token would update it instead.
  test('New record empties both panes, and a save then creates', async () => {
    const user = await openForm(plane, formId)
    await load(user, EDGES.seededOrder)
    for (const renderer of RENDERERS) await shows(renderer, 'Customer', 'Muster AG')
    await newRecord(user)
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
    const user = await openWith(losing.fetch, formId)
    const notes = `lost on the page ${connection} ${String(Date.now())}`
    await chooseCustomer(user, 'React', 'Muster', 'Muster AG')
    await answer(user, 'React', 'Order date', EDGES.orderDate)
    await answer(user, 'React', 'Amount', '31')
    await answer(user, 'React', 'Notes', notes)
    await save(user, 'React')

    await waitFor(() => expect(unknownNotice('React')).not.toBeNull(), { timeout: 15_000 })
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
    const user = await openWith(losing.fetch, formId)
    const notes = `lost twice on the page ${connection} ${String(Date.now())}`
    await chooseCustomer(user, 'React', 'Muster', 'Muster AG')
    await answer(user, 'React', 'Order date', EDGES.orderDate)
    await answer(user, 'React', 'Amount', '32')
    await answer(user, 'React', 'Notes', notes)
    await save(user, 'React')
    await waitFor(() => expect(unknownNotice('React')).not.toBeNull(), { timeout: 15_000 })
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
    const user = await openWith(losing.fetch, formId)
    await load(user, record)
    await shows('React', 'Amount', '1.0000')
    const notes = `lost update on the page ${connection} ${String(Date.now())}`
    await answer(user, 'React', 'Notes', notes)
    await save(user, 'React')
    await waitFor(() => expect(unknownNotice('React')).not.toBeNull(), { timeout: 15_000 })
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
    const user = await openWith(losing.fetch, formId)
    await load(user, record)
    await shows('React', 'Amount', '1.0000')
    await answer(user, 'React', 'Amount', '7')
    await save(user, 'React')
    await waitFor(() => expect(unknownNotice('React')).not.toBeNull(), { timeout: 15_000 })
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
  // question rather than to the top of the page, a whole page of Tabs from
  // anything.
  test('Sign out goes back to the question, with the token forgotten', async () => {
    const user = await openForm(plane, formId)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Forms' })).toBeNull())
    expect(screen.queryByRole('region', { name: 'React' })).toBeNull()
    expect((screen.getByLabelText('Host token') as HTMLInputElement).value).toBe('')
    expect(focusedName()).toBe('Host token')
    expect(document.documentElement.outerHTML).not.toContain(TOKENS.clerk)
  })

  // The token is held in the client's closure and nowhere a script, an
  // extension or the next person at the machine could read it back. The
  // browser keeps the viewer's two choices -- the renderer and the split --
  // and nothing else (0047).
  test('the token is in no storage, no cookie, no address and nowhere in the document', async () => {
    await openForm(plane, formId)
    const kept = Object.keys(localStorage)
    expect(kept.filter((key) => !(Object.values(PREFERENCES) as string[]).includes(key))).toEqual([])
    expect(kept.map((key) => localStorage.getItem(key) ?? '').filter((value) => value.includes(TOKENS.clerk))).toEqual([])
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    expect(window.location.href).not.toContain(TOKENS.clerk)
    expect(document.documentElement.outerHTML).not.toContain(TOKENS.clerk)
  })
})
