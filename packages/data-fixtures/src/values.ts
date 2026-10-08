/**
 * The edge values the fixture inserts, by name, as the decimal strings they are.
 *
 * A codec or adapter test asks for `EDGE_VALUES.largestAmount` rather than
 * retyping fourteen nines and four more, and the fixture-load test reads each
 * one back as text from both engines, so a value here that disagreed with the
 * SQL files would fail there first.
 */
export const EDGE_VALUES = {
  /** 2^53 + 1, the first integer a JavaScript number cannot hold: sales.order.id. */
  beyondSafeInteger: '9007199254740993',
  /** The largest numeric(18,4): sales.order.amount. */
  largestAmount: '99999999999999.9999',
  /** The largest numeric(14,2): sales.customer.credit_limit for tenant 1. */
  largestCreditLimit: '999999999999.99',
  /** The smallest positive numeric(14,2): sales.customer.credit_limit for tenant 2. */
  smallestCreditLimit: '0.01',
  /** A computed numeric(14,2) whose binary floating-point product is 0.30000000000000004: sales.order_line.line_total. */
  computedLineTotal: '0.30',
  /** A calendar date with no time and no zone: sales.order.order_date. */
  orderDate: '2026-10-08',
} as const
