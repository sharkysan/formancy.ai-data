import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import type { ListSortTerm, ListView, PublishedForm, RecordListQuery } from '@formancy/data-client'
import { gridKey } from './prefs.js'
import { audit, unnamed } from './test-accessible.js'
import { applied, applyCondition, listsSent } from './test-filter.js'
import { ORDER_VIEWS, VIEWED } from './test-forms.js'
import { answeredOnce, chooseForm, gridSection, gridStatus, load, loaded, mount, signIn, stamp } from './test-host.js'
import type { User } from './test-host.js'
import { childGrid, headed, headers, keptFor, listed, moveButton, openColumns, RECORDS_GRID, showBox } from './test-columns.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * What this browser keeps of a grid, and what it brings back (0106), on
 * both engines, against the real server: the page mounted again over the
 * same storage, as a reload is, opens a form's grid on the columns the
 * person arranged, on the view they picked, on a header's sort, and on
 * "All records" over the form's default view -- each as one first page --
 * and never on the conditions of a filter of their own, no value typed
 * into one ever reaching storage (0104). What was kept is read over what
 * the form offers now; storage that throws leaves a page that works; and
 * a child section's arrangement is the child form's, under every parent.
 * Every state is held to axe at WCAG 2.2 AA and to a name on every control.
 *
 * Found by role and accessible name (formancy.ai 0034), and storage read
 * by the key the page writes (prefs.ts's `gridKey`).
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
  vi.restoreAllMocks()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

const ARRIVES = { timeout: 15_000 }
const [NEWEST, LARGE] = ORDER_VIEWS as [ListView, ListView]
const OWN = 'Your own filter and sort'

async function floor(state: string): Promise<{ state: string; axe: string[]; unnamed: string[] }> {
  return { state, axe: await audit(), unnamed: unnamed() }
}
const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })

async function definitionOf(formId: string): Promise<PublishedForm> {
  const definition = await plane.clerk.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  return definition.value
}

/** The labels of a form's readable fields, in the form's order, but `parent`'s. */
async function labelsOf(formId: string, parent: string | null = null): Promise<string[]> {
  const definition = await definitionOf(formId)
  const readable = new Set(definition.readable)
  return definition.form.model.fields.filter((field) => readable.has(field.key) && field.key !== parent).map((field) => String(field.label ?? field.key))
}

/** The page, signed in as tenant 1's clerk, with `formId` chosen and its grid answered: a first opening, or a reload. */
async function workspace(formId: string): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  return user
}

/** The page gone, as a reload takes it, what was kept left as it is, and opened again on `formId` with nothing sent before. */
async function reopen(formId: string): Promise<User> {
  cleanup()
  plane.sent.length = 0
  return workspace(formId)
}

/** The filter and sort of each list request sent for `formId`, with the cursor it continues after. */
const asked = (formId: string): Array<Pick<RecordListQuery, 'filter' | 'sort' | 'after'>> => listsSent(plane.sent, formId).map(({ body }) => ({ filter: body.filter, sort: body.sort, after: body.after }))

/** What the grid's View picker shows. */
const shown = (heading: string): string => within(within(gridSection(heading)).getByRole('combobox', { name: 'View' })).getByRole('option', { selected: true }).textContent ?? ''

/** Choose `name` in the grid's View picker and press Show view. */
async function pick(user: User, heading: string, name: string): Promise<void> {
  await user.selectOptions(within(gridSection(heading)).getByRole('combobox', { name: 'View' }), name)
  await user.click(within(gridSection(heading)).getByRole('button', { name: 'Show view' }))
}

/** What a header of the grid says of its sort: `aria-sort`, or null for a column that is not sorted. */
function sortOf(heading: string, label: string): string | null {
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  const sort = within(grid).getByRole('columnheader', { name: new RegExp(`^${label}`) }).getAttribute('aria-sort')
  return sort === 'none' ? null : sort
}

