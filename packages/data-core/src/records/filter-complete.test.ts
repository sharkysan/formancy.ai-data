import { describe, expect, test } from 'vitest'
import { completeFilterLine } from './filter-complete.js'
import type { LineField } from './filter-line.js'

/*
 * What the filter line offers at the caret: the next word a person could
 * type, and the characters it replaces. The line is learned by using it,
 * so each place in a condition offers exactly what may come there, and
 * nothing where anything may.
 */

const STATUS: LineField = {
  field: 'status',
  label: 'Status',
  operators: ['equals', 'contains', 'null', 'not-null'],
  input: 'text',
  values: [
    { value: 'placed', label: 'Placed' },
    { value: 'on_hold', label: 'On hold' },
  ],
}
const STATION: LineField = { field: 'station', label: 'Station', operators: ['equals'], input: 'text' }
const AMOUNT: LineField = { field: 'amount', label: 'Amount', operators: ['equals', 'range'], input: 'decimal' }
const NOTES: LineField = { field: 'notes', label: 'Notes', operators: ['contains'], input: 'text' }
const RUSH: LineField = { field: 'rush', label: 'Rush order', operators: ['equals'], input: 'boolean' }
const FIELDS = [STATUS, STATION, AMOUNT, NOTES, RUSH]

const at = (text: string, caret = text.length) => completeFilterLine(text, caret, FIELDS)
const labels = (text: string, caret?: number) => at(text, caret).options.map((option) => option.label)

describe('completeFilterLine', () => {
  // A name is offered by what has been typed of it, or of its label, with
  // the label beside it: the person knows the column, not the line's name
  // for it. Picked, it is followed by a space, ready for the operator.
  test('offers the fields whose name or label begins as typed', () => {
    expect(at('sta')).toEqual({
      from: 0,
      to: 3,
      options: [
        { insert: 'status ', label: 'status', hint: 'Status' },
        { insert: 'station ', label: 'station', hint: 'Station' },
      ],
    })
    expect(labels('')).toEqual(['status', 'station', 'amount', 'notes', 'rush_order'])
    expect(labels('status = placed and r')).toEqual(['rush_order'])
  })

  // After a name, its field's operators and nothing it does not offer,
  // each said in the words the chips use.
  test('offers what the field may be compared by', () => {
    expect(at('status ')).toEqual({
      from: 7,
      to: 7,
      options: [
        { insert: '= ', label: '=', hint: 'is' },
        { insert: 'contains ', label: 'contains', hint: 'contains' },
        { insert: 'is empty ', label: 'is empty', hint: 'has no value' },
        { insert: 'is not empty ', label: 'is not empty', hint: 'has a value' },
      ],
    })
    expect(labels('amount ')).toEqual(['=', '>', '>=', '<', '<='])
    expect(at('amount >')).toMatchObject({ from: 7, to: 8 })
    expect(labels('amount >')).toEqual(['>', '>='])
    expect(labels('status is ')).toEqual(['empty', 'not empty'])
  })

  // A state is offered by its label and inserted as its value, quoted
  // where it needs to be; a boolean is yes or no. Free text is not
  // guessed at: nothing is offered.
  test('offers the values a field holds, where it says them', () => {
    expect(at('status = ').options).toEqual([
      { insert: 'placed ', label: 'Placed', hint: 'placed' },
      { insert: 'on_hold ', label: 'On hold', hint: 'on_hold' },
    ])
    expect(at('status = on')).toMatchObject({ from: 9, to: 11, options: [{ insert: 'on_hold ', label: 'On hold' }] })
    expect(labels('rush_order = ')).toEqual(['yes', 'no'])
    expect(labels('notes contains ')).toEqual([])
    expect(labels('amount > ')).toEqual([])
  })

  // A lookup's records (0135) are offered by the labels the page shows and
  // inserted by them, as a person reads them back; two records sharing a
  // label are inserted by their tokens, which tell them apart, each token
  // beside its label (watched failing with every record inserted by its
  // token, which the line then showed).
  test('offers a lookup’s records by their labels, and inserts a shared one by its token', () => {
    const EMPLOYEE: LineField = {
      field: 'employee',
      label: 'Employee',
      operators: ['equals', 'null', 'not-null'],
      input: 'lookup',
      values: [
        { value: 'k1:1', label: 'Ada Lovelace' },
        { value: 'k1:2', label: 'Grace Hopper' },
        { value: 'k1:3', label: 'Grace Hopper' },
      ],
    }
    expect(completeFilterLine('employee = ', 11, [EMPLOYEE]).options).toEqual([
      { insert: '"Ada Lovelace" ', label: 'Ada Lovelace', hint: '' },
      { insert: 'k1:2 ', label: 'Grace Hopper', hint: 'k1:2' },
      { insert: 'k1:3 ', label: 'Grace Hopper', hint: 'k1:3' },
    ])
  })

  // After a whole condition comes `and`; inside a quote, anything may, and
  // an option offered there would break the value the person is typing
  // (watched failing with a quote read as a word: names were offered).
  test('offers and after a condition, and nothing inside a quote', () => {
    expect(at('status = placed ').options).toEqual([{ insert: 'and ', label: 'and', hint: 'and another condition that holds too' }])
    expect(labels('notes contains "salt a')).toEqual([])
    expect(labels('stat = placed or ')).toEqual([])
  })

  // The caret may be inside a word: what is offered is what begins as the
  // word does up to the caret, and picking it replaces the whole word --
  // without a second space where one already follows it.
  test('replaces the whole word the caret is in', () => {
    expect(at('stat = placed', 2)).toMatchObject({ from: 0, to: 4, options: [{ insert: 'status' }, { insert: 'station' }] })
  })
})
