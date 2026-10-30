import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import type { ListView, PublishedForm, RecordListQuery } from '@formancy/data-client'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { listsSent } from './test-filter.js'
import { ORDER_VIEWS, VIEWED } from './test-forms.js'
import { answeredOnce, chooseForm, gridSection, gridStatus, load, mount, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { childGrid, columnsButton, headed, headers, keptFor, listed, moveButton, openColumns, RECORDS_GRID, showBox } from './test-columns.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'
import { fieldHeading } from './field-heading.js'

/*
 * A grid's Columns on the host page (0106), on both engines, against the
 * real server: the panel behind its disclosure listing the grid's columns
 * and never a row's Delete, which stays last; a column hidden, shown and
 * moved from the keyboard, the grid's headers following and nothing asked
 * of the server; the last column shown kept, and saying why; Reset columns
 * putting the form's order back and forgetting the person's; a view on a
 * hidden column listing in one request; and a child section's Columns its
 * own, without its parent's field. Every state is held to axe at WCAG 2.2
 * AA and to a name on every control. What a reload brings back is
 * remembered.test.tsx's.
 *
 * Found by role and accessible name (formancy.ai 0034): Columns a button,
 * the panel's list named by it, each column's Show a checkbox and its moves
 * buttons, and the grid's headers columnheaders. A hidden column draws no
 * header.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, deliveries: true, views: true, deletes: true })
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
const LARGE = ORDER_VIEWS[1] as ListView

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

/** The labels of a form's readable fields, in the form's order, but `parent`'s: the columns its grid is given. */
async function labelsOf(formId: string, parent: string | null = null): Promise<string[]> {
  const definition = await definitionOf(formId)
  const readable = new Set(definition.readable)
  return definition.form.model.fields.filter((field) => readable.has(field.key) && field.key !== parent).map(fieldHeading)
}

/** `labels` with one moved to `at`. */
const placed = (labels: readonly string[], label: string, at: number): string[] => {
  const rest = labels.filter((each) => each !== label)
  return [...rest.slice(0, at), label, ...rest.slice(at)]
}

/** The page, signed in as tenant 1's clerk, with `formId` chosen and its grid answered. */
async function workspace(formId: string): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  return user
}

/** Press a control from the keyboard: focused, then `key`. */
async function press(user: User, control: HTMLElement, key = '{Enter}'): Promise<void> {
  control.focus()
  await user.keyboard(key)
}

/** The filter and sort of each list request sent for `formId`, with its offset. */
const asked = (formId: string): Array<Pick<RecordListQuery, 'filter' | 'sort' | 'offset'>> =>
  listsSent(plane.sent, formId).map(({ body }) => ({ filter: body.filter, sort: body.sort, offset: body.offset }))

/** Fresh orders of tenant 1's, noted `notes`, one per amount, made beside the page. */
async function freshOrders(engine: Engine, notes: string, amounts: readonly string[]): Promise<string[]> {
  const definition = await definitionOf(engine.formId)
  const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const records: string[] = []
  for (const amount of amounts) {
    const created = await plane.clerk.create(engine.formId, {
      customer: found.value.rows[0].token,
      order_date: EDGES.orderDate,
      status: 'placed',
      amount,
      notes,
    })
    if (!created.ok || created.value.record === null) throw new Error('the order was not created')
    records.push(created.value.record)
  }
  return records
}

