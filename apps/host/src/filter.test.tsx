import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { ListFilterTerm, PublishedForm, RecordExportQuery, RecordListQuery } from '@formancy/data-client'
import { REFUSED_FILTER_HELP } from './grid-datasource.js'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { applied, applyCondition, filterBox, listsApplied, listsSent, openFilter } from './test-filter.js'
import { answeredOnce, chooseForm, exportButton, exportLine, gridSection, gridStatus, keeping, load, mount, recordKeys, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane, Sent } from './test-plane.js'

/*
 * A grid's filter panel on the host page (0104), on both engines, against
 * the real server: that the grid lists exactly the records every condition
 * holds for, each block asked for with the filter in its body and in no
 * URL; that a file is of the filtered records; that a condition is removed
 * on its own and all are cleared; that the keyboard reaches and leaves
 * every control; that a refusal is said in the server's words and keeps
 * what was typed; and that a child section's panel is its own. Every state
 * is held to axe at WCAG 2.2 AA and to a name on every control.
 *
 * What a condition means in the database -- a range's whole days, a
 * contains in any case, NULL against text of no characters -- is the
 * adapters' and the server's to prove; here each expectation is the
 * records a test made for it, and what the server answers the same filter
 * with beside the page. Found by role and accessible name (formancy.ai
 * 0034).
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, deliveries: true })
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

/** The state's name, and what axe and the name check found in it: both empty, or the state says which failed. */
async function floor(state: string): Promise<{ state: string; axe: string[]; unnamed: string[] }> {
  return { state, axe: await audit(), unnamed: unnamed() }
}
const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })

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
    const created = await plane.clerk.create(engine.formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount, notes })
    if (!created.ok || created.value.record === null) throw new Error('the order was not created')
    ids.push(created.value.record.slice('k1:'.length))
  }
  return ids
}

/** The first cell of every data row of the grid `heading` names: a record's key, as the grid shows it. */
function firstCells(heading: string): string[] {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  return within(grid)
    .getAllByRole('row')
    .flatMap((row) => within(row).queryAllByRole('gridcell').slice(0, 1))
    .map((cell) => cell.textContent ?? '')
}

/** What the server lists for `query`, asked by tenant 1's clerk beside the page: the first cell the grid would show, each record's key. */
async function serverLists(formId: string, query: Partial<RecordListQuery>): Promise<string[]> {
  const page = await plane.clerk.list(formId, query)
  if (!page.ok) throw new Error(`the server refused the list: ${page.message}`)
  return page.value.rows.map((row) => String(row.answers['id']))
}

/** The page, signed in as tenant 1's clerk, with `formId` chosen and its grid answered. */
async function workspace(fetch: typeof globalThis.fetch, formId: string, save = keeping().save): Promise<User> {
  const user = mount(fetch, { save })
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  return user
}

/** Wait until the grid `heading` names says `text` on its line. */
async function says(heading: string, text: string): Promise<void> {
  await waitFor(() => expect(gridStatus(heading)?.textContent).toBe(text), ARRIVES)
}

/** A file's records after its header, one line each: the values these cases file hold no comma, quote or line break. */
const dataRows = (text: string): string[] => text.split('\r\n').slice(1).filter((row) => row !== '')

/** The filter each list request in `sent` for `formId` carried, in order. */
const filtersSent = (sent: readonly Sent[], formId: string): ListFilterTerm[][] => listsSent(sent, formId).map(({ body }) => body.filter)

