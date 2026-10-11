import { describe, expect, test } from 'vitest'
import { orderBy } from './order.js'

/**
 * The one ORDER BY spelling a lookup's options and a list's records share
 * (0044), as a function: what each engine then does with it is the list and
 * lookup suites', against real servers.
 */
describe('orderBy', () => {
  // A list spells NULL placement only on a nullable column; spelled on a
  // NOT NULL one too, `desc nulls last` is an order no plain index serves
  // backwards. A lookup still spells it on every column (0012). Watched
  // failing with a NOT NULL term spelled `nulls last`.
  test('spells NULL placement where a term says it, and nothing where it says none', () => {
    expect(
      orderBy('"r"', [
        { column: 'credit_limit', direction: 'desc', nulls: 'last' },
        { column: 'name', direction: 'asc', nulls: 'first' },
        { column: 'customer_no', direction: 'desc', nulls: null },
      ]),
    ).toBe('"r"."credit_limit" desc nulls last, "r"."name" asc nulls first, "r"."customer_no" desc')
  })

  // The direction and the placement come from a fixed table, never from what
  // was handed in: a request rebuilt from JSON must not run as SQL.
  test('refuses an order it cannot spell from its own table', () => {
    for (const term of [
      { column: 'name', direction: 'asc; drop table x', nulls: null },
      { column: 'name', direction: 'asc', nulls: 'middle' },
      { column: 'name', direction: 'constructor', nulls: null },
    ]) {
      expect(() => orderBy('"r"', [term as never]), JSON.stringify(term)).toThrow(/no order this adapter can spell/)
    }
    expect(() => orderBy('"r"', [])).toThrow(/at least one column/)
  })
})
