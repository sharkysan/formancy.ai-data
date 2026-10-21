import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { createDataClient } from '@formancy/data-client'
import type { DataClient } from '@formancy/data-client'
import { audit, focusedName, unnamed } from './test-accessible.js'
import { answeredOnce, chooseForm, gridSection, mount, searchRecords, signIn, stamp, unsavedNotice } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { EDGES, ENGINES, holdingRequests, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * Drill down (0090): the open form one level at a time -- its records, the
 * record, a child row of it, that row's child rows -- with a trail of
 * buttons back to each level above. On both engines, against the real
 * server, through the child forms `startPlane({ children: true })`
 * publishes: an order's lines, and an employee's employees and the orders
 * it created.
 *
 * Found by role and accessible name. Two reads the accessibility tree
 * cannot answer, said where they are made: `location.hash`, which is the
 * browser's, and element ids, which two levels of one form must never mint
 * twice and which have no role or name.
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
    .map((row) => within(row).getAllByRole('gridcell').map((cell) => cell.textContent ?? ''))
}

/** The row of the grid `heading` names whose first cell says `first`, once it is listed. */
async function rowOf(heading: string, first: string): Promise<HTMLElement> {
  await waitFor(() => expect(rows(heading).map((cells) => cells[0])).toContain(first), ARRIVES)
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  return within(grid)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryAllByRole('gridcell')[0]?.textContent === first) as HTMLElement
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

/** `plane.fetch`, with every read of `formId`'s records held until `release`: an answer that comes once the person has moved on. */
function holdingReads(formId: string): { fetch: typeof globalThis.fetch; release: () => void; held: () => number; answered: () => number } {
  let open: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  let held = 0
  let answered = 0
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.endsWith(`/v1/forms/${formId}/records/read`)) return plane.fetch(input, init)
    held += 1
    await gate
    const response = await plane.fetch(input, init)
    answered += 1
    return response
  }
  return { fetch, release: () => open(), held: () => held, answered: () => answered }
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
    await waitFor(() => expect(within(gridSection('Order line')).getAllByRole('status').map((status) => status.textContent)).toContain(refused.message), ARRIVES)
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
    const held = holdingReads(engine.lines)
    const user = await drilling(engine.formId, held.fetch)
    await searchRecords(user, words, [order.slice(3)])
    await pressOn(user, 'Records', order.slice(3), '{Enter}')
    await answeredOnce('Order line')
    await pressOn(user, 'Order line', '1', '{Enter}')
    await waitFor(() => expect(held.held()).toBe(1), ARRIVES)
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Records' }))
    await waitFor(() => expect(focusedName()).toBe('Records'), ARRIVES)
    held.release()
    await waitFor(() => expect(held.answered()).toBe(1), ARRIVES)
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
    expect(within(notice).getAllByRole('paragraph').map((text) => text.textContent)).toContain(`Opening ${second.order} closes these forms:`)
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
    await waitFor(() => expect(within(gridSection('Order line')).getAllByRole('status').some((status) => status.textContent?.startsWith(`Deleted Order line ${lines[0] ?? ''}. `))).toBe(true), ARRIVES)
    await waitFor(() => expect(rows('Order line').map((cells) => cells[0])).toEqual(['2']), ARRIVES)
  })

  // The row the level below holds, deleted from its grid one level up: the
  // levels below go with it, so the guard asks about them first, naming
  // what they hold; Discard and continue goes on to the confirmation, and
  // once deleted the level below is gone (watched failing: no question, and
  // the typing was dropped without a word).
  test("the held row's Delete in the grid asks about the levels below first", async () => {
    const words = stamp('drill-held')
    const { order, lines } = await orderWithLines(engine, words, [1, 2])
    const user = await drilling(engine.formId)
    await toOrderLine(user, words, order, lines[0] ?? '')
    const quantity = await field(`Order line ${lines[0] ?? ''}`, /^Quantity\b/)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.type(quantity, '5')
    await crumb(user, `Order ${order}`)
    await waitFor(() => expect(focusedName()).toBe(`Order ${order}`), ARRIVES)
    await user.click(within(gridSection('Order line')).getByRole('button', { name: `Delete Order line ${lines[0] ?? ''}` }))
    const notice = await waitFor(() => unsavedNotice() as HTMLElement, ARRIVES)
    expect(within(notice).getAllByRole('paragraph').map((text) => text.textContent)).toContain(`Deleting ${lines[0] ?? ''} closes these forms:`)
    expect(listed(notice)).toEqual([`Order line ${lines[0] ?? ''}, React: changes that are not saved.`])
    await user.click(within(notice).getByRole('button', { name: 'Discard and continue' }))
    await user.click(within(await waitFor(() => confirmation('Order line', lines[0] ?? ''), ARRIVES)).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(rows('Order line').map((cells) => cells[0])).toEqual(['2']), ARRIVES)
    expect(screen.queryByRole('heading', { name: `Order line ${lines[0] ?? ''}` })).toBeNull()
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