describe.each(ENGINES)("a grid's filter on $engine", (engine) => {
  // Each condition applied narrows the grid to the records every condition
  // holds for, from its first page, and says so on its line; each block is
  // asked for with the whole filter in its body -- contains as typed, in
  // another case -- and its values in no URL (watched failing with the
  // datasource sending none: the grid listed every order, "filter": []).
  test('lists only the records every condition holds for, with the filter in every body and no URL', async () => {
    const notes = stamp('filter')
    const orders = await freshOrders(engine, notes, ['1', '2', '3', '4'])
    const user = await workspace(plane.fetch, engine.formId)
    plane.sent.length = 0

    await applyCondition(user, 'Records', { field: 'Notes', condition: 'contains', value: notes.toUpperCase() })
    await waitFor(() => expect(recordKeys()).toEqual(orders), ARRIVES)
    await says('Records', 'Rows 1–4. Filtered by Notes.')
    await applyCondition(user, 'Records', { field: 'Amount', condition: 'is between', from: '2', to: '3' })
    const filter: ListFilterTerm[] = [
      { field: 'notes', op: 'contains', text: notes.toUpperCase() },
      { field: 'amount', op: 'range', from: '2', to: '3' },
    ]
    expect(await serverLists(engine.formId, { filter })).toEqual(orders.slice(1, 3))
    await waitFor(() => expect(recordKeys()).toEqual(orders.slice(1, 3)), ARRIVES)
    await says('Records', 'Rows 1–2. Filtered by Notes and Amount.')
    await listsApplied('Records', [`Notes contains “${notes.toUpperCase()}”`, 'Amount is between 2 and 3'])

    const sent = listsSent(plane.sent, engine.formId)
    expect(sent.map(({ body }) => body.filter)).toEqual([filter.slice(0, 1), filter])
    expect(sent.map(({ body }) => Object.keys(body).sort())).toEqual(sent.map(() => ['after', 'filter', 'limit', 'parent', 'search', 'sort']))
    // Each a new list, from its first row.
    expect(sent.map(({ body }) => body.after)).toEqual([null, null])
    for (const { url } of sent) expect(url.toLowerCase()).not.toContain(notes)
  })

  // A filtered list of more than a page pages under the same filter: the
  // second page is asked for with it too, and lists what the server's
  // second page holds (watched failing with only the first block asked for
  // under the filter: the second page was the unfiltered list's, "Rows
  // 51–60").
  test('asks for every page with the same filter', async () => {
    const notes = stamp('pages')
    await plane.db.insertOrders(engine.connection, 55, notes)
    const user = await workspace(plane.fetch, engine.formId)
    await applyCondition(user, 'Records', { field: 'Notes', condition: 'contains', value: notes })
    await says('Records', 'Rows 1–50; more follow. Filtered by Notes.')
    plane.sent.length = 0
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Next rows' }))
    await says('Records', 'Rows 51–55. Filtered by Notes.')
    const first = await plane.clerk.list(engine.formId, { filter: [{ field: 'notes', op: 'contains', text: notes }] })
    if (!first.ok) throw new Error(first.message)
    const second = await plane.clerk.list(engine.formId, { filter: [{ field: 'notes', op: 'contains', text: notes }], after: first.value.next })
    if (!second.ok) throw new Error(second.message)
    expect(recordKeys()).toEqual(second.value.rows.map((row) => String(row.answers['id'])))
    expect(filtersSent(plane.sent, engine.formId)).toEqual([[{ field: 'notes', op: 'contains', text: notes }]])
  })

  // Download CSV sends the filter the grid lists by, and the file is the
  // server's for it, byte for byte, holding exactly the filtered records
  // (watched failing with the export's filter left as []: "filter": [] in
  // its body).
  test('makes a file of exactly the records the filtered grid lists', async () => {
    const notes = stamp('filed')
    const orders = await freshOrders(engine, notes, ['1', '2', '3'])
    const kept = keeping()
    const user = await workspace(plane.fetch, engine.formId, kept.save)
    await applyCondition(user, 'Records', { field: 'Notes', condition: 'contains', value: notes })
    await applyCondition(user, 'Records', { field: 'Amount', condition: 'is between', from: '2' })
    await waitFor(() => expect(recordKeys()).toEqual(orders.slice(1)), ARRIVES)
    plane.sent.length = 0

    await user.click(exportButton('Records'))
    await waitFor(() => expect(exportLine('Records').textContent).toBe(`Made ${engine.formId}.csv; your browser saves it.`), ARRIVES)
    const filter: ListFilterTerm[] = [
      { field: 'notes', op: 'contains', text: notes },
      { field: 'amount', op: 'range', from: '2', to: null },
    ]
    const query: RecordExportQuery = { search: '', sort: [], parent: null, filter }
    const bodies = plane.sent.filter((request) => request.path === `/v1/forms/${engine.formId}/records/export`).map((request) => JSON.parse(request.body ?? '{}') as unknown)
    expect(bodies).toEqual([query])
    const server = await plane.clerk.exportRecords(engine.formId, query)
    if (!server.ok) throw new Error(server.message)
    const [saved] = kept.saved
    if (saved === undefined) throw new Error('nothing was saved')
    expect(new Uint8Array(await saved.file.arrayBuffer())).toEqual(new Uint8Array(await server.value.file.arrayBuffer()))
    expect(dataRows(await saved.file.text()).map((row) => row.split(',')[0])).toEqual(orders.slice(1))
  })

  // Each condition is removed on its own, the grid listing what the rest
  // hold for, and Clear filter removes them all; the keyboard goes to the
  // next condition's Remove, the one before, or Filter once none is left,
  // and the line no longer says the list is filtered (watched failing with
  // the keyboard left on a Remove no longer there: the page itself focused;
  // and, before the Remove buttons were named for their fields, with no
  // button "Remove the condition on Amount" to press).
  test('removes each condition on its own, clears them all, and keeps the keyboard', async () => {
    const notes = stamp('removed')
    const orders = await freshOrders(engine, notes, ['1', '2', '3'])
    const user = await workspace(plane.fetch, engine.formId)
    await applyCondition(user, 'Records', { field: 'Amount', condition: 'is between', from: '2', to: '3' })
    await applyCondition(user, 'Records', { field: 'Notes', condition: 'contains', value: notes })
    await waitFor(() => expect(recordKeys()).toEqual(orders.slice(1)), ARRIVES)

    const records = gridSection('Records')
    within(records).getByRole('button', { name: 'Remove the condition on Amount' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(recordKeys()).toEqual(orders), ARRIVES)
    await says('Records', 'Rows 1–3. Filtered by Notes.')
    await listsApplied('Records', [`Notes contains “${notes}”`])
    expect(focusedName()).toBe('Remove the condition on Notes')

    await user.keyboard(' ')
    await waitFor(() => expect(applied('Records')).toEqual([]), ARRIVES)
    expect(focusedName()).toBe('Filter')
    await waitFor(() => expect(gridStatus('Records')?.textContent).toMatch(/^Rows 1–\d+(; more follow)?\.$/), ARRIVES)

    await applyCondition(user, 'Records', { field: 'Notes', condition: 'contains', value: notes })
    await applyCondition(user, 'Records', { field: 'Amount', condition: 'is', value: '3' })
    await waitFor(() => expect(recordKeys()).toEqual(orders.slice(2)), ARRIVES)
    plane.sent.length = 0
    await user.click(within(records).getByRole('button', { name: 'Clear filter' }))
    await waitFor(() => expect(applied('Records')).toEqual([]), ARRIVES)
    expect(focusedName()).toBe('Filter')
    await waitFor(() => expect(gridStatus('Records')?.textContent).toMatch(/^Rows 1–\d+(; more follow)?\.$/), ARRIVES)
    expect(filtersSent(plane.sent, engine.formId)).toEqual([[]])
  })

  // From the keyboard alone: Enter on Filter opens the panel and leaves the
  // keyboard on it, Tab goes Field, Condition, the value, Apply, and Enter
  // in the value applies the condition, the keyboard staying in the box
  // (watched failing with Filter opened by a pointer's press alone: Enter
  // left it collapsed, aria-expanded "false").
  test('is reached, filled and applied from the keyboard', async () => {
    const notes = stamp('keys')
    const orders = await freshOrders(engine, notes, ['5'])
    const user = await workspace(plane.fetch, engine.formId)
    const records = gridSection('Records')
    const filter = within(records).getByRole('button', { name: 'Filter' })
    filter.focus()
    await user.keyboard('{Enter}')
    expect(filter.getAttribute('aria-expanded')).toBe('true')
    expect(focusedName()).toBe('Filter')
    await user.tab()
    expect(focusedName()).toBe('Field')
    await user.selectOptions(within(records).getByRole('combobox', { name: 'Field' }), 'Notes')
    await user.tab()
    expect(focusedName()).toBe('Condition')
    await user.selectOptions(within(records).getByRole('combobox', { name: 'Condition' }), 'contains')
    await user.tab()
    expect(focusedName()).toBe('Text')
    await user.keyboard(notes)
    await user.tab()
    expect(focusedName()).toBe('Apply')
    await user.tab({ shift: true })
    await user.keyboard('{Enter}')
    await waitFor(() => expect(recordKeys()).toEqual(orders), ARRIVES)
    expect(focusedName()).toBe('Text')
    // Enter on Filter again closes it; what was applied is still listed, and still the grid's.
    filter.focus()
    await user.keyboard('{Enter}')
    expect(filter.getAttribute('aria-expanded')).toBe('false')
    await listsApplied('Records', [`Notes contains “${notes}”`])
    expect(recordKeys()).toEqual(orders)
  })

  // A value the column cannot hold is the server's to refuse: its
  // sentence on the grid's line, with what to do instead of Ask again --
  // which would be refused the same -- and the value still in its box to
  // correct; applying the corrected value takes the refused one's place.
  // A draft that is no condition at all is said in the panel and sends
  // nothing (watched failing with Ask again offered: a button that asked
  // again for the same refusal; and with the box emptied by Apply: "" for
  // "12x").
  test('says a refusal in the server’s words and keeps what was typed', async () => {
    const [order] = await freshOrders(engine, stamp('refused'), ['1'])
    const user = await workspace(plane.fetch, engine.formId)
    const refused = await plane.clerk.list(engine.formId, { filter: [{ field: 'id', op: 'equals', value: '12x' }] })
    if (refused.ok) throw new Error('the server took 12x for an id')
    expect(refused.code).toBe('not-filterable')
    plane.sent.length = 0

    await applyCondition(user, 'Records', { field: 'Id', condition: 'is', value: '12x' })
    await says('Records', refused.message)
    const records = gridSection('Records')
    expect(within(records).getByText(REFUSED_FILTER_HELP)).toBeTruthy()
    expect(within(records).queryByRole('button', { name: 'Ask again' })).toBeNull()
    expect(filterBox('Records', 'Value').value).toBe('12x')
    await listsApplied('Records', ['Id is 12x'])
    expect(await floor('a filter refused')).toEqual(CLEAN('a filter refused'))

    await applyCondition(user, 'Records', { field: 'Id', condition: 'is', value: String(order) })
    await waitFor(() => expect(recordKeys()).toEqual([order]), ARRIVES)
    await listsApplied('Records', [`Id is ${String(order)}`])
    expect(filtersSent(plane.sent, engine.formId)).toEqual([[{ field: 'id', op: 'equals', value: '12x' }], [{ field: 'id', op: 'equals', value: String(order) }]])

    plane.sent.length = 0
    await applyCondition(user, 'Records', { field: 'Amount', condition: 'is between' })
    const problem = within(records).getByRole('status', { name: 'Apply' })
    expect(problem.textContent).toBe('A range needs a From, a To or both.')
    expect(listsSent(plane.sent, engine.formId)).toEqual([])
    await listsApplied('Records', [`Id is ${String(order)}`])
  })

  // The panel's states, each held to the floor: open on a range, whose
  // hint and the condition it replaces describe it, and a filter applied,
  // listed with its Remove buttons and Clear filter (watched failing with
  // the Remove buttons named only "Remove": the name check passed, and axe
  // did not object to two buttons of one name, which is why the case
  // also asks for each by its own).
  test('passes the floor open, filtered and replacing a condition', async () => {
    const notes = stamp('floor')
    await freshOrders(engine, notes, ['2'])
    const user = await workspace(plane.fetch, engine.formId)
    await openFilter(user, 'Records')
    expect(await floor('the panel open')).toEqual(CLEAN('the panel open'))
    await applyCondition(user, 'Records', { field: 'Notes', condition: 'contains', value: notes })
    await applyCondition(user, 'Records', { field: 'Amount', condition: 'is between', from: '1', to: '2' })
    await says('Records', 'Rows 1–1. Filtered by Notes and Amount.')
    expect(await floor('a filter applied')).toEqual(CLEAN('a filter applied'))
    const records = gridSection('Records')
    expect(within(records).getByRole('button', { name: 'Remove the condition on Notes' })).toBeTruthy()
    expect(within(records).getByRole('button', { name: 'Remove the condition on Amount' })).toBeTruthy()
    expect(within(records).getByText('Apply replaces the condition Amount has.')).toBeTruthy()
    expect(within(records).getByText('From and To are included. Either may be left empty.')).toBeTruthy()
  })

  // A child section has a panel of its own over the child form's fields: a
  // timestamp's range is whole days in UTC, and says so; its conditions
  // narrow its rows alone, under its parent, while the Records grid keeps
  // none; nothing matching is said with what narrowed it; and its file is
  // that parent's filtered rows (watched failing with the section's file
  // asked for without its filter: "filter": [] in its body; and with the
  // keyboard left nowhere once a condition was removed).
  test("a child section's panel filters its rows alone, and its file", async () => {
    const words = stamp('shipped')
    const [order] = await freshOrders(engine, words, ['1'])
    const record = `k1:${String(order)}`
    const shipped = ['2026-10-07T23:59:59Z', '2026-10-08T00:00:00Z', '2026-10-09T23:59:59Z', '2026-10-10T00:00:00Z', null]
    const deliveries: string[] = []
    for (const at of shipped) {
      const made = await plane.clerk.create(engine.deliveries, { order: record, carrier: `${words} Post`, ...(at === null ? {} : { shipped_at: at }) })
      if (!made.ok) throw new Error(`the delivery was not created: ${made.message}`)
      deliveries.push(String(made.value.answers['id']))
    }
    const kept = keeping()
    const user = await workspace(plane.fetch, engine.formId, kept.save)
    await load(user, record)
    await waitFor(() => expect(within(gridSection('Delivery')).queryByRole('grid', { name: 'Delivery' })).not.toBeNull(), ARRIVES)
    await answeredOnce('Delivery')
    plane.sent.length = 0

    await applyCondition(user, 'Delivery', { field: 'Shipped at', condition: 'is between', from: '2026-10-08', to: '2026-10-09' })
    expect(within(gridSection('Delivery')).getByText('Whole days in UTC, as the grid shows times: from the start of From to the end of To. Either may be left empty.')).toBeTruthy()
    const parent = { field: 'order', record }
    const between: ListFilterTerm = { field: 'shipped_at', op: 'range', from: '2026-10-08', to: '2026-10-09' }
    const server = await plane.clerk.list(engine.deliveries, { parent, filter: [between] })
    if (!server.ok) throw new Error(server.message)
    expect(server.value.rows.map((row) => String(row.answers['id'])).sort()).toEqual(deliveries.slice(1, 3).sort())
    await waitFor(() => expect(firstCells('Delivery')).toEqual(server.value.rows.map((row) => String(row.answers['id']))), ARRIVES)
    await says('Delivery', 'Delivery rows 1–2. Filtered by Shipped at.')
    expect(applied('Records')).toEqual([])
    expect(filtersSent(plane.sent, engine.formId)).toEqual([])
    expect(listsSent(plane.sent, engine.deliveries).map(({ body }) => ({ parent: body.parent, filter: body.filter }))).toEqual([{ parent, filter: [between] }])

    await applyCondition(user, 'Delivery', { field: 'Shipped at', condition: 'has no value' })
    await waitFor(() => expect(firstCells('Delivery')).toEqual([deliveries[4]]), ARRIVES)
    await applyCondition(user, 'Delivery', { field: 'Id', condition: 'is', value: String(deliveries[1]).toUpperCase() })
    await says('Delivery', 'No Delivery rows match the filter on Shipped at and Id.')
    within(gridSection('Delivery')).getByRole('button', { name: 'Remove the condition on Shipped at' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(firstCells('Delivery')).toEqual([deliveries[1]]), ARRIVES)
    expect(focusedName()).toBe('Remove the condition on Id')

    plane.sent.length = 0
    await user.click(exportButton('Delivery'))
    await waitFor(() => expect(exportLine('Delivery').textContent).toBe(`Made ${engine.deliveries}.csv; your browser saves it.`), ARRIVES)
    const query: RecordExportQuery = { search: '', sort: [], parent, filter: [{ field: 'id', op: 'equals', value: String(deliveries[1]).toUpperCase() }] }
    expect(plane.sent.filter((request) => request.path === `/v1/forms/${engine.deliveries}/records/export`).map((request) => JSON.parse(request.body ?? '{}') as unknown)).toEqual([query])
    const file = await plane.clerk.exportRecords(engine.deliveries, query)
    if (!file.ok) throw new Error(file.message)
    const [saved] = kept.saved
    if (saved === undefined) throw new Error('nothing was saved')
    expect(new Uint8Array(await saved.file.arrayBuffer())).toEqual(new Uint8Array(await file.value.file.arrayBuffer()))
    expect(dataRows(await saved.file.text()).map((row) => row.split(',')[0])).toEqual([deliveries[1]])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await floor('a child section filtered')).toEqual(CLEAN('a child section filtered'))
  })
})
