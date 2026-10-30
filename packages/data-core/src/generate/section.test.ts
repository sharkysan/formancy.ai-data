import { describe, expect, test } from 'vitest'
import type { ColumnMeta, ObjectMeta } from '../metadata.js'
import { BOOLEAN, col, companyForm, sectioned, text } from '../records/test-support.js'
import { generateForm } from './generate.js'
import type { FieldBinding } from './types.js'

/*
 * A form generated as a section of the records its foreign key references
 * (0109): what the lookup's binding says, and every request the generator
 * refuses rather than publish a section of something it cannot be one of.
 */

const lookupOf = (bindings: { fields: FieldBinding[] }) =>
  bindings.fields.find((binding) => binding.kind === 'lookup') as Extract<FieldBinding, { kind: 'lookup' }>

describe('a section', () => {
  // The condition travels typed as the referenced table holds the column, so
  // the menu reads the parent's answer as its form does; a section without
  // one is shown always; a lookup not marked carries nothing, so every form
  // generated before 0109 generates byte for byte as it did.
  test('is bound on its lookup, its condition typed by the referenced column', () => {
    for (const kind of ['postgres', 'sqlserver'] as const) {
      const source = sectioned(kind)
      expect(lookupOf(companyForm(source).bindings).section, kind).toEqual({ when: { column: 'kind', type: text(20), value: 'company' } })
      expect(lookupOf(companyForm(source, { when: null }).bindings).section).toEqual({ when: null })
      expect(Object.hasOwn(lookupOf(companyForm(source, null).bindings), 'section')).toBe(false)
    }
  })

  // A yes/no shows a section by `true` or `false`, as its form holds it.
  test('is shown by a yes/no spelled true or false', () => {
    const source = sectioned('postgres', (objects) => {
      ;(objects.find((object) => object.ref.name === 'customer') as ObjectMeta).columns.push(col('is_company', 9, BOOLEAN))
    })
    expect(lookupOf(companyForm(source, { when: { column: 'is_company', value: 'true' } }).bindings).section).toEqual({
      when: { column: 'is_company', type: BOOLEAN, value: 'true' },
    })
    expect(() => companyForm(source, { when: { column: 'is_company', value: 'TRUE' } })).toThrow('not spelled as')
  })

  // Each refusal is a section that could not be one: a foreign key that is
  // not the whole key lets one record have two rows; a column the referenced
  // table lacks, or the account may not read, shows nothing; a float or a
  // timestamp has more than one spelling of a value, and a value spelled
  // otherwise than the column holds it never matches. Watched failing with
  // the key check removed: the order form's customer was a section.
  test('is refused where it could not be one', () => {
    const source = sectioned('postgres', (objects) => {
      const customer = objects.find((object) => object.ref.name === 'customer') as ObjectMeta
      ;(customer.columns.find((column) => column.name === 'country_code') as ColumnMeta).access = { select: false, insert: true, update: true }
    })
    expect(() =>
      generateForm(source, {
        connection: 'erp',
        root: { schema: 'sales', name: 'order' },
        formId: 'sales-order',
        title: 'Order',
        lookups: [{ foreignKey: 'fk_order_customer', display: ['customer_no'], section: { when: null } }],
      }),
    ).toThrow('not the whole key of order')
    expect(() => companyForm(source, { when: { column: 'kinds', value: 'company' } })).toThrow('customer has no column kinds')
    expect(() => companyForm(source, { when: { column: 'country_code', value: 'CH' } })).toThrow('may not read customer.country_code')
    expect(() => companyForm(source, { when: { column: 'created_at', value: '2026-10-30T00:00:00Z' } })).toThrow('a section is shown by')
    expect(() => companyForm(source, { when: { column: 'credit_limit', value: '1' } })).toThrow('not spelled as')
    expect(() => companyForm(source, { when: { column: 'customer_no', value: '007' } })).toThrow('not spelled as')
    expect(() => companyForm(source, { when: { column: 'kind', value: 'x'.repeat(21) } })).toThrow('not spelled as')
  })

  // A record is a section of one record: two lookups marked would put one
  // row under two parents' pages.
  test('is one lookup of a form at most', () => {
    const source = sectioned('postgres', (objects) => {
      const company = objects.find((object) => object.ref.name === 'customer_company') as ObjectMeta
      company.foreignKeys.push({ ...company.foreignKeys[0], name: 'fk_customer_company_again' } as ObjectMeta['foreignKeys'][number])
    })
    expect(() =>
      generateForm(source, {
        connection: 'erp',
        root: { schema: 'sales', name: 'customer_company' },
        formId: 'company',
        title: 'Company',
        lookups: [
          { foreignKey: 'fk_customer_company_customer', display: ['name'], section: { when: null } },
          { foreignKey: 'fk_customer_company_again', display: ['name'], section: { when: null } },
        ],
      }),
    ).toThrow('are both marked as sections')
  })
})
