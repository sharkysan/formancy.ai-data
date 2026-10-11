import { describe, expect, test } from 'vitest'
import { orderBy } from './order.js'

/**
 * The one ORDER BY spelling a lookup's options and a list's records share
 * (0044), as a function: what the server then does with it is the list and
 * lookup suites', against a real one.
 */
describe('orderBy', () => {
  // SQL Server has no NULLS LAST, so placement is a CASE before the column,
  // which no index serves. A list spells it only for a nullable column; a
  // lookup on every column (0012). Watched failing with a NOT NULL term
  // given its CASE.
  test('places NULLs by a CASE where a term says where, and orders bare where it says none', () => {
    expect(
      orderBy('[r]', [
        { column: 'credit_limit', direction: 'desc', nulls: 'last' },
        { column: 'name', direction: 'asc', nulls: 'first' },
        { column: 'customer_no', direction: 'desc', nulls: null },
      ]),
    ).toBe(
      'case when [r].[credit_limit] is null then 1 else 0 end, [r].[credit_limit] desc, case when [r].[name] is null then 0 else 1 end, [r].[name] asc, [r].[customer_no] desc',
    )
  })

  // The direction is spliced, because SQL Server takes no parameter for it:
  // anything but the two words is refused before it reaches SQL.
  test('refuses a direction or a placement it cannot spell', () => {
    expect(() => orderBy('[r]', [{ column: 'name', direction: 'asc; drop table x' as never, nulls: null }])).toThrow(/sorts asc or desc/)
    expect(() => orderBy('[r]', [{ column: 'name', direction: 'asc', nulls: 'middle' as never }])).toThrow(/puts NULLs first or last/)
    expect(() => orderBy('[r]', [])).toThrow(/at least one column/)
  })
})
