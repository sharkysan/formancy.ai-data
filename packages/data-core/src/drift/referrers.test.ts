import { describe, expect, test } from 'vitest'
import type { InboundKey, ObjectMeta } from '../metadata.js'
import { col, DELETING, drift, gap, INT32, INT64, kinds, object, only, ORDER, ORDER_REF, snapshot, table } from './fixture.js'

/*
 * The referrer family (0050): the keys that refer to the form's root,
 * compared between two snapshots that both record them (0049). What a
 * delete would now also do stops delete, by `unaccepted`, the predicate the
 * publish check refuses a grant by; what only refuses a delete is for
 * review; a key gone is a note, and one out of sight is the gap's to say.
 */

const COPY = { schema: 'audit', name: 'order_copy' }

function key(onDelete: InboundKey['onDelete'], extra: Partial<InboundKey> = {}): InboundKey {
  return {
    table: COPY,
    name: 'fk_order_copy_order',
    columns: ['order_id'],
    referencedColumns: ['id'],
    onDelete,
    onUpdate: 'no-action',
    enforced: true,
    ...extra,
  }
}

/** The order referred to by exactly `keys` from outside the snapshot, beside what the fixture's own keys derive. */
function referredBy(...keys: InboundKey[]): (objects: ObjectMeta[]) => void {
  return (objects) => {
    object(objects, 'order').referencedBy = keys
  }
}

const recorded = (...keys: InboundKey[]) => snapshot(referredBy(...keys), { facts: true })

describe('diffSnapshots: what refers to the root', () => {
  // A key that refused a delete and now cascades would delete rows no form
  // governs from the next request on; the other way round, the database
  // refuses where it deleted, which a person reviews.
  test('a key that now acts on delete stops it; one that now only refuses is for review', () => {
    const toCascade = drift(referredBy(key('cascade')), { facts: true, policy: DELETING }, ORDER, recorded(key('no-action')))
    expect(only(toCascade)).toMatchObject({
      kind: 'referrer-changed',
      severity: 'blocking',
      subject: { kind: 'foreign-key', object: COPY, name: 'fk_order_copy_order' },
      message: expect.stringMatching(/changed: on delete from no-action to cascade\. Deleting a record of sales\.order also deletes rows of audit\.order_copy/),
    })
    expect(toCascade.writable.delete).toBe(false)

    const toRestrict = drift(referredBy(key('restrict')), { facts: true, policy: DELETING }, ORDER, recorded(key('set-null')))
    expect(only(toRestrict)).toMatchObject({ kind: 'referrer-changed', severity: 'review', message: expect.stringMatching(/On delete it restricts/) })
    expect(toRestrict.writable.delete).toBe(true)
  })

  // An acting key counts whatever its enforcement says: on PostgreSQL a key
  // some of whose triggers are disabled may still act (0049), and one
  // enabled again acts without anything here noticing. So a change to it is
  // still one a delete would act through.
  test('an acting key whose enforcement changed is still one a delete acts through', () => {
    const report = drift(
      referredBy(key('cascade', { enforced: false })),
      { facts: true, policy: DELETING },
      ORDER,
      recorded(key('no-action', { enforced: true })),
    )
    expect(only(report)).toMatchObject({
      kind: 'referrer-changed',
      severity: 'blocking',
      message: expect.stringMatching(/enforcement from enforced to not enforced/),
    })
  })

  // Gone, a key does nothing a delete could reach; out of sight behind a
  // referenced-by gap, it may still be there, and the gap says so and stops
  // delete itself.
  test('a key gone is a note, and one out of sight is left to the gap', () => {
    const gone = drift(referredBy(), { facts: true, policy: DELETING }, ORDER, recorded(key('no-action')))
    expect(only(gone)).toMatchObject({ kind: 'referrer-changed', severity: 'info', message: expect.stringMatching(/which referred to sales\.order, is gone/) })
    expect(gone.writable.delete).toBe(true)

    const hidden = drift(referredBy(), { facts: true, policy: DELETING, gaps: [gap(null, 'referenced-by')] }, ORDER, recorded(key('no-action')))
    expect(kinds(hidden)).toEqual(['access-narrowed'])
    expect(hidden.writable.delete).toBe(false)
  })

  // A snapshot an older server took records nothing about deleting. Against
  // a base that did, delete rests on facts no longer there.
  test('a current snapshot without the facts its base had stops delete', () => {
    const report = drift(undefined, { policy: DELETING }, ORDER, recorded())
    expect(only(report)).toMatchObject({
      kind: 'access-narrowed',
      severity: 'blocking',
      subject: { kind: 'object', object: { schema: 'sales', name: 'order' } },
    })
    expect(report.writable.delete).toBe(false)
  })
})

