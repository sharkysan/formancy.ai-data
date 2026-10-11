import { quoteName } from './quote.js'

/*
 * An ORDER BY on SQL Server, for a lookup's options and a form's records
 * (0044): one spelling.
 */

/**
 * One column of an order. `nulls` says where a NULL goes whichever the
 * direction, or is `null` where the column holds none -- a NOT NULL column
 * of a list (`listOrder`), which is then spelled as the column alone, so an
 * index on it serves the order. A lookup's order says it on every column
 * (0012).
 */
export interface OrderTerm {
  column: string
  direction: 'asc' | 'desc'
  nulls: 'first' | 'last' | null
}

/**
 * The order of `row`'s columns, made explicit about NULLs where a term says
 * where they go: SQL Server puts them first in an ascending order and has no
 * NULLS LAST, so such a column is preceded by a CASE that places them. Text
 * is ordered by the column's collation -- the server's rule, not code-point
 * order -- and the key that ends every order makes it total, because a key
 * is unique under that same collation.
 *
 * The direction is spliced, because SQL Server takes no parameter for ASC or
 * DESC, so it is checked to be one of the two first: the core only writes
 * those, but this is handed a configuration or a request, and one read from
 * a bundle altered where it is stored must not run as a statement.
 */
export function orderBy(row: string, terms: readonly OrderTerm[]): string {
  if (terms.length === 0) throw new Error('An order names at least one column.')
  return terms
    .flatMap((term) => {
      if (term.direction !== 'asc' && term.direction !== 'desc') throw new Error(`${term.column} sorts asc or desc`)
      const name = `${row}.${quoteName(term.column)}`
      if (term.nulls === null) return [`${name} ${term.direction}`]
      if (term.nulls !== 'first' && term.nulls !== 'last') throw new Error(`${term.column} puts NULLs first or last`)
      const [nullRank, valueRank] = term.nulls === 'first' ? ['0', '1'] : ['1', '0']
      return [`case when ${name} is null then ${nullRank} else ${valueRank} end`, `${name} ${term.direction}`]
    })
    .join(', ')
}
