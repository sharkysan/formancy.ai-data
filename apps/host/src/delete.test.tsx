import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { CASCADES, HELD, NOT_FOUND, REMOVED, RESTRICTED, SAVE_OUT } from './deletion.js'
import { focusedName, paragraphs } from './test-accessible.js'
import {
  answer,
  answeredOnce,
  chooseForm,
  chooseRenderer,
  gridSection,
  gridStatus,
  mount,
  newRecord,
  notice,
  paper,
  rendered,
  said,
  save,
  searchRecords,
  shows,
  signIn,
  stamp,
  unsavedNotice,
} from './test-host.js'
import type { User } from './test-host.js'
import { holdingRequests, holdingWrites } from './test-network.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * Deleting the open record from its detail (0053), on both engines and in
 * both renderers, against the real server: Delete record in the record's
 * header, and Delete <child> in a child row's, each only where the server
 * offers this person delete; a confirmation in place that names the record
 * and says what a delete also does; and what the page does with each answer
 * -- deleted, not found, refused -- and while one is out. A grid row's
 * Delete is delete-rows.test.tsx's; an answer that was lost,
 * unknown-delete.test.tsx's.
 *
 * Found by role and accessible name, with two reads the accessibility tree
 * cannot answer, said where they are made: `history.length`, which is the
 * browser's, and which requests the page sent, which is the wire's.
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

const ARRIVES = { timeout: 15_000 }

/** What the server answers a stale delete, verbatim (0050). */
const STALE = 'The record changed since it was read. Reload it and review the changes before deleting it.'

/** Words only this test's records carry, and a fresh order of tenant 1's noted with them, made beside the page. */
async function freshOrder(engine: Engine, notes: string): Promise<string> {
  const definition = await plane.clerk.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(engine.formId, {
    customer: found.value.rows[0].token,
    order_date: EDGES.orderDate,
    status: 'placed',
    amount: '1',
    notes,
  })
  if (!created.ok || created.value.record === null) throw new Error(`the order was not created: ${created.ok ? 'no token' : created.message}`)
  return created.value.record
}

/** The record changed beside the page by tenant 1's clerk, as another person would change it: its version moves on. */
async function moveOn(formId: string, record: string, answers: Record<string, string>): Promise<void> {
  const read = await plane.clerk.read(formId, record)
  if (!read.ok || read.value.version === null) throw new Error('the record did not read')
  if (!(await plane.clerk.update(formId, { record, version: read.value.version, answers })).ok) throw new Error('the record did not move on')
}

/** Whether a record is there, asked beside the page as tenant 1's clerk. */
async function stored(formId: string, record: string): Promise<boolean> {
  const read = await plane.clerk.read(formId, record)
  if (!read.ok && read.status !== 404) throw new Error(read.message)
  return read.ok
}

/** The page signed in as tenant 1's clerk with `fetch`, `formId` chosen, both renderers on. */
async function workspace(formId: string, fetch: typeof globalThis.fetch = plane.fetch): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await chooseRenderer(user)
  return user
}

/** The data rows of the grid a heading names. */
function rows(heading: string): HTMLElement[] {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  return within(grid)
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('gridcell').length > 0)
}

/** Click the row of the grid `heading` names whose first cell says `first`, and wait until the detail it opens is drawn in both renderers. */
async function openRow(user: User, heading: string, first: string, opens: string): Promise<void> {
  await waitFor(() => expect(rows(heading).map((row) => within(row).getAllByRole('gridcell')[0]?.textContent)).toContain(first), ARRIVES)
  const row = rows(heading).find((candidate) => within(candidate).getAllByRole('gridcell')[0]?.textContent === first) as HTMLElement
  await user.click(within(row).getAllByRole('gridcell')[0] as HTMLElement)
  await screen.findByRole('heading', { name: opens }, ARRIVES)
}

/** The tenant's order `notes` names, found and opened in the Records grid: the record's panes drawn. */
async function openOrder(user: User, notes: string, record: string): Promise<void> {
  await searchRecords(user, notes, [record.slice(3)])
  await openRow(user, 'Records', record.slice(3), `Order ${record}`)
  await rendered()
  await shows('React', 'Customer', 'Muster AG')
}

