import { expect, test } from 'vitest'
import type { PublishedForm } from '@formancy/data-client'
import { childTitle } from './child-title.js'

const form = (label: unknown) => ({ form: { model: { fields: [{ key: 'created_by', type: 'text', label }] } } }) as unknown as PublishedForm

// Two sections of one form are told apart by the field they are reached
// through. A label that is a `{ $t }` reference titled the section "Order,
// [object Object]" where the title wrote `String(label)`.
test('a section reached twice is titled by its field: its label, or its key where the label is a message reference', () => {
  expect(childTitle('Order', true, form('Created by'), 'created_by')).toBe('Order, Created by')
  expect(childTitle('Order', true, form({ $t: 'order.created_by' }), 'created_by')).toBe('Order, created_by')
  expect(childTitle('Order', true, form('Created by'), 'unknown_field')).toBe('Order, unknown_field')
  expect(childTitle('Order', false, form('Created by'), 'created_by')).toBe('Order')
})
