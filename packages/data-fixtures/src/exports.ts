import { FIRST_SHIPMENT, SECOND_SHIPMENT } from './values.js'

/*
 * What a file of a form's records holds on both engines (0079), written once
 * for both adapters' `list.integration.test.ts`.
 *
 * A list already holds every listed row to what a read by its token returns
 * (LIST_PARITY's `read`). A file adds text, so it is held as text: each
 * suite lists sales.shipment through its adapter, from requests `planList`
 * builds over bindings generated from what discovery reports, and builds the
 * file with data-core's `exportColumns`, `exportHeader` and `exportRecord`;
 * the bytes must be these. The rows are FIRST_SHIPMENT and SECOND_SHIPMENT
 * themselves, so the two cannot disagree: a double, a real and a zoneless
 * timestamp with half a second are where the engines' own spellings differ
 * (0026), and where a file would show it.
 *
 * No value here is one a file quotes or neutralises, so each line is the
 * values joined by commas and borrows nothing of data-core's rule;
 * exports.test.ts holds the lines to their text.
 */

/** sales.shipment's columns the generator makes a field of, in the table's order: binary has none. */
const SHIPMENT_COLUMNS = ['id', 'tenant_id', 'tracking_no', 'carrier_code', 'reference', 'pickup_time', 'dispatched_at', 'weight_kg', 'temperature_c'] as const

/** The generator's label for each, which heads its column of the file. */
const SHIPMENT_HEADERS = ['Id', 'Tenant id', 'Tracking no', 'Carrier code', 'Reference', 'Pickup time', 'Dispatched at', 'Weight kg', 'Temperature c']

/** One line of cells, NULL an empty cell, ended by CRLF. */
const line = (cells: ReadonlyArray<string | number | null>): string => `${cells.map((cell) => (cell === null ? '' : String(cell))).join(',')}\r\n`

const shipment = (row: typeof FIRST_SHIPMENT | typeof SECOND_SHIPMENT): string => line(SHIPMENT_COLUMNS.map((column) => row[column]))

/**
 * The shared expectations, by case. `exportCase(name)` is each one's id.
 *
 * - `shipments`: tenant 1's shipments, every field the generator makes read
 *   by the clerk and the tenant pinned, in key order: the byte-order mark,
 *   the header row, then each shipment as read -- the real `0.1`, the double
 *   `0.30000000000000004` and the zoneless `2026-10-08T12:34:56.5` uncut,
 *   and the second shipment's NULLs as empty cells.
 */
export const EXPORT_PARITY = {
  shipments: `﻿${line(SHIPMENT_HEADERS)}${shipment(FIRST_SHIPMENT)}${shipment(SECOND_SHIPMENT)}`,
} as const

export type ExportCase = keyof typeof EXPORT_PARITY

/**
 * Customers of tenant 1 an export suite inserts as the fixture's owner,
 * beside the fixture's 1001 and LIST_ROWS' 2001 to 2006: names a file has
 * to quote, neutralise or tell from NULL, each with the cell a file writes
 * for it, spelled here by hand. A formula, which gets an apostrophe and its
 * quotes doubled; a comma and quotes; the empty string, which is `""` and
 * not NULL's empty cell; and a name that starts with an apostrophe, which
 * gets another, so taking one off every cell that has one gives each name
 * back. The formula's customer has a negative credit limit, a number that
 * starts with `-` and is written as it is; the others have none, NULL's
 * empty cell.
 */
export const EXPORT_ROWS = {
  customers: [
    { number: '3001', name: '=HYPERLINK("http://x","y")', cell: `"'=HYPERLINK(""http://x"",""y"")"`, creditLimit: '-1.00' },
    { number: '3002', name: 'Muster "Zug", AG', cell: '"Muster ""Zug"", AG"', creditLimit: null },
    { number: '3003', name: '', cell: '""', creditLimit: null },
    { number: '3004', name: "'s-Hertogenbosch Handel", cell: "''s-Hertogenbosch Handel", creditLimit: null },
  ],
} as const
