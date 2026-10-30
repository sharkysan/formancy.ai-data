import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { createDataClient } from '@formancy/data-client'
import type { DataClient } from '@formancy/data-client'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { answeredOnce, chooseForm, gridSection, mount, searchRecords, signIn, stamp, unsavedNotice } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { holdingRequests } from './test-network.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * Drill down (0090): the open form one level at a time -- its records, the
 * record, a child row of it, that row's child rows -- with a trail of
 * buttons back to each level above. On both engines, against the real
 * server, through the child forms `startPlane({ children: true,
 * deliveries: true })` publishes: an order's lines and deliveries, and an
 * employee's employees and the orders it created.
 *
 * Found by role and accessible name. What the accessibility tree cannot
 * answer is read off the DOM, each where it is made: `location.hash`, which
 * is the browser's; element ids, which two levels of one form must never
 * mint twice and which have no role or name; the crumb that is the page,
 * by `aria-current`, which the tree gives no role of its own; the role of
 * the focused element, to tell a grid's cell from its other controls; the
 * levels still mounted, by their class, which hidden ones have no role to
 * be found by; and what AG Grid's live region says of a row, a polite
 * live region with no role, by its class.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, deletes: true, deliveries: true })
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

function client(token: string): DataClient {
  return createDataClient({ token: () => token, fetch: plane.fetch })
}

/** An order of tenant 1's noted `notes`, with lines numbered `lines`, made beside the page: its token and its lines'. */
async function orderWithLines(engine: Engine, notes: string, lines: readonly number[]): Promise<{ order: string; lines: string[] }> {
  const as = client(TOKENS.clerk)
  const definition = await as.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await as.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await as.create(engine.formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1', notes })
  if (!created.ok || created.value.record === null) throw new Error(`the order was not created: ${created.ok ? 'no token' : created.message}`)
  const order = created.value.record
  const made: string[] = []
  for (const no of lines) {
    const line = await as.create(engine.lines, { order, line_no: String(no), quantity: String(no), unit_price: '2.50' })
    if (!line.ok || line.value.record === null) throw new Error(`line ${String(no)} was not created: ${line.ok ? 'no token' : line.message}`)
    made.push(line.value.record)
  }
  return { order, lines: made }
}

/** The data rows of the grid a heading names, each as its cells' text. */
function rows(heading: string): string[][] {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  return within(grid)
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('gridcell').length > 0)
    .map((row) =>
      within(row)
        .getAllByRole('gridcell')
        .map((cell) => cell.textContent ?? ''),
    )
}

/** The row of the grid `heading` names whose first cell says `first`, once it is listed. */
async function rowOf(heading: string, first: string): Promise<HTMLElement> {
  await waitFor(() => expect(rows(heading).map((cells) => cells[0])).toContain(first), ARRIVES)
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  return within(grid)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryAllByRole('gridcell')[0]?.textContent === first) as HTMLElement
}

/** Enter on the first cell of the row of the grid `heading` names that has a cell saying `text`, once it is listed. */
async function enterRowWith(user: User, heading: string, text: string): Promise<void> {
  await waitFor(() => expect(rows(heading).some((cells) => cells.includes(text))).toBe(true), ARRIVES)
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  const row = within(grid)
    .getAllByRole('row')
    .find((candidate) =>
      within(candidate)
        .queryAllByRole('gridcell')
        .some((cell) => cell.textContent === text),
    ) as HTMLElement
  ;(within(row).getAllByRole('gridcell')[0] as HTMLElement).focus()
  await user.keyboard('{Enter}')
}

/** Press `key` on the first cell of that row. */
async function pressOn(user: User, heading: string, first: string, key: '{Enter}' | ' '): Promise<void> {
  const cell = within(await rowOf(heading, first)).getAllByRole('gridcell')[0] as HTMLElement
  cell.focus()
  await user.keyboard(key)
}

/** The trail, crumb by crumb, as it reads. */
function trail(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
  return within(nav)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

/** The crumb the trail says is the page shown. */
function current(): string {
  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
  return [...nav.querySelectorAll('[aria-current="page"]')].map((element) => element.textContent ?? '').join(' | ')
}

/** What AG Grid's live region last said of a row of the grid `heading` names, without the mark it adds to a sentence said twice. */
function rowSays(heading: string): string {
  return (gridSection(heading).querySelector('.ag-aria-description-container')?.textContent ?? '').replaceAll('\u200b', '')
}

/** A level's pane: the region its heading and the renderer name. */
function pane(heading: string, renderer: RendererName): HTMLElement {
  return screen.getByRole('region', { name: `${heading} ${renderer}` })
}

/** The page signed in as tenant 1's clerk, `formId` chosen, in Drill down. */
async function drilling(formId: string, fetch: typeof globalThis.fetch = plane.fetch): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await user.click(screen.getByRole('radio', { name: 'Drill down' }))
  return user
}

