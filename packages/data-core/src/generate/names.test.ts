import { describe, expect, test } from 'vitest'
import { createKeyAllocator, fieldKeyFor, labelFor, sourceNameFor } from './names.js'

describe('fieldKeyFor', () => {
  // A key is a variable in logic expressions. A column called `in` would make a
  // field no rule could name, and `_id` is refused by formancy outright.
  test('steps around CEL reserved words and formancy reserved keys', () => {
    expect(fieldKeyFor('in')).toBe('in_')
    expect(fieldKeyFor('null')).toBe('null_')
    expect(fieldKeyFor('_id')).toBe('_id_')
    expect(fieldKeyFor('group')).toBe('group')
  })

  // SQL allows names formancy's key rule does not: spaces, a leading digit,
  // letters outside ASCII. Each becomes something the rule accepts.
  test('makes any column name into a valid key', () => {
    expect(fieldKeyFor('Order Date')).toBe('Order_Date')
    expect(fieldKeyFor('2fa')).toBe('_2fa')
    expect(fieldKeyFor('größe')).toBe('gr__e')
    expect(fieldKeyFor('x'.repeat(80))).toHaveLength(64)
    for (const name of ['Order Date', '2fa', 'größe', '', 'a-b']) expect(fieldKeyFor(name)).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
  })
})

describe('createKeyAllocator', () => {
  // `Order Date` and `Order_Date` sanitise alike. Two fields with one key would
  // be one answer for two columns.
  test('gives a second claimant a numbered key, within the length limit', () => {
    const allocate = createKeyAllocator()
    expect(allocate('Order_Date')).toBe('Order_Date')
    expect(allocate('Order_Date')).toBe('Order_Date_2')
    expect(allocate('Order_Date')).toBe('Order_Date_3')
    const long = 'y'.repeat(64)
    expect(allocate(long)).toBe(long)
    expect(allocate(long)).toHaveLength(64)
  })
})

describe('sourceNameFor', () => {
  // The name is resolved per deployment; formancy allows lower case, digits
  // and hyphens, starting with a letter, at most 64.
  test('is a valid option-source name that includes the connection', () => {
    expect(sourceNameFor('erp', { schema: 'sales', name: 'order' }, 'fk_order_customer')).toBe('erp-sales-order-fk-order-customer')
    expect(sourceNameFor('1st', { schema: 'S', name: 'T' }, 'F')).toBe('s-1st-s-t-f')
  })

  // A table name is input somebody else chose, so building a name from it must
  // stay linear however hostile it is. This held before the change too —
  // separators were collapsed to one hyphen before any anchored pattern ran —
  // and it is pinned now so it keeps holding if that order ever changes.
  test('a name made of separators is linear and still valid', () => {
    const hostile = `${'-'.repeat(50_000)}x${'-'.repeat(50_000)}`
    const started = Date.now()
    const name = sourceNameFor(hostile, { schema: hostile, name: hostile }, hostile)
    expect(Date.now() - started).toBeLessThan(500)
    expect(name).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(name.length).toBeLessThanOrEqual(64)
  })

  // Two long names with a shared prefix must not collapse into one source.
  test('a name too long keeps its start and ends in a hash of the whole', () => {
    const a = sourceNameFor('erp', { schema: 'sales', name: 'x'.repeat(60) }, 'fk_a')
    const b = sourceNameFor('erp', { schema: 'sales', name: 'x'.repeat(60) }, 'fk_b')
    expect(a).toHaveLength(64)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})

describe('labelFor', () => {
  // A starting point for a person, and readable enough that one is not forced.
  test('turns identifiers into sentence-case words', () => {
    expect(labelFor('customer_no')).toBe('Customer no')
    expect(labelFor('createdAt')).toBe('Created at')
    expect(labelFor('ISO_CODE')).toBe('Iso code')
    expect(labelFor('__')).toBe('__')
  })
})
