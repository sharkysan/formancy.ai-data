import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { createDataClient } from '@formancy/data-client'
import type { DataClient } from '@formancy/data-client'
import { audit, focusedName, paragraphs, unnamed } from './test-accessible.js'
import { answeredOnce, chooseForm, chooseRenderer, gridSection, mount, newRecord, RENDERERS, searchRecords, signIn, stamp } from './test-host.js'
import type { RendererName, User } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * A record's child rows (0045, 0047), on both engines and in both
 * renderers, against the real server: an order's lines, listed under the
 * order and reached only through it (0043), created with the order preset,
 * and edited in the line's own form; and an employee, whose own form is its
 * child through the manager, with orders under it twice -- through who
 * created and who approved them.
 *
 * Found by role and accessible name, with one read the accessibility tree
 * cannot answer, said where it is made: element ids, which are what two
 * sections of one form must never mint twice, and have no role or name.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ children: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const ARRIVES = { timeout: 15_000 }

function client(token: string): DataClient {
  return createDataClient({ token: () => token, fetch: plane.fetch })
}

/** An order of `token`'s tenant noted `notes`, with lines numbered `lines`, made beside the page: its token and its lines'. */
async function orderWithLines(engine: Engine, token: string, notes: string, lines: readonly number[]): Promise<{ order: string; lines: string[] }> {
  const as = client(token)
  const definition = await as.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  // Each tenant's seeded customer, by name: another suite's customers come and go beside this one.
  const found = await as.query(engine.formId, source, { operation: 'create', search: token === TOKENS.otherClerk ? 'Other Tenant' : 'Muster' })
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

/** Click the row of the grid `heading` names whose first cell says `first`. */
async function openRow(user: User, heading: string, first: string): Promise<void> {
  await waitFor(() => expect(rows(heading).map((cells) => cells[0])).toContain(first), ARRIVES)
  const grid = within(gridSection(heading)).getByRole('grid', { name: heading })
  const row = within(grid)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryAllByRole('gridcell')[0]?.textContent === first) as HTMLElement
  await user.click(within(row).getAllByRole('gridcell')[0] as HTMLElement)
}

/** A child row's pane: the region its heading and the renderer name. */
function childPane(heading: string, renderer: RendererName): HTMLElement {
  return screen.getByRole('region', { name: `${heading} ${renderer}` })
}

/** The page signed in as tenant 1's clerk, `formId` chosen, both renderers on. */
async function workspace(formId: string): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  await chooseRenderer(user)
  return user
}