/** Wait until the grid has answered a first page with a line like `line`. */
async function says(heading: string, line: RegExp): Promise<void> {
  await waitFor(() => expect(gridStatus(heading)?.textContent).toMatch(line), ARRIVES)
}

/** Fresh orders of tenant 1's, noted `notes`, one per amount, made beside the page: their tokens. */
async function freshOrders(engine: Engine, notes: string, amounts: readonly string[]): Promise<string[]> {
  const definition = await definitionOf(engine.formId)
  const source = definition.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const records: string[] = []
  for (const amount of amounts) {
    const created = await plane.clerk.create(engine.formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount, notes })
    if (!created.ok || created.value.record === null) throw new Error('the order was not created')
    records.push(created.value.record)
  }
  return records
}

/** Every key and value this browser keeps, as one text. */
function everythingKept(): string {
  return Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index) ?? ''
    return `${key}=${localStorage.getItem(key) ?? ''}`
  }).join('\n')
}

describe.each(ENGINES)('a grid remembered on $engine', (engine) => {
  // Columns hidden and moved and a view picked come back on the next
  // opening, which asks one first page, in the view, and writes nothing
  // into the address (watched failing with nothing read back: Notes drawn
  // again, in the form's order).
  test('brings back the columns and a picked view', async () => {
    await freshOrders(engine, `${VIEWED} ${stamp('kept')}`, ['400', '150'])
    const user = await workspace(engine.formId)
    const labels = await labelsOf(engine.formId)
    await openColumns(user, 'Records')
    await user.click(showBox('Records', 'Notes'))
    await user.click(moveButton('Records', 'Amount', 'up'))
    await pick(user, 'Records', LARGE.name)
    await says('Records', /^Rows 1–\d+\. Filtered by Notes and Amount\.$/)
    const arranged = headers('Records')
    expect(arranged).not.toContain('Notes')
    const before = window.location.href

    await reopen(engine.formId)
    await headed('Records', arranged)
    await says('Records', /^Rows 1–\d+\. Filtered by Notes and Amount\.$/)
    expect(asked(engine.formId)).toEqual([{ filter: LARGE.filter, sort: LARGE.sort, after: null }])
    expect(shown('Records')).toBe(LARGE.name)
    expect([sortOf('Records', 'Amount'), sortOf('Records', 'Id')]).toEqual(['descending', 'ascending'])
    await openColumns(user, 'Records')
    expect(listed('Records').map((column) => column.label).sort()).toEqual([...labels].sort())
    expect(showBox('Records', 'Notes').checked).toBe(false)
    expect(window.location.href).toBe(before)
    expect(await floor('the columns and a view brought back')).toEqual(CLEAN('the columns and a view brought back'))
  })

  // "All records" is kept as an empty sort, which outlasts the form's
  // default view; a header's sort is kept as itself, with no filter, and
  // is "Your own filter and sort" when it comes back -- each in one first
  // page (watched failing with an empty sort left unwritten: { version: 1 }
  // kept, and nothing of the list; and with nothing read back: the default
  // view's filtered page after "All records").
  test('brings back "All records" over the default view, and a header’s sort', async () => {
    const user = await workspace(engine.formId)
    await waitFor(() => expect(shown('Records')).toBe(NEWEST.name), ARRIVES)
    await pick(user, 'Records', 'All records')
    await says('Records', /^Rows 1–\d+(; more follow)?\.$/)
    expect(keptFor(RECORDS_GRID, engine.formId)).toEqual({ version: 1, sort: [] })

    const again = await reopen(engine.formId)
    await says('Records', /^Rows 1–\d+(; more follow)?\.$/)
    expect(asked(engine.formId)).toEqual([{ filter: [], sort: [], after: null }])
    expect(shown('Records')).toBe('All records')
    expect(sortOf('Records', 'Id')).toBeNull()
    expect(await floor('all records brought back')).toEqual(CLEAN('all records brought back'))

    const grid = within(gridSection('Records')).getByRole('grid', { name: 'Records' })
    within(grid).getByRole('columnheader', { name: /^Order date/ }).focus()
    await again.keyboard('{Enter}')
    const byDate: ListSortTerm[] = [{ field: 'order_date', direction: 'asc' }]
    await waitFor(() => expect(keptFor(RECORDS_GRID, engine.formId)).toEqual({ version: 1, sort: byDate }), ARRIVES)
    await says('Records', /^Rows 1–\d+(; more follow)?\.$/)

    await reopen(engine.formId)
    await says('Records', /^Rows 1–\d+(; more follow)?\.$/)
    expect(asked(engine.formId)).toEqual([{ filter: [], sort: byDate, after: null }])
    expect(sortOf('Records', 'Order date')).toBe('ascending')
    expect(shown('Records')).toBe(OWN)
    expect(await floor('a header’s sort brought back')).toEqual(CLEAN('a header’s sort brought back'))
  })

  // A filter of the person's own is kept as its sort alone: no condition
  // comes back, and nothing typed into one is in storage, under any key
  // (0104) (watched failing with the section's filter written beside its
  // sort: the filter, the typed words in it, in the value kept; and with
  // nothing read back: the default view's filter after the reopening).
  test('never brings back the conditions of a filter of the person’s own, nor keeps what was typed', async () => {
    const words = stamp('typed')
    const user = await workspace(engine.formId)
    await waitFor(() => expect(shown('Records')).toBe(NEWEST.name), ARRIVES)
    await applyCondition(user, 'Records', { field: 'Notes', condition: 'contains', value: words })
    await says('Records', /^No records match the filter on Notes\.$/)
    expect(shown('Records')).toBe(OWN)
    expect(keptFor(RECORDS_GRID, engine.formId)).toEqual({ version: 1, sort: NEWEST.sort })
    expect(everythingKept()).not.toContain(words)
    expect(everythingKept()).not.toContain(VIEWED)

    await reopen(engine.formId)
    await says('Records', /^Rows 1–\d+(; more follow)?\.$/)
    expect(applied('Records')).toEqual([])
    expect(asked(engine.formId)).toEqual([{ filter: [], sort: NEWEST.sort, after: null }])
    expect(sortOf('Records', 'Id')).toBe('descending')
    expect(shown('Records')).toBe(OWN)
    expect(await floor('a filter of your own, not brought back')).toEqual(CLEAN('a filter of your own, not brought back'))
  })

  // What was kept is read over what the form offers now: a column it no
  // longer offers dropped, the ones not named appended in the form's
  // order, a view no longer offered by its name leaving the default view;
  // and a value of another shape is nothing kept -- here one holding a
  // filter, which this release never writes, beside columns that would
  // hide Id if they were read (watched failing with the columns not named
  // left out: Notes drawn alone; with nothing read back: every column, in
  // the form's order; and with the reader's exact keys taken out: Id
  // hidden by the value of another shape).
  test('reads what was kept over what the form offers now', async () => {
    const labels = await labelsOf(engine.formId)
    localStorage.setItem(gridKey(RECORDS_GRID, engine.formId), JSON.stringify({ version: 1, columns: [{ field: 'gone', shown: true }, { field: 'notes', shown: true }, { field: 'id', shown: false }], view: 'A view since renamed' }))
    await workspace(engine.formId)
    await headed('Records', ['Notes', ...labels.filter((label) => label !== 'Notes' && label !== 'Id')])
    expect(shown('Records')).toBe(NEWEST.name)

    localStorage.setItem(gridKey(RECORDS_GRID, engine.formId), JSON.stringify({ version: 1, columns: [{ field: 'notes', shown: true }, { field: 'id', shown: false }], filter: [{ field: 'notes', op: 'contains', text: 'x' }] }))
    await reopen(engine.formId)
    await headed('Records', labels)
    expect(shown('Records')).toBe(NEWEST.name)
    expect(applied('Records')).toEqual([`Notes contains “${VIEWED}”Remove`])
  })

  // Reset columns where no list was ever chosen leaves nothing to keep:
  // the key goes, so the form opens as it is given, its default view
  // included, rather than on a value that keeps nothing (watched failing
  // with the value written as it is: { version: 1 } left under the key).
  test('Reset columns with no list chosen keeps nothing', async () => {
    const user = await workspace(engine.formId)
    const labels = await labelsOf(engine.formId)
    await headed('Records', labels)
    await openColumns(user, 'Records')
    await user.click(showBox('Records', 'Notes'))
    await headed('Records', labels.filter((label) => label !== 'Notes'))
    expect(keptFor(RECORDS_GRID, engine.formId)).toEqual({ version: 1, columns: expect.any(Array) })
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Reset columns' }))
    await headed('Records', labels)
    expect(keptFor(RECORDS_GRID, engine.formId)).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  // A browser with site data blocked throws on every call to storage: the
  // page opens on the form's columns and default view, and a column hidden
  // and a view picked work as ever, kept nowhere (watched failing with
  // storage read unwrapped: the workspace never drew after the sign-in, no
  // Forms to choose a form from).
  test('works when storage throws', async () => {
    const refuse = (): never => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse)
    await freshOrders(engine, `${VIEWED} ${stamp('blocked')}`, ['500'])
    const user = await workspace(engine.formId)
    const labels = await labelsOf(engine.formId)
    await headed('Records', labels)
    await openColumns(user, 'Records')
    await user.click(showBox('Records', 'Notes'))
    await headed('Records', labels.filter((label) => label !== 'Notes'))
    await pick(user, 'Records', LARGE.name)
    await says('Records', /^Rows 1–\d+\. Filtered by Notes and Amount\.$/)
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Reset columns' }))
    await headed('Records', labels)
    expect(localStorage.length).toBe(0)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await floor('storage that throws')).toEqual(CLEAN('storage that throws'))
  })

  // A child section's arrangement is the child form's, kept apart from
  // the Records panel's and shared by its sections under every parent:
  // hidden and moved under one order, it opens so under another, its
  // parent's field never offered (watched failing with nothing read back:
  // Carrier drawn again under the second order).
  test('a child section keeps its own columns, under every parent, without its parent’s field', async () => {
    const records = await freshOrders(engine, stamp('parents'), ['1', '2'])
    for (const record of records) {
      const made = await plane.clerk.create(engine.deliveries, { order: record, carrier: stamp('carrier'), shipped_at: '2026-10-07T08:00:00Z' })
      if (!made.ok) throw new Error(made.message)
    }
    const labels = await labelsOf(engine.deliveries, 'order')
    const orderLabels = await labelsOf(engine.formId)
    const user = await workspace(engine.formId)
    await load(user, String(records[0]))
    await waitFor(() => expect(within(gridSection('Delivery')).queryByRole('grid', { name: 'Delivery' })).not.toBeNull(), ARRIVES)
    await answeredOnce('Delivery')
    await openColumns(user, 'Delivery')
    await user.click(showBox('Delivery', 'Carrier'))
    await user.click(moveButton('Delivery', 'Shipped at', 'up'))
    const arranged = headers('Delivery')
    expect(arranged).not.toContain('Carrier')
    expect(keptFor(RECORDS_GRID, engine.formId)).toBeNull()

    await load(user, String(records[1]))
    await loaded(String(records[1]))
    await answeredOnce('Delivery')
    await headed('Delivery', arranged)
    await openColumns(user, 'Delivery')
    expect(listed('Delivery').map((column) => column.label).sort()).toEqual([...labels].sort())
    expect(listed('Delivery').map((column) => column.label)).not.toContain('Order')
    await headed('Records', orderLabels)
    expect(await floor('a child section’s columns under another parent')).toEqual(CLEAN('a child section’s columns under another parent'))
  })
})
