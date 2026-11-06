import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { createDataClient } from '@formancy/data-client'
import type { DataClient } from '@formancy/data-client'
import { audit, focusedName, unnamed } from './test-accessible.js'
import {
  answeredOnce,
  chooseForm,
  chooseRenderer,
  dataRows,
  gridSection,
  load,
  loaded,
  mount,
  newRecord,
  RENDERERS,
  searchRecords,
  showChild,
  signIn,
  stamp,
  unsavedNotice,
} from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { PREFERENCES } from './prefs.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * Open under a lookup (0141): under each lookup of a record whose answer is
 * a token, one button per form the server names for it (0140), which opens
 * the record that answer names one Drill down level below, in that form --
 * from any layout, which becomes Drill down. On both engines, under each
 * renderer, against the real server, through the forms `startPlane({
 * children: true, deletes: true })` publishes: an order line, whose order
 * both the order form and the staff's order form are over, keyed by what
 * the line's foreign key references, both titled "Order"; and the staff's
 * order, whose creator and approver are both employees, which the
 * employee form is over.
 *
 * Found by role and accessible name. What the accessibility tree cannot
 * answer is read off the DOM, each where it is made: `location.hash` and
 * `localStorage`, which are the browser's; and the crumb that is the page,
 * by `aria-current`, which the tree gives no role of its own.
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

/**
 * Each renderer's own order for the line it picks one for, dated before
 * every other tenant-1 order a run makes but lookup-controls.test.tsx's, so
 * the line's plain select of its first page, in date-then-key order, lists
 * it however many orders other files add while this one runs.
 */
const DATED: Readonly<Record<RendererName, string>> = { React: '2026-01-04', Angular: '2026-01-05' }

function client(token: string): DataClient {
  return createDataClient({ token: () => token, fetch: plane.fetch })
}

/** An order of tenant 1's for Muster AG noted `notes` and dated `date`, with a line numbered 1, made beside the page: their tokens. */
async function lineOf(engine: Engine, notes: string, date: string = EDGES.orderDate): Promise<{ order: string; line: string }> {
  const as = client(TOKENS.clerk)
  const definition = await as.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await as.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await as.create(engine.formId, { customer: found.value.rows[0].token, order_date: date, status: 'placed', amount: '1', notes })
  if (!created.ok || created.value.record === null) throw new Error(`the order was not created: ${created.ok ? 'no token' : created.message}`)
  const order = created.value.record
  const line = await as.create(engine.lines, { order, line_no: '1', quantity: '1', unit_price: '2.50' })
  if (!line.ok || line.value.record === null) throw new Error(`the line was not created: ${line.ok ? 'no token' : line.message}`)
  return { order, line: line.value.record }
}

/** The page signed in as tenant 1's clerk, the order line form chosen in Stacked, where it arrives (0145), and `renderer` alone drawing it. */
async function lines(engine: Engine, renderer: RendererName): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, engine.lines)
  await chooseRenderer(user, renderer)
  return user
}

/** The line form chosen, the line loaded by its token, and drawn in `renderer`'s pane with its quantity. */
async function lineLoaded(engine: Engine, renderer: RendererName, line: string): Promise<User> {
  const user = await lines(engine, renderer)
  await load(user, line)
  await loaded(line, 'Order line')
  await waitFor(() => expect(quantity(renderer).value).toBe('1'), ARRIVES)
  return user
}

/** The record's pane under `renderer`: at level 1 the region its renderer's heading alone names. */
const recordPane = (renderer: RendererName): HTMLElement => screen.getByRole('region', { name: renderer })

/** A Drill down level's pane: the region its heading and the renderer name. */
const levelPane = (heading: string, renderer: RendererName): HTMLElement => screen.getByRole('region', { name: `${heading} ${renderer}` })

/** The line's Quantity in the record's pane. */
const quantity = (renderer: RendererName): HTMLInputElement => within(recordPane(renderer)).getByLabelText<HTMLInputElement>(/^Quantity\b/)

/** The line's Order in the record's pane: its label carries the required mark in one renderer. */
const orderIn = (renderer: RendererName): HTMLSelectElement => within(recordPane(renderer)).getByRole<HTMLSelectElement>('combobox', { name: /^Order\*?$/ })

/** A level's Notes, once drawn. */
async function notesAt(heading: string, renderer: RendererName): Promise<HTMLInputElement> {
  return waitFor(() => within(levelPane(heading, renderer)).getByLabelText<HTMLInputElement>('Notes', { exact: true }), ARRIVES)
}

