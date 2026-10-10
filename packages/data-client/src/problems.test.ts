import { describe, expect, test } from 'vitest'
import type { Refusal } from './client.js'
import { fieldProblems } from './problems.js'

/*
 * What a host hands `engine.applyServerErrors`. The renderers print an error
 * entry verbatim, at 0.3.0 and at 0.4.0 -- beside the field and in the summary
 * -- so an entry has to be a sentence a person can read, and the server's is
 * the one that promises never to echo a value (0029).
 */

const refusal = (fieldErrors?: Refusal['fieldErrors']): Refusal => ({
  ok: false,
  status: 422,
  code: 'invalid-values',
  message: 'Some answers cannot be saved.',
  ...(fieldErrors === undefined ? {} : { fieldErrors }),
})

describe('fieldProblems', () => {
  // A refusal about the record as a whole -- a stale save, a 503 -- has no
  // field to mark. Anything but {} would put an error on no field, or invent one.
  test('a refusal without field errors concerns no field', () => {
    expect(fieldProblems(refusal())).toEqual({})
    expect(fieldProblems(refusal([]))).toEqual({})
  })

  // Applying the code would show `not-an-option` beside the field, because
  // the renderers print an entry as it is: the person would read an identifier.
  test('each field gets the server sentence, never the code', () => {
    const problems = fieldProblems(refusal([{ field: 'customer', code: 'not-an-option', message: 'This is not one of the options this form offers.' }]))
    expect(problems).toEqual({ customer: ['This is not one of the options this form offers.'] })
  })

  // A field with two problems keeps both, in the server's order, and the
  // fields stay in the order the server listed them -- the form's order, which
  // is the order the error summary reads them out. Grouping that kept only the
  // last sentence per field would hide a problem until the first was fixed.
  test('sentences are grouped by field, in the order the server gave them', () => {
    const problems = fieldProblems(
      refusal([
        { field: 'amount', code: 'too-long', message: 'This value is longer than the database stores.' },
        { field: 'customer', code: 'not-an-option', message: 'This is not one of the options this form offers.' },
        { field: 'amount', code: 'out-of-range', message: 'This value is outside the range the database stores.' },
      ]),
    )
    expect(Object.keys(problems)).toEqual(['amount', 'customer'])
    expect(problems['amount']).toEqual(['This value is longer than the database stores.', 'This value is outside the range the database stores.'])
  })

  // Two identical entries would print the same sentence twice beside one field.
  test('a sentence repeated for one field is shown once', () => {
    const twice = { field: 'customer', code: 'not-an-option', message: 'This is not one of the options this form offers.' }
    expect(fieldProblems(refusal([twice, twice]))).toEqual({ customer: ['This is not one of the options this form offers.'] })
  })
})