describe.each(ENGINES)("a grid's Columns on $engine", (engine) => {
  // Columns sits between View and Filter, closed, and Enter opens it with
  // the keyboard kept on it; its panel lists every column the grid draws,
  // in the grid's order, each shown, and never the row's Delete, which is
  // no field's and is the grid's last header (watched failing with a row's
  // Delete among the panel's columns: a tenth line, "Show Delete").
  test('lists the grid’s columns in its order, and never a row’s Delete', async () => {
    const user = await workspace(engine.formId)
    const labels = await labelsOf(engine.formId)
    await headed('Records', [...labels, 'Delete'])
    const button = columnsButton('Records')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await press(user, button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(focusedName()).toBe('Columns')
    expect(listed('Records')).toEqual(labels.map((label) => ({ label, shown: true })))
    await user.tab()
    expect(focusedName()).toBe(`Show ${String(labels[0])}`)
    expect(await floor('the columns listed')).toEqual(CLEAN('the columns listed'))
  })

  // Space on a Show hides its column and shows it again, Enter on a move
  // moves it one place, and the grid's headers follow each, the row's
  // Delete staying last; the keyboard stays on the control pressed, a move
  // at an end does nothing, and none of it asks the server anything or
  // writes anything into the address (watched failing with the grid's
  // datasource made again for each change of its columns: ten list
  // requests sent; and with the move buttons drawn only where they move:
  // the keyboard left on the page once "Move Amount up" reached the top).
  test('hides, shows and moves a column from the keyboard, the headers following', async () => {
    const user = await workspace(engine.formId)
    const labels = await labelsOf(engine.formId)
    await headed('Records', [...labels, 'Delete'])
    await openColumns(user, 'Records')
    const before = window.location.href
    plane.sent.length = 0

    await press(user, showBox('Records', 'Notes'), ' ')
    const hidden = labels.filter((label) => label !== 'Notes')
    await headed('Records', [...hidden, 'Delete'])
    expect(showBox('Records', 'Notes').checked).toBe(false)
    expect(focusedName()).toBe('Show Notes')
    expect(await floor('a column hidden')).toEqual(CLEAN('a column hidden'))

    const from = hidden.indexOf('Amount')
    await press(user, moveButton('Records', 'Amount', 'up'))
    await headed('Records', [...placed(hidden, 'Amount', from - 1), 'Delete'])
    expect(focusedName()).toBe('Move Amount up')
    for (let step = 1; step < from; step += 1) await user.keyboard('{Enter}')
    await headed('Records', [...placed(hidden, 'Amount', 0), 'Delete'])
    expect(focusedName()).toBe('Move Amount up')
    expect(moveButton('Records', 'Amount', 'up').getAttribute('aria-disabled')).toBe('true')
    await user.keyboard('{Enter}')
    expect(focusedName()).toBe('Move Amount up')
    expect(headers('Records')).toEqual([...placed(hidden, 'Amount', 0), 'Delete'])
    expect(await floor('a column moved to the top')).toEqual(CLEAN('a column moved to the top'))

    // To the bottom of the list, past the hidden Notes, which keeps its place in it: the Delete column stays after it.
    await press(user, moveButton('Records', 'Amount', 'down'))
    for (let step = 0; step < labels.length; step += 1) await user.keyboard('{Enter}')
    expect(focusedName()).toBe('Move Amount down')
    expect(moveButton('Records', 'Amount', 'down').getAttribute('aria-disabled')).toBe('true')
    const last = [...labels.filter((label) => label !== 'Amount'), 'Amount']
    expect(listed('Records')).toEqual(last.map((label) => ({ label, shown: label !== 'Notes' })))
    await headed('Records', [...last.filter((label) => label !== 'Notes'), 'Delete'])

    await press(user, showBox('Records', 'Notes'), ' ')
    await headed('Records', [...last, 'Delete'])
    expect(focusedName()).toBe('Show Notes')
    expect(asked(engine.formId)).toEqual([])
    expect(window.location.href).toBe(before)
  })

  // A row is opened through its cells, so the last column shown stays: its
  // Show is aria-disabled and described by the sentence that says so, and
  // Space on it changes nothing, the keyboard kept on it -- and a row is
  // opened through that column, which carries the open row's bar, the
  // first column being hidden. The bar is an SVG with no role, read from
  // the DOM (watched failing with every hide applied: the last one hidden
  // too, and the grid back on every column, as an arrangement with none
  // shown is; with its Show not aria-disabled; and with the bar left on the
  // form's first column, hidden: no bar in the open row).
  test('keeps the last column shown, and says why', async () => {
    await freshOrders(engine, `${VIEWED} ${stamp('last')}`, ['5'])
    const user = await workspace(engine.formId)
    const labels = await labelsOf(engine.formId)
    await headed('Records', [...labels, 'Delete'])
    await openColumns(user, 'Records')
    const [last, ...others] = [labels.at(-1) ?? '', ...labels.slice(0, -1)]
    for (const label of others) await user.click(showBox('Records', label))
    await headed('Records', [last, 'Delete'])
    const box = showBox('Records', last)
    expect(box.getAttribute('aria-disabled')).toBe('true')
    expect(
      within(gridSection('Records')).getByRole('checkbox', { name: `Show ${last}`, description: 'One column stays shown: a row is opened through its cells.' }),
    ).toBe(box)
    await press(user, box, ' ')
    expect(box.checked).toBe(true)
    expect(focusedName()).toBe(`Show ${last}`)
    expect(headers('Records')).toEqual([last, 'Delete'])
    expect(await floor('the last column shown')).toEqual(CLEAN('the last column shown'))

    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    await user.click(within(grid).getAllByRole('gridcell')[0] as HTMLElement)
    await waitFor(() => expect(within(grid).getByRole('row', { selected: true })).toBeTruthy(), ARRIVES)
    const open = within(grid).getByRole('row', { selected: true })
    await waitFor(() => expect(within(open).getAllByRole('gridcell')[0]?.querySelector('svg rect')).not.toBeNull(), ARRIVES)

    // Shown again, another column: the sentence goes, and the Show it described can hide its column.
    await user.click(showBox('Records', 'Id'))
    await waitFor(() => expect(box.getAttribute('aria-disabled')).toBeNull(), ARRIVES)
    expect(within(gridSection('Records')).queryByText('One column stays shown: a row is opened through its cells.')).toBeNull()
  })

  // Reset columns puts back the form's order with every column shown, and
  // forgets the person's columns while the list they chose stays kept
  // (watched failing with Reset columns removing the whole value: the
  // picked view no longer kept).
  test('puts the form’s columns back with Reset columns, keeping the list', async () => {
    await freshOrders(engine, `${VIEWED} ${stamp('reset')}`, ['300'])
    const user = await workspace(engine.formId)
    const labels = await labelsOf(engine.formId)
    await headed('Records', [...labels, 'Delete'])
    const view = within(gridSection('Records')).getByRole('combobox', { name: 'View' })
    await user.selectOptions(view, LARGE.name)
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Show view' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toMatch(/Filtered by Notes and Amount\.$/), ARRIVES)
    await openColumns(user, 'Records')
    await user.click(showBox('Records', 'Id'))
    await user.click(moveButton('Records', 'Notes', 'up'))
    expect(keptFor(RECORDS_GRID, engine.formId)).toEqual({ version: 1, columns: expect.any(Array), view: LARGE.name })
    expect(await floor('columns of your own')).toEqual(CLEAN('columns of your own'))

    const reset = within(gridSection('Records')).getByRole('button', { name: 'Reset columns' })
    await press(user, reset)
    await headed('Records', [...labels, 'Delete'])
    expect(listed('Records')).toEqual(labels.map((label) => ({ label, shown: true })))
    expect(focusedName()).toBe('Reset columns')
    expect(keptFor(RECORDS_GRID, engine.formId)).toEqual({ version: 1, view: LARGE.name })
  })

  // A view sorting by a column nobody sees still lists: the hidden column
  // keeps the view's sort in the grid's headers, so the datasource asks for
  // the view's first page, once (watched failing with a hidden column
  // dropped from the grid's definitions: the view's page never asked for,
  // the grid left on the default view's).
  test('lists a view sorted by a hidden column in one request', async () => {
    await freshOrders(engine, `${VIEWED} ${stamp('hidden')}`, ['250', '120'])
    const user = await workspace(engine.formId)
    await openColumns(user, 'Records')
    await user.click(showBox('Records', 'Amount'))
    await user.click(showBox('Records', 'Id'))
    await waitFor(() => expect(headers('Records')).not.toContain('Amount'), ARRIVES)
    plane.sent.length = 0
    const view = within(gridSection('Records')).getByRole('combobox', { name: 'View' })
    await user.selectOptions(view, LARGE.name)
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Show view' }))
    const expected = await plane.clerk.list(engine.formId, { filter: LARGE.filter, sort: LARGE.sort })
    if (!expected.ok) throw new Error(expected.message)
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`Rows 1–${String(expected.value.rows.length)}. Filtered by Notes and Amount.`), ARRIVES)
    expect(asked(engine.formId)).toEqual([{ filter: LARGE.filter, sort: LARGE.sort, offset: 0 }])
    expect(headers('Records')).not.toContain('Amount')
    expect(await floor('a view on a hidden column')).toEqual(CLEAN('a view on a hidden column'))
  })

  // A child section's Columns is its own: its columns without the parent's
  // field, which its grid leaves out; a column hidden there is hidden in
  // that grid alone and kept for the child form as a child section's, and
  // the Records grid and what is kept for it are untouched -- the order
  // form's, and the delivery form's own when it is chosen under Forms
  // (watched failing with the section given the form's columns: "Show
  // Order" listed in the Delivery section; with the section's kept as a
  // Records panel's: nothing kept as a child section's; and with it kept
  // by the child form rather than the field its rows are narrowed by:
  // nothing kept under that field's key).
  test('a child section has Columns of its own, without its parent’s field', async () => {
    const [record] = await freshOrders(engine, stamp('columns'), ['1'])
    const made = await plane.clerk.create(engine.deliveries, { order: record, carrier: stamp('carrier'), shipped_at: '2026-10-07T08:00:00Z' })
    if (!made.ok) throw new Error(made.message)
    const user = await workspace(engine.formId)
    await load(user, String(record))
    await waitFor(() => expect(within(gridSection('Delivery')).queryByRole('grid', { name: 'Delivery' })).not.toBeNull(), ARRIVES)
    await answeredOnce('Delivery')
    const labels = await labelsOf(engine.deliveries, 'order')
    expect(labels).not.toContain('Order')
    await headed('Delivery', labels)
    await openColumns(user, 'Delivery')
    expect(listed('Delivery')).toEqual(labels.map((label) => ({ label, shown: true })))
    await press(user, showBox('Delivery', 'Carrier'), ' ')
    await headed(
      'Delivery',
      labels.filter((label) => label !== 'Carrier'),
    )
    expect(keptFor(childGrid('order'), engine.deliveries)?.columns?.find((column) => column.field === 'carrier')).toEqual({ field: 'carrier', shown: false })
    expect(keptFor(RECORDS_GRID, engine.formId)).toBeNull()
    expect(headers('Records')).toContain('Notes')
    expect(await floor('a child section’s columns')).toEqual(CLEAN('a child section’s columns'))

    await chooseForm(user, engine.deliveries)
    await headed('Records', await labelsOf(engine.deliveries))
    expect(keptFor(RECORDS_GRID, engine.deliveries)).toBeNull()
  })
})

describe('a form whose list offers no views', () => {
  // Columns does not need views: the order line form has none, and its
  // Records panel offers Columns before Filter (watched failing with
  // Columns drawn by the View picker: no Columns on a form without views).
  test('still offers Columns', async () => {
    const [engine] = ENGINES
    await workspace(engine.lines)
    expect(within(gridSection('Records')).queryByRole('combobox', { name: 'View' })).toBeNull()
    expect(columnsButton('Records')).toBeTruthy()
  })
})
