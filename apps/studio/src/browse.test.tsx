import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { createSnapshot, LIST_PAGE_SIZE } from '@formancy/data-core'
import type { MetadataSnapshot } from '@formancy/data-core'
import { browseRequests, browseStep, browsing as browsingOn, chosen, entries, grid, openRelated, pageHeading, show, status, statusSays } from './test-browse.js'
import { audit, discover, goTo, signIn, unnamed } from './test-studio.js'
import { OWNER_SNAPSHOT, startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * The Browse step (0099): a page of rows of any table or view the
 * discovered connection can see, for a holder of a browse role alone,
 * against the real server behind the fake `fetch`. The plane's records
 * port narrows the rows a test puts in by the request's equal values and
 * filter, and pages them by offset and limit; what a database does with
 * the sort and the search the studio sends is the adapter suites' to
 * prove, against real servers (0003), so here the request body is what is
 * held. The filter has a suite of its own, `browse-filter.test.tsx` (0104).
 *
 * A row's foreign keys are followed either way (0103): to the row it
 * refers to, and to the rows that refer to it, each a browse of the other
 * end narrowed to the row's values, with the way back to the page left.
 *
 * The status line is found by its role. The hints a page gives -- what it
 * leaves out, how it is ordered, the keys it cannot follow, what discovery
 * could not tell -- are paragraphs with no role and no name, so those
 * tests read their text: the accessibility tree has nothing to find them by.
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
const browses = () => browseRequests(plane)
const browsing = () => browsingOn(plane)

/**
 * Rows to follow either way: a customer refers to its country and is
 * referred to by its orders, and an order refers to the employees who
 * created and approved it -- the second one approved by nobody yet.
 */
function relatedRows(): void {
  plane.rows.set('sales.customer', [
    { tenant_id: '1', customer_no: '1001', name: 'Muster AG', country_code: 'CH' },
    { tenant_id: '1', customer_no: '1002', name: 'Beispiel GmbH', country_code: 'DE' },
    { tenant_id: '2', customer_no: '1001', name: 'Other Tenant GmbH', country_code: 'CH' },
  ])
  plane.rows.set('sales.order', [
    { id: '7', tenant_id: '1', customer_no: '1001', status: 'placed', created_by: '1', approved_by: null },
    { id: '8', tenant_id: '1', customer_no: '1001', status: 'shipped', created_by: '1', approved_by: '2' },
    { id: '9', tenant_id: '2', customer_no: '1001', status: 'placed', created_by: '2', approved_by: null },
  ])
  plane.rows.set('sales.employee', [
    { id: '1', name: 'Ada', manager_id: null },
    { id: '2', name: 'Grace', manager_id: '1' },
  ])
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
    const user = await browsing()
    await show(user, 'sales.country')
    expect(browses()).toEqual([
      {
        method: 'POST',
        path: '/v1/connections/fixture/browse',
        body: { object: { schema: 'sales', name: 'country' }, equal: [], filter: [], search: '', sort: [], offset: 0, limit: LIST_PAGE_SIZE },
      },
    ])
    expect(grid()).toEqual([
      ['Related', 'id', 'iso_code', 'name'],
      ['Related', '1', 'CH', 'Switzerland'],
      ['Related', '2', 'DE', 'NULL'],
    ])
    expect(status()).toBe('Showing rows 1 to 2.')
    expect(within(browseStep()).getByText(/^Not shown:/).textContent).toBe(
      'Not shown: flag, because it has no text form to show; shape, because it has no text form to show.',
    )
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // Fifty rows at a time, the next page asked for by its offset; a press on a button with nothing to do sends nothing, and keeps the keyboard where it was.
  test('pages forward and back, and the last page asks for nothing more', async () => {
    plane.rows.set(
      'sales.employee',
      Array.from({ length: LIST_PAGE_SIZE + 1 }, (_, index) => ({ id: String(index + 1), name: `E${String(index + 1)}`, manager_id: null })),
    )
    const user = await browsing()
    await show(user, 'sales.employee')
    const browse = browseStep()
    expect(status()).toBe('Showing rows 1 to 50, and more follow.')
    const previous = within(browse).getByRole('button', { name: 'Previous page' })
    expect(previous.getAttribute('aria-disabled')).toBe('true')
    await user.click(within(browse).getByRole('button', { name: 'Next page' }))
    await statusSays('Showing rows 51 to 51.')
    expect(browses().map((request) => (request.body as { offset: number }).offset)).toEqual([0, 50])
    const next = within(browse).getByRole('button', { name: 'Next page' })
    expect(next.getAttribute('aria-disabled')).toBe('true')
    next.focus()
    await user.keyboard('{Enter}')
    expect(browses()).toHaveLength(2)
    expect(document.activeElement).toBe(next)
    await user.click(within(browse).getByRole('button', { name: 'Previous page' }))
    await statusSays('Showing rows 1 to 50, and more follow.')
    expect(browses().map((request) => (request.body as { offset: number }).offset)).toEqual([0, 50, 0])
  })

  // A header's button sorts by its column, ascending and then descending, from the first page; the header says which order is on screen.
  test('sorts by a column from its header', async () => {
    const user = await browsing()
    await show(user, 'sales.country', 'Swi')
    await user.click(screen.getByRole('button', { name: 'name, sort ascending' }))
    await screen.findByRole('button', { name: 'name, sort descending' })
    // The header is named by its column, the button in it by what it does next.
    expect(screen.getByRole('columnheader', { name: 'name' }).getAttribute('aria-sort')).toBe('ascending')
    await user.click(screen.getByRole('button', { name: 'name, sort descending' }))
    await screen.findByRole('button', { name: 'name, sort ascending' })
    expect(browses().map((request) => request.body)).toEqual([
      { object: { schema: 'sales', name: 'country' }, equal: [], filter: [], search: 'Swi', sort: [], offset: 0, limit: LIST_PAGE_SIZE },
      {
        object: { schema: 'sales', name: 'country' },
        equal: [],
        filter: [],
        search: 'Swi',
        sort: [{ column: 'name', direction: 'asc' }],
        offset: 0,
        limit: LIST_PAGE_SIZE,
      },
      {
        object: { schema: 'sales', name: 'country' },
        equal: [],
        filter: [],
        search: 'Swi',
        sort: [{ column: 'name', direction: 'desc' }],
        offset: 0,
        limit: LIST_PAGE_SIZE,
      },
    ])
    // The plane's port does not search; the status says what was asked for and what came back.
    expect(status()).toBe('Matching “Swi”, showing rows 1 to 2.')
  })

  // A view has no key, and paging it by every column can swap two rows that look the same: said on the page, so nobody reads a repeated row as a bug in their data.
  test('a view says what ordering it by every column costs', async () => {
    const user = await browsing()
    await show(user, 'sales.customer_summary')
    expect(screen.getByText(/has no key this connection may read/).textContent).toMatch(
      /^sales\.customer_summary has no key this connection may read, so its rows are ordered by every column shown/,
    )
  })

  // The server discovers again for every page: a table dropped since the studio's discovery is refused in the server's words, not read.
  test("a table the connection no longer sees is the server's refusal", async () => {
    const user = await signIn(plane, TOKENS.browser)
    await discover(user)
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    plane.databases.set('fixture', createSnapshot({ ...contents, objects: contents.objects.filter((object) => object.ref.name !== 'country') }))
    await goTo(user, 'Browse')
    const browse = browseStep()
    await user.selectOptions(within(browse).getByLabelText('Table or view'), 'sales.country')
    await user.click(within(browse).getByRole('button', { name: 'Show rows' }))
    expect((await within(browse).findByRole('alert')).textContent).toBe('sales.country is not a table or view this connection can see.')
  })
})

