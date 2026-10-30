import { expect, test } from 'vitest'
import { fieldHeading } from './heading.js'

// A label is Text: a string, or `{ $t }`. A page that wrote `String(label)`
// headed a column, a filter and a title "[object Object]" for the second.
test('a field is called by its string label, otherwise by its key', () => {
  expect(fieldHeading({ key: 'status', label: 'Order status' })).toBe('Order status')
  expect(fieldHeading({ key: 'status', label: { $t: 'order.status' } })).toBe('status')
  expect(fieldHeading({ key: 'status' })).toBe('status')
})
