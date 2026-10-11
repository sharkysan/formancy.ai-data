import type { ListRequest, ListTerms } from '@formancy/data-core'
import { op } from '../sql/catalog.js'
import { filterSql } from '../sql/filters.js'
import { quoteTable } from '../sql/identifiers.js'
import { orderBy } from '../sql/order.js'
import { searchSql } from '../sql/search.js'
import { Statement } from '../sql/statement.js'
import { bound, column, described, outputs, ROW, throughSql } from './sql.js'
import type { RecordStatement } from './sql.js'

/**
 * One page of a form's records on PostgreSQL (0044), with the table as this
 * same statement found it (0041), in one statement:
 *
 *   select <description, on the page's first row>, "page".*
 *   from (<the table's facts>) as "g"
 *   left join lateral (
 *     select true, <columns>, row_number() over (order by <order>) as "n"
 *     from <table> as "r" where <parent> and <filters> and <throughs> and <search>
 *     order by <order> limit <limit + 1> offset <offset>
 *   ) as "page" on true
 *   order by "page"."n"
 *
 * One row with no record when the page is empty, so the description is
 * answered either way, as a read's is. The rows of a lateral join have no
 * order of their own, so each carries its position in the page's order --
 * which is total, the key ending it, so the position is the order -- and the
 * statement is ordered by it. The description is selected once, on the
 * page's first row, whose position is `offset + 1`: repeated on every row it
 * would send the table's catalog facts once per record.
 *
 * The parent's columns compare with the database's equality, as the foreign
 * key does, through pg_catalog's operator, each value bound as its column's
 * type; the filters, the throughs and the search are a read's and a lookup's
 * own spellings (`sql.ts`, `sql/search.ts`). Where NULLs go is spelled only
 * for a column the request says is nullable (`sql/order.ts`). `limit + 1`,
 * so `recordPage` can tell whether more follow without a COUNT.
 */
export function listStatement(request: ListRequest, terms: ListTerms): RecordStatement {
  const statement = new Statement()
  const { columns, from } = described(statement, request.target.table)
  const where = [
    ...terms.equal.map((value) => `${column(value.name)} ${op('=')} ${bound(statement, value)}`),
    ...filterSql(statement, ROW, terms.terms),
    ...terms.through.map((entry) => throughSql(statement, entry)),
  ]
  if (terms.search !== null) where.push(searchSql(statement, ROW, terms.search.columns, terms.search.text))
  const order = orderBy(ROW, terms.sort)
  const limit = statement.as(String(terms.limit + 1), 'pg_catalog.int8')
  const offset = statement.as(String(terms.offset), 'pg_catalog.int8')
  const first = statement.as(String(terms.offset + 1), 'pg_catalog.int8')
  // Every output named, so the position's name cannot meet a column's: `"r"."n"::text` would be called "n" too.
  const select = [
    'true as "found"',
    ...outputs(request.target, request.columns).map((output, index) => `${output} as "c${String(index)}"`),
    `pg_catalog.row_number() over (order by ${order}) as "n"`,
  ]
  const page = [
    `select ${select.join(', ')}`,
    `from ${quoteTable(request.target.table)} as ${ROW}`,
    where.length > 0 ? `where ${where.join(' and ')}` : '',
    `order by ${order}`,
    `limit ${limit} offset ${offset}`,
  ]
    .filter((part) => part !== '')
    .join('\n')
  const once = columns.map((expression) => `case when "page"."n" is null or "page"."n" ${op('=')} ${first} then ${expression} end`)
  return { text: `select ${once.join(', ')}, "page".*\nfrom ${from}\nleft join lateral (${page}) as "page" on true\norder by "page"."n"`, params: statement.params }
}
