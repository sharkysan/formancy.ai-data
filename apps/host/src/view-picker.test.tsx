import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { ListFilterTerm, ListSortTerm, ListView, PublishedForm, RecordExportQuery, RecordListQuery } from '@formancy/data-client'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { applied, applyCondition, listsApplied, listsSent } from './test-filter.js'
import { DELIVERY_VIEWS, ORDER_VIEWS, VIEWED } from './test-forms.js'
import { answeredOnce, chooseForm, exportButton, exportLine, gridSection, gridStatus, keeping, load, mount, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane, Sent } from './test-plane.js'

/*
 * A form's list views on the host page (0105), on both engines, against
 * the real server: the View picker above a grid, offering the views the
 * server offered this person and nothing when it offered none; the grid
 * opening on the default, or on every record when the default is not
 * offered; a choice in the select sending nothing until Show view; a view
 * shown asking for exactly one first page, carrying both its filter and
 * its sort, which the Filter panel lists and the headers show; the picker
 * saying "Your own filter and sort" for anything else and the view again
 * once the conditions are the view's; "All records" clearing both; a file
 * of the view's records; a child section's views of its own; and no view
 * in the address. Every state is held to axe at WCAG 2.2 AA and to a name
 * on every control.
 *
 * Found by role and accessible name (formancy.ai 0034): the picker is a
 * combobox named View, its choices options, the one it holds the selected
 * one, and Show view a button. A choice is made with user-event's
 * selectOptions, which fires the change a browser fires when an arrow steps
 * a closed select (Chromium on Windows and Linux, Firefox): jsdom's select
 * answers no arrow, so the keys themselves are not what is pressed.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, deliveries: true, views: true })
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
const [NEWEST, LARGE] = ORDER_VIEWS as [ListView, ListView]
const [SHIPPED, UNSHIPPED] = DELIVERY_VIEWS as [ListView, ListView]
const OWN = 'Your own filter and sort'

/** The state's name, and what axe and the name check found in it: both empty, or the state says which failed. */
async function floor(state: string): Promise<{ state: string; axe: string[]; unnamed: string[] }> {
  return { state, axe: await audit(), unnamed: unnamed() }
}
const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })

/** The View picker of the grid `heading` names, or null where it offers none. */
const picker = (heading: string): HTMLElement | null => within(gridSection(heading)).queryByRole('combobox', { name: 'View' })

/** The picker's choices, in order. */
function choices(heading: string): string[] {
  const view = picker(heading)
  if (view === null) throw new Error(`the ${heading} grid offers no View`)
  return within(view)
    .getAllByRole('option')
    .map((option) => option.textContent ?? '')
}

/** What the picker shows: its selected choice. */
function shown(heading: string): string {
  const view = picker(heading)
  if (view === null) throw new Error(`the ${heading} grid offers no View`)
  return within(view).getByRole('option', { selected: true }).textContent ?? ''
}

/** Show view in the grid `heading` names. */
const showButton = (heading: string): HTMLElement => within(gridSection(heading)).getByRole('button', { name: 'Show view' })

/** Choose `name` in the grid's picker and nothing more: the change a browser fires for a click on a choice or an arrow on a closed select. */
async function choose(user: User, heading: string, name: string): Promise<void> {
  const view = picker(heading)
  if (view === null) throw new Error(`the ${heading} grid offers no View`)
  await user.selectOptions(view, name)
}

/** Choose `name` in the grid's picker and press Show view. Nothing is waited for. */
async function pick(user: User, heading: string, name: string): Promise<void> {
  await choose(user, heading, name)
  await user.click(showButton(heading))
}

/** What a header of the grid `heading` names says of its sort: `aria-sort`, or null for a column that is not sorted. A sorted header's name holds its sort's number too, so it is found by how it starts. */
function sortOf(heading: string, label: string): string | null {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  const sort = within(grid)
    .getByRole('columnheader', { name: new RegExp(`^${label}`) })
    .getAttribute('aria-sort')
  return sort === 'none' ? null : sort
}

