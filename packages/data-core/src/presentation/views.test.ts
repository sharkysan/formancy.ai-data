import { describe, expect, test } from 'vitest'
import { dropColumn, ORDER, retype, snapshot } from '../drift/fixture.js'
import { generateForm } from '../generate/generate.js'
import type { ObjectMeta } from '../metadata.js'
import { listColumns, planList, viewProblems } from '../records/list.js'
import { actor, AUDITOR, CLERK, CLERK_FIELDS, ORDER_POLICY, PG, PG_ORDER } from '../records/test-support.js'
import type { ListView, RecordListQuery, StoredListView } from '../runtime.js'
import { presentationShapeProblems } from './apply.js'
import { rebasePresentation } from './rebase.js'
import { EMPTY_PRESENTATION } from './types.js'
import type { PresentationOverrides } from './types.js'
import { todayOf } from './view-values.js'
import { viewShapeProblems, viewsFor } from './views.js'

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
/** The day views are offered on, in these cases: a date, as a server's clock gives it (`todayOf`). */
const DAY = '2026-11-01'

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

  // Two defaults offered to everyone would leave the grid to pick one, and
  // each page might pick another.
  test('refuses more than one default offered to everyone', () => {
    expect(viewShapeProblems([view({ default: true }), view({ name: 'Other', sort: [], default: true })])).toEqual([
      '/views: more than one view offered to everyone is the default',
    ])
  })

  // A view may name the roles it is offered to (0124): a list of roles,
  // each once, never empty -- a view for nobody is a view left out. A
  // default holds for the roles its view is offered to, so views for other
  // roles may each be one. Watched failing with roles read as an unknown
  // property: the views were refused.
  test('reads the roles a view is offered to, and a default per role', () => {
    expect(viewShapeProblems([view({ roles: ['clerk'], default: true }), view({ name: 'Other', sort: [], roles: ['manager'], default: true })])).toEqual([])
    expect(viewShapeProblems([view({ default: true }), view({ name: 'Other', sort: [], roles: ['manager'], default: true })])).toEqual([])
    expect(viewShapeProblems([view({ roles: [] })])).toEqual(['/views/0/roles: offered to nobody; name a role, or leave roles out for everyone'])
    expect(viewShapeProblems([view({ roles: ['clerk', 'clerk'] })])).toEqual(['/views/0/roles: clerk is named twice'])
    expect(viewShapeProblems([view({ roles: 'clerk' })])).toEqual(['/views/0/roles must be a list of roles'])
    expect(viewShapeProblems([view({ roles: [''] })])).toEqual(['/views/0/roles must be a list of roles'])
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
    expect(named({ filter: [{ field: 'customer', op: 'null' }] })).toEqual(['/views/0 (“Placed”): customer offers no null condition.'])
    // A lookup's condition (0135): the record a token names, with as many
    // values as its key has columns; whether each fits its column is the
    // list's to say, which reads the snapshot (watched failing with every
    // lookup refused as no field the list is filtered by).
    expect(named({ filter: [{ field: 'customer', op: 'equals', value: 'k1:1,1001' }] })).toEqual([])
    expect(named({ filter: [{ field: 'employee', op: 'null' }] })).toEqual([])
    expect(named({ filter: [{ field: 'customer', op: 'equals', value: 'k1:1' }] })).toEqual([
      '/views/0 (“Placed”): A record given for customer is not one it can refer to.',
    ])
    expect(named({ filter: [{ field: 'customer', op: 'equals', value: 'Muster AG' }] })).toEqual([
      '/views/0 (“Placed”): A record given for customer is not one it can refer to.',
    ])
    expect(named({ filter: [{ field: 'nothing', op: 'null' }] })).toEqual(['/views/0 (“Placed”): nothing is not a field this list is filtered by.'])
    expect(named({ sort: [{ field: 'nothing', direction: 'asc' }] })).toEqual(['/views/0 (“Placed”): nothing is not a field this list is sorted by.'])
    // A lookup sorts by what it shows (0136), for whoever may read it.
    expect(named({ sort: [{ field: 'customer', direction: 'asc' }] })).toEqual([])
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

  // A person is offered the views for one of their roles and those for
  // everyone, without the roles -- which are the administrator's, not the
  // person's -- and a grid opens on the first default among them: a person
  // holding two roles a default each is for opens on the first in the
  // published order (0124). Watched failing with every view offered
  // whatever its roles: the manager's view reached the clerk.
  test('offers a person the views for their roles, and opens their grid on the first default', () => {
    const FOR_CLERKS: StoredListView = { ...OPEN, name: 'For clerks', roles: ['clerk'], default: true }
    const FOR_MANAGERS: StoredListView = { ...OPEN, name: 'For managers', sort: [], roles: ['manager'], default: true }
    const { roles: _clerks, ...clerks } = FOR_CLERKS
    const { roles: _managers, ...managers } = FOR_MANAGERS
    expect(viewsFor([FOR_CLERKS, FOR_MANAGERS, ON_AMOUNT], actor(['clerk']), DAY)).toEqual([clerks, ON_AMOUNT])
    expect(viewsFor([FOR_CLERKS, FOR_MANAGERS], actor(['auditor']), DAY)).toEqual([])
    const both = listColumns(PG_ORDER, CLERK_FIELDS, viewsFor([FOR_CLERKS, FOR_MANAGERS], actor(['clerk', 'manager']), DAY)).views
    expect(both).toEqual([clerks, { name: managers.name, filter: managers.filter, sort: managers.sort }])
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
  function publish(views: StoredListView[], before: (objects: ObjectMeta[]) => void = () => {}) {
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

  // A view ordered by a lookup's label (0136) is one the regenerated list
  // still offers, and is carried as it was (watched failing with the
  // regenerated list offering no lookup's order: the view was dropped).
  test('a view ordered by a lookup is carried', () => {
    const byCustomer: StoredListView = { name: 'By customer', filter: [], sort: [{ field: 'customer', direction: 'asc' }] }
    const rebased = regenerate(publish([byCustomer]))
    expect(rebased.conflicts).toEqual([])
    expect(rebased.presentation.views).toEqual([byCustomer])
  })

  // A view's roles go with it (0124): carried without them, a view for the
  // managers would be offered to everyone. Watched failing with the roles
  // left out of the carried view.
  test('a view keeps the roles it is offered to', () => {
    const forManagers: StoredListView = { ...DATED, roles: ['manager'] }
    expect(regenerate(publish([forManagers, UNPAID])).presentation.views).toEqual([forManagers, UNPAID])
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

describe('views relative to today and to the person (0125)', () => {
  const LAST_WEEK: StoredListView = { name: 'Last week', filter: [{ field: 'order_date', op: 'range', from: { today: -7 }, to: { today: 0 } }], sort: [] }
  const MINE: StoredListView = { name: 'Mine to approve', filter: [{ field: 'approved_by', op: 'equals', value: { attribute: 'employee' } }], sort: [] }
  const stored = (filter: unknown): unknown => [{ name: 'Relative', filter: [filter], sort: [] }]

  // A relative value is whole days from today, or an attribute's name, and
  // nothing else; the rest of the condition is read as a request's. Watched
  // failing with relative values read as a request's: every one was refused.
  test('reads whole days from today and an attribute, and refuses anything else there', () => {
    expect(viewShapeProblems([LAST_WEEK, MINE])).toEqual([])
    expect(viewShapeProblems(stored({ field: 'order_date', op: 'equals', value: { today: 1.5 } }))).toEqual([
      '/views/0/filter/0/value/today must be whole days, at most 36500 either way',
    ])
    expect(viewShapeProblems(stored({ field: 'order_date', op: 'range', from: { today: 0, attribute: 'x' }, to: null }))).toEqual([
      '/views/0/filter/0/from must be text, { today: whole days } or { attribute: a name }',
    ])
    expect(viewShapeProblems(stored({ field: 'approved_by', op: 'equals', value: { attribute: '' } }))).toEqual([
      '/views/0/filter/0/value/attribute must name an attribute',
    ])
  })

  // At a write, a day only where the field holds dates, and an attribute --
  // text -- only in an equality on text, a whole number or a uuid. Watched
  // failing with the stand-in left out: a day on status was stored.
  test('is stored only on a field that can hold it', () => {
    expect(viewProblems([LAST_WEEK, MINE], PG_ORDER)).toEqual([])
    expect(viewProblems(stored({ field: 'status', op: 'equals', value: { today: 0 } }) as StoredListView[], PG_ORDER)).toEqual([
      '/views/0 (“Relative”): status holds no dates, so it cannot be compared with a day from today.',
    ])
    expect(viewProblems(stored({ field: 'approved_by', op: 'range', from: { attribute: 'employee' }, to: null }) as StoredListView[], PG_ORDER)).toEqual([
      "/views/0 (“Relative”): approved_by cannot be compared with a person's attribute: an attribute is text, compared for equality with text, a whole number or a uuid.",
    ])
    expect(viewProblems(stored({ field: 'paid', op: 'equals', value: { attribute: 'employee' } }) as StoredListView[], PG_ORDER)).toEqual([
      "/views/0 (“Relative”): paid cannot be compared with a person's attribute: an attribute is text, compared for equality with text, a whole number or a uuid.",
    ])
  })

  // Offered, a view is resolved for the person on the day: a week back from
  // the day it is offered, and the person's own employee. A person whose
  // token carries no employee is not offered "Mine", as a row filter is
  // closed on a missing attribute; one whose employee the column cannot
  // hold is not offered it either. Watched failing with the values sent as
  // stored: the page was handed { today: -7 }.
  test('is offered resolved for the person and the day, and not to one without the attribute', () => {
    const me = actor(['clerk'], { tenant: '1', employee: '7' })
    expect(viewsFor([LAST_WEEK, MINE], me, DAY)).toEqual([
      { name: 'Last week', filter: [{ field: 'order_date', op: 'range', from: '2026-10-25', to: '2026-11-01' }], sort: [] },
      { name: 'Mine to approve', filter: [{ field: 'approved_by', op: 'equals', value: '7' }], sort: [] },
    ])
    expect(viewsFor([LAST_WEEK, MINE], actor(['clerk']), DAY).map((view) => view.name)).toEqual(['Last week'])
    const odd = viewsFor([MINE], actor(['clerk'], { tenant: '1', employee: 'ada' }), DAY)
    expect(listColumns(PG_ORDER, CLERK_FIELDS, odd).views).toEqual([])
    expect(viewsFor([{ ...LAST_WEEK, filter: [{ field: 'order_date', op: 'equals', value: { today: -1 } }] }], me, '2026-03-01')[0]?.filter).toEqual([
      { field: 'order_date', op: 'equals', value: '2026-02-28' },
    ])
  })

  // A view keeps which bounds leave out their own value (0130) through
  // being read, fitted at a write and resolved for a person: rebuilt
  // without it, "since last week" would turn into "from last week on" on
  // the way to the page.
  test('keeps an exclusive bound through being stored and offered', () => {
    const since: StoredListView = {
      name: 'Since last week',
      filter: [{ field: 'order_date', op: 'range', from: { today: -7 }, to: null, exclusive: 'from' }],
      sort: [],
    }
    expect(viewShapeProblems([since])).toEqual([])
    expect(viewProblems([since], PG_ORDER)).toEqual([])
    expect(viewsFor([since], actor(['clerk'], { tenant: '1' }), DAY)[0]?.filter).toEqual([
      { field: 'order_date', op: 'range', from: '2026-10-25', to: null, exclusive: 'from' },
    ])
    expect(viewShapeProblems(stored({ field: 'order_date', op: 'range', from: null, to: { today: 0 }, exclusive: 'from' }))).toEqual([
      '/views/0/filter/0: An exclusive from on order_date needs a from.',
    ])
  })

  // The day is UTC's, whatever the server's zone: a minute before
  // midnight in UTC is still that day, and a minute after is the next.
  // Watched failing with the day read in the local zone, in Europe/Zurich:
  // 23:59 UTC was already the next day.
  test('counts days from the day UTC is on', () => {
    expect(todayOf(Date.UTC(2026, 10, 1, 23, 59))).toBe('2026-11-01')
    expect(todayOf(Date.UTC(2026, 10, 2, 0, 1))).toBe('2026-11-02')
  })
})
