import { op } from './catalog.js'
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

/** What comes after in each direction, NULLs aside. */
const PAST: ReadonlyMap<unknown, '>' | '<'> = new Map([
  ['asc', '>'],
  ['desc', '<'],
])

/**
 * The rows of `row` that come after the anchor in the order `terms`, for a
 * page that continues after a row (0108): the anchor's value of the term at
 * `index` is `anchor(index)`, a column of the same type and collation, read
 * from the row the page continues after in the same statement. Column
 * against column, so the comparison is the order's own: each type's
 * operator, each column's collation, never a value spelled and bound.
 *
 * Term by term, from the first: past the anchor on this column, or tied
 * with it and past it on the rest. A NOT NULL column (`nulls` null) compares
 * bare; a nullable one, whose NULLs come last both ways (`listOrder`), has
 * every NULL past a value and tied with a NULL, and nothing past a NULL. A
 * row tied with the anchor on every column is the anchor itself, whose key
 * ends every order, so it is not after itself. No terms -- an order the
 * scope holds to one value throughout -- is nothing after.
 */
export function after(row: string, anchor: (index: number) => string, terms: readonly OrderTerm[]): string {
  let rest = 'false'
  for (let index = terms.length - 1; index >= 0; index -= 1) {
    const term = terms[index] as OrderTerm
    const past = PAST.get(term.direction)
    if (past === undefined || (term.nulls !== null && term.nulls !== 'last')) throw new Error(`${term.column} has no place after a row this adapter can spell.`)
    const column = `${row}.${quoteIdentifier(term.column)}`
    const value = anchor(index)
    const beyond =
      term.nulls === null ? `(${column} ${op(past)} ${value})` : `((${column} ${op(past)} ${value}) or (${column} is null and ${value} is not null))`
    const tied = term.nulls === null ? `(${column} ${op('=')} ${value})` : `((${column} ${op('=')} ${value}) or (${column} is null and ${value} is null))`
    rest = index === terms.length - 1 ? beyond : `(${beyond} or (${tied} and ${rest}))`
  }
  return rest
}
