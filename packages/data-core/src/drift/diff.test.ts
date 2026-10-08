import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { FormBindings } from '../generate/types.js'
import type { ObjectMeta } from '../metadata.js'
import { diffSnapshots } from './diff.js'
import {
  addColumn,
  col,
  CUSTOMER_REF,
  drift,
  dropColumn,
  EMPLOYEE,
  EMPLOYEE_REF,
  foreignKey,
  gap,
  INT32,
  kinds,
  named,
  object,
  only,
  ORDER,
  ORDER_FIELDS,
  ORDER_REF,
  remove,
  snapshot,
  SUMMARY,
  SUMMARY_REF,
  text,
} from './fixture.js'

describe('diffSnapshots: what is compared, and the root', () => {
  // A review that listed changes nobody made would teach people to click
  // through it. Two discoveries of the same database, even on a patched
  // server, report nothing, and the form keeps exactly what it offered — not
  // more: the employee form never offered update and must not gain it here.
  test('identical snapshots give an empty report, and the form keeps what it offered', () => {
    const base = snapshot()
    const { bindings } = generateForm(base, ORDER)
    expect(diffSnapshots(base, snapshot(undefined, { serverVersion: '16.0.4135' }), bindings)).toEqual({
      changes: [],
      blocking: false,
      writable: { create: true, update: true },
    })
    expect(diffSnapshots(base, base, generateForm(base, EMPLOYEE).bindings).writable).toEqual({ create: true, update: false })

    // Equal fingerprints are createSnapshot's promise that two snapshots
    // describe the same thing, so the objects are not walked at all.
    expect(diffSnapshots(base, { ...base, objects: [] }, bindings).changes).toEqual([])
  })

  // Bindings judged against a snapshot they were not generated from would be
  // compared with the wrong "before", and every verdict would be about some
  // other form. Two engines' snapshots only look like one table.
  test('refuses bindings from another snapshot, and a snapshot of another engine', () => {
    const base = snapshot()
    const { bindings } = generateForm(base, ORDER)
    const other = snapshot((objects) => object(objects, 'employee').columns.push(col('email', 'nvarchar(200)', text(200), { nullable: true, ordinal: 3 })))
    expect(() => diffSnapshots(other, other, bindings)).toThrow(/generated from snapshot/)
    expect(() => diffSnapshots(base, snapshot(undefined, { kind: 'postgres' }), bindings)).toThrow(/a sqlserver snapshot cannot be compared with a postgres one/)
  })

  // Bindings edited by hand to name something the base does not have would
  // never be compared with anything, so a change to it could never be
  // reported. Refused, naming what is missing.
  test('refuses bindings that name what the base snapshot does not have', () => {
    const base = snapshot()
    const current = snapshot((objects) => remove(objects, 'employee'))
    const { bindings } = generateForm(base, ORDER)
    const doctored = (edit: (copy: FormBindings) => void) => {
      const copy = JSON.parse(JSON.stringify(bindings)) as FormBindings
      edit(copy)
      return () => diffSnapshots(base, current, copy)
    }
    const lookup = (copy: FormBindings) => {
      const found = copy.fields.find((field) => field.kind === 'lookup')
      if (found?.kind !== 'lookup') throw new Error('the order form has a lookup')
      return found
    }

    expect(doctored((copy) => (copy.root = { schema: 'sales', name: 'nope' }))).toThrow(/sales\.nope, which the base snapshot does not have/)
    expect(doctored((copy) => copy.fields.push({ kind: 'column', field: 'ghost', column: 'ghost', type: INT32, nullable: true, writable: true }))).toThrow(/column ghost of sales\.order/)
    expect(doctored((copy) => (lookup(copy).foreignKey = 'fk_nope'))).toThrow(/foreign key fk_nope of sales\.order/)
    expect(doctored((copy) => (lookup(copy).target.table = { schema: 'sales', name: 'nope' }))).toThrow(/sales\.nope, which the base snapshot does not have/)
    expect(doctored((copy) => (copy.concurrency = { kind: 'rowversion', column: 'nope', confirmed: true }))).toThrow(/column nope of sales\.order/)
    expect(doctored((copy) => (copy.identity = ['order_date']))).toThrow(/identity \(order_date\), which no key of the base snapshot covers/)
  })

  // The table really is gone: no gap says the connection lost sight of it,
  // and its schema is still in scope. Nothing the form does can work.
  test('the root gone with no gap is "the table is gone", and blocks everything', () => {
    const report = drift((objects) => remove(objects, 'order'))
    expect(report.changes).toEqual([
      {
        kind: 'root-dropped',
        severity: 'blocking',
        subject: { kind: 'object', object: ORDER_REF },
        affects: ORDER_FIELDS,
        message: expect.stringMatching(/^sales\.order is gone:/),
      },
    ])
    expect(report.blocking).toBe(true)
    expect(report.writable).toEqual({ create: false, update: false })
  })

  // The case 0004 built gaps for. A permission-filtered catalog drops a table
  // the account may no longer see, and that looks exactly like the table being
  // dropped. Reported as a deletion, an administrator would retire a form whose
  // table is fine; the remedy is a grant, so the report must say access.
  test('the root vanishing while a gap explains it is an access problem, never a deletion', () => {
    const gone = (objects: ObjectMeta[]) => remove(objects, 'order')
    const own = drift(gone, { gaps: [gap(ORDER_REF, 'objects', 'SELECT on sales.order was revoked.')] })
    expect(only(own)).toEqual({
      kind: 'access-narrowed',
      severity: 'blocking',
      subject: { kind: 'object', object: ORDER_REF },
      affects: ORDER_FIELDS,
      message: expect.stringMatching(/SELECT on sales\.order was revoked\..*access problem, not a deletion/),
    })
    expect(own.writable).toEqual({ create: false, update: false })

    // Any gap about the object explains it, and so does one about every object in scope.
    expect(kinds(drift(gone, { gaps: [gap(ORDER_REF, 'columns')] }))).toEqual(['access-narrowed'])
    expect(kinds(drift(gone, { gaps: [gap(null, 'objects', 'The catalog could not be listed.')] }))).toEqual(['access-narrowed'])
    // A scope-wide gap about checks hides no table.
    expect(kinds(drift(gone, { gaps: [gap(null, 'checks')] }))).toEqual(['root-dropped'])
  })

  // Discovery was told not to look in a schema any more. Calling its tables
  // dropped would be the same false deletion as above, with a different cause.
  test('a root outside a narrowed scope is not reported as dropped', () => {
    const report = drift((objects) => objects.splice(0), { schemas: ['audit'] })
    expect(only(report)).toMatchObject({ kind: 'scope-narrowed', severity: 'blocking', affects: ORDER_FIELDS, message: expect.stringMatching(/sales is no longer/) })
    expect(report.writable).toEqual({ create: false, update: false })
  })

  // A view has no write path in this release (0009). A table turned into a
  // view behind a writable form would take writes it cannot honour.
  test('a root that became a view blocks writes; a view that became a table is for review', () => {
    const toView = drift((objects) => (object(objects, 'order').kind = 'view'))
    expect(only(toView)).toMatchObject({ kind: 'root-kind-changed', severity: 'blocking', subject: { kind: 'object', object: ORDER_REF }, affects: ORDER_FIELDS })
    expect(toView.writable).toEqual({ create: false, update: false })

    const toTable = drift((objects) => (object(objects, 'customer_summary').kind = 'table'), {}, SUMMARY)
    expect(only(toTable)).toMatchObject({ kind: 'root-kind-changed', severity: 'review', message: expect.stringMatching(/stays read-only/) })
    expect(toTable.blocking).toBe(false)
  })
})

