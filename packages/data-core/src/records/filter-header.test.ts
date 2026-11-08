import { describe, expect, test } from 'vitest'
import type { ListFilterTerm } from '../runtime.js'
import { headerCondition, headerText } from './filter-header.js'
import type { LineField } from './filter-line.js'

/*
 * A column header's filter box: the line's condition on one field, typed
 * without the field's name, since the column says it. What the box reads
 * is what the line would read with the name in front; a bare value is
 * what a person means by typing into a column's box -- found anywhere in
 * text, equal to anything else.
 */

const NOTES: LineField = { field: 'notes', label: 'Notes', operators: ['equals', 'contains', 'null', 'not-null'], input: 'text' }
const AMOUNT: LineField = { field: 'amount', label: 'Amount', operators: ['equals', 'range', 'null', 'not-null'], input: 'decimal' }
const ORDER_DATE: LineField = { field: 'order_date', label: 'Order date', operators: ['equals', 'range'], input: 'date' }

const read = (text: string, field: LineField) => headerCondition(text, field)
const term = (text: string, field: LineField): ListFilterTerm | null => {
  const box = read(text, field)
  if (!box.ok) throw new Error(box.message)
  return box.term
}

describe('headerCondition', () => {
  // A box left empty is no condition on its column: kept, it would filter
  // by an empty value nobody typed.
  test('reads an empty box as no condition', () => {
    expect(term('', NOTES)).toBeNull()
    expect(term('   ', AMOUNT)).toBeNull()
  })

  // A bare value is found anywhere in text and is equal to anything else,
  // whatever it holds -- spaces, the word `and` -- since the box is one
  // value. Watched failing with the box read as a line: "salt and pepper"
  // was a refusal.
  test('reads a bare value as contains on text and as equal elsewhere', () => {
    expect(term('rush', NOTES)).toEqual({ field: 'notes', op: 'contains', text: 'rush' })
    expect(term('salt and pepper', NOTES)).toEqual({ field: 'notes', op: 'contains', text: 'salt and pepper' })
    expect(term('"= x"', NOTES)).toEqual({ field: 'notes', op: 'contains', text: '= x' })
    expect(term('1000', AMOUNT)).toEqual({ field: 'amount', op: 'equals', value: '1000' })
    // `is` starts an operator only before `empty` or `not`: a note that
    // starts with the word is a note (watched failing with "Is this urgent"
    // refused as "After is comes empty or not empty.").
    expect(term('Is this urgent', NOTES)).toEqual({ field: 'notes', op: 'contains', text: 'Is this urgent' })
  })

  // An operator in front says the condition as the line does, a range's
  // two bounds joined by `and` with the column's name left out of both.
  test('reads an operator as the line reads it, without the name', () => {
    expect(term('= rush', NOTES)).toEqual({ field: 'notes', op: 'equals', value: 'rush' })
    expect(term('is empty', NOTES)).toEqual({ field: 'notes', op: 'null' })
    expect(term('IS NOT EMPTY', NOTES)).toEqual({ field: 'notes', op: 'not-null' })
    expect(term('> 1000', AMOUNT)).toEqual({ field: 'amount', op: 'range', from: '1000', to: null, exclusive: 'from' })
    expect(term('>= 2026-10-01 and < 2026-11-01', ORDER_DATE)).toEqual({
      field: 'order_date',
      op: 'range',
      from: '2026-10-01',
      to: '2026-11-01',
      exclusive: 'to',
    })
  })

  // A field's key need not be one word -- a browsed column's name is the
  // database's, `Order Date` (0147) -- and the box reads it by the name
  // the line calls it, `order_date`, so its condition is on that field.
  // Watched failing with the key put in front: every box on such a column
  // was "No field is called Order Date: it is order_date in the line."
  test('reads a box on a field whose key is not one word, by the name the line calls it', () => {
    const spaced: LineField = { field: 'Order Date', label: 'Order Date', operators: ['equals', 'range'], input: 'date' }
    expect(term('> 2026-10-01', spaced)).toEqual({ field: 'Order Date', op: 'range', from: '2026-10-01', to: null, exclusive: 'from' })
    expect(term('2026-10-01', spaced)).toEqual({ field: 'Order Date', op: 'equals', value: '2026-10-01' })
    expect(term('>= 2026-10-01 and < 2026-11-01', spaced)).toEqual({ field: 'Order Date', op: 'range', from: '2026-10-01', to: '2026-11-01', exclusive: 'to' })
  })

  // For a field whose key is one word -- every host field's -- the name in
  // front reads what the key in front read: a key unlike its label's name,
  // `total` for "Order total"; a field through a lookup, `customer.name`,
  // named by its key with its dot; and a label that is the line's own word,
  // "And", whose name is `and` before a second bound's `and`. Watched
  // failing with the label's name put in front without `lineNames`
  // (`customer_name`, which names nothing) and with the label itself
  // (`Order total`, two words); with the key put back they pass, as the
  // two readers agree on every one-word key.
  test('reads a host-shaped field to the terms the key in front read', () => {
    const total: LineField = { field: 'total', label: 'Order total', operators: ['equals', 'range', 'null', 'not-null'], input: 'decimal' }
    const through: LineField = { field: 'customer.name', label: 'Customer › Name', operators: ['equals', 'contains'], input: 'text' }
    const and: LineField = { field: 'rank', label: 'And', operators: ['equals', 'range'], input: 'integer' }
    expect(term('> 5 and <= 9', total)).toEqual({ field: 'total', op: 'range', from: '5', to: '9', exclusive: 'from' })
    expect(term('is empty', total)).toEqual({ field: 'total', op: 'null' })
    expect(term('muster', through)).toEqual({ field: 'customer.name', op: 'contains', text: 'muster' })
    expect(term('= "Muster AG"', through)).toEqual({ field: 'customer.name', op: 'equals', value: 'Muster AG' })
    expect(term('>= 1 and < 3', and)).toEqual({ field: 'rank', op: 'range', from: '1', to: '3', exclusive: 'to' })
    expect(term('2', and)).toEqual({ field: 'rank', op: 'equals', value: '2' })
    expect(read('> 1 and > 2', total)).toEqual({ ok: false, message: 'Order total has two lower bounds: keep one.' })
  })

  // What the line refuses the box refuses in the same words, so a person
  // learns one language; the name a refusal would quote is the column's.
  test('refuses what the line refuses, in its words', () => {
    expect(read('1000,50', AMOUNT)).toEqual({ ok: false, message: 'Write numbers with a point and no separators: 1000.50.' })
    expect(read('contains 5', AMOUNT)).toEqual({ ok: false, message: 'Amount offers =, >, >=, <, <=, is empty and is not empty, not contains.' })
    expect(read('> 1 and > 2', AMOUNT)).toEqual({ ok: false, message: 'Amount has two lower bounds: keep one.' })
    expect(read('>', AMOUNT)).toEqual({ ok: false, message: 'Amount > needs a value.' })
    expect(read('""', NOTES)).toEqual({ ok: false, message: 'Notes contains needs text to find.' })
    expect(read('contains "  "', NOTES)).toEqual({ ok: false, message: 'Notes contains needs text to find.' })
  })
})

