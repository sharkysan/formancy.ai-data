import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { FormBindings } from '../generate/types.js'
import type { CheckMeta, ObjectMeta } from '../metadata.js'
import type { DriftReport } from './types.js'
import { diffSnapshots, gap, NO_FILTERS, object, ORDER, ORDER_REF, restrict, snapshot } from './fixture.js'

/*
 * A field drawn as a select of the values a check lists (0152), reviewed
 * against every check that lists its column as it is now (0010). Values an
 * enforced list leaves out are a tightened column: the select offers a
 * value the database refuses, so its writes stop. Values every validated
 * list names and the select does not, or the column no longer held to a
 * list, are a field the column outgrew, for review only: the engine
 * refuses an answer the select does not list rather than writing another
 * back (formancy.ai 0076), so nothing is changed unseen. The runtime
 * compares no check (0041), so it refuses none of these; the database
 * refuses a value it no longer lists, with its own error.
 */

/** ck_order_status as SQL Server writes `status in ('draft', 'placed', 'shipped')`. */
const LISTED = "([status]='shipped' OR [status]='placed' OR [status]='draft')"

const withCheck =
  (check: Partial<CheckMeta> & { expression: string | null }) =>
  (objects: ObjectMeta[]): void => {
    object(objects, 'order').checks.push({ name: 'ck_order_status', enforced: true, validated: true, ...check })
  }

/** ck_order_status as published, and `others` beside it. */
const besideListed =
  (...others: Array<Partial<CheckMeta> & { name: string; expression: string | null }>) =>
  (objects: ObjectMeta[]): void => {
    withCheck({ expression: LISTED })(objects)
    for (const other of others) withCheck(other)(objects)
  }

const BASE = () => snapshot(withCheck({ expression: LISTED }))

/** The order form published from the listed base, and its review against `edit`'s snapshot, the gaps given. */
function review(edit: (objects: ObjectMeta[]) => void, gaps = [] as ReturnType<typeof gap>[], bindings?: FormBindings): DriftReport {
  const base = BASE()
  return diffSnapshots(base, snapshot(edit, { gaps }), bindings ?? generateForm(base, ORDER).bindings, NO_FILTERS)
}

const shape = (report: DriftReport) => report.changes.map((change) => [change.kind, change.severity, 'name' in change.subject ? change.subject.name : ''])

const statusOf = (bindings: FormBindings) => bindings.fields.find((binding) => binding.field === 'status')

