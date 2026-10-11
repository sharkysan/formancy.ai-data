import { EDGE_VALUES } from './values.js'

/*
 * What a list of a form's records shows on both engines (0044), written once
 * for both adapters' `list.integration.test.ts`.
 *
 * Each suite starts its own fixture and inserts LIST_ROWS as the owner:
 * tenant 1 customers beside the fixture's own customer 1001, whose names hold
 * the characters LIKE reads as patterns and whose credit limits include NULLs;
 * and orders of both tenants with lines. Then it lists them through its
 * adapter, from requests `planList` builds over bindings generated from what
 * discovery reports, as tenant 1's clerk, and expects what is below.
 *
 * Keys are compared in order where the order is the point. Every order here
 * is numeric, so it is one order on both engines: text order is each
 * engine's collation, which the adapters say rather than hide (0012).
 */

/** The orders the suites list lines of: the fixture's own, another of tenant 1's, and one of tenant 2's. */
const OURS = EDGE_VALUES.beyondSafeInteger
const SECOND = '9007199254740995'
const THEIRS = '9007199254740994'

/** The rows each list suite inserts as the fixture's owner, before it lists anything. */
export const LIST_ROWS = {
  /** Tenant 1's customers beside the fixture's 1001: `customer_no`, `name`, `credit_limit` (null is NULL). */
  customers: [
    ['2001', '100% Cotton', '50.00'],
    ['2002', '100 Percent', null],
    ['2003', 'A_B Trading', '50.00'],
    ['2004', 'AxB Trading', '-1.00'],
    ['2005', '[x] Labs', null],
    ['2006', 'x Labs', '0.01'],
  ],
  /** Orders beside the fixture's tenant-1 order: `id`, `tenant_id`, customer 1001 of that tenant. */
  orders: [
    [SECOND, '1'],
    [THEIRS, '2'],
  ],
  /** Lines beside the fixture's line 1 of its order: `order_id`, `line_no`. */
  lines: [
    [SECOND, '1'],
    [SECOND, '2'],
    [THEIRS, '1'],
  ],
} as const

/** Tenant 1's customers in key order, by customer_no: the fixture's 1001 and every inserted one. */
const KEY_ORDER = ['1001', '2001', '2002', '2003', '2004', '2005', '2006']

/**
 * The shared expectations, by case. `listCase(name)` is each one's id.
 *
 * - `pages`: tenant 1's customers in key order, three to a page, from offset
 *   0, one page in, and the last, with whether more follow -- and an offset
 *   past the end, which is an empty page with no more.
 * - `search`: `%`, `_` and `[x]` match themselves: `100%` is not "100 and
 *   anything", `A_B` not "A, a character, B", and `[x]` not SQL Server's
 *   character class, which would find "x Labs".
 * - `nulls`: sorted by the nullable credit_limit, NULLs come last whichever
 *   the direction -- where PostgreSQL alone puts them first descending and
 *   SQL Server alone first ascending -- and ties are broken by the key.
 * - `order`: sorted by the NOT NULL customer_no, descending: one order, from
 *   a statement that spells no NULL placement for it.
 * - `parent`: a line list narrowed to one of tenant 1's orders holds its lines
 *   alone; narrowed to tenant 2's order, it holds none, because a parent adds
 *   no permission.
 * - `through`: tenant 1's line list holds the lines of tenant 1's orders and
 *   none of tenant 2's, though `order_line` has no tenant column (0043).
 * - `read`: every row listed, customer and line, is exactly what a read by
 *   its token returns, and a page carries the description of the table its
 *   own statement read, the one `describe` reads (0041).
 * - `text-parent`: a customer list narrowed to a country, a lookup over a
 *   `char(2)` foreign key, holds the customers of that country; the value is
 *   bound and compared with the database's equality, the foreign key's own,
 *   so a token spelled in another case finds them where the column's
 *   collation folds case -- the fixture's on SQL Server -- and none where it
 *   does not, PostgreSQL's default. Either way it narrows within the rows the
 *   person may read.
 * - `key`: a table the suite creates, whose key is a unique NOT NULL
 *   column, lists in key order; once the column is made nullable and holds a
 *   NULL, and again once its unique key is dropped and a key value is
 *   inserted twice, a page decided over its own statement's description is
 *   refused (0044), though a read by token still is not.
 */
export const LIST_PARITY = {
  pages: {
    size: 3,
    pages: [
      { offset: 0, keys: KEY_ORDER.slice(0, 3), hasMore: true },
      { offset: 3, keys: KEY_ORDER.slice(3, 6), hasMore: true },
      { offset: 6, keys: KEY_ORDER.slice(6), hasMore: false },
      { offset: 7, keys: [], hasMore: false },
    ],
  },
  search: [
    { text: '%', keys: ['2001'] },
    { text: '_', keys: ['2003'] },
    { text: '[x]', keys: ['2005'] },
  ],
  nulls: {
    asc: ['2004', '2006', '2001', '2003', '1001', '2002', '2005'],
    desc: ['1001', '2001', '2003', '2006', '2004', '2002', '2005'],
  },
  order: {
    desc: [...KEY_ORDER].reverse(),
  },
  parent: {
    ours: { order: SECOND, lines: [[SECOND, '1'], [SECOND, '2']] },
    theirs: { order: THEIRS, lines: [] },
  },
  through: {
    lines: [[OURS, '1'], [SECOND, '1'], [SECOND, '2']],
  },
  read: {
    customers: KEY_ORDER,
    lines: [[OURS, '1'], [SECOND, '1'], [SECOND, '2']],
  },
  'text-parent': {
    field: 'country',
    exact: { record: 'k1:CH', keys: ['1001'] },
    folded: { record: 'k1:ch', keys: { postgres: [], sqlserver: ['1001'] } },
  },
  key: {
    /** `code`, `label`, inserted in this order. */
    rows: [['2', 'two'], ['1', 'one']],
    listed: ['1', '2'],
    refused: 'drift',
  },
} as const

export type ListCase = keyof typeof LIST_PARITY
