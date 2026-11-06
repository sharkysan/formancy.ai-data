import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { createSnapshot, LIST_PAGE_SIZE } from '@formancy/data-core'
import type { BrowseFilterTerm } from '@formancy/data-core'
import {
  applied,
  browseRequests,
  browseStep,
  browsing as browsingOn,
  filterLine,
  grid,
  headerBox,
  lineProblem,
  offered,
  rowsRegion,
  show,
  status,
  statusSays,
  typeFilter,
} from './test-browse.js'
import { audit, focusedName, pressEnter, unnamed } from './test-studio.js'
import { OWNER_SNAPSHOT, startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/*
 * A browsed page's filter typed as a line (0147): `country_code = CH and
 * credit_limit > 125.50`, read by data-core's reader into the browse's
 * `filter` (0104), with each condition a chip and each column a box under
 * its header -- three views of one filter. The keyboard's contract is the
 * host's line's, so these cases are its `filter-line.test.tsx`'s, case for
 * case where a browse has the thing a case is about: no lookup, no cell's
 * `=`, no view and no list nothing matches. Against the real server behind
 * the fake `fetch`, whose records port compares each condition as
 * `RecordFilter` says an adapter does (`test-server.ts`). Every state is
 * held to axe at WCAG 2.2 AA and to a name on every control. Found by role
 * and accessible name (formancy.ai 0034).
 */

let plane: TestPlane

/** Customers with a value of every kind the line offers, a NULL where a column holds them. */
const CUSTOMERS = [
  { tenant_id: '1', customer_no: '1001', name: 'Muster AG', country_code: 'CH', credit_limit: '5000.00', active: true, created_at: '2026-10-01T08:00:00Z' },
  { tenant_id: '1', customer_no: '1002', name: 'Beispiel GmbH', country_code: null, credit_limit: null, active: false, created_at: '2026-10-08T23:59:59Z' },
  {
    tenant_id: '2',
    customer_no: '1001',
    name: 'Other Tenant GmbH',
    country_code: 'CH',
    credit_limit: '125.50',
    active: true,
    created_at: '2026-10-09T00:00:00Z',
  },
]

beforeEach(async () => {
  plane = await startPlane({ browse: true })
  plane.rows.set('sales.customer', CUSTOMERS)
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

const browses = () => browseRequests(plane)
const lastFilter = () => (browses().at(-1)?.body as { filter: BrowseFilterTerm[] } | undefined)?.filter
const alert = () => within(browseStep()).queryByRole('alert')
const names = () => grid().map((row) => row[3])

async function floor(state: string): Promise<{ state: string; axe: string[]; unnamed: string[] }> {
  return { state, axe: await audit(), unnamed: unnamed() }
}
const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })

/** Signed in as a browser, on the customers' first page. */
async function customers() {
  const user = await browsingOn(plane)
  await show(user, 'sales.customer')
  return user
}

const CH: BrowseFilterTerm = { column: 'country_code', op: 'equals', value: 'CH' }
const OVER: BrowseFilterTerm = { column: 'credit_limit', op: 'range', from: '125.50', to: null, exclusive: 'from' }

describe('the filter line', () => {
  // The line is read in the browser into the terms the browse carries: an
  // equality as typed, `>` a range that leaves out its bound (0130). Its
  // words reach the server in the body only, and each condition applied is
  // a chip (watched failing with no line: no combobox named Filter; and
  // with the fake's records port reading no `above`, the tenant whose limit
  // is 125.50 listed too).
  test('applies a typed line as the terms it reads, in the body and in no URL', async () => {
    const user = await customers()
    await typeFilter(user, 'country_code = CH and credit_limit > 125.50')
    await statusSays('Filtered by country_code = CH and credit_limit > 125.50, showing rows 1 to 1.')
    expect(lastFilter()).toEqual([CH, OVER])
    for (const request of browses()) expect(request.path).toBe('/v1/connections/fixture/browse')
    expect(names()).toEqual(['name', 'Muster AG'])
    expect(applied()).toEqual(['country_code = CH', 'credit_limit > 125.50'])
    expect(filterLine().value).toBe('country_code = CH and credit_limit > 125.50')
    expect(document.activeElement).toBe(filterLine())
    expect(await floor('a line applied')).toEqual(CLEAN('a line applied'))
  })

  // A line the page cannot read is said under it, every character typed and
  // the caret kept, and nothing sent: the page stays on its last filter.
  test('says where a line it cannot read fails, keeps it and sends nothing', async () => {
    const user = await customers()
    const before = browses().length
    await typeFilter(user, "credit_limit > 1'000")
    const line = filterLine()
    expect(lineProblem()).toContain('Write numbers with a point and no separators: 1000.')
    expect(line.value).toBe("credit_limit > 1'000")
    expect(line.getAttribute('aria-invalid')).toBe('true')
    expect([line.selectionStart, line.selectionEnd]).toEqual([20, 20])
    expect(browses()).toHaveLength(before)
    expect(status()).toBe('Showing rows 1 to 3.')
    expect(await floor('a line refused')).toEqual(CLEAN('a line refused'))
  })

  // A line the page reads and the server refuses -- a value its column
  // cannot hold -- is said in the step's alert, where every refusal of the
  // server's is, and the line still shows it to correct.
  test('says a refusal of the server’s in the step’s alert, the line kept', async () => {
    const user = await customers()
    await typeFilter(user, 'credit_limit = 1.234')
    expect((await within(browseStep()).findByRole('alert')).textContent).toBe('A value given for credit_limit is not one it can hold.')
    expect(lastFilter()).toEqual([{ column: 'credit_limit', op: 'equals', value: '1.234' }])
    expect(filterLine().value).toBe('credit_limit = 1.234')
    expect(status()).toBe('Showing rows 1 to 3.')
    expect(applied()).toEqual([])
    expect(await floor('a line the server refused')).toEqual(CLEAN('a line the server refused'))
    // Corrected, it is applied, and the alert goes.
    await typeFilter(user, 'credit_limit = 125.50')
    await statusSays('Filtered by credit_limit = 125.50, showing rows 1 to 1.')
    expect(alert()).toBeNull()
  })

  // Completion offers what may come next: a column by its name, picked by
  // the keyboard and followed by a space; then its operators, each with
  // what it means. A column's name and its key are one here, so the name is
  // not said twice.
  test('completes the line from the keyboard', async () => {
    const user = await customers()
    const line = filterLine()
    await user.click(line)
    await user.keyboard('cou')
    expect(offered()).toEqual(['country_code'])
    expect(line.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{ArrowDown}')
    const options = within(browseStep()).getByRole('listbox', { name: 'What may come next' })
    expect(line.getAttribute('aria-activedescendant')).toBe(within(options).getByRole('option').id)
    expect(await floor('completion offered')).toEqual(CLEAN('completion offered'))
    await user.keyboard('{Enter}')
    expect(line.value).toBe('country_code ')
    expect(offered()).toEqual(['= is', 'contains', 'is empty has no value', 'is not empty has a value'])
  })

  // `/` from the table puts the keyboard on the line, and from a text box
  // is the character typed; Esc closes the line's completion, and a second
  // Esc puts back what is applied and gives the keyboard back to the table.
  test('is reached with / and left with Esc', async () => {
    const user = await customers()
    await typeFilter(user, 'country_code = CH')
    await statusSays('Filtered by country_code = CH, showing rows 1 to 2.')
    rowsRegion().focus()
    await user.keyboard('/')
    expect(document.activeElement).toBe(filterLine())
    await user.keyboard(' and a')
    expect(filterLine().getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Escape}')
    expect(filterLine().getAttribute('aria-expanded')).toBe('false')
    expect(filterLine().value).toBe('country_code = CH and a')
    await user.keyboard('{Escape}')
    expect(filterLine().value).toBe('country_code = CH')
    expect(document.activeElement).toBe(rowsRegion())
    const search = within(browseStep()).getByRole<HTMLInputElement>('searchbox', { name: 'Search' })
    await user.type(search, 'a/b')
    expect(search.value).toBe('a/b')
    expect(document.activeElement).toBe(search)
  })
})

describe('the chips', () => {
  // A chip removed asks for what the rest hold, the keyboard on the next
  // chip's Remove; Undo, there until the filter changes again, puts it back
  // where it was, the keyboard on its Remove. The last one removed puts the
  // keyboard on Undo (watched failing with no Undo: the condition was gone
  // for good).
  test('removes a chip on its own, and Undo puts it back', async () => {
    const user = await customers()
    await typeFilter(user, 'active = true and credit_limit >= 100')
    await statusSays('Filtered by active = true and credit_limit from 100, showing rows 1 to 2.')

    await pressEnter(user, within(browseStep()).getByRole('button', { name: 'Remove active = true' }))
    await statusSays('Filtered by credit_limit from 100, showing rows 1 to 2.')
    expect(lastFilter()).toEqual([{ column: 'credit_limit', op: 'range', from: '100', to: null }])
    expect(focusedName()).toBe('Remove credit_limit from 100')
    expect(filterLine().value).toBe('credit_limit >= 100')
    expect(await floor('a chip removed')).toEqual(CLEAN('a chip removed'))

    await pressEnter(user, within(browseStep()).getByRole('button', { name: 'Undo removing active = true' }))
    await statusSays('Filtered by active = true and credit_limit from 100, showing rows 1 to 2.')
    expect(lastFilter()).toEqual([
      { column: 'active', op: 'equals', value: 'true' },
      { column: 'credit_limit', op: 'range', from: '100', to: null },
    ])
    expect(focusedName()).toBe('Remove active = true')
    expect(within(browseStep()).queryByRole('button', { name: /^Undo/ })).toBeNull()

    await pressEnter(user, within(browseStep()).getByRole('button', { name: 'Remove credit_limit from 100' }))
    await statusSays('Filtered by active = true, showing rows 1 to 2.')
    expect(focusedName()).toBe('Remove active = true')
    await pressEnter(user, within(browseStep()).getByRole('button', { name: 'Remove active = true' }))
    await statusSays('Showing rows 1 to 3.')
    expect(focusedName()).toBe('Undo removing active = true')
    expect(within(browseStep()).queryByRole('list', { name: 'Filtered by' })).toBeNull()
  })

  // Clear the filter, and a line emptied and applied, each remove every
  // condition at once and offer Undo, which the keyboard is put on.
  test('clears the filter from its button or an emptied line, and Undo puts it back', async () => {
    const user = await customers()
    await typeFilter(user, 'country_code = CH and credit_limit > 125.50')
    await statusSays('Filtered by country_code = CH and credit_limit > 125.50, showing rows 1 to 1.')
    await pressEnter(user, within(browseStep()).getByRole('button', { name: 'Clear the filter' }))
    await statusSays('Showing rows 1 to 3.')
    expect(lastFilter()).toEqual([])
    expect(focusedName()).toBe('Undo clearing the filter')
    expect(filterLine().value).toBe('')
    expect(await floor('the filter cleared')).toEqual(CLEAN('the filter cleared'))
    await pressEnter(user, within(browseStep()).getByRole('button', { name: 'Undo clearing the filter' }))
    await statusSays('Filtered by country_code = CH and credit_limit > 125.50, showing rows 1 to 1.')
    expect(focusedName()).toBe('Remove country_code = CH')

    await typeFilter(user, '')
    await statusSays('Showing rows 1 to 3.')
    expect(within(browseStep()).getByRole('button', { name: 'Undo clearing the filter' })).toBeTruthy()
  })
})

describe('the header boxes', () => {
  // A column's header box is the line's condition on that column: typed
  // there it is applied as the line would send it, the keyboard staying in
  // it, and the line and the chips say it; a chip removed empties the box
  // (watched failing with no box under the headers).
  test('filters a column from its header’s box, the line and the chips saying it', async () => {
    const user = await customers()
    await typeFilter(user, 'country_code = CH')
    await statusSays('Filtered by country_code = CH, showing rows 1 to 2.')
    await user.type(headerBox('credit_limit'), '> 125.50{Enter}')
    await statusSays('Filtered by country_code = CH and credit_limit > 125.50, showing rows 1 to 1.')
    expect(lastFilter()).toEqual([CH, OVER])
    expect(filterLine().value).toBe('country_code = CH and credit_limit > 125.50')
    expect(applied()).toEqual(['country_code = CH', 'credit_limit > 125.50'])
    expect(headerBox('country_code').value).toBe('= CH')
    expect(headerBox('credit_limit').value).toBe('> 125.50')
    expect(document.activeElement).toBe(headerBox('credit_limit'))
    expect(await floor('a header box applied')).toEqual(CLEAN('a header box applied'))

    await user.click(within(browseStep()).getByRole('button', { name: 'Remove credit_limit > 125.50' }))
    await statusSays('Filtered by country_code = CH, showing rows 1 to 2.')
    expect(headerBox('credit_limit').value).toBe('')
  })

  // A box the line would refuse sends nothing and is said where the step
  // speaks, in its alert; one the server refuses is said there too; and
  // each keeps what was typed. Unsaid, a person would not know why the page
  // did not change.
  test('says a header box’s refusal in the step’s alert, keeping what was typed', async () => {
    const user = await customers()
    const before = browses().length
    await user.type(headerBox('credit_limit'), '1000,50{Enter}')
    await waitFor(() => expect(alert()?.textContent).toBe('Write numbers with a point and no separators: 1000.50.'))
    expect(headerBox('credit_limit').value).toBe('1000,50')
    expect(browses()).toHaveLength(before)
    expect(await floor('a header box refused')).toEqual(CLEAN('a header box refused'))

    await user.clear(headerBox('credit_limit'))
    await user.type(headerBox('credit_limit'), '1.234{Enter}')
    await waitFor(() => expect(alert()?.textContent).toBe('A value given for credit_limit is not one it can hold.'))
    expect(headerBox('credit_limit').value).toBe('1.234')
    expect(status()).toBe('Showing rows 1 to 3.')
  })

  // Esc gives an edit up: the box shows its column's condition again, and
  // leaving it then sends nothing; leaving a box with an edit applies it.
  test('gives an edit up with Esc, and applies one when the box is left', async () => {
    const user = await customers()
    await typeFilter(user, 'country_code = CH')
    await statusSays('Filtered by country_code = CH, showing rows 1 to 2.')
    const before = browses().length
    await user.type(headerBox('country_code'), ' and more')
    await user.keyboard('{Escape}')
    expect(headerBox('country_code').value).toBe('= CH')
    await user.tab()
    expect(browses()).toHaveLength(before)

    await user.type(headerBox('name'), 'gmbh')
    await user.tab()
    await statusSays('Filtered by country_code = CH and name contains “gmbh”, showing rows 1 to 1.')
    expect(focusedName()).toBe('Filter country_code')
  })

  // A boolean holds two values, so its box offers them in a select rather
  // than a box to type a word into; Any is no condition on it.
  test('offers a boolean column’s values in a select', async () => {
    const user = await customers()
    const active = within(rowsRegion()).getByRole<HTMLSelectElement>('combobox', { name: 'Filter active' })
    expect(
      within(active)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Any', 'true', 'false'])
    await user.selectOptions(active, 'false')
    await statusSays('Filtered by active = false, showing rows 1 to 1.')
    expect(lastFilter()).toEqual([{ column: 'active', op: 'equals', value: 'false' }])
    expect(filterLine().value).toBe('active = no')
    expect(applied()).toEqual(['active = false'])
    expect(await floor('a boolean chosen')).toEqual(CLEAN('a boolean chosen'))
    await user.selectOptions(active, 'Any')
    await statusSays('Showing rows 1 to 3.')
    expect(lastFilter()).toEqual([])
  })

  // The line names a column by one word that says it alone (data-core's
  // `nameableFields`): `Local Name` is `local_name`, and its box reads that
  // way; two columns whose names differ only in case read as one, so
  // neither has a box or a name to type, rather than one the line reads as
  // the other. Watched failing with every filterable column given a box,
  // and with data-core's box reader putting the key in front, which left
  // `Local Name`'s box refusing whatever was typed into it.
  test('names a column the line can name by one word, and offers one it cannot nowhere', async () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    const country = contents.objects.find((object) => object.ref.name === 'country')
    const name = country?.columns.find((column) => column.name === 'name')
    if (country === undefined || name === undefined) throw new Error('the snapshot has no country name')
    const added = ['Local Name', 'Code', 'code'].map((column, index) => ({ ...name, name: column, ordinal: country.columns.length + index + 1 }))
    country.columns = [...country.columns, ...added]
    plane.databases.set('fixture', createSnapshot(contents))
    plane.rows.set('sales.country', [
      { id: '1', iso_code: 'CH', name: 'Switzerland', 'Local Name': 'Schweiz', Code: 'A', code: 'b' },
      { id: '2', iso_code: 'DE', name: 'Germany', 'Local Name': 'Deutschland', Code: 'B', code: 'a' },
    ])
    const user = await browsingOn(plane)
    await show(user, 'sales.country')
    expect(within(rowsRegion()).queryByRole('textbox', { name: 'Filter Code' })).toBeNull()
    expect(within(rowsRegion()).queryByRole('textbox', { name: 'Filter code' })).toBeNull()
    await user.type(headerBox('Local Name'), 'schweiz{Enter}')
    await statusSays('Filtered by Local Name contains “schweiz”, showing rows 1 to 1.')
    expect(lastFilter()).toEqual([{ column: 'Local Name', op: 'contains', text: 'schweiz' }])
    expect(filterLine().value).toBe('local_name contains schweiz')
    await typeFilter(user, 'code = a')
    expect(lineProblem()).toContain('No field is called code.')
    await user.clear(filterLine())
    await user.type(filterLine(), 'co')
    expect(filterLine().getAttribute('aria-expanded')).toBe('false')
    expect(within(browseStep()).queryByRole('listbox', { name: 'What may come next' })).toBeNull()
    expect(await floor('a column the line cannot name')).toEqual(CLEAN('a column the line cannot name'))
  })
})

describe('a page on its way', () => {
  // What is typed while the page a line or a box asked for is on its way
  // is the person's: the page arriving shows its filter only where the
  // line or the box still holds what was applied (watched failing with
  // both emptied of what was typed on).
  test('keeps what is typed while the page it asked for is on its way', async () => {
    const user = await customers()
    let held = plane.hold(/\/browse$/)
    await typeFilter(user, 'country_code = CH')
    await user.type(filterLine(), ' and active = true')
    held.release()
    await statusSays('Filtered by country_code = CH, showing rows 1 to 2.')
    expect(filterLine().value).toBe('country_code = CH and active = true')

    held = plane.hold(/\/browse$/)
    await user.type(headerBox('credit_limit'), '> 100{Enter}')
    await user.type(headerBox('credit_limit'), '0')
    held.release()
    await statusSays('Filtered by country_code = CH and credit_limit > 100, showing rows 1 to 2.')
    expect(headerBox('credit_limit').value).toBe('> 1000')
  })
})

describe('a page the line follows', () => {
  // What the line shows, while nobody is editing it, is the filter applied,
  // however it was applied; an edit left in it unapplied is dropped when the
  // filter changes elsewhere, or the line and the chips would say two filters.
  test('shows the filter applied, however it was applied', async () => {
    const user = await customers()
    await user.type(filterLine(), 'name contains x')
    await user.type(headerBox('credit_limit'), '>= 100{Enter}')
    await statusSays('Filtered by credit_limit from 100, showing rows 1 to 2.')
    expect(filterLine().value).toBe('credit_limit >= 100')
    expect(filterLine().getAttribute('aria-invalid')).toBeNull()
    // Typed and not applied, the line says so.
    await user.type(filterLine(), ' and name contains muster')
    expect(within(browseStep()).getByText('Not applied yet: Enter applies it, Esc puts back the filter.')).toBeTruthy()
    expect(browses().at(-1)?.body).toEqual({
      object: { schema: 'sales', name: 'customer' },
      equal: [],
      filter: [{ column: 'credit_limit', op: 'range', from: '100', to: null }],
      search: '',
      sort: [],
      offset: 0,
      limit: LIST_PAGE_SIZE,
    })
  })
})
