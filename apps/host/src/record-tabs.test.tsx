import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
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
  searchRecords,
  showChild,
  showTab,
  signIn,
  stamp,
  unsavedNotice,
} from './test-host.js'
import type { User } from './test-host.js'
import { holdingRequests } from './test-network.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A record's child forms, a tab each beside it (0142), on both engines and
 * against the real server: the record's own tab first and selected, named
 * as its heading names it, then one per child the menu names, in the
 * menu's order; a child's section drawn the first time its tab is shown,
 * and kept, with what is in it, while another is; another record starting
 * again on its own tab; a record whose children are all sections of it
 * drawing no tabs; a Drill down level's children in tabs of its own; a
 * deletion's question and a refused save's notice in a tab another hides
 * showing that tab; and typing in a hidden tab asked about before another
 * record replaces it. tab-list.test.tsx holds the pattern's keys without a
 * database.
 *
 * Found by role and accessible name. Where the claim is that a hidden
 * panel holds nothing at all, the query includes what no person can reach
 * (`hidden: true`): an element in a hidden panel has no role a person
 * meets, which is what a hidden panel is for.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true, deletes: true, deliveries: true, sections: true })
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

/** An order of tenant 1's noted `notes`, with lines numbered `lines` and a delivery per carrier, made beside the page: its token and its lines'. */
async function orderWith(
  engine: Engine,
  notes: string,
  lines: readonly number[],
  carriers: readonly string[] = [],
): Promise<{ order: string; lines: string[] }> {
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
  const order = created.value.record
  const made: string[] = []
  for (const no of lines) {
    const line = await plane.clerk.create(engine.lines, { order, line_no: String(no), quantity: String(no), unit_price: '2.50' })
    if (!line.ok || line.value.record === null) throw new Error(`line ${String(no)} was not created: ${line.ok ? 'no token' : line.message}`)
    made.push(line.value.record)
  }
  for (const carrier of carriers) {
    const delivery = await plane.clerk.create(engine.deliveries, { order, carrier })
    if (!delivery.ok) throw new Error(`the delivery was not created: ${delivery.message}`)
  }
  return { order, lines: made }
}

/** What the menu names under `formId`, as its tabs name them: each child form's title, its sections left out. None here is reached twice. */
async function childTitles(formId: string): Promise<string[]> {
  const menu = await plane.clerk.forms()
  if (!menu.ok) throw new Error(menu.message)
  const titleOf = (id: string): string => menu.value.forms.find((form) => form.id === id)?.title ?? id
  return (menu.value.forms.find((form) => form.id === formId)?.children ?? []).filter((child) => !child.one).map((child) => titleOf(child.form))
}

/** The page signed in as tenant 1's clerk through `fetch`, `formId` chosen, React alone. */
async function workspace(formId: string, fetch: typeof globalThis.fetch = plane.fetch): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await chooseRenderer(user, 'React')
  return user
}

/** The row of the grid `heading` names whose first cell says `first`, once it is listed. */
async function rowOf(heading: string, first: string): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined =>
    dataRows(within(gridSection(heading)).getByRole('grid', { name: heading })).find((row) => within(row).queryAllByRole('gridcell')[0]?.textContent === first)
  await waitFor(() => expect(find(), `no row of ${heading} starts with ${first}`).toBeDefined(), ARRIVES)
  return find() as HTMLElement
}

/** Click the first cell of that row. */
async function openRow(user: User, heading: string, first: string): Promise<void> {
  await user.click(within(await rowOf(heading, first)).getAllByRole('gridcell')[0] as HTMLElement)
}

/** The tabs of the row the record's heading names, as they read, and the ones selected. */
function tabsOf(record: string): { tabs: string[]; selected: string[] } {
  const tablist = within(screen.getByRole('tablist', { name: record }))
  const text = (tab: HTMLElement): string => tab.textContent ?? ''
  return { tabs: tablist.getAllByRole('tab').map(text), selected: tablist.getAllByRole('tab', { selected: true }).map(text) }
}

/** A child row's React pane on the section's rail. */
const rowPane = (heading: string): HTMLElement => screen.getByRole('region', { name: `${heading} React` })

