import { describe, expect, test } from 'vitest'
import { dropColumn, ORDER, retype, snapshot } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import type { ObjectMeta } from '../metadata.js'
import { listColumns, planList, viewProblems } from '../records/list.js'
import { AUDITOR, CLERK, CLERK_FIELDS, ORDER_POLICY, PG, PG_ORDER } from '../records/test-support.js'
import type { ListView, RecordListQuery } from '../runtime.js'
import { presentationShapeProblems } from './apply.js'
import { rebasePresentation } from './rebase.js'
import { EMPTY_PRESENTATION } from './types.js'
import type { PresentationOverrides } from './types.js'
import { viewShapeProblems } from './views.js'

/*
 * A form's list views (0105): their shape, read on every read of a version;
 * their fit, at every write and at every offer; and their carry to a
 * regenerated base. The order form of `records/test-support.ts` is the
 * one a list is planned over, so what is offered here is checked against
 * what `planList` accepts; the drift fixture's is the one the rebase cases
 * regenerate, as `rebase.test.ts` does.
 */

const OPEN: ListView = { name: 'Placed', filter: [{ field: 'status', op: 'equals', value: 'placed' }], sort: [{ field: 'order_date', direction: 'desc' }] }
const view = (change: Record<string, unknown>): Record<string, unknown> => ({ ...OPEN, ...change })
const FIRST: RecordListQuery = { search: '', sort: [], parent: null, filter: [], after: null, limit: 50 }

