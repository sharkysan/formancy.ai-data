import { LIST_ROWS } from './lists.js'
import { FILTER_PARITY } from './parity.js'
import { EDGE_VALUES } from './values.js'

/*
 * What a person's own conditions on a list's columns narrow it to on both
 * engines (0104), written once for both adapters' `list.integration.test.ts`,
 * which load LIST_ROWS and then COLUMN_FILTER_ROWS before anything is listed.
 *
 * Every request is planned as the server plans it -- a form's list by
 * `planList`, from bindings generated over what discovery reports, as a
 * clerk; a browse by `planBrowse` over the owner's snapshot -- so what is
 * proved is the planner and the adapter together, the planner spelling each
 * value as its column holds it and the adapter comparing it. Conditions are
 * by field for a list and by column for a browse, as a request names them.
 *
 * Every order here is a number's, so it is one order on both engines (0012).
 */

/** The orders LIST_ROWS inserts beside the fixture's own: tenant 1's second, and tenant 2's. */
const [[SECOND], [THEIRS]] = LIST_ROWS.orders
/** The fixture's own order, tenant 1's, dated a day before the other two. */
const OURS = EDGE_VALUES.beyondSafeInteger

/**
 * FILTER_PARITY's row filters that admit rows, each with the keys it admits:
 * an equals on the same column and value is spelled as that row filter is,
 * so it finds exactly those rows (0028). Derived, so the two cannot drift.
 */
const EXACT = FILTER_PARITY.flatMap((entry) => ('keys' in entry ? [{ column: entry.column, value: entry.value, keys: entry.keys }] : []))

/** parity.tenant_item's four named rows, in item_no order: every row a tenant_code filter of FILTER_PARITY admits. */
const NAMED = EXACT.filter((entry) => entry.column === 'tenant_code')
  .flatMap((entry) => entry.keys)
  .sort(([, left], [, right]) => Number(left) - Number(right))

/**
 * What each suite gives the rows it filters, as the fixture's owner, after
 * LIST_ROWS.
 *
 * - `customers`: tenant 1's, the fixture's 1001 and LIST_ROWS' 2001 to 2006,
 *   updated to a known `created_at` and `active`: the instant as written,
 *   some in another offset than UTC, and whether the customer is active.
 *   Updated, never inserted: a customer more would be one more row of every
 *   list and browse of customers the other cases expect.
 * - `shipments`: tenant 3's, which no other case lists, inserted in this
 *   order, so their keys follow it on both engines: `reference`, a uuid
 *   `tracking_no`, and a zoneless `dispatched_at` (null is NULL). Each
 *   carrier is 1 and each pickup 08:00, values no case asks about.
 */
export const COLUMN_FILTER_ROWS = {
  customers: [
    ['1001', '2026-02-28T23:59:59.999Z', true],
    ['2001', '2026-03-01T00:00:00Z', true],
    ['2002', '2026-03-01T12:00:00Z', true],
    ['2003', '2026-03-02T23:59:59.999Z', false],
    ['2004', '2026-03-03T00:00:00Z', true],
    // 2026-03-02T23:30:00Z: the second day in UTC, the third on its own clock.
    ['2005', '2026-03-03T01:30:00+02:00', false],
    // 2026-03-03T01:00:00Z: the third day in UTC, the second on its own clock.
    ['2006', '2026-03-02T22:00:00-03:00', true],
  ],
  shipments: [
    ['AG', '5f0c6b1e-3d2a-4c8b-9e71-0a4d2f6b8c01', '2026-02-28T23:59:59.999'],
    ['AG ', '5f0c6b1e-3d2a-4c8b-9e71-0a4d2f6b8c02', '2026-03-01T00:00:00'],
    ['ag', '5f0c6b1e-3d2a-4c8b-9e71-0a4d2f6b8c03', '2026-03-02T23:59:59.999'],
    ['next', '5f0c6b1e-3d2a-4c8b-9e71-0a4d2f6b8c04', '2026-03-03T00:00:00'],
    ['none', '5f0c6b1e-3d2a-4c8b-9e71-0a4d2f6b8c05', null],
  ],
} as const

/** The tenant COLUMN_FILTER_ROWS' shipments belong to, whose clerk lists them. */
export const COLUMN_FILTER_TENANT = '3'

