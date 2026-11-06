import { describe, expect, test } from 'vitest'
import type { PublishedForm } from '@formancy/data-client'
import type { ChildForm } from './children.js'
import { childTabs, RECORD_TAB, tabMoved } from './tabs.js'

/*
 * Which tabs a record gets beside it (0142), from the children the menu
 * names for its form, and where a key pressed on a tab moves the
 * selection (WAI-ARIA's tabs pattern).
 */

const definition = (labels: Readonly<Record<string, string>>): PublishedForm =>
  ({ form: { model: { fields: Object.entries(labels).map(([key, label]) => ({ key, type: 'text', label })) } } }) as unknown as PublishedForm

const child = (form: string, title: string, field: string, one = false, labels: Readonly<Record<string, string>> = {}): ChildForm => ({
  child: { form, field, one, when: null },
  menu: { id: form, title, group: 'Sales', operations: ['read'], children: [] },
  definition: definition(labels),
})

describe('childTabs', () => {
  // A section of the record (0109) holds the record's one row of its form,
  // drawn in the record's tab: given a tab of its own, an order's address
  // would be drawn apart from the order it is part of. The others keep the
  // menu's order and their place in its list, which their sections' ids
  // are minted from, so a tab moved or one left out mints no id twice.
  test("is every child the menu names but the record's own sections, in the menu's order", () => {
    const tabs = childTabs([
      child('pg-order-line', 'Order line', 'order'),
      child('pg-address', 'Address', 'order', true),
      child('pg-delivery', 'Delivery', 'order'),
    ])
    expect(tabs.map(({ key, name, index }) => ({ key, name, index }))).toEqual([
      { key: 'pg-order-line~order', name: 'Order line', index: 0 },
      { key: 'pg-delivery~order', name: 'Delivery', index: 2 },
    ])
    expect(tabs.map(({ key }) => key)).not.toContain(RECORD_TAB)
  })

  // An employee's orders through who created and who approved them are two
  // tabs of one form: named by the form's title alone, both would say
  // "Order", and a person would open one to find out which it is. Named as
  // each section's heading names it, by the field's label where the form is
  // reached twice (child-title.ts), and only there.
  test('names a form reached twice by the field it is reached through, as its heading does', () => {
    const labels = { created_by: 'Created by', approved_by: 'Approved by' }
    const tabs = childTabs([
      child('pg-employee', 'Employee', 'manager', false, { manager: 'Manager' }),
      child('pg-order-staff', 'Order', 'created_by', false, labels),
      child('pg-order-staff', 'Order', 'approved_by', false, labels),
    ])
    expect(tabs.map(({ name, twice }) => ({ name, twice }))).toEqual([
      { name: 'Employee', twice: false },
      { name: 'Order, Created by', twice: true },
      { name: 'Order, Approved by', twice: true },
    ])
  })

  // A record whose children are all its own sections draws no tablist, as
  // before: a row of one tab would be a control that does nothing.
  test('is none where every child is a section of the record', () => {
    expect(childTabs([child('pg-address', 'Address', 'order', true)])).toEqual([])
    expect(childTabs([])).toEqual([])
  })
})

describe('tabMoved', () => {
  const keys = [RECORD_TAB, 'lines', 'deliveries']

  // The arrows go round the ends, as the pattern says: Right on the last
  // tab going nowhere leaves a person who cannot see the row thinking it
  // ends there, and Left on the first likewise.
  test('moves Right and Left to the next and the previous tab, round the ends', () => {
    expect(tabMoved(keys, RECORD_TAB, 'ArrowRight')).toBe('lines')
    expect(tabMoved(keys, 'deliveries', 'ArrowRight')).toBe(RECORD_TAB)
    expect(tabMoved(keys, 'lines', 'ArrowLeft')).toBe(RECORD_TAB)
    expect(tabMoved(keys, RECORD_TAB, 'ArrowLeft')).toBe('deliveries')
  })

  // Home and End reach the ends from anywhere: a record with many child
  // forms is otherwise a row walked one tab at a time.
  test('moves Home and End to the first and the last tab', () => {
    expect(tabMoved(keys, 'deliveries', 'Home')).toBe(RECORD_TAB)
    expect(tabMoved(keys, RECORD_TAB, 'End')).toBe('deliveries')
  })

  // Every other key is the browser's: a tablist that took Tab would never
  // let the keyboard into the panel, and one that took Down a horizontal
  // row's arrow from a screen reader's reading.
  test('leaves every other key alone', () => {
    for (const key of ['Tab', 'Enter', ' ', 'ArrowDown', 'ArrowUp', 'a']) expect({ key, to: tabMoved(keys, 'lines', key) }).toEqual({ key, to: null })
  })
})
