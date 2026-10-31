import { expect, test } from 'vitest'
import type { PublishedForm } from '@formancy/data-client'
import { emptyLevelLine } from './tree-lines.js'

const form = (label: unknown) => ({ form: { model: { fields: [{ key: 'manager', type: 'text', label }] } } }) as unknown as PublishedForm

// A tree's level that holds no records names the field its records name
// their parent through. A label that is a `{ $t }` reference made the
// line "No records have no [object Object]." where it wrote `String(label)`.
test('a level with no records names the parent field by its label, or by its key where the label is a message reference', () => {
  expect(emptyLevelLine(form('Manager'), 'manager', null)).toBe('No records have no Manager.')
  expect(emptyLevelLine(form({ $t: 'employee.manager' }), 'manager', null)).toBe('No records have no manager.')
  expect(emptyLevelLine(form({ $t: 'employee.manager' }), 'manager', 'Ada')).toBe('No records name Ada as their manager.')
  expect(emptyLevelLine(form('Manager'), 'unknown_field', 'Ada')).toBe('No records name Ada as their unknown_field.')
})
