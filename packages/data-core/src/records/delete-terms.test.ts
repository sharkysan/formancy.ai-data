import { describe, expect, test } from 'vitest'
import { deleteTerms, reachesPast } from './delete-terms.js'
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
      reach: { removed: [sales('order')], cleared: [], accepted: [] },
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

  // A reach that starts elsewhere names another table to delete from as
  // though it were the record's.
  test('refuses a reach that does not begin with the root', () => {
    expect(() => deleteTerms(altered({ reach: undefined }))).toThrow(/says what it reaches/)
    expect(() => deleteTerms(altered({ reach: { removed: [sales('order_line')], cleared: [], accepted: [] } }))).toThrow(/removes rows of its root first/)
    expect(() => deleteTerms(altered({ reach: { removed: [sales('order'), sales('order')], cleared: [], accepted: [] } }))).toThrow(
      /each table it removes rows of once/,
    )
  })

  // Past the root since 0051: the tables a cascade removes rows of, those a
  // key clears, and each key accepted with the table it refers to -- read
  // fresh, as the guards and the locks are built from it.
  test('reads a reach past the root that the keys it accepts account for', () => {
    const reach = {
      removed: [sales('order'), sales('order_line')],
      cleared: [{ table: sales('order_memo'), columns: ['order_id'] }],
      accepted: [
        { from: sales('order_line'), name: 'fk_order_line_order', onto: sales('order'), onDelete: 'cascade' },
        { from: sales('order_memo'), name: 'fk_order_memo_order', onto: sales('order'), onDelete: 'set-null' },
      ],
    }
    expect(deleteTerms(altered({ reach })).reach).toEqual(reach)
  })

  // The adapters lock and guard what the reach names, and match each key
  // the database shows against the accepted ones. A table removed or
  // cleared that no accepted key reaches, a key onto a table the delete
  // does not remove rows of, or one whose table the reach leaves out, is a
  // reach the planner never makes: thrown, so the statements are never
  // built from tables and keys that do not agree (watched failing with
  // every reach past the root accepted as it came).
  test('refuses a reach whose tables and accepted keys do not agree', () => {
    const line = { from: sales('order_line'), name: 'fk_order_line_order', onto: sales('order'), onDelete: 'cascade' }
    const memo = { from: sales('order_memo'), name: 'fk_order_memo_order', onto: sales('order'), onDelete: 'set-null' }
    const reach = (removed: unknown[], cleared: unknown[], accepted: unknown[]) => altered({ reach: { removed, cleared, accepted } })
    expect(() => deleteTerms(reach([sales('order'), sales('order_line')], [], []))).toThrow(/no key it accepts cascades into/)
    expect(() => deleteTerms(reach([sales('order')], [], [line]))).toThrow(/a cascade into a table it does not say it removes rows of/)
    expect(() => deleteTerms(reach([sales('order'), sales('order_line')], [], [{ ...line, onto: sales('customer') }]))).toThrow(
      /a key onto a table it does not remove rows of/,
    )
    expect(() => deleteTerms(reach([sales('order')], [{ table: sales('order_memo'), columns: ['order_id'] }], []))).toThrow(/no key it accepts clears/)
    expect(() => deleteTerms(reach([sales('order')], [], [memo]))).toThrow(/a key that clears a table it does not say it clears/)
    expect(() => deleteTerms(reach([sales('order')], [{ table: sales('order_memo'), columns: [] }], [memo]))).toThrow(
      /each table it clears with the columns it clears/,
    )
    expect(() => deleteTerms(reach([sales('order'), sales('order_line')], [], [{ ...line, onDelete: 'no-action' }]))).toThrow(/each key it accepts by/)
  })
})

describe('reachesPast', () => {
  // Whether PostgreSQL takes the locked path whatever the isolation, and
  // locks every table of the reach before its statement (0051). A delete
  // that only clears a reference reaches past its root as much as one that
  // cascades: read as reaching its root alone, it would lock nothing but the
  // root, and a key added onto the cleared table while it waited would carry
  // the change on unseen (watched failing with the cleared tables left out).
  test('is true for a reach that removes rows of another table or clears one, and false for the root alone', () => {
    expect(reachesPast({ removed: [sales('order')], cleared: [] })).toBe(false)
    expect(reachesPast({ removed: [sales('order'), sales('order_line')], cleared: [] })).toBe(true)
    expect(reachesPast({ removed: [sales('order')], cleared: [{ table: sales('order_memo'), columns: ['order_id'] }] })).toBe(true)
  })
})