/**
 * The shared expectations, by case. `columnFilterCase(name)` is each one's
 * id. A list's rows are named by their customer numbers or their shipments'
 * references, a line by its order and number, a browse's orders by id, each
 * in key order.
 *
 * - `text`: a shipment's reference equals a value exactly, as a row filter
 *   compares one (0028): `ag` is not `AG`, and `AG ` is not `AG` either
 *   way, though SQL Server's `=` under the column's case-insensitive
 *   collation, which ignores trailing spaces, calls all three equal.
 * - `integer`: a customer number equals 1001, which finds tenant 1's
 *   customer and not tenant 2's of the same number, since a filter narrows
 *   and never permits; and a range from 2002 to 2004 holds both ends.
 * - `decimal`: a credit limit equals `50`, which the planner spells `50.00`
 *   for the numeric(14, 2) column; a range from `-1` to `0.01` holds both
 *   ends.
 * - `boolean`: whether a customer is active.
 * - `uuid`: a shipment's tracking number, given in upper case, which the
 *   planner spells in lower case as a uuid reads.
 * - `date`: an order's date in a browse of sales.order, every tenant's:
 *   equal to a day, a range of one day holding the order on both its ends,
 *   and a range with a from alone.
 * - `instant`: a customer's `created_at`, an instant, in a range of whole
 *   days in UTC: from the first midnight, inclusive, to the last instant of
 *   the last day, below the next midnight -- whatever offset the instant was
 *   written in, and whatever TimeZone or language the session has. Then
 *   ranges with one end alone.
 * - `zoneless`: a shipment's `dispatched_at`, a timestamp in no zone,
 *   compared on its own clock, in whole days as `instant` is: 23:59:59.999
 *   of the last day is inside, 00:00:00.000 of the next outside and of the
 *   first inside, and NULL is in no range.
 * - `contains`: a name holds the text as the list's search matches it: `%`,
 *   `_` and `[x]` match themselves, and case is folded.
 * - `nulls`: a credit limit is NULL, or is not.
 * - `together`: every condition holds: two that each hold for two
 *   customers hold together for one, and three for two, each of the three
 *   leaving out a customer the other two hold for.
 * - `search`: a filter beside a list's search, both holding: each alone
 *   finds more.
 * - `parent`: a filter beside a parent: a line list narrowed to tenant 1's
 *   second order, and its second line; beside the throughs alone, the first
 *   lines of tenant 1's orders and not tenant 2's (0043); and beside tenant
 *   2's order, nothing.
 * - `follow`: a filter beside a follow's equal in a browse (0103): tenant
 *   1's customer 1001, followed to its orders, of one date or of the other.
 * - `collation`: a browse of parity.tenant_item (0028), sorted by item_no,
 *   whose tenant_code is under a case-insensitive collation on both engines
 *   -- a nondeterministic ICU one on PostgreSQL, under which `=` calls
 *   `acme` and `ACME` equal -- and whose fixed_code is char(3): an equals
 *   finds exactly the rows FILTER_PARITY's row filter of that value admits,
 *   case, accents and a trailing space counting; and a contains folds case
 *   on that column as the search does, where PostgreSQL refuses LIKE under
 *   a nondeterministic collation outright.
 */
