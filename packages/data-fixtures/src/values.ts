/**
 * The edge values the fixture inserts, by name, as the strings the API carries them as.
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
  /** The largest smallint: sales.shipment.carrier_code of the first shipment. */
  largestSmallint: '32767',
  /** A zoneless timestamp(3) holding half a second, read with its trailing zeros dropped: the first shipment's dispatched_at. */
  localTimestamp: '2026-10-08T12:34:56.5',
  /** A zoneless timestamp on a whole second, read with no fraction at all: the second shipment's dispatched_at. */
  localTimestampWholeSecond: '2026-10-08T12:34:56',
} as const

/**
 * sales.shipment's first row as both adapters' records.read must return it:
 * every column with a canonical value (binary has none). One object, so
 * neither adapter can spell a zoneless timestamp or a real its own way (0026).
 */
export const FIRST_SHIPMENT = {
  id: '1',
  tenant_id: '1',
  tracking_no: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  carrier_code: EDGE_VALUES.largestSmallint,
  reference: 'Zürich-01',
  pickup_time: '09:30',
  dispatched_at: EDGE_VALUES.localTimestamp,
  // 0.1 + 0.2 as a double, which a double column holds exactly.
  weight_kg: 0.30000000000000004,
  // Stored as the float32 nearest 0.1, and read as its shortest spelling.
  temperature_c: 0.1,
} as const

/** sales.shipment's second row, as FIRST_SHIPMENT: a carrier of 0, which ck_shipment_carrier refuses for a new row, and nulls. */
export const SECOND_SHIPMENT = {
  id: '2',
  tenant_id: '1',
  tracking_no: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
  carrier_code: '0',
  reference: 'B',
  pickup_time: '17:05',
  dispatched_at: EDGE_VALUES.localTimestampWholeSecond,
  weight_kg: null,
  temperature_c: null,
} as const
