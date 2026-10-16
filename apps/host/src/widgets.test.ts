import type { FormSchema } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { disableFields } from './widgets.js'

/** A form with a few kinds of field. */
function form(): FormSchema {
  return {
    $schema: 'https://formancy.ai/schema/0.3.0',
    id: 'order',
    title: 'Order',
    model: {
      fields: [
        { key: 'customer', type: 'select', label: 'Customer', optionsSource: 'erp-sales-order-fk-order-customer' },
        { key: 'status', type: 'select', label: 'Status', options: [{ value: 'placed', label: 'placed' }] },
        { key: 'region', type: 'select', label: 'Region', optionsSource: 'regions', widget: 'radio' },
        { key: 'notes', type: 'text', label: 'Notes' },
      ],
    },
    layouts: [],
  } as unknown as FormSchema
}

describe("the host's disabled fields", () => {
  // A child's parent field, and every field of a record the person may only
  // read, are drawn as the generator draws a field nothing may write: by a
  // `disabled` rule. Added on the host's copy and nowhere else, and once.
  test('adds a disabled rule for each field once, and leaves the published form alone', () => {
    const published = { ...form(), logic: { rules: [{ target: 'status', kind: 'disabled', cel: 'true' }] } } as unknown as FormSchema
    const before = JSON.stringify(published)
    const drawn = disableFields(published, ['customer', 'status'])
    expect(drawn.logic?.rules.map((rule) => `${rule.target} ${rule.kind} ${String(rule.cel)}`)).toEqual(['status disabled true', 'customer disabled true'])
    expect(JSON.stringify(published)).toBe(before)
    expect(disableFields(published, [])).toBe(published)
  })
})