/** The first cell of every data row of the grid `heading` names: a record's key, as the grid shows it. */
function firstCells(heading: string): string[] {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  return within(grid)
    .getAllByRole('row')
    .flatMap((row) => within(row).queryAllByRole('gridcell').slice(0, 1))
    .map((cell) => cell.textContent ?? '')
}

/** What the server lists for `query`, asked by tenant 1's clerk beside the page: each record's key, as the grid's first cell shows it. */
async function serverLists(formId: string, query: Partial<RecordListQuery>): Promise<string[]> {
  const page = await plane.clerk.list(formId, query)
  if (!page.ok) throw new Error(`the server refused the list: ${page.message}`)
  return page.value.rows.map((row) => String(row.answers['id']))
}

/** The filter and sort of each list request in `sent` for `formId`, with the cursor it continues after and its parent: what a page was asked for with. */
const asked = (sent: readonly Sent[], formId: string): Array<Pick<RecordListQuery, 'filter' | 'sort' | 'after' | 'parent'>> =>
  listsSent(sent, formId).map(({ body }) => ({ filter: body.filter, sort: body.sort, after: body.after, parent: body.parent }))

/** A first page asked with `view`'s filter and sort, under `parent`. */
const firstPage = (view: { filter: ListFilterTerm[]; sort: ListSortTerm[] }, parent: RecordListQuery['parent'] = null) => ({
  filter: view.filter,
  sort: view.sort,
  after: null,
  parent,
})

async function definitionOf(formId: string): Promise<PublishedForm> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  return definition.value
}

/** Fresh orders of tenant 1's, one per amount, each noted `notes`, made beside the page: their ids, as the grid's first column shows them. */
async function freshOrders(engine: Engine, notes: string, amounts: readonly string[]): Promise<string[]> {
  const definition = await definitionOf(engine.formId)
  const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const ids: string[] = []
  for (const amount of amounts) {
    const created = await plane.clerk.create(engine.formId, {
      customer: found.value.rows[0].token,
      order_date: EDGES.orderDate,
      status: 'placed',
      amount,
      notes,
    })
    if (!created.ok || created.value.record === null) throw new Error('the order was not created')
    ids.push(created.value.record.slice('k1:'.length))
  }
  return ids
}

/** The page, signed in as tenant 1's clerk, with `formId` chosen and its grid answered. */
async function workspace(formId: string, save = keeping().save): Promise<User> {
  const user = mount(plane.fetch, { save })
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  return user
}

/** Wait until the grid `heading` names lists what the server lists for `query`, and says `line`. */
async function lists(heading: string, formId: string, query: Partial<RecordListQuery>, line: string): Promise<void> {
  const expected = await serverLists(formId, query)
  await waitFor(() => expect({ rows: firstCells(heading), line: gridStatus(heading)?.textContent }).toEqual({ rows: expected, line }), ARRIVES)
}

