import { describe, expect, test } from 'vitest'
import type { FormMenu, FormMenuEntry, LookupOpen } from '@formancy/data-client'
import { formList, linkedForms, linkWords, matchSaying, NO_GROUP } from './form-list.js'

/*
 * What the host's list of forms shows (0144): the menu's forms under their
 * groups, narrowed by what is typed into Find a form, and the forms linked
 * to the one open -- those its lookups open in and those whose rows refer
 * to its records. Pure, so the order, the matching and the links are held
 * here and the page suite holds only that the list draws them.
 */

const entry = (id: string, title: string, group: string | null, children: FormMenuEntry['children'] = []): FormMenuEntry => ({
  id,
  title,
  group,
  operations: ['read'],
  children,
})

const child = (form: string, field: string): FormMenuEntry['children'][number] => ({ form, field, one: false, when: null })

/** The headings a list draws, each with the ids under it. */
const drawn = (menu: readonly FormMenuEntry[], search = ''): Array<[string, string[]]> =>
  formList(menu, search).groups.map(({ heading, forms }) => [heading, forms.map(({ id }) => id)])

describe('formList', () => {
  // Groups in codepoint order put every capital before every small letter
  // and a letter with a mark after z: "Sales" before "accounts", "Ärzte"
  // last. A person reads a list of headings in the order of the alphabet,
  // so they are compared as English words, a number in them by its value.
  test('orders the groups as words, a number in them by its value', () => {
    const menu = [entry('a', 'A', 'Sales'), entry('b', 'B', 'accounts'), entry('c', 'C', 'Ärzte'), entry('d', 'D', 'Region 10'), entry('e', 'E', 'Region 2')]
    expect(drawn(menu).map(([heading]) => heading)).toEqual(['accounts', 'Ärzte', 'Region 2', 'Region 10', 'Sales'])
  })

  // One word spelled two ways, "Ärzte" typed composed for one form and as
  // A and a combining mark for another, is two groups (0143) that the
  // words call equal: without a tie-break their order would be whichever
  // the menu named first, and would move when a form was published.
  test('orders two groups the words call equal by their codepoints', () => {
    const composed = '\u00c4rzte'
    const decomposed = 'A\u0308rzte'
    for (const menu of [
      [entry('a', 'A', composed), entry('b', 'B', decomposed)],
      [entry('b', 'B', decomposed), entry('a', 'A', composed)],
    ])
      expect(drawn(menu).map(([heading]) => heading)).toEqual([decomposed, composed])
  })

  // The forms in no group are the rest of the list: sorted among the
  // groups as "Forms", they would sit between "Finance" and "Sales", and a
  // person would read the remainder as a group of its own.
  test('lists the forms in no group under Forms, after every group', () => {
    const menu = [entry('a', 'Note', null), entry('b', 'Invoice', 'Finance'), entry('c', 'Order', 'Sales')]
    expect(drawn(menu)).toEqual([
      ['Finance', ['b']],
      ['Sales', ['c']],
      [NO_GROUP, ['a']],
    ])
  })

  // An administrator who types "Forms" as a group names the heading the
  // forms in no group are under: listed apart, the list would draw two
  // headings that say the same and mean two things.
  test('lists a group spelled as the heading of no group with the forms in none', () => {
    const menu = [entry('a', 'Note', NO_GROUP), entry('b', 'Order', 'Sales'), entry('c', 'Memo', null)]
    expect(drawn(menu)).toEqual([
      ['Sales', ['b']],
      [NO_GROUP, ['a', 'c']],
    ])
  })

  // Within a group the forms keep the menu's order, the order of their
  // ids, which is how every other list of forms on the page names them
  // (the record's tabs, Open's choices). Sorted by title, two forms titled
  // alike would swap whenever one was renamed.
  test("keeps the menu's order within a group", () => {
    const menu = [entry('pg-order', 'Order', 'Sales'), entry('pg-customer', 'Customer', 'Sales'), entry('pg-address', 'Address', 'Sales')]
    expect(drawn(menu)).toEqual([['Sales', ['pg-order', 'pg-customer', 'pg-address']]])
  })

  // Where no form of the menu is in a group -- most databases' tables are
  // in the engine's own default schema (0143) -- a heading "Forms" under the
  // list's own "Forms" says nothing twice. Decided on the whole menu, never
  // on the forms a search left: a search would otherwise draw or drop
  // the heading as the person typed.
  test('draws the headings unless every form of the menu is in no group, whatever the search', () => {
    expect(formList([entry('a', 'Note', null), entry('b', 'Memo', null)], '').headed).toBe(false)
    const mixed = [entry('a', 'Note', null), entry('b', 'Order', 'Sales')]
    expect(formList(mixed, '').headed).toBe(true)
    expect(drawn(mixed, 'note')).toEqual([[NO_GROUP, ['a']]])
    expect(formList(mixed, 'note').headed).toBe(true)
  })

  // A person looking for the order lines types "line", "Line" or "LINE",
  // and a word from the middle of the title: a search from the start, or
  // one that minded the case, would find nothing for two of them.
  test('matches what is typed anywhere in a title, in any case', () => {
    const menu = [entry('a', 'Order line', 'Sales'), entry('b', 'Order', 'Sales'), entry('c', 'Lineage', 'Sales')]
    for (const typed of ['line', 'Line', 'LINE']) expect({ typed, ids: formList(menu, typed).matched.map(({ id }) => id) }).toEqual({ typed, ids: ['a', 'c'] })
  })

  // Two forms of one title, "Order" over the orders and over the staff's
  // orders, are told apart in the list by their ids alone, which every link
  // draws: a search over the titles alone could never find one of them.
  test('matches the id too', () => {
    const menu = [entry('pg-order', 'Order', 'Sales'), entry('pg-order-staff', 'Order', 'Sales'), entry('ms-order', 'Order', 'Sales')]
    expect(formList(menu, 'STAFF').matched.map(({ id }) => id)).toEqual(['pg-order-staff'])
    expect(formList(menu, 'pg-').matched.map(({ id }) => id)).toEqual(['pg-order', 'pg-order-staff'])
  })

  // A space typed before or after the words is no part of a title's
  // words: kept, " line" would not match "Lineage", which it begins.
  test('reads the search without the spaces around it', () => {
    expect(formList([entry('a', 'Lineage', 'Sales')], '  line ').matched.map(({ id }) => id)).toEqual(['a'])
  })

  // A keyboard that types ü as u and a combining mark, as some do, and a
  // title stored composed are the same letters: compared code unit by
  // code unit, "Zürich" would not hold "zü". A letter with a mark is
  // still another letter: the codebase has no fold of marks, and "zurich"
  // finds no "Zürich" -- held, so the record's cost stays true.
  test('compares letters composed, and keeps their marks', () => {
    const menu = [entry('a', 'Zürich office', 'Sales')]
    expect(formList(menu, 'zü').matched.map(({ id }) => id)).toEqual(['a'])
    expect(formList(menu, 'zurich').matched).toEqual([])
  })

  // An empty box is no search: every form, under every group.
  test('lists every form while nothing is typed', () => {
    const menu = [entry('a', 'Order', 'Sales'), entry('b', 'Note', null)]
    expect(formList(menu, '   ').matched.map(({ id }) => id)).toEqual(['a', 'b'])
    expect(drawn(menu, '   ')).toEqual([
      ['Sales', ['a']],
      [NO_GROUP, ['b']],
    ])
  })

  // A group none of whose forms match is drawn as a heading over nothing,
  // and the forms that match are counted, and Enter opens one, in the
  // order the list draws them, not the menu's.
  test('drops a group with no match, and gives the matches in the order they are drawn', () => {
    const menu = [entry('a', 'Order note', null), entry('b', 'Order', 'Sales'), entry('c', 'Invoice', 'Finance')]
    expect(drawn(menu, 'order')).toEqual([
      ['Sales', ['b']],
      [NO_GROUP, ['a']],
    ])
    expect(formList(menu, 'order').matched.map(({ id }) => id)).toEqual(['b', 'a'])
  })
})