describe.each(ENGINES)('Drill down on $engine', (engine) => {
  // One level at a time, each an entry of the history, with the trail
  // naming every level above as a button and the one shown as the page: an
  // order's line opened from the order goes down, not onto a rail, and
  // the trail's first crumb goes back to the records with the keyboard on
  // their heading (watched failing: no trail).
  test('goes down from an order to its line and back up by the trail', async () => {
    const words = stamp('drill')
    const { order, lines } = await orderWithLines(engine, words, [1, 2])
    const user = await drilling(engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=records`)
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    expect(trail()).toEqual(['Records', `Order ${order}`])
    expect(current()).toBe(`Order ${order}`)
    expect(screen.queryByRole('region', { name: 'Records' })).toBeNull()
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=record&level=1`)

    await answeredOnce('Order line')
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order line ${lines[0] ?? ''}`), ARRIVES)
    expect(trail()).toEqual(['Records', `Order ${order}`, `Order line ${lines[0] ?? ''}`])
    expect(screen.queryByRole('heading', { level: 3, name: `Order ${order}` })).toBeNull()
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=record&level=2`)
    const quantity = await waitFor(() => within(pane(`Order line ${lines[0] ?? ''}`, 'React')).getByLabelText(/^Quantity\b/) as HTMLInputElement, ARRIVES)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    const parent = within(pane(`Order line ${lines[0] ?? ''}`, 'React')).getByRole('combobox', { name: /^Order\*?$/ }) as HTMLSelectElement
    expect({ disabled: parent.disabled, value: parent.value }).toEqual({ disabled: true, value: order })

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    await user.click(within(nav).getByRole('button', { name: 'Records' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(screen.getByRole('region', { name: 'Records' })).toBeTruthy()
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=records`)
  })

  // Duplicate record replaces the record at level 1, as another record
  // does, so the levels below are its and go with it: their work is asked
  // about, and once it is discarded the trail ends at the new record and
  // the line's level is gone, not held under a record it is no row of
  // (0107; watched failing with the levels kept: Back onto the line's entry
  // showed the old order's line under the copy).
  test('Duplicate record at level 1 asks about the levels below, and drops them', async () => {
    const words = stamp('drill-copy')
    const { order, lines } = await orderWithLines(engine, words, [1])
    const line = `Order line ${lines[0] ?? ''}`
    const user = await drilling(engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    await answeredOnce('Order line')
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(line), ARRIVES)
    const quantity = await field(line, /^Quantity\b/)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.type(quantity, '7')

    await crumb(user, `Order ${order}`)
    await user.click(screen.getByRole('button', { name: 'Duplicate record' }))
    const notice = await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)
    expect(listed(notice)).toEqual([`${line}, React: changes that are not saved.`])
    await user.click(within(notice).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(focusedName()).toBe('New record'), ARRIVES)
    expect(trail()).toEqual(['Records', 'New Order'])

    // Back past the crumb's entry onto the line's: the line went with the
    // order copied from, so the copy, the deepest level held, is shown and
    // the entry says so -- never the old order's line under the new record.
    await back()
    await back()
    await waitFor(() => expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=record&level=1`), ARRIVES)
    expect(trail()).toEqual(['Records', 'New Order'])
  })

  // Every way a grid opens a row goes down in Drill down: Space too, and a
  // click, so a mouse visitor who clicks a row sees it (the design's third
  // call). A Space that only marked the row would leave the person on a
  // level that shows nothing of it (watched failing: no Drill down).
  test('a click and Space go down too', async () => {
    const words = stamp('drill-space')
    const { order, lines } = await orderWithLines(engine, words, [1])
    const user = await drilling(engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), ' ')
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    await answeredOnce('Order line')
    await user.click(within(await rowOf('Order line', '1')).getAllByRole('gridcell')[0] as HTMLElement)
    await waitFor(() => expect(focusedName()).toBe(`Order line ${lines[0] ?? ''}`), ARRIVES)
  })

  // Back while a row's read is out is going up too: the answer is dropped,
  // as a crumb drops it, and does not pull the person two levels down
  // (watched failing: the answer pushed the line's level after Back).
  test('Back drops a read that is out', async () => {
    const words = stamp('drill-back-late')
    const { order } = await orderWithLines(engine, words, [1])
    const held = holdingRequests(plane.fetch, ({ path }) => path.endsWith(`/v1/forms/${engine.lines}/records/read`))
    const user = await drilling(engine.formId, held.fetch)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await answeredOnce('Order line')
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    window.history.back()
    await waitFor(() => expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=records`), ARRIVES)
    await held.pass()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=records`)
    expect(screen.queryByRole('heading', { name: /^Order line k1:/ })).toBeNull()
  })

  // A read refused after the guard's question was answered with Discard:
  // the notice's button is gone, so the keyboard goes back to the row that
  // asked, as the records grid's does (watched failing: the keyboard fell
  // to the page).
  test('a read refused after Discard gives the keyboard back to the row', async () => {
    const words = stamp('drill-refused-discard')
    const { order, lines } = await orderWithLines(engine, words, [1, 2])
    const held = holdingRequests(plane.fetch, ({ path }) => path.endsWith(`/v1/forms/${engine.lines}/records/read`))
    const user = await drilling(engine.formId, held.fetch)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await answeredOnce('Order line')
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await held.pass()
    await waitFor(() => expect(focusedName()).toBe(`Order line ${lines[0] ?? ''}`), ARRIVES)
    const quantity = await waitFor(() => within(pane(`Order line ${lines[0] ?? ''}`, 'React')).getByLabelText(/^Quantity\b/) as HTMLInputElement, ARRIVES)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.type(quantity, '5')
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: `Order ${order}` }))
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    await pressOn(user, 'Order line', '2', '{Enter}')
    const notice = await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)
    await user.click(within(notice).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await held.fail()
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'), ARRIVES)
    expect(document.activeElement?.textContent).toBe('2')
  })

  // The record's delete answered while the person is a level down: what it
  // asks of them -- here "Not deleted", the record having changed -- is
  // drawn at level 1, which is shown, with the keyboard in it, as Separate
  // views shows the record view (watched failing: the answer was drawn on
  // the hidden level 1 and the keyboard stayed a level down).
  test("the record's delete, answered a level down, shows level 1", async () => {
    const words = stamp('drill-not-deleted')
    const { order, lines } = await orderWithLines(engine, words, [1])
    const held = holdingRequests(plane.fetch, ({ path }) => path.endsWith(`/v1/forms/${engine.formId}/records/delete`))
    const user = await drilling(engine.formId, held.fetch)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(
      within(await waitFor(() => screen.getByRole('region', { name: `Delete Order ${order}?` }), ARRIVES)).getByRole('button', { name: 'Delete it' }),
    )
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await answeredOnce('Order line')
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order line ${lines[0] ?? ''}`), ARRIVES)
    // The order changed beside the page: the delete, sent at the version read, is refused as stale.
    const clerk = client(TOKENS.clerk)
    const read = await clerk.read(engine.formId, order)
    if (!read.ok || read.value.version === null) throw new Error('the order was not read')
    expect(await clerk.update(engine.formId, { record: order, version: read.value.version, answers: { notes: `${words} moved on` } })).toMatchObject({
      ok: true,
    })
    await held.pass()
    const detail = await waitFor(() => screen.getByRole('region', { name: `Order ${order}` }), ARRIVES)
    await waitFor(() => expect(detail.contains(document.activeElement)).toBe(true), ARRIVES)
    expect(trail()).toEqual(['Records', `Order ${order}`])
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=record&level=1`)
  })

  // What a row says it does is what the layout does with it: in Drill down
  // Space and Enter both open the record and move the keyboard to it, and
  // in the other layouts Space opens it and keeps the keyboard in the
  // grid. Said as the other layouts say it, a person at a screen reader
  // presses Space to look at a row and is taken away from the list
  // (watched failing: the other layouts' sentence in Drill down).
  test('a row says what Space and Enter do in each layout', async () => {
    const user = await drilling(engine.formId)
    // AG Grid speaks of a row when it moves the keyboard itself -- an arrow
    // key, a click -- and not when a cell is focused from outside it: so a
    // row's first cell is focused, and the keyboard moves one column.
    const firstCell = (): HTMLElement =>
      within(within(gridSection('Records')).getByRole('grid', { name: 'Records' })).getAllByRole('gridcell')[0] as HTMLElement
    firstCell().focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(rowSays('Records')).toBe('Space or Enter opens this record and moves to it.'), ARRIVES)
    await user.click(screen.getByRole('radio', { name: 'Side by side' }))
    firstCell().focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(rowSays('Records')).toBe('Space opens this record. Enter opens it and moves to it.'), ARRIVES)
  })

  // A crumb says what is stored, a delivery's by its carrier, its first
  // required plain text field: a save that changes the carrier renames it,
  // typing does not; and Load the saved record, after a save refused as
  // stale, names it by what it loaded, while the section above lists what
  // is stored too, as it does after a save there (watched failing: the
  // crumb kept the carrier the level was saved with, and the section above
  // listed it).
  test('a save renames its crumb, and so does Load the saved record', async () => {
    const words = stamp('drill-carrier')
    const { order } = await orderWithLines(engine, words, [])
    const clerk = client(TOKENS.clerk)
    const made = await clerk.create(engine.deliveries, { order, carrier: `${words} Post` })
    if (!made.ok || made.value.record === null) throw new Error(`the delivery was not created: ${made.ok ? 'no token' : made.message}`)
    const delivery = made.value.record
    const user = await drilling(engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await enterRowWith(user, 'Delivery', `${words} Post`)
    await waitFor(() => expect(trail()).toEqual(['Records', `Order ${order}`, `Delivery ${words} Post`]), ARRIVES)

    const carrier = (): Promise<HTMLInputElement> => field(`Delivery ${delivery}`, /^Carrier\b/)
    await user.clear(await carrier())
    await user.type(await carrier(), `${words} Bahn`)
    expect(trail()).toEqual(['Records', `Order ${order}`, `Delivery ${words} Post`])
    const sheet = pane(`Delivery ${delivery}`, 'React')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(trail()).toEqual(['Records', `Order ${order}`, `Delivery ${words} Bahn`]), ARRIVES)

    // Moved on elsewhere, so the next save here is stale.
    const read = await clerk.read(engine.deliveries, delivery)
    if (!read.ok || read.value.version === null) throw new Error('the delivery was not read')
    expect(await clerk.update(engine.deliveries, { record: delivery, version: read.value.version, answers: { carrier: `${words} Rail` } })).toMatchObject({
      ok: true,
    })
    await user.clear(await carrier())
    await user.type(await carrier(), `${words} Ship`)
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    const refused = await waitFor(() => within(sheet).getByRole('region', { name: `Delivery ${delivery} React Not saved` }), ARRIVES)
    await user.click(within(refused).getByRole('button', { name: 'Load the saved record' }))
    await waitFor(() => expect(trail()).toEqual(['Records', `Order ${order}`, `Delivery ${words} Rail`]), ARRIVES)
    await crumb(user, `Order ${order}`)
    await waitFor(() => expect(rows('Delivery').flat()).toContain(`${words} Rail`), ARRIVES)
  })

  // The record at level 1 is named as a level below is: Load the saved
  // record in its form names its crumb by what it loaded, and the records
  // list what is stored (watched failing: the crumb kept the carrier the
  // record was opened with).
  test('Load the saved record at level 1 names its crumb by what it loaded', async () => {
    const words = stamp('drill-carrier-one')
    const { order } = await orderWithLines(engine, words, [])
    const clerk = client(TOKENS.clerk)
    const made = await clerk.create(engine.deliveries, { order, carrier: `${words} Post` })
    if (!made.ok || made.value.record === null) throw new Error(`the delivery was not created: ${made.ok ? 'no token' : made.message}`)
    const delivery = made.value.record
    const user = await drilling(engine.deliveries)
    await searchRecords(user, words, [delivery.slice(3)])
    await pressOn(user, 'Records', delivery.slice(3), '{Enter}')
    await waitFor(() => expect(trail()).toEqual(['Records', `Delivery ${words} Post`]), ARRIVES)

    const read = await clerk.read(engine.deliveries, delivery)
    if (!read.ok || read.value.version === null) throw new Error('the delivery was not read')
    expect(await clerk.update(engine.deliveries, { record: delivery, version: read.value.version, answers: { carrier: `${words} Rail` } })).toMatchObject({
      ok: true,
    })
    const sheet = screen.getByRole('region', { name: 'React' })
    const carrier = (await waitFor(() => within(sheet).getByLabelText(/^Carrier\b/), ARRIVES)) as HTMLInputElement
    await user.clear(carrier)
    await user.type(carrier, `${words} Ship`)
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    const refused = await waitFor(() => within(sheet).getByRole('region', { name: 'React Not saved' }), ARRIVES)
    await user.click(within(refused).getByRole('button', { name: 'Load the saved record' }))
    await waitFor(() => expect(trail()).toEqual(['Records', `Delivery ${words} Rail`]), ARRIVES)
    await crumb(user, 'Records')
    await waitFor(() => expect(rows('Records').flat()).toContain(`${words} Rail`), ARRIVES)
  })

  // In Drill down a row opens as the next level, never on its section's
  // rail: back at the order, its section marks the row the next level
  // holds as open, and no rail heading is drawn (watched failing: no
  // Drill down).
  test('the rail is not drawn in Drill down', async () => {
    const words = stamp('drill-rail')
    const { order, lines } = await orderWithLines(engine, words, [1, 2])
    const user = await drilling(engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await answeredOnce('Order line')
    await pressOn(user, 'Order line', '2', '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order line ${lines[1] ?? ''}`), ARRIVES)
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: `Order ${order}` }))
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    expect((await rowOf('Order line', '2')).getAttribute('aria-selected')).toBe('true')
    expect((await rowOf('Order line', '1')).getAttribute('aria-selected')).not.toBe('true')
    expect(screen.queryByRole('heading', { level: 5 })).toBeNull()
  })

  // A row gone since its grid listed it: the read is refused, the person
  // stays where they were, and the section's grid says why -- the level
  // is not shown over nothing (watched failing: no Drill down).
  test('a read the server refuses stays on the section and says why', async () => {
    const words = stamp('drill-gone')
    const { order, lines } = await orderWithLines(engine, words, [1, 2])
    const user = await drilling(engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await answeredOnce('Order line')
    // The order deleted beside the page, its lines with it: the line form
    // offers no delete of its own on PostgreSQL (0050), the order's does.
    const clerk = client(TOKENS.clerk)
    const stored = await clerk.read(engine.formId, order)
    if (!stored.ok || stored.value.version === null) throw new Error('the order was not read')
    expect(await clerk.delete(engine.formId, { record: order, version: stored.value.version })).toMatchObject({ ok: true })
    const refused = await clerk.read(engine.lines, lines[0] ?? '')
    if (refused.ok) throw new Error('the line is still there')
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(
      () =>
        expect(
          within(gridSection('Order line'))
            .getAllByRole('status')
            .map((status) => status.textContent),
        ).toContain(refused.message),
      ARRIVES,
    )
    expect(trail()).toEqual(['Records', `Order ${order}`])
    expect(screen.getByRole('heading', { level: 3, name: `Order ${order}` })).toBeTruthy()
  })

  // A read answered after the person went up is not the level they asked
  // for any more: dropped, as a detail drops an answer it no longer waits
  // for (opening.ts). Shown, it would pull the person down a level they
  // left (watched failing: no Drill down).
  test('an answer for a level left behind is dropped', async () => {
    const words = stamp('drill-late')
    const { order } = await orderWithLines(engine, words, [1])
    const held = holdingRequests(plane.fetch, ({ path }) => path.endsWith(`/v1/forms/${engine.lines}/records/read`))
    const user = await drilling(engine.formId, held.fetch)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await answeredOnce('Order line')
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Records' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    await held.pass()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=records`)
    expect(focusedName()).toBe('Records')
    expect(screen.queryByRole('heading', { name: /^Order( line)? k1:/ })).toBeNull()
  })
})

