import { expect, test } from 'vitest'
import { fieldHeading } from './field-heading.js'

// A label is Text: a string, or `{ $t }`, a reference into the form's message
// catalogue (0079). The page headed a column, a filter and a child's title
// "[object Object]" where it wrote `String(label)`.
test('a field is called by its string label, otherwise by its key', () => {
  expect(fieldHeading({ key: 'status', label: 'Order status' })).toBe('Order status')
  expect(fieldHeading({ key: 'status', label: { $t: 'order.status' } })).toBe('status')
  expect(fieldHeading({ key: 'status' })).toBe('status')
})
