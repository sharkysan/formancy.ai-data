import { describe, expect, test } from 'vitest'
import { INT32, INT64, sales, TENANT_ONE, text } from './test-support.js'
import { throughTerms } from './through.js'
import type { Through } from './types.js'

/*
 * What an adapter reads a request's throughs through (0043), as it reads its
 * filters through `rowFilterTerms`: at run time, where a caller in
 * JavaScript or a request rebuilt from JSON is not held to the types. Each
 * shape refused here is one an adapter would otherwise turn into an EXISTS
 * that scopes less than the policy said, or into SQL nobody approved.
 */

const LINE_ORDER = { columns: [{ name: 'order_id', type: INT64 }], target: sales('order'), targetColumns: [{ name: 'id', type: INT64 }], filters: TENANT_ONE } as unknown as Through

/** A copy of the line's through with one part replaced, as a careless caller might send it. */
const with_ = (part: Record<string, unknown>): Through => ({ ...LINE_ORDER, ...part }) as unknown as Through

describe('throughTerms', () => {
  // What the planner makes is read as it is: the pairs in order, the target,
  // and the filter's typed terms, fresh, so nothing else the request carried
  // reaches a statement.
  test('reads a through the planner makes, pair by pair, with its typed terms', () => {
    expect(throughTerms([LINE_ORDER])).toEqual([{ target: sales('order'), pairs: [{ column: 'order_id', references: 'id' }], terms: [{ column: 'tenant_id', type: INT32, value: '1' }] }])
    expect(throughTerms([])).toEqual([])
  })

  // A request without its throughs is not a request with none: like a
  // filter, "none" has to be said, as [], or the adapter refuses rather than
  // read every tenant's lines.
  test('refuses throughs that are not a list', () => {
    for (const through of [undefined, null, {}, LINE_ORDER]) {
      expect(() => throughTerms(through as unknown as Through[]), String(through)).toThrow(/A request's throughs are a list/)
    }
  })

  // An unrestricted target filter scopes nothing, which the policy refuses
  // (0011); a filter of any other unread shape is rowFilterTerms' refusal.
  test('refuses a through whose filter scopes nothing, or is not a filter', () => {
    expect(() => throughTerms([with_({ filters: { kind: 'unrestricted' } })])).toThrow(/scopes nothing/)
    expect(() => throughTerms([with_({ filters: { kind: 'restricted', equal: [] } })])).toThrow(/Row filters are/)
  })

  // The pairs are the foreign key's: one target column per root column, in
  // order, each named and of a kind a through compares without a collation.
  // A text key, a key with no columns, unpaired columns and a nameless one
  // are refused before anything is built.
  test('refuses a key that is text, empty, unpaired or unnamed, and a target that is not a table', () => {
    const refusals: Array<Record<string, unknown>> = [
      { columns: [{ name: 'order_id', type: text(10) }], targetColumns: [{ name: 'id', type: text(10) }] },
      { targetColumns: [{ name: 'id', type: text(10) }] },
      { columns: [], targetColumns: [] },
      { columns: [{ name: 'order_id', type: INT64 }, { name: 'line_no', type: INT32 }] },
      { columns: [{ name: '', type: INT64 }] },
      { columns: [{ name: 'order_id', type: { kind: 'float', bits: 64 } }] },
      { target: { schema: 'sales' } },
      { target: 'sales.order' },
    ]
    for (const part of refusals) expect(() => throughTerms([with_(part)]), JSON.stringify(part)).toThrow(/A through/)
  })

  // A property nothing reads would be a scope its sender believes is applied.
  test('refuses a through with a property it does not read', () => {
    expect(() => throughTerms([with_({ operator: 'like' })])).toThrow(/A through/)
  })
})