/** The delete's region, named by its question. */
const confirmation = (noun: string, record: string): HTMLElement => screen.getByRole('region', { name: `Delete ${noun} ${record}?` })

/** Every request the page sent to a route that ends so, since `from`. */
const sentTo = (route: string, from: number): number => plane.sent.slice(from).filter((request) => request.path.endsWith(route)).length

describe.each(ENGINES)('deleting the open record on $engine', (engine) => {
  // Delete record is in the header of a record that is open, and nowhere
  // else: not on "No record open", not on a new record, which nothing could
  // delete. The tags say Delete because the server offers it. A child row's
  // Delete is its form's: on PostgreSQL an order line's key is typed and its
  // version column could restart under it, so the line form offers none and
  // neither its detail nor its grid has one (0050); on SQL Server its
  // rowversion proves it (watched failing with the detail's button drawn
  // whenever the form was open, and on a new record).
  test('offers Delete record on an open record only, and a child row its own Delete where its form offers one', async () => {
    const notes = stamp('offers')
    const record = await freshOrder(engine, notes)
    await plane.clerk.create(engine.lines, { order: record, line_no: '1', quantity: '1', unit_price: '1.00' })
    const user = await workspace(engine.formId)
    expect(
      within(screen.getByRole('list', { name: 'Operations' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Read', 'Create', 'Update', 'Delete'])
    expect(screen.getByRole('heading', { level: 3, name: 'No record open' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete record' })).toBeNull()
    await newRecord(user)
    await screen.findByRole('heading', { level: 3, name: 'New record' }, ARRIVES)
    expect(screen.queryByRole('button', { name: 'Delete record' })).toBeNull()
    await openOrder(user, notes, record)
    expect(screen.getByRole('button', { name: 'Delete record' })).toBeTruthy()

    await answeredOnce('Order line')
    const lineHeaders = within(gridSection('Order line'))
      .getAllByRole('columnheader')
      .map((header) => header.textContent?.trim())
    await openRow(user, 'Order line', '1', `Order line ${record},1`)
    if (engine.connection === 'pg') {
      expect(lineHeaders).not.toContain('Delete')
      expect(screen.queryByRole('button', { name: 'Delete Order line' })).toBeNull()
    } else {
      expect(lineHeaders).toContain('Delete')
      expect(screen.getByRole('button', { name: 'Delete Order line' })).toBeTruthy()
    }
  })

  // The confirmation is in place, right under the header that asked, and
  // takes the keyboard: named by its question, an h4 under the detail's h3,
  // and described by what the delete does and also does -- here, that the
  // order's lines go with it, as the policy's cascades accept. The next Tab
  // reaches Keep it, then Delete it, so the keyboard is never put on the
  // button that deletes; Escape and Keep it give the keyboard back to
  // Delete record and send nothing (watched failing with the focus on
  // Delete it: the next Enter would have deleted).
  test('asks in place, focused and described, Keep it first, and Escape or Keep it gives the keyboard back', async () => {
    const notes = stamp('asks')
    const record = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await openOrder(user, notes, record)
    const sent = plane.sent.length
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await waitFor(() => expect(focusedName()).toBe(`Delete Order ${record}?`))
    const region = confirmation('Order', record)
    expect(within(region).getByRole('heading', { level: 4 }).textContent).toBe(`Delete Order ${record}?`)
    expect(computeAccessibleDescription(region)).toBe(`${REMOVED} ${CASCADES}`)
    expect(within(screen.getByRole('region', { name: `Order ${record}` })).getAllByRole('region')[0]).toBe(region)
    await user.tab()
    expect(focusedName()).toBe('Keep it')
    await user.tab()
    expect(focusedName()).toBe('Delete it')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(focusedName()).toBe('Delete record'))
    expect(screen.queryByRole('region', { name: `Delete Order ${record}?` })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Keep it' }))
    await waitFor(() => expect(focusedName()).toBe('Delete record'))
    expect(sentTo('/records/delete', sent)).toBe(0)
    expect(await stored(engine.formId, record)).toBe(true)
  })

  // Delete it removes the record from the database, empties the detail and
  // puts the keyboard on the heading of the grid it was in, whose status
  // says so once, before what its page says now (watched failing with the
  // grid not asked again: the row stayed listed after it was gone).
  test('Delete it removes the record, empties the detail and says so in the grid, with the keyboard on Records', async () => {
    const notes = stamp('deletes')
    const record = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await openOrder(user, notes, record)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Deleted Order ${record}. No records match “${notes}”.`), ARRIVES)
    expect(screen.getByRole('heading', { level: 3, name: 'No record open' })).toBeTruthy()
    expect(rows('Records')).toEqual([])
    expect(await stored(engine.formId, record)).toBe(false)
  })

  // In Separate views the record view is where Delete record is, and its
  // own status line is hidden once the records are shown: the sentence is
  // the grid's, the records view comes back, and the record view is not a
  // step the history goes back to -- it holds no record any more (watched
  // failing with the sentence on the detail's line, which the records view
  // hides).
  test('in Separate views comes back to the records, says it there, and adds no step to the history', async () => {
    const notes = stamp('separate')
    const record = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await user.click(screen.getByRole('radio', { name: 'Separate views' }))
    await searchRecords(user, notes, [record.slice(3)])
    const cell = within(rows('Records')[0] as HTMLElement).getAllByRole('gridcell')[0] as HTMLElement
    cell.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('button', { name: 'Back to the records' }, ARRIVES)
    await rendered()
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    const steps = window.history.length
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(gridSection('Records').hidden).toBe(false)
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Deleted Order ${record}. No records match “${notes}”.`), ARRIVES)
    expect(window.history.length).toBe(steps)
    expect(window.location.hash).toMatch(/view=records/)
  })

  // Somebody else changed the record since the page read it: the server's
  // sentence, verbatim, in a "Not deleted" notice the keyboard is taken to,
  // and the record stays. Load the saved record reads it again -- through
  // the guard, as Load is -- and the next delete names the new version.
  test('a stale delete is "Not deleted" in the server\'s words, and after Load the saved record it deletes', async () => {
    const notes = stamp('stale')
    const record = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await openOrder(user, notes, record)
    const read = await plane.clerk.read(engine.formId, record)
    if (!read.ok || read.value.version === null) throw new Error('the order did not read')
    const moved = await plane.clerk.update(engine.formId, { record, version: read.value.version, answers: { notes: `${notes} moved` } })
    if (!moved.ok) throw new Error('the order did not move on')
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Not deleted'), ARRIVES)
    expect(paragraphs(screen.getByRole('region', { name: 'Not deleted' }))).toEqual([STALE])
    expect(await stored(engine.formId, record)).toBe(true)

    await user.click(within(screen.getByRole('region', { name: 'Not deleted' })).getByRole('button', { name: 'Load the saved record' }))
    await shows('React', 'Notes', `${notes} moved`)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(await stored(engine.formId, record)).toBe(false)
  })

  // Another row refers to this one with NO ACTION, so the database keeps it:
  // the confirmation said so before -- the server's `restricted` -- and the
  // refusal says so after, in the server's words, naming no table (0050;
  // watched failing with `restricted` left out of the lead: the question
  // did not say the database might keep it).
  test('a record another row refers to is "Not deleted", as its confirmation warned', async () => {
    const note = stamp('kept')
    const created = await plane.clerk.create(engine.removable, { note })
    if (!created.ok || created.value.record === null) throw new Error('the removable record was not created')
    const record = created.value.record
    await plane.db.referToRemovable(engine.connection, record)
    const user = await workspace(engine.removable)
    await searchRecords(user, note, [record.slice(3)])
    await openRow(user, 'Records', record.slice(3), `Removable ${record}`)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    expect(computeAccessibleDescription(confirmation('Removable', record))).toBe(`${REMOVED} ${RESTRICTED}`)
    await user.click(within(confirmation('Removable', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Not deleted'), ARRIVES)
    expect(paragraphs(screen.getByRole('region', { name: 'Not deleted' }))).toEqual([
      'Other records still refer to this one, so the database keeps it. Nothing was deleted.',
    ])
    expect(within(screen.getByRole('region', { name: 'Not deleted' })).queryByRole('button', { name: 'Load the saved record' })).toBeNull()
    expect(await stored(engine.removable, record)).toBe(true)
    await user.click(within(screen.getByRole('region', { name: 'Not deleted' })).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(focusedName()).toBe('Delete record'))
  })

  // Deleted beside the page first: a 404, which the page cannot tell from a
  // record it may no longer see, so it is never "Deleted" and never "Not
  // deleted". Close the record takes it from the page, and the grid says
  // "Closed" (watched failing with the 404 said as deleted).
  test('a record the delete cannot find is closed, never called deleted', async () => {
    const notes = stamp('gone')
    const record = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await openOrder(user, notes, record)
    const read = await plane.clerk.read(engine.formId, record)
    if (!read.ok || read.value.version === null) throw new Error('the order did not read')
    if (!(await plane.clerk.delete(engine.formId, { record, version: read.value.version })).ok) throw new Error('the order was not deleted beside the page')
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe(`Cannot find Order ${record}`), ARRIVES)
    expect(paragraphs(screen.getByRole('region', { name: `Cannot find Order ${record}` }))).toEqual([NOT_FOUND])
    expect(screen.queryByRole('region', { name: 'Not deleted' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Close the record' }))
    await waitFor(() => expect(focusedName()).toBe('Records'))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Closed Order ${record}. No records match “${notes}”.`), ARRIVES)
    expect(screen.getByRole('heading', { level: 3, name: 'No record open' })).toBeTruthy()
  })

  // What the delete drops with the record is named in its confirmation, as
  // the guard names it; typed into while the question waits, it is named
  // too before anything is sent (watched failing with the list taken once,
  // at the question: Angular's draft went with the record unnamed).
  test('names the unsaved forms it drops, and asks again when one was typed into meanwhile', async () => {
    const notes = stamp('drafts')
    const record = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await openOrder(user, notes, record)
    await answer(user, 'React', 'Notes', 'a draft deleted with it')
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    const region = confirmation('Order', record)
    expect(
      within(region)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([`Order ${record}, React: changes that are not saved.`])
    expect(computeAccessibleDescription(region)).toBe(
      `${REMOVED} ${CASCADES} Unsaved changes in these forms are discarded with it: Order ${record}, React: changes that are not saved.`,
    )
    const sent = plane.sent.length
    await answer(user, 'Angular', 'Notes', 'a draft typed while it asked')
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(within(confirmation('Order', record)).getAllByRole('listitem')).toHaveLength(2))
    expect(sentTo('/records/delete', sent)).toBe(0)
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(await stored(engine.formId, record)).toBe(false)
  })

  // While the deletion is out the record's forms hold: Save sends nothing
  // and says why, the region says "Deleting…" with both answers disabled,
  // and leaving asks first -- the deletion is work (watched failing with
  // the forms left to save: the update was sent beside the delete). Its
  // work discarded, the page moves on, and the answer that comes after
  // only takes the row from the grid and says so there: the new record
  // stays, and the keyboard with it (watched failing with the discard
  // keeping the page's track of it: the late answer said nothing, and the
  // row stayed listed).
  test('while the deletion is out, Save sends nothing and leaving asks first', async () => {
    const notes = stamp('out')
    const record = await freshOrder(engine, notes)
    const held = holdingRequests(plane.fetch, (request) => request.path.endsWith('/records/delete'))
    const user = await workspace(engine.formId, held.fetch)
    await openOrder(user, notes, record)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(held.held).toHaveLength(1))
    const region = confirmation('Order', record)
    expect(within(region).getByRole('status').textContent).toBe('Deleting…')
    expect(within(region).getByRole('button', { name: 'Delete it' }).getAttribute('aria-disabled')).toBe('true')
    expect(within(region).getByRole('button', { name: 'Keep it' }).getAttribute('aria-disabled')).toBe('true')

    const sent = plane.sent.length
    await answer(user, 'React', 'Notes', 'saved while it deletes')
    await save(user, 'React')
    await said('React', new RegExp(`^${HELD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    expect(sentTo('/records/update', sent)).toBe(0)

    await newRecord(user)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull())
    expect(
      within(unsavedNotice() as HTMLElement)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toContain(`Order ${record}: a deletion the server has not answered yet.`)
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Keep editing' }))
    expect(within(confirmation('Order', record)).getByRole('status').textContent).toBe('Deleting…')

    await newRecord(user)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull())
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await screen.findByRole('heading', { level: 3, name: 'New record' }, ARRIVES)
    expect(screen.queryByRole('region', { name: `Delete Order ${record}?` })).toBeNull()
    const at = focusedName()
    await held.pass()
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Deleted Order ${record}. No records match “${notes}”.`), ARRIVES)
    expect(screen.getByRole('heading', { level: 3, name: 'New record' })).toBeTruthy()
    expect(focusedName()).toBe(at)
    expect(await stored(engine.formId, record)).toBe(false)
  })

  // A save out names a version the delete would race: Delete record waits
  // for its answer, says so in its description and on the detail's line,
  // and asks nothing, and so does the open record's row, on its grid's
  // line (watched failing with each wait taken out: the question opened
  // over the save).
  test('while a save of the record is out, Delete record waits and says why', async () => {
    const notes = stamp('saving')
    const record = await freshOrder(engine, notes)
    const holding = holdingWrites(plane.fetch)
    const user = await workspace(engine.formId, holding.fetch)
    await openOrder(user, notes, record)
    await answer(user, 'React', 'Notes', 'a save still out')
    await save(user, 'React')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    const trigger = screen.getByRole('button', { name: 'Delete record' })
    await waitFor(() => expect(trigger.getAttribute('aria-disabled')).toBe('true'))
    expect(computeAccessibleDescription(trigger)).toBe(SAVE_OUT)
    await user.click(trigger)
    expect(within(screen.getByRole('region', { name: `Order ${record}` })).getAllByRole('status')[0]?.textContent).toBe(SAVE_OUT)
    await user.click(within(gridSection('Records')).getByRole('button', { name: `Delete Order ${record}` }))
    expect(gridStatus('Records')?.textContent).toBe(SAVE_OUT)
    expect(screen.queryByRole('region', { name: `Delete Order ${record}?` })).toBeNull()
    holding.answer()
    await said('React', /^Saved\.$/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete record' }).getAttribute('aria-disabled')).toBeNull())
  })

  // Another request closes the question, deleting nothing, and goes on
  // through the guard: another row opens (watched failing with the guard
  // closing nothing: the question stayed open under the record it no
  // longer named).
  test("another row's request closes the confirmation, and nothing is deleted", async () => {
    const notes = stamp('closes')
    const first = await freshOrder(engine, notes)
    const second = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await searchRecords(user, notes, [first.slice(3), second.slice(3)])
    await openRow(user, 'Records', first.slice(3), `Order ${first}`)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    expect(confirmation('Order', first)).toBeTruthy()
    await openRow(user, 'Records', second.slice(3), `Order ${second}`)
    expect(screen.queryByRole('region', { name: `Delete Order ${first}?` })).toBeNull()
    expect(await stored(engine.formId, first)).toBe(true)
  })

  // A stale save, then that pane's own Load the saved record: the pane holds
  // the record as it is stored now, and Delete record names that version --
  // the newest the detail heard -- not the one it opened with (watched
  // failing with the version heard only when the detail opened or saved:
  // the delete went out with the first version and was refused as stale).
  test("after a pane's Load the saved record, the delete names the version it loaded", async () => {
    const notes = stamp('paneload')
    const record = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await openOrder(user, notes, record)
    await moveOn(engine.formId, record, { notes: `${notes} moved` })
    await answer(user, 'React', 'Notes', 'a draft saved too late')
    await save(user, 'React')
    await waitFor(() => expect(notice('React')).not.toBeNull(), ARRIVES)
    await user.click(within(notice('React') as HTMLElement).getByRole('button', { name: 'Load the saved record' }))
    await shows('React', 'Notes', `${notes} moved`)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(screen.queryByRole('region', { name: 'Not deleted' })).toBeNull()
    expect(await stored(engine.formId, record)).toBe(false)
  })

  // A save answered moves the record's version: Delete record names the one
  // that answer gave (watched failing with the save's answer not heard: the
  // delete named the version the detail opened with, refused as stale).
  test('after a save, Delete record names the version the save was answered with', async () => {
    const notes = stamp('saved')
    const record = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await openOrder(user, notes, record)
    await answer(user, 'React', 'Notes', `${notes} saved first`)
    await save(user, 'React')
    await said('React', /^Saved\./)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(screen.queryByRole('region', { name: 'Not deleted' })).toBeNull()
    expect(await stored(engine.formId, record)).toBe(false)
  })

  // A save pressed while the question waits: its Delete it waits for the
  // save's answer too -- disabled, described by why, sending nothing -- and,
  // the save answered, deletes by the version that answer gave (watched
  // failing with the question's Delete it unaware of the save: the delete
  // went out beside the update, with the version before it, and was refused
  // as stale).
  test('a save pressed while it asks holds Delete it until the save is answered', async () => {
    const notes = stamp('asksaving')
    const record = await freshOrder(engine, notes)
    const holding = holdingWrites(plane.fetch)
    const user = await workspace(engine.formId, holding.fetch)
    await openOrder(user, notes, record)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await answer(user, 'React', 'Notes', 'saved while it asks')
    await save(user, 'React')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    const deleteIt = (): HTMLElement => within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' })
    await waitFor(() => expect(deleteIt().getAttribute('aria-disabled')).toBe('true'))
    expect(computeAccessibleDescription(deleteIt())).toBe(SAVE_OUT)
    const sent = plane.sent.length
    await user.click(deleteIt())
    expect(sentTo('/records/delete', sent)).toBe(0)
    holding.answer()
    await said('React', /^Saved\./)
    await waitFor(() => expect(deleteIt().getAttribute('aria-disabled')).toBeNull())
    await user.click(deleteIt())
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(await stored(engine.formId, record)).toBe(false)
  })

  // In Separate views the answer may come while its region's view is
  // hidden -- the person went back to the records: an answer that asks
  // something of them brings the record view back, with the keyboard on it,
  // and adds no step to the history (watched failing with the view left as
  // it was: "Not deleted" was drawn in the hidden detail, and the keyboard
  // stayed on the grid).
  test('in Separate views, an answer that comes while the records are shown brings the record view back', async () => {
    const notes = stamp('hiddenview')
    const record = await freshOrder(engine, notes)
    const held = holdingRequests(plane.fetch, (request) => request.path.endsWith('/records/delete'))
    const user = await workspace(engine.formId, held.fetch)
    await user.click(screen.getByRole('radio', { name: 'Separate views' }))
    await searchRecords(user, notes, [record.slice(3)])
    const cell = within(rows('Records')[0] as HTMLElement).getAllByRole('gridcell')[0] as HTMLElement
    cell.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('button', { name: 'Back to the records' }, ARRIVES)
    await rendered()
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(confirmation('Order', record)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(held.held).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Back to the records' }))
    await waitFor(() => expect(gridSection('Records').hidden).toBe(false))
    const steps = window.history.length
    await moveOn(engine.formId, record, { notes: `${notes} moved` })
    await held.pass()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Not deleted' })).not.toBeNull(), ARRIVES)
    await waitFor(() => expect(focusedName()).toBe('Not deleted'))
    expect(window.history.length).toBe(steps)
  })
})

// A line's own Delete, in its detail's header, where its form offers one:
// on SQL Server, whose rowversion proves a line. Its confirmation is an h6
// under the line's h5 -- one level below, as headings go no further -- and
// once the line is gone the keyboard is on its section's h4, whose grid
// says so (watched failing with the confirmation an h4 under the h5,
// which axe's heading-order in page.test.tsx lets pass: it flags a level
// skipped downwards, never one too high).
test('a child row is deleted from its own detail, and the keyboard goes to its section', async () => {
  const engine = ENGINES[1]
  const notes = stamp('line')
  const record = await freshOrder(engine, notes)
  for (const no of ['1', '2']) {
    const created = await plane.clerk.create(engine.lines, { order: record, line_no: no, quantity: no, unit_price: '2.50' })
    if (!created.ok) throw new Error(created.message)
  }
  const user = await workspace(engine.formId)
  await openOrder(user, notes, record)
  await answeredOnce('Order line')
  await openRow(user, 'Order line', '1', `Order line ${record},1`)
  await user.click(screen.getByRole('button', { name: 'Delete Order line' }))
  await waitFor(() => expect(focusedName()).toBe(`Delete Order line ${record},1?`))
  expect(within(confirmation('Order line', `${record},1`)).getByRole('heading', { level: 6 }).textContent).toBe(`Delete Order line ${record},1?`)
  await user.click(within(confirmation('Order line', `${record},1`)).getByRole('button', { name: 'Delete it' }))
  await waitFor(() => expect(focusedName()).toBe('Order line'), ARRIVES)
  await waitFor(() => expect(gridStatus('Order line')?.textContent).toBe(`Deleted Order line ${record},1. Order line rows 1–1.`), ARRIVES)
  // The order is still open, its forms with it: a line's delete is the line's.
  expect(screen.getByRole('heading', { level: 3, name: `Order ${record}` })).toBeTruthy()
  expect(paper('React')).toBeTruthy()
  expect(await stored(engine.lines, `${record},1`)).toBe(false)
})

// A line's own delete, refused as stale -- the line changed beside the page
// -- loads the saved line again, as the record's does; and while a save of
// the line is out, neither its detail's Delete nor its row's asks: each
// says why, on the line's own status line and on its grid's (watched
// failing with Load the saved record reading nothing: the line kept its
// old quantity; and with the row's wait taken out).
test("a child row's stale delete loads the saved row, and its Deletes wait for a save of it", async () => {
  const engine = ENGINES[1]
  const notes = stamp('linestale')
  const record = await freshOrder(engine, notes)
  const created = await plane.clerk.create(engine.lines, { order: record, line_no: '1', quantity: '1', unit_price: '2.50' })
  if (!created.ok || created.value.record === null || created.value.version === null) throw new Error('the line was not created')
  const line = created.value.record
  const holding = holdingWrites(plane.fetch)
  const user = await workspace(engine.formId, holding.fetch)
  await openOrder(user, notes, record)
  await answeredOnce('Order line')
  await openRow(user, 'Order line', '1', `Order line ${line}`)
  const linePane = (): HTMLElement => screen.getByRole('region', { name: `Order line ${line} React` })
  await within(linePane()).findByRole('spinbutton', { name: /^Quantity/ }, ARRIVES)

  if (!(await plane.clerk.update(engine.lines, { record: line, version: created.value.version, answers: { quantity: '4' } })).ok)
    throw new Error('the line did not move on')
  await user.click(screen.getByRole('button', { name: 'Delete Order line' }))
  await user.click(within(confirmation('Order line', line)).getByRole('button', { name: 'Delete it' }))
  await waitFor(() => expect(focusedName()).toBe('Not deleted'), ARRIVES)
  expect(paragraphs(screen.getByRole('region', { name: 'Not deleted' }))).toEqual([STALE])
  await user.click(within(screen.getByRole('region', { name: 'Not deleted' })).getByRole('button', { name: 'Load the saved record' }))
  await waitFor(() => expect(within(linePane()).getByRole<HTMLInputElement>('spinbutton', { name: /^Quantity/ }).value).toBe('4'), ARRIVES)

  await user.clear(within(linePane()).getByRole('spinbutton', { name: /^Quantity/ }))
  await user.type(within(linePane()).getByRole('spinbutton', { name: /^Quantity/ }), '5')
  await user.click(within(linePane()).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Order line' }).getAttribute('aria-disabled')).toBe('true'))
  await user.click(screen.getByRole('button', { name: 'Delete Order line' }))
  // Said on the line's own status line: the only one that says it, until the row is pressed.
  expect(screen.getAllByRole('status').filter((status) => status.textContent === SAVE_OUT)).toHaveLength(1)
  await user.click(within(gridSection('Order line')).getByRole('button', { name: `Delete Order line ${line}` }))
  expect(gridStatus('Order line')?.textContent).toBe(SAVE_OUT)
  expect(screen.queryByRole('region', { name: `Delete Order line ${line}?` })).toBeNull()
  holding.answer()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Order line' }).getAttribute('aria-disabled')).toBeNull(), ARRIVES)
  expect(await stored(engine.lines, line)).toBe(true)
})

// A line saved, then deleted from its own detail: the delete names the
// version its save was answered with (watched failing with the save's
// answer not heard: the delete named the version the line was opened
// with, and was refused as stale).
test('a child row saved and then deleted from its detail deletes by the version its save gave', async () => {
  const engine = ENGINES[1]
  const notes = stamp('linesave')
  const record = await freshOrder(engine, notes)
  const created = await plane.clerk.create(engine.lines, { order: record, line_no: '1', quantity: '1', unit_price: '2.50' })
  if (!created.ok || created.value.record === null) throw new Error('the line was not created')
  const line = created.value.record
  const user = await workspace(engine.formId)
  await openOrder(user, notes, record)
  await answeredOnce('Order line')
  await openRow(user, 'Order line', '1', `Order line ${line}`)
  const linePane = (): HTMLElement => screen.getByRole('region', { name: `Order line ${line} React` })
  const quantity = await within(linePane()).findByRole('spinbutton', { name: /^Quantity/ }, ARRIVES)
  await user.clear(quantity)
  await user.type(quantity, '3')
  await user.click(within(linePane()).getByRole('button', { name: 'Save' }))
  await waitFor(
    () =>
      expect(
        within(linePane())
          .getAllByRole('status')
          .map((status) => status.textContent),
      ).toContainEqual(expect.stringMatching(/^Saved\./)),
    ARRIVES,
  )
  await user.click(screen.getByRole('button', { name: 'Delete Order line' }))
  await user.click(within(confirmation('Order line', line)).getByRole('button', { name: 'Delete it' }))
  await waitFor(() => expect(focusedName()).toBe('Order line'), ARRIVES)
  expect(screen.queryByRole('region', { name: 'Not deleted' })).toBeNull()
  expect(await stored(engine.lines, line)).toBe(false)
})

// One question at a time: a line row's Delete pressed while the record's
// question waits closes the record's, deleting nothing, and asks its own
// (watched failing with the other owner's question left open: both stood
// on the page at once).
test("another delete's question closes the one already asked", async () => {
  const engine = ENGINES[1]
  const notes = stamp('onequestion')
  const record = await freshOrder(engine, notes)
  const created = await plane.clerk.create(engine.lines, { order: record, line_no: '1', quantity: '1', unit_price: '2.50' })
  if (!created.ok || created.value.record === null) throw new Error('the line was not created')
  const line = created.value.record
  const user = await workspace(engine.formId)
  await openOrder(user, notes, record)
  expect(await answeredOnce('Order line')).toBe('Order line rows 1–1.')
  await user.click(screen.getByRole('button', { name: 'Delete record' }))
  expect(confirmation('Order', record)).toBeTruthy()
  await user.click(within(gridSection('Order line')).getByRole('button', { name: `Delete Order line ${line}` }))
  await waitFor(() => expect(focusedName()).toBe(`Delete Order line ${line}?`))
  expect(screen.queryByRole('region', { name: `Delete Order ${record}?` })).toBeNull()
  expect(within(gridSection('Order line')).getByRole('region', { name: `Delete Order line ${line}?` })).toBeTruthy()
  expect(await stored(engine.formId, record)).toBe(true)
})