/** A new employee's id, unique in this run: employees have no generated key. */
let employees = 200_000 + (Date.now() % 700_000)

/** An employee managed by `manager`, made beside the page: its token. */
async function employeeUnder(engine: Engine, manager: string, name: string): Promise<string> {
  employees += 1
  const as = client(TOKENS.clerk)
  const definition = await as.form(engine.employees)
  if (!definition.ok) throw new Error(definition.message)
  // The manager's field, as the generator named the lookup.
  const field = definition.value.form.model.fields.find((each) => each.optionsSource !== undefined)?.key ?? 'manager'
  const created = await as.create(engine.employees, { id: String(employees), name, [field]: manager })
  if (!created.ok || created.value.record === null) throw new Error(`the employee was not created: ${created.ok ? 'no token' : created.message}`)
  return created.value.record
}

/** An order approved by employee 1, written by the database's owner, with a line numbered 1: their tokens. */
async function approvedOrder(engine: Engine): Promise<{ order: string; line: string }> {
  const order = await plane.db.insertApprovedOrder(engine.connection, 1)
  const line = await client(TOKENS.clerk).create(engine.lines, { order, line_no: '1', quantity: '1', unit_price: '2.50' })
  if (!line.ok || line.value.record === null) throw new Error(`the line was not created: ${line.ok ? 'no token' : line.message}`)
  return { order, line: line.value.record }
}