/**
 * The order's keys as a connection that cannot follow most of them sees
 * them (0103): the approver's table hidden from it, the creator's column
 * one it may not read, a key to a table outside the approved schemas and
 * one from such a table, and the tables that refer to the order perhaps
 * not all listed -- each as discovery says it, gaps included (0004).
 */
function withUnfollowedKeys(): MetadataSnapshot {
  const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
  const order = contents.objects.find((object) => object.ref.name === 'order')
  if (order === undefined) throw new Error('the snapshot has no order')
  order.columns = order.columns.map((column) => (column.name === 'created_by' ? { ...column, access: { ...column.access, select: false } } : column))
  order.foreignKeys = [
    ...order.foreignKeys.map((key) => (key.name === 'fk_order_approved_by' ? { ...key, references: null } : key)),
    {
      name: 'fk_order_group',
      columns: ['group'],
      references: { table: { schema: 'geo', name: 'region' }, columns: ['code'] },
      onUpdate: 'no-action',
      onDelete: 'no-action',
      enforced: true,
      validated: true,
    },
  ]
  order.referencedBy = [
    ...(order.referencedBy ?? []),
    {
      table: { schema: 'audit', name: 'trail' },
      name: 'fk_trail_order',
      columns: ['order_id'],
      referencedColumns: ['id'],
      onDelete: 'no-action',
      onUpdate: 'no-action',
      enforced: true,
    },
  ]
  // What the approver's key refers to is hidden, so nothing on the other side says the key refers to it.
  for (const object of contents.objects) {
    if (object.referencedBy !== undefined) object.referencedBy = object.referencedBy.filter((key) => key.name !== 'fk_order_approved_by')
  }
  return createSnapshot({
    ...contents,
    gaps: [
      ...contents.gaps,
      { subject: { kind: 'object', object: order.ref }, aspect: 'foreign-keys', detail: 'fk_order_approved_by references a table this account cannot see' },
      { subject: { kind: 'object', object: order.ref }, aspect: 'referenced-by', detail: 'a key on a table this account cannot see may refer to sales.order' },
    ],
  })
}