describe.each(ENGINES)("an order's lines on $engine", (engine) => {
  // The lines grid is the order's: listed with `parent`, so another order's
  // lines -- of this tenant or of another -- are never in it, and the order
  // column every row shares is left out. The three orders share their notes,
  // and the search finds tenant 1's two: the other tenant's matches and is
  // not listed.
  test("holds the open order's lines only", async () => {
    const words = stamp('lines')
    const mine = await orderWithLines(engine, TOKENS.clerk, words, [1, 2])
    const other = await orderWithLines(engine, TOKENS.clerk, words, [1])
    await orderWithLines(engine, TOKENS.otherClerk, words, [1, 2, 3])
    const user = await workspace(engine.formId)
    await searchRecords(user, words, [mine.order.slice(3), other.order.slice(3)])
    await openRow(user, 'Records', mine.order.slice(3))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Order line' })).toBeTruthy(), ARRIVES)
    expect(await answeredOnce('Order line')).toBe('Order line rows 1–2.')
    expect(rows('Order line').map((cells) => cells[0])).toEqual(['1', '2'])
    expect(
      within(gridSection('Order line'))
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim()),
    ).not.toContain('Order')
    expect(paragraphs(gridSection('Order line'))).toContain(`For Order ${mine.order}`)
  })

  // A new line is preset with the open order, whose field the page draws
  // disabled; saved, it is created under that order and the grid shows it;
  // opened from the grid, it is edited and saved in the line's own form.
  // The order field is a native select (0066: its date is nothing a search
  // matches), whose value is the preset token at once; only the selected
  // option's name, the order's date, proves its label arrived, from the
  // labels request or from the empty search's first page -- until one
  // answers, the option is named by the token itself (watched failing with
  // every request for the line form's lookup held: the option stayed named
  // by its token; with the labels request alone held it passed, the empty
  // search's first page naming the order).
  test.each(RENDERERS)('a line is created under the order and edited, in %s', async (renderer) => {
    const words = stamp('line')
    const mine = await orderWithLines(engine, TOKENS.clerk, words, [1])
    const user = await workspace(engine.formId)
    await searchRecords(user, words, [mine.order.slice(3)])
    await openRow(user, 'Records', mine.order.slice(3))
    await answeredOnce('Order line')
    const section = gridSection('Order line')
    await user.click(within(section).getByRole('button', { name: 'New Order line' }))
    await waitFor(() => expect(focusedName()).toBe('New Order line'), ARRIVES)
    const pane = childPane('New Order line', renderer)
    const order = await within(pane).findByRole('combobox', { name: /^Order\*?$/ }, ARRIVES)
    expect((order as HTMLSelectElement).disabled).toBe(true)
    await waitFor(() => expect(computeAccessibleName(within(order).getByRole('option', { selected: true }))).toBe(EDGES.orderDate), ARRIVES)
    const field = (name: RegExp): HTMLInputElement => within(pane).getByLabelText<HTMLInputElement>(name)
    await user.clear(field(/^Line no\b/))
    await user.type(field(/^Line no\b/), '7')
    await user.clear(field(/^Quantity\b/))
    await user.type(field(/^Quantity\b/), '4')
    await user.clear(field(/^Unit price\b/))
    await user.type(field(/^Unit price\b/), '1.25')
    await user.click(within(pane).getByRole('button', { name: 'Save' }))
    const created = await waitFor(() => {
      const text = within(pane)
        .getAllByRole('status')
        .map((status) => status.textContent ?? '')
        .find((said) => /^Created record /.test(said))
      expect(text, 'the line was created').toBeDefined()
      return String(text)
    }, ARRIVES)
    const token = created.slice('Created record '.length, -1)
    await waitFor(() => expect(rows('Order line').map((cells) => cells[0])).toEqual(['1', '7']), ARRIVES)
    const stored = await plane.clerk.read(engine.lines, token)
    expect(stored.ok && stored.value.answers['order']).toBe(mine.order)

    await openRow(user, 'Order line', '1')
    const opened = await waitFor(() => childPane(`Order line ${mine.lines[0] ?? ''}`, renderer), ARRIVES)
    const quantity = await waitFor(() => within(opened).getByLabelText<HTMLInputElement>(/^Quantity\b/), ARRIVES)
    await waitFor(() => expect(quantity.value).toBe('1'), ARRIVES)
    await user.clear(quantity)
    await user.type(quantity, '9')
    await user.click(within(opened).getByRole('button', { name: 'Save' }))
    await waitFor(
      () =>
        expect(
          within(opened)
            .getAllByRole('status')
            .map((status) => status.textContent),
        ).toContain('Saved.'),
      ARRIVES,
    )
    const edited = await plane.clerk.read(engine.lines, mine.lines[0] ?? '')
    expect(edited.ok && String(edited.value.answers['quantity'])).toBe('9')
  })

  // A new order has no lines yet, and none can be made under it until it is
  // saved: the grid is not drawn, and New Order line says why it does
  // nothing, as its description and on its line.
  test('lists no lines under an order not saved yet, and says so', async () => {
    const user = await workspace(engine.formId)
    await newRecord(user)
    const section = await waitFor(() => gridSection('Order line'), ARRIVES)
    expect(within(section).queryByRole('grid')).toBeNull()
    const button = within(section).getByRole('button', { name: 'New Order line' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(within(section).getByRole('status').textContent).toBe('Order line rows are listed once this Order is saved.')
    await user.click(button)
    await waitFor(() => expect(within(section).getByRole('status').textContent).toBe('Order line rows are listed once this Order is saved.'))
    expect(screen.queryByRole('heading', { level: 5 })).toBeNull()
  })
})

describe.each(ENGINES)('an employee and the forms under it on $engine', (engine) => {
  // Every child section open at once, a row open in each: the employee form
  // as its own child, through the manager, and the order form twice,
  // through who created and who approved -- each a namespace of its own, so
  // no element id is minted twice, and the page still passes axe with a
  // name on every control (watched failing with the child sessions in the
  // record's namespace, and with the two order sections in one: the
  // approved order's Amount label named the created one's input).
  test('opens every child at once with no id twice, and passes the floor', async () => {
    const approved = await plane.db.insertApprovedOrder(engine.connection, 1)
    const user = await workspace(engine.employees)
    await openRow(user, 'Records', '1')
    await waitFor(() => expect(screen.getByRole('region', { name: 'Employee' })).toBeTruthy(), ARRIVES)
    expect(screen.getByRole('region', { name: 'Order, Created by' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Order, Approved by' })).toBeTruthy()
    await answeredOnce('Employee')
    await openRow(user, 'Employee', '2')
    await answeredOnce('Order, Created by')
    await openRow(user, 'Order, Created by', EDGES.seededOrder.slice(3))
    await answeredOnce('Order, Approved by')
    await openRow(user, 'Order, Approved by', approved.slice(3))
    for (const renderer of RENDERERS) {
      await waitFor(() => expect(within(childPane(`Employee k1:2`, renderer)).getByLabelText(/^Name\b/)).toBeTruthy(), ARRIVES)
      await waitFor(() => expect(within(childPane(`Order ${EDGES.seededOrder}`, renderer)).getByLabelText(/^Amount\b/)).toBeTruthy(), ARRIVES)
      await waitFor(() => expect(within(childPane(`Order ${approved}`, renderer)).getByLabelText(/^Amount\b/)).toBeTruthy(), ARRIVES)
    }
    // The order form is one this clerk may only read: its record's fields are drawn disabled.
    expect(within(childPane(`Order ${EDGES.seededOrder}`, 'React')).getByLabelText<HTMLInputElement>(/^Amount\b/).disabled).toBe(true)

    // Read from the DOM: an id has no role and no name.
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
    expect({ axe: await audit(), unnamed: unnamed() }).toEqual({ axe: [], unnamed: [] })
  })
})
