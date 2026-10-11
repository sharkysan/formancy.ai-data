import { describe, expect, test } from 'vitest'
import type { InboundKey, ObjectMeta } from '../metadata.js'
import { factsSnapshot, MS, MS_FACTS, ORDER_POLICY, orderForm, sales } from '../records/test-support.js'
import { createSnapshot } from '../snapshot.js'
import { deleteProblems, deleteReach } from './cascades.js'
import type { FormPolicy } from './types.js'

/*
 * What a delete of one of the order form's records also does, and whether
 * a policy may grant it (0050): one decision, asked at publish, on every
 * read of a bundle, by the planner and -- through `unaccepted` -- by drift
 * review. In 0050 a delete reaches nothing past its root: a key that would
 * delete, clear or set a default in another table's rows refuses the grant.
 */

const DELETING: FormPolicy = { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: ['clerk'] } }

/** The test snapshot with 0049's facts, its order_line key onto order doing `onDelete`. */
function lines(onDelete: InboundKey['onDelete'], enforced = true) {
  return factsSnapshot('sqlserver', (objects) => {
    const key = objects.find((object) => object.ref.name === 'order_line')?.foreignKeys.find((candidate) => candidate.name === 'fk_order_line_order')
    if (key !== undefined) Object.assign(key, { onDelete, enforced })
  })
}

/** The order referred to as well by a key from a table outside the snapshot. */
function copied(onDelete: InboundKey['onDelete']) {
  return factsSnapshot('sqlserver', (objects: ObjectMeta[]) => {
    const order = objects.find((object) => object.ref.name === 'order') as ObjectMeta
    order.referencedBy = [{ table: { schema: 'audit', name: 'order_copy' }, name: 'fk_copy', columns: ['order_id', 'kept'], referencedColumns: ['id', 'tenant_id'], onDelete, onUpdate: 'no-action', enforced: true }]
  })
}

describe('deleteProblems', () => {
  // A policy that grants delete to nobody makes no claim about what a
  // delete does, whatever the database would do on one.
  test('says nothing of a policy that grants nobody delete', () => {
    expect(deleteProblems(lines('cascade'), orderForm(lines('cascade')).bindings, ORDER_POLICY)).toEqual([])
    expect(deleteProblems(lines('cascade'), orderForm(lines('cascade')).bindings, { ...ORDER_POLICY, operations: { ...ORDER_POLICY.operations, delete: [] } })).toEqual([])
  })

  // The fixture's lines cascade from their order. Granted, a delete of an
  // order would delete rows no form governs, which 0050 does not offer;
  // clearing a reference or setting a default is as much a change to
  // another table's rows. Each key is named, with its table and action
  // (watched failing with every grant accepted).
  test('refuses a grant while a key from another table deletes, clears or defaults its rows on delete', () => {
    const snapshot = lines('cascade')
    expect(deleteProblems(snapshot, orderForm(snapshot).bindings, DELETING)).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also deletes rows of sales.order_line (fk_order_line_order, ON DELETE CASCADE), which this release does not offer',
    ])
    expect(deleteProblems(copied('set-null'), orderForm(copied('set-null')).bindings, DELETING)).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also sets order_id, kept of audit.order_copy to NULL in the rows that refer to it (fk_copy, ON DELETE SET NULL), which this release does not offer',
    ])
    expect(deleteProblems(copied('set-default'), orderForm(copied('set-default')).bindings, DELETING)).toEqual([
      'operations.delete grants roles, and deleting a record of sales.order also sets order_id, kept of audit.order_copy to its default in the rows that refer to it (fk_copy, ON DELETE SET DEFAULT), which this release does not offer',
    ])
  })

  // A key whose triggers are disabled still acts on PostgreSQL when they
  // are the referring table's checks (0049), and one enabled again acts with
  // nothing here noticing: counted whatever `enforced` says.
  test('counts an acting key whatever its enforcement', () => {
    const snapshot = lines('cascade', false)
    expect(deleteProblems(snapshot, orderForm(snapshot).bindings, DELETING)).toHaveLength(1)
  })

  // A key that only refuses a delete -- NO ACTION, RESTRICT -- is the
  // database's to enforce: a delete of a record still referred to is
  // refused there, and nothing else is changed.
  test('accepts a grant while the keys that refer to the root only refuse a delete', () => {
    for (const action of ['no-action', 'restrict'] as const) {
      const snapshot = lines(action)
      expect(deleteProblems(snapshot, orderForm(snapshot).bindings, DELETING)).toEqual([])
    }
  })

  // What a delete does cannot be seen from a snapshot taken before 0049,
  // nor from one that says it cannot see every key: refused, rather than
  // read as "nothing refers to it".
  test('refuses a grant over a snapshot that does not record, or cannot see, what refers to the root', () => {
    expect(deleteProblems(MS, orderForm(MS).bindings, DELETING)).toEqual([
      'operations.delete grants roles, and this snapshot does not record what refers to sales.order, so what a delete also does cannot be seen: discover again',
    ])
    const { fingerprint: _fingerprint, ...rest } = MS_FACTS
    const hidden = createSnapshot({ ...rest, gaps: [{ subject: { kind: 'scope' }, aspect: 'referenced-by', detail: 'this account lacks VIEW DEFINITION on the database' }] })
    expect(deleteProblems(hidden, orderForm(hidden).bindings, DELETING)).toEqual([
      'operations.delete grants roles, and this snapshot cannot show everything that refers to sales.order: this account lacks VIEW DEFINITION on the database',
    ])
    const elsewhere = createSnapshot({ ...rest, gaps: [{ subject: { kind: 'object', object: sales('employee') }, aspect: 'referenced-by', detail: 'a key onto a partition' }] })
    expect(deleteProblems(elsewhere, orderForm(elsewhere).bindings, DELETING)).toEqual([])
  })
})

describe('deleteReach', () => {
  // In 0050 a delete removes rows of its root and of nothing else; whether
  // the database may refuse it while the record is referred to is what a
  // page tells a person before they confirm.
  test('is the root alone, and says whether a key may refuse the delete', () => {
    expect(deleteReach(lines('no-action'), sales('order'))).toEqual({ reach: { removed: [sales('order')], cleared: [], accepted: [] }, restricted: true })
    expect(deleteReach(lines('restrict'), sales('order')).restricted).toBe(true)
    expect(deleteReach(lines('cascade'), sales('order')).restricted).toBe(false)
    expect(deleteReach(MS_FACTS, sales('order_line')).restricted).toBe(false)
  })
})
