import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { createSnapshot, LIST_PAGE_SIZE } from '@formancy/data-core'
import { audit, discover, goTo, signIn, unnamed } from './test-studio.js'
import { OWNER_SNAPSHOT, startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The Browse step (0099): a page of rows of any table or view the
 * discovered connection can see, for a holder of a browse role alone,
 * against the real server behind the fake `fetch`. The plane's records
 * port pages the rows a test puts in by offset and limit; what a database
 * does with the sort and the search the studio sends is the adapter
 * suites' to prove, against real servers (0003), so here the request body
 * is what is held.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane({ browse: true })
  plane.rows.set('sales.country', [
    { id: '1', iso_code: 'CH', name: 'Switzerland' },
    { id: '2', iso_code: 'DE', name: null },
  ])
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

const browseButton = () => within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: /^\d+\. Browse$/ })
const browses = () => plane.requests.filter((request) => request.path.endsWith('/browse'))

/** The grid's rows as the cells' text, the header row first. */
function grid(): string[][] {
  // The grid's own region, named by its caption -- "sales.country, rows 1 to 2" -- beside the section named by its heading.
  const table = within(screen.getByRole('region', { name: /^sales\.[^ ]+, / })).getByRole('table')
  return within(table)
    .getAllByRole('row')
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''))
}

async function show(user: Awaited<ReturnType<typeof signIn>>, object: string, search = ''): Promise<void> {
  const browse = screen.getByRole('main', { name: 'Browse' })
  await user.selectOptions(within(browse).getByLabelText('Table or view'), object)
  const box = within(browse).getByLabelText('Search')
  await user.clear(box)
  if (search !== '') await user.type(box, search)
  await user.click(within(browse).getByRole('button', { name: 'Show rows' }))
  await screen.findByRole('region', { name: new RegExp(`^${object.replace('.', '\\.')},`) })
}

describe('who sees the step', () => {
  // The server refuses the route to an administrator without a browse role; a step that opened anyway would fail on its first press.
  test('an administrator without a browse role sees it listed and waiting for one', async () => {
    await signIn(plane, TOKENS.admin)
    expect(browseButton()).toHaveProperty('disabled', true)
    expect(computeAccessibleDescription(browseButton())).toBe('needs a browse role')
  })

  // Discovery names the tables and views to choose from; before it there is nothing to browse.
  test('a browser sees it wait for a discovery, and open after one', async () => {
    const user = await signIn(plane, TOKENS.browser)
    expect(computeAccessibleDescription(browseButton())).toBe('after a connection is discovered')
    await discover(user)
    expect(browseButton()).toHaveProperty('disabled', false)
  })
})

