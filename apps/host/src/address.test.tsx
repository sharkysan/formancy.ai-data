import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName } from './test-accessible.js'
import { answer, answeredOnce, chooseCustomer, chooseForm, formLink, gridSection, load, mount, newRecord, openForm, said, save, searchRecords, shows, signIn, stamp, unsavedNotice } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The workspace's address (0047): the fragment names the form, the layout
 * and the view, and never a record -- a record token spells its key, and the
 * address goes into the history a browser may sync. Arriving with one opens
 * its form once signed in, if the menu names it; the skip link changes
 * nothing of it; and Back over a draft waits for the person.
 *
 * The address and the history are the browser's, not the accessibility
 * tree's: `location.hash` and `history.length` are read directly, and that is
 * the one read here not made by role and name.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

const ARRIVES = { timeout: 15_000 }

/**
 * Go back one entry and wait until at least `pops` popstates have fired --
 * Back's, and the page's own going forward again where it does -- and the
 * address is `hash`. The address alone cannot tell a Back the page undid
 * from no Back at all.
 */
async function backTo(hash: string, pops: number): Promise<void> {
  let seen = 0
  const counted = (): void => {
    seen += 1
  }
  window.addEventListener('popstate', counted)
  try {
    window.history.back()
    await waitFor(() => expect({ popped: seen >= pops, hash: window.location.hash }).toEqual({ popped: true, hash }), ARRIVES)
  } finally {
    window.removeEventListener('popstate', counted)
  }
}

