import { describe, expect, test } from 'vitest'
import { generateDemoData } from './generate.js'
import type { DemoData } from './model.js'
import { decimal } from './model.js'
import { demoSql, renderDemoSql } from './render.js'

/**
 * The demo's SQL as text. That it loads, and loads as exactly these rows, is
 * load.integration.test.ts against a real PostgreSQL; here, what can be read
 * off the text without one: the order of the statements, the literals, and
 * that it never writes data that breaks an invariant.
 */
const data = generateDemoData()
const sql = renderDemoSql(data)
const statements = sql
  .split('\n')
  .filter((line) => line !== '' && !line.startsWith('--') && !line.startsWith('  '))
  .map((line) => line.replace(/ values$/, ''))

describe('the demo’s SQL', () => {
  // Deletes in this order, or a foreign key refuses one: orders (cascading
  // to lines, deliveries and parcels) before the customers and employees
  // they reference. The employee key is validated once the new tree is in,
  // and the identities restart past the explicit keys, or the first order a
  // visitor creates collides with order 1.
  test('replaces the fixture’s rows in an order its keys allow, then validates and restarts', () => {
    expect(statements).toEqual([
      "set client_encoding = 'UTF8';",
      'delete from sales."order";',
      'delete from sales.shipment;',
      'delete from sales.customer;',
      'delete from sales.employee;',
      'insert into sales.country (iso_code, name)',
      'insert into sales.employee (id, name, manager_id)',
      'alter table sales.employee validate constraint fk_employee_manager;',
      'insert into sales.customer (tenant_id, customer_no, name, country_code, credit_limit, active, created_at)',
      'insert into sales."order" (id, tenant_id, customer_no, order_date, status, amount, notes, "group", created_by, approved_by) overriding system value',
      'insert into sales.order_line (order_id, line_no, quantity, unit_price)',
      'insert into sales.delivery (id, tenant_id, order_id, carrier, shipped_at)',
      'insert into sales.parcel (id, delivery_id, label) overriding system value',
      `alter table sales."order" alter column id restart with ${String(data.orders.length + 1)};`,
      `alter table sales.parcel alter column id restart with ${String(data.parcels.length + 1)};`,
    ])
  })

  // The file is loaded inside one transaction the loader opens (psql -1 in
  // the image, a transaction in the test); a commit in it would end that
  // transaction half way, and the fixture's rows would be gone with nothing
  // in their place if the rest failed.
  test('controls no transaction of its own', () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback|start transaction|end)\b/im)
  })

  // One row per line, so a diff of two generators' output reads row by row,
  // and each value as the column's type writes it: money at the column's
  // scale, an instant in UTC, a missing value as null.
  test('writes each row on its line, money at its column’s scale, instants in UTC', () => {
    const order = data.orders[0]!
    const customer = data.customers.find((each) => each.creditLimitCents === null)!
    const instant = new Date(customer.createdAt).toISOString().replace('T', ' ').replace('.000Z', '+00')
    expect(sql).toContain(
      `  (${String(order.id)}, ${String(order.tenantId)}, ${String(order.customerNo)}, '${order.orderDate}', '${order.status}', ${decimal(order.amountCents, 4)}, ${order.notes === null ? 'null' : `'${order.notes}'`}, null, ${String(order.createdBy)}, ${order.approvedBy === null ? 'null' : String(order.approvedBy)})`,
    )
    expect(sql).toContain(
      `  (${String(customer.tenantId)}, ${String(customer.customerNo)}, '${customer.name}', '${customer.countryCode}', null, ${String(customer.active)}, '${instant}')`,
    )
    expect(instant).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00\+00$/)
  })

  // A quote in a value is doubled, never closes the literal: the words are
  // the generator's own, but a name like "L'Arte" is one edit away.
  test('doubles a quote inside a value', () => {
    const quoted: DemoData = structuredClone(data)
    quoted.customers[0]!.name = "L'Arte Arredamenti S.r.l."
    expect(renderDemoSql(quoted)).toContain("'L''Arte Arredamenti S.r.l.'")
  })

  // An empty list is no statement: `insert ... values ;` is a syntax error
  // that would fail the image's build on a list the generator left empty.
  test('writes no insert for a table with no rows', () => {
    const empty: DemoData = { ...structuredClone(data), deliveries: [], parcels: [] }
    const text = renderDemoSql(empty)
    expect(text).not.toContain('insert into sales.delivery')
    expect(text).not.toContain('insert into sales.parcel')
    expect(text).toContain('alter table sales.parcel alter column id restart with 1;')
  })

  // The image's build writes this file; a generator change that broke an
  // invariant must stop the build there, naming the row, not load quietly.
  test('is refused for data that breaks an invariant, naming each problem', () => {
    expect(demoSql()).toBe(sql)
    const broken: DemoData = structuredClone(data)
    broken.orders[0]!.amountCents += 1
    expect(() => demoSql(broken)).toThrow(
      `The demo data breaks its invariants:\n  - order 1: amount ${decimal(data.orders[0]!.amountCents + 1, 2)} is not its lines' sum`,
    )
  })
})

describe('decimal', () => {
  // Cents become text with exact digits, never through a float; a negative,
  // fractional or unsafe count of cents is refused rather than rounded.
  test('writes whole cents exactly at a scale of two or more, and refuses anything else', () => {
    expect(decimal(123_456, 4)).toBe('1234.5600')
    expect(decimal(5, 2)).toBe('0.05')
    expect(decimal(25_000_000, 2)).toBe('250000.00')
    expect(() => decimal(-1, 2)).toThrow('an amount is a whole, non-negative number of cents, not -1')
    expect(() => decimal(1.5, 2)).toThrow('not 1.5')
    expect(() => decimal(2 ** 53, 2)).toThrow('not 9007199254740992')
    expect(() => decimal(1, 1)).toThrow('cents have two places at least, not 1')
  })
})