describe("a row's related rows", () => {
  // A Related button on a table with no key either way would open a section offering nothing; one missing where a key exists hides the way to the rows it names.
  test('a table with no foreign key either way has no Related column, and one with a key has one', async () => {
    plane.rows.set('sales.shipment', [{ id: '1', tenant_id: '1', reference: 'S-1' }])
    const user = await browsing()
    await show(user, 'sales.shipment')
    expect(screen.queryByRole('columnheader', { name: 'Related' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Related to row/ })).toBeNull()
    await show(user, 'sales.country')
    expect(screen.getByRole('columnheader', { name: 'Related' })).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Related to row 1' })
    // Its visible word starts its name, so a person who says what they see is heard (WCAG 2.5.3).
    expect(button.textContent).toBe('Related')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // A country refers to nothing: no empty list headed "It refers to" stands above what refers to it.
    await openRelated(user, 1)
    expect(screen.queryByRole('list', { name: 'It refers to' })).toBeNull()
    expect(entries('Rows that refer to it')).toEqual(['sales.customer where country_code = CH'])
  })

  // What a row refers to and what refers to it, said with the row's own values, so a person sees where a follow goes before it is taken; one row's section at a time, moved by another row's button and closed by its own.
  test('opens below the table with what the row refers to and what refers to it, one row at a time', async () => {
    relatedRows()
    const user = await browsing()
    await show(user, 'sales.customer')
    const related = await openRelated(user, 1)
    expect(document.activeElement).toBe(within(related).getByRole('heading', { level: 4, name: 'Related to row 1 of sales.customer' }))
    expect(screen.getByRole('button', { name: 'Related to row 1' }).getAttribute('aria-expanded')).toBe('true')
    expect(entries('It refers to')).toEqual(['sales.country where iso_code = CH'])
    expect(entries('Rows that refer to it')).toEqual(['sales.order where tenant_id = 1 and customer_no = 1001'])
    // Every key of the customer is followed, and discovery listed every key referring to it.
    expect(within(browseStep()).queryByText(/^Not followed/)).toBeNull()
    expect(within(browseStep()).queryByText(/may not see every table/)).toBeNull()
    // Nothing is asked of the server until a follow is pressed.
    expect(browses()).toHaveLength(1)
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])

    await openRelated(user, 2)
    expect(screen.getAllByRole('region', { name: /^Related to row / })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Related to row 1' }).getAttribute('aria-expanded')).toBe('false')
    expect(entries('It refers to')).toEqual(['sales.country where iso_code = DE'])
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 4, name: 'Related to row 2 of sales.customer' }))

    await user.click(screen.getByRole('button', { name: 'Related to row 2' }))
    expect(screen.queryByRole('region', { name: /^Related to row / })).toBeNull()
    expect(screen.getByRole('button', { name: 'Related to row 2' }).getAttribute('aria-expanded')).toBe('false')
  })

  // A key with a NULL in it refers to no row on either engine (MATCH SIMPLE): a follow from it would find the rows that merely share its other columns, so it is said and not offered.
  test('a key with a NULL in it is said to follow to no row, and is no button', async () => {
    relatedRows()
    plane.rows.set('sales.order', [
      { id: '7', tenant_id: '1', customer_no: '1001', created_by: '1', approved_by: null },
      { id: '10', tenant_id: null, customer_no: null, created_by: '1', approved_by: '2' },
    ])
    const user = await browsing()
    await show(user, 'sales.order')
    await openRelated(user, 1)
    expect(entries('It refers to')).toEqual([
      'fk_order_approved_by: approved_by is NULL, so it follows to no row.',
      'sales.employee where id = 1',
      'sales.customer where tenant_id = 1 and customer_no = 1001',
    ])
    expect(
      within(screen.getByRole('list', { name: 'It refers to' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['sales.employee where id = 1', 'sales.customer where tenant_id = 1 and customer_no = 1001'])
    expect(await audit()).toEqual([])
    // Every column of a composite key NULL is named.
    await openRelated(user, 2)
    expect(entries('It refers to')).toContain('fk_order_customer: tenant_id and customer_no are NULL, so it follows to no row.')
  })

  // A key the studio does not offer is named with the reason, and a list of the keys referring to the table that discovery could not finish says so, so "nothing refers to it" is never read from a list that could not tell (0004). Both are the table's, said on its page, not a row's.
  test('names the keys it cannot follow and why, and says when what refers to it may be incomplete', async () => {
    relatedRows()
    plane.databases.set('fixture', withUnfollowedKeys())
    const user = await browsing()
    await show(user, 'sales.order')
    const notFollowed =
      'Not followed: fk_order_approved_by, which refers to a table this connection cannot see; fk_order_created_by, whose columns this connection may not read or a browse cannot narrow by; fk_order_group to geo.region, which is outside the approved schemas; fk_trail_order from audit.trail, which is outside the approved schemas.'
    expect(within(browseStep()).getByText(/^Not followed:/).textContent).toBe(notFollowed)
    expect(within(browseStep()).getByText(/may not see every table/).textContent).toBe('This connection may not see every table that refers to sales.order.')
    const related = await openRelated(user, 1)
    expect(entries('It refers to')).toEqual(['sales.customer where tenant_id = 1 and customer_no = 1001'])
    expect(entries('Rows that refer to it')).toEqual(['sales.delivery where order_id = 7', 'sales.order_line where order_id = 7'])
    expect(within(related).queryByText(/^Not followed:/)).toBeNull()
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // A table none of whose keys can be followed has no Related column: without the hints, the missing column would read as "nothing relates to this table".
  test('a table with no key it can follow still names the keys it cannot', async () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    const shipment = contents.objects.find((object) => object.ref.name === 'shipment')
    if (shipment === undefined) throw new Error('the snapshot has no shipment')
    shipment.foreignKeys = [
      ...shipment.foreignKeys,
      {
        name: 'fk_shipment_region',
        columns: ['reference'],
        references: { table: { schema: 'geo', name: 'region' }, columns: ['code'] },
        onUpdate: 'no-action',
        onDelete: 'no-action',
        enforced: true,
        validated: true,
      },
    ]
    plane.databases.set(
      'fixture',
      createSnapshot({
        ...contents,
        gaps: [
          ...contents.gaps,
          {
            subject: { kind: 'object', object: shipment.ref },
            aspect: 'referenced-by',
            detail: 'a key on a table this account cannot see may refer to sales.shipment',
          },
        ],
      }),
    )
    plane.rows.set('sales.shipment', [{ id: '1', tenant_id: '1', reference: 'S-1' }])
    const user = await browsing()
    await show(user, 'sales.shipment')
    expect(screen.queryByRole('columnheader', { name: 'Related' })).toBeNull()
    expect(within(browseStep()).getByText(/^Not followed:/).textContent).toBe(
      'Not followed: fk_shipment_region to geo.region, which is outside the approved schemas.',
    )
    expect(within(browseStep()).getByText(/may not see every table/).textContent).toBe('This connection may not see every table that refers to sales.shipment.')
  })

  // An empty text key is a value, not a missing one: printed bare, the button would read "where iso_code = " and the page could not say what it was narrowed to.
  test('a value that bare could not be read is quoted', async () => {
    relatedRows()
    plane.rows.set('sales.customer', [{ tenant_id: '1', customer_no: '1001', name: 'Muster AG', country_code: '' }])
    const user = await browsing()
    await show(user, 'sales.customer')
    await openRelated(user, 1)
    expect(entries('It refers to')).toEqual(['sales.country where iso_code = “”'])
  })

  // The server discovers again for every page, so a column the studio's older discovery offered a key through can be missing from the page: said as missing, never as a NULL the row does not hold.
  test('a key whose column the page does not hold is said as missing, not NULL', async () => {
    relatedRows()
    const user = await browsing()
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    const customer = contents.objects.find((object) => object.ref.name === 'customer')
    if (customer === undefined) throw new Error('the snapshot has no customer')
    customer.columns = customer.columns.map((column) => (column.name === 'country_code' ? { ...column, access: { ...column.access, select: false } } : column))
    plane.databases.set('fixture', createSnapshot(contents))
    await show(user, 'sales.customer')
    await openRelated(user, 1)
    expect(entries('It refers to')).toEqual(['fk_customer_country: country_code is not on this page, so it cannot be followed.'])
  })
})

describe('following a foreign key', () => {
  // A follow is a browse of the other end narrowed to the row's values (0103): the request carries them, the page says them, the selector names what is on screen, and the keyboard lands on the page it reached.
  test('to the row it refers to', async () => {
    relatedRows()
    const user = await browsing()
    await show(user, 'sales.customer')
    await openRelated(user, 1)
    await user.click(screen.getByRole('button', { name: 'sales.country where iso_code = CH' }))
    await screen.findByRole('region', { name: /^sales\.country, / })
    expect(browses().at(-1)?.body).toEqual({
      object: { schema: 'sales', name: 'country' },
      equal: [{ column: 'iso_code', value: 'CH' }],
      filter: [],
      search: '',
      sort: [],
      offset: 0,
      limit: LIST_PAGE_SIZE,
    })
    expect(grid()).toEqual([
      ['Related', 'id', 'iso_code', 'name'],
      ['Related', '1', 'CH', 'Switzerland'],
    ])
    expect(status()).toBe('Where iso_code = CH, showing rows 1 to 1.')
    expect(chosen()).toBe('sales.country')
    expect(document.activeElement).toBe(pageHeading('sales.country table'))
    expect(within(browseStep()).getByRole('button', { name: 'Back to sales.customer' })).toBeTruthy()
    // The page it left had the section open; the new page starts closed.
    expect(screen.queryByRole('region', { name: /^Related to row / })).toBeNull()
    expect(await audit()).toEqual([])
    expect(unnamed()).toEqual([])
  })

  // The other way, twice deep, and Back the same way: each Back names the page it returns to, asks for it again as it was asked, and the trail ends where the first page was.
  test('to the rows that refer to it, and back the way it came', async () => {
    relatedRows()
    const user = await browsing()
    await show(user, 'sales.country')
    await openRelated(user, 1)
    await user.click(
      within(screen.getByRole('list', { name: 'Rows that refer to it' })).getByRole('button', { name: 'sales.customer where country_code = CH' }),
    )
    await statusSays('Where country_code = CH, showing rows 1 to 2.')
    expect(grid().map((row) => row[3])).toEqual(['name', 'Muster AG', 'Other Tenant GmbH'])
    await openRelated(user, 1)
    await user.click(screen.getByRole('button', { name: 'sales.order where tenant_id = 1 and customer_no = 1001' }))
    await statusSays('Where tenant_id = 1 and customer_no = 1001, showing rows 1 to 2.')
    expect(browses().at(-1)?.body).toEqual({
      object: { schema: 'sales', name: 'order' },
      equal: [
        { column: 'tenant_id', value: '1' },
        { column: 'customer_no', value: '1001' },
      ],
      filter: [],
      search: '',
      sort: [],
      offset: 0,
      limit: LIST_PAGE_SIZE,
    })
    expect(chosen()).toBe('sales.order')

    await user.click(screen.getByRole('button', { name: 'Back to sales.customer' }))
    await statusSays('Where country_code = CH, showing rows 1 to 2.')
    expect(browses().at(-1)?.body).toEqual(browses()[1]?.body)
    expect(chosen()).toBe('sales.customer')
    expect(document.activeElement).toBe(pageHeading('sales.customer table'))
    expect(await audit()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Back to sales.country' }))
    await statusSays('Showing rows 1 to 2.')
    expect(browses().at(-1)?.body).toEqual(browses()[0]?.body)
    expect(chosen()).toBe('sales.country')
    expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull()
  })

  // Back returns to the page left, not to its first page: the offset, the sort and the search it was asked with, and the search box says the search again.
  test('back returns to the exact page it left', async () => {
    relatedRows()
    plane.rows.set(
      'sales.order',
      Array.from({ length: LIST_PAGE_SIZE + 1 }, (_, index) => ({
        id: String(index + 1),
        tenant_id: '1',
        customer_no: '1001',
        status: 'placed',
        created_by: '1',
        approved_by: null,
      })),
    )
    const user = await browsing()
    await show(user, 'sales.order', 'placed')
    await user.click(screen.getByRole('button', { name: 'status, sort ascending' }))
    await screen.findByRole('button', { name: 'status, sort descending' })
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await statusSays('Matching “placed”, showing rows 51 to 51.')
    const left = browses().at(-1)?.body
    await openRelated(user, 51)
    await user.click(screen.getByRole('button', { name: 'sales.employee where id = 1' }))
    await screen.findByRole('region', { name: /^sales\.employee, / })
    // The page reached is not searched, and the box says so: Show rows from here would not search it for the order's text.
    expect(within(browseStep()).getByLabelText('Search')).toHaveProperty('value', '')

    await user.click(screen.getByRole('button', { name: 'Back to sales.order' }))
    await statusSays('Matching “placed”, showing rows 51 to 51.')
    expect(left).toEqual({
      object: { schema: 'sales', name: 'order' },
      equal: [],
      filter: [],
      search: 'placed',
      sort: [{ column: 'status', direction: 'asc' }],
      offset: 50,
      limit: LIST_PAGE_SIZE,
    })
    expect(browses().at(-1)?.body).toEqual(left)
    expect(screen.getByRole('columnheader', { name: 'status' }).getAttribute('aria-sort')).toBe('ascending')
    expect(within(browseStep()).getByLabelText('Search')).toHaveProperty('value', 'placed')
    expect(chosen()).toBe('sales.order')
    expect(document.activeElement).toBe(pageHeading('sales.order table'))
  })

  // A followed page is still narrowed on its next page and in a new order: a page or a sort that dropped the equal would show every row of the table under a status that says it is one row's.
  test('paging and sorting a followed page keep what it is narrowed by', async () => {
    plane.rows.set('sales.employee', [
      { id: '1', name: 'Ada', manager_id: null },
      ...Array.from({ length: LIST_PAGE_SIZE + 1 }, (_, index) => ({ id: String(index + 2), name: `E${String(index + 2)}`, manager_id: '1' })),
    ])
    const user = await browsing()
    await show(user, 'sales.employee')
    await openRelated(user, 1)
    expect(entries('It refers to')).toEqual(['fk_employee_manager: manager_id is NULL, so it follows to no row.'])
    await user.click(within(screen.getByRole('list', { name: 'Rows that refer to it' })).getByRole('button', { name: 'sales.employee where manager_id = 1' }))
    await statusSays('Where manager_id = 1, showing rows 1 to 50, and more follow.')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await statusSays('Where manager_id = 1, showing rows 51 to 51.')
    await user.click(screen.getByRole('button', { name: 'name, sort ascending' }))
    await screen.findByRole('button', { name: 'name, sort descending' })
    const equal = [{ column: 'manager_id', value: '1' }]
    expect(
      browses()
        .slice(1)
        .map((request) => request.body),
    ).toEqual([
      { object: { schema: 'sales', name: 'employee' }, equal, filter: [], search: '', sort: [], offset: 0, limit: LIST_PAGE_SIZE },
      { object: { schema: 'sales', name: 'employee' }, equal, filter: [], search: '', sort: [], offset: 50, limit: LIST_PAGE_SIZE },
      {
        object: { schema: 'sales', name: 'employee' },
        equal,
        filter: [],
        search: '',
        sort: [{ column: 'name', direction: 'asc' }],
        offset: 0,
        limit: LIST_PAGE_SIZE,
      },
    ])
    expect(status()).toBe('Where manager_id = 1, showing rows 1 to 50, and more follow.')
    // Paging is not leaving: the way back still names the page the follow left.
    expect(screen.getByRole('button', { name: 'Back to sales.employee' })).toBeTruthy()
  })

  // Show rows is a browse of its own: a trail kept under it would offer a Back to pages the person has left behind, and an equal kept would narrow a page nobody asked to narrow.
  test('Show rows starts afresh and forgets the way back', async () => {
    relatedRows()
    const user = await browsing()
    await show(user, 'sales.customer')
    await openRelated(user, 1)
    await user.click(screen.getByRole('button', { name: 'sales.country where iso_code = CH' }))
    await statusSays('Where iso_code = CH, showing rows 1 to 1.')
    await user.click(within(browseStep()).getByRole('button', { name: 'Show rows' }))
    await statusSays('Showing rows 1 to 2.')
    expect(browses().at(-1)?.body).toEqual({
      object: { schema: 'sales', name: 'country' },
      equal: [],
      filter: [],
      search: '',
      sort: [],
      offset: 0,
      limit: LIST_PAGE_SIZE,
    })
    expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull()
  })

  // The server plans every follow again over its own discovery: one the catalog no longer allows is refused in its words, and the page the person was on stays, with no way back to a page never reached.
  test('a follow the server refuses is said, and the page stays', async () => {
    relatedRows()
    const user = await browsing()
    await show(user, 'sales.customer')
    await openRelated(user, 1)
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    plane.databases.set('fixture', createSnapshot({ ...contents, objects: contents.objects.filter((object) => object.ref.name !== 'country') }))
    await user.click(screen.getByRole('button', { name: 'sales.country where iso_code = CH' }))
    expect((await within(browseStep()).findByRole('alert')).textContent).toBe('sales.country is not a table or view this connection can see.')
    expect(screen.getByRole('region', { name: /^sales\.customer, / })).toBeTruthy()
    expect(chosen()).toBe('sales.customer')
    expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull()
    expect(await audit()).toEqual([])
  })

  // A second press while a follow is on its way would push the page left twice, and the first Back would return to the page on screen.
  test('a press while a follow is on its way sends nothing', async () => {
    relatedRows()
    const user = await browsing()
    await show(user, 'sales.customer')
    await openRelated(user, 1)
    const held = plane.hold(/\/browse$/)
    const follow = screen.getByRole('button', { name: 'sales.country where iso_code = CH' })
    await user.click(follow)
    await user.click(follow)
    expect(browses()).toHaveLength(2)
    held.release()
    await statusSays('Where iso_code = CH, showing rows 1 to 1.')
    expect(browses()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Back to sales.customer' }))
    await statusSays('Showing rows 1 to 3.')
    expect(screen.queryByRole('button', { name: /^Back to / })).toBeNull()
  })
})
