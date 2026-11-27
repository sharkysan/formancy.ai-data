import { describe, expect, test } from 'vitest'
import type { LookupOpen } from '@formancy/data-client'
import { besideChoice, besideOpen, namedOpens, openChoices, opensBelow, openRefused, underOpens } from './lookup-opens.js'

/*
 * What a record's panes offer under a lookup (0141): one Open per form the
 * server names for the field (0140), on the answer the field holds now,
 * each named apart from every other Open of the pane, and what a level says
 * when the read behind it is refused; and which of them sits beside the
 * field's box and which under it (0157). Pure;
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

/** A staff order's two lookups, both of employees: who created it and who approved it. */
const STAFF: LookupOpen[] = [
  { field: 'created_by', forms: [{ id: 'pg-employee', title: 'Employee' }] },
  { field: 'approved_by', forms: [{ id: 'pg-employee', title: 'Employee' }] },
]

/** The fields' labels, as the form gives them. */
const LABELS: Readonly<Record<string, string>> = {
  order: 'Order',
  reorder: 'Reorder of',
  customer: 'Customer',
  created_by: 'Created by',
  approved_by: 'Approved by',
  manager: 'Manager',
}
const labelOf = (field: string): string => LABELS[field] ?? field

/** Every Open's name the forms named would draw, each lookup answering a token. */
const names = (opens: LookupOpen[]): string[] =>
  namedOpens(opens, labelOf).flatMap(({ field }) => openChoices(namedOpens(opens, labelOf), field, 'k1:1').map((choice) => choice.label))

describe('the Opens under a lookup', () => {
  // One per form, each carrying the answer it reads by: a choice without
  // the token would open the form, not the record.
  test('are one per form named for the field, on its answer', () => {
    expect(openChoices(namedOpens(OPENS, labelOf), 'customer', 'k1:7')).toEqual([
      { form: { id: 'pg-customer', title: 'Customers' }, token: 'k1:7', label: 'Open in Customers' },
    ])
  })

  // Two forms of one title would draw two buttons of one name, which a
  // person cannot tell apart and a screen reader reads twice: each says its
  // form's id then, as the Forms list names every form (watched failing
  // with the title alone).
  test("say their form's id where two forms share a title", () => {
    expect(openChoices(namedOpens(OPENS, labelOf), 'order', 'k1:4711').map((choice) => choice.label)).toEqual([
      'Open in Order (pg-order)',
      'Open in Order (pg-order-staff)',
    ])
  })

  // Two lookups of one record into one form -- who created a staff order
  // and who approved it -- would draw "Open in Employee" twice: each says
  // its lookup's label first. Decided from the forms named and the labels,
  // never from which lookups answer, so a name does not change as the
  // person types: the approver's Open is named for it while the creator is
  // still empty (watched failing with forms told apart within one lookup
  // alone).
  test("say their lookup's label where another lookup opens in a form of that title", () => {
    expect(names(STAFF)).toEqual(['Open Created by in Employee', 'Open Approved by in Employee'])
    expect(openChoices(namedOpens(STAFF, labelOf), 'approved_by', 'k1:1').map((choice) => choice.label)).toEqual(['Open Approved by in Employee'])
    // A form of that title by another id is said the same, or the two buttons would still read alike.
    expect(
      names([
        { field: 'created_by', forms: [{ id: 'pg-employee', title: 'Employee' }] },
        { field: 'manager', forms: [{ id: 'pg-staff', title: 'Employee' }] },
      ]),
    ).toEqual(['Open Created by in Employee', 'Open Manager in Employee'])
  })

  // Both at once -- two forms of one title under a lookup, and another
  // lookup into a form of that title -- say both, and every Open of the
  // pane still has a name of its own (watched failing with the field's
  // label left out where the id is said).
  test('say the label and the id where both are shared', () => {
    const both: LookupOpen[] = [...OPENS, { field: 'reorder', forms: [{ id: 'pg-order', title: 'Order' }] }]
    expect(names(both)).toEqual(['Open Order in Order (pg-order)', 'Open Order in Order (pg-order-staff)', 'Open in Customers', 'Open Reorder of in Order'])
    for (const opens of [OPENS, STAFF, both]) expect(new Set(names(opens)).size).toBe(names(opens).length)
  })

  // An empty lookup points at no record, and a read by an empty token is
  // refused: nothing is offered for it, nor for an answer that is no token
  // (watched failing with the answer unchecked: an Open on an empty field).
  test('are none where the answer is empty or not a token', () => {
    for (const answer of ['', null, undefined, 4711, ['k1:7']]) expect(openChoices(namedOpens(OPENS, labelOf), 'customer', answer), String(answer)).toEqual([])
  })

  // A field the server names no form for -- a lookup whose target no form
  // this person may read is over, or no lookup at all -- offers nothing.
  test('are none for a field no form is named for', () => {
    expect(openChoices(namedOpens(OPENS, labelOf), 'notes', 'k1:7')).toEqual([])
    expect(openChoices(namedOpens([{ field: 'customer', forms: [] }], labelOf), 'customer', 'k1:7')).toEqual([])
  })
})

