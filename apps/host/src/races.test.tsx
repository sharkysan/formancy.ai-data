import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusedName, paragraphs } from './test-accessible.js'
import { answer, answeredOnce, chooseCustomer, chooseForm, control, formLink, gridSection, mount, newRecord, openForm, pane, said, save, searchRecords, shows, signIn, stamp, unsavedNotice } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, holdingRequests, startPlane, TOKENS } from './test-plane.js'
import type { Engine, Plane } from './test-plane.js'

/*
 * What the workspace does with an answer that arrives after the person has
 * moved on (0047), on both engines against the real server: a record's read
 * answered after New was pressed and typed into, a form's definition refused
 * after another form was chosen, and a record created in one of two panes
 * while the other holds a draft of its own. In each, nothing the person typed
 * is dropped without the notice asking, and the heading, the address and the
 * panes keep naming one thing.
 *
 * The answers are held by a `fetch` between the page and the real server
 * (`holdingRequests`). What a held answer did not do is read once the page
 * has had the time to do it: `settle` below.
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
  window.history.replaceState(null, '', '/')
})

const ARRIVES = { timeout: 15_000 }

/**
 * Half a second after an answer was handed back: what the page does with a
 * read is a JSON parse and a render, a few ticks. Long enough for a page that
 * would open the record to have opened it, which is what each test below
 * watched it do.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 500))

/** A fresh order of tenant 1's noted `notes`, with `lines` lines, made beside the page: its token and its lines'. */
async function freshOrder(engine: Engine, notes: string, lines: readonly number[] = []): Promise<{ order: string; lines: string[] }> {
  const definition = await plane.clerk.form(engine.formId)
  if (!definition.ok) throw new Error(definition.message)
  const source = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await plane.clerk.query(engine.formId, source, { operation: 'create', search: 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await plane.clerk.create(engine.formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1', notes })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  const order = created.value.record
  const made: string[] = []
  for (const no of lines) {
    const line = await plane.clerk.create(engine.lines, { order, line_no: String(no), quantity: String(no), unit_price: '2.50' })
    if (!line.ok || line.value.record === null) throw new Error(`line ${String(no)} was not created`)
    made.push(line.value.record)
  }
  return { order, lines: made }
}

/** Click the row of the grid `heading` names whose first cell says `first`. */
async function clickRow(user: User, heading: string, first: string): Promise<void> {
  const grid = (): HTMLElement => within(gridSection(heading)).getByRole('grid', { name: heading })
  const row = (): HTMLElement | undefined =>
    within(grid())
      .getAllByRole('row')
      .find((candidate) => within(candidate).queryAllByRole('gridcell')[0]?.textContent === first)
  await waitFor(() => expect(row(), `no row starts with ${first}`).toBeDefined(), ARRIVES)
  await user.click(within(row() as HTMLElement).getAllByRole('gridcell')[0] as HTMLElement)
}

/** A child row's pane: the region its heading and the renderer name. */
const childPane = (heading: string): HTMLElement => screen.getByRole('region', { name: `${heading} React` })

/** The page signed in through `fetch`, with the order form chosen and its records answered. */
async function workspace(fetch: typeof globalThis.fetch, formId: string): Promise<User> {
  const user = mount(fetch)
  await signIn(user, TOKENS.clerk)
  await chooseForm(user, formId)
  return user
}

describe.each(ENGINES)('answers that arrive late on $engine', (engine) => {
  // A row's read answered after the person pressed New record and typed:
  // opened then, it put the row's record over the draft with no question,
  // and the form the person was typing into edited another record (watched
  // failing: the heading became "Order k1:…" and the 41 was gone).
  test('a row read answered after New record and typing opens nothing over the draft', async () => {
    const words = stamp('late')
    const { order } = await freshOrder(engine, words)
    const holding = holdingRequests(plane.fetch, ({ path, body }) => path === `/v1/forms/${engine.formId}/records/read` && body?.includes(order) === true)
    const user = await workspace(holding.fetch, engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    await clickRow(user, 'Records', order.slice(3))
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    await newRecord(user)
    await within(pane('React')).findByRole('combobox', { name: 'Customer' }, ARRIVES)
    await answer(user, 'React', 'Amount', '41')

    await holding.pass()
    await settle()
    expect(screen.getByRole('heading', { level: 3, name: 'New record' })).toBeTruthy()
    expect(control('React', 'Amount').value).toBe('41')
    expect(unsavedNotice()).toBeNull()
  })

  // Typed into the open record while another row's read was out: the guard
  // was asked when the row was clicked, when nothing was unsaved, so it is
  // asked again when the read answers (watched failing: the row opened over
  // the 7 without a question).
  test('work typed while a row read is out is asked about before the row opens', async () => {
    const words = stamp('typed')
    const first = await freshOrder(engine, words)
    const second = await freshOrder(engine, words)
    const holding = holdingRequests(plane.fetch, ({ path, body }) => path === `/v1/forms/${engine.formId}/records/read` && body?.includes(second.order) === true)
    const user = await workspace(holding.fetch, engine.formId)
    await searchRecords(user, words, [first.order.slice(3), second.order.slice(3)])
    await clickRow(user, 'Records', first.order.slice(3))
    await screen.findByRole('heading', { level: 3, name: `Order ${first.order}` }, ARRIVES)
    await shows('React', 'Amount', '1.0000')
    await clickRow(user, 'Records', second.order.slice(3))
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    await answer(user, 'React', 'Amount', '7')

    await holding.pass()
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    const notice = unsavedNotice() as HTMLElement
    expect(within(notice).getAllByRole('paragraph')[0]?.textContent).toBe(`Opening ${second.order} closes these forms:`)
    expect(within(notice).getByRole('list').textContent).toBe(`Order ${first.order}, React: changes that are not saved.`)
    await user.click(within(notice).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('heading', { level: 3, name: `Order ${first.order}` })).toBeTruthy()
    expect(control('React', 'Amount').value).toBe('7')
  })

  // The same in a child section: a line's read answered after New Order line
  // was pressed and typed into (watched failing: the line opened over the 9).
  test("a child row's read answered after New and typing opens nothing over the child's draft", async () => {
    const words = stamp('child')
    const { order } = await freshOrder(engine, words, [1])
    const holding = holdingRequests(plane.fetch, ({ path }) => path === `/v1/forms/${engine.lines}/records/read`)
    const user = await workspace(holding.fetch, engine.formId)
    await searchRecords(user, words, [order.slice(3)])
    await clickRow(user, 'Records', order.slice(3))
    await answeredOnce('Order line')
    await clickRow(user, 'Order line', '1')
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    await user.click(within(gridSection('Order line')).getByRole('button', { name: 'New Order line' }))
    const quantity = await waitFor(() => within(childPane('New Order line')).getByLabelText(/^Quantity\b/) as HTMLInputElement, ARRIVES)
    await user.type(quantity, '9')

    await holding.pass()
    await settle()
    expect(screen.getByRole('heading', { level: 5, name: 'New Order line' })).toBeTruthy()
    expect((within(childPane('New Order line')).getByLabelText(/^Quantity\b/) as HTMLInputElement).value).toBe('9')
    expect(unsavedNotice()).toBeNull()
  })

  // A form whose definition is refused after the person chose another and
  // started a draft in it: the refusal replaced the other form, draft and
  // all, while Forms and the address still named it (watched failing: main
  // said "Employee" and the refusal, the Order link kept aria-current).
  test("a form's definition refused after another form was chosen changes nothing", async () => {
    const holding = holdingRequests(plane.fetch, ({ method, path }) => method === 'GET' && path === `/v1/forms/${engine.employees}`)
    const user = mount(holding.fetch)
    await signIn(user, TOKENS.clerk)
    await user.click(await formLink(engine.employees))
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    await chooseForm(user, engine.formId)
    await newRecord(user)
    await within(pane('React')).findByRole('combobox', { name: 'Customer' }, ARRIVES)
    await answer(user, 'React', 'Amount', '42')

    await holding.fail()
    await settle()
    expect(screen.getByRole('heading', { level: 2, name: `Order ${engine.formId}` })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(control('React', 'Amount').value).toBe('42')
    expect(within(screen.getByRole('navigation', { name: 'Forms' })).getByRole('link', { name: `Order ${engine.formId}` }).getAttribute('aria-current')).toBe('page')
    // Read from the browser's location: the address is not the page's tree.
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=side-by-side&view=records`)
  })

  // The same refusal, for the form still chosen, is what main says: its
  // heading names the form, and the alert the client's sentence -- the
  // answer dropped above only because another form was chosen (watched
  // failing with every refusal dropped: main went on asking).
  test("a form's definition refused while it is still the one chosen is said in main", async () => {
    const holding = holdingRequests(plane.fetch, ({ method, path }) => method === 'GET' && path === `/v1/forms/${engine.employees}`)
    const user = mount(holding.fetch)
    await signIn(user, TOKENS.clerk)
    await user.click(await formLink(engine.employees))
    await waitFor(() => expect(holding.held).toHaveLength(1), ARRIVES)
    await holding.fail()
    expect((await screen.findByRole('alert', {}, ARRIVES)).textContent).toBe('The data server could not be reached.')
    expect(screen.getByRole('main', { name: `Employee ${engine.employees}` })).toBeTruthy()
    await waitFor(() => expect(focusedName()).toBe(`Employee ${engine.employees}`))
  })
})

describe.each(ENGINES)('a record created in one of two panes on $engine', (engine) => {
  // The detail follows a record created in one pane, so the heading, both
  // panes and the children name one record -- and the other pane's draft is
  // not dropped for it without the question (watched failing: React's
  // create moved the heading on and left Angular's draft under it, and a
  // second create in Angular then dropped a line typed under the first).
  // Kept editing, nothing moves; a pane with nothing typed follows without
  // a question; told to discard, the other pane opens the created record.
  test('asks before the other pane drops a draft, and either answer does what it says', async () => {
    const user = await openForm(plane, engine.formId)
    await chooseCustomer(user, 'React', 'Muster', 'Muster AG')
    await answer(user, 'React', 'Order date', EDGES.orderDate)
    await answer(user, 'React', 'Amount', '3')
    await answer(user, 'Angular', 'Amount', '4')
    await save(user, 'React')
    const first = (await said('React', /^Created record k1:\S+\.$/)).slice('Created record '.length, -1)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    let notice = unsavedNotice() as HTMLElement
    expect(within(notice).getAllByRole('paragraph')[0]?.textContent).toBe(`Opening ${first}, just created in React, closes these forms:`)
    expect(within(notice).getByRole('list').textContent).toBe('New record, Angular: changes that are not saved.')
    await user.click(within(notice).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('heading', { level: 3, name: 'New record' })).toBeTruthy()
    expect(control('Angular', 'Amount').value).toBe('4')
    expect(focusedName()).toBe('Save')

    // Angular's own create: React holds a saved record and nothing typed, so it follows without a question.
    await chooseCustomer(user, 'Angular', 'Muster', 'Muster AG')
    await answer(user, 'Angular', 'Order date', EDGES.orderDate)
    await save(user, 'Angular')
    const second = (await said('Angular', /^Created record k1:\S+\.$/)).slice('Created record '.length, -1)
    await screen.findByRole('heading', { level: 3, name: `Order ${second}` }, ARRIVES)
    expect(unsavedNotice()).toBeNull()
    await shows('React', 'Amount', '4.0000')
    expect(await answeredOnce('Order line')).toBe('No Order line rows.')
    expect(paragraphs(gridSection('Order line'))).toContain(`For Order ${second}`)

    // Two drafts again, and a create in Angular: told to discard, React opens the created record.
    await newRecord(user)
    await shows('React', 'Amount', '')
    await chooseCustomer(user, 'Angular', 'Muster', 'Muster AG')
    await answer(user, 'Angular', 'Order date', EDGES.orderDate)
    await answer(user, 'Angular', 'Amount', '5')
    await answer(user, 'React', 'Amount', '6')
    await save(user, 'Angular')
    const third = (await said('Angular', /^Created record k1:\S+\.$/)).slice('Created record '.length, -1)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull(), ARRIVES)
    notice = unsavedNotice() as HTMLElement
    expect(within(notice).getByRole('list').textContent).toBe('New record, React: changes that are not saved.')
    await user.click(within(notice).getByRole('button', { name: 'Discard and continue' }))
    await screen.findByRole('heading', { level: 3, name: `Order ${third}` }, ARRIVES)
    await shows('React', 'Amount', '5.0000')
  })
})