describe('a page', () => {
  // The object, the columns and what is left out are the server's answer, never the studio's guess from the snapshot: a column it showed that the server did not read would be an empty column that looks like empty data.
  test('shows the rows the server read, says NULL, and names the columns it left out', async () => {
    const user = await signIn(plane, TOKENS.browser)
    await discover(user)
    await goTo(user, 'Browse')
    await show(user, 'sales.country')
    expect(browses()).toEqual([{ method: 'POST', path: '/v1/connections/fixture/browse', body: { object: { schema: 'sales', name: 'country' }, search: '', sort: [], offset: 0, limit: LIST_PAGE_SIZE } }])
    expect(grid()).toEqual([
      ['id', 'iso_code', 'name'],
      ['1', 'CH', 'Switzerland'],
      ['2', 'DE', 'NULL'],
    ])
    const browse = screen.getByRole('main', { name: 'Browse' })
    expect(within(browse).getByRole('status').textContent).toBe('Showing rows 1 to 2.')
    expect(within(browse).getByText(/^Not shown:/).textContent).toBe('Not shown: flag, because it has no text form to show; shape, because it has no text form to show.')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // Fifty rows at a time, the next page asked for by its offset; a press on a button with nothing to do sends nothing, and keeps the keyboard where it was.
  test('pages forward and back, and the last page asks for nothing more', async () => {
    plane.rows.set('sales.employee', Array.from({ length: LIST_PAGE_SIZE + 1 }, (_, index) => ({ id: String(index + 1), name: `E${String(index + 1)}`, manager_id: null })))
    const user = await signIn(plane, TOKENS.browser)
    await discover(user)
    await goTo(user, 'Browse')
    await show(user, 'sales.employee')
    const browse = screen.getByRole('main', { name: 'Browse' })
    expect(within(browse).getByRole('status').textContent).toBe('Showing rows 1 to 50, and more follow.')
    const previous = within(browse).getByRole('button', { name: 'Previous page' })
    expect(previous.getAttribute('aria-disabled')).toBe('true')
    await user.click(within(browse).getByRole('button', { name: 'Next page' }))
    await screen.findByText('Showing rows 51 to 51.')
    expect(browses().map((request) => (request.body as { offset: number }).offset)).toEqual([0, 50])
    const next = within(browse).getByRole('button', { name: 'Next page' })
    expect(next.getAttribute('aria-disabled')).toBe('true')
    next.focus()
    await user.keyboard('{Enter}')
    expect(browses()).toHaveLength(2)
    expect(document.activeElement).toBe(next)
    await user.click(within(browse).getByRole('button', { name: 'Previous page' }))
    await screen.findByText('Showing rows 1 to 50, and more follow.')
    expect(browses().map((request) => (request.body as { offset: number }).offset)).toEqual([0, 50, 0])
  })

  // A header's button sorts by its column, ascending and then descending, from the first page; the header says which order is on screen.
  test('sorts by a column from its header', async () => {
    const user = await signIn(plane, TOKENS.browser)
    await discover(user)
    await goTo(user, 'Browse')
    await show(user, 'sales.country', 'Swi')
    await user.click(screen.getByRole('button', { name: 'name, sort ascending' }))
    await screen.findByRole('button', { name: 'name, sort descending' })
    // The header is named by its column, the button in it by what it does next.
    expect(screen.getByRole('columnheader', { name: 'name' }).getAttribute('aria-sort')).toBe('ascending')
    await user.click(screen.getByRole('button', { name: 'name, sort descending' }))
    await screen.findByRole('button', { name: 'name, sort ascending' })
    expect(browses().map((request) => request.body)).toEqual([
      { object: { schema: 'sales', name: 'country' }, search: 'Swi', sort: [], offset: 0, limit: LIST_PAGE_SIZE },
      { object: { schema: 'sales', name: 'country' }, search: 'Swi', sort: [{ column: 'name', direction: 'asc' }], offset: 0, limit: LIST_PAGE_SIZE },
      { object: { schema: 'sales', name: 'country' }, search: 'Swi', sort: [{ column: 'name', direction: 'desc' }], offset: 0, limit: LIST_PAGE_SIZE },
    ])
    // The plane's port does not search; the status says what was asked for and what came back.
    expect(screen.getByRole('status').textContent).toBe('Matching “Swi”, showing rows 1 to 2.')
  })

  // A view has no key, and paging it by every column can swap two rows that look the same: said on the page, so nobody reads a repeated row as a bug in their data.
  test('a view says what ordering it by every column costs', async () => {
    const user = await signIn(plane, TOKENS.browser)
    await discover(user)
    await goTo(user, 'Browse')
    await show(user, 'sales.customer_summary')
    expect(screen.getByText(/has no key this connection may read/).textContent).toMatch(/^sales\.customer_summary has no key this connection may read, so its rows are ordered by every column shown/)
  })

  // The server discovers again for every page: a table dropped since the studio's discovery is refused in the server's words, not read.
  test("a table the connection no longer sees is the server's refusal", async () => {
    const user = await signIn(plane, TOKENS.browser)
    await discover(user)
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    plane.databases.set('fixture', createSnapshot({ ...contents, objects: contents.objects.filter((object) => object.ref.name !== 'country') }))
    await goTo(user, 'Browse')
    const browse = screen.getByRole('main', { name: 'Browse' })
    await user.selectOptions(within(browse).getByLabelText('Table or view'), 'sales.country')
    await user.click(within(browse).getByRole('button', { name: 'Show rows' }))
    expect((await within(browse).findByRole('alert')).textContent).toBe('sales.country is not a table or view this connection can see.')
  })
})