describe('the Open beside a lookup, and the Opens under it', () => {
  // The first form the server names sits beside the box, the rest under
  // the field in the server's order, each on the answer: the two together
  // are every Open 0141 offers, none twice and none lost (watched failing
  // with the beside's form taken from the last named, and with every Open
  // left under the field too).
  test('are the first form named beside, and the rest under, in the server’s order', () => {
    const named = namedOpens(OPENS, labelOf)
    expect(besideOpen(named, 'order', 'k1:4711')).toEqual({ form: { id: 'pg-order', title: 'Order' }, label: 'Open in Order (pg-order)', token: 'k1:4711' })
    expect(underOpens(named, 'order', 'k1:4711')).toEqual([
      { form: { id: 'pg-order-staff', title: 'Order' }, token: 'k1:4711', label: 'Open in Order (pg-order-staff)' },
    ])
    expect(besideOpen(named, 'customer', 'k1:7')).toEqual({ form: { id: 'pg-customer', title: 'Customers' }, label: 'Open in Customers', token: 'k1:7' })
    expect(underOpens(named, 'customer', 'k1:7')).toEqual([])
    const beside = besideOpen(named, 'order', 'k1:4711')
    expect([beside === null ? null : besideChoice(beside), ...underOpens(named, 'order', 'k1:4711')]).toEqual(openChoices(named, 'order', 'k1:4711'))
  })

  // The Open beside stays while the field is empty, so the box keeps its
  // width as an answer comes and goes, and is unavailable then: no token
  // to read by, and nothing under the field. An answer that is no token is
  // as empty (watched failing with no beside for an empty field: a box
  // that widens as it is cleared).
  test('is there, without a token, while the answer is empty or not a token, and none are under it', () => {
    const named = namedOpens(OPENS, labelOf)
    for (const answer of ['', null, undefined, 4711, ['k1:7']]) {
      expect(besideOpen(named, 'order', answer), String(answer)).toEqual({
        form: { id: 'pg-order', title: 'Order' },
        label: 'Open in Order (pg-order)',
        token: null,
      })
      expect(underOpens(named, 'order', answer), String(answer)).toEqual([])
    }
  })

  // A press on the Open beside an empty field opens nothing: a read by no
  // token is refused, and the person meant no record. Once it holds one,
  // the press opens what 0141's first Open opened (watched failing with
  // the choice made whatever the token).
  test('opens nothing while it has no token, and the record its answer names once it has', () => {
    const named = namedOpens(OPENS, labelOf)
    const empty = besideOpen(named, 'customer', '')
    const answered = besideOpen(named, 'customer', 'k1:7')
    expect(empty === null ? 'no beside' : besideChoice(empty)).toBeNull()
    expect(answered === null ? 'no beside' : besideChoice(answered)).toEqual(openChoices(named, 'customer', 'k1:7')[0])
  })

  // Nothing is beside a field the server names no form for, so its box is
  // as wide as any other's (watched failing with a beside for every field
  // of the offer, forms or none).
  test('are none for a field no form is named for', () => {
    expect(besideOpen(namedOpens(OPENS, labelOf), 'notes', 'k1:7')).toBeNull()
    expect(underOpens(namedOpens(OPENS, labelOf), 'notes', 'k1:7')).toEqual([])
    expect(besideOpen(namedOpens([{ field: 'customer', forms: [] }], labelOf), 'customer', 'k1:7')).toBeNull()
  })

  // The Open beside is named as 0141 names the first Open, the label
  // before the form where another lookup opens in a form of its title --
  // and while the field is empty too, so its name does not change as the
  // person picks an answer (watched failing with the form's title alone).
  test('are named as namedOpens names them, answered or not', () => {
    const staff = namedOpens(STAFF, labelOf)
    expect(besideOpen(staff, 'approved_by', '')?.label).toBe('Open Approved by in Employee')
    expect(besideOpen(staff, 'created_by', 'k1:2')?.label).toBe('Open Created by in Employee')
    const both = namedOpens([...OPENS, { field: 'reorder', forms: [{ id: 'pg-order', title: 'Order' }] }], labelOf)
    expect(besideOpen(both, 'order', null)?.label).toBe('Open Order in Order (pg-order)')
    expect(underOpens(both, 'order', 'k1:1').map((choice) => choice.label)).toEqual(['Open Order in Order (pg-order-staff)'])
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
