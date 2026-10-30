import { quoteName } from './quote.js'

/*
 * An ORDER BY on SQL Server, for a lookup's options and a form's records
 * (0044): one spelling.
 *
 * Where PostgreSQL orders a column otherwise, the difference is the
 * engine's and stays (0056). A uniqueidentifier is ordered by its byte
 * groups, not by its text and not by a collation: the last six bytes first,
 * then the two before them, then the first eight from the right -- in the
 * text 8-4-4-4-12, the fifth group and the fourth read from the left, then
 * the third, the second and the first each read from its last byte. That is
 * the bytes SQL Server stores, compared group by group from the last, with
 * the text's first three groups stored little-endian; the uuid suite reads
 * the stored bytes back and holds both. PostgreSQL orders a uuid by its
 * bytes in turn. Measured on SQL Server 2022
 * (16.0.4295.3) on 2026-10-11 with sixteen keys that each set one byte and
 * with 1000 random keys; the shared cases `uuid: order` and `uuid: lookup`
 * hold it on every run. Ordered by the column, the key's own index serves
 * the order; ordered by its text, to match PostgreSQL, it would sort every
 * row the filter admits, for every page. Every column is named through the
 * row's alias: an ORDER BY that named a select-list alias spelled as the
 * column would order by what the alias holds -- for a uniqueidentifier read
 * as its lower-cased text, PostgreSQL's order, as the measurement first
 * showed by mistake.
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
 * order -- a uniqueidentifier by its byte groups (above), and the key that
 * ends every order makes it total, because a key is unique under that same
 * rule.
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

/**
 * The rows of `row` that come after the anchor in the order `terms`, for a
 * page that continues after a row (0108): the anchor's value of the term at
 * `index` is `anchor(index)`, a column of the same type and collation, read
 * from the row the page continues after in the same statement. Column
 * against column, so the comparison is the order's own: text under the
 * column's collation -- a `varchar` under a `SQL_` collation by that
 * collation's own rules, which a value bound as nvarchar would not be
 * compared by -- and a uniqueidentifier by its byte groups.
 *
 * Term by term, from the first: past the anchor on this column, or tied
 * with it and past it on the rest. A NOT NULL column (`nulls` null) compares
 * bare; a nullable one, whose NULLs come last both ways (`orderBy`'s CASE),
 * has every NULL past a value and tied with a NULL, and nothing past a NULL.
 * A row tied with the anchor on every column is the anchor itself, whose
 * key ends every order, so it is not after itself. No terms -- an order the
 * scope holds to one value throughout -- is nothing after, `1 = 0`, SQL
 * Server having no boolean literal. The direction is checked as `orderBy`
 * checks it.
 */
export function after(row: string, anchor: (index: number) => string, terms: readonly OrderTerm[]): string {
  let rest = '1 = 0'
  for (let index = terms.length - 1; index >= 0; index -= 1) {
    const term = terms[index] as OrderTerm
    if (term.direction !== 'asc' && term.direction !== 'desc') throw new Error(`${term.column} sorts asc or desc`)
    if (term.nulls !== null && term.nulls !== 'last') throw new Error(`${term.column} has no place after a row this adapter can spell.`)
    const past = term.direction === 'asc' ? '>' : '<'
    const column = `${row}.${quoteName(term.column)}`
    const value = anchor(index)
    const beyond = term.nulls === null ? `${column} ${past} ${value}` : `(${column} ${past} ${value} or (${column} is null and ${value} is not null))`
    const tied = term.nulls === null ? `${column} = ${value}` : `(${column} = ${value} or (${column} is null and ${value} is null))`
    rest = index === terms.length - 1 ? beyond : `(${beyond} or (${tied} and ${rest}))`
  }
  return rest
}
