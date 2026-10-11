import { quoteIdentifier } from './identifiers.js'

/*
 * An ORDER BY on PostgreSQL, for a lookup's options and a form's records
 * (0044): one spelling, each column's direction and NULL placement taken
 * from a fixed table rather than copied from what it was handed.
 *
 * Each column is ordered by its own type's rule. Where SQL Server's differs
 * it is not smoothed over here (0056): a uuid is ordered by its sixteen bytes
 * in turn, which is the order of its text, and SQL Server orders a
 * uniqueidentifier by its last six bytes first. A list ordered by a uuid key,
 * and a lookup's options tied on their label, are total and stable on each
 * engine and in a different order on each, as the shared cases `uuid: order`
 * and `uuid: lookup` hold -- measured on PostgreSQL 17.11 on 2026-10-11 with
 * sixteen keys that each set one byte and with 1000 random keys; reordering
 * one engine to the other's would sort by an expression no index on the key
 * serves.
 */

/**
 * One column of an order. `nulls` says where a NULL goes whichever the
 * direction, or is `null` where the column holds none -- a NOT NULL column
 * of a list (`listOrder`), which is then spelled with no NULLS clause, so an
 * index on the column serves the order in either direction. A lookup's
 * order says it on every column (0012).
 */
export interface OrderTerm {
  column: string
  direction: 'asc' | 'desc'
  nulls: 'first' | 'last' | null
}

/** Maps, not object literals: `constructor` is a property of every object and of no Map. */
const DIRECTION: ReadonlyMap<unknown, string> = new Map([
  ['asc', 'asc'],
  ['desc', 'desc'],
])
const NULLS: ReadonlyMap<unknown, string> = new Map([
  ['first', ' nulls first'],
  ['last', ' nulls last'],
  [null, ''],
])

/** The order of `row`'s columns, each qualified by the alias. */
export function orderBy(row: string, terms: readonly OrderTerm[]): string {
  if (terms.length === 0) throw new Error('An order names at least one column.')
  return terms
    .map((term) => {
      const direction = DIRECTION.get(term.direction)
      const nulls = NULLS.get(term.nulls)
      if (direction === undefined || nulls === undefined) throw new Error(`${term.column} has no order this adapter can spell.`)
      return `${row}.${quoteIdentifier(term.column)} ${direction}${nulls}`
    })
    .join(', ')
}
