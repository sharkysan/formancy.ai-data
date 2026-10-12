import { describe, expect, test } from 'vitest'
import type { InboundKey, ObjectMeta } from '../metadata.js'
import { DELETING, drift, gap, kinds, object, only, ORDER, snapshot } from './fixture.js'

/*
 * The referrer family (0050): the keys that refer to the form's root,
 * compared between two snapshots that both record them (0049). What a
 * delete would now also do stops delete, by `unaccepted`, the predicate the
 * publish check refuses a grant by; what only refuses a delete is for
 * review; a key gone is a note, and one out of sight is the gap's to say.
 */

const COPY = { schema: 'audit', name: 'order_copy' }

function key(onDelete: InboundKey['onDelete'], extra: Partial<InboundKey> = {}): InboundKey {
  return { table: COPY, name: 'fk_order_copy_order', columns: ['order_id'], referencedColumns: ['id'], onDelete, onUpdate: 'no-action', enforced: true, ...extra }
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
    const report = drift(referredBy(key('cascade', { enforced: false })), { facts: true, policy: DELETING }, ORDER, recorded(key('no-action', { enforced: true })))
    expect(only(report)).toMatchObject({ kind: 'referrer-changed', severity: 'blocking', message: expect.stringMatching(/enforcement from enforced to not enforced/) })
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
    expect(only(report)).toMatchObject({ kind: 'access-narrowed', severity: 'blocking', subject: { kind: 'object', object: { schema: 'sales', name: 'order' } } })
    expect(report.writable.delete).toBe(false)
  })
})
