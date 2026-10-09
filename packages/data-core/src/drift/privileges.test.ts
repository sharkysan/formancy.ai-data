import { describe, expect, test } from 'vitest'
import { generateForm } from '../generate/generate.js'
import type { ObjectMeta } from '../metadata.js'
import { diffSnapshots } from './diff.js'
import {
  CUSTOMER_REF,
  drift,
  kinds,
  named,
  NO_FILTERS,
  object,
  only,
  ORDER,
  ORDER_FIELDS,
  ORDER_REF,
  remove,
  restrict,
  snapshot,
} from './fixture.js'

/*
 * What a change in what the account may do means for one form (0027): one
 * case per row of the decision's drift table. The base is the owner's
 * snapshot unless a test says otherwise; the current one narrows or widens one
 * privilege, as a REVOKE or a GRANT would.
 */

/** Publish from a base made by `before`, review against a snapshot made by `after`. */
function between(before: (objects: ObjectMeta[]) => void, after: (objects: ObjectMeta[]) => void, request = ORDER, kind: 'sqlserver' | 'postgres' = 'sqlserver') {
  return drift(after, { kind }, request, snapshot(before, { kind }))
}

const nothing = () => {}

describe('diffSnapshots: privileges of the root', () => {
  // The read of a record names every bound column; one the account may no
  // longer SELECT fails it with permission-denied. Before 0027 the column
  // vanished from a privilege-filtered catalog and drift called it dropped;
  // the remedy is a grant, so the report says privilege.
  test('a bound column that lost SELECT breaks reads, and is a privilege change, not a dropped column', () => {
    const report = drift((objects) => restrict(objects, 'order', 'notes', { select: false }))
    expect(only(report)).toMatchObject({
      kind: 'privilege-narrowed',
      severity: 'blocking',
      subject: { kind: 'column', object: ORDER_REF, name: 'notes' },
      affects: ['notes'],
      message: expect.stringMatching(/^This connection's account may no longer SELECT notes of sales\.order\..*grant/),
    })
    expect(report.writable).toEqual({ create: false, update: false })
  })

  // The identity is read back into every record token; unreadable, no record
  // can be addressed, and every read and update fails.
  test('an identity column that lost SELECT breaks reads', () => {
    const report = drift((objects) => restrict(objects, 'order', 'id', { select: false }))
    expect(only(report)).toMatchObject({ kind: 'privilege-narrowed', severity: 'blocking', affects: ['id'], message: expect.stringMatching(/identifies a record/) })
    expect(report.writable).toEqual({ create: false, update: false })
  })

  // A confirmed concurrency token is read with every record and returned by
  // every create — both adapters name it in the read's select list and in the
  // insert's RETURNING or OUTPUT — so one the account may no longer SELECT
  // fails every read and every create with permission-denied. Reporting
  // "stops update" alone would leave create offered over a statement the
  // database refuses.
  test('a confirmed concurrency column that lost SELECT breaks reads, rowversion or version column', () => {
    const rowversion = drift((objects) => restrict(objects, 'order', 'row_version', { select: false }))
    expect(only(rowversion)).toMatchObject({
      kind: 'privilege-narrowed',
      severity: 'blocking',
      subject: { kind: 'column', object: ORDER_REF, name: 'row_version' },
      message: expect.stringMatching(/concurrency token, read with every record and returned by every create/),
    })
    expect(rowversion.writable).toEqual({ create: false, update: false })

    const confirmed = { ...ORDER, versionColumn: 'row_version' }
    const version = between(nothing, (objects) => restrict(objects, 'order', 'row_version', { select: false }), confirmed, 'postgres')
    expect(only(version)).toMatchObject({ kind: 'privilege-narrowed', severity: 'blocking' })
    expect(version.writable).toEqual({ create: false, update: false })
  })

  // A version column is written by every update and read by nothing else
  // than what SELECT covers: one that lost only UPDATE stops update, and
  // create, which never names it in a SET, goes on.
  test('a version column that lost UPDATE stops update and only update', () => {
    const confirmed = { ...ORDER, versionColumn: 'row_version' }
    const version = between(nothing, (objects) => restrict(objects, 'order', 'row_version', { update: false }), confirmed, 'postgres')
    expect(only(version)).toMatchObject({ kind: 'privilege-narrowed', severity: 'blocking', message: expect.stringMatching(/version column/) })
    expect(version.writable).toEqual({ create: true, update: false })
  })

  // A suggested version column is used by nothing until it is confirmed:
  // update is not offered, and no statement names it. Losing SELECT on it
  // decides nothing.
  test('an unconfirmed version column that lost SELECT is information', () => {
    const report = between(nothing, (objects) => restrict(objects, 'order', 'row_version', { select: false }), ORDER, 'postgres')
    expect(only(report)).toMatchObject({ kind: 'privilege-narrowed', severity: 'info' })
  })

  // An INSERT naming a column the account may no longer INSERT is refused;
  // an UPDATE does not name it, so update goes on.
  test('a column a field writes on create that lost INSERT stops create', () => {
    const report = drift((objects) => restrict(objects, 'order', 'amount', { insert: false }))
    expect(only(report)).toMatchObject({ kind: 'privilege-narrowed', severity: 'blocking', affects: ['amount'] })
    expect(report.writable).toEqual({ create: false, update: true })
  })

  // A pinned column is bound and written on no operation by a field: the
  // policy writes it from the trusted context on create. The bindings do not
  // record pins, so any bound column not written on create that loses INSERT
  // stops create — over-blocking on purpose, because the alternative is a
  // create the database refuses for every tenant.
  test('a bound, non-generated column not written on create that lost INSERT stops create', () => {
    const pinned = { ...ORDER, lookups: [], pinned: ['tenant_id'] }
    const base = snapshot()
    expect(generateForm(base, pinned).bindings.fields.find((binding) => binding.field === 'tenant_id')?.writes).toEqual({ create: false, update: false })
    const report = drift((objects) => restrict(objects, 'order', 'tenant_id', { insert: false }), {}, pinned)
    expect(only(report)).toMatchObject({ kind: 'privilege-narrowed', severity: 'blocking', affects: ['tenant_id'] })
    expect(report.writable).toEqual({ create: false, update: true })
    // A generated column is filled by the database, never named in an INSERT.
    expect(only(drift((objects) => restrict(objects, 'order', 'id', { insert: false })))).toMatchObject({ kind: 'privilege-narrowed', severity: 'info' })
  })

  // An UPDATE naming a column the account may no longer UPDATE is refused.
  test('a column a field writes on update that lost UPDATE stops update', () => {
    const report = drift((objects) => restrict(objects, 'order', 'status', { update: false }))
    expect(only(report)).toMatchObject({ kind: 'privilege-narrowed', severity: 'blocking', affects: ['status'] })
    expect(report.writable).toEqual({ create: true, update: false })
  })

  // Written on update only (the account may UPDATE and not INSERT it), the
  // column is not in any INSERT, so losing UPDATE leaves create alone.
  test('a field written on update only that loses UPDATE stops update and not create', () => {
    const report = between(
      (objects) => restrict(objects, 'order', 'notes', { insert: false }),
      (objects) => restrict(objects, 'order', 'notes', { insert: false, update: false }),
    )
    expect(only(report)).toMatchObject({ kind: 'privilege-narrowed', severity: 'blocking', affects: ['notes'] })
    expect(report.writable).toEqual({ create: true, update: false })
  })

  // What the form does not rest on is recorded and decides nothing: a
  // column no field binds, and every privilege gained.
  test('any other capability change on the root is information, narrowed or widened', () => {
    expect(only(drift((objects) => restrict(objects, 'order', 'attachment', { select: false })))).toMatchObject({ kind: 'privilege-narrowed', severity: 'info', affects: [] })
    const widened = between((objects) => restrict(objects, 'order', 'amount', { update: false }), nothing)
    expect(only(widened)).toMatchObject({
      kind: 'privilege-widened',
      severity: 'info',
      subject: { kind: 'column', object: ORDER_REF, name: 'amount' },
      message: expect.stringMatching(/may now UPDATE amount.*Regenerating may offer more/),
    })
    expect(widened.writable).toEqual({ create: true, update: true })
  })
})

describe('diffSnapshots: privileges of a lookup target', () => {
  // Every search reads the target's key, for the token, and its display
  // columns, for the label. One the account may no longer read fails every
  // search, and a selection can no longer be rechecked on save.
  test("a lookup target's key or display column that lost SELECT stops both writes and affects the lookup", () => {
    for (const lost of ['tenant_id', 'name']) {
      const report = drift((objects) => restrict(objects, 'customer', lost, { select: false }))
      expect(only(report), lost).toMatchObject({ kind: 'privilege-narrowed', severity: 'blocking', subject: { kind: 'column', object: CUSTOMER_REF, name: lost }, affects: ['customer'] })
      expect(report.writable, lost).toEqual({ create: false, update: false })
    }
    // A target column the lookup neither keys on nor shows is not its business.
    expect(only(drift((objects) => restrict(objects, 'customer', 'active', { select: false })))).toMatchObject({ kind: 'privilege-narrowed', severity: 'info', affects: [] })
    expect(only(drift((objects) => restrict(objects, 'customer', 'name', { update: false })))).toMatchObject({ severity: 'info' })
  })
})

describe('diffSnapshots: row security and the account', () => {
  // Which rows a form shows changed, and nothing says which: a person decides.
  // Neither adapter reports a write done that the table does not hold, so
  // nothing is stopped (B17).
  test('row security that changed on the root or a lookup target is for review, and stops nothing', () => {
    const root = drift((objects) => (object(objects, 'order').rowSecurity = 'applies'))
    expect(only(root)).toMatchObject({ kind: 'row-security-changed', severity: 'review', subject: { kind: 'object', object: ORDER_REF }, message: expect.stringMatching(/now applies/) })
    expect(root.writable).toEqual({ create: true, update: true })
    const target = drift((objects) => (object(objects, 'customer').rowSecurity = 'applies'))
    expect(only(target)).toMatchObject({ kind: 'row-security-changed', severity: 'review', subject: { kind: 'object', object: CUSTOMER_REF }, affects: ['customer'] })
    // A table the form does not touch is not its business.
    expect(drift((objects) => (object(objects, 'employee').rowSecurity = 'applies')).changes).toEqual([])
  })

  // The same database read by another principal: before 0027 two such
  // snapshots could hash alike and report nothing. With identical grants and
  // no row security nothing the form does changes, and a person still has to
  // know whose form it now is.
  test('another account with identical grants and no row security is for review, never an empty report', () => {
    const report = drift(undefined, { account: { user: 'clerk', login: 'clerk' } })
    expect(only(report)).toMatchObject({ kind: 'account-changed', severity: 'review', subject: { kind: 'scope' }, message: expect.stringMatching(/owner.*clerk/) })
    expect(report.writable).toEqual({ create: true, update: true })
    // A login is not the principal: a renamed login mapped to the same user changes nothing.
    expect(drift(undefined, { account: { user: 'owner', login: 'app_login_2026' } }).changes).toEqual([])
  })

  // A policy decides rows by the principal it sees (B5): under another user
  // the form shows other records, and a person who reviewed it reviewed
  // somebody else's. Blocking while row security is in play on either side.
  test('another account while row security applies to the root or a target is blocking', () => {
    const policed = (objects: ObjectMeta[]) => (object(objects, 'customer').rowSecurity = 'applies')
    const report = drift(policed, { account: { user: 'clerk', login: 'clerk' } }, ORDER, snapshot(policed))
    expect(only(report)).toMatchObject({ kind: 'account-changed', severity: 'blocking', affects: ORDER_FIELDS })
    expect(report.writable).toEqual({ create: false, update: false })
    // In either snapshot: row security that stopped applying with the account change is still in play.
    expect(drift(undefined, { account: { user: 'clerk', login: 'clerk' } }, ORDER, snapshot(policed)).blocking).toBe(true)
  })

  // A root that is gone under another account may be gone for that account
  // only; the report says both.
  test('an account change is reported beside a missing root', () => {
    const report = drift((objects) => remove(objects, 'order'), { account: { user: 'clerk', login: 'clerk' } })
    expect(kinds(report)).toEqual(['root-dropped', 'account-changed'])
    expect(report.changes.map(named)).toEqual(['', ''])
  })

  // Equal fingerprints still mean nothing to walk; a different user is a
  // different fingerprint, so the fast path cannot hide it.
  test('the fast path holds only for the same principal', () => {
    const base = snapshot()
    const { bindings } = generateForm(base, ORDER)
    expect(diffSnapshots(base, snapshot(undefined, { account: { user: 'clerk', login: 'owner' } }), bindings, NO_FILTERS).changes).toHaveLength(1)
  })
})