describe.each(ENGINES)('the address on $engine', (engine) => {
  // A record opened from the grid, by token, or created, and the record
  // view of Separate views: never in the address, at any point (watched
  // failing with the token written into the fragment).
  test('never holds a record token', async () => {
    const words = stamp('address')
    const seen: string[] = []
    const user = await openForm(plane, engine.formId)
    seen.push(window.location.href)
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    await user.click(within(grid).getAllByRole('gridcell')[0] as HTMLElement)
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: /^Order k1:/ })).toBeTruthy(), ARRIVES)
    seen.push(window.location.href)
    await load(user, EDGES.seededOrder)
    await screen.findByRole('heading', { level: 3, name: `Order ${EDGES.seededOrder}` }, ARRIVES)
    seen.push(window.location.href)
    await newRecord(user)
    await shows('React', 'Amount', '')
    await chooseCustomer(user, 'React', 'Muster', 'Muster AG')
    await answer(user, 'React', 'Order date', EDGES.orderDate)
    await answer(user, 'React', 'Amount', '16')
    await answer(user, 'React', 'Notes', words)
    await save(user, 'React')
    const created = (await said('React', /^Created record k1:\S+\.$/)).slice('Created record '.length, -1)
    await screen.findByRole('heading', { level: 3, name: `Order ${created}` }, ARRIVES)
    seen.push(window.location.href)
    await user.click(screen.getByRole('radio', { name: 'Separate views' }))
    // Enter on the created record's row, found by what was typed into it: the record view, which the address names.
    await searchRecords(user, words, [created.slice(3)])
    const row = within(within(gridSection('Records')).getByRole('grid', { name: 'Records' }))
      .getAllByRole('row')
      .find((candidate) => within(candidate).queryAllByRole('gridcell')[0]?.textContent === created.slice(3)) as HTMLElement
    within(row).getAllByRole('gridcell')[0]?.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(window.location.hash).toBe(`#form=${engine.formId}&layout=separate&view=record`), ARRIVES)
    seen.push(window.location.href)
    await user.click(screen.getByRole('radio', { name: 'Stacked' }))
    seen.push(window.location.href)
    expect(seen.filter((href) => /k1(:|%3A)/i.test(href))).toEqual([])
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=stacked&view=records`)
  })

  // Arriving with an address: its form is opened once signed in when the
  // menu names it, and the page writes its own address over the one it
  // arrived on -- a record token pasted into it does not stay in the
  // history; a form the menu does not name is never asked for, and the
  // page's own address goes over it too.
  test('opens the form an address names after sign-in, only when the menu names it', async () => {
    window.history.replaceState(null, '', `/#form=${engine.lines}&layout=stacked&view=record&record=k1:1`)
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: `Order line ${engine.lines}` })).toBeTruthy(), ARRIVES)
    await answeredOnce('Records')
    expect(focusedName()).toBe('Forms')
    expect((screen.getByRole('radio', { name: 'Stacked' }) as HTMLInputElement).checked).toBe(true)
    expect(window.location.hash).toBe(`#form=${engine.lines}&layout=stacked&view=records`)
    cleanup()

    window.history.replaceState(null, '', `/#form=${engine.formId}-secret&layout=stacked&view=records`)
    const sent = plane.sent.length
    const again = mount(plane.fetch)
    await signIn(again, TOKENS.clerk)
    await screen.findByRole('heading', { level: 2, name: 'No form open' }, ARRIVES)
    expect(plane.sent.slice(sent).map((request) => request.path).filter((path) => path.includes('-secret'))).toEqual([])
    await waitFor(() => expect(window.location.hash).toBe('#layout=stacked&view=records'))
  })

  // The skip link puts the keyboard on main and does nothing else: the
  // address, the history and a draft stay as they were. A plain link to
  // #host-main would replace the address and push an entry (watched failing
  // with the click handler removed).
  test('the skip link moves the keyboard to main and changes nothing else', async () => {
    const user = await openForm(plane, engine.formId)
    await answer(user, 'React', 'Amount', '12')
    const hash = window.location.hash
    const length = window.history.length
    const skip = screen.getByRole('link', { name: 'Skip to the workspace' })
    skip.focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByRole('main'))
    expect(window.location.hash).toBe(hash)
    expect(window.history.length).toBe(length)
    await shows('React', 'Amount', '12')
  })

  // Back over a draft is a request like any other: Keep editing goes forward
  // again, so the address and the history are as they were and Back asks
  // again; told to discard, the earlier form opens.
  test('Back over a draft asks first, and Keep editing restores the address', async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.employees)
    await user.click(await formLink(engine.formId))
    await answeredOnce('Records')
    const here = window.location.hash
    expect(here).toBe(`#form=${engine.formId}&layout=side-by-side&view=records`)
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'New record' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'React' })).toBeTruthy(), ARRIVES)
    await answer(user, 'React', 'Amount', '13')
    window.history.back()
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    expect(within(unsavedNotice() as HTMLElement).getAllByRole('paragraph')[0]?.textContent).toBe('Going back closes these forms:')
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(window.location.hash).toBe(here))
    await shows('React', 'Amount', '13')

    window.history.back()
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: `Employee ${engine.employees}` })).toBeTruthy(), ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.employees}&layout=side-by-side&view=records`)
    await answeredOnce('Records')

    // Forward over a draft in the earlier form is asked about the same way,
    // and Keep editing goes back again.
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'New record' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'React' })).toBeTruthy(), ARRIVES)
    const name = await waitFor(() => within(screen.getByRole('region', { name: 'React' })).getByLabelText(/^Name\b/) as HTMLInputElement, ARRIVES)
    await user.type(name, 'Hedy')
    window.history.forward()
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    expect(within(unsavedNotice() as HTMLElement).getAllByRole('paragraph')[0]?.textContent).toBe('Going forward closes these forms:')
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(window.location.hash).toBe(`#form=${engine.employees}&layout=side-by-side&view=records`))
    expect(name.value).toBe('Hedy')
    window.history.forward()
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: `Order ${engine.formId}` })).toBeTruthy(), ARRIVES)
    expect(window.location.hash).toBe(here)
    // Its records answered, so no request of this test is still at the database when the file ends.
    await answeredOnce('Records')
  })

  // Back and Forward between the two views of Separate views change the
  // view and nothing else, and the keyboard goes where the view's own
  // buttons would send it: Back to the open row, Forward to the record.
  // An entry that asks for nothing the page does -- the view it is in -- is
  // answered by going back to the page's own. Watched failing twice: Back
  // to the records view wrote an entry of its own, as the view's button
  // does, which dropped the one Forward goes to; and with the view changed
  // and the page's entry left where it was, Forward was read as the page's
  // own entry. Each time the keyboard stayed on the row.
  test('Back and Forward move between the views of Separate views', async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.formId)
    await user.click(screen.getByRole('radio', { name: 'Separate views' }))
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    const cell = within(grid).getAllByRole('gridcell')[0] as HTMLElement
    const token = `k1:${String(cell.textContent)}`
    cell.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${token}`), ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=separate&view=record`)

    window.history.back()
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'), ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=separate&view=records`)
    window.history.forward()
    await waitFor(() => expect(focusedName()).toBe(`Order ${token}`), ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=separate&view=record`)

    // Stacked replaces the entry, so the one behind asks for a view Stacked
    // does not move between: Back lands there, and the entry is the page's,
    // written over with the place it shows.
    await user.click(screen.getByRole('radio', { name: 'Stacked' }))
    await backTo(window.location.hash, 1)
    expect((screen.getByRole('radio', { name: 'Stacked' }) as HTMLInputElement).checked).toBe(true)
  })

  // Drill down's records and its record are levels 0 and 1 (0090), each an
  // entry of its own, as Separate views' views are: Back and Forward move
  // between them and the keyboard goes to what the level shows. Its entry
  // popped while another layout is shown moves nothing, as Separate views'
  // does (watched failing: no Drill down to choose).
  test('Back and Forward move between the levels of Drill down', async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.formId)
    await user.click(screen.getByRole('radio', { name: 'Drill down' }))
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=records`)
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    const cell = within(grid).getAllByRole('gridcell')[0] as HTMLElement
    const token = `k1:${String(cell.textContent)}`
    cell.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${token}`), ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=record&level=1`)

    window.history.back()
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'), ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=records`)
    window.history.forward()
    await waitFor(() => expect(focusedName()).toBe(`Order ${token}`), ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=record&level=1`)

    await user.click(screen.getByRole('radio', { name: 'Stacked' }))
    await backTo(window.location.hash, 1)
    expect((screen.getByRole('radio', { name: 'Stacked' }) as HTMLInputElement).checked).toBe(true)
  })

  // Back in a layout that moves between none of the open form's entries
  // goes on past each, one press an entry, to the form opened before. Undone
  // instead -- the page going forward again, as it does for an address it
  // did not write -- every Back landed on the entry behind and came back,
  // and the person could not leave the form by Back at all (watched
  // failing: the order line form never came back).
  test("Back in another layout goes past Drill down's levels to the form before", async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.lines)
    await chooseForm(user, engine.formId)
    await user.click(screen.getByRole('radio', { name: 'Drill down' }))
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    const cell = within(grid).getAllByRole('gridcell')[0] as HTMLElement
    const token = `k1:${String(cell.textContent)}`
    cell.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${token}`), ARRIVES)
    await user.click(screen.getByRole('radio', { name: 'Stacked' }))

    await backTo(`#form=${engine.formId}&layout=stacked&view=records`, 1)
    window.history.back()
    await screen.findByRole('heading', { level: 2, name: new RegExp(` ${engine.lines}$`) }, ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.lines}&layout=stacked&view=records`)
  })

  // A level is in memory only: a typed address that asks for one the page
  // holds no entry for is written over with the page's own, and the level
  // shown stays (watched failing: no Drill down to choose).
  test("a typed level is written over with the page's own", async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.formId)
    await user.click(screen.getByRole('radio', { name: 'Drill down' }))
    const cell = within(within(gridSection('Records')).getByRole('grid', { name: 'Records' })).getAllByRole('gridcell')[0] as HTMLElement
    const token = `k1:${String(cell.textContent)}`
    cell.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${token}`), ARRIVES)
    window.location.hash = `#form=${engine.formId}&layout=drill&view=record&level=5`
    await waitFor(() => expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=record&level=1`), ARRIVES)
    expect(screen.getByRole('heading', { level: 3, name: `Order ${token}` })).toBeTruthy()
  })

  // Signed out and in again: the history keeps the entries the first
  // sign-in wrote, and this one's do not continue their count. Back onto
  // one of them is asked about as an address the page did not write, and
  // Keep editing puts the page's own address back (watched failing: read as
  // this sign-in's, Back was "Going forward", and Keep editing left an
  // address naming no form under the open Order).
  test("Back onto an earlier sign-in's entry asks, and Keep editing keeps the address", async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.employees)
    await user.click(await formLink(engine.formId))
    await answeredOnce('Records')
    const here = window.location.hash
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(focusedName()).toBe('Host token'), ARRIVES)
    await signIn(user, TOKENS.clerk)
    await screen.findByRole('heading', { level: 2, name: `Order ${engine.formId}` }, ARRIVES)
    await answeredOnce('Records')
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'New record' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'React' })).toBeTruthy(), ARRIVES)
    await answer(user, 'React', 'Amount', '14')

    window.history.back()
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    expect(within(unsavedNotice() as HTMLElement).getAllByRole('paragraph')[0]?.textContent).toBe('Opening Employee closes these forms:')
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(window.location.hash).toBe(here))
    expect(screen.getByRole('heading', { level: 2, name: `Order ${engine.formId}` })).toBeTruthy()
    await shows('React', 'Amount', '14')

    // The entry Back reached is still behind: Back asks again, and told to discard, opens it.
    window.history.back()
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: `Employee ${engine.employees}` })).toBeTruthy(), ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.employees}&layout=side-by-side&view=records`)
    await answeredOnce('Records')

    // Behind it, the first sign-in's arrival named no form: an address that
    // asks for nothing, which the page's own goes over (watched failing
    // with nothing done for an earlier sign-in's entry: the address named
    // no form under the open Employee).
    await backTo(`#form=${engine.employees}&layout=side-by-side&view=records`, 1)
    expect(unsavedNotice()).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: `Employee ${engine.employees}` })).toBeTruthy()
  })

  // A fragment typed into the address bar is a request like Back: another
  // form waits behind the notice, Keep editing writes the page's own
  // address over the typed one, and Discard opens the form it names. And
  // Forward after Back, while the notice waits, is back where the page was:
  // the question is answered (watched failing with the typed address left
  // in place under the Order, and with the notice left up after Forward).
  test('a typed address asks like Back, and Forward after Back answers the question', async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.employees)
    await user.click(await formLink(engine.formId))
    await answeredOnce('Records')
    const here = window.location.hash
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'New record' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'React' })).toBeTruthy(), ARRIVES)
    await answer(user, 'React', 'Amount', '17')

    window.history.back()
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    window.history.forward()
    await waitFor(() => expect(unsavedNotice()).toBeNull(), ARRIVES)
    expect(window.location.hash).toBe(here)
    await shows('React', 'Amount', '17')

    const typed = `#form=${engine.employees}&layout=side-by-side&view=records`
    window.location.hash = typed
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    expect(within(unsavedNotice() as HTMLElement).getAllByRole('paragraph')[0]?.textContent).toBe('Opening Employee closes these forms:')
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(window.location.hash).toBe(here))
    await shows('React', 'Amount', '17')

    window.location.hash = typed
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: `Employee ${engine.employees}` })).toBeTruthy(), ARRIVES)
    expect(window.location.hash).toBe(typed)
    await answeredOnce('Records')
  })

  // A request made while Back waits for the person replaces it, and puts
  // the address back first (watched failing: after a row was clicked and
  // Keep editing pressed, the address still named the form Back had
  // reached, under the Order the page showed).
  test('a row clicked while Back waits puts the address back', async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.employees)
    await user.click(await formLink(engine.formId))
    await answeredOnce('Records')
    const here = window.location.hash
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'New record' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'React' })).toBeTruthy(), ARRIVES)
    await answer(user, 'React', 'Amount', '15')
    window.history.back()
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    expect(within(unsavedNotice() as HTMLElement).getAllByRole('paragraph')[0]?.textContent).toBe('Going back closes these forms:')

    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    await user.click(within(grid).getAllByRole('gridcell')[0] as HTMLElement)
    await waitFor(() => expect(within(unsavedNotice() as HTMLElement).getAllByRole('paragraph')[0]?.textContent).toMatch(/^Opening k1:/))
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(window.location.hash).toBe(here), ARRIVES)
    expect(screen.getByRole('heading', { level: 2, name: `Order ${engine.formId}` })).toBeTruthy()
    await shows('React', 'Amount', '15')
  })
})
