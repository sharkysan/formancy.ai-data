import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
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
  openRelated,
  rowsRegion,
  show,
  statusSays,
  typeFilter,
} from './test-browse.js'
import type { User } from './test-studio.js'
import { audit, paragraphs, unnamed } from './test-studio.js'
import { OWNER_SNAPSHOT, startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * A browsed page's filter (0104): the person's own conditions on the
 * columns the page shows, each one its column offers -- read from the
 * studio's discovery, which says what the page does not, whether a column
 * holds NULLs -- typed as a line, said as chips, and set in each column's
 * box under its header (0147), sent as the browse's `filter` and planned
 * again by the server over its own. Against the real server behind the
 * fake `fetch`, whose records port compares each condition as
 * `RecordFilter` says an adapter does (`test-server.ts`); the adapters'
 * comparison is the parity suites' to prove, on both engines, so here what
 * is held is the request body -- exactly the filter the line read -- and
 * what the page says of it. The line's keyboard has a suite of its own,
 * `browse-line.test.tsx`.
 *
 * Every control is found by its role and accessible name. The hint a page
 * gives when nothing can be filtered is a paragraph with no name, read by
 * its role.
 */
let plane: TestPlane

/**
 * Customers with a value of every kind the line offers: text, integer,
 * decimal, boolean and an instant, one of them NULL where the column holds
 * NULLs; the second created a second before midnight, the third at it.
 */
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
  plane.rows.set('sales.country', [
    { id: '1', iso_code: 'CH', name: 'Switzerland' },
    { id: '2', iso_code: 'DE', name: 'Germany' },
  ])
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

const browses = () => browseRequests(plane)
const browsing = () => browsingOn(plane)
const lastBody = () => browses().at(-1)?.body

/** What a browse of `object` asks for, with the filter and anything else as given. */
function body(object: string, filter: BrowseFilterTerm[], rest: Record<string, unknown> = {}): Record<string, unknown> {
  const [schema, name] = object.split('.')
  return { object: { schema, name }, equal: [], filter, search: '', sort: [], offset: 0, limit: LIST_PAGE_SIZE, ...rest }
}

/** The names completion offers at an empty line, as a person sees them before typing. */
async function namesOffered(user: User): Promise<string[]> {
  await user.click(filterLine())
  await user.keyboard('{ArrowDown}')
  const names = offered()
  await user.keyboard('{Escape}')
  return names
}

/** What completion offers after `name` and a space: the operators its column offers, each with what it means. */
async function operatorsOf(user: User, name: string): Promise<string[]> {
  await user.clear(filterLine())
  await user.type(filterLine(), `${name} `)
  const operators = offered()
  await user.keyboard('{Escape}{Escape}')
  return operators
}

/** The header boxes the grid's region holds, each by its name: text boxes and selects. */
const boxes = () =>
  [...within(rowsRegion()).queryAllByRole('textbox'), ...within(rowsRegion()).queryAllByRole('combobox')].map((box) => box.getAttribute('aria-label'))

describe('what is offered', () => {
  // The line names every column whose kind compares or that holds NULLs,
  // and offers each the operators its type and NULLs offer; a column's box
  // is a text box, a boolean's a select. An integer that holds no NULL is
  // offered no condition on NULL, since none could find a row.
  test('offers each column what its type and NULLs offer, in the line and in its box', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    expect(await namesOffered(user)).toEqual(['tenant_id', 'customer_no', 'name', 'country_code', 'credit_limit', 'active', 'created_at'])
    expect(await operatorsOf(user, 'tenant_id')).toEqual(['= is', '> is over', '>= is at least', '< is under', '<= is at most'])
    expect(await operatorsOf(user, 'country_code')).toEqual(['= is', 'contains', 'is empty has no value', 'is not empty has a value'])
    expect(await operatorsOf(user, 'credit_limit')).toEqual([
      '= is',
      '> is over',
      '>= is at least',
      '< is under',
      '<= is at most',
      'is empty has no value',
      'is not empty has a value',
    ])
    expect(await operatorsOf(user, 'created_at')).toEqual(['> is after', '>= is on or after', '< is before', '<= is on or before'])
    expect(boxes()).toEqual([
      'Filter tenant_id',
      'Filter customer_no',
      'Filter name',
      'Filter country_code',
      'Filter credit_limit',
      'Filter created_at',
      'Filter active',
    ])
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // A column that offers nothing -- a time held cut to the minute, NOT NULL
  // -- would be a name the server can only refuse, so it has none and no
  // box; one that offers only NULL or not, a float, is offered those; a
  // timestamp in no zone counts its days as its values are written, and
  // its chip says so.
  test('leaves out a column that offers nothing, and offers NULL alone where that is all a column compares', async () => {
    plane.rows.set('sales.shipment', [
      {
        id: '1',
        tenant_id: '1',
        tracking_no: '0f8fad5b-d9cb-469f-a165-70867728950e',
        carrier_code: '7',
        reference: 'S-1',
        pickup_time: '08:30',
        dispatched_at: '2026-10-08T12:00:00.5',
        weight_kg: 12.5,
        temperature_c: null,
      },
    ])
    const user = await browsing()
    await show(user, 'sales.shipment')
    expect(await namesOffered(user)).toEqual(['id', 'tenant_id', 'tracking_no', 'carrier_code', 'reference', 'dispatched_at', 'weight_kg', 'temperature_c'])
    expect(within(rowsRegion()).queryByRole('textbox', { name: 'Filter pickup_time' })).toBeNull()
    expect(await operatorsOf(user, 'weight_kg')).toEqual(['is empty has no value', 'is not empty has a value'])
    expect(await operatorsOf(user, 'tracking_no')).toEqual(['= is'])
    await user.type(headerBox('dispatched_at'), '>= 2026-10-08 and <= 2026-10-08{Enter}')
    await statusSays('Filtered by dispatched_at from 2026-10-08 to 2026-10-08, showing rows 1 to 1.')
    // The bounds are the days typed; the server makes them midnights.
    expect(lastBody()).toEqual(body('sales.shipment', [{ column: 'dispatched_at', op: 'range', from: '2026-10-08', to: '2026-10-08' }]))
    expect(applied()).toEqual(['dispatched_at from 2026-10-08 to 2026-10-08, whole days as stored'])
    await user.type(headerBox('weight_kg'), 'is not empty{Enter}')
    await statusSays('Filtered by dispatched_at from 2026-10-08 to 2026-10-08 and weight_kg is not NULL, showing rows 1 to 1.')
  })

  // A table none of whose columns compares has no filter to offer: a line
  // that could name nothing would be a control that does nothing.
  test('a page with no column to filter by says so, and has no line and no box', async () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    const employee = contents.objects.find((object) => object.ref.name === 'employee')
    if (employee === undefined) throw new Error('the snapshot has no employee')
    employee.columns = employee.columns.map((column) => ({ ...column, type: { kind: 'time', precision: 0 }, nullable: false }))
    plane.databases.set('fixture', createSnapshot(contents))
    plane.rows.set('sales.employee', [{ id: '08:00', name: '09:00', manager_id: '10:00' }])
    const user = await browsing()
    await show(user, 'sales.employee')
    expect(within(browseStep()).queryByRole('combobox', { name: 'Filter' })).toBeNull()
    expect(boxes()).toEqual([])
    expect(paragraphs(browseStep())).toContain('No column this page shows can be filtered.')
  })

  // The server discovers again for every page, so a page can show a column
  // the studio's discovery has not seen: the line cannot tell what it
  // offers, or whether it holds NULLs, and names it not at all rather than
  // guess what the server might refuse.
  test('offers nothing on a column the studio has not discovered', async () => {
    const user = await browsing()
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    const country = contents.objects.find((object) => object.ref.name === 'country')
    const name = country?.columns.find((column) => column.name === 'name')
    if (country === undefined || name === undefined) throw new Error('the snapshot has no country name')
    country.columns = [...country.columns, { ...name, name: 'capital', ordinal: country.columns.length + 1 }]
    plane.databases.set('fixture', createSnapshot(contents))
    plane.rows.set('sales.country', [{ id: '1', iso_code: 'CH', name: 'Switzerland', capital: 'Bern' }])
    await show(user, 'sales.country')
    expect(grid()[0]).toEqual(['Related', 'id', 'iso_code', 'name', 'capital'])
    expect(await namesOffered(user)).toEqual(['id', 'iso_code', 'name'])
    expect(boxes()).toEqual(['Filter id', 'Filter iso_code', 'Filter name'])
    await typeFilter(user, 'capital = Bern')
    expect(lineProblem()).toContain('No field is called capital. Fields: id, iso_code, name.')
  })
})

describe('applying a condition', () => {
  // Page one, whatever page was on screen, in the order it had: a filter
  // applied on page two would ask for rows past the end of what it admits.
  // Paging and sorting a filtered page keep the filter.
  test('asks page one with the filter, and paging and sorting keep it', async () => {
    plane.rows.set('sales.employee', [
      { id: '1', name: 'Ada', manager_id: null },
      ...Array.from({ length: LIST_PAGE_SIZE + 1 }, (_, index) => ({ id: String(index + 2), name: `E${String(index + 2)}`, manager_id: '1' })),
    ])
    const user = await browsing()
    await show(user, 'sales.employee')
    await user.click(screen.getByRole('button', { name: 'name, sort ascending' }))
    await screen.findByRole('button', { name: 'name, sort descending' })
    await user.click(within(browseStep()).getByRole('button', { name: 'Next page' }))
    await statusSays('Showing rows 51 to 52.')
    await typeFilter(user, 'manager_id is not empty')
    await statusSays('Filtered by manager_id is not NULL, showing rows 1 to 50, and more follow.')
    const sort = [{ column: 'name', direction: 'asc' }]
    expect(lastBody()).toEqual(body('sales.employee', [{ column: 'manager_id', op: 'not-null' }], { sort }))
    expect(applied()).toEqual(['manager_id is not NULL'])
    await user.click(within(browseStep()).getByRole('button', { name: 'Next page' }))
    await statusSays('Filtered by manager_id is not NULL, showing rows 51 to 51.')
    await user.click(screen.getByRole('button', { name: 'name, sort descending' }))
    await screen.findByRole('button', { name: 'name, sort ascending' })
    expect(
      browses()
        .slice(-2)
        .map((request) => request.body),
    ).toEqual([
      body('sales.employee', [{ column: 'manager_id', op: 'not-null' }], { sort, offset: LIST_PAGE_SIZE }),
      body('sales.employee', [{ column: 'manager_id', op: 'not-null' }], { sort: [{ column: 'name', direction: 'desc' }] }),
    ])
    expect(filterLine().value).toBe('manager_id is not empty')
    expect(headerBox('manager_id').value).toBe('is not empty')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // Each value as its column takes it: a number as typed, a value quoted to
  // keep the spaces equality compares, a boolean's no as false, NULL with
  // no value, a range of days; and every condition must hold.
  test('sends each condition as its column takes it, and every condition must hold', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await typeFilter(user, 'customer_no = 1001')
    await statusSays('Filtered by customer_no = 1001, showing rows 1 to 2.')
    expect(lastBody()).toEqual(body('sales.customer', [{ column: 'customer_no', op: 'equals', value: '1001' }]))

    await typeFilter(user, 'name = " Muster AG"')
    await statusSays('Filtered by name = “ Muster AG”, showing no rows.')
    expect(lastBody()).toEqual(body('sales.customer', [{ column: 'name', op: 'equals', value: ' Muster AG' }]))

    await typeFilter(user, 'active = no and country_code is empty and created_at >= 2026-10-01 and created_at <= 2026-10-08')
    await statusSays('Filtered by active = false and country_code is NULL and created_at from 2026-10-01 to 2026-10-08, showing rows 1 to 1.')
    expect(lastBody()).toEqual(
      body('sales.customer', [
        { column: 'active', op: 'equals', value: 'false' },
        { column: 'country_code', op: 'null' },
        { column: 'created_at', op: 'range', from: '2026-10-01', to: '2026-10-08' },
      ]),
    )
    expect(grid().map((row) => row[3])).toEqual(['name', 'Beispiel GmbH'])
    expect(applied()).toEqual(['active = false', 'country_code is NULL', 'created_at from 2026-10-01 to 2026-10-08, whole days in UTC'])
    expect(within(rowsRegion()).getByRole<HTMLSelectElement>('combobox', { name: 'Filter active' }).value).toBe('false')
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // A range of days runs from the first day's midnight to the last day's
  // end, and not into the next: a row a second before the next midnight is
  // in, one at it is out, and one at a first day's midnight is in; after a
  // day is from the next day's midnight. The fake compares the server's
  // midnights as `RecordFilter` says the adapters do; one that admitted the
  // next midnight, or not the first, would show a page no adapter returns.
  test('a range of days on an instant ends at the last day’s end, and starts at the first day’s midnight', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await typeFilter(user, 'created_at >= 2026-10-08 and created_at <= 2026-10-08')
    await statusSays('Filtered by created_at from 2026-10-08 to 2026-10-08, showing rows 1 to 1.')
    expect(grid().map((row) => row[3])).toEqual(['name', 'Beispiel GmbH'])
    await typeFilter(user, 'created_at > 2026-10-08')
    await statusSays('Filtered by created_at > 2026-10-08, showing rows 1 to 1.')
    expect(lastBody()).toEqual(body('sales.customer', [{ column: 'created_at', op: 'range', from: '2026-10-08', to: null, exclusive: 'from' }]))
    expect(grid().map((row) => row[3])).toEqual(['name', 'Other Tenant GmbH'])
    expect(applied()).toEqual(['created_at > 2026-10-08, whole days in UTC'])
  })

  // What a search finds, a contains finds: a bare word in a text column's
  // box is found anywhere in it, said in quotes, and the box shows it back
  // bare.
  test('a bare word in a text column’s box is a contains, said in quotes', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await user.type(headerBox('name'), 'gmbh{Enter}')
    await statusSays('Filtered by name contains “gmbh”, showing rows 1 to 2.')
    expect(lastBody()).toEqual(body('sales.customer', [{ column: 'name', op: 'contains', text: 'gmbh' }]))
    expect(grid().map((row) => row[3])).toEqual(['name', 'Beispiel GmbH', 'Other Tenant GmbH'])
    expect(headerBox('name').value).toBe('gmbh')
    expect(filterLine().value).toBe('name contains gmbh')
  })
})

describe('the trail of follows', () => {
  // A follow narrows the other end by equal and starts it unfiltered: the
  // page left's conditions name its own columns. Back returns to the page as
  // it was asked, its filter included, in the line, the chips and the boxes,
  // as it returns its sort and its search; the followed page's own filter
  // goes with it, and so does an Undo, which belonged to the page left.
  test('a follow starts unfiltered, and Back returns to the page with its filter', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await typeFilter(user, 'name contains gmbh and active = yes')
    await statusSays('Filtered by name contains “gmbh” and active = true, showing rows 1 to 1.')
    await user.click(within(browseStep()).getByRole('button', { name: 'Remove active = true' }))
    await statusSays('Filtered by name contains “gmbh”, showing rows 1 to 2.')
    const left = lastBody()
    await openRelated(user, 2)
    await user.click(screen.getByRole('button', { name: 'sales.country where iso_code = CH' }))
    await statusSays('Where iso_code = CH, showing rows 1 to 1.')
    expect(lastBody()).toEqual(body('sales.country', [], { equal: [{ column: 'iso_code', value: 'CH' }] }))
    expect(applied()).toEqual([])
    expect(filterLine().value).toBe('')
    expect(headerBox('name').value).toBe('')
    expect(within(browseStep()).queryByRole('button', { name: /^Undo/ })).toBeNull()

    await user.type(headerBox('name'), '= Switzerland{Enter}')
    await statusSays('Where iso_code = CH, filtered by name = Switzerland, showing rows 1 to 1.')
    expect(lastBody()).toEqual(
      body('sales.country', [{ column: 'name', op: 'equals', value: 'Switzerland' }], { equal: [{ column: 'iso_code', value: 'CH' }] }),
    )

    await user.click(screen.getByRole('button', { name: 'Back to sales.customer' }))
    await statusSays('Filtered by name contains “gmbh”, showing rows 1 to 2.')
    expect(lastBody()).toEqual(left)
    expect(applied()).toEqual(['name contains “gmbh”'])
    expect(filterLine().value).toBe('name contains gmbh')
    expect(headerBox('name').value).toBe('gmbh')
    expect(within(browseStep()).queryByRole('button', { name: /^Undo/ })).toBeNull()
    expect(await audit()).toEqual([])

    // The followed page's filter went with it: followed again, it starts unfiltered.
    await openRelated(user, 2)
    await user.click(screen.getByRole('button', { name: 'sales.country where iso_code = CH' }))
    await statusSays('Where iso_code = CH, showing rows 1 to 1.')
    expect(lastBody()).toEqual(body('sales.country', [], { equal: [{ column: 'iso_code', value: 'CH' }] }))
  })

  // Show rows asks for what its form says -- the object and the search --
  // as it drops a page's sort; a filter kept under it would narrow a page by
  // conditions nobody asked for there.
  test('Show rows starts afresh, without the filter', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await typeFilter(user, 'active = true')
    await statusSays('Filtered by active = true, showing rows 1 to 2.')
    await user.click(within(browseStep()).getByRole('button', { name: 'Clear the filter' }))
    await statusSays('Showing rows 1 to 3.')
    await typeFilter(user, 'active = true')
    await statusSays('Filtered by active = true, showing rows 1 to 2.')
    await user.click(within(browseStep()).getByRole('button', { name: 'Show rows' }))
    await statusSays('Showing rows 1 to 3.')
    expect(lastBody()).toEqual(body('sales.customer', []))
    expect(applied()).toEqual([])
    expect(filterLine().value).toBe('')
    expect(within(browseStep()).queryByRole('button', { name: /^Undo/ })).toBeNull()
  })
})