export const COLUMN_FILTER_PARITY = {
  text: {
    field: 'reference',
    entries: [
      { value: 'AG', references: ['AG'] },
      { value: 'AG ', references: ['AG '] },
      { value: 'ag', references: ['ag'] },
      { value: 'Ag', references: [] },
    ],
  },
  integer: {
    field: 'customer_no',
    entries: [
      { condition: { op: 'equals', value: '1001' }, keys: ['1001'] },
      { condition: { op: 'range', from: '2002', to: '2004' }, keys: ['2002', '2003', '2004'] },
    ],
  },
  decimal: {
    field: 'credit_limit',
    entries: [
      { condition: { op: 'equals', value: '50' }, keys: ['2001', '2003'] },
      { condition: { op: 'range', from: '-1', to: '0.01' }, keys: ['2004', '2006'] },
    ],
  },
  boolean: {
    field: 'active',
    entries: [
      { condition: { op: 'equals', value: 'false' }, keys: ['2003', '2005'] },
      { condition: { op: 'equals', value: 'true' }, keys: ['1001', '2001', '2002', '2004', '2006'] },
    ],
  },
  uuid: {
    field: 'tracking_no',
    value: '5F0C6B1E-3D2A-4C8B-9E71-0A4D2F6B8C03',
    references: ['ag'],
  },
  date: {
    object: { schema: 'sales', name: 'order' },
    column: 'order_date',
    entries: [
      { condition: { op: 'equals', value: '2026-10-09' }, ids: [THEIRS, SECOND] },
      { condition: { op: 'range', from: '2026-10-08', to: '2026-10-08' }, ids: [OURS] },
      { condition: { op: 'range', from: '2026-10-09', to: null }, ids: [THEIRS, SECOND] },
    ],
  },
  instant: {
    field: 'created_at',
    entries: [
      { from: '2026-03-01', to: '2026-03-02', keys: ['2001', '2002', '2003', '2005'] },
      { from: '2026-03-03', to: null, keys: ['2004', '2006'] },
      { from: null, to: '2026-03-02', keys: ['1001', '2001', '2002', '2003', '2005'] },
    ],
  },
  zoneless: {
    field: 'dispatched_at',
    entries: [
      { from: '2026-03-01', to: '2026-03-02', references: ['AG ', 'ag'] },
      { from: '2026-03-01', to: null, references: ['AG ', 'ag', 'next'] },
      { from: null, to: '2026-03-02', references: ['AG', 'AG ', 'ag'] },
    ],
  },
  contains: {
    field: 'name',
    entries: [
      { text: '%', keys: ['2001'] },
      { text: '_', keys: ['2003'] },
      { text: '[x]', keys: ['2005'] },
      { text: 'LABS', keys: ['2005', '2006'] },
    ],
  },
  nulls: {
    field: 'credit_limit',
    null: ['2002', '2005'],
    'not-null': ['1001', '2001', '2003', '2004', '2006'],
  },
  together: [
    {
      filter: [
        { field: 'credit_limit', op: 'equals', value: '50' },
        { field: 'active', op: 'equals', value: 'true' },
      ],
      keys: ['2001'],
    },
    // Each of the three leaves a customer out: the range 2006, `x Labs`;
    // the contains 2001, `100% Cotton`; and `not-null` 2005, `[x] Labs`.
    {
      filter: [
        { field: 'customer_no', op: 'range', from: '2001', to: '2005' },
        { field: 'name', op: 'contains', text: 'B' },
        { field: 'credit_limit', op: 'not-null' },
      ],
      keys: ['2003', '2004'],
    },
  ],
  search: [
    { search: 'Labs', filter: [{ field: 'credit_limit', op: 'not-null' }], keys: ['2006'] },
    // The search finds 1001 by its number, 2001 and 2002 by their names.
    { search: '100', filter: [{ field: 'credit_limit', op: 'null' }], keys: ['2002'] },
  ],
  parent: [
    { order: SECOND, filter: [{ field: 'line_no', op: 'equals', value: '2' }], lines: [[SECOND, '2']] },
    {
      order: null,
      filter: [{ field: 'line_no', op: 'equals', value: '1' }],
      lines: [
        [OURS, '1'],
        [SECOND, '1'],
      ],
    },
    { order: THEIRS, filter: [{ field: 'line_no', op: 'equals', value: '1' }], lines: [] },
  ],
  follow: {
    /** The row followed from: tenant 1's customer 1001, by its key, and the key it is followed through. */
    object: { schema: 'sales', name: 'customer' },
    equal: [
      { column: 'tenant_id', value: '1' },
      { column: 'customer_no', value: '1001' },
    ],
    key: 'fk_order_customer',
    entries: [
      { filter: [{ column: 'order_date', op: 'equals', value: '2026-10-09' }], ids: [SECOND] },
      { filter: [{ column: 'order_date', op: 'equals', value: '2026-10-08' }], ids: [OURS] },
    ],
  },
  collation: {
    object: { schema: 'parity', name: 'tenant_item' },
    sort: [{ column: 'item_no', direction: 'asc' }],
    equals: EXACT,
    contains: { column: 'tenant_code', text: 'CM', keys: NAMED },
  },
} as const

export type ColumnFilterCase = keyof typeof COLUMN_FILTER_PARITY