describe('diffSnapshots: access', () => {
  // A gap that appeared with nothing missing still means the connection can
  // no longer confirm what the form depends on. Fail closed for exactly what it
  // puts in doubt, and only note what the form does not use: a review that
  // blocked on unreadable check expressions would be cried wolf at.
  test('a new gap blocks what it puts in doubt, and only that', () => {
    const columns = drift(undefined, { gaps: [gap(ORDER_REF, 'columns')] })
    expect(only(columns)).toEqual({
      kind: 'access-narrowed',
      severity: 'blocking',
      subject: { kind: 'object', object: ORDER_REF },
      affects: ORDER_FIELDS,
      message: expect.stringMatching(/columns of sales\.order: "Hidden from this account\."\. .*not a schema change/),
    })
    expect(columns.writable).toEqual({ create: false, update: false })
    // Two details about one aspect are one doubt, said once with both reasons.
    expect(only(drift(undefined, { gaps: [gap(ORDER_REF, 'columns', 'One.'), gap(ORDER_REF, 'columns', 'Two.')] })).message).toMatch(/"One\."; "Two\."/)

    // Keys are the identity, which only update uses.
    const keys = drift(undefined, { gaps: [gap(ORDER_REF, 'keys')] })
    expect(only(keys)).toMatchObject({ severity: 'blocking', affects: ['id'] })
    expect(keys.writable).toEqual({ create: true, update: false })

    // Foreign keys are the lookup's, and so are its target's columns.
    expect(only(drift(undefined, { gaps: [gap(ORDER_REF, 'foreign-keys')] }))).toMatchObject({ severity: 'blocking', affects: ['customer'] })
    expect(drift(undefined, { gaps: [gap(CUSTOMER_REF, 'columns')] }).writable).toEqual({ create: false, update: false })
    expect(only(drift(undefined, { gaps: [gap(null, 'columns')] }))).toMatchObject({ subject: { kind: 'scope' }, affects: ORDER_FIELDS })

    // Nothing the form does rests on these.
    const checks = drift(undefined, { gaps: [gap(ORDER_REF, 'checks')] })
    expect(only(checks)).toMatchObject({ kind: 'access-narrowed', severity: 'info', affects: [] })
    expect(checks).toMatchObject({ blocking: false, writable: { create: true, update: true } })
    expect(only(drift(undefined, { gaps: [gap(ORDER_REF, 'foreign-keys')] }, { ...ORDER, lookups: [] }))).toMatchObject({ severity: 'info' })
    expect(only(drift(undefined, { gaps: [gap(SUMMARY_REF, 'keys')] }, SUMMARY))).toMatchObject({ severity: 'info' })

    // A table this form neither binds nor looks up is not this form's business.
    expect(drift(undefined, { gaps: [gap(EMPLOYEE_REF, 'columns')] }).changes).toEqual([])
  })

  // A gap that disappeared means the connection sees more than it did when
  // the form was generated. Nothing breaks, so nothing is stopped.
  test('a gap that went away is noted, and stops nothing', () => {
    const base = snapshot(undefined, { gaps: [gap(ORDER_REF, 'foreign-keys')] })
    const report = drift(undefined, {}, ORDER, base)
    expect(only(report)).toMatchObject({ kind: 'access-widened', severity: 'info', subject: { kind: 'object', object: ORDER_REF } })
    expect(report.writable).toEqual({ create: true, update: true })

    // A gap whose wording changed is the same gap: not narrowed, not widened.
    const reworded = drift(undefined, { gaps: [gap(ORDER_REF, 'foreign-keys', 'Reworded by a newer adapter.')] }, ORDER, base)
    expect(reworded.changes).toEqual([])
    // ...and one that went away from a table this form does not use is not its business either.
    expect(drift(undefined, {}, ORDER, snapshot(undefined, { gaps: [gap(EMPLOYEE_REF, 'keys')] })).changes).toEqual([])
  })
})

