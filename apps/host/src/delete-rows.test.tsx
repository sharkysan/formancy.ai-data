import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { getRole } from 'dom-accessibility-api'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { focusedName, paragraphs } from './test-accessible.js'
import { answer, answeredOnce, chooseForm, chooseRenderer, gridSection, gridStatus, mount, rendered, searchRecords, signIn, stamp, unsavedNotice } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, holdingRequests, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A grid row's Delete (0053, the person's decision of 2026-10-11): a real
 * button in each row of the master grid and of each child grid whose form
 * offers this person delete, named for the record, reached by the arrow
 * keys inside AG Grid's cell navigation, and behind the same confirmation
 * in place as the detail's -- under the grid it was pressed in. A row's
 * delete names the version the row was listed with: 0044's list answers
 * carry each row's, which is what the page read of it, so nothing is read
 * first. On both engines, against the real server.
 *
 * Found by role and accessible name, with two reads the accessibility tree
 * cannot answer, said where they are made: which element has the keyboard
 * when it is a grid's cell rather than a control, which the accessibility
 * tree names only by its text; and which requests the page sent.
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

async function freshOrder(engine: Engine, notes: string): Promise<string> {
  const definition = await plane.clerk.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(engine.formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1', notes })
  if (!created.ok || created.value.record === null) throw new Error(`the order was not created: ${created.ok ? 'no token' : created.message}`)
  return created.value.record
}

/** What the server answers a stale delete, verbatim (0050). */
const STALE = 'The record changed since it was read. Reload it and review the changes before deleting it.'

/** The record changed beside the page by tenant 1's clerk, as another person would change it: its version moves on. */
async function moveOn(formId: string, record: string, answers: Record<string, string>): Promise<void> {
  const read = await plane.clerk.read(formId, record)
  if (!read.ok || read.value.version === null) throw new Error('the record did not read')
  if (!(await plane.clerk.update(formId, { record, version: read.value.version, answers })).ok) throw new Error('the record did not move on')
}

async function stored(formId: string, record: string): Promise<boolean> {
  const read = await plane.clerk.read(formId, record)
  if (!read.ok && read.status !== 404) throw new Error(read.message)
  return read.ok
}

async function workspace(formId: string, fetch: typeof globalThis.fetch = plane.fetch): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await chooseRenderer(user)
  return user
}

/** The row of the grid `heading` names whose first cell says `first`. */
function row(heading: string, first: string): HTMLElement {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  const found = within(grid)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryAllByRole('gridcell')[0]?.textContent === first)
  if (found === undefined) throw new Error(`no row of ${heading} starts with ${first}`)
  return found
}

/** What has the keyboard: a control by its role, or a grid's cell, which the tree names only by its text. */
const focusedRole = (): string | null => (document.activeElement === null ? null : getRole(document.activeElement))

/** Arrow right along the row until the keyboard is on its Delete, at most `steps` times. */
async function toRowDelete(user: User, name: string, steps = 20): Promise<void> {
  for (let step = 0; step < steps && focusedName() !== name; step += 1) await user.keyboard('{ArrowRight}')
  expect({ focused: focusedName(), role: focusedRole() }).toEqual({ focused: name, role: 'button' })
}

const sentTo = (route: string, from: number): number => plane.sent.slice(from).filter((request) => request.path.endsWith(route)).length

