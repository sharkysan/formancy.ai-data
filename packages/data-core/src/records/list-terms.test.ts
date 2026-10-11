import { describe, expect, test } from 'vitest'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { listTerms } from './list-terms.js'
import { DATE, INT32, INT64, ORDER_TARGET, TENANT_ONE, text } from './test-support.js'
import type { ListRequest } from './types.js'

/*
 * What both adapters read a list request through (0044), before any
 * statement is built. A request is the planner's, but an adapter is handed
 * it at run time, where a caller in JavaScript or a request rebuilt from JSON
 * is not held to the types; what the planner would never produce is thrown,
 * never listed.
 */

const REQUEST: ListRequest = {
  target: ORDER_TARGET.postgres,
  columns: [{ name: 'id', type: INT64 }],
  filters: TENANT_ONE as unknown as ListRequest['filters'],
  through: [],
  equal: [{ name: 'customer_no', type: INT32, value: '1001' }],
  search: { text: 'Muster', columns: [{ name: 'status', type: text(20) as never }] },
  sort: [
    { column: 'notes', direction: 'desc', nulls: 'last' },
    { column: 'id', direction: 'asc', nulls: null },
  ],
  offset: 50,
  limit: 50,
}

const altered = (change: Record<string, unknown>): ListRequest => ({ ...REQUEST, ...change }) as ListRequest

describe('listTerms', () => {
  // The terms are fresh, and hold what the request said and nothing more.
  test('reads a planned request', () => {
    expect(listTerms(REQUEST)).toEqual({
      terms: [{ column: 'tenant_id', type: INT32, value: '1' }],
      through: [],
      equal: [{ name: 'customer_no', type: INT32, value: '1001' }],
      search: { text: 'Muster', columns: [{ name: 'status', type: text(20) }] },
      sort: REQUEST.sort,
      offset: 50,
      limit: 50,
    })
  })

  // An order without the key is not total: a page boundary between two rows
  // that sort equal shows one twice and the other never. Watched failing
  // with the identity check removed.
  test('refuses an order that does not end every tie with the key', () => {
    expect(() => listTerms(altered({ sort: [{ column: 'notes', direction: 'desc', nulls: 'last' }] }))).toThrow(/every identity column/)
    expect(() => listTerms(altered({ sort: [] }))).toThrow(/at least one column/)
    expect(() => listTerms(altered({ sort: [{ column: 'id', direction: 'asc', nulls: null }, { column: 'id', direction: 'desc', nulls: null }] }))).toThrow(/twice/)
  })

  // The direction is spliced into SQL on SQL Server, which takes no
  // parameter for it; anything but the two words is thrown here first.
  test('refuses a direction or a NULL placement the planner never writes', () => {
    for (const sort of [
      [{ column: 'id', direction: 'asc; drop table x', nulls: null }],
      [{ column: 'id', direction: 'asc', nulls: 'first' }],
      [{ column: 'id', direction: 'asc' }],
      [{ column: '', direction: 'asc', nulls: null }],
    ]) {
      expect(() => listTerms(altered({ sort })), JSON.stringify(sort)).toThrow(/A list request/)
    }
  })

  // A page larger than the bound is the full-table read paging exists to
  // avoid; a negative offset means something else on each engine.
  test('refuses a page the planner would not plan', () => {
    for (const page of [{ limit: LIST_PAGE_SIZE + 1 }, { limit: 0 }, { offset: -1 }, { offset: 0.5 }]) {
      expect(() => listTerms(altered(page)), JSON.stringify(page)).toThrow(/pages from an offset/)
    }
  })

  // A search over a date matches one engine's spelling of it, which depends
  // on the session; an empty or untrimmed one is not what the planner sends.
  test('refuses a search the engines would match apart, or text a person could not have sent', () => {
    for (const search of [
      { text: 'Muster', columns: [{ name: 'order_date', type: DATE }] },
      { text: 'Muster', columns: [] },
      { text: '', columns: [{ name: 'status', type: text(20) }] },
      { text: ' Muster', columns: [{ name: 'status', type: text(20) }] },
      { text: 'a\u0000b', columns: [{ name: 'status', type: text(20) }] },
      'Muster',
    ]) {
      expect(() => listTerms(altered({ search })), JSON.stringify(search)).toThrow(/A list request/)
    }
    expect(listTerms(altered({ search: null })).search).toBeNull()
  })

  // A parent's values are bound as their columns' types; one not spelled as
  // its column holds it would be converted by one engine and refused by the
  // other.
  test('refuses a parent value not spelled as its column holds it, or a column named twice', () => {
    for (const equal of [
      [{ name: 'customer_no', type: INT32, value: '007' }],
      [{ name: 'customer_no', type: INT32, value: 1001 }],
      [{ name: 'notes', type: { kind: 'boolean' }, value: 'true' }],
      [{ name: 'customer_no', type: INT32, value: '1' }, { name: 'customer_no', type: INT32, value: '2' }],
      'customer_no',
    ]) {
      expect(() => listTerms(altered({ equal })), JSON.stringify(equal)).toThrow(/A list request/)
    }
  })

  // The filters and throughs are read as for every other request: a list
  // without them is refused, never every row.
  test('refuses filters or throughs that say nothing', () => {
    expect(() => listTerms(altered({ filters: { kind: 'restricted', equal: [] } }))).toThrow(/Row filters are/)
    expect(() => listTerms(altered({ through: undefined }))).toThrow(/throughs are a list/)
  })
})
