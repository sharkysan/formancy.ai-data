import type { ListRequest, ListTerms } from '@formancy/data-core'
import { op } from '../sql/catalog.js'
import { filterSql } from '../sql/filters.js'
import { quoteTable } from '../sql/identifiers.js'
import { after, orderBy } from '../sql/order.js'
import { searchSql } from '../sql/search.js'
import { Statement } from '../sql/statement.js'
import { recordFilterSql } from './filter.js'
import { bound, column, described, located, outputs, ROW, throughSql } from './sql.js'
import type { RecordStatement } from './sql.js'

/**
 * One page of a form's records on PostgreSQL (0044), with the table as this
 * same statement found it (0041), in one statement:
 *
 *   select <description, on the page's first row>, "a"."found", "page".*
 *   from (<the table's facts>) as "g"
 *   left join lateral (
 *     select true, <the order's columns> from <table> as "r"
 *     where <its key> and <filters> and <throughs>
 *   ) as "a" on true
 *   left join lateral (
 *     select true, <columns>, row_number() over (order by <order>) as "n"
 *     from <table> as "r"
 *     where <parent> and <filters> and <throughs> and <the person's filter> and <search>
 *       and <after "a" in the order>
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
 * A page that continues after a row (0108) finds that row, "a", by its key
 * under the filters and every through, as a read finds it, and holds the
 * rows after it in the order, compared column against column (`after`,
 * `sql/order.ts`); a page from the start has neither, and an offset only for
 * a browse. Whether "a" was found is on every row, so a page after a row
 * that is gone -- which holds none -- says so. In the same statement, so the
 * row and the page are read from one snapshot: a row moved between two
 * statements would be compared as it was in neither.
 *
 * The parent's columns compare with the database's equality, as the foreign
 * key does, through pg_catalog's operator, each value bound as its column's
 * type; the filters, the throughs and the search are a read's and a lookup's
 * own spellings (`sql.ts`, `sql/search.ts`), and the person's filter is
 * spelled from them where it can be (`filter.ts`, 0104). Where NULLs go is
 * spelled only for a column the request says is nullable (`sql/order.ts`).
 * `limit + 1`, so `recordPage` can tell whether more follow without a COUNT.
 */
export function listStatement(request: ListRequest, terms: ListTerms): RecordStatement {
  const statement = new Statement()
  const { columns, from } = described(statement, request.target.table)
  const where = [
    ...terms.equal.map((value) => `${column(value.name)} ${op('=')} ${bound(statement, value)}`),
    ...filterSql(statement, ROW, terms.terms),
    ...terms.through.map((entry) => throughSql(statement, entry)),
    ...terms.filter.map((entry) => recordFilterSql(statement, ROW, entry)),
  ]
  if (terms.search !== null) where.push(searchSql(statement, ROW, terms.search.columns, terms.search.text))
  const anchor = terms.after === null ? null : anchorSql(statement, request.target.table, terms, terms.after)
  if (terms.after !== null) where.push(after(ROW, (index) => `${ANCHOR}.${seekName(index)}`, terms.after.seek))
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
  const found = anchor === null ? 'null::pg_catalog.text' : `${ANCHOR}."found"::pg_catalog.text`
  const joins = [from, ...(anchor === null ? [] : [`left join lateral (${anchor}) as ${ANCHOR} on true`]), `left join lateral (${page}) as "page" on true`]
  return { text: `select ${once.join(', ')}, ${found} as "anchored", "page".*\nfrom ${joins.join('\n')}\norder by "page"."n"`, params: statement.params }
}

/** The alias of the row a page continues after, and the name of its value of the seek's term at `index`. */
const ANCHOR = '"a"'
const seekName = (index: number): string => `"s${String(index)}"`

/** The row a page continues after (0108), by its key, under the filters and every through, as a read finds it: whether it is there, and its value of each term the page compares by. */
function anchorSql(statement: Statement, table: ListRequest['target']['table'], terms: ListTerms, anchor: NonNullable<ListTerms['after']>): string {
  const select = ['true as "found"', ...anchor.seek.map((term, index) => `${column(term.column)} as ${seekName(index)}`)]
  return `select ${select.join(', ')} from ${quoteTable(table)} as ${ROW} where ${located(statement, anchor.key, terms.terms, terms.through).join(' and ')}`
}
