import { describe, expect, test } from 'vitest'
import { EXPORT_PARITY, EXPORT_ROWS } from './exports.js'
import { LIST_ROWS } from './lists.js'
import { FIXTURE_CUSTOMERS } from './sized.js'
import { FIRST_SHIPMENT } from './values.js'

/*
 * The export's expectations (0079), held to themselves before any suite
 * holds a file to them: a cell typed by hand that no rule could write would
 * fail a server suite for the fixture's mistake, and a customer number
 * another set of rows already uses would fail its insert.
 */

/** One cell as RFC 4180 reads it. */
const unquoted = (cell: string): string => (cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell)

/** A cell's text with one leading apostrophe taken off, as the file's reader is told to. */
const undone = (text: string): string => (text.startsWith("'") ? text.slice(1) : text)

describe('EXPORT_ROWS', () => {
  // Each cell is spelled by hand, so the suite that reads it holds the
  // server to something other than the server's own code. Read back by the
  // stated rule, it must be the name it was written for, and none may start
  // as a formula: a formula cell without its apostrophe reads back as its
  // name too.
  test('each cell reads back as its name, and none as a formula', () => {
    for (const { name, cell } of EXPORT_ROWS.customers) {
      expect(unquoted(cell), cell).not.toMatch(/^[=+\-@\t\r]/)
      expect(undone(unquoted(cell)), cell).toBe(name)
    }
  })

  // A suite inserts these beside the fixture's own customers and
  // LIST_ROWS'; a number twice in tenant 1 is a primary-key violation
  // before anything is exported.
  test('number customers no other rows of tenant 1 use', () => {
    const taken = new Set([...FIXTURE_CUSTOMERS.filter((row) => row.tenantId === 1).map((row) => String(row.customerNo)), ...LIST_ROWS.customers.map(([number]) => number)])
    const numbers = EXPORT_ROWS.customers.map((row) => row.number)
    expect(numbers.filter((number) => taken.has(number))).toEqual([])
    expect(new Set(numbers).size).toBe(numbers.length)
  })
})

describe('EXPORT_PARITY', () => {
  // The shipments' lines are FIRST_SHIPMENT's and SECOND_SHIPMENT's values;
  // the half second, the double's 17 digits and the real's shortest
  // spelling are the bytes both engines are held to.
  test('spells the shipments as read, after the byte-order mark and the header', () => {
    const [header, first, second, rest] = EXPORT_PARITY.shipments.split('\r\n')
    expect(header).toBe('﻿Id,Tenant id,Tracking no,Carrier code,Reference,Pickup time,Dispatched at,Weight kg,Temperature c')
    expect(first).toBe(`1,1,${FIRST_SHIPMENT.tracking_no},32767,Zürich-01,09:30,2026-10-08T12:34:56.5,0.30000000000000004,0.1`)
    expect(second).toBe('2,1,b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12,0,B,17:05,2026-10-08T12:34:56,,')
    expect(rest).toBe('')
  })
})