/** Every Open a pane offers, by name: "Open in <form>", or "Open <lookup> in <form>". */
function opensIn(container: HTMLElement): string[] {
  return within(container)
    .queryAllByRole('button', { name: /^Open (.+ )?in / })
    .map((button) => button.textContent ?? '')
}

/** Enter on the first cell of the row of the grid `heading` names whose first cell says `first`, once it is listed. */
async function enterRow(user: User, heading: string, first: string): Promise<void> {
  const row = await waitFor(() => {
    const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
    const found = dataRows(grid).find((candidate) => within(candidate).queryAllByRole('gridcell')[0]?.textContent === first)
    expect(found, `${heading} lists no ${first}`).toBeDefined()
    return found as HTMLElement
  }, ARRIVES)
  ;(within(row).getAllByRole('gridcell')[0] as HTMLElement).focus()
  await user.keyboard('{Enter}')
}

/** An employee's name, as stored. */
async function employeeName(engine: Engine, token: string): Promise<string> {
  const read = await client(TOKENS.clerk).read(engine.employees, token)
  if (!read.ok) throw new Error(read.message)
  return String(read.value.answers['name'])
}

/** The two Opens under a line's order: both order forms are titled Order, so each says its id. */
const bothOrders = (engine: Engine): string[] => [`Open in Order (${engine.formId})`, `Open in Order (${engine.staff})`]

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

/** Press the crumb named `name`. */
async function crumb(user: User, name: string): Promise<void> {
  await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name }))
}