describe('matchSaying', () => {
  // The status is polite and speaks only while there is a search: a count
  // said for an empty box would be heard each time the box was cleared.
  test('says nothing while nothing is typed', () => {
    expect(matchSaying('  ', 0, 12)).toBe('')
  })

  // "1 forms match" is a sentence nobody wrote; and the one match is where
  // Enter opens, which the line says, so a person learns it by typing.
  test('says how many of the forms match, and that Enter opens the one', () => {
    expect(matchSaying('ord', 3, 12)).toBe('3 of 12 forms match.')
    expect(matchSaying('line', 1, 12)).toBe('1 of 12 forms matches. Enter opens it.')
  })

  // A search that finds nothing says what it looked for, as typed but for
  // the spaces around it, so a slip of the keyboard is seen in the line.
  test('says what was looked for when nothing matches', () => {
    expect(matchSaying(' xyz ', 0, 12)).toBe('No form’s title or id holds “xyz”.')
  })
})

describe('linkedForms', () => {
  const opens = (field: string, ...ids: string[]): LookupOpen => ({ field, forms: ids.map((id) => ({ id, title: id })) })
  const menu = (...forms: FormMenuEntry[]): FormMenu => ({ forms })
  const ids = (linked: ReturnType<typeof linkedForms>): Array<[string, boolean, boolean]> => linked.map(({ entry: { id }, fields, rows }) => [id, fields, rows])

  // The forms the open form's lookups open in (0140) are where its fields
  // lead; left out, an order line would not offer its order, which is the
  // first thing a person on a line wants next.
  test("names the forms the open form's lookups open in", () => {
    const line = entry('pg-order-line', 'Order line', 'Sales')
    const all = menu(entry('pg-order', 'Order', 'Sales'), line, entry('pg-order-staff', 'Order', 'Sales'))
    expect(ids(linkedForms(all, line, [opens('order', 'pg-order', 'pg-order-staff')]))).toEqual([
      ['pg-order', true, false],
      ['pg-order-staff', true, false],
    ])
  })

  // The children the menu names (0045) are the forms whose rows refer to
  // the open form's records; left out, an order would not offer its lines.
  test('names the forms whose rows refer to its records', () => {
    const order = entry('pg-order', 'Order', 'Sales', [child('pg-order-line', 'order'), child('pg-delivery', 'order')])
    const all = menu(entry('pg-delivery', 'Delivery', 'Sales'), order, entry('pg-order-line', 'Order line', 'Sales'))
    expect(ids(linkedForms(all, order, []))).toEqual([
      ['pg-order-line', false, true],
      ['pg-delivery', false, true],
    ])
  })

  // An employee's orders refer to it twice, through who created and who
  // approved them, and a form can be both where a field leads and where
  // rows refer back: listed once a reason, one form would be two links
  // that go to one place.
  test('names each form once, with every way it is linked', () => {
    const staff = entry('pg-order-staff', 'Order', 'Sales')
    const employee = entry('pg-employee', 'Employee', 'Sales', [child('pg-order-staff', 'created_by'), child('pg-order-staff', 'approved_by')])
    const all = menu(employee, staff)
    expect(ids(linkedForms(all, employee, [opens('favourite', 'pg-order-staff'), opens('desk', 'pg-order-staff')]))).toEqual([['pg-order-staff', true, true]])
  })

  // A form that is its own child, an employee under their manager, or whose
  // lookup opens in itself, is the form open: listed as linked to itself,
  // it would be a link to where the person already is.
  test('leaves out the open form itself', () => {
    const employee = entry('pg-employee', 'Employee', 'Sales', [child('pg-employee', 'manager')])
    expect(ids(linkedForms(menu(employee), employee, [opens('manager', 'pg-employee')]))).toEqual([])
  })

  // The forms a lookup opens in are fields first, in the order the
  // definition names its lookups, then the children in the menu's order:
  // each form at its first place, so the list does not reorder as a form
  // gains a second reason.
  test("lists the fields' forms first, then the rows', each at its first place", () => {
    const order = entry('pg-order', 'Order', 'Sales', [child('pg-order-line', 'order'), child('pg-customer', 'last_order')])
    const all = menu(entry('pg-customer', 'Customer', 'Sales'), order, entry('pg-order-line', 'Order line', 'Sales'), entry('pg-staff', 'Staff', 'Sales'))
    expect(ids(linkedForms(all, order, [opens('customer', 'pg-customer'), opens('approver', 'pg-staff')]))).toEqual([
      ['pg-customer', true, true],
      ['pg-staff', true, false],
      ['pg-order-line', false, true],
    ])
  })

  // A child or a lookup's form the menu no longer names is no form this
  // person may open: drawn, its link would open nothing (0045).
  test('leaves out a form the menu does not name', () => {
    const order = entry('pg-order', 'Order', 'Sales', [child('pg-gone', 'order')])
    expect(ids(linkedForms(menu(order), order, [opens('customer', 'pg-elsewhere')]))).toEqual([])
  })
})

describe('linkWords', () => {
  // An arrow is read out as "rightwards arrow", or not at all: the
  // direction is said in words, from the open form's side, which the
  // heading names -- "Linked to Order line".
  test('says each way a form is linked in words', () => {
    expect(linkWords({ fields: true, rows: false })).toBe('from its fields')
    expect(linkWords({ fields: false, rows: true })).toBe('its child rows')
    expect(linkWords({ fields: true, rows: true })).toBe('from its fields and its child rows')
  })
})