describe.each(ENGINES)("a record's child forms on $engine", (engine) => {
  // The order's own tab first and shown, named as its heading names it, its
  // form in that tab's panel; then a tab per child form, in the menu's
  // order, named as each section is. No child's grid is drawn, nor its
  // page asked of the server, until its tab is shown; then its section is
  // the panel, and the order's form is out of reach. The row and the panel
  // shown pass the floor (to be watched failing in CI with every panel
  // drawn as the record opens: the lines' grid there, hidden, and its page
  // asked).
  test("draws the record's own tab, then a tab per child form, each section drawn once it is shown", async () => {
    const words = stamp('tabs')
    const { order } = await orderWith(engine, words, [1, 2], [`${words} Post`])
    const user = await workspace(engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    const from = plane.sent.length
    await openRow(user, 'Records', order.slice(3))
    await screen.findByRole('tablist', { name: `Order ${order}` }, ARRIVES)
    expect(tabsOf(`Order ${order}`)).toEqual({ tabs: [`Order ${order}`, ...(await childTitles(engine.formId))], selected: [`Order ${order}`] })
    await within(screen.getByRole('tabpanel', { name: `Order ${order}` })).findByRole('form', { name: 'Order, React' }, ARRIVES)
    expect(screen.queryByRole('grid', { name: 'Order line', hidden: true })).toBeNull()
    expect(plane.sent.slice(from).filter((request) => request.path === `/v1/forms/${engine.lines}/records/list`)).toEqual([])

    const lines = await showChild(user, 'Order line')
    expect(screen.getByRole('tabpanel', { name: 'Order line' }).contains(lines)).toBe(true)
    expect(await answeredOnce('Order line')).toBe('Order line rows 1–2.')
    expect(screen.queryByRole('form', { name: 'Order, React' })).toBeNull()
    expect({ axe: await audit(), unnamed: unnamed() }).toEqual({ axe: [], unnamed: [] })
  })

  // From the keyboard: the arrows select the tab they reach, Tab goes on
  // into its panel, and Home back to the order's own tab. A tab left keeps
  // its section as it was -- the line open on its rail, the typing in it,
  // its row marked open -- so leaving it asks nothing of the unsaved-
  // changes guard: nothing is dropped (to be watched failing in CI with
  // the arrows moving the keyboard alone: the Order line tab focused and
  // the order's still selected. tab-list.test.tsx watched a panel drawn
  // only while shown lose its typing).
  test('moves between the tabs from the keyboard, and a tab left keeps its section, asking nothing', async () => {
    const words = stamp('tabs-kept')
    const { order, lines } = await orderWith(engine, words, [1, 2], [`${words} Post`])
    const line = `Order line ${lines[0] ?? ''}`
    const user = await workspace(engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    await openRow(user, 'Records', order.slice(3))
    // Right as many times as the lines' tab is from the order's, in the menu's order.
    const steps = (await childTitles(engine.formId)).indexOf('Order line') + 1
    ;(await screen.findByRole('tab', { name: `Order ${order}` }, ARRIVES)).focus()
    for (let step = 0; step < steps; step += 1) await user.keyboard('{ArrowRight}')
    expect({ focused: focusedName(), selected: tabsOf(`Order ${order}`).selected }).toEqual({ focused: 'Order line', selected: ['Order line'] })
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('tabpanel', { name: 'Order line' }))

    await answeredOnce('Order line')
    await openRow(user, 'Order line', '1')
    const quantity = await waitFor(() => within(rowPane(line)).getByLabelText<HTMLInputElement>(/^Quantity\b/), ARRIVES)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.clear(quantity)
    await user.type(quantity, '9')

    screen.getByRole('tab', { name: 'Order line' }).focus()
    await user.keyboard('{Home}')
    expect({ focused: focusedName(), selected: tabsOf(`Order ${order}`).selected }).toEqual({ focused: `Order ${order}`, selected: [`Order ${order}`] })
    expect(unsavedNotice()).toBeNull()
    expect(screen.queryByRole('region', { name: `${line} React` })).toBeNull()
    expect(within(screen.getByRole('tabpanel', { name: `Order ${order}` })).getByRole('form', { name: 'Order, React' })).toBeTruthy()

    await showChild(user, 'Order line')
    expect(within(rowPane(line)).getByLabelText<HTMLInputElement>(/^Quantity\b/).value).toBe('9')
    expect((await rowOf('Order line', '1')).getAttribute('aria-selected')).toBe('true')
    expect(unsavedNotice()).toBeNull()
  })

  // Another record opens on its own tab: left on the last order's lines, a
  // person would see the next order's lines where they asked for its form;
  // its lines' tab then lists its own (to be watched failing in CI with the
  // tabs' selection kept for another record: the second order opened on
  // Order line. tab-list.test.tsx holds that no other panel is drawn).
  test('opens another record on its own tab', async () => {
    const words = stamp('tabs-another')
    const first = await orderWith(engine, words, [1])
    const second = await orderWith(engine, words, [1, 2])
    const user = await workspace(engine.formId)
    await searchRecords(user, words, [first.order.slice(3), second.order.slice(3)])
    await openRow(user, 'Records', first.order.slice(3))
    await screen.findByRole('tablist', { name: `Order ${first.order}` }, ARRIVES)
    await showChild(user, 'Order line')
    expect(await answeredOnce('Order line')).toBe('Order line rows 1–1.')

    await openRow(user, 'Records', second.order.slice(3))
    await screen.findByRole('tablist', { name: `Order ${second.order}` }, ARRIVES)
    expect(tabsOf(`Order ${second.order}`).selected).toEqual([`Order ${second.order}`])
    await showChild(user, 'Order line')
    expect(await answeredOnce('Order line')).toBe('Order line rows 1–2.')
  })

  // A company party's details are a section of the party (0109), part of
  // the record: drawn under its form in the detail, as before, with no row
  // of tabs -- a row of one tab is a control that does nothing (to be
  // watched failing in CI with a section given a tab of its own: a
  // tablist with Company details in it).
  test('draws no tabs for a record whose children are all sections of it', async () => {
    const created = await plane.clerk.create(engine.party, { name: stamp('company'), kind: 'company' })
    if (!created.ok || created.value.record === null) throw new Error(`the party was not created: ${created.ok ? 'no token' : created.message}`)
    const record = created.value.record
    const user = await workspace(engine.party)
    await load(user, record)
    await loaded(record, 'Party')
    const section = await screen.findByRole('region', { name: 'Company details' }, ARRIVES)
    expect(within(screen.getByRole('region', { name: `Party ${record}` })).getByRole('region', { name: 'Company details' })).toBe(section)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  // A Drill down level is a record too (0090): its children are tabs of its
  // own, its record's first, and each level keeps the tab it was left on
  // while the person goes up and comes down again -- the employee on its
  // approved orders, the order below on its lines (to be watched failing
  // in CI with a level drawing its sections under its panes, as before
  // 0142: no tablist at the order's level).
  test("draws a Drill down level's children in tabs of its own, each level keeping its tab", async () => {
    const order = await plane.db.insertApprovedOrder(engine.connection, 1)
    const made = await plane.clerk.create(engine.lines, { order, line_no: '1', quantity: '1', unit_price: '2.50' })
    if (!made.ok) throw new Error(made.message)
    const employee = await plane.clerk.read(engine.employees, 'k1:1')
    if (!employee.ok) throw new Error(employee.message)
    const user = await workspace(engine.employees)
    await user.click(screen.getByRole('radio', { name: 'Drill down' }))
    const enter = async (heading: string, first: string): Promise<void> => {
      ;(within(await rowOf(heading, first)).getAllByRole('gridcell')[0] as HTMLElement).focus()
      await user.keyboard('{Enter}')
    }
    await enter('Records', '1')
    await waitFor(() => expect(focusedName()).toBe('Employee k1:1'), ARRIVES)
    await showChild(user, 'Order, Approved by')
    await enter('Order, Approved by', order.slice(3))
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    // A level's tabs are drawn once its form's children are known, a moment after the level.
    await screen.findByRole('tablist', { name: `Order ${order}` }, ARRIVES)
    expect(tabsOf(`Order ${order}`)).toEqual({ tabs: [`Order ${order}`, ...(await childTitles(engine.staff))], selected: [`Order ${order}`] })
    await showChild(user, 'Order line')
    expect(await answeredOnce('Order line')).toBe('Order line rows 1–1.')

    await user.click(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: `Employee ${String(employee.value.answers['name'])}` }),
    )
    await waitFor(() => expect(focusedName()).toBe('Employee k1:1'), ARRIVES)
    expect(tabsOf('Employee k1:1').selected).toEqual(['Order, Approved by'])
    await enter('Order, Approved by', order.slice(3))
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    expect(tabsOf(`Order ${order}`).selected).toEqual(['Order line'])
    expect({ axe: await audit(), unnamed: unnamed() }).toEqual({ axe: [], unnamed: [] })
  })

  // A line's save refused as stale -- the line changed beside the page --
  // answered while the person has gone to the order's own tab: its notice
  // takes the keyboard, and nothing hidden can, so the lines' tab is shown
  // first and "Not saved" is heard (to be watched failing in CI with a
  // pane's notice focused where it is, its tab left hidden: the keyboard
  // stayed on the order's tab).
  test("a line's refused save, answered in another tab, shows the lines' tab and its notice", async () => {
    const words = stamp('tabs-refused')
    const { order, lines } = await orderWith(engine, words, [1])
    const line = `Order line ${lines[0] ?? ''}`
    const held = holdingRequests(plane.fetch, ({ path }) => path === `/v1/forms/${engine.lines}/records/update`)
    const user = await workspace(engine.formId, held.fetch)
    await searchRecords(user, words, [order.slice(3)])
    await openRow(user, 'Records', order.slice(3))
    await showChild(user, 'Order line')
    await answeredOnce('Order line')
    await openRow(user, 'Order line', '1')
    const quantity = await waitFor(() => within(rowPane(line)).getByLabelText<HTMLInputElement>(/^Quantity\b/), ARRIVES)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.clear(quantity)
    await user.type(quantity, '7')
    await user.click(within(rowPane(line)).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
    // Moved on beside the page while the save is held: sent at the version read, it is stale.
    const stored = await plane.clerk.read(engine.lines, lines[0] ?? '')
    if (!stored.ok || stored.value.version === null) throw new Error('the line was not read')
    if (!(await plane.clerk.update(engine.lines, { record: lines[0] ?? '', version: stored.value.version, answers: { quantity: '4' } })).ok)
      throw new Error('the line did not move on')

    await showTab(user, `Order ${order}`)
    expect(screen.queryByRole('region', { name: `${line} React` })).toBeNull()
    await held.pass()
    await waitFor(() => expect(focusedName()).toBe(`${line} React Not saved`), ARRIVES)
    expect(tabsOf(`Order ${order}`).selected).toEqual(['Order line'])
  })

  // Typing in a line on the lines' tab stays the guard's while the order's
  // own tab is shown: opening another order from the records asks first,
  // naming that line's form, and Keep editing leaves it as it was (to be
  // watched failing in CI with the guard counting the forms of the tab
  // shown alone: the other order opened over the typing).
  test('asks about typing in a hidden tab before another record replaces it', async () => {
    const words = stamp('tabs-guard')
    const first = await orderWith(engine, words, [1])
    const second = await orderWith(engine, words, [1])
    const line = `Order line ${first.lines[0] ?? ''}`
    const user = await workspace(engine.formId)
    await searchRecords(user, words, [first.order.slice(3), second.order.slice(3)])
    await openRow(user, 'Records', first.order.slice(3))
    await showChild(user, 'Order line')
    await answeredOnce('Order line')
    await openRow(user, 'Order line', '1')
    const quantity = await waitFor(() => within(rowPane(line)).getByLabelText<HTMLInputElement>(/^Quantity\b/), ARRIVES)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.clear(quantity)
    await user.type(quantity, '5')

    await showTab(user, `Order ${first.order}`)
    await openRow(user, 'Records', second.order.slice(3))
    const notice = await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)
    expect(within(notice).getByRole('list').textContent).toBe(`${line}, React: changes that are not saved.`)
    await user.click(within(notice).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('heading', { level: 3, name: `Order ${first.order}` })).toBeTruthy()
    await showChild(user, 'Order line')
    expect(within(rowPane(line)).getByLabelText<HTMLInputElement>(/^Quantity\b/).value).toBe('5')
  })
})

// On SQL Server, whose rowversion proves a line's delete (0050): a line's
// delete answered while the person has gone to the order's own tab, with a
// question -- "Not deleted", the line having changed beside the page --
// shows the lines' tab again and puts the keyboard on the question, as
// Separate views shows the record view (to be watched failing in CI with a
// section's onShow showing its view alone: the question drawn in the
// hidden panel, the keyboard left on the order's tab).
test("a line's delete that asks something, answered in another tab, shows the lines' tab", async () => {
  const engine = ENGINES[1]
  const words = stamp('tabs-delete')
  const { order, lines } = await orderWith(engine, words, [1])
  const line = lines[0] ?? ''
  const held = holdingRequests(plane.fetch, ({ path }) => path === `/v1/forms/${engine.lines}/records/delete`)
  const user = await workspace(engine.formId, held.fetch)
  await searchRecords(user, words, [order.slice(3)])
  await openRow(user, 'Records', order.slice(3))
  await showChild(user, 'Order line')
  await answeredOnce('Order line')
  await openRow(user, 'Order line', '1')
  await waitFor(() => within(rowPane(`Order line ${line}`)).getByLabelText(/^Quantity\b/), ARRIVES)
  const stored = await plane.clerk.read(engine.lines, line)
  if (!stored.ok || stored.value.version === null) throw new Error('the line was not read')
  if (!(await plane.clerk.update(engine.lines, { record: line, version: stored.value.version, answers: { quantity: '4' } })).ok)
    throw new Error('the line did not move on')

  await user.click(screen.getByRole('button', { name: 'Delete Order line' }))
  await user.click(within(screen.getByRole('region', { name: `Delete Order line ${line}?` })).getByRole('button', { name: 'Delete it' }))
  await waitFor(() => expect(held.held).toHaveLength(1), ARRIVES)
  await showTab(user, `Order ${order}`)
  expect(screen.queryByRole('region', { name: 'Order line' })).toBeNull()
  await held.pass()
  await waitFor(() => expect(focusedName()).toBe('Not deleted'), ARRIVES)
  expect(tabsOf(`Order ${order}`).selected).toEqual(['Order line'])
})
