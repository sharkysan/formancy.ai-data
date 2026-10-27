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
  filter: [],
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
      filter: [],
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

  // The person's filter (0104) as columnFilter plans it reaches the
  // adapter fresh: a caller still holding the request cannot change what
  // was checked.
  test('reads a planned filter, fresh', () => {
    const INSTANT = { kind: 'timestamp', withTimeZone: true, precision: 6 }
    const filter = [
      { op: 'equals', column: 'paid', type: { kind: 'boolean' }, value: 'true' },
      { op: 'equals', column: 'status', type: text(20), value: ' placed ' },
      { op: 'range', column: 'amount', type: { kind: 'decimal', precision: 18, scale: 4 }, from: '10.0000', to: null, before: null },
      { op: 'range', column: 'created_at', type: INSTANT, from: '2026-10-01T00:00:00Z', to: null, before: '2026-11-01T00:00:00Z' },
      { op: 'contains', column: 'notes', type: text(null), text: 'urgent' },
      { op: 'null', column: 'approved_by' },
      { op: 'not-null', column: 'group' },
    ]
    const read = listTerms(altered({ filter }))
    expect(read.filter).toEqual(filter)
    expect(read.filter[0]).not.toBe(filter[0])
    expect((read.filter[0] as { type: unknown }).type).not.toBe(filter[0]?.type)
    expect(listTerms(altered({ filter: [{ op: 'null', column: 'notes' }, { op: 'not-null', column: 'notes' }] })).filter).toHaveLength(2)
  })

  // Each is what columnFilter never writes: an operator outside the set, a
  // value one engine would convert and the other refuse, a contains on a
  // number each spells apart, a timestamp's upper bound that is not the
  // next midnight, a range that bounds nothing. Watched failing with the
  // to-or-before check removed.
  test('refuses a filter condition the planner would not plan', () => {
    const INSTANT = { kind: 'timestamp', withTimeZone: true, precision: 6 }
    const WALL_CLOCK = { kind: 'timestamp', withTimeZone: false, precision: 3 }
    const AMOUNT = { kind: 'decimal', precision: 18, scale: 4 }
    for (const filter of [
      'paid',
      [{ op: 'null' }],
      [{ op: 'like', column: 'status', type: text(20), value: 'a%' }],
      [{ op: 'equals', column: 'customer_no', type: INT32, value: '007' }],
      [{ op: 'equals', column: 'paid', type: { kind: 'boolean' }, value: 'TRUE' }],
      [{ op: 'equals', column: 'weight', type: { kind: 'float', bits: 64 }, value: '1.5' }],
      [{ op: 'contains', column: 'customer_no', type: INT32, text: '7' }],
      [{ op: 'contains', column: 'notes', type: text(null), text: ' urgent' }],
      [{ op: 'contains', column: 'notes', type: text(null), text: '' }],
      [{ op: 'range', column: 'status', type: text(20), from: 'a', to: null, before: null }],
      [{ op: 'range', column: 'amount', type: AMOUNT, from: '10', to: null, before: null }],
      [{ op: 'range', column: 'amount', type: AMOUNT, from: null, to: null, before: null }],
      [{ op: 'range', column: 'amount', type: AMOUNT, from: null, to: null, before: '10.0000' }],
      [{ op: 'range', column: 'created_at', type: INSTANT, from: null, to: '2026-10-31T00:00:00Z', before: null }],
      [{ op: 'range', column: 'created_at', type: INSTANT, from: '2026-10-01T00:00:00', to: null, before: null }],
      [{ op: 'range', column: 'created_at', type: INSTANT, from: '2026-10-01T12:00:00Z', to: null, before: null }],
      [{ op: 'range', column: 'created_at', type: INSTANT, from: '2026-02-30T00:00:00Z', to: null, before: null }],
      [{ op: 'range', column: 'dispatched_at', type: WALL_CLOCK, from: '2026-10-01T00:00:00Z', to: null, before: null }],
      [{ op: 'range', column: 'dispatched_at', type: { ...WALL_CLOCK, precision: -1 }, from: '2026-10-01T00:00:00', to: null, before: null }],
    ]) {
      expect(() => listTerms(altered({ filter })), JSON.stringify(filter)).toThrow(/A list request/)
    }
    expect(() => listTerms(altered({ filter: undefined }))).toThrow(/A list request/)
  })

  // The filters and throughs are read as for every other request: a list
  // without them is refused, never every row.
  test('refuses filters or throughs that say nothing', () => {
    expect(() => listTerms(altered({ filters: { kind: 'restricted', equal: [] } }))).toThrow(/Row filters are/)
    expect(() => listTerms(altered({ through: undefined }))).toThrow(/throughs are a list/)
  })
})
