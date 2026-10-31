import { describe, expect, test } from 'vitest'
import type { FieldDef } from '@formancy/spec'
import { crumbOf, recordName, shownCrumbs } from './crumbs.js'
import type { Crumb } from './crumbs.js'

/*
 * What Drill down's trail calls each level (0090): a record by its first
 * required plain text field -- a customer's name -- or by its token, which
 * names any record, and a new one as new. Pure; drill.test.tsx holds the
 * rule to the published forms on both engines.
 */

/** A customer as the generator draws one: a number held as text by a pattern, an e-mail, a status a person may leave as it is, the name, and the order it belongs to. */
const FIELDS: FieldDef[] = [
  { key: 'customer_no', type: 'text', required: true, pattern: '^-?[0-9]+$' },
  { key: 'email', type: 'text', required: true, format: 'email' },
  { key: 'status', type: 'text' },
  { key: 'owner', type: 'text', required: true },
  { key: 'name', type: 'text', required: true },
  { key: 'credit', type: 'number', required: true },
]
const ANSWERS = { customer_no: '4711', email: 'a@example.com', status: 'active', owner: 'k1:9', name: 'Muster AG', credit: 3 }

describe("a level's name", () => {
  // The first field that names a record in words: a pattern or a format
  // says a number, an e-mail or an id; a field the form does not require
  // may hold a default ("placed") that names nothing; and the parent's
  // field names the level above, not this one. A rule that took the first
  // text field would call every customer "4711" (watched failing: no module).
  test('is the first required plain text field, not the parent', () => {
    expect(recordName(FIELDS, ANSWERS, 'owner')).toBe('Muster AG')
    expect(recordName(FIELDS, ANSWERS, null)).toBe('k1:9')
  })

  // Nothing to name it by: the trail then says the token, which always does.
  test('is none when that field is empty, blank or not text', () => {
    expect(recordName(FIELDS, { ...ANSWERS, name: '  ' }, 'owner')).toBeNull()
    expect(recordName(FIELDS, { ...ANSWERS, name: null }, 'owner')).toBeNull()
    expect(recordName(FIELDS, { ...ANSWERS, name: 7 }, 'owner')).toBeNull()
    expect(
      recordName(
        FIELDS.filter((field) => field.key !== 'name' && field.key !== 'owner'),
        ANSWERS,
        null,
      ),
    ).toBeNull()
  })

  // A lookup's answer is another record's token, and a select's a code:
  // neither names this record. An order named by its customer's token would
  // read as the order's own (watched failing: the customer was taken).
  test('passes over a lookup and a select', () => {
    const fields: FieldDef[] = [
      { key: 'customer', type: 'text', required: true, optionsSource: 'pg-order.customer' },
      { key: 'kind', type: 'text', required: true, options: [{ value: 'a', label: 'A' }] },
      { key: 'title', type: 'text', required: true },
    ]
    expect(recordName(fields, { customer: 'k1:7', kind: 'a', title: 'Spring order' }, null)).toBe('Spring order')
    expect(recordName(fields.slice(0, 2), { customer: 'k1:7', kind: 'a' }, null)).toBeNull()
  })

  // A field the person may not read has no answer, so it names nothing --
  // the next field that qualifies does, rather than an empty crumb.
  test('passes over a field the person may not read', () => {
    const { owner: _owner, ...unread } = ANSWERS
    expect(recordName(FIELDS, unread, null)).toBe('Muster AG')
  })

  // A crumb says the form and what names the record, so two levels of one
  // form read apart; the token is code, as the page sets every token; and
  // a new record is new, never an empty name (watched failing: no module).
  test('is said with the form, the token as code, or as new', () => {
    expect(crumbOf(2, 'Customer', { token: 'k1:4711', name: 'Muster AG' })).toEqual({ level: 2, said: ['Customer Muster AG'] })
    expect(crumbOf(3, 'Order line', { token: 'k1:4711,2', name: null })).toEqual({ level: 3, said: ['Order line ', { code: 'k1:4711,2' }] })
    expect(crumbOf(3, 'Order line', null)).toEqual({ level: 3, said: ['New Order line'] })
  })
})

describe('the trail on a phone', () => {
  const crumbs: Crumb[] = [0, 1, 2, 3, 4].map((level) => ({ level, said: [`Level ${String(level)}`] }))

  // Past three crumbs a phone draws the first, a button for the rest, and
  // the last two: where the person came from and where they are. Pressed,
  // every crumb; on a wide window, always every crumb.
  test('draws its ends and what it left out, until asked for all', () => {
    expect(shownCrumbs(crumbs, true, false)).toEqual([crumbs[0], { more: 5 }, crumbs[3], crumbs[4]])
    expect(shownCrumbs(crumbs, true, true)).toEqual(crumbs)
    expect(shownCrumbs(crumbs, false, false)).toEqual(crumbs)
    expect(shownCrumbs(crumbs.slice(0, 3), true, false)).toEqual(crumbs.slice(0, 3))
    expect(shownCrumbs(crumbs.slice(0, 4), true, false)).toEqual([crumbs[0], { more: 4 }, crumbs[2], crumbs[3]])
  })
})
