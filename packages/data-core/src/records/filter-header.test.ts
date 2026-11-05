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

  // What the line refuses the box refuses in the same words, so a person
  // learns one language; the name a refusal would quote is the column's.
  test('refuses what the line refuses, in its words', () => {
    expect(read('1000,50', AMOUNT)).toEqual({ ok: false, message: 'Write numbers with a point and no separators: 1000.50.' })
    expect(read('contains 5', AMOUNT)).toEqual({ ok: false, message: 'Amount offers =, >, >=, <, <=, is empty and is not empty, not contains.' })
    expect(read('> 1 and > 2', AMOUNT)).toEqual({ ok: false, message: 'Amount has two lower bounds: keep one.' })
    expect(read('>', AMOUNT)).toEqual({ ok: false, message: 'Amount > needs a value.' })
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