/** Employee 1's name, as stored. */
async function firstEmployee(engine: Engine): Promise<string> {
  const read = await client(TOKENS.clerk).read(engine.employees, 'k1:1')
  if (!read.ok) throw new Error(read.message)
  return String(read.value.answers['name'])
}

/** Press the crumb named `name`. */
async function crumb(user: User, name: string): Promise<void> {
  await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name }))
}

/** A field of a level's React pane, by its label, once drawn. */
async function field(heading: string, label: RegExp): Promise<HTMLInputElement> {
  return waitFor(() => within(pane(heading, 'React')).getByLabelText(label) as HTMLInputElement, ARRIVES)
}

/** Down from employee 1 to the approved order's line: level 3, with the keyboard on its heading. */
async function toLine(user: User, order: string, line: string): Promise<void> {
  await pressOn(user, 'Records', '1', '{Enter}')
  await answeredOnce('Order, Approved by')
  await pressOn(user, 'Order, Approved by', order.slice(3), '{Enter}')
  await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
  await answeredOnce('Order line')
  await pressOn(user, 'Order line', '1', '{Enter}')
  await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)
}

/** Back one entry, once the browser has said so: the address alone cannot tell a Back the page answered from none. */
async function back(): Promise<void> {
  let popped = false
  window.addEventListener(
    'popstate',
    () => {
      popped = true
    },
    { once: true },
  )
  window.history.back()
  await waitFor(() => expect(popped).toBe(true), ARRIVES)
}

