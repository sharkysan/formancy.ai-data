import { describe, expect, test } from 'vitest'
import { ORDER, snapshot } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import { presentationShapeProblems } from './apply.js'
import { defaultGroup, formGroup, GROUP_LIMIT, groupProblem, groupProblems } from './group.js'
import { rebasePresentation } from './rebase.js'
import { EMPTY_PRESENTATION } from './types.js'

/*
 * The group a form is listed under (0143), as data: its default from the
 * root's schema, its shape on every read, its fit at a write -- the
 * default spelled out is the property left out -- and its carry through a
 * regeneration. Over the fixture's order, whose table is in `sales`.
 */

const SALES = { schema: 'sales', name: 'order' }

describe('a form’s group', () => {
  // The default is the schema's name in words, as generation words a
  // column's label (`labelFor`), so `order_entry` reads "Order entry" and
  // not the identifier a person never chose. A schema with no words in it
  // gives no group rather than a heading of punctuation or spaces, which
  // the shape below would refuse if an administrator typed it. Watched
  // failing with the schema's name returned as it is: "sales" was the
  // default.
  test('is the root schema’s name in words unless the presentation says otherwise', () => {
    expect(defaultGroup(SALES)).toBe('Sales')
    expect(defaultGroup({ schema: 'order_entry', name: 'order' })).toBe('Order entry')
    expect(defaultGroup({ schema: 'OrderEntry', name: 'order' })).toBe('Order entry')
    expect(defaultGroup({ schema: '  ', name: 'order' })).toBeNull()
    expect(defaultGroup({ schema: 'x'.repeat(GROUP_LIMIT + 1), name: 'order' })).toBeNull()
    expect(formGroup(undefined, SALES)).toBe('Sales')
    expect(formGroup('Orders', SALES)).toBe('Orders')
    expect(formGroup(null, SALES)).toBeNull()
  })

  // What a stored presentation may hold: words with no space around them,
  // no control character and no lone surrogate, at most GROUP_LIMIT long,
  // or null for no group. An empty or blank group is a second spelling of
  // null and is refused, never read as it. Watched failing with the
  // group's shape left unasked: "" was read as a group.
  test('is words of at most GROUP_LIMIT, or null for none, by shape', () => {
    for (const group of [null, 'Sales', 'x'.repeat(GROUP_LIMIT)]) expect(presentationShapeProblems({ ...EMPTY_PRESENTATION, group }), String(group)).toEqual([])
    const refused = (group: unknown) => presentationShapeProblems({ ...EMPTY_PRESENTATION, group })
    expect(refused('')).toEqual(['group needs words a person can read; no group is null'])
    expect(refused('   ')).toEqual(['group needs words a person can read; no group is null'])
    expect(refused(' Sales')).toEqual(['group cannot start or end with a space'])
    expect(refused('Sa\tles')).toEqual(['group cannot contain a control character'])
    expect(refused('Sales \uD800')).toEqual(['group cannot contain an unpaired UTF-16 surrogate'])
    expect(refused('x'.repeat(GROUP_LIMIT + 1))).toEqual([`group is at most ${String(GROUP_LIMIT)} characters`])
    expect(refused(7)).toEqual(['group must be words, or null for no group'])
    expect(groupProblem('Sales')).toBeNull()
  })

  // The default spelled out is the property left out, so a presentation
  // has one spelling and two files meaning one thing are byte-equal: what
  // the studio sends as nothing, a write refuses. Watched failing with
  // every group let through: "Sales" over sales was not refused.
  test('is refused at a write where it spells out the default', () => {
    expect(groupProblems(undefined, SALES)).toEqual([])
    expect(groupProblems('Orders', SALES)).toEqual([])
    expect(groupProblems(null, SALES)).toEqual([])
    expect(groupProblems('Sales', SALES)).toEqual(['/group: equals the default, from schema "sales"; leave it out'])
    expect(groupProblems(null, { schema: '  ', name: 'order' })).toEqual(['/group: equals the default, from schema "  "; leave it out'])
  })

  // The group is the form's, bound to no field: a regeneration carries it
  // as it is, a cleared one included. Watched failing with group left out
  // of the carried presentation: Orders was the default again.
  test('is carried through a regeneration as it is', () => {
    const { form, bindings } = generateForm(snapshot(), ORDER)
    const next = generateForm(snapshot(), ORDER)
    for (const group of ['Orders', null]) {
      const rebased = rebasePresentation({ base: form, presentation: { ...EMPTY_PRESENTATION, group }, bindings }, { base: next.form, bindings: next.bindings })
      expect(rebased.presentation.group, String(group)).toBe(group)
    }
    const silent = rebasePresentation({ base: form, presentation: EMPTY_PRESENTATION, bindings }, { base: next.form, bindings: next.bindings })
    expect(Object.hasOwn(silent.presentation, 'group')).toBe(false)
  })
})
