import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api'
import { createSnapshot, LIST_PAGE_SIZE } from '@formancy/data-core'
import type { BrowseFilterTerm } from '@formancy/data-core'
import { browseRequests, browseStep, browsing as browsingOn, grid, openRelated, show, status, statusSays } from './test-browse.js'
import type { User } from './test-studio.js'
import { audit, focusedName, paragraphs, pressEnter, unnamed } from './test-studio.js'
import { OWNER_SNAPSHOT, startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * A browsed page's filter (0104): the person's own conditions on the
 * columns the page shows, each one its column offers -- read from the
 * studio's discovery, which says what the page does not, whether a column
 * holds NULLs -- sent as the browse's `filter` and planned again by the
 * server over its own. Against the real server behind the fake `fetch`,
 * whose records port compares each condition as `RecordFilter` says an
 * adapter does (`test-server.ts`); the adapters' comparison is the parity
 * suites' to prove, on both engines, so here what is held is the request
 * body -- exactly the filter the panel set -- and what the page says of it.
 *
 * Every control is found by its role and accessible name; a date input has
 * no role, so it is found by its label, which is its accessible name. The
 * hints the form gives are paragraphs with no name, read by their role.
 */
let plane: TestPlane

/**
 * Customers with a value of every kind the panel offers an input for: text,
 * integer, decimal, boolean and an instant, one of them NULL where the
 * column holds NULLs; the second created a second before midnight, the
 * third at it.
 */
const CUSTOMERS = [
  { tenant_id: '1', customer_no: '1001', name: 'Muster AG', country_code: 'CH', credit_limit: '5000.00', active: true, created_at: '2026-10-01T08:00:00Z' },
  { tenant_id: '1', customer_no: '1002', name: 'Beispiel GmbH', country_code: null, credit_limit: null, active: false, created_at: '2026-10-08T23:59:59Z' },
  { tenant_id: '2', customer_no: '1001', name: 'Other Tenant GmbH', country_code: 'CH', credit_limit: '125.50', active: true, created_at: '2026-10-09T00:00:00Z' },
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

const toggle = () => within(browseStep()).getByRole('button', { name: 'Filter rows' })
const form = () => within(browseStep()).getByRole('form', { name: 'Add a condition' })
const alert = () => within(browseStep()).queryByRole('alert')

/** The options of one of the form's selects, as their text. */
const options = (name: string) =>
  within(within(form()).getByRole('combobox', { name }))
    .getAllByRole('option')
    .map((option) => option.textContent)

/** The page's conditions, as each one's Remove button names it. */
const removes = () =>
  within(within(browseStep()).getByRole('list', { name: 'Filtered by' }))
    .getAllByRole('button')
    .map((button) => computeAccessibleName(button))

/** The panel opened by its button, as a keyboard user opens it. */
async function openPanel(user: User): Promise<void> {
  await pressEnter(user, toggle())
  form()
}

/**
 * A condition added from the open form: the column and the condition
 * chosen, each of `values` -- `Value`, `Text`, `From`, `To` -- typed into
 * the box of that name, or chosen where it is a select, then Apply pressed.
 */
async function addCondition(user: User, column: string, op: string, values: Record<string, string> = {}): Promise<void> {
  const add = form()
  await user.selectOptions(within(add).getByRole('combobox', { name: 'Column' }), column)
  await user.selectOptions(within(add).getByRole('combobox', { name: 'Condition' }), op)
  for (const [name, value] of Object.entries(values)) {
    const control = within(add).getByLabelText(name)
    if (control instanceof HTMLSelectElement) {
      await user.selectOptions(control, value)
      continue
    }
    await user.clear(control)
    if (value !== '') await user.type(control, value)
  }
  await user.click(within(add).getByRole('button', { name: 'Apply' }))
}

/** What a browse of `object` asks for, with the filter and anything else as given. */
function body(object: string, filter: BrowseFilterTerm[], rest: Record<string, unknown> = {}): Record<string, unknown> {
  const [schema, name] = object.split('.')
  return { object: { schema, name }, equal: [], filter, search: '', sort: [], offset: 0, limit: LIST_PAGE_SIZE, ...rest }
}

describe('the panel', () => {
  // A disclosure: shut, it takes no room above the grid; open, the form is right after the button that opened it, and the keyboard stays on that button.
  test('opens from its button by keyboard, and offers each column what its type and NULLs offer', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(within(browseStep()).queryByRole('form', { name: 'Add a condition' })).toBeNull()
    await openPanel(user)
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(toggle())
    // Every column of the customer has a kind that compares, or holds NULLs.
    expect(options('Column')).toEqual(['tenant_id', 'customer_no', 'name', 'country_code', 'credit_limit', 'active', 'created_at'])
    // The first column, an integer that holds no NULL: no condition on NULL is offered, since none could find a row.
    expect(options('Condition')).toEqual(['equals', 'is in a range'])
    expect(within(form()).getByRole('textbox', { name: 'Value' })).toBeTruthy()
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    // Text that holds NULLs: equality is the whole value, exactly, and text of no characters is a value.
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Column' }), 'country_code')
    expect(options('Condition')).toEqual(['equals', 'contains', 'is NULL', 'is not NULL'])
    expect(paragraphs(form())).toEqual(['The whole value, exactly: case and spaces count.'])
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Condition' }), 'is NULL')
    expect(within(form()).queryByRole('textbox')).toBeNull()
    expect(paragraphs(form())).toEqual(['Text of no characters is a value, not NULL.'])

    // A decimal's range: two bounds, both included, either left empty.
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Column' }), 'credit_limit')
    expect(options('Condition')).toEqual(['equals', 'is in a range', 'is NULL', 'is not NULL'])
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Condition' }), 'is in a range')
    expect(within(form()).getByRole('textbox', { name: 'From' })).toBeTruthy()
    expect(within(form()).getByRole('textbox', { name: 'To' })).toBeTruthy()
    expect(paragraphs(form())).toEqual(['From and To are both included, and either may be left empty.'])

    // A boolean is chosen, never typed.
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Column' }), 'active')
    expect(options('Condition')).toEqual(['equals'])
    expect(options('Value')).toEqual(['true', 'false'])

    // An instant's range is whole days, typed as dates, and the form says how they are counted.
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Column' }), 'created_at')
    expect(options('Condition')).toEqual(['is in a range'])
    expect(within(form()).getByLabelText('From')).toHaveProperty('type', 'date')
    expect(within(form()).getByLabelText('To')).toHaveProperty('type', 'date')
    const days = 'created_at is filtered by whole days in UTC: from the start of the day From names to the end of the day To names. Either may be left empty.'
    expect(paragraphs(form())).toEqual([days])
    expect(computeAccessibleDescription(within(form()).getByLabelText('From'))).toBe(days)
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    await pressEnter(user, toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(within(browseStep()).queryByRole('form', { name: 'Add a condition' })).toBeNull()
  })

  // A column that offers nothing -- a time held cut to the minute, NOT NULL -- would be a choice that can only be refused; one that offers only NULL or not, a float, has no box to type into; a timestamp in no zone counts its days as its values are written.
  test('leaves out a column that offers nothing, and offers NULL alone where that is all a column compares', async () => {
    plane.rows.set('sales.shipment', [{ id: '1', tenant_id: '1', tracking_no: '0f8fad5b-d9cb-469f-a165-70867728950e', carrier_code: '7', reference: 'S-1', pickup_time: '08:30', dispatched_at: '2026-10-08T12:00:00.5', weight_kg: 12.5, temperature_c: null }])
    const user = await browsing()
    await show(user, 'sales.shipment')
    await openPanel(user)
    expect(options('Column')).toEqual(['id', 'tenant_id', 'tracking_no', 'carrier_code', 'reference', 'dispatched_at', 'weight_kg', 'temperature_c'])
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Column' }), 'weight_kg')
    expect(options('Condition')).toEqual(['is NULL', 'is not NULL'])
    expect(within(form()).queryByRole('textbox')).toBeNull()
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Column' }), 'tracking_no')
    expect(options('Condition')).toEqual(['equals'])
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Column' }), 'dispatched_at')
    expect(options('Condition')).toEqual(['is in a range', 'is NULL', 'is not NULL'])
    expect(paragraphs(form())).toEqual([
      'dispatched_at holds no time zone, so it is filtered by whole days as its values are written: from the start of the day From names to the end of the day To names. Either may be left empty.',
    ])
    await addCondition(user, 'dispatched_at', 'is in a range', { From: '2026-10-08', To: '2026-10-08' })
    await statusSays('Filtered by dispatched_at from 2026-10-08 to 2026-10-08, showing rows 1 to 1.')
    // The bounds are the days typed; the server makes them midnights.
    expect(lastBody()).toEqual(body('sales.shipment', [{ column: 'dispatched_at', op: 'range', from: '2026-10-08', to: '2026-10-08' }]))
  })

  // A table none of whose columns compares has no filter to offer: a button that opened an empty form would be a control that does nothing.
  test('a page with no column to filter by says so, and has no button', async () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    const employee = contents.objects.find((object) => object.ref.name === 'employee')
    if (employee === undefined) throw new Error('the snapshot has no employee')
    employee.columns = employee.columns.map((column) => ({ ...column, type: { kind: 'time', precision: 0 }, nullable: false }))
    plane.databases.set('fixture', createSnapshot(contents))
    plane.rows.set('sales.employee', [{ id: '08:00', name: '09:00', manager_id: '10:00' }])
    const user = await browsing()
    await show(user, 'sales.employee')
    expect(within(browseStep()).queryByRole('button', { name: 'Filter rows' })).toBeNull()
    expect(within(browseStep()).getByText(/^No column/).textContent).toBe('No column this page shows can be filtered.')
  })
})

describe('applying a condition', () => {
  // Page one, whatever page was on screen, in the order and with the search it had: a filter applied on page two would ask for rows past the end of what it admits.
  test('asks page one with the filter, and the page says it and lists it', async () => {
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
    await openPanel(user)
    await addCondition(user, 'manager_id', 'is not NULL')
    await statusSays('Filtered by manager_id is not NULL, showing rows 1 to 50, and more follow.')
    const sort = [{ column: 'name', direction: 'asc' }]
    expect(lastBody()).toEqual(body('sales.employee', [{ column: 'manager_id', op: 'not-null' }], { sort }))
    expect(removes()).toEqual(['Remove manager_id is not NULL'])
    // The form stays open for the next condition, and no longer offers the column that has one; the keyboard is where it was.
    expect(options('Column')).toEqual(['id', 'name'])
    expect(focusedName()).toBe('Apply')
    // Paging and sorting a filtered page keep the filter.
    await user.click(within(browseStep()).getByRole('button', { name: 'Next page' }))
    await statusSays('Filtered by manager_id is not NULL, showing rows 51 to 51.')
    await user.click(screen.getByRole('button', { name: 'name, sort descending' }))
    await screen.findByRole('button', { name: 'name, sort ascending' })
    expect(browses().slice(-2).map((request) => request.body)).toEqual([
      body('sales.employee', [{ column: 'manager_id', op: 'not-null' }], { sort, offset: LIST_PAGE_SIZE }),
      body('sales.employee', [{ column: 'manager_id', op: 'not-null' }], { sort: [{ column: 'name', direction: 'desc' }] }),
    ])
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // Each value as its input asks: a number trimmed, as the server would trim it, so the page says what was compared; a boolean chosen; NULL with no value; a range of days. Text is never trimmed -- equality is the whole value -- and a value a space would hide is said in quotes.
  test('sends each condition as its column takes it, and every condition must hold', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await openPanel(user)
    await addCondition(user, 'customer_no', 'equals', { Value: ' 1001 ' })
    await statusSays('Filtered by customer_no = 1001, showing rows 1 to 2.')
    expect(lastBody()).toEqual(body('sales.customer', [{ column: 'customer_no', op: 'equals', value: '1001' }]))
    await user.click(within(browseStep()).getByRole('button', { name: 'Clear the filter' }))
    await statusSays('Showing rows 1 to 3.')

    await addCondition(user, 'name', 'equals', { Value: ' Muster AG' })
    await statusSays('Filtered by name = “ Muster AG”, showing no rows.')
    expect(lastBody()).toEqual(body('sales.customer', [{ column: 'name', op: 'equals', value: ' Muster AG' }]))
    await user.click(within(browseStep()).getByRole('button', { name: 'Clear the filter' }))
    await statusSays('Showing rows 1 to 3.')

    await addCondition(user, 'active', 'equals', { Value: 'false' })
    await statusSays('Filtered by active = false, showing rows 1 to 1.')
    await addCondition(user, 'country_code', 'is NULL')
    await statusSays('Filtered by active = false and country_code is NULL, showing rows 1 to 1.')
    await addCondition(user, 'created_at', 'is in a range', { From: '2026-10-01', To: '2026-10-08' })
    await statusSays('Filtered by active = false and country_code is NULL and created_at from 2026-10-01 to 2026-10-08, showing rows 1 to 1.')
    expect(lastBody()).toEqual(
      body('sales.customer', [
        { column: 'active', op: 'equals', value: 'false' },
        { column: 'country_code', op: 'null' },
        { column: 'created_at', op: 'range', from: '2026-10-01', to: '2026-10-08' },
      ]),
    )
    expect(grid().map((row) => row[3])).toEqual(['name', 'Beispiel GmbH'])
    expect(removes()).toEqual(['Remove active = false', 'Remove country_code is NULL', 'Remove created_at from 2026-10-01 to 2026-10-08'])
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // What a search finds, a contains finds: the text trimmed as the search box's is, so the page never says it looked for spaces it did not.
  test('a contains condition is trimmed as a search is, and said in quotes', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await openPanel(user)
    await addCondition(user, 'name', 'contains', { Text: ' gmbh ' })
    await statusSays('Filtered by name contains “gmbh”, showing rows 1 to 2.')
    expect(lastBody()).toEqual(body('sales.customer', [{ column: 'name', op: 'contains', text: 'gmbh' }]))
    expect(grid().map((row) => row[3])).toEqual(['name', 'Beispiel GmbH', 'Other Tenant GmbH'])
  })
})

describe('removing and clearing', () => {
  // Removing a condition removes the button pressed: the keyboard goes to the Remove that takes its place, and after the last one to the button that opens the form, never to the top of the page.
  test('one condition is removed on its own, and the filter cleared, the keyboard kept on the panel', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await openPanel(user)
    await addCondition(user, 'active', 'equals', { Value: 'true' })
    await addCondition(user, 'credit_limit', 'is in a range', { From: '100' })
    await statusSays('Filtered by active = true and credit_limit from 100, showing rows 1 to 2.')
    expect(lastBody()).toEqual(
      body('sales.customer', [
        { column: 'active', op: 'equals', value: 'true' },
        { column: 'credit_limit', op: 'range', from: '100', to: null },
      ]),
    )

    await pressEnter(user, within(browseStep()).getByRole('button', { name: 'Remove active = true' }))
    await statusSays('Filtered by credit_limit from 100, showing rows 1 to 2.')
    expect(lastBody()).toEqual(body('sales.customer', [{ column: 'credit_limit', op: 'range', from: '100', to: null }]))
    expect(focusedName()).toBe('Remove credit_limit from 100')
    // The column is offered again.
    expect(options('Column')).toContain('active')

    await pressEnter(user, within(browseStep()).getByRole('button', { name: 'Remove credit_limit from 100' }))
    await statusSays('Showing rows 1 to 3.')
    expect(focusedName()).toBe('Filter rows')
    expect(within(browseStep()).queryByRole('list', { name: 'Filtered by' })).toBeNull()

    await addCondition(user, 'credit_limit', 'is in a range', { To: '200' })
    await addCondition(user, 'country_code', 'is not NULL')
    await statusSays('Filtered by credit_limit up to 200 and country_code is not NULL, showing rows 1 to 1.')
    await pressEnter(user, within(browseStep()).getByRole('button', { name: 'Clear the filter' }))
    await statusSays('Showing rows 1 to 3.')
    expect(lastBody()).toEqual(body('sales.customer', []))
    expect(focusedName()).toBe('Filter rows')
    expect(within(browseStep()).queryByRole('button', { name: 'Clear the filter' })).toBeNull()
    expect(await audit()).toEqual([])
  })

  // Every column with a condition leaves the form nothing to offer: it says so rather than offering an empty choice, and the keyboard, on Apply until then, goes to the button that opened it.
  test('when every column has a condition, the form says so', async () => {
    plane.rows.set('sales.employee', [
      { id: '1', name: 'Ada', manager_id: null },
      { id: '2', name: 'Grace', manager_id: '1' },
    ])
    const user = await browsing()
    await show(user, 'sales.employee')
    await openPanel(user)
    await addCondition(user, 'id', 'is in a range', { From: '1' })
    await addCondition(user, 'name', 'contains', { Text: 'a' })
    await addCondition(user, 'manager_id', 'is NULL')
    await statusSays('Filtered by id from 1 and name contains “a” and manager_id is NULL, showing rows 1 to 1.')
    expect(within(browseStep()).queryByRole('form', { name: 'Add a condition' })).toBeNull()
    expect(within(browseStep()).getByText(/^Every column/).textContent).toBe('Every column this page can be filtered by has a condition.')
    expect(focusedName()).toBe('Filter rows')
    await user.click(within(browseStep()).getByRole('button', { name: 'Remove name contains “a”' }))
    await statusSays('Filtered by id from 1 and manager_id is NULL, showing rows 1 to 1.')
    expect(options('Column')).toEqual(['name'])
  })
})

describe('a refusal', () => {
  // The server plans every condition again over its own discovery: a value the column cannot hold is its refusal, said in the step's alert as every refusal is, and nothing typed is lost -- the person corrects it rather than typing it again.
  test('is said in the alert, keeps what was typed, and the page as it was', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await openPanel(user)
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Column' }), 'credit_limit')
    // Typed and sent by Enter in the box, as a keyboard user sends it.
    await user.type(within(form()).getByRole('textbox', { name: 'Value' }), '1.234{Enter}')
    expect((await within(browseStep()).findByRole('alert')).textContent).toBe('A value given for credit_limit is not one it can hold.')
    expect(lastBody()).toEqual(body('sales.customer', [{ column: 'credit_limit', op: 'equals', value: '1.234' }]))
    expect(within(form()).getByRole('textbox', { name: 'Value' })).toHaveProperty('value', '1.234')
    expect(within(form()).getByRole('combobox', { name: 'Column' })).toHaveProperty('value', 'credit_limit')
    expect(within(form()).getByRole('combobox', { name: 'Condition' })).toHaveProperty('value', 'equals')
    expect(focusedName()).toBe('Value')
    expect(status()).toBe('Showing rows 1 to 3.')
    expect(within(browseStep()).queryByRole('list', { name: 'Filtered by' })).toBeNull()
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    // A range with neither bound is a malformed body, refused before the server reads the catalog; said the same way.
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Condition' }), 'is in a range')
    await user.click(within(form()).getByRole('button', { name: 'Apply' }))
    await screen.findByText('A range on credit_limit has a from, a to or both.')
    expect(alert()?.textContent).toBe('A range on credit_limit has a from, a to or both.')

    // Corrected, it is applied, and the alert goes.
    await user.type(within(form()).getByRole('textbox', { name: 'From' }), '1.23')
    await user.click(within(form()).getByRole('button', { name: 'Apply' }))
    await statusSays('Filtered by credit_limit from 1.23, showing rows 1 to 2.')
    expect(alert()).toBeNull()
  })
})

describe('the trail of follows', () => {
  // A follow narrows the other end by equal and starts it unfiltered: the page left's conditions name its own columns. Back returns to the page as it was asked, its filter included, as it returns its sort and its search; the followed page's own filter goes with it.
  test('a follow starts unfiltered, and Back returns to the page with its filter', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await openPanel(user)
    await addCondition(user, 'name', 'contains', { Text: 'gmbh' })
    await statusSays('Filtered by name contains “gmbh”, showing rows 1 to 2.')
    const left = lastBody()
    await openRelated(user, 2)
    await user.click(screen.getByRole('button', { name: 'sales.country where iso_code = CH' }))
    await statusSays('Where iso_code = CH, showing rows 1 to 1.')
    expect(lastBody()).toEqual(body('sales.country', [], { equal: [{ column: 'iso_code', value: 'CH' }] }))
    expect(within(browseStep()).queryByRole('list', { name: 'Filtered by' })).toBeNull()
    // The panel starts shut on the page reached.
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    await openPanel(user)
    await addCondition(user, 'name', 'equals', { Value: 'Switzerland' })
    await statusSays('Where iso_code = CH, filtered by name = Switzerland, showing rows 1 to 1.')
    expect(lastBody()).toEqual(body('sales.country', [{ column: 'name', op: 'equals', value: 'Switzerland' }], { equal: [{ column: 'iso_code', value: 'CH' }] }))

    await user.click(screen.getByRole('button', { name: 'Back to sales.customer' }))
    await statusSays('Filtered by name contains “gmbh”, showing rows 1 to 2.')
    expect(lastBody()).toEqual(left)
    expect(removes()).toEqual(['Remove name contains “gmbh”'])
    expect(await audit()).toEqual([])

    // The followed page's filter went with it: followed again, it starts unfiltered.
    await openRelated(user, 2)
    await user.click(screen.getByRole('button', { name: 'sales.country where iso_code = CH' }))
    await statusSays('Where iso_code = CH, showing rows 1 to 1.')
    expect(lastBody()).toEqual(body('sales.country', [], { equal: [{ column: 'iso_code', value: 'CH' }] }))
  })

  // Show rows asks for what its form says -- the object and the search -- as it drops a page's sort; a filter kept under it would narrow a page by conditions nobody can see the form for.
  test('Show rows starts afresh, without the filter', async () => {
    const user = await browsing()
    await show(user, 'sales.customer')
    await openPanel(user)
    await addCondition(user, 'active', 'equals', { Value: 'true' })
    await statusSays('Filtered by active = true, showing rows 1 to 2.')
    await user.click(within(browseStep()).getByRole('button', { name: 'Show rows' }))
    await statusSays('Showing rows 1 to 3.')
    expect(lastBody()).toEqual(body('sales.customer', []))
    expect(within(browseStep()).queryByRole('list', { name: 'Filtered by' })).toBeNull()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })
})