describe('diffSnapshots: the report', () => {
  // A person reads the review from the top, so what must be fixed comes
  // first. And two runs must be byte-identical, in codepoint order and never
  // the host's locale (snapshot.ts): a review compared with yesterday's must
  // differ only where the database did.
  test('changes are sorted most severe first, then by subject in codepoint order, and two runs agree', () => {
    const edit = (objects: ObjectMeta[]) => {
      addColumn(objects, 'order', col('b', 'int', INT32, { nullable: true }))
      addColumn(objects, 'order', col('B', 'int', INT32, { nullable: true }))
      addColumn(objects, 'order', col('a', 'int', INT32, { nullable: true }))
      dropColumn(objects, 'order', 'attachment')
      dropColumn(objects, 'order', 'notes')
      object(objects, 'order').checks = []
    }
    const report = drift(edit)
    expect(report.changes.map((change) => [change.severity, change.kind, named(change)])).toEqual([
      ['blocking', 'column-dropped', 'notes'],
      ['review', 'column-added', 'B'],
      ['review', 'column-added', 'a'],
      ['review', 'column-added', 'b'],
      ['info', 'check-changed', 'ck_order_amount'],
      ['info', 'column-dropped', 'attachment'],
    ])
    expect(JSON.stringify(drift(edit))).toBe(JSON.stringify(report))

    // A gap about the whole scope comes before anything about one table.
    const scoped = drift((objects) => dropColumn(objects, 'order', 'attachment'), { gaps: [gap(null, 'checks')] })
    expect(scoped.changes.map((change) => [change.kind, change.subject.kind, named(change)])).toEqual([
      ['access-narrowed', 'scope', ''],
      ['column-dropped', 'column', 'attachment'],
    ])
  })

  // Two lookups through one table that vanished are two changes with one
  // subject, each naming its own field. Severity, subject and kind tie, so the
  // message decides, and the order is still the same on every run.
  test('changes that tie on severity, subject and kind are ordered by their message', () => {
    const approvedBy = (objects: ObjectMeta[]) => {
      addColumn(objects, 'order', col('approved_by', 'int', INT32, { nullable: true }))
      object(objects, 'order').foreignKeys.push({ ...foreignKey(objects, 'fk_order_created_by'), name: 'fk_order_approved_by', columns: ['approved_by'] })
    }
    const request = { ...ORDER, lookups: [...ORDER.lookups, { foreignKey: 'fk_order_created_by', display: ['name'] }, { foreignKey: 'fk_order_approved_by', display: ['name'] }] }
    const report = drift(
      (objects) => {
        approvedBy(objects)
        remove(objects, 'employee')
      },
      {},
      request,
      snapshot(approvedBy),
    )
    expect(report.changes.map((change) => [change.kind, change.subject, change.affects])).toEqual([
      ['lookup-changed', { kind: 'object', object: EMPLOYEE_REF }, ['employee']],
      ['lookup-changed', { kind: 'object', object: EMPLOYEE_REF }, ['employee_2']],
    ])
  })
})