describe('a select of listed values against its check', () => {
  test('the base form is a select resting on the check', () => {
    expect(statusOf(generateForm(BASE(), ORDER).bindings)).toMatchObject({ listed: { check: 'ck_order_status', values: ['draft', 'placed', 'shipped'] } })
  })

  // A respelling is the check's own change, and no change to what the select
  // offers: compared by value, never by how the list reads. Watched failing
  // with the list compared as its expression: the respelled list stopped writes.
  test('the same values spelled in another order change nothing the field rests on', () => {
    const report = review(withCheck({ expression: "([status]='draft' OR [status]='placed' OR [status]='shipped')" }))
    expect(shape(report)).toEqual([['check-changed', 'info', 'ck_order_status']])
    expect(report.blocking).toBe(false)
  })

  // The select still offers shipped, which the database now refuses: a
  // tightened column, as a shorter length is (0010), whose writes stop until
  // the form is generated again. The runtime does not compare checks, so it
  // still writes, and the database refuses shipped with its own error.
  // Watched failing with the list left unread by review: nothing blocked.
  test('a value gone from the list stops writes of the field, and the runtime leaves it to the database', () => {
    const report = review(withCheck({ expression: "([status]='placed' OR [status]='draft')" }))
    expect(shape(report)).toEqual([
      ['column-tightened', 'blocking', 'status'],
      ['check-changed', 'info', 'ck_order_status'],
    ])
    expect(report.changes[0]).toMatchObject({
      affects: ['status'],
      message:
        'ck_order_status no longer lists “shipped”, which status still offers and the database now refuses, so writes of status are blocked until the form is generated again.',
    })
    // The base records nothing about deleting (0049), so the form offers no delete.
    expect(report.writable).toEqual({ create: false, update: false, delete: false })
    expect(report.runtime).toEqual({ readable: true, writable: { create: true, update: true, delete: false } })
  })

  // A value the select does not offer is no silent change: the engine refuses
  // a record holding one until a listed value is chosen. For review, and
  // nothing stops -- as the e2e journey's compatible change, a replaced
  // check that adds cancelled, needs. Watched failing with an added value
  // read as tightened: the compatible change blocked the form.
  test('a value added to the list is for review, and stops nothing', () => {
    const report = review(withCheck({ expression: "([status]='cancelled' OR [status]='shipped' OR [status]='placed' OR [status]='draft')" }))
    expect(shape(report)).toEqual([
      ['column-outgrew-field', 'review', 'status'],
      ['check-changed', 'info', 'ck_order_status'],
    ])
    expect(report.changes[0]?.message).toBe(
      'ck_order_status now lists “cancelled” too, and status does not offer it. The select cannot offer a value it does not list, and refuses to save a record holding one until a listed value is chosen; generate the form again to offer what the column now holds.',
    )
    expect(report).toMatchObject({ blocking: false, writable: { create: true, update: true, delete: false } })
  })

  test('a value added and another gone are two changes', () => {
    const report = review(withCheck({ expression: "([status]='lost' OR [status]='placed' OR [status]='draft')" }))
    expect(shape(report)).toEqual([
      ['column-tightened', 'blocking', 'status'],
      ['column-outgrew-field', 'review', 'status'],
      ['check-changed', 'info', 'ck_order_status'],
    ])
  })

  // Each leaves a row free to hold what the select cannot show: the check
  // gone, stopped, unvalidated or no longer a list. Watched failing with only
  // the values compared: a dropped check said nothing about the field.
  test.each([
    ['gone', () => {}, 'ck_order_status, whose values status offers, is gone from status.'],
    [
      'no longer enforced',
      withCheck({ expression: LISTED, enforced: false, validated: false }),
      'status offers the values ck_order_status listed, and ck_order_status no longer holds status to a list: the database does not enforce it, so a row may hold a value it does not list.',
    ],
    [
      'not validated',
      withCheck({ expression: LISTED, validated: false }),
      'status offers the values ck_order_status listed, and ck_order_status no longer holds status to a list: it was not validated, so a row from before it may hold a value it does not list, which a select could not show.',
    ],
    [
      'no longer a list',
      withCheck({ expression: "([status]<>'')" }),
      'ck_order_status, whose values status offers, is no longer a list this release reads, so whether it still takes every value status offers is not known; the database refuses one it does not, with a check violation.',
    ],
  ])('a check %s is a field the column outgrew, for review', (_case, edit, message) => {
    const report = review(edit)
    expect(shape(report)[0]).toEqual(['column-outgrew-field', 'review', 'status'])
    expect(report.changes[0]?.message.startsWith(message)).toBe(true)
    expect(report.blocking).toBe(false)
  })

  // The database refuses what any enforced list leaves out, not only the
  // published one's: a second list naming fewer values, or one added NOT
  // VALID or WITH NOCHECK, which still holds every new or changed row,
  // refuses shipped as surely as a narrowed ck_order_status. The rows are
  // still held to values the select offers, so nothing outgrew. Watched
  // failing with the second list read as the column no longer held to a
  // list: review only, writes on, and a message saying no list held it.
  test.each([
    ['a second list', { validated: true }],
    ['a second list added NOT VALID', { validated: false }],
  ])('%s that leaves out a value the select offers stops its writes', (_case, state) => {
    const report = review(besideListed({ name: 'ck_order_status_again', expression: "([status]='placed' OR [status]='draft')", ...state }))
    expect(shape(report)).toEqual([
      ['column-tightened', 'blocking', 'status'],
      ['check-changed', 'info', 'ck_order_status_again'],
    ])
    expect(report.changes[0]?.message).toBe(
      'ck_order_status_again does not list “shipped”, which status still offers and the database now refuses, so writes of status are blocked until the form is generated again.',
    )
    expect(report.writable).toEqual({ create: false, update: false, delete: false })
  })

  // Two lists that each leave a value out are named together; a disabled one
  // refuses nothing, and says nothing about the field.
  test('lists that between them leave out values are named together, and a disabled one is not', () => {
    const report = review(
      besideListed(
        { name: 'ck_no_placed', expression: "([status]='shipped' OR [status]='draft')" },
        { name: 'ck_no_shipped', expression: "([status]='placed' OR [status]='draft')" },
        { name: 'ck_off', expression: "([status]='draft')", enforced: false, validated: false },
      ),
    )
    expect(report.changes.filter((change) => change.kind !== 'check-changed').map((change) => [change.kind, change.message])).toEqual([
      [
        'column-tightened',
        'ck_no_placed and ck_no_shipped between them do not list “placed” and “shipped”, which status still offers and the database now refuses, so writes of status are blocked until the form is generated again.',
      ],
    ])
  })

  // The rows are held to what every validated list names: a list naming a
  // value the select does not offer, beside one that leaves it out, holds
  // no row to it, and a value both name is one a row may hold, which the
  // select cannot show.
  test('two lists hold the rows to what both name', () => {
    const wider = review(besideListed({ name: 'ck_wider', expression: "([status]='lost' OR [status]='shipped' OR [status]='placed' OR [status]='draft')" }))
    expect(shape(wider)).toEqual([['check-changed', 'info', 'ck_wider']])
    const both = review((objects) => {
      withCheck({ expression: "([status]='lost' OR [status]='placed' OR [status]='draft')" })(objects)
      withCheck({ name: 'ck_again', expression: "([status]='lost' OR [status]='shipped' OR [status]='placed' OR [status]='draft')" })(objects)
    })
    expect(shape(both)).toEqual([
      ['column-tightened', 'blocking', 'status'],
      ['column-outgrew-field', 'review', 'status'],
      ['check-changed', 'info', 'ck_again'],
      ['check-changed', 'info', 'ck_order_status'],
    ])
    expect(both.changes[1]?.message.startsWith('ck_again and ck_order_status now list “lost” too, and status does not offer it.')).toBe(true)
  })

  // A replacement the reader does not take may refuse a value the select
  // offers, or not, and the reader cannot say which: it is for review, and
  // the database refuses such a value with its own error, as it does one a
  // changed check refuses (0010). Watched failing with the message as it
  // was: it said only that the check no longer listed the values.
  test('a list replaced by a narrower expression the reader does not take is for review, and says what is not known', () => {
    const report = review(withCheck({ expression: "(([status]='placed' OR [status]='draft') AND len([status])>(0))" }))
    expect(shape(report)).toEqual([
      ['column-outgrew-field', 'review', 'status'],
      ['check-changed', 'info', 'ck_order_status'],
    ])
    expect(
      report.changes[0]?.message.startsWith(
        'ck_order_status, whose values status offers, is no longer a list this release reads, so whether it still takes every value status offers is not known',
      ),
    ).toBe(true)
    expect(report.blocking).toBe(false)
  })

  // A list in sight that refuses a value the select offers is proof enough,
  // whatever else is out of sight. Watched failing with every listed field
  // left to the gap once any check was: nothing blocked.
  test('a list that leaves out a value stops writes beside a check out of sight', () => {
    const report = review(
      (objects) => {
        withCheck({ expression: "([status]='placed' OR [status]='draft')" })(objects)
        withCheck({ name: 'ck_hidden', expression: null })(objects)
      },
      [gap(ORDER_REF, 'checks')],
    )
    expect(shape(report)).toContainEqual(['column-tightened', 'blocking', 'status'])
    expect(shape(report).filter(([kind]) => kind === 'column-outgrew-field')).toEqual([])
  })

  // Out of sight is the gap's to say, for a check as for any constraint: the
  // field concludes nothing from a list it cannot read.
  test('a check this connection can no longer read is left to the gap', () => {
    const report = review(withCheck({ expression: null }), [gap(ORDER_REF, 'checks')])
    expect(shape(report)).toEqual([
      ['access-narrowed', 'info', ''],
      ['check-changed', 'info', 'ck_order_status'],
    ])
  })

  // A field nothing writes only shows the value: every value it shows still fits.
  test('a value gone from a field the form only shows is noted', () => {
    const base = snapshot((objects) => {
      withCheck({ expression: LISTED })(objects)
      restrict(objects, 'order', 'status', { insert: false, update: false })
    })
    const current = snapshot((objects) => {
      withCheck({ expression: "([status]='placed' OR [status]='draft')" })(objects)
      restrict(objects, 'order', 'status', { insert: false, update: false })
    })
    const report = diffSnapshots(base, current, generateForm(base, ORDER).bindings, NO_FILTERS)
    expect(shape(report)).toContainEqual(['column-tightened', 'info', 'status'])
  })

  // A form published before 0152 is a text box, which any listed value fits:
  // nothing about its list is compared.
  test('a field published as a text box rests on no list', () => {
    const base = BASE()
    const { bindings } = generateForm(base, ORDER)
    const before0152: FormBindings = {
      ...bindings,
      fields: bindings.fields.map((binding) => {
        if (binding.kind !== 'column') return binding
        const { listed: _listed, ...rest } = binding
        return rest
      }),
    }
    expect(shape(review(withCheck({ expression: "([status]='placed' OR [status]='draft')" }), [], before0152))).toEqual([
      ['check-changed', 'info', 'ck_order_status'],
    ])
  })
})
