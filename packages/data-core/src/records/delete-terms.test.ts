import { describe, expect, test } from 'vitest'
import { deleteTerms } from './delete-terms.js'
import { INT32, INT64, ORDER_ID, ORDER_TARGET, sales, TENANT_ONE, value } from './test-support.js'
import type { DeleteRequest } from './types.js'

/*
 * What both adapters read a delete request through (0050), before any
 * statement is built. A request is the planner's, but an adapter is handed
 * it at run time, where a caller in JavaScript or a request rebuilt from
 * JSON is not held to the types; what the planner would never produce is
 * thrown, never deleted.
 */

const REQUEST: DeleteRequest = {
  target: ORDER_TARGET.sqlserver as unknown as DeleteRequest['target'],
  key: [value('id', INT64, ORDER_ID)],
  expectedVersion: '00000000000007d1',
  filters: TENANT_ONE as unknown as DeleteRequest['filters'],
  through: [],
  reach: { removed: [sales('order')], cleared: [], accepted: [] },
  definition: 'd',
}

const altered = (change: Record<string, unknown>): DeleteRequest => ({ ...REQUEST, ...change }) as DeleteRequest

describe('deleteTerms', () => {
  // The terms are fresh, and hold what the request said and nothing more.
  test('reads a planned request', () => {
    expect(deleteTerms(REQUEST)).toEqual({
      key: [value('id', INT64, ORDER_ID)],
      expectedVersion: '00000000000007d1',
      terms: [{ column: 'tenant_id', type: INT32, value: '1' }],
      through: [],
      root: sales('order'),
    })
  })

  // A key that is not the identity could name several rows, or none of the
  // record's; with no value, `= NULL` matches nothing on one engine and is
  // an error on none (watched failing with any key accepted).
  test('refuses a key that is not the identity, column for column, with a value', () => {
    expect(() => deleteTerms(altered({ key: [] }))).toThrow(/every column of the identity/)
    expect(() => deleteTerms(altered({ key: [value('tenant_id', INT32, '1')] }))).toThrow(/every column of the identity/)
    expect(() => deleteTerms(altered({ key: [value('id', INT64, null)] }))).toThrow(/each with a value/)
    expect(() => deleteTerms(altered({ target: { ...REQUEST.target, identity: [] } }))).toThrow(/a target with an identity/)
  })

  // A delete without the version its person read would destroy edits made
  // since, which they never saw; one with no token cannot be guarded at all.
  test('refuses a delete without a version, or without a token to compare it with', () => {
    expect(() => deleteTerms(altered({ expectedVersion: '' }))).toThrow(/the version its person read/)
    expect(() => deleteTerms(altered({ expectedVersion: undefined }))).toThrow(/the version its person read/)
    expect(() => deleteTerms(altered({ target: { ...REQUEST.target, concurrency: null } }))).toThrow(/concurrency token/)
  })

  // Without its filters a delete would reach every tenant's rows; without
  // its throughs, every parent's.
  test('refuses a delete without its filters or its throughs', () => {
    expect(() => deleteTerms(altered({ filters: undefined }))).toThrow(/carries the filters/)
    expect(() => deleteTerms(altered({ through: undefined }))).toThrow(/carries its throughs/)
    expect(() => deleteTerms(altered({ filters: { kind: 'restricted', equal: [] } }))).toThrow()
  })

  // 0050 deletes from its root and nothing else. A reach that starts
  // elsewhere names another table to delete from; one that goes past the
  // root is one these statements cannot hold the database to.
  test('refuses a reach that does not begin with the root, or goes past it', () => {
    expect(() => deleteTerms(altered({ reach: undefined }))).toThrow(/says what it reaches/)
    expect(() => deleteTerms(altered({ reach: { removed: [sales('order_line')], cleared: [], accepted: [] } }))).toThrow(/removes rows of its root first/)
    expect(() => deleteTerms(altered({ reach: { removed: [sales('order'), sales('order_line')], cleared: [], accepted: [] } }))).toThrow(/reaches past its root/)
    expect(() => deleteTerms(altered({ reach: { removed: [sales('order')], cleared: [{ table: sales('x'), columns: ['a'] }], accepted: [] } }))).toThrow(/reaches past its root/)
    expect(() =>
      deleteTerms(altered({ reach: { removed: [sales('order')], cleared: [], accepted: [{ from: sales('order_line'), name: 'fk', onto: sales('order'), onDelete: 'cascade' }] } })),
    ).toThrow(/reaches past its root/)
  })
})