/** What the unsaved notice lists, item by item. */
function listed(notice: HTMLElement): string[] {
  return within(notice)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

describe.each(ENGINES)('Open under a lookup on $engine', (engine) => {
  describe.each(RENDERERS)('in %s', (renderer) => {
    // A line's order opens below the line, in the form chosen, from Stacked,
    // which becomes Drill down: the trail names the line and the
    // order, and its first crumbs lead back up to the line as it was left,
    // its typing kept -- the level above is never read again. Opened in
    // the other order form, the order is that form's, which this clerk may
    // only read. Without the addition, no pane offered an Open (to be
    // watched failing in CI with the record's panes given no offer, and
    // with Open from Stacked left in it: the address said no level).
    test("a line's order opens below the line in either order form, and the trail leads back up", async () => {
      const words = stamp('open')
      const { order, line } = await lineOf(engine, words)
      const user = await lineLoaded(engine, renderer, line)
      await user.clear(quantity(renderer))
      await user.type(quantity(renderer), '42')
      await waitFor(() => expect(opensIn(recordPane(renderer))).toEqual(bothOrders(engine)), ARRIVES)

      await user.click(within(recordPane(renderer)).getByRole('button', { name: `Open in Order (${engine.formId})` }))
      await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
      expect(trail()).toEqual(['Records', `Order line ${line}`, `Order ${order}`])
      expect(current()).toBe(`Order ${order}`)
      expect(window.location.hash).toBe(`#form=${engine.lines}&layout=drill&view=record&level=2`)
      expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Drill down' }).checked).toBe(true)
      const notes = await notesAt(`Order ${order}`, renderer)
      await waitFor(() => expect({ value: notes.value, disabled: notes.disabled }).toEqual({ value: words, disabled: false }), ARRIVES)

      await crumb(user, `Order line ${line}`)
      await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)
      expect(window.location.hash).toBe(`#form=${engine.lines}&layout=drill&view=record&level=1`)
      expect(unsavedNotice()).toBeNull()
      expect(quantity(renderer).value).toBe('42')

      await user.click(within(recordPane(renderer)).getByRole('button', { name: `Open in Order (${engine.staff})` }))
      await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
      expect(trail()).toEqual(['Records', `Order line ${line}`, `Order ${order}`])
      const read = await notesAt(`Order ${order}`, renderer)
      await waitFor(() => expect({ value: read.value, disabled: read.disabled }).toEqual({ value: words, disabled: true }), ARRIVES)
    })

    // A lookup with no answer points at no record: nothing is offered under
    // it, and the paper passes axe either way. The answer Open reads is the
    // one the field holds now: an order picked for a new line, not saved,
    // is the one that opens (to be watched failing in CI with the answer
    // unchecked in openChoices: an Open under the empty Order).
    test('an empty lookup offers nothing, and the order picked is the one that opens', async () => {
      const date = DATED[renderer]
      const { order } = await lineOf(engine, `dated ${date}`, date)
      const user = await lines(engine, renderer)
      await newRecord(user)
      const option = await waitFor(() => within(orderIn(renderer)).getByRole('option', { name: date }), ARRIVES)
      expect(opensIn(recordPane(renderer))).toEqual([])
      expect({ axe: await audit(), unnamed: unnamed() }).toEqual({ axe: [], unnamed: [] })

      await user.selectOptions(orderIn(renderer), option)
      await waitFor(() => expect(opensIn(recordPane(renderer))).toEqual(bothOrders(engine)), ARRIVES)
      expect({ axe: await audit(), unnamed: unnamed() }).toEqual({ axe: [], unnamed: [] })
      await user.click(within(recordPane(renderer)).getByRole('button', { name: `Open in Order (${engine.formId})` }))
      await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
      expect(trail()).toEqual(['Records', 'New Order line', `Order ${order}`])
      const notes = await notesAt(`Order ${order}`, renderer)
      await waitFor(() => expect(notes.value).toBe(`dated ${date}`), ARRIVES)
    })
  })

  // A record gone since the lookup named it -- or one the form's row
  // filters hide, which the server answers the same -- is refused: the
  // person stays where they were, in their layout, the keyboard on the
  // Open they pressed, and the record's line says the form does not show
  // it (to be watched failing in CI with the refusal unsaid).
  test('a read the server refuses stays on the record and says why', async () => {
    const { order, line } = await lineOf(engine, stamp('open-gone'))
    const user = await lineLoaded(engine, 'React', line)
    const open = await waitFor(() => within(recordPane('React')).getByRole('button', { name: `Open in Order (${engine.formId})` }), ARRIVES)
    // The order deleted beside the page, its lines with it (0050).
    const clerk = client(TOKENS.clerk)
    const stored = await clerk.read(engine.formId, order)
    if (!stored.ok || stored.value.version === null) throw new Error('the order was not read')
    expect(await clerk.delete(engine.formId, { record: order, version: stored.value.version })).toMatchObject({ ok: true })

    await user.click(open)
    await waitFor(
      () =>
        expect(within(screen.getByRole('region', { name: `Order line ${line}` })).getAllByRole('status')[0]?.textContent).toBe(
          'Order does not show you this record.',
        ),
      ARRIVES,
    )
    expect(focusedName()).toBe(`Open in Order (${engine.formId})`)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Stacked' }).checked).toBe(true)
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
  })

  // Drill down reached by Open is where the record went, not a layout the
  // person chose (0145): it is not kept, so the next arrival with no layout
  // in its address opens where it would have -- in Stacked, nothing chosen
  // -- rather than in Drill down's records, the levels gone (to be watched
  // failing in CI with every layout the page moves to kept as chosen).
  test('Open into Drill down keeps no layout for the next arrival', async () => {
    const { order, line } = await lineOf(engine, stamp('open-kept'))
    const user = await lineLoaded(engine, 'React', line)
    await user.click(await waitFor(() => within(recordPane('React')).getByRole('button', { name: `Open in Order (${engine.formId})` }), ARRIVES))
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Drill down' }).checked).toBe(true)
    expect(localStorage.getItem(PREFERENCES.layout)).toBeNull()
    cleanup()

    window.history.replaceState(null, '', '/')
    const again = mount(plane.fetch)
    await signIn(again, TOKENS.clerk)
    await chooseForm(again, engine.lines)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Stacked' }).checked).toBe(true)
  })

  // The record the level below holds, opened the same way again, is shown
  // as it was, typing kept; opened in another form, it replaces that level,
  // and the guard asks first, naming the level's form: Keep editing gives
  // the keyboard back to the Open pressed, Discard and continue opens it
  // (to be watched failing in CI with the level below read again whatever
  // it holds: the typing was gone).
  test('Open again shows the level below as it was, and another form asks about its typing', async () => {
    const words = stamp('open-again')
    const { order, line } = await lineOf(engine, words)
    const user = await lineLoaded(engine, 'React', line)
    const staff = `Open in Order (${engine.staff})`
    await user.click(await waitFor(() => within(recordPane('React')).getByRole('button', { name: `Open in Order (${engine.formId})` }), ARRIVES))
    const notes = await notesAt(`Order ${order}`, 'React')
    await waitFor(() => expect(notes.value).toBe(words), ARRIVES)
    await user.type(notes, ' typed')
    await crumb(user, `Order line ${line}`)
    await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)

    await user.click(within(recordPane('React')).getByRole('button', { name: `Open in Order (${engine.formId})` }))
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    expect(unsavedNotice()).toBeNull()
    expect((await notesAt(`Order ${order}`, 'React')).value).toBe(`${words} typed`)
    await crumb(user, `Order line ${line}`)
    await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)

    await user.click(within(recordPane('React')).getByRole('button', { name: staff }))
    const notice = await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)
    expect(
      within(notice)
        .getAllByRole('paragraph')
        .map((text) => text.textContent),
    ).toContain(`Opening ${order} closes these forms:`)
    expect(listed(notice)).toEqual([`Order ${order}, React: changes that are not saved.`])
    await user.click(within(notice).getByRole('button', { name: 'Keep editing' }))
    expect(unsavedNotice()).toBeNull()
    await waitFor(() => expect(focusedName()).toBe(staff), ARRIVES)
    expect(trail()).toEqual(['Records', `Order line ${line}`])

    await user.click(within(recordPane('React')).getByRole('button', { name: staff }))
    await user.click(within(await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)).getByRole('button', { name: 'Discard and continue' }))
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    const read = await notesAt(`Order ${order}`, 'React')
    await waitFor(() => expect({ value: read.value, disabled: read.disabled }).toEqual({ value: words, disabled: true }), ARRIVES)
  })

  // A line opened below its order holds that order in its parent field,
  // drawn disabled: Open there would open the record the level above
  // shows, again, a level further down -- the line at level 1 offers both
  // order forms under that field, as the first case shows (to be watched
  // failing in CI with the level's opens passed through opensBelow
  // unfiltered).
  test('a line opened below its order offers no Open under its order', async () => {
    const words = stamp('open-parent')
    const { order, line } = await lineOf(engine, words)
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.formId)
    await chooseRenderer(user, 'React')
    await user.click(screen.getByRole('radio', { name: 'Drill down' }))
    await searchRecords(user, words, [order.slice(3)])
    await enterRow(user, 'Records', order.slice(3))
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    await showChild(user, 'Order line')
    await answeredOnce('Order line')
    await enterRow(user, 'Order line', '1')
    await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)
    const below = levelPane(`Order line ${line}`, 'React')
    const parent = await waitFor(() => within(below).getByRole<HTMLSelectElement>('combobox', { name: /^Order\*?$/ }), ARRIVES)
    await waitFor(() => expect({ value: parent.value, disabled: parent.disabled }).toEqual({ value: order, disabled: true }), ARRIVES)
    expect(opensIn(below)).toEqual([])
  })

  // A level reached through a lookup offers Open under its own lookups,
  // a level further down, the trail naming every level and its crumbs
  // going back up. The staff's order names two employees, its creator and
  // its approver, both in the employee form: each Open says its lookup,
  // so a person -- and this test -- can tell them apart by name (to be
  // watched failing in CI with forms told apart within one lookup alone:
  // two buttons named "Open in Employee").
  test("a lookup's record opens a level further down, each Open named for its lookup", async () => {
    const order = await plane.db.insertApprovedOrder(engine.connection, 1, 2)
    const made = await client(TOKENS.clerk).create(engine.lines, { order, line_no: '1', quantity: '1', unit_price: '2.50' })
    if (!made.ok || made.value.record === null) throw new Error(`the line was not created: ${made.ok ? 'no token' : made.message}`)
    const line = made.value.record
    const [approver, creator] = [await employeeName(engine, 'k1:1'), await employeeName(engine, 'k1:2')]
    const user = await lineLoaded(engine, 'React', line)
    await user.click(await waitFor(() => within(recordPane('React')).getByRole('button', { name: `Open in Order (${engine.staff})` }), ARRIVES))
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    const staff = (): HTMLElement => levelPane(`Order ${order}`, 'React')
    await waitFor(() => expect(opensIn(staff()).sort()).toEqual(['Open Approved by in Employee', 'Open Created by in Employee']), ARRIVES)

    await user.click(within(staff()).getByRole('button', { name: 'Open Approved by in Employee' }))
    await waitFor(() => expect(focusedName()).toBe('Employee k1:1'), ARRIVES)
    expect(trail()).toEqual(['Records', `Order line ${line}`, `Order ${order}`, `Employee ${approver}`])
    expect(window.location.hash).toBe(`#form=${engine.lines}&layout=drill&view=record&level=3`)

    await crumb(user, `Order ${order}`)
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    await user.click(within(staff()).getByRole('button', { name: 'Open Created by in Employee' }))
    await waitFor(() => expect(focusedName()).toBe('Employee k1:2'), ARRIVES)
    expect(trail()).toEqual(['Records', `Order line ${line}`, `Order ${order}`, `Employee ${creator}`])

    await crumb(user, `Order line ${line}`)
    await waitFor(() => expect(focusedName()).toBe(`Order line ${line}`), ARRIVES)
    expect(window.location.hash).toBe(`#form=${engine.lines}&layout=drill&view=record&level=1`)
  })
})