describe('headerText', () => {
  // The box shows the condition its column has, however it was applied --
  // the line, a chip's Undo, a view -- and reads back to it: a box that
  // printed otherwise would change the filter the moment it was left.
  test('writes each condition a box reads back to it', () => {
    const shapes: Array<[ListFilterTerm, LineField, string]> = [
      [{ field: 'notes', op: 'contains', text: 'rush' }, NOTES, 'rush'],
      [{ field: 'notes', op: 'contains', text: 'salt and pepper' }, NOTES, 'salt and pepper'],
      [{ field: 'notes', op: 'contains', text: '= x' }, NOTES, '"= x"'],
      [{ field: 'notes', op: 'contains', text: ' padded ' }, NOTES, '" padded "'],
      [{ field: 'notes', op: 'contains', text: 'is this urgent' }, NOTES, 'is this urgent'],
      [{ field: 'notes', op: 'contains', text: 'is empty' }, NOTES, '"is empty"'],
      [{ field: 'notes', op: 'equals', value: 'rush' }, NOTES, '= rush'],
      [{ field: 'notes', op: 'null' }, NOTES, 'is empty'],
      [{ field: 'notes', op: 'not-null' }, NOTES, 'is not empty'],
      [{ field: 'amount', op: 'equals', value: '1000' }, AMOUNT, '1000'],
      [{ field: 'amount', op: 'range', from: '1', to: '9', exclusive: 'to' }, AMOUNT, '>= 1 and < 9'],
      [{ field: 'amount', op: 'range', from: null, to: '9' }, AMOUNT, '<= 9'],
    ]
    for (const [given, field, shown] of shapes) {
      expect(headerText(given, field)).toBe(shown)
      expect(term(shown, field)).toEqual(given)
    }
    expect(headerText(undefined, NOTES)).toBe('')
  })
})

describe('a lookup column’s box (0135)', () => {
  const EMPLOYEE: LineField = {
    field: 'employee',
    label: 'Employee',
    operators: ['equals', 'null', 'not-null'],
    input: 'lookup',
    values: [{ value: 'k1:1', label: 'Ada Lovelace' }],
  }

  // The box says the record by its label and reads the label back as the
  // record, as the line does (watched failing with the token in the box).
  test('says and reads a record by its label', () => {
    expect(headerText({ field: 'employee', op: 'equals', value: 'k1:1' }, EMPLOYEE)).toBe('Ada Lovelace')
    expect(term('Ada Lovelace', EMPLOYEE)).toEqual({ field: 'employee', op: 'equals', value: 'k1:1' })
    expect(term('is empty', EMPLOYEE)).toEqual({ field: 'employee', op: 'null' })
  })
})
