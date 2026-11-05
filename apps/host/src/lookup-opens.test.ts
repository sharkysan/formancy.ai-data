import { describe, expect, test } from 'vitest'
import type { LookupOpen } from '@formancy/data-client'
import { openChoices, opensBelow, openRefused } from './lookup-opens.js'

/*
 * What a record's panes offer under a lookup (0141): one Open per form the
 * server names for the field (0140), on the answer the field holds now, and
 * what a level says when the read behind it is refused. Pure;
 * open-lookup.test.tsx holds the page to it on both engines, under both
 * renderers.
 */

/** A line's order, which two order forms are over, and an order's customer, which one customers form is. */
const OPENS: LookupOpen[] = [
  {
    field: 'order',
    forms: [
      { id: 'pg-order', title: 'Order' },
      { id: 'pg-order-staff', title: 'Order' },
    ],
  },
  { field: 'customer', forms: [{ id: 'pg-customer', title: 'Customers' }] },
]

describe('the Opens under a lookup', () => {
  // One per form, each carrying the answer it reads by: a choice without
  // the token would open the form, not the record.
  test('are one per form named for the field, on its answer', () => {
    expect(openChoices(OPENS, 'customer', 'k1:7')).toEqual([{ form: { id: 'pg-customer', title: 'Customers' }, token: 'k1:7', label: 'Open in Customers' }])
  })

  // Two forms of one title would draw two buttons of one name, which a
  // person cannot tell apart and a screen reader reads twice: each says its
  // form's id then, as the Forms list names every form (watched failing
  // with the title alone).
  test("say their form's id where two forms share a title", () => {
    expect(openChoices(OPENS, 'order', 'k1:4711').map((choice) => choice.label)).toEqual(['Open in Order (pg-order)', 'Open in Order (pg-order-staff)'])
  })

  // An empty lookup points at no record, and a read by an empty token is
  // refused: nothing is offered for it, nor for an answer that is no token
  // (watched failing with the answer unchecked: an Open on an empty field).
  test('are none where the answer is empty or not a token', () => {
    for (const answer of ['', null, undefined, 4711, ['k1:7']]) expect(openChoices(OPENS, 'customer', answer), String(answer)).toEqual([])
  })

  // A field the server names no form for -- a lookup whose target no form
  // this person may read is over, or no lookup at all -- offers nothing.
  test('are none for a field no form is named for', () => {
    expect(openChoices(OPENS, 'notes', 'k1:7')).toEqual([])
    expect(openChoices([{ field: 'customer', forms: [] }], 'customer', 'k1:7')).toEqual([])
  })
})

describe('a refused Open', () => {
  // A form's row filters can hide the record its lookup points at, which
  // the server answers as no such record: the level says that the form
  // does not show it, not that it does not exist (watched failing with the
  // server's sentence passed through).
  test('says the form does not show a record it has not found', () => {
    expect(openRefused('Customers', { code: 'not-found', message: 'No such record.' })).toBe('Customers does not show you this record.')
  })

  // Anything else -- the form no longer the person's, a database that did
  // not answer -- is the server's own sentence, which says what happened.
  test("says anything else in the server's words", () => {
    expect(openRefused('Customers', { code: 'forbidden', message: 'You may not read this form.' })).toBe('You may not read this form.')
  })
})

describe('the Opens on a Drill down level', () => {
  // A line opened below its order holds that order in its parent field,
  // drawn disabled: Open there would open the record the level above
  // already shows, a level further down. Every other lookup of the level
  // keeps its Opens, and a level reached through a lookup has no parent
  // field. Watched failing with the level's opens passed through.
  test("leave out the level's parent field, and nothing else", () => {
    expect(opensBelow(OPENS, 'order')).toEqual([OPENS[1]])
    expect(opensBelow(OPENS, null)).toEqual(OPENS)
  })
})
