import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { ObjectMeta } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import { copiedFields } from './copy.js'
import {
  AUDITOR,
  CLERK,
  CLERK_RW,
  CUSTOMER_POLICY,
  customerForm,
  customerSource,
  INTAKE,
  LINE_POLICY,
  lineForm,
  MS,
  ORDER_POLICY,
  orderForm,
  PG,
  restrict,
  sales,
  snapshot,
} from './test-support.js'

/*
 * The fields a copy of a record carries into a new one (0107): what this
 * person may read and may give on create, less every column of a key. Each
 * case is a field a page would otherwise copy into a create the server
 * refuses, or one that would make a second record the database refuses.
 */

describe('copiedFields', () => {
  // The order's key is an identity, the customer a lookup over the pinned
  // tenant and the customer number, and the version no field at all: the
  // identity is left out, and the lookup carried, on both engines -- a
  // rowversion on SQL Server, a confirmed version column on PostgreSQL.
  test("an order's copy carries every field a clerk may give on create, and not its key", () => {
    const expected = ['customer', 'order_date', 'status', 'amount', 'notes', 'group', 'employee', 'approved_by', 'paid']
    expect(copiedFields(PG, orderForm(PG).bindings, ORDER_POLICY, CLERK)).toEqual(expected)
    expect(copiedFields(MS, orderForm(MS).bindings, ORDER_POLICY, CLERK)).toEqual(expected)
  })

  // A key a person types -- the customer number -- is one the clerk may
  // write, so only the key rule leaves it out: copied, the create would
  // name the record copied from, and the database would refuse it as a
  // second one. The pinned tenant and the stamp nobody may write go too.
  test('a key a person types is left out, as are the fields nobody may give', () => {
    const source = customerSource()
    expect(copiedFields(source, customerForm(source).bindings, CUSTOMER_POLICY, CLERK)).toEqual(['name', 'country', 'credit_limit', 'active'])
  })

  // A unique key is a key: a country's ISO code copied would be refused as
  // the copied country's, whichever key the form addresses records by.
  test('every column of a unique key is left out as well', () => {
    const country = generateForm(PG, { connection: 'erp', root: sales('country'), formId: 'sales-country', title: 'Country', lookups: [] }).bindings
    const policy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: ['clerk'], update: [] },
      fields: { id: { read: ['clerk'], write: [] }, iso_code: CLERK_RW, name: CLERK_RW },
      rowFilters: [],
      lookups: {},
    }
    expect(copiedFields(PG, country, policy, CLERK)).toEqual(['name'])
  })

  // A line's key is its order and its number, so both are left out, and so
  // is the total the database computes: what is left is what a person gives.
  test("a line's copy leaves out both parts of its key and the computed total", () => {
    expect(copiedFields(PG, lineForm(PG).bindings, LINE_POLICY, CLERK)).toEqual(['quantity', 'unit_price'])
  })

  // The policy's write grant is per person: a field this clerk may read and
  // not write would be over-posting on create, so it is not carried.
  test('a field this person may read and not write is left out', () => {
    const policy: FormPolicy = { ...ORDER_POLICY, fields: { ...ORDER_POLICY.fields, status: { read: ['clerk'], write: [] } } }
    expect(copiedFields(PG, orderForm(PG).bindings, policy, CLERK)).not.toContain('status')
  })

  // A column the account may UPDATE and not INSERT is a field written on
  // update alone (0027): the policy grants it, the create still refuses it.
  test('a field the account may not INSERT is left out, whatever the policy grants', () => {
    const source = snapshot('postgres', (objects: ObjectMeta[]) => restrict(objects, 'order', 'notes', { insert: false }))
    const bindings = orderForm(source).bindings
    expect(bindings.fields.find((binding) => binding.field === 'notes')?.writes).toEqual({ create: false, update: true })
    expect(copiedFields(source, bindings, ORDER_POLICY, CLERK)).not.toContain('notes')
  })

  // Nothing a person may not read reaches a page, so a copy holds none of
  // it; and one who may not create gives nothing. Intake creates and never
  // reads; an auditor reads and never creates.
  test('a person who may not read, or may not create, is given nothing to copy', () => {
    expect(copiedFields(PG, orderForm(PG).bindings, ORDER_POLICY, INTAKE)).toEqual([])
    expect(copiedFields(PG, orderForm(PG).bindings, ORDER_POLICY, AUDITOR)).toEqual([])
  })
})