/*
 * Past the root (0051): a delete of an order whose policy accepts the
 * lines' cascade reaches order_line, and whatever refers to order_line acts
 * on that delete too. Each table of the reach is compared as the root is,
 * and so is whether the account may still DELETE from it -- the adapters
 * refuse a delete that reaches a table the account may not delete from, so
 * review stops it first.
 */

const LINES: ObjectMeta['ref'] = { schema: 'sales', name: 'order_line' }
const LINE_KEY = { table: LINES, foreignKey: 'fk_order_line_order', onDelete: 'cascade' } as const
const ACCEPTING = { ...DELETING, cascades: [LINE_KEY] }

/** The order's lines, cascading from it as the fixture's do, and `onLines` referring to them from outside the snapshot. */
function lined(onDelete: InboundKey['onDelete'] = 'cascade', ...onLines: InboundKey[]): (objects: ObjectMeta[]) => void {
  return (objects) => {
    objects.push(
      table('order_line', [col('order_id', 'bigint', INT64), col('line_no', 'int', INT32), col('memo_id', 'int', INT32, { nullable: true })], {
        primaryKey: { name: 'pk_order_line', columns: ['order_id', 'line_no'] },
        uniqueKeys: [{ name: 'uq_order_line_memo', columns: ['memo_id'] }],
        foreignKeys: [
          {
            name: 'fk_order_line_order',
            columns: ['order_id'],
            references: { table: ORDER_REF, columns: ['id'] },
            onDelete,
            onUpdate: 'no-action',
            enforced: true,
            validated: true,
          },
        ],
      }),
    )
    if (onLines.length > 0) object(objects, 'order_line').referencedBy = onLines
  }
}

const onLines = (onDelete: InboundKey['onDelete'], extra: Partial<InboundKey> = {}): InboundKey => ({
  table: COPY,
  name: 'fk_line_copy_line',
  columns: ['order_id', 'line_no'],
  referencedColumns: ['order_id', 'line_no'],
  onDelete,
  onUpdate: 'no-action',
  enforced: true,
  ...extra,
})

