import { describe, expect, test } from 'vitest'
import type { ListFilterTerm } from '../runtime.js'
import { lineNames, parseFilterLine, printFilterLine } from './filter-line.js'
import type { LineField } from './filter-line.js'

/*
 * A grid's filter as a line a person types (`status = placed and amount >
 * 1000`), read into the terms a list request carries and written back from
 * them. The server never sees the line; what it receives is what the panel
 * would have sent, so the line can only offer what the fields offer.
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
const AMOUNT: LineField = { field: 'amount', label: 'Amount', operators: ['equals', 'range', 'null', 'not-null'], input: 'decimal' }
const ORDER_DATE: LineField = { field: 'order_date', label: 'Order date', operators: ['equals', 'range'], input: 'date' }
const NOTES: LineField = { field: 'notes', label: 'Notes', operators: ['equals', 'contains', 'null', 'not-null'], input: 'text' }
const APPROVED_BY: LineField = { field: 'approved_by', label: 'Approved by', operators: ['equals', 'contains', 'null', 'not-null'], input: 'text' }
const RUSH: LineField = { field: 'rush', label: 'Rush', operators: ['equals', 'null', 'not-null'], input: 'boolean' }
const SECOND: LineField = { field: 'employee_2', label: 'Second employee', operators: ['equals', 'null', 'not-null'], input: 'integer' }
const FIELDS = [STATUS, AMOUNT, ORDER_DATE, NOTES, APPROVED_BY, RUSH, SECOND]

const parsed = (text: string) => parseFilterLine(text, FIELDS)
const terms = (text: string): ListFilterTerm[] => {
  const read = parsed(text)
  if (!read.ok) throw new Error(read.message)
  return read.filter
}
const named = (label: string, field = label): LineField => ({ field, label, operators: ['equals'], input: 'text' })

describe('lineNames', () => {
  // A label is what a person sees above the column, so it is what they
  // type: lower-cased, every run of what is not a letter or a digit one
  // `_`, a letter of any script kept. Watched failing with ASCII letters
  // alone kept: "Größe (cm)" became "gr_e_cm", which nobody would type.
  test('names a field by its label, as a person would type it', () => {
    const names = lineNames([named('Order date', 'a'), named('Größe (cm)', 'b'), named('E-Mail', 'c'), named('Order #', 'd')])
    expect([...names.values()]).toEqual(['order_date', 'größe_cm', 'e_mail', 'order'])
  })

  // Letters that carry their marks -- Devanagari, Thai, a decomposed é --
  // are one letter with them, so a label in any script is a name a person
  // can type. Watched failing with marks taken for separators: "नाम" was
  // "न_म" and "Café" typed decomposed lost its accent.
  test('keeps a letter whole with its marks, however it was typed', () => {
    const names = lineNames([named('नाम', 'a'), named('ชื่อ', 'b'), named('Cafe\u0301', 'c')])
    expect([...names.values()]).toEqual(['नाम', 'ชื่อ', 'café'])
    expect(parseFilterLine('cafe\u0301 = x', [named('Café', 'c')])).toEqual({ ok: true, filter: [{ field: 'c', op: 'equals', value: 'x' }] })
  })

  // A name must say one field. Two labels that give one name, a label with
  // no letter or digit in it, or a name that is another field's key, would
  // each leave a person typing one thing and the line reading another, so
  // each of those fields is named by its key, which is unique.
  test('names a field by its key where its label would say another field too', () => {
    const names = lineNames([
      named('Name', 'first_name'),
      named('Name', 'last_name'),
      named('#', 'hash'),
      named('First name', 'given'),
      named('Status', 'state'),
    ])
    expect([...names.entries()]).toEqual([
      ['first_name', 'first_name'],
      ['last_name', 'last_name'],
      ['hash', 'hash'],
      ['given', 'given'],
      ['state', 'status'],
    ])
  })
})

describe('lineNames, through a lookup', () => {
  // A field through a lookup (0139) is named by the lookup's name in the
  // line, a dot, and its column's key -- `customer.name` -- which no
  // label's name could be, a name holding no dot: the line says which
  // lookup a condition goes through, under the name a person types for the
  // lookup. A lookup the line does not name lends its key. Read and
  // printed by that name. Watched failing with the field named by its
  // label: `customer_name`.
  test('names a field through a lookup by the lookup’s name and its column’s key', () => {
    const through = [
      named('Customer', 'customer_no'),
      named('Customer › Name', 'customer_no.name'),
      named('Customer › E-Mail', 'customer_no.e_mail'),
      named('Gone › Name', 'gone.name'),
    ]
    expect([...lineNames(through).entries()]).toEqual([
      ['customer_no', 'customer'],
      ['customer_no.name', 'customer.name'],
      ['customer_no.e_mail', 'customer.e_mail'],
      ['gone.name', 'gone.name'],
    ])
    const contains = { ...(through[1] as LineField), operators: ['equals', 'contains'] } satisfies LineField
    expect(parseFilterLine('customer.name contains "Muster AG"', [through[0] as LineField, contains])).toEqual({
      ok: true,
      filter: [{ field: 'customer_no.name', op: 'contains', text: 'Muster AG' }],
    })
    expect(printFilterLine([{ field: 'customer_no.name', op: 'contains', text: 'Muster AG' }], [through[0] as LineField, contains])).toBe(
      'customer.name contains "Muster AG"',
    )
  })
})

describe('parseFilterLine', () => {
  // The line's own words become the terms the panel would have sent: an
  // equality, a comparison as a range that leaves out its bound (0130),
  // contains, and "is empty" for NULL.
  test('reads each condition into the term a list request carries', () => {
    expect(terms('status = placed and amount > 1000')).toEqual([
      { field: 'status', op: 'equals', value: 'placed' },
      { field: 'amount', op: 'range', from: '1000', to: null, exclusive: 'from' },
    ])
    expect(terms('approved_by is empty and notes is not empty')).toEqual([
      { field: 'approved_by', op: 'null' },
      { field: 'notes', op: 'not-null' },
    ])
    expect(terms('notes contains rush')).toEqual([{ field: 'notes', op: 'contains', text: 'rush' }])
    expect(terms('')).toEqual([])
    expect(terms('   ')).toEqual([])
  })

  // A field is named once in a filter (0104), so a lower and an upper
  // comparison on one field are one range; read as two terms, the server
  // would refuse the line a person meant.
  test('reads a lower and an upper comparison on one field as one range', () => {
    expect(terms('order_date >= 2026-10-01 and order_date < 2026-11-01')).toEqual([
      { field: 'order_date', op: 'range', from: '2026-10-01', to: '2026-11-01', exclusive: 'to' },
    ])
    expect(terms('amount < 9 and amount > 1')).toEqual([{ field: 'amount', op: 'range', from: '1', to: '9', exclusive: 'both' }])
    expect(terms('amount >= 1 and amount <= 9')).toEqual([{ field: 'amount', op: 'range', from: '1', to: '9' }])
  })

  // A quoted value is one value whatever it holds -- spaces, the word
  // `and`, a quote -- so a note can be found by its words. Watched failing
  // with `and` read as a joiner inside the quotes.
  test('reads a quoted value as one value, its quotes and backslashes escaped', () => {
    expect(terms('notes contains "salt and pepper"')).toEqual([{ field: 'notes', op: 'contains', text: 'salt and pepper' }])
    expect(terms('notes = "say \\"hi\\" \\\\ bye"')).toEqual([{ field: 'notes', op: 'equals', value: 'say "hi" \\ bye' }])
    expect(terms('notes = ""')).toEqual([{ field: 'notes', op: 'equals', value: '' }])
  })

  // What a person types is read the way they meant it: words in any case,
  // a field by its key as well as its name, operators without spaces, a
  // state by its label, and a yes or no for a boolean.
  test('reads a line typed any way a person would type it', () => {
    expect(terms('Status = placed AND Amount>1000')).toEqual(terms('status = placed and amount > 1000'))
    expect(terms('employee_2 = 7')).toEqual([{ field: 'employee_2', op: 'equals', value: '7' }])
    expect(terms('second_employee is not empty')).toEqual([{ field: 'employee_2', op: 'not-null' }])
    expect(terms('status = "On hold"')).toEqual([{ field: 'status', op: 'equals', value: 'on_hold' }])
    expect(terms('rush = yes')).toEqual([{ field: 'rush', op: 'equals', value: 'true' }])
    expect(terms('rush = False')).toEqual([{ field: 'rush', op: 'equals', value: 'false' }])
  })

  // Each refusal marks the characters it is about and says what would be
  // read instead, so a person fixes the line rather than starting again;
  // none sends anything.
  test('refuses what it cannot read, marking where', () => {
    expect(parsed('stat = placed')).toEqual({
      ok: false,
      at: 0,
      length: 4,
      message: 'No field is called stat. Fields: status, amount, order_date, notes, approved_by, rush, second_employee.',
    })
    expect(parsed('status > 5')).toEqual({ ok: false, at: 7, length: 1, message: 'Status offers =, contains, is empty and is not empty, not >.' })
    expect(parsed('status != placed')).toEqual({ ok: false, at: 7, length: 2, message: 'Status offers =, contains, is empty and is not empty, not !=.' })
    expect(parsed('status = a and status = b')).toEqual({ ok: false, at: 15, length: 6, message: 'Status is named twice: keep one.' })
    expect(parsed('amount > 1 and amount >= 2')).toEqual({ ok: false, at: 15, length: 6, message: 'Amount has two lower bounds: keep one.' })
    expect(parsed('notes = "abc')).toEqual({ ok: false, at: 8, length: 4, message: 'This quote is not closed.' })
    expect(parsed('status = placed and')).toEqual({ ok: false, at: 16, length: 3, message: 'A condition comes after and.' })
    expect(parsed('status = placed or rush = yes')).toEqual({
      ok: false,
      at: 16,
      length: 2,
      message: 'There is no or: conditions are joined by and, and every one holds.',
    })
    expect(parsed('status = placed rush = yes')).toEqual({ ok: false, at: 16, length: 4, message: 'Join conditions with and.' })
    expect(parsed('status')).toEqual({ ok: false, at: 0, length: 6, message: 'After status comes =, contains, is empty or is not empty.' })
    expect(parsed('amount >')).toEqual({ ok: false, at: 7, length: 1, message: 'Amount > needs a value.' })
    // Text that is only spaces finds nothing the server would look for: it
    // refuses it, so the line does first (watched failing with the empty
    // text read, sent, and refused in the server's words by the field's key).
    expect(parsed('notes contains ""')).toEqual({ ok: false, at: 15, length: 2, message: 'Notes contains needs text to find.' })
    expect(parsed('notes contains "  "')).toEqual({ ok: false, at: 15, length: 4, message: 'Notes contains needs text to find.' })
    expect(parsed('status is full')).toEqual({ ok: false, at: 10, length: 4, message: 'After is comes empty or not empty.' })
    expect(parsed('rush = maybe')).toEqual({ ok: false, at: 7, length: 5, message: 'Rush is yes or no.' })
  })

  // A person types the label as they see it -- with its hyphen, its
  // space in quotes -- and is told the name the line knows it by, rather
  // than handed the list of every field to find it in.
  test('tells a person who types a label another way what its name is', () => {
    // The likeliest other spelling is the label itself, its space and all:
    // told the name, not handed every field (watched failing with "No field
    // is called order. Fields: …").
    expect(parsed('order date >= 2026-10-01')).toEqual({
      ok: false,
      at: 0,
      length: 10,
      message: 'No field is called order date: it is order_date in the line.',
    })
    expect(parsed('Approved by is empty')).toEqual({ ok: false, at: 0, length: 11, message: 'No field is called Approved by: it is approved_by in the line.' })
    expect(parsed('order-date >= 2026-10-01')).toEqual({
      ok: false,
      at: 0,
      length: 10,
      message: 'No field is called order-date: it is order_date in the line.',
    })
    expect(parsed('"Order date" >= 2026-10-01')).toEqual({
      ok: false,
      at: 0,
      length: 12,
      message: 'No field is called "Order date": it is order_date in the line.',
    })
  })

  // A Swiss or German keyboard writes 1'000 and 1000,50; the server would
  // say only that the column cannot hold them. The line says how to write
  // the number it reads them as.
  test('says how to write a number typed with separators', () => {
    expect(parsed("amount > 1'000")).toEqual({ ok: false, at: 9, length: 5, message: 'Write numbers with a point and no separators: 1000.' })
    expect(parsed('amount > 1000,50')).toEqual({ ok: false, at: 9, length: 7, message: 'Write numbers with a point and no separators: 1000.50.' })
    expect(parsed("amount = 1'000,50")).toEqual({ ok: false, at: 9, length: 8, message: 'Write numbers with a point and no separators: 1000.50.' })
    expect(parsed('amount = 1,000.50')).toEqual({ ok: false, at: 9, length: 8, message: 'Write numbers with a point and no separators: 1000.50.' })
    expect(terms('amount = -1000.50')).toEqual([{ field: 'amount', op: 'equals', value: '-1000.50' }])
  })
})

describe('printFilterLine', () => {
  const CANONICAL = [
    'status = placed and amount > 1000',
    'order_date >= 2026-10-01 and order_date < 2026-11-01',
    'notes contains "salt and pepper"',
    'notes = "say \\"hi\\""',
    'notes = ""',
    'approved_by is empty and notes is not empty',
    'rush = yes and amount is not empty',
    'amount > 1 and amount < 9',
    'amount >= 1 and amount <= 9',
    'amount <= 9',
  ]

  // The line shows the filter applied, whatever applied it -- a chip, a
  // view, the panel -- so writing it and reading it again is the same
  // filter, and a line already canonical is written as typed.
  test('writes each canonical line back as it was typed', () => {
    for (const line of CANONICAL) expect(printFilterLine(terms(line), FIELDS)).toBe(line)
    expect(printFilterLine(terms('Status = "Placed"  AND amount>1000'), FIELDS)).toBe('status = placed and amount > 1000')
    expect(printFilterLine(terms('employee_2 = 7'), FIELDS)).toBe('second_employee = 7')
  })

  // Every shape a term has comes back from its line: one that did not
  // would change a view's filter the moment the line showed it.
  test('reads back every term it writes', () => {
    const every: ListFilterTerm[][] = [
      [{ field: 'status', op: 'equals', value: 'placed' }],
      [{ field: 'notes', op: 'equals', value: 'a "b" \\ c and d' }],
      [{ field: 'notes', op: 'contains', text: 'x=y' }],
      [{ field: 'notes', op: 'null' }],
      [{ field: 'notes', op: 'not-null' }],
      [{ field: 'rush', op: 'equals', value: 'false' }],
      [{ field: 'amount', op: 'range', from: '1', to: null }],
      [{ field: 'amount', op: 'range', from: null, to: '9' }],
      [{ field: 'amount', op: 'range', from: '1', to: '9' }],
      [{ field: 'amount', op: 'range', from: '1', to: null, exclusive: 'from' }],
      [{ field: 'amount', op: 'range', from: null, to: '9', exclusive: 'to' }],
      [{ field: 'amount', op: 'range', from: '1', to: '9', exclusive: 'both' }],
      [{ field: 'amount', op: 'range', from: '1', to: '9', exclusive: 'from' }],
      [
        { field: 'status', op: 'equals', value: 'on_hold' },
        { field: 'order_date', op: 'range', from: '2026-10-01', to: '2026-11-01', exclusive: 'to' },
      ],
    ]
    for (const filter of every) expect(parsed(printFilterLine(filter, FIELDS))).toEqual({ ok: true, filter })
  })

  // A condition on a field the line does not offer -- one an administrator
  // left out of the panel (0123), set by a view -- is shown as a chip, not
  // in the line, and does not keep the rest from being written.
  test('leaves out a term on a field the line does not offer', () => {
    const filter: ListFilterTerm[] = [
      { field: 'secret', op: 'equals', value: 'x' },
      { field: 'status', op: 'equals', value: 'placed' },
    ]
    expect(printFilterLine(filter, FIELDS)).toBe('status = placed')
  })
})

describe('a lookup in the line (0135)', () => {
  /** A lookup, with the records the page knows: those its rows showed, its filter's, and those picked in its box. */
  const EMPLOYEE: LineField = {
    field: 'employee',
    label: 'Employee',
    operators: ['equals', 'null', 'not-null'],
    input: 'lookup',
    values: [
      { value: 'k1:1', label: 'Ada Lovelace' },
      { value: 'k1:2', label: 'Grace Hopper' },
      { value: 'k1:3', label: 'Grace Hopper' },
      { value: 'k1:9', label: 'k1:9' },
    ],
  }
  const read = (text: string) => parseFilterLine(text, [EMPLOYEE, AMOUNT])

  // A person names a record as the page shows it, or by the token the
  // line wrote for one whose label it has not heard yet; either is the
  // record's token in the term, read as a state's label is (0129).
  test('reads a record by the label the page shows, or by its token', () => {
    expect(read('employee = "ada lovelace"')).toEqual({ ok: true, filter: [{ field: 'employee', op: 'equals', value: 'k1:1' }] })
    expect(read('employee = k1:9')).toEqual({ ok: true, filter: [{ field: 'employee', op: 'equals', value: 'k1:9' }] })
    expect(read('employee is empty and amount > 1')).toMatchObject({ ok: true, filter: [{ field: 'employee', op: 'null' }, { field: 'amount' }] })
  })

  // A label the page has not shown names no record it could send, and one
  // two records share names neither: sent, the first would be refused by
  // the server and the second filter by a record the person did not mean.
  // Watched failing with each sent as typed.
  test('refuses a label no record shown has, or two share', () => {
    expect(read('employee = Linus')).toEqual({
      ok: false,
      at: 11,
      length: 5,
      message: "No record of Employee shown here is called Linus: pick one in its column's box.",
    })
    expect(read('employee = "Grace Hopper"')).toEqual({
      ok: false,
      at: 11,
      length: 14,
      message: "Two records of Employee shown here are called Grace Hopper: pick one in its column's box.",
    })
  })

  // The line writes the label a person reads, never a token, unless the
  // page has no label for it yet; either reads back as the same record.
  test('writes a record by its label, and reads it back', () => {
    const ada: ListFilterTerm[] = [{ field: 'employee', op: 'equals', value: 'k1:1' }]
    expect(printFilterLine(ada, [EMPLOYEE])).toBe('employee = "Ada Lovelace"')
    expect(parseFilterLine(printFilterLine(ada, [EMPLOYEE]), [EMPLOYEE])).toEqual({ ok: true, filter: ada })
    const unheard: ListFilterTerm[] = [{ field: 'employee', op: 'equals', value: 'k1:9' }]
    expect(printFilterLine(unheard, [EMPLOYEE])).toBe('employee = k1:9')
  })

  // A label two records share, or one that is another record's token,
  // names no one record: the line writes the token, which reads back as
  // the record, where the label would be the line's own refusal (watched
  // failing with "Grace Hopper" written, then refused as shared).
  test('writes a record by its token where its label names no one record', () => {
    const grace: ListFilterTerm[] = [{ field: 'employee', op: 'equals', value: 'k1:2' }]
    expect(printFilterLine(grace, [EMPLOYEE])).toBe('employee = k1:2')
    expect(parseFilterLine(printFilterLine(grace, [EMPLOYEE]), [EMPLOYEE])).toEqual({ ok: true, filter: grace })
    const posing: LineField = {
      ...EMPLOYEE,
      values: [
        { value: 'k1:5', label: 'k1:6' },
        { value: 'k1:6', label: 'Bob' },
      ],
    }
    const five: ListFilterTerm[] = [{ field: 'employee', op: 'equals', value: 'k1:5' }]
    expect(parseFilterLine(printFilterLine(five, [posing]), [posing])).toEqual({ ok: true, filter: five })
  })
})