describe('viewShapeProblems', () => {
  // The views a studio writes must read back: a filter and a sort exactly as
  // a list request carries them, and one default.
  test('reads views a list request could carry', () => {
    expect(viewShapeProblems([OPEN, { name: 'Unpaid, newest', filter: [{ field: 'paid', op: 'equals', value: 'false' }], sort: [], default: true }])).toEqual(
      [],
    )
    expect(presentationShapeProblems({ ...EMPTY_PRESENTATION, views: [OPEN] })).toEqual([])
  })

  // No views is the property left out, so a presentation has one spelling
  // and two stored files that mean the same thing are byte-equal.
  test('refuses an empty list of views, and anything but a list', () => {
    expect(presentationShapeProblems({ ...EMPTY_PRESENTATION, views: [] })).toEqual(['views: names none; leave it out'])
    expect(viewShapeProblems({ 0: OPEN })).toEqual(['views must be a list'])
  })

  // Each refusal is one a hand edit of the store could make, and one the
  // host's picker could not draw or a list request could not carry.
  test('refuses a view of any other shape, saying where', () => {
    expect(viewShapeProblems([view({ colour: 'red' })])).toEqual(['/views/0/colour is not a property of a list view'])
    expect(viewShapeProblems([{ name: 'Placed', sort: [] }])).toEqual(['/views/0/filter must be a list of conditions, [] for none'])
    expect(viewShapeProblems([{ name: 'Placed', filter: [] }])).toEqual(['/views/0/sort must be a list of { field, direction }, [] for none'])
    expect(viewShapeProblems([view({ filter: [{ field: 'status', op: 'like', value: 'p%' }] })])).toEqual([
      '/views/0/filter/0: status is filtered by equals, range, contains, null or not-null.',
    ])
    expect(
      viewShapeProblems([
        view({
          filter: [
            { field: 'notes', op: 'null' },
            { field: 'notes', op: 'not-null' },
          ],
        }),
      ]),
    ).toEqual(['/views/0/filter: notes is named twice in the filter.'])
    expect(viewShapeProblems([view({ sort: [{ field: 'status', direction: 'up' }] })])).toEqual(['/views/0/sort: status sorts asc or desc.'])
    expect(viewShapeProblems([view({ default: false })])).toEqual(['/views/0/default must be true, or left out'])
    expect(viewShapeProblems([view({ filter: [], sort: [] })])).toEqual(['/views/0: says nothing; leave the view out'])
  })

  // A picker lists views by name: one it cannot show, or two a person
  // cannot tell apart, is no choice.
  test('refuses a name a picker could not show, and two names alike but for case', () => {
    for (const [name, why] of [
      [7, 'must be text'],
      ['  ', 'needs words a person can read'],
      [' Placed', 'cannot start or end with a space'],
      ['Placed\u0007', 'cannot contain a control character'],
      ['Placed\uD800', 'cannot contain an unpaired UTF-16 surrogate'],
    ] as const) {
      expect(viewShapeProblems([view({ name })]), String(name)).toEqual([`/views/0/name ${why}`])
    }
    expect(viewShapeProblems([OPEN, view({ name: 'PLACED', sort: [] })])).toEqual(['/views/1/name: “PLACED” is another view’s name'])
  })

  // A picker shows the view a grid's filter and sort are, the first that
  // matches: of two views asking the same, the second could never be
  // shown, and picking it would show the first one's name. Conditions are
  // compared whatever their order, since every one must hold. Watched
  // failing with the check left out.
  test('refuses two views that ask the same, whatever the order of their conditions', () => {
    const both: ListView = {
      name: 'Both',
      filter: [
        { field: 'status', op: 'equals', value: 'placed' },
        { field: 'notes', op: 'null' },
      ],
      sort: [],
    }
    const turned = { ...both, name: 'Turned', filter: [...both.filter].reverse() }
    expect(viewShapeProblems([both, turned])).toEqual(['/views/1: asks what “Both” asks, so a picker could not tell them apart'])
    expect(viewShapeProblems([OPEN, view({ name: 'Other' })])).toEqual(['/views/1: asks what “Placed” asks, so a picker could not tell them apart'])
    expect(viewShapeProblems([OPEN, view({ name: 'Ascending', sort: [{ field: 'order_date', direction: 'asc' }] })])).toEqual([])
  })

  // Two defaults would leave the grid to pick one, and each page might pick
  // another.
  test('refuses more than one default', () => {
    expect(viewShapeProblems([view({ default: true }), view({ name: 'Other', sort: [], default: true })])).toEqual([
      '/views: more than one view is the default',
    ])
  })

  // Shape is read on every read of a version, and what a contains may find
  // is a search's rule, which a later release may tighten: a version whose
  // view a later rule refuses must still be served, that view only not
  // offered (below).
  test('leaves to the fit what a contains could not find', () => {
    const long = view({ filter: [{ field: 'notes', op: 'contains', text: 'x'.repeat(201) }] })
    expect(viewShapeProblems([long])).toEqual([])
    expect(viewProblems([long as unknown as ListView], PG_ORDER)).toEqual([
      '/views/0 (“Placed”): What a contains condition on notes finds is at most 200 characters, and this has 201.',
    ])
  })

  // Read whole, readFilter stops at its first refusal, so a contains it
  // refuses -- the fit's, not the shape's -- would let every malformed
  // condition after it into a stored version, where the rebase would meet a
  // condition with no field. Each is read on its own. Watched failing with
  // the filter read whole.
  test('reads each condition on its own, so a contains past the limit hides nothing after it', () => {
    const long = { field: 'notes', op: 'contains', text: 'x'.repeat(201) }
    expect(viewShapeProblems([view({ filter: [long, { op: 'null' }] })])).toEqual(['/views/0/filter/1: A filter condition names a field.'])
    expect(viewShapeProblems([view({ filter: [long, 42] })])).toEqual(['/views/0/filter/1: Each filter condition is { field, op, … }.'])
    expect(viewShapeProblems([view({ filter: [long, { field: 'notes', op: 'null' }] })])).toEqual(['/views/0/filter: notes is named twice in the filter.'])
  })
})

describe('viewProblems', () => {
  // A view is a request the studio stores for later: one whose value its
  // column cannot hold, on a field a list does not filter or sort by, or
  // with an operator its field does not offer, would be refused every time
  // a person picked it.
  test('refuses a view no list of the form could run, naming it', () => {
    const named = (change: Partial<ListView>) => viewProblems([{ ...OPEN, ...change }], PG_ORDER)
    expect(named({})).toEqual([])
    expect(named({ filter: [{ field: 'amount', op: 'equals', value: '1.23456' }] })).toEqual([expect.stringMatching(/^\/views\/0 \(“Placed”\): .*amount/)])
    expect(named({ filter: [{ field: 'amount', op: 'contains', text: '1' }] })).toEqual(['/views/0 (“Placed”): amount offers no contains condition.'])
    expect(named({ filter: [{ field: 'customer', op: 'null' }] })).toEqual(['/views/0 (“Placed”): customer is not a field this list is filtered by.'])
    expect(named({ filter: [{ field: 'nothing', op: 'null' }] })).toEqual(['/views/0 (“Placed”): nothing is not a field this list is filtered by.'])
    expect(named({ sort: [{ field: 'customer', direction: 'asc' }] })).toEqual(['/views/0 (“Placed”): customer is not a field this list is sorted by.'])
  })

  // Stored untrimmed, the view would send what the server trims, and a
  // picker comparing the grid's filter with the view's would never match.
  test('refuses a contains stored as a request would not read it', () => {
    expect(viewProblems([{ ...OPEN, filter: [{ field: 'notes', op: 'contains', text: ' rush ' }] }], PG_ORDER)).toEqual([
      '/views/0 (“Placed”): its filter is not as a request reads it: what a contains condition finds is stored trimmed.',
    ])
  })

  // A view is fitted against every field, not one person's: one on a field
  // only clerks read is stored, and offered to clerks.
  test('stores a view on a field only some may read', () => {
    expect(viewProblems([{ ...OPEN, filter: [{ field: 'amount', op: 'range', from: '10', to: null }] }], PG_ORDER)).toEqual([])
  })
})