/** What the unsaved notice lists, item by item. */
function listed(notice: HTMLElement): string[] {
  return within(notice)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

describe.each(ENGINES)('Drill down, deep, on $engine', (engine) => {
  // Three levels below the records: employee 1, an order it approved, and
  // that order's line, the trail naming each. A crumb names a record by its
  // first required plain text field -- an employee by its name -- and by
  // its token otherwise: an order's status has a default, so the form does
  // not require it, and its customer is a lookup (watched failing: the
  // levels stopped at one).
  test('goes three levels below an employee, and the trail names each', async () => {
    const { order, line } = await approvedOrder(engine)
    const name = await firstEmployee(engine)
    const user = await drilling(engine.employees)
    await toLine(user, order, line)
    expect(trail()).toEqual(['Records', `Employee ${name}`, `Order ${order}`, `Order line ${line}`])
    expect(current()).toBe(`Order line ${line}`)
    expect(window.location.hash).toBe(`#form=${engine.employees}&layout=drill&view=record&level=3`)
    await waitFor(async () => expect((await field(`Order line ${line}`, /^Quantity\b/)).value).toBe('1'), ARRIVES)
  })

  // A form that is its own child, three times over: each level's sessions
  // and sections are owned under the level, so no element id is minted
  // twice, and every level still passes axe with a name on every control
  // (watched failing: the levels stopped at one).
  test('an employee under an employee under an employee mints no id twice', async () => {
    const third = await employeeUnder(engine, 'k1:2', stamp('third'))
    const user = await drilling(engine.employees)
    await pressOn(user, 'Records', '1', '{Enter}')
    await answeredOnce('Employee')
    await pressOn(user, 'Employee', '2', '{Enter}')
    await waitFor(() => expect(trail()).toHaveLength(3), ARRIVES)
    const cell = await waitFor(() => {
      const found = screen
        .getAllByRole('grid', { name: 'Employee' })
        .flatMap((grid) => within(grid).queryAllByRole('gridcell'))
        .find((each) => each.textContent === third.slice(3))
      expect(found).toBeDefined()
      return found as HTMLElement
    }, ARRIVES)
    cell.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(trail()).toHaveLength(4), ARRIVES)
    // Read from the DOM: an id has no role and no name.
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
    expect({ axe: await audit(), unnamed: unnamed() }).toEqual({ axe: [], unnamed: [] })
  })

  // Going up drops nothing, and going down into the row the level below
  // holds shows it as it was, typing included: the levels stay mounted.
  // A level read again would have dropped the typing (watched failing: the
  // levels stopped at one).
  test('a crumb keeps the levels below, and the same row shows them unchanged', async () => {
    const { order, line } = await approvedOrder(engine)
    const name = await firstEmployee(engine)
    const user = await drilling(engine.employees)
    await toLine(user, order, line)
    const quantity = await field(`Order line ${line}`, /^Quantity\b/)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.clear(quantity)
    await user.type(quantity, '42')
    await crumb(user, `Employee ${name}`)
    await waitFor(() => expect(focusedName()).toBe('Employee k1:1'), ARRIVES)
    expect(unsavedNotice()).toBeNull()
    await pressOn(user, 'Order, Approved by', order.slice(3), '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)
    expect((await field(`Order line ${line}`, /^Quantity\b/)).value).toBe('42')
  })

  // Going down into another row replaces the levels below, and asks first
  // when one of them holds work, naming its form: Keep editing leaves every
  // level as it was, Discard and continue replaces them (watched failing:
  // the levels stopped at one).
  test('going down into another row asks first when a level below holds work', async () => {
    const first = await approvedOrder(engine)
    const second = await approvedOrder(engine)
    const name = await firstEmployee(engine)
    const user = await drilling(engine.employees)
    await toLine(user, first.order, first.line)
    const quantity = await field(`Order line ${first.line}`, /^Quantity\b/)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.clear(quantity)
    await user.type(quantity, '42')
    await crumb(user, `Employee ${name}`)
    await waitFor(() => expect(focusedName()).toBe('Employee k1:1'), ARRIVES)

    await pressOn(user, 'Order, Approved by', second.order.slice(3), '{Enter}')
    const notice = await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)
    expect(
      within(notice)
        .getAllByRole('paragraph')
        .map((text) => text.textContent),
    ).toContain(`Opening ${second.order} closes these forms:`)
    expect(listed(notice)).toEqual([`Order line ${first.line}, React: changes that are not saved.`])
    await user.click(within(notice).getByRole('button', { name: 'Keep editing' }))
    expect(unsavedNotice()).toBeNull()
    expect(trail()).toEqual(['Records', `Employee ${name}`])
    expect(document.activeElement?.getAttribute('role')).toBe('gridcell')

    await pressOn(user, 'Order, Approved by', second.order.slice(3), '{Enter}')
    await user.click(within(await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(focusedName()).toBe(`Order ${second.order}`), ARRIVES)
    expect(trail()).toEqual(['Records', `Employee ${name}`, `Order ${second.order}`])
  })

  // What replaces the record at level 1 replaces every level under it, as
  // it replaces the child sections: another employee opened from the
  // records asks about the line typed into three levels down (the design's
  // eighth goal; watched failing: the levels stopped at one).
  test('another record at level 1 asks about every level below, and drops them', async () => {
    const { order, line } = await approvedOrder(engine)
    const user = await drilling(engine.employees)
    await toLine(user, order, line)
    const quantity = await field(`Order line ${line}`, /^Quantity\b/)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.type(quantity, '7')
    await crumb(user, 'Records')
    await pressOn(user, 'Records', '2', '{Enter}')
    const notice = await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)
    expect(listed(notice)).toEqual([`Order line ${line}, React: changes that are not saved.`])
    await user.click(within(notice).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(focusedName()).toBe('Employee k1:2'), ARRIVES)
    expect(trail()).toHaveLength(2)
  })

  // A new row at a level: preset with the level above and drawn disabled
  // there, named new until a save creates it, then by what is stored, and
  // listed in the section above (watched failing: the levels stopped at one).
  test('a new line at level 3 is named new until it is saved', async () => {
    const { order } = await approvedOrder(engine)
    const user = await drilling(engine.employees)
    await pressOn(user, 'Records', '1', '{Enter}')
    await answeredOnce('Order, Approved by')
    await pressOn(user, 'Order, Approved by', order.slice(3), '{Enter}')
    await answeredOnce('Order line')
    await user.click(within(gridSection('Order line')).getByRole('button', { name: 'New Order line' }))
    await waitFor(() => expect(focusedName()).toBe('New Order line'), ARRIVES)
    expect(current()).toBe('New Order line')
    const sheet = pane('New Order line', 'React')
    const parent = (await waitFor(() => within(sheet).getByRole('combobox', { name: /^Order\*?$/ }), ARRIVES)) as HTMLSelectElement
    expect({ disabled: parent.disabled, value: parent.value }).toEqual({ disabled: true, value: order })
    for (const [label, value] of [
      [/^Line no\b/, '5'],
      [/^Quantity\b/, '3'],
      [/^Unit price\b/, '1.25'],
    ] as const) {
      const input = within(sheet).getByLabelText(label) as HTMLInputElement
      await user.clear(input)
      await user.type(input, value)
    }
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(current()).toMatch(/^Order line k1:/), ARRIVES)
    const token = current().slice('Order line '.length)
    expect(screen.getByRole('heading', { level: 3, name: `Order line ${token}` })).toBeTruthy()
    await crumb(user, `Order ${order}`)
    await waitFor(() => expect(rows('Order line').map((cells) => cells[0])).toEqual(['1', '5']), ARRIVES)
  })

  // A crumb says what is stored: typing a name into a new employee changes
  // nothing in the trail, and the save that creates it names the crumb by
  // what was stored. An employee has no version to update under, so its
  // saved record is read only and the create is the save here (watched
  // failing: the levels stopped at one).
  test('a save names its crumb, typing does not', async () => {
    const named = stamp('named')
    const name = await firstEmployee(engine)
    const user = await drilling(engine.employees)
    await pressOn(user, 'Records', '1', '{Enter}')
    await answeredOnce('Employee')
    await user.click(within(gridSection('Employee')).getByRole('button', { name: 'New Employee' }))
    await waitFor(() => expect(trail()).toEqual(['Records', `Employee ${name}`, 'New Employee']), ARRIVES)
    employees += 1
    await user.type(await field('New Employee', /^Id\b/), String(employees))
    await user.type(await field('New Employee', /^Name\b/), named)
    expect(trail()).toEqual(['Records', `Employee ${name}`, 'New Employee'])
    await user.click(within(pane('New Employee', 'React')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(trail()).toEqual(['Records', `Employee ${name}`, `Employee ${named}`]), ARRIVES)
  })

  // Another layout shows level 1 as that layout shows it, and the levels
  // below stay mounted and hidden, their work still the guard's; Drill
  // down again shows the level the person left (the design's second call;
  // watched failing: the levels stopped at one).
  test('another layout keeps the levels below, and Drill down returns to them', async () => {
    const { order, line } = await approvedOrder(engine)
    const user = await drilling(engine.employees)
    await toLine(user, order, line)
    const quantity = await field(`Order line ${line}`, /^Quantity\b/)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.type(quantity, '9')
    await user.click(screen.getByRole('radio', { name: 'Side by side' }))
    expect(screen.getByRole('heading', { level: 3, name: 'Employee k1:1' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(screen.queryByRole('heading', { name: `Order line ${line}` })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    const notice = await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)
    expect(listed(notice)).toEqual([`Order line ${line}, React: changes that are not saved.`])
    await user.click(within(notice).getByRole('button', { name: 'Keep editing' }))
    await user.click(screen.getByRole('radio', { name: 'Drill down' }))
    expect(current()).toBe(`Order line ${line}`)
    expect(window.location.hash).toBe(`#form=${engine.employees}&layout=drill&view=record&level=3`)
    expect((await field(`Order line ${line}`, /^Quantity\b/)).value).toBe('19')
  })

  // Back onto an entry whose level is gone -- replaced by going down
  // elsewhere -- shows the deepest level held above it and takes the entry,
  // so the next Back goes on rather than sticking (the design's first call;
  // watched failing: the levels stopped at one).
  test('Back onto a level that is gone shows the deepest one held', async () => {
    const first = await approvedOrder(engine)
    const second = await approvedOrder(engine)
    const name = await firstEmployee(engine)
    const user = await drilling(engine.employees)
    await toLine(user, first.order, first.line)
    await crumb(user, `Employee ${name}`)
    await waitFor(() => expect(focusedName()).toBe('Employee k1:1'), ARRIVES)
    await pressOn(user, 'Order, Approved by', second.order.slice(3), '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${second.order}`), ARRIVES)
    const at = (level: number): string => `#form=${engine.employees}&layout=drill&view=record&level=${String(level)}`
    expect(window.location.hash).toBe(at(2))

    await back()
    await waitFor(() => expect(window.location.hash).toBe(at(1)), ARRIVES)
    await waitFor(() => expect(focusedName()).toBe('Employee k1:1'), ARRIVES)
    await back()
    // The line's entry: level 3 is gone, so level 2 is shown and the entry says so.
    await waitFor(() => expect(window.location.hash).toBe(at(2)), ARRIVES)
    await waitFor(() => expect(focusedName()).toBe(`Order ${second.order}`), ARRIVES)
    expect(trail()).toEqual(['Records', `Employee ${name}`, `Order ${second.order}`])
    await back()
    await waitFor(() => expect(window.location.hash).toBe(at(2)), ARRIVES)
    await back()
    await waitFor(() => expect(window.location.hash).toBe(at(1)), ARRIVES)
    await waitFor(() => expect(focusedName()).toBe('Employee k1:1'), ARRIVES)
  })
})

/** The confirmation a Delete opened, by its question. */
function confirmation(noun: string, record: string): HTMLElement {
  return screen.getByRole('region', { name: `Delete ${noun} ${record}?` })
}

/** Down from an order to its line `no`: level 2, the order found by `words`. */
async function toOrderLine(user: User, words: string, order: string, line: string, no = '1'): Promise<void> {
  await searchRecords(user, words, [order.slice(3)])
  await pressOn(user, 'Records', order.slice(3), '{Enter}')
  await answeredOnce('Order line')
  await pressOn(user, 'Order line', no, '{Enter}')
  await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)
}

// On SQL Server alone: there an order line's rowversion proves a delete,
// and on PostgreSQL the line form offers none (0050), so no level below the
// record can be deleted there.
describe.each(ENGINES.filter((engine) => engine.connection === 'ms'))('Drill down, deleting, on $engine', (engine) => {
  // A record deleted at a level is gone from every level: the level above
  // is shown, with no step of its own in the history, its section's grid
  // says the row is gone, and the keyboard is on that section's heading
  // (watched failing: the level stayed, showing a record that is gone).
  test('a delete at level 2 goes to level 1', async () => {
    const words = stamp('drill-delete')
    const { order, lines } = await orderWithLines(engine, words, [1, 2])
    const user = await drilling(engine.formId)
    await toOrderLine(user, words, order, lines[0] ?? '')
    await user.click(screen.getByRole('button', { name: 'Delete Order line' }))
    await user.click(within(await waitFor(() => confirmation('Order line', lines[0] ?? ''), ARRIVES)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Order line'), ARRIVES)
    expect(trail()).toEqual(['Records', `Order ${order}`])
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=record&level=1`)
    await waitFor(
      () =>
        expect(
          within(gridSection('Order line'))
            .getAllByRole('status')
            .some((status) => status.textContent?.startsWith(`Deleted Order line ${lines[0] ?? ''}. `)),
        ).toBe(true),
      ARRIVES,
    )
    await waitFor(() => expect(rows('Order line').map((cells) => cells[0])).toEqual(['2']), ARRIVES)
  })

  // The row the level below holds, deleted from its grid one level up: the
  // levels below go with it, so its confirmation names what they hold, as
  // the open record's names its own forms (0053), and nothing is dropped
  // before Delete it: Keep it leaves the typing where it was, and once
  // deleted the level below is gone. Asked about before the confirmation,
  // the typing was dropped for a delete the person then kept from
  // happening (watched failing: the guard's question came first).
  test("the held row's Delete names the levels below in its confirmation, and Keep it keeps their typing", async () => {
    const words = stamp('drill-held')
    const { order, lines } = await orderWithLines(engine, words, [1, 2])
    const line = lines[0] ?? ''
    const user = await drilling(engine.formId)
    await toOrderLine(user, words, order, line)
    const quantity = await field(`Order line ${line}`, /^Quantity\b/)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.type(quantity, '5')
    await crumb(user, `Order ${order}`)
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    const rowDelete = (): HTMLElement => within(gridSection('Order line')).getByRole('button', { name: `Delete Order line ${line}` })
    await user.click(rowDelete())
    const asked = await waitFor(() => confirmation('Order line', line), ARRIVES)
    expect(unsavedNotice()).toBeNull()
    expect(listed(asked)).toEqual([`Order line ${line}, React: changes that are not saved.`])
    await user.click(within(asked).getByRole('button', { name: 'Keep it' }))
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)
    expect((await field(`Order line ${line}`, /^Quantity\b/)).value).toBe('15')

    await crumb(user, `Order ${order}`)
    await user.click(rowDelete())
    await user.click(within(await waitFor(() => confirmation('Order line', line), ARRIVES)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(rows('Order line').map((cells) => cells[0])).toEqual(['2']), ARRIVES)
    expect(screen.queryByRole('heading', { name: `Order line ${line}` })).toBeNull()
    // The level below is gone: going down into the other line reads it, and the trail has nothing past it.
    await pressOn(user, 'Order line', '2', '{Enter}')
    await waitFor(() => expect(trail()).toEqual(['Records', `Order ${order}`, `Order line ${lines[1] ?? ''}`]), ARRIVES)
  })

  // A delete answered once the person has gone up: the levels below the
  // deleted record still go, but nothing moves the person or the keyboard
  // -- as a delete answered after the person moved on is quiet in the
  // detail (watched failing with the level above shown whenever a level
  // went: the answer pulled the person back down to the order).
  test('a delete answered after the person went up is quiet', async () => {
    const words = stamp('drill-quiet')
    const { order, lines } = await orderWithLines(engine, words, [1])
    const held = holdingRequests(plane.fetch, ({ path }) => path.endsWith(`/v1/forms/${engine.lines}/records/delete`))
    const user = await drilling(engine.formId, held.fetch)
    await toOrderLine(user, words, order, lines[0] ?? '')
    await user.click(screen.getByRole('button', { name: 'Delete Order line' }))
    await user.click(within(await waitFor(() => confirmation('Order line', lines[0] ?? ''), ARRIVES)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await crumb(user, 'Records')
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    await held.pass()
    await waitFor(async () => expect(await client(TOKENS.clerk).read(engine.lines, lines[0] ?? '')).toMatchObject({ ok: false, status: 404 }), ARRIVES)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(focusedName()).toBe('Records')
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=records`)
    expect(trail()).toEqual(['Records'])
  })

  // A level's delete answered after the person went up, went down into
  // another row, and discarded the deletion to do so: the level now at that
  // depth is another record's, and stays, typing included; only the grid
  // above says the row is gone (watched failing: the new level vanished
  // with the old one's answer).
  test('a late delete leaves the level that replaced its own', async () => {
    const words = stamp('drill-late-delete')
    const { order, lines } = await orderWithLines(engine, words, [1, 2])
    const held = holdingRequests(plane.fetch, ({ path }) => path.endsWith(`/v1/forms/${engine.lines}/records/delete`))
    const user = await drilling(engine.formId, held.fetch)
    await toOrderLine(user, words, order, lines[0] ?? '')
    await user.click(screen.getByRole('button', { name: 'Delete Order line' }))
    await user.click(within(await waitFor(() => confirmation('Order line', lines[0] ?? ''), ARRIVES)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    await crumb(user, `Order ${order}`)
    await pressOn(user, 'Order line', '2', '{Enter}')
    await user.click(within(await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(focusedName()).toBe(`Order line ${lines[1] ?? ''}`), ARRIVES)
    const quantity = await field(`Order line ${lines[1] ?? ''}`, /^Quantity\b/)
    await waitFor(() => expect(quantity.value).toBe('2'), ARRIVES)
    await user.type(quantity, '4')
    await held.pass()
    await waitFor(async () => expect(await client(TOKENS.clerk).read(engine.lines, lines[0] ?? '')).toMatchObject({ ok: false, status: 404 }), ARRIVES)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(trail()).toEqual(['Records', `Order ${order}`, `Order line ${lines[1] ?? ''}`])
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=drill&view=record&level=2`)
    expect((await field(`Order line ${lines[1] ?? ''}`, /^Quantity\b/)).value).toBe('24')
  })

  // The row a level holds, deleted from its grid in another layout: its
  // confirmation names the level's typing, as it does in Drill down, and
  // once deleted the level is gone, so Drill down does not show a record
  // that is not there (watched failing: no word of the typing, and Drill
  // down showed the deleted line with it).
  test('a held row deleted in another layout names its level, and takes it', async () => {
    const words = stamp('drill-other-layout')
    const { order, lines } = await orderWithLines(engine, words, [1, 2])
    const line = lines[0] ?? ''
    const user = await drilling(engine.formId)
    await toOrderLine(user, words, order, line)
    const quantity = await field(`Order line ${line}`, /^Quantity\b/)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.type(quantity, '6')
    await user.click(screen.getByRole('radio', { name: 'Side by side' }))
    await answeredOnce('Order line')
    await user.click(within(gridSection('Order line')).getByRole('button', { name: `Delete Order line ${line}` }))
    const asked = await waitFor(() => confirmation('Order line', line), ARRIVES)
    expect(unsavedNotice()).toBeNull()
    expect(listed(asked)).toEqual([`Order line ${line}, React: changes that are not saved.`])
    await user.click(within(asked).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(rows('Order line').map((cells) => cells[0])).toEqual(['2']), ARRIVES)
    await user.click(screen.getByRole('radio', { name: 'Drill down' }))
    expect(trail()).toEqual(['Records', `Order ${order}`])
    expect(screen.queryByRole('heading', { name: `Order line ${line}` })).toBeNull()
  })

  // The record itself deleted at level 1 takes every level below with it,
  // and the records are shown, as in Separate views (watched failing: the
  // levels below outlived their record).
  test('a delete at level 1 goes to the records, and the levels below go with it', async () => {
    const words = stamp('drill-record')
    const { order, lines } = await orderWithLines(engine, words, [1])
    const user = await drilling(engine.formId)
    await toOrderLine(user, words, order, lines[0] ?? '')
    await crumb(user, `Order ${order}`)
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    await user.click(screen.getByRole('button', { name: 'Delete record' }))
    await user.click(within(await waitFor(() => confirmation('Order', order), ARRIVES)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    expect(trail()).toEqual(['Records'])
    expect(screen.queryByRole('heading', { name: `Order line ${lines[0] ?? ''}` })).toBeNull()
    // Read from the DOM: a level not shown is still mounted while it is held, and none is.
    expect(document.querySelectorAll('.drill-level')).toHaveLength(0)
  })
})

describe.each(ENGINES)('Drill down on a phone, and the floor, on $engine', (engine) => {
  // Every level a person reaches passes axe with a name on every control:
  // the trail's crumbs are buttons named by their text, and the level shown
  // is no button (watched failing with the crumbs' text left out). A grid
  // just mounted is named once AG Grid has drawn it, so each level is read
  // once every section's grid has answered.
  test('every level passes axe with a name on every control', async () => {
    const floor = async (level: number): Promise<void> => {
      await waitFor(() => expect(unnamed()).toEqual([]), ARRIVES)
      expect({ level, axe: await audit(), unnamed: unnamed() }).toEqual({ level, axe: [], unnamed: [] })
    }
    const { order, line } = await approvedOrder(engine)
    const user = await drilling(engine.employees)
    await floor(0)
    await pressOn(user, 'Records', '1', '{Enter}')
    await waitFor(() => expect(focusedName()).toBe('Employee k1:1'), ARRIVES)
    for (const section of ['Employee', 'Order, Created by', 'Order, Approved by']) await answeredOnce(section)
    await floor(1)
    await pressOn(user, 'Order, Approved by', order.slice(3), '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    // A level's sections are drawn once its form's children are known, a moment after the level.
    await answeredOnce('Order line')
    await floor(2)
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)
    await floor(3)
  })

  // On a phone, past three crumbs, the trail draws the first, a button that
  // says how many levels there are, collapsed, and the last two; pressed, it
  // draws every crumb and the keyboard goes to the first one it drew, since
  // the button itself is gone (watched failing: the keyboard fell to the
  // page with the button). jsdom resolves no media query, so the window's
  // is stood in for, as the browser gate measures the real one.
  test('the trail draws its ends, and a button that draws the rest', async () => {
    const { order, line } = await approvedOrder(engine)
    const name = await firstEmployee(engine)
    const media = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: /max-width: (40|56)rem/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
    })
    try {
      const user = await drilling(engine.employees)
      await toLine(user, order, line)
      expect(trail()).toEqual(['Records', '…', `Order ${order}`, `Order line ${line}`])
      const more = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Show all 4 levels' })
      expect(more.getAttribute('aria-expanded')).toBe('false')
      expect({ axe: await audit(), unnamed: unnamed() }).toEqual({ axe: [], unnamed: [] })
      await user.click(more)
      expect(trail()).toEqual(['Records', `Employee ${name}`, `Order ${order}`, `Order line ${line}`])
      await waitFor(() => expect(focusedName()).toBe(`Employee ${name}`), ARRIVES)
    } finally {
      if (media === undefined) Reflect.deleteProperty(window, 'matchMedia')
      else Object.defineProperty(window, 'matchMedia', media)
    }
  })
})
