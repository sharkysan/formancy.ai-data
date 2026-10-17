import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription as computeDescription } from 'dom-accessibility-api'
import { createDataClient } from '@formancy/data-client'
import { focusedName } from './test-accessible.js'
import { answer, answeredOnce, chooseForm, chooseRenderer, formLink, gridSection, gridStatus, mount, newRecord, rendered, searchRecords, shows, signIn, stamp, unsavedNotice } from './test-host.js'
import type { User } from './test-host.js'
import { EDGES, ENGINES, startPlane, TOKENS } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The workspace (0047) on both engines, against the real server: the Forms
 * menu, the Records grid over `records/list`, opening a row by the
 * keyboard, the address, and the unsaved-changes guard on the record's
 * forms. Children are children.test.tsx's; the grid's keys
 * grid-keys.test.tsx's.
 *
 * Found by role and accessible name (formancy.ai 0034), with one read the
 * accessibility tree cannot answer, said where it is made: the address --
 * `location.hash` and `history.length` -- which is the browser's, not the
 * page's tree.
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

/** The grid named by the Records heading. */
const records = (): HTMLElement => within(gridSection('Records')).getByRole('grid', { name: 'Records' })

/** The Records grid's headers, as their text. */
const headersOf = (): string[] => within(records()).getAllByRole('columnheader').map((header) => header.textContent?.trim() ?? '')

/** The data rows of a grid, each as the text of its cells. */
function rowsOf(grid: HTMLElement): string[][] {
  return within(grid)
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('gridcell').length > 0)
    .map((row) => within(row).getAllByRole('gridcell').map((cell) => cell.textContent ?? ''))
}

/** The row of a grid whose first cell says `first`. */
function row(grid: HTMLElement, first: string): HTMLElement {
  const found = within(grid)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryAllByRole('gridcell')[0]?.textContent === first)
  if (found === undefined) throw new Error(`no row starts with ${first}: ${JSON.stringify(rowsOf(grid))}`)
  return found
}

/** The page signed in as `token`, with `formId` chosen and its Records grid answered. */
async function workspace(formId: string, token: string = TOKENS.clerk): Promise<User> {
  const user = mount(plane.fetch)
  await signIn(user, token)
  await chooseForm(user, formId)
  return user
}

/** A fresh order of `token`'s tenant, for its seeded customer, made beside the page, by its token. */
async function freshOrder(formId: string, notes: string, token: string = TOKENS.clerk): Promise<string> {
  const as = token === TOKENS.clerk ? plane.clerk : createDataClient({ token: () => token, fetch: plane.fetch })
  const definition = await as.form(formId)
  if (!definition.ok) throw new Error(definition.message)
  const name = definition.value.form.model.fields.find((field) => field.key === 'customer')?.optionsSource ?? ''
  const found = await as.query(formId, name, { operation: 'create', search: token === TOKENS.otherClerk ? 'Other Tenant' : 'Muster' })
  if (!found.ok || found.value.rows[0] === undefined) throw new Error('no customer to order for')
  const created = await as.create(formId, { customer: found.value.rows[0].token, order_date: EDGES.orderDate, status: 'placed', amount: '1', notes })
  if (!created.ok || created.value.record === null) throw new Error('the order was not created')
  return created.value.record
}