describe('listColumns offers views', () => {
  const ON_AMOUNT: ListView = { name: 'Large', filter: [{ field: 'amount', op: 'range', from: '1000', to: null }], sort: [], default: true }
  const auditor = (views: ListView[]) => listColumns(PG_ORDER, ['id', 'order_date', 'status'], views).views

  // The auditor may not read amount. Offered the view, they would see which
  // orders are large without reading a single amount; offered it without
  // the condition, a wider list under the view's name. Watched failing with
  // the readability check left out.
  test('withholds a view naming a field the person may not read, and its default with it', () => {
    expect(auditor([OPEN, ON_AMOUNT])).toEqual([OPEN])
    expect(listColumns(PG_ORDER, CLERK_FIELDS, [OPEN, ON_AMOUNT]).views).toEqual([OPEN, ON_AMOUNT])
  })

  // A stored view a later rule refuses -- here a contains past the search's
  // limit, which the shape lets through -- is not offered, and nothing else
  // about the list changes.
  test('withholds a stored view that no longer fits', () => {
    const long: ListView = { ...OPEN, name: 'Long', filter: [{ field: 'notes', op: 'contains', text: 'x'.repeat(201) }] }
    expect(listColumns(PG_ORDER, CLERK_FIELDS, [long, OPEN]).views).toEqual([OPEN])
  })

  // What a page is offered is what the server accepts: a view the planner
  // refused would be a choice that always fails.
  test('offers only views the planner accepts as a request', () => {
    const offered = listColumns(PG_ORDER, CLERK_FIELDS, [
      OPEN,
      ON_AMOUNT,
      { name: 'Unnoted', filter: [{ field: 'notes', op: 'null' }], sort: [{ field: 'amount', direction: 'asc' }] },
    ]).views
    expect(offered).toHaveLength(3)
    for (const offer of offered)
      expect(planList(PG, PG_ORDER, ORDER_POLICY, CLERK, { ...FIRST, filter: offer.filter, sort: offer.sort }).ok, offer.name).toBe(true)
    for (const offer of auditor([OPEN, ON_AMOUNT]))
      expect(planList(PG, PG_ORDER, ORDER_POLICY, AUDITOR, { ...FIRST, filter: offer.filter, sort: offer.sort }).ok, offer.name).toBe(true)
  })
})