describe.each(ENGINES)("a form's list views on $engine", (engine) => {
  // The grid opens on the view the server offered as the default, with one
  // first page asked for in its filter and its sort -- never a page of
  // every record before it -- the picker naming it, the panel listing its
  // condition and the Id header sorted descending; and the picker and Show
  // view sit between Search and Filter in the keyboard's order, Columns
  // after them (0106) (watched failing with
  // the grid opening on nothing: every record listed, by key ascending; with
  // the datasource asking for whatever block AG Grid asks for: two first
  // pages, one asked before the headers showed the view's sort; and with
  // the picker after the Filter panel: Tab from Search reached Filter; and
  // with Columns after the Filter panel: Tab from Show view reached Filter).
  test('opens the grid on the default view, with one first page in its filter and its sort', async () => {
    await freshOrders(engine, `${VIEWED} ${stamp('opened')}`, ['5', '7'])
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    plane.sent.length = 0
    await chooseForm(user, engine.formId)
    await lists('Records', engine.formId, NEWEST, 'Rows 1–' + String((await serverLists(engine.formId, NEWEST)).length) + '. Filtered by Notes.')
    expect(asked(plane.sent, engine.formId)).toEqual([firstPage(NEWEST)])
    expect(choices('Records')).toEqual(['All records', NEWEST.name, LARGE.name])
    expect(shown('Records')).toBe(NEWEST.name)
    await listsApplied('Records', [`Notes contains “${VIEWED}”`])
    expect(sortOf('Records', 'Id')).toBe('descending')
    expect(await floor('the default view opened')).toEqual(CLEAN('the default view opened'))

    const records = gridSection('Records')
    within(records).getByRole('button', { name: 'Search' }).focus()
    await user.tab()
    expect(focusedName()).toBe('View')
    await user.tab()
    expect(focusedName()).toBe('Show view')
    await user.tab()
    expect(focusedName()).toBe('Columns')
    await user.tab()
    expect(focusedName()).toBe('Filter')
  })

  // A choice in the select is a draft: it sends nothing and changes neither
  // the filter nor the sort, however many a person steps through, until
  // Show view -- which then asks one first page, for the choice it shows --
  // and Show view on the choice the grid already lists sends nothing
  // (watched failing with the choice applied on its change, as the picker
  // first did: the filter emptied by a step onto "All records" before Show
  // view was pressed, its condition no longer listed; and with Show view
  // sending whatever the select holds: a second first page for the choice
  // the grid already listed).
  test('sends nothing for a choice until Show view, and nothing for the choice the grid lists', async () => {
    const user = await workspace(engine.formId)
    await lists('Records', engine.formId, NEWEST, `Rows 1–${String((await serverLists(engine.formId, NEWEST)).length)}. Filtered by Notes.`)
    plane.sent.length = 0

    await choose(user, 'Records', LARGE.name)
    await choose(user, 'Records', 'All records')
    expect(shown('Records')).toBe('All records')
    await listsApplied('Records', [`Notes contains “${VIEWED}”`])
    expect(sortOf('Records', 'Id')).toBe('descending')
    expect(asked(plane.sent, engine.formId)).toEqual([])
    expect(await floor('a choice not shown yet')).toEqual(CLEAN('a choice not shown yet'))

    await user.click(showButton('Records'))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toMatch(/^Rows 1–\d+(; more follow)?\.$/), ARRIVES)
    expect(applied('Records')).toEqual([])
    // Again, on the choice the grid now lists; then another, whose one page is the next request asked.
    await user.click(showButton('Records'))
    await pick(user, 'Records', NEWEST.name)
    await lists('Records', engine.formId, NEWEST, `Rows 1–${String((await serverLists(engine.formId, NEWEST)).length)}. Filtered by Notes.`)
    expect(asked(plane.sent, engine.formId)).toEqual([firstPage({ filter: [], sort: [] }), firstPage(NEWEST)])
  })

  // Showing a view asks for exactly one first page, carrying both its
  // filter and its sort -- not a page under the old sort and then another
  // -- lists what the server lists for it, says its conditions in the
  // panel and its order on the headers, keeps the keyboard on Show view,
  // and writes nothing of it into the address (0104's rule for a filter)
  // (watched failing with the datasource asking for whatever block AG Grid
  // asks for: two first pages for one pick, one asked before the headers
  // showed the view's sort -- whether it sent the view's sort or AG Grid's).
  test('picks a view: one first page with its filter and its sort, listed in the panel and shown on the headers', async () => {
    await freshOrders(engine, `${VIEWED} ${stamp('picked')}`, ['150', '20', '300'])
    const user = await workspace(engine.formId)
    await lists('Records', engine.formId, NEWEST, `Rows 1–${String((await serverLists(engine.formId, NEWEST)).length)}. Filtered by Notes.`)
    const before = window.location.href
    plane.sent.length = 0

    picker('Records')?.focus()
    await choose(user, 'Records', LARGE.name)
    await user.tab()
    expect(focusedName()).toBe('Show view')
    await user.keyboard('{Enter}')
    const large = await serverLists(engine.formId, LARGE)
    await lists('Records', engine.formId, LARGE, `Rows 1–${String(large.length)}. Filtered by Notes and Amount.`)
    expect(asked(plane.sent, engine.formId)).toEqual([firstPage(LARGE)])
    expect(shown('Records')).toBe(LARGE.name)
    await listsApplied('Records', [`Notes contains “${VIEWED}”`, 'Amount is at least 100'])
    expect([sortOf('Records', 'Amount'), sortOf('Records', 'Id')]).toEqual(['descending', 'ascending'])
    expect(focusedName()).toBe('Show view')
    expect(window.location.href).toBe(before)
    expect(await floor('a view picked')).toEqual(CLEAN('a view picked'))
  })

  // The picker's choice is derived from the filter and the sort, never
  // kept: a condition of the person's own is "Your own filter and sort",
  // offered only while it is so, and a step off it in the select and back
  // keeps the person's conditions; the view's own condition applied again
  // is the view again; and a header sorted by the person is their own too,
  // asked for once, and two quick presses on a header keep the second
  // (watched failing with the select's choice never following the section:
  // "Marked and large" shown over a filter on Amount between 1 and 50; with
  // the choice applied on its change: the step onto "Marked, newest first"
  // replaced the person's conditions, and no "Your own filter and sort" was
  // left to step back to; with the grid's header
  // sort never told to the section: the grid never asked for the page it
  // showed sorted, its cells left empty; and with every sort the section
  // holds put back on the headers, the one a press told it too: two quick
  // presses on Order date ended ascending).
  test('says "Your own filter and sort" for anything but a view, and the view again once it is one', async () => {
    await freshOrders(engine, `${VIEWED} ${stamp('own')}`, ['40', '400'])
    const user = await workspace(engine.formId)
    await pick(user, 'Records', LARGE.name)
    await waitFor(() => expect(shown('Records')).toBe(LARGE.name), ARRIVES)
    expect(choices('Records')).not.toContain(OWN)

    await applyCondition(user, 'Records', { field: 'Amount', condition: 'is between', from: '1', to: '50' })
    const narrowed: ListFilterTerm[] = [LARGE.filter[0] as ListFilterTerm, { field: 'amount', op: 'range', from: '1', to: '50' }]
    await lists(
      'Records',
      engine.formId,
      { filter: narrowed, sort: LARGE.sort },
      `Rows 1–${String((await serverLists(engine.formId, { filter: narrowed, sort: LARGE.sort })).length)}. Filtered by Notes and Amount.`,
    )
    expect(shown('Records')).toBe(OWN)
    expect(choices('Records')).toEqual(['All records', NEWEST.name, LARGE.name, OWN])
    expect(await floor('a filter of your own')).toEqual(CLEAN('a filter of your own'))

    // Off it and back, as arrows step a closed select, and Show view on it: the conditions stay, and nothing is asked.
    plane.sent.length = 0
    await choose(user, 'Records', NEWEST.name)
    await choose(user, 'Records', OWN)
    await user.click(showButton('Records'))
    await listsApplied('Records', [`Notes contains “${VIEWED}”`, 'Amount is between 1 and 50'])
    expect(shown('Records')).toBe(OWN)

    await applyCondition(user, 'Records', { field: 'Amount', condition: 'is between', from: '100', to: '' })
    await waitFor(() => expect(shown('Records')).toBe(LARGE.name), ARRIVES)
    expect(choices('Records')).not.toContain(OWN)
    await lists('Records', engine.formId, LARGE, `Rows 1–${String((await serverLists(engine.formId, LARGE)).length)}. Filtered by Notes and Amount.`)
    // One request since the steps: the condition's, for the view's list.
    expect(asked(plane.sent, engine.formId)).toEqual([firstPage(LARGE)])

    // The Id header, sorted by the keyboard: from the view's second order, ascending, to descending alone.
    plane.sent.length = 0
    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    within(grid).getByRole('columnheader', { name: /^Id/ }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(sortOf('Records', 'Id')).toBe('descending'), ARRIVES)
    const byId: ListSortTerm[] = [{ field: 'id', direction: 'desc' }]
    await lists(
      'Records',
      engine.formId,
      { filter: LARGE.filter, sort: byId },
      `Rows 1–${String((await serverLists(engine.formId, { filter: LARGE.filter, sort: byId })).length)}. Filtered by Notes and Amount.`,
    )
    expect(sortOf('Records', 'Amount')).toBeNull()
    expect(shown('Records')).toBe(OWN)
    expect(asked(plane.sent, engine.formId)).toEqual([firstPage({ filter: LARGE.filter, sort: byId })])
    expect(await floor('a sort of your own')).toEqual(CLEAN('a sort of your own'))

    // Two presses at once on another header, as a person who wants it
    // descending gives them: AG Grid tells the section of the first only
    // after the second is on the header, and the second is the one kept.
    within(grid)
      .getByRole('columnheader', { name: /^Order date/ })
      .focus()
    await user.keyboard('{Enter}{Enter}')
    const byDate: ListSortTerm[] = [{ field: 'order_date', direction: 'desc' }]
    await lists(
      'Records',
      engine.formId,
      { filter: LARGE.filter, sort: byDate },
      `Rows 1–${String((await serverLists(engine.formId, { filter: LARGE.filter, sort: byDate })).length)}. Filtered by Notes and Amount.`,
    )
    expect([sortOf('Records', 'Order date'), sortOf('Records', 'Id')]).toEqual(['descending', null])
    expect(asked(plane.sent, engine.formId).at(-1)).toEqual(firstPage({ filter: LARGE.filter, sort: byDate }))
  })

  // "All records" sets both the filter and the sort to nothing, in one
  // first page: no condition listed, no header sorted, the line no longer
  // filtered (watched failing with "All records" clearing the filter
  // alone: "sort": [{ "field": "id", "direction": "desc" }] in its request).
  test('"All records" clears both the filter and the sort', async () => {
    const user = await workspace(engine.formId)
    await waitFor(() => expect(shown('Records')).toBe(NEWEST.name), ARRIVES)
    plane.sent.length = 0
    await pick(user, 'Records', 'All records')
    await waitFor(() => expect(gridStatus('Records')?.textContent).toMatch(/^Rows 1–\d+(; more follow)?\.$/), ARRIVES)
    expect(asked(plane.sent, engine.formId)).toEqual([firstPage({ filter: [], sort: [] })])
    expect(applied('Records')).toEqual([])
    expect(sortOf('Records', 'Id')).toBeNull()
    expect(shown('Records')).toBe('All records')
    expect(choices('Records')).not.toContain(OWN)
    expect(await floor('all records')).toEqual(CLEAN('all records'))
  })

  // A default on a field this person may not read is not offered, nor is
  // its view: the grid opens on every record, asked for once with neither a
  // filter nor a sort, the picker on "All records" and offering the other
  // view alone -- never the default's view without its condition on
  // Amount, which would be every order under its name (watched failing with
  // the server offering every published view, its fit unasked: the grid
  // opened on the default, and the server refused its condition, "amount
  // is not a field you may filter …").
  test('opens on "All records" when the default names a field this person may not read', async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    plane.sent.length = 0
    await chooseForm(user, engine.withheld)
    await waitFor(() => expect(gridStatus('Records')?.textContent).toMatch(/^Rows 1–\d+(; more follow)?\.$/), ARRIVES)
    expect(asked(plane.sent, engine.withheld)).toEqual([firstPage({ filter: [], sort: [] })])
    expect(choices('Records')).toEqual(['All records', NEWEST.name])
    expect(shown('Records')).toBe('All records')
    expect(applied('Records')).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await floor('a default withheld')).toEqual(CLEAN('a default withheld'))
  })

  // Download CSV makes the file of the view the grid lists: the request
  // carries the view's filter and its sort, and the file is the server's
  // for them, byte for byte (watched failing with the file sorted as the
  // grid opened: "sort": [{ "field": "id", "direction": "desc" }]).
  test("makes a file of the view's records, in its sort", async () => {
    await freshOrders(engine, `${VIEWED} ${stamp('filed')}`, ['250', '120'])
    const kept = keeping()
    const user = await workspace(engine.formId, kept.save)
    await pick(user, 'Records', LARGE.name)
    await lists('Records', engine.formId, LARGE, `Rows 1–${String((await serverLists(engine.formId, LARGE)).length)}. Filtered by Notes and Amount.`)
    plane.sent.length = 0
    await user.click(exportButton('Records'))
    await waitFor(() => expect(exportLine('Records').textContent).toBe(`Made ${engine.formId}.csv; your browser saves it.`), ARRIVES)
    const query: RecordExportQuery = { search: '', sort: LARGE.sort, parent: null, filter: LARGE.filter }
    expect(
      plane.sent
        .filter((request) => request.path === `/v1/forms/${engine.formId}/records/export`)
        .map((request) => JSON.parse(request.body ?? '{}') as unknown),
    ).toEqual([query])
    const file = await plane.clerk.exportRecords(engine.formId, query)
    if (!file.ok) throw new Error(file.message)
    const [saved] = kept.saved
    if (saved === undefined) throw new Error('nothing was saved')
    expect(new Uint8Array(await saved.file.arrayBuffer())).toEqual(new Uint8Array(await file.value.file.arrayBuffer()))
  })

  // A child section offers its own form's views, as the server offers them
  // for it: it opens on its default under its parent, in one first page,
  // and a view picked there asks one first page under the same parent,
  // while the Records grid keeps its own view (watched failing with the
  // section's grid given no views: no combobox named View in the Delivery
  // section; and with the section opening on nothing: all four deliveries
  // listed).
  test("a child section offers its form's views, under its parent", async () => {
    const [order] = await freshOrders(engine, `${VIEWED} ${stamp('delivered')}`, ['1'])
    const record = `k1:${String(order)}`
    const words = stamp('carrier')
    for (const shipped of ['2026-10-07T08:00:00Z', null, '2026-10-09T08:00:00Z', null]) {
      const made = await plane.clerk.create(engine.deliveries, {
        order: record,
        carrier: `${words} ${String(shipped === null ? 'Rail' : 'Post')}`,
        ...(shipped === null ? {} : { shipped_at: shipped }),
      })
      if (!made.ok) throw new Error(`the delivery was not created: ${made.message}`)
    }
    const user = await workspace(engine.formId)
    plane.sent.length = 0
    await load(user, record)
    await waitFor(() => expect(within(gridSection('Delivery')).queryByRole('grid', { name: 'Delivery' })).not.toBeNull(), ARRIVES)
    await answeredOnce('Delivery')
    const parent = { field: 'order', record }
    await lists('Delivery', engine.deliveries, { ...SHIPPED, parent }, 'Delivery rows 1–2. Filtered by Shipped at.')
    expect(asked(plane.sent, engine.deliveries)).toEqual([firstPage(SHIPPED, parent)])
    expect(choices('Delivery')).toEqual(['All records', SHIPPED.name, UNSHIPPED.name])
    expect(shown('Delivery')).toBe(SHIPPED.name)
    expect(sortOf('Delivery', 'Shipped at')).toBe('descending')

    plane.sent.length = 0
    await pick(user, 'Delivery', UNSHIPPED.name)
    await lists('Delivery', engine.deliveries, { ...UNSHIPPED, parent }, 'Delivery rows 1–2. Filtered by Shipped at.')
    expect(asked(plane.sent, engine.deliveries)).toEqual([firstPage(UNSHIPPED, parent)])
    expect(asked(plane.sent, engine.formId)).toEqual([])
    expect(sortOf('Delivery', 'Carrier')).toBe('ascending')
    expect(shown('Records')).toBe(NEWEST.name)
    expect(await floor('a child section’s view picked')).toEqual(CLEAN('a child section’s view picked'))
  })
})

describe('a form whose list offers no views', () => {
  // No views offered, no picker: the order line form is published without
  // any, and its section shows Filter and no View (watched failing with the
  // picker drawn whatever the list offers: a View offering "All records"
  // alone).
  test('has no View picker', async () => {
    const [engine] = ENGINES
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    await chooseForm(user, engine.lines)
    expect((await definitionOf(engine.lines)).list?.views).toEqual([])
    expect(within(gridSection('Records')).getByRole('button', { name: 'Filter' })).toBeTruthy()
    expect(picker('Records')).toBeNull()
  })
})