describe.each(ENGINES)('the workspace on $engine', (engine) => {
  // The menu is the server's: the forms this clerk may read, by title and
  // id, and nothing else. Signing in puts the keyboard on Forms, and
  // choosing a form on its heading, which names main.
  test('lists the forms the person may read, and choosing one puts the keyboard on its heading', async () => {
    const user = mount(plane.fetch)
    await signIn(user, TOKENS.clerk)
    const nav = await screen.findByRole('navigation', { name: 'Forms' }, { timeout: 15_000 })
    await waitFor(() => expect(focusedName()).toBe('Forms'))
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(links).toEqual(expect.arrayContaining([`Order ${engine.formId}`, `Order line ${engine.lines}`, `Employee ${engine.employees}`, `Order ${engine.staff}`]))
    await user.click(await formLink(engine.formId))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: `Order ${engine.formId}` })), { timeout: 15_000 })
    expect(screen.getByRole('main', { name: `Order ${engine.formId}` })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: `Order ${engine.formId}` }).getAttribute('aria-current')).toBe('page')
    expect(within(screen.getByRole('list', { name: 'Operations' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Read', 'Create', 'Update'])
  })

  // Tenant 1's orders, and never tenant 2's: the grid is `records/list`
  // under the clerk's read filter, and the status line says the range. An
  // order of each tenant, noted alike, so a search for the note matches
  // both and each clerk is listed their own.
  test("holds the person's tenant's records only, and says the range", async () => {
    const notes = stamp('tenant')
    const mine = await freshOrder(engine.formId, notes)
    const theirs = await freshOrder(engine.formId, notes, TOKENS.otherClerk)
    const user = await workspace(engine.formId)
    await searchRecords(user, notes, [mine.slice(3)])
    expect(await answeredOnce('Records')).toBe('Rows 1–1.')
    cleanup()
    const other = await workspace(engine.formId, TOKENS.otherClerk)
    await searchRecords(other, notes, [theirs.slice(3)])
  })

  // The page decides which row is open: Space opens it and leaves the
  // keyboard in the grid, Space again on the open row changes nothing --
  // AG Grid's own Space would deselect it -- and Enter moves the keyboard
  // to the record's heading.
  test('Space opens a row and keeps the keyboard in the grid; Enter moves it to the record', async () => {
    const notes = stamp('space')
    const record = await freshOrder(engine.formId, notes)
    const user = await workspace(engine.formId)
    await chooseRenderer(user)
    await searchRecords(user, notes, [record.slice(3)])
    const cell = within(row(records(), record.slice(3))).getAllByRole('gridcell')[0] as HTMLElement
    await user.click(cell)
    await screen.findByRole('heading', { level: 3, name: `Order ${record}` }, { timeout: 15_000 })
    await rendered()
    await shows('React', 'Customer', 'Muster AG')
    const opened = row(records(), record.slice(3))
    await waitFor(() => expect(opened.getAttribute('aria-selected')).toBe('true'))

    within(opened).getAllByRole('gridcell')[1]?.focus()
    await user.keyboard(' ')
    expect(row(records(), record.slice(3)).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 3, name: `Order ${record}` })).toBeTruthy()
    expect(document.activeElement?.getAttribute('role')).toBe('gridcell')

    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${record}`))
  })

  // New record opens both forms empty, with the keyboard on the detail's
  // heading; a draft in them makes another row wait for the person, Keep
  // editing changes nothing and gives the keyboard back to the grid, and
  // Discard and continue opens the row.
  test('asks before another row drops a draft, and either answer does what it says', async () => {
    const notes = stamp('guard')
    const record = await freshOrder(engine.formId, notes)
    const user = await workspace(engine.formId)
    await chooseRenderer(user)
    await searchRecords(user, notes, [record.slice(3)])
    await newRecord(user)
    await rendered()
    await waitFor(() => expect(focusedName()).toBe('New record'))
    await answer(user, 'Angular', 'Amount', '77')
    const cell = within(row(records(), record.slice(3))).getAllByRole('gridcell')[0] as HTMLElement
    await user.click(cell)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull())
    const notice = unsavedNotice() as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(notice))
    expect(within(notice).getByRole('list').textContent).toBe('New record, Angular: changes that are not saved.')

    await user.click(within(notice).getByRole('button', { name: 'Keep editing' }))
    expect(unsavedNotice()).toBeNull()
    await shows('Angular', 'Amount', '77')
    expect(screen.getByRole('heading', { level: 3, name: 'New record' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'))

    await user.click(cell)
    await waitFor(() => expect(unsavedNotice()).not.toBeNull())
    await user.click(within(unsavedNotice() as HTMLElement).getByRole('button', { name: 'Discard and continue' }))
    await screen.findByRole('heading', { level: 3, name: `Order ${record}` }, { timeout: 15_000 })
    await shows('Angular', 'Amount', '1.0000')
    expect(within(screen.getByRole('region', { name: `Order ${record}` })).getAllByRole('status')[0]?.textContent).toBe(`Discarded the unsaved changes. Opened ${record}.`)
  })

  // A search is the person's words, submitted: the hint names the fields it
  // looks in by their labels, the server's `searchable`, and the grid then
  // holds what matches; nothing that matches says so, with the words, and
  // Clear search lists every record again with the keyboard on the box.
  test('searches the fields the hint names, says when nothing matches, and clears', async () => {
    const stamp = `zz${String(Date.now())}`
    const record = await freshOrder(engine.formId, `${stamp} searched`)
    const user = await workspace(engine.formId)
    const definition = await plane.clerk.form(engine.formId)
    if (!definition.ok) throw new Error(definition.message)
    const labels = new Map(definition.value.form.model.fields.map((field) => [field.key, String(field.label)]))
    const names = (definition.value.list?.searchable ?? []).map((key) => labels.get(key))
    const search = screen.getByRole('search', { name: 'Search records' })
    expect(computeDescription(within(search).getByRole('textbox', { name: 'Search' }))).toBe(`Looks in ${names.slice(0, -1).join(', ')} and ${String(names.at(-1))} when you press Search.`)

    await user.type(within(search).getByRole('textbox', { name: 'Search' }), stamp)
    await user.click(within(search).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(rowsOf(records()).map((cells) => cells[0])).toEqual([record.slice(3)]), { timeout: 15_000 })
    expect(await answeredOnce('Records')).toBe('Rows 1–1.')
    const sent = plane.sent.filter((request) => request.path === `/v1/forms/${engine.formId}/records/list`).at(-1)
    expect(JSON.parse(sent?.body ?? '{}')).toMatchObject({ search: stamp, offset: 0, limit: 50 })

    await user.clear(within(search).getByRole('textbox', { name: 'Search' }))
    await user.type(within(search).getByRole('textbox', { name: 'Search' }), `${stamp}nothing`)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe(`No records match “${stamp}nothing”.`), { timeout: 15_000 })
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Clear search' }))
    expect(focusedName()).toBe('Search')
    expect((within(search).getByRole('textbox', { name: 'Search' }) as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(rowsOf(records()).length).toBeGreaterThan(1), { timeout: 15_000 })
  })

  // A sortable header sends its field and direction; the grid shows the
  // server's order, and says so with aria-sort.
  test('sorts by a sortable header, in the server', async () => {
    const user = await workspace(engine.formId)
    const definition = await plane.clerk.form(engine.formId)
    if (!definition.ok) throw new Error(definition.message)
    const sortable = new Set(definition.value.list?.sortable ?? [])
    const date = within(records()).getByRole('columnheader', { name: /Order date/ })
    expect(sortable.has('order_date')).toBe(true)
    await user.click(within(records()).getAllByRole('gridcell')[0] as HTMLElement)
    // From a cell to its header, and Enter: the keyboard's way to sort.
    for (let column = 0; column < headersOf().indexOf('Order date'); column += 1) await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowUp}{Enter}')
    await waitFor(() => expect(date.getAttribute('aria-sort')).toBe('ascending'), { timeout: 15_000 })
    const sent = plane.sent.filter((request) => request.path === `/v1/forms/${engine.formId}/records/list`).at(-1)
    expect(JSON.parse(sent?.body ?? '{}')).toMatchObject({ sort: [{ field: 'order_date', direction: 'asc' }] })
    // A lookup's label is not the server's to sort by: its header has no sort.
    const customer = within(records()).getByRole('columnheader', { name: /Customer/ })
    expect(customer.getAttribute('aria-sort')).toBeNull()
  })

  // Pages of LIST_PAGE_SIZE: Next asks for the next offset and Previous asks
  // for the first page again -- a page no longer shown is never reused --
  // and the line says the range each time.
  test('pages by offset, asks again on Previous, and says the range', async () => {
    const stamp = `pg${String(Date.now())}`
    await plane.db.insertOrders(engine.connection, 53, stamp)
    const user = await workspace(engine.formId)
    const search = screen.getByRole('search', { name: 'Search records' })
    await user.type(within(search).getByRole('textbox', { name: 'Search' }), stamp)
    await user.click(within(search).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe('Rows 1–50; more follow.'), { timeout: 15_000 })
    const previous = within(gridSection('Records')).getByRole('button', { name: 'Previous rows' })
    expect(previous.getAttribute('aria-disabled')).toBe('true')
    const lists = (): Array<Record<string, unknown>> => plane.sent.filter((request) => request.path === `/v1/forms/${engine.formId}/records/list`).map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>)
    const before = lists().length
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Next rows' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe('Rows 51–53.'), { timeout: 15_000 })
    expect(within(gridSection('Records')).getByRole('button', { name: 'Next rows' }).getAttribute('aria-disabled')).toBe('true')
    await user.click(previous)
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe('Rows 1–50; more follow.'), { timeout: 15_000 })
    expect(lists().slice(before).map((body) => body['offset'])).toEqual([50, 0])
  })

  // A list the server refuses is said in its words, never AG Grid's, and
  // Ask again asks for the same page once the database answers.
  test('says a refused list in the server\'s words, and asks again', async () => {
    // The first list request finds its database unreachable, as the real
    // server answers it: the form itself opened, its records did not.
    let refused = false
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), 'http://host.test').pathname
      if (refused || !path.endsWith('/records/list')) return plane.fetch(input, init)
      refused = true
      plane.unreachable.add(engine.connection)
      try {
        return await plane.fetch(input, init)
      } finally {
        plane.unreachable.delete(engine.connection)
      }
    }
    const user = mount(fetch)
    await signIn(user, TOKENS.clerk)
    await user.click(await formLink(engine.formId))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toBe('The database cannot be reached. Nothing was saved.'), { timeout: 15_000 })
    expect(gridSection('Records').textContent).not.toMatch(/Row data is loading|ERR|No Rows To Show|Loading\.\.\./)
    await user.click(within(gridSection('Records')).getByRole('button', { name: 'Ask again' }))
    await waitFor(() => expect(gridStatus('Records')?.textContent).toMatch(/^Rows 1–/), { timeout: 15_000 })
  })

  // Separate views: Enter opens the record view, the address says so, and
  // Back to the records puts the keyboard on the open row's cell -- or, when
  // the row is no longer on the page, on the Records heading, which says so.
  test('opens the record view in Separate views, and Back returns to the row or says it is not on this page', async () => {
    const stamp = `sv${String(Date.now())}`
    const record = await freshOrder(engine.formId, `${stamp} separate`)
    const user = await workspace(engine.formId)
    await user.click(screen.getByRole('radio', { name: 'Separate views' }))
    expect(focusedName()).toBe('Separate views')
    const search = screen.getByRole('search', { name: 'Search records' })
    await user.type(within(search).getByRole('textbox', { name: 'Search' }), stamp)
    await user.click(within(search).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(rowsOf(records()).map((cells) => cells[0])).toEqual([record.slice(3)]), { timeout: 15_000 })
    within(row(records(), record.slice(3))).getAllByRole('gridcell')[0]?.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(focusedName()).toBe(`Order ${record}`), { timeout: 15_000 })
    // The address names the view, not the record (read from the browser's location).
    expect(window.location.hash).toBe(`#form=${engine.formId}&layout=separate&view=record`)
    expect(screen.queryByRole('region', { name: 'Records' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Back to the records' }))
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'))
    expect(document.activeElement?.closest('[role="row"]')).toBe(row(records(), record.slice(3)))

    // The search changed under the open record: its row is not on this page.
    await user.clear(within(search).getByRole('textbox', { name: 'Search' }))
    await user.type(within(search).getByRole('textbox', { name: 'Search' }), `${stamp}x`)
    await user.click(within(search).getByRole('button', { name: 'Search' }))
    await answeredOnce('Records')
    await user.click(screen.getByRole('radio', { name: 'Side by side' }))
    await user.click(screen.getByRole('button', { name: 'Go to its row' }))
    await waitFor(() => expect(focusedName()).toBe('Records'))
    expect(gridStatus('Records')?.textContent).toBe(`Record ${record} is not on this page.`)
  })
})