describe('rebasePresentation carries views', () => {
  /** The drift fixture's order form, published with `views` over its base. */
  function publish(views: ListView[], before: (objects: ObjectMeta[]) => void = () => {}) {
    const { form, bindings } = generateForm(snapshot(before), ORDER)
    const presentation: PresentationOverrides = { ...EMPTY_PRESENTATION, views }
    return { base: form, presentation, bindings }
  }
  const regenerate = (published: ReturnType<typeof publish>, after: (objects: ObjectMeta[]) => void = () => {}) => {
    const next = generateForm(snapshot(after), ORDER)
    return rebasePresentation(published, { base: next.form, bindings: next.bindings })
  }
  const DATED: ListView = {
    name: 'This year',
    filter: [{ field: 'order_date', op: 'range', from: '2026-01-01', to: null }],
    sort: [{ field: 'amount', direction: 'desc' }],
    default: true,
  }
  const UNPAID: ListView = { name: 'Unpaid', filter: [{ field: 'paid', op: 'equals', value: 'false' }], sort: [] }

  // The fast path of every regeneration of an unchanged database.
  test('identical bases carry every view, with no conflict', () => {
    const rebased = regenerate(publish([DATED, UNPAID]))
    expect(rebased.conflicts).toEqual([])
    expect(rebased.presentation.views).toEqual([DATED, UNPAID])
  })

  // Two columns sanitise to order_date; dropping the first renumbers the
  // second's key. Carried by key, the view would filter the column that
  // took the key's place. Watched failing with the keys copied as they were.
  test('a view follows its column to a renumbered key', () => {
    const second = (objects: ObjectMeta[]) => {
      const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
      order.columns.push({
        ...(order.columns.find((column) => column.name === 'order_date') as ObjectMeta['columns'][number]),
        name: 'order date',
        nullable: true,
      })
    }
    const shipped: ListView = { name: 'Shipped', filter: [{ field: 'order_date_2', op: 'not-null' }], sort: [{ field: 'order_date_2', direction: 'asc' }] }
    const rebased = regenerate(publish([shipped], second), (objects) => {
      second(objects)
      dropColumn(objects, 'order', 'order_date')
    })
    expect(rebased.presentation.views).toEqual([
      { ...shipped, filter: [{ field: 'order_date', op: 'not-null' }], sort: [{ field: 'order_date', direction: 'asc' }] },
    ])
    expect(rebased.conflicts.filter((conflict) => conflict.kind === 'view-dropped')).toEqual([])
  })

  // Carried without the condition, the view would show every order under
  // the name "Unpaid". It goes, it is said, the others stay, and the
  // property goes when none is left.
  test('a view naming a dropped column is dropped whole and said', () => {
    const rebased = regenerate(publish([DATED, UNPAID]), (objects) => dropColumn(objects, 'order', 'paid'))
    expect(rebased.presentation.views).toEqual([DATED])
    expect(rebased.conflicts).toEqual([
      {
        kind: 'view-dropped',
        view: 'Unpaid',
        resolution: 'dropped',
        message: 'View “Unpaid” names paid, which is not in the regenerated form, so it was dropped.',
      },
    ])
    expect(regenerate(publish([UNPAID]), (objects) => dropColumn(objects, 'order', 'paid')).presentation).toEqual(EMPTY_PRESENTATION)
  })

  // A date retyped as a timestamp is filtered by whole days and offers no
  // equality (0104): the view's question no longer has an answer.
  test('a view its column no longer answers is dropped, its default with it', () => {
    const today: ListView = { name: 'Today', filter: [{ field: 'order_date', op: 'equals', value: '2026-10-28' }], sort: [], default: true }
    const rebased = regenerate(publish([today, UNPAID]), (objects) =>
      retype(objects, 'order', 'order_date', 'datetime2(3)', { kind: 'timestamp', withTimeZone: false, precision: 3 }),
    )
    expect(rebased.presentation.views).toEqual([UNPAID])
    expect(rebased.conflicts).toEqual([
      { kind: 'view-dropped', view: 'Today', resolution: 'dropped', message: 'View “Today” was dropped: order_date offers no equals condition.' },
    ])
  })

  // Conflicts are said field by field, then section by section; a view is
  // about the list, and is said after both. Watched failing with a view's
  // subject counted from the fields alone, which put it before the section.
  test('a dropped view is said after the fields and sections', () => {
    const NEWEST: ListView = { name: 'Newest', filter: [], sort: [{ field: 'id', direction: 'desc' }] }
    const published = publish([NEWEST])
    const presentation: PresentationOverrides = {
      ...published.presentation,
      fields: [{ field: 'paid', anchor: { kind: 'column', column: 'paid' }, label: 'Settled' }],
      sections: [{ anchor: { label: 'Record', occurrence: 0 }, label: 'Bookkeeping' }],
    }
    const rebased = regenerate({ ...published, presentation }, (objects) => {
      dropColumn(objects, 'order', 'paid')
      dropColumn(objects, 'order', 'id')
      ;(objects.find((object) => object.ref.name === 'order') as ObjectMeta).primaryKey = null
    })
    expect(rebased.conflicts.map((conflict) => conflict.kind)).toEqual(['field-gone', 'section-gone', 'view-dropped'])
  })

  // Only a hand edit of the store names a field the bindings do not hold,
  // since every write fits the views; a regeneration of that version then
  // drops the view as it drops one whose column is gone, and does not fail.
  // Watched failing as a 500's "Cannot canonicalize undefined".
  test('a view naming a field the published bindings never held is dropped, not thrown on', () => {
    const rebased = regenerate(publish([{ name: 'Edited', filter: [{ field: 'nothing', op: 'null' }], sort: [] }]))
    expect(rebased.conflicts).toEqual([
      {
        kind: 'view-dropped',
        view: 'Edited',
        resolution: 'dropped',
        message: 'View “Edited” names nothing, which is not in the regenerated form, so it was dropped.',
      },
    ])
  })
})