describe.each(ENGINES)("a row's Delete on $engine", (engine) => {
  // The arrow keys reach the row's Delete as a cell of its row, and the
  // keyboard is then on a real button named for the record; ArrowLeft
  // takes it back to the cell before, so the button traps nothing. Its
  // Space is the button's, never the row's: it asks, in place under the
  // grid, and opens no record (watched failing with the Space handed to
  // the row: no question, the row opened, and the keyboard fell to the
  // page). The open record is another and stays open; Escape gives the
  // keyboard back to the row's Delete.
  test('is a real button the arrow keys reach, whose Space asks in place and opens nothing', async () => {
    const notes = stamp('rowkeys')
    const open = await freshOrder(engine, notes)
    const other = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await searchRecords(user, notes, [open.slice(3), other.slice(3)])
    await user.click(within(row('Records', open.slice(3))).getAllByRole('gridcell')[0] as HTMLElement)
    await screen.findByRole('heading', { level: 3, name: `Order ${open}` }, ARRIVES)
    await rendered()
    await waitFor(() => expect(focusedRole()).toBe('gridcell'))
    await user.keyboard('{ArrowDown}')
    await toRowDelete(user, `Delete Order ${other}`)
    await user.keyboard('{ArrowLeft}')
    expect(focusedRole()).toBe('gridcell')
    await toRowDelete(user, `Delete Order ${other}`)

    const sent = plane.sent.length
    await user.keyboard(' ')
    await waitFor(() => expect(focusedName()).toBe(`Delete Order ${other}?`))
    const region = screen.getByRole('region', { name: `Delete Order ${other}?` })
    expect(within(region).getByRole('heading', { level: 4 }).textContent).toBe(`Delete Order ${other}?`)
    expect(within(gridSection('Records')).getByRole('region', { name: `Delete Order ${other}?` })).toBe(region)
    expect(screen.getByRole('heading', { level: 3, name: `Order ${open}` })).toBeTruthy()
    expect(sentTo('/records/read', sent)).toBe(0)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(focusedName()).toBe(`Delete Order ${other}`))
    expect(focusedRole()).toBe('button')
  })

  // Enter on it asks too; Delete it removes that row's record, by the
  // version it was listed with, leaves the open record open, and puts the
  // keyboard on the grid's heading, whose status says so before its page
  // (watched failing with the row's version left out of the request: the
  // server refused it as invalid, "Not deleted").
  test("deletes the row's record by the version it was listed with, and leaves the open record open", async () => {
    const notes = stamp('rowdelete')
    const open = await freshOrder(engine, notes)
    const other = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await searchRecords(user, notes, [open.slice(3), other.slice(3)])
    await user.click(within(row('Records', open.slice(3))).getAllByRole('gridcell')[0] as HTMLElement)
    await screen.findByRole('heading', { level: 3, name: `Order ${open}` }, ARRIVES)
    await rendered()
    const listed = await plane.clerk.list(engine.formId, { search: notes })
    const version = listed.ok ? listed.value.rows.find((candidate) => candidate.record === other)?.version : undefined
    const sent = plane.sent.length
    within(row('Records', other.slice(3))).getByRole('button', { name: `Delete Order ${other}` }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Delete Order ${other}?`))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${other}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Deleted Order ${other}. Rows 1–1.`), ARRIVES)
    const deletes = plane.sent.slice(sent).filter((request) => request.path.endsWith('/records/delete'))
    expect(deletes.map((request) => JSON.parse(request.body ?? '{}'))).toEqual([{ record: other, version }])
    expect(screen.getByRole('heading', { level: 3, name: `Order ${open}` })).toBeTruthy()
    expect(await stored(engine.formId, other)).toBe(false)
    expect(await stored(engine.formId, open)).toBe(true)
  })

  // The open record's own row asks about the open record: what its forms
  // hold is listed, as the detail's question lists it, and once it is gone
  // the detail is empty too (watched failing with the row's question asked
  // as another record's: nothing was listed, and the draft went unnamed).
  test("the open record's row deletes the open record, and empties the detail", async () => {
    const notes = stamp('rowopen')
    const open = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await searchRecords(user, notes, [open.slice(3)])
    await user.click(within(row('Records', open.slice(3))).getAllByRole('gridcell')[0] as HTMLElement)
    await screen.findByRole('heading', { level: 3, name: `Order ${open}` }, ARRIVES)
    await rendered()
    await answer(user, 'React', 'Notes', 'a draft deleted from its row')
    await user.click(within(row('Records', open.slice(3))).getByRole('button', { name: `Delete Order ${open}` }))
    const region = screen.getByRole('region', { name: `Delete Order ${open}?` })
    expect(within(region).getAllByRole('listitem').map((item) => item.textContent)).toEqual([`Order ${open}, React: changes that are not saved.`])
    await user.click(within(region).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(screen.getByRole('heading', { level: 3, name: 'No record open' })).toBeTruthy()
    expect(sentTo('/records/delete', 0)).toBeGreaterThan(0)
  })

  // P7, measured here: the only row of a page that is not the first,
  // deleted, leaves that page empty. AG Grid 36.2's pagination, on the
  // fewer rows, moves to the page before by itself (seen with the page's
  // own step back taken out: the case still passed, so there is none); the
  // grid says what was deleted and the page it now shows, and nothing about
  // the empty one (watched failing with the empty page's answer said: the
  // sentence went with it, and the page before said only "Rows 1–50.").
  test('a delete that empties a page that is not the first shows the page before it', async () => {
    const notes = stamp('pages')
    await plane.db.insertOrders(engine.connection, LIST_PAGE_SIZE + 1, notes)
    const user = await workspace(engine.formId)
    await user.type(screen.getByRole('textbox', { name: 'Search' }), notes)
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Rows 1–${String(LIST_PAGE_SIZE)}; more follow.`), ARRIVES)
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Next rows' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Rows ${String(LIST_PAGE_SIZE + 1)}–${String(LIST_PAGE_SIZE + 1)}.`), ARRIVES)
    const last = within(gridSection('Records')).getAllByRole('button', { name: /^Delete Order k1:/ })
    expect(last).toHaveLength(1)
    const record = (last[0]?.getAttribute('aria-label') ?? '').slice('Delete Order '.length)
    await user.click(last[0] as HTMLElement)
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${record}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Deleted Order ${record}. Rows 1–${String(LIST_PAGE_SIZE)}.`), ARRIVES)
    expect(within(gridSection('Records')).getByRole('button', { name: 'Previous rows' }).getAttribute('aria-disabled')).toBe('true')
    expect(await plane.db.countOrders(engine.connection, `${notes} ${String(LIST_PAGE_SIZE + 1)}`)).toBe(0)
  })

  // A row's delete names the version its page was listed with: a record
  // changed beside the page since is "Not deleted", in the server's words.
  // Load the saved record opens what is stored and lists the page again, so
  // the row shows it too; the row's Delete then names the version the
  // detail read, and deletes (watched failing with the page not listed
  // again: the row kept the notes it was listed with).
  test("a row's stale delete is refused, and Load the saved record lists the page again", async () => {
    const notes = stamp('rowstale')
    const record = await freshOrder(engine, notes)
    const user = await workspace(engine.formId)
    await searchRecords(user, notes, [record.slice(3)])
    const cells = (): Array<string | null> => within(row('Records', record.slice(3))).getAllByRole('gridcell').map((cell) => cell.textContent)
    await moveOn(engine.formId, record, { notes: `${notes} moved` })
    await user.click(within(row('Records', record.slice(3))).getByRole('button', { name: `Delete Order ${record}` }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${record}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Not deleted'), ARRIVES)
    expect(paragraphs(screen.getByRole('region', { name: 'Not deleted' }))).toEqual([STALE])
    expect(cells()).not.toContain(`${notes} moved`)
    expect(await stored(engine.formId, record)).toBe(true)

    await user.click(within(screen.getByRole('region', { name: 'Not deleted' })).getByRole('button', { name: 'Load the saved record' }))
    await screen.findByRole('heading', { level: 3, name: `Order ${record}` }, ARRIVES)
    await rendered()
    await waitFor(() => expect(cells()).toContain(`${notes} moved`), ARRIVES)
    await user.click(within(row('Records', record.slice(3))).getByRole('button', { name: `Delete Order ${record}` }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${record}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(await stored(engine.formId, record)).toBe(false)
  })

  // A row's deletion of a record that is not open is its grid's work, not
  // the open record's: a request that keeps the grid -- another row opened
  // -- asks nothing about it, and its answer still says so in the grid
  // (watched failing with the deletion counted as the open record's:
  // opening another row asked about it, and Discard would have dropped
  // what its answer said).
  test("a row's deletion out is not asked about by a request that keeps its grid", async () => {
    const notes = stamp('rowout')
    const first = await freshOrder(engine, notes)
    const other = await freshOrder(engine, notes)
    const held = holdingRequests(plane.fetch, (request) => request.path.endsWith('/records/delete'))
    const user = await workspace(engine.formId, held.fetch)
    await searchRecords(user, notes, [first.slice(3), other.slice(3)])
    await user.click(within(row('Records', other.slice(3))).getByRole('button', { name: `Delete Order ${other}` }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${other}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(held.held).toHaveLength(1))
    await user.click(within(row('Records', first.slice(3))).getAllByRole('gridcell')[0] as HTMLElement)
    await waitFor(() => expect(screen.queryByRole('heading', { level: 3, name: `Order ${first}` }) ?? unsavedNotice()).not.toBeNull(), ARRIVES)
    expect(unsavedNotice()).toBeNull()
    await held.pass()
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Deleted Order ${other}. Rows 1–1.`), ARRIVES)
    expect(await stored(engine.formId, other)).toBe(false)
  })

  // A read the person asked for before a row's Delete, answered while its
  // question waits, opens its record and leaves the question open, the
  // keyboard on it: an answer is no request of the person's (watched failing
  // with every ask of the guard closing the question: it went when the read
  // answered, and the keyboard fell to the page).
  test("a read answered while a row's question waits leaves the question and the keyboard there", async () => {
    const notes = stamp('rowread')
    const first = await freshOrder(engine, notes)
    const other = await freshOrder(engine, notes)
    const held = holdingRequests(plane.fetch, (request) => request.path.endsWith('/records/read'))
    const user = await workspace(engine.formId, held.fetch)
    await searchRecords(user, notes, [first.slice(3), other.slice(3)])
    await user.click(within(row('Records', first.slice(3))).getAllByRole('gridcell')[0] as HTMLElement)
    await waitFor(() => expect(held.held).toHaveLength(1))
    await user.click(within(row('Records', other.slice(3))).getByRole('button', { name: `Delete Order ${other}` }))
    await waitFor(() => expect(focusedName()).toBe(`Delete Order ${other}?`))
    await held.pass()
    await screen.findByRole('heading', { level: 3, name: `Order ${first}` }, ARRIVES)
    await rendered()
    expect(screen.queryByRole('region', { name: `Delete Order ${other}?` })).not.toBeNull()
    expect(focusedName()).toBe(`Delete Order ${other}?`)
  })

  // A row's question outlives a search, which drops nothing: Keep it gives
  // the keyboard back to that record's Delete while its row is listed, and
  // to the grid's heading when it is not -- never to the Delete now at the
  // row's old place, another record's (watched failing with the keyboard
  // given back by the row's index: it landed on the other record's Delete).
  test("Keep it after a search gives the keyboard back by the record, never by the row's old place", async () => {
    const notes = stamp('rowkeep')
    const asked = await freshOrder(engine, `${notes}a`)
    const other = await freshOrder(engine, `${notes}c`)
    const user = await workspace(engine.formId)
    await searchRecords(user, notes, [asked.slice(3), other.slice(3)])
    await user.click(within(row('Records', asked.slice(3))).getByRole('button', { name: `Delete Order ${asked}` }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${asked}?` })).getByRole('button', { name: 'Keep it' }))
    await waitFor(() => expect(focusedName()).toBe(`Delete Order ${asked}`))

    await user.click(within(row('Records', asked.slice(3))).getByRole('button', { name: `Delete Order ${asked}` }))
    await searchRecords(user, `${notes}c`, [other.slice(3)])
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${asked}?` })).getByRole('button', { name: 'Keep it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'))
    expect(await stored(engine.formId, asked)).toBe(true)
  })

  // In Separate views a row's question is under the records, and its answer
  // may come once the person has gone to the record view: an answer that
  // asks something of them brings the records back, with the keyboard on it
  // (watched failing with the view left as it was: "Not deleted" was drawn
  // in the hidden records, and the keyboard stayed in the record view).
  test('in Separate views, an answer that comes while the record is shown brings the records back', async () => {
    const notes = stamp('rowview')
    const record = await freshOrder(engine, notes)
    const held = holdingRequests(plane.fetch, (request) => request.path.endsWith('/records/delete'))
    const user = await workspace(engine.formId, held.fetch)
    await user.click(screen.getByRole('radio', { name: 'Separate views' }))
    await searchRecords(user, notes, [record.slice(3)])
    const cell = (): HTMLElement => within(row('Records', record.slice(3))).getAllByRole('gridcell')[0] as HTMLElement
    cell().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('button', { name: 'Back to the records' }, ARRIVES)
    await rendered()
    await user.click(screen.getByRole('button', { name: 'Back to the records' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Records' })).not.toBeNull())
    await user.click(within(row('Records', record.slice(3))).getByRole('button', { name: `Delete Order ${record}` }))
    await user.click(within(screen.getByRole('region', { name: `Delete Order ${record}?` })).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(held.held).toHaveLength(1))
    cell().focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Records' })).toBeNull())
    await moveOn(engine.formId, record, { notes: `${notes} moved` })
    await held.pass()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Not deleted' })).not.toBeNull(), ARRIVES)
    await waitFor(() => expect(focusedName()).toBe('Not deleted'))
  })
})

// A child grid's row Delete, where the child's form offers one -- an order
// line on SQL Server -- asks under that grid, an h5 under its section's h4,
// and puts the keyboard on the section's heading once the line is gone
// (watched failing with the question an h4, which axe lets pass).
test("a child grid's row Delete asks under that grid, and the keyboard goes to its section", async () => {
  const engine = ENGINES[1]
  const notes = stamp('linerow')
  const record = await freshOrder(engine, notes)
  for (const no of ['1', '2']) {
    const created = await plane.clerk.create(engine.lines, { order: record, line_no: no, quantity: no, unit_price: '2.50' })
    if (!created.ok) throw new Error(created.message)
  }
  const user = await workspace(engine.formId)
  await searchRecords(user, notes, [record.slice(3)])
  await user.click(within(row('Records', record.slice(3))).getAllByRole('gridcell')[0] as HTMLElement)
  await screen.findByRole('region', { name: 'Order line' }, ARRIVES)
  expect(await answeredOnce('Order line')).toBe('Order line rows 1–2.')
  await user.click(within(row('Order line', '2')).getByRole('button', { name: `Delete Order line ${record},2` }))
  await waitFor(() => expect(focusedName()).toBe(`Delete Order line ${record},2?`))
  const region = within(gridSection('Order line')).getByRole('region', { name: `Delete Order line ${record},2?` })
  expect(within(region).getByRole('heading', { level: 5 }).textContent).toBe(`Delete Order line ${record},2?`)
  await user.click(within(region).getByRole('button', { name: 'Delete it' }))
  await waitFor(() => expect(focusedName()).toBe('Order line'), ARRIVES)
  await waitFor(() => expect(gridStatus('Order line')?.textContent).toBe(`Deleted Order line ${record},2. Order line rows 1–1.`), ARRIVES)
  expect(await stored(engine.lines, `${record},2`)).toBe(false)
})
