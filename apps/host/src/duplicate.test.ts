import { describe, expect, test } from 'vitest'
import type { FieldDef } from '@formancy/spec'
import { copiedLine, copyOf, leftOut } from './duplicate.js'

/*
 * Duplicate record (0107): a new record holding the answers the server
 * names, and the line that says which values stayed behind. Pure;
 * duplicate.test.tsx holds it to the published forms on both engines.
 */

/** An order as the generator draws one: its key, a lookup, an amount, a note, and a stamp nobody writes. */
const FIELDS: FieldDef[] = [
  { key: 'id', type: 'number', label: 'Id' },
  { key: 'customer', type: 'select', label: 'Customer', optionsSource: 'erp.customer' },
  { key: 'amount', type: 'number', label: 'Amount' },
  { key: 'notes', type: 'textarea', label: 'Notes' },
  { key: 'stamp', type: 'text' },
]
const RECORD = { record: 'k1:7', version: '3', answers: { id: 7, customer: 'k1:1,1001', amount: '12.5000', notes: null, stamp: '' } }
const COPIED = ['customer', 'amount', 'notes']

describe('a copy of a record', () => {
  // A new record: no token, so a save creates rather than updates the
  // record copied from, and no version, which only an update sends.
  // Watched failing with the token kept: the save would be an update.
  test('has no token and no version, so its save is a create', () => {
    expect(copyOf(RECORD, COPIED)).toMatchObject({ record: null, version: null })
  })

  // Exactly the fields the server named, each as read -- a null included,
  // which is the answer "nothing" -- and none it did not: the key copied
  // would be refused by the create as over-posting.
  test('holds exactly the answers the server names', () => {
    expect(copyOf(RECORD, COPIED).answers).toEqual({ customer: 'k1:1,1001', amount: '12.5000', notes: null })
  })

  // A field named that the record does not hold -- one this person may not
  // read arrives in no record -- is left absent, as on a new form, rather
  // than given `undefined`, which a renderer would treat as an answer.
  test('leaves out a field the record does not hold', () => {
    expect(Object.keys(copyOf({ ...RECORD, answers: { amount: '1' } }, COPIED).answers)).toEqual(['amount'])
  })
})

describe('what a copy leaves out', () => {
  // The fields that held a value and were not copied, by label in the
  // form's order: the key a person will not see carried. A field that was
  // empty lost nothing, so it is not named; one with no label is named by
  // its key, as the grid names it.
  test('is every field that held a value and was not copied, by label', () => {
    expect(leftOut(FIELDS, RECORD, COPIED)).toEqual(['Id'])
    expect(leftOut(FIELDS, { ...RECORD, answers: { ...RECORD.answers, stamp: 'by hand' } }, COPIED)).toEqual(['Id', 'stamp'])
    expect(leftOut(FIELDS, RECORD, ['id', ...COPIED])).toEqual([])
  })

  // A label that is a `{ $t }` reference names the field by its key, as the
  // grid does (0079), not as "[object Object]".
  test('names a field whose label is a message reference by its key', () => {
    const referenced = [{ key: 'id', type: 'text', label: { $t: 'order.id' } }] as unknown as typeof FIELDS
    expect(leftOut(referenced, RECORD, [])).toEqual(['id'])
  })

  // The status line: what was copied, into which forms, and what was not.
  test('is said after what was copied, and not at all when nothing was', () => {
    expect(copiedLine('k1:7', ['Id'], false)).toEqual(['Copied ', { code: 'k1:7' }, ' into the form, for a new record. Not copied: Id.'])
    expect(copiedLine('k1:7', ['Id', 'Code'], true)).toEqual(['Copied ', { code: 'k1:7' }, ' into both forms, for a new record. Not copied: Id, Code.'])
    expect(copiedLine('k1:7', [], false)).toEqual(['Copied ', { code: 'k1:7' }, ' into the form, for a new record.'])
  })
})