describe('diffSnapshots: what refers to the tables a delete reaches', () => {
  // A new key that cascades onto the lines would delete rows of a third
  // table with every order deleted -- through a key nobody named. Stopped,
  // by the predicate the publish check refuses a grant by (watched failing
  // with the root's keys alone compared: no change reported, delete still
  // allowed while the adapters' guards refuse it).
  test('a new key that acts on a delete of a table the delete reaches stops it; one that only refuses is for review', () => {
    const base = snapshot(lined(), { facts: true })
    const cascading = drift(lined('cascade', onLines('cascade')), { facts: true, policy: ACCEPTING }, ORDER, base)
    expect(only(cascading)).toMatchObject({
      kind: 'referrer-added',
      severity: 'blocking',
      subject: { kind: 'foreign-key', object: COPY, name: 'fk_line_copy_line' },
      message: expect.stringMatching(
        /refers to sales\.order_line, which a delete of sales\.order reaches\. Deleting a record of sales\.order also deletes rows of audit\.order_copy/,
      ),
    })
    expect(cascading.writable.delete).toBe(false)
    const refusing = drift(lined('cascade', onLines('no-action')), { facts: true, policy: ACCEPTING }, ORDER, base)
    expect(only(refusing)).toMatchObject({ kind: 'referrer-added', severity: 'review' })
    expect(refusing.writable.delete).toBe(true)
  })

  // The lines' own key, accepted as a cascade, became SET NULL: the delete
  // would now clear what the administrator accepted it deletes. Unchanged,
  // it is what the policy accepts, and nothing is said.
  test('an accepted key is no change, and one whose action changed stops delete', () => {
    const base = snapshot(lined(), { facts: true })
    expect(drift(lined(), { facts: true, policy: ACCEPTING }, ORDER, base).changes).toEqual([])
    const changed = drift(lined('set-null'), { facts: true, policy: ACCEPTING }, ORDER, base)
    expect(only(changed)).toMatchObject({
      kind: 'referrer-changed',
      severity: 'blocking',
      message: expect.stringMatching(/on delete from cascade to set-null/),
    })
  })

  // The adapters hold a delete to the account's DELETE on every table it
  // reaches: PostgreSQL's statement and SQL Server's batch each ask it.
  // Review stops it first, as it does for the root (watched failing with
  // the root's grant alone compared).
  test('DELETE revoked on a table the delete reaches stops delete', () => {
    const base = snapshot(lined(), { facts: true })
    const revoked = drift(
      (objects) => {
        lined()(objects)
        object(objects, 'order_line').access = { delete: false }
      },
      { facts: true, policy: ACCEPTING },
      ORDER,
      base,
    )
    expect(only(revoked)).toMatchObject({
      kind: 'privilege-narrowed',
      severity: 'blocking',
      subject: { kind: 'object', object: LINES },
      message: expect.stringMatching(/may no longer DELETE from sales\.order_line, which a delete of sales\.order reaches/),
    })
    expect(revoked.writable.delete).toBe(false)
  })

  // Out of sight is not nothing: a key onto the lines behind a gap may
  // cascade on, and the delete would follow it unasked.
  test('a referenced-by gap on a table the delete reaches stops delete', () => {
    const base = snapshot(lined(), { facts: true })
    const hidden = drift(lined(), { facts: true, policy: ACCEPTING, gaps: [gap(LINES, 'referenced-by')] }, ORDER, base)
    expect(only(hidden)).toMatchObject({ kind: 'access-narrowed', severity: 'blocking' })
    expect(hidden.writable.delete).toBe(false)
  })

  // A key that follows a column a delete clears carries the change on into
  // its own table by ON UPDATE; the publish check refuses it, and the
  // adapters' guards do, so review stops it. One that only refuses the
  // change is the database's to enforce, as a NO ACTION key onto a removed
  // table is: for review, with delete still allowed (watched failing with
  // every key over a cleared column stopping delete).
  test('a new key that follows a cleared column on update stops delete; one that only refuses the change is for review', () => {
    const memo = (objects: ObjectMeta[]) => {
      lined('set-null')(objects)
      const line = object(objects, 'order_line')
      line.foreignKeys = line.foreignKeys.map((foreignKey) => ({ ...foreignKey, columns: ['memo_id'] }))
    }
    const accepting = { ...DELETING, cascades: [{ table: LINES, foreignKey: 'fk_order_line_order', onDelete: 'set-null' as const }] }
    const follower = onLines('no-action', { name: 'fk_memo_copy', columns: ['memo_id'], referencedColumns: ['memo_id'], onUpdate: 'cascade' })
    const report = drift(
      (objects) => {
        memo(objects)
        object(objects, 'order_line').referencedBy = [follower]
      },
      { facts: true, policy: accepting },
      ORDER,
      snapshot(memo, { facts: true }),
    )
    expect(only(report)).toMatchObject({ kind: 'referrer-added', severity: 'blocking', message: expect.stringMatching(/follows memo_id ON UPDATE CASCADE/) })
    expect(report.writable.delete).toBe(false)
    const refusing = drift(
      (objects) => {
        memo(objects)
        object(objects, 'order_line').referencedBy = [{ ...follower, onUpdate: 'no-action' }]
      },
      { facts: true, policy: accepting },
      ORDER,
      snapshot(memo, { facts: true }),
    )
    expect(only(refusing)).toMatchObject({
      kind: 'referrer-added',
      severity: 'review',
      message: expect.stringMatching(/On update it takes no action: the database refuses to clear memo_id while rows of audit\.order_copy refer to them\./),
    })
    expect(refusing.writable.delete).toBe(true)
  })
})
