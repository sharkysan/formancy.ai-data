import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { createDataClient } from '@formancy/data-client'
import type { DataClient } from '@formancy/data-client'
import { focusedName } from './test-accessible.js'
import { answeredOnce, chooseForm, gridSection, mount, searchRecords, signIn, stamp } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
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
