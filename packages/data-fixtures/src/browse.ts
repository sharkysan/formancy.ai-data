import { EDGE_VALUES } from './values.js'

/*
 * What a browse of a table or view shows on both engines (0099), written
 * once for both adapters' `list.integration.test.ts`, which load LIST_ROWS
 * into the fixture before anything is listed or browsed.
 *
 * Each case is a page `planBrowse` plans over the owner's snapshot, run by
 * the adapter's `list` and read by `browsePage`, as the server's browse
 * route runs it:
 *
 * - `view`: `sales.customer_summary`, a view with no key, pages in the
 *   order of every column it shows -- tenant, customer number, name, order
 *   count -- three rows to a page, with whether more follow. Tenant 1's
 *   customer 1001 has the fixture's order and LIST_ROWS' second; tenant 2's
 *   has LIST_ROWS' third.
 * - `sort`: the same view by its order count, descending, and then by every
 *   column, so the rows tied at no order keep the view's own order.
 * - `search`: a search over the view's text and number columns finds the
 *   one customer whose name holds the text.
 * - `columns`: `sales.country` shows the columns the owner may read that
 *   have a text form, in its key order, and leaves out its bytea or
 *   varbinary flag and its point or geography shape, naming them.
 * - `follows`: tenant 1's customer 1001, browsed narrowed to its key, is
 *   followed (0103) through `fk_order_customer`, the key on `sales.order`
 *   that refers to it, to its orders: the fixture's and LIST_ROWS' second,
 *   in key order, and never tenant 2's, whose customer is numbered 1001 too.
 *   Each of those orders, followed back through the same key, finds that
 *   customer alone. The key is composite, and a follow pairs its columns by
 *   position as the catalog reports them: one that dropped the tenant would
 *   find tenant 2's order and customer as well.
 *
 * Every order here starts with a number, so it is one order on both
 * engines: text order is each engine's collation (0012).
 */

/** The view's rows in the order of every column: tenant, customer number, name, order count. */
const VIEW = [
  ['1', '1001', 'Muster AG', '2'],
  ['1', '2001', '100% Cotton', '0'],
  ['1', '2002', '100 Percent', '0'],
  ['1', '2003', 'A_B Trading', '0'],
  ['1', '2004', 'AxB Trading', '0'],
  ['1', '2005', '[x] Labs', '0'],
  ['1', '2006', 'x Labs', '0'],
  ['2', '1001', 'Other Tenant GmbH', '1'],
] as const

export const BROWSE_PARITY = {
  view: {
    object: { schema: 'sales', name: 'customer_summary' },
    columns: ['tenant_id', 'customer_no', 'name', 'order_count'],
    size: 3,
    pages: [
      { offset: 0, rows: VIEW.slice(0, 3), hasMore: true },
      { offset: 3, rows: VIEW.slice(3, 6), hasMore: true },
      { offset: 6, rows: VIEW.slice(6), hasMore: false },
    ],
  },
  sort: {
    object: { schema: 'sales', name: 'customer_summary' },
    sort: [{ column: 'order_count', direction: 'desc' }],
    rows: [VIEW[0], VIEW[7], ...VIEW.slice(1, 7)],
  },
  search: {
    object: { schema: 'sales', name: 'customer_summary' },
    text: 'Tenant',
    rows: [VIEW[7]],
  },
  columns: {
    object: { schema: 'sales', name: 'country' },
    columns: ['id', 'iso_code', 'name'],
    omitted: [
      { column: 'flag', reason: 'no-text' },
      { column: 'shape', reason: 'no-text' },
    ],
    rows: [
      { id: '1', iso_code: 'CH', name: 'Switzerland' },
      { id: '2', iso_code: 'DE', name: 'Germany' },
    ],
  },
  follows: {
    /** The row followed from: tenant 1's customer 1001, by its key. */
    object: { schema: 'sales', name: 'customer' },
    equal: [
      { column: 'tenant_id', value: '1' },
      { column: 'customer_no', value: '1001' },
    ],
    key: 'fk_order_customer',
    /** What it is referred by: the orders the key names it in, by id in key order. */
    orders: { object: { schema: 'sales', name: 'order' }, ids: [EDGE_VALUES.beyondSafeInteger, '9007199254740995'] },
    /** What it is, by name, and what each of those orders refers to. */
    names: ['Muster AG'],
  },
} as const

export type BrowseCase = keyof typeof BROWSE_PARITY
