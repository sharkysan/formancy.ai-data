import type { ListRequest, ListTerms } from '@formancy/data-core'
import mssql from 'mssql'
import { orderBy } from '../sql/order.js'
import { quoteTable } from '../sql/quote.js'
import { searchPredicate } from '../sql/search.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { recordFilterPredicate } from './filter.js'
import { described, filterPredicates, keyPredicates, ROW, selection, throughPredicate } from './statements.js'

/**
 * One page of a form's records on SQL Server (0044), with the table as this
 * same statement found it (0041), in one statement -- which holds a
 * schema-stability lock on the table while it runs, as a read does, so no
 * ALTER lands between the facts and the page:
 *
 *   select <description, on the page's first row>, [page].*
 *   from (select <the table's facts> as [facts]) as [f]
 *   outer apply (
 *     select 1 as [found], [c0], …, [version], row_number() over (order by <order>) as [n]
 *     from <table> as [r]
 *     where <parent> and <filters> and <throughs> and <the person's filter> and <search>
 *     order by <order> offset @o rows fetch next @l rows only
 *   ) as [page]
 *   order by [page].[n]
 *
 * One row with a NULL `[found]` when the page is empty, so the description is
 * answered either way, as a read's is. The rows of an APPLY have no order of
 * their own, so each carries its position in the page's order -- which is
 * total, the key ending it, so the position is the order -- and the
 * statement is ordered by it. The description is selected once, on the
 * page's first row, whose position is `offset + 1`: repeated, it would send
 * the table's catalog facts once per record.
 *
 * The parent's columns compare with `=`, as the foreign key does, each value
 * bound as its column's type, as a key is; the filters, the throughs and the
 * search are a read's and a lookup's own spellings (`statements.ts`,
 * `sql/search.ts`), and the person's filter is spelled from them where it
 * can be (`filter.ts`, 0104). A nullable column's NULLs are placed by a CASE before it
 * in the order, and a NOT NULL column is ordered bare, so an index on it can
 * serve the order (`sql/order.ts`). `limit + 1` rows, so `recordPage` can
 * tell whether more follow without a COUNT.
 */
export function listStatement(request: ListRequest, terms: ListTerms): Statement {
  const parameters = new Parameters()
  const { columns, from } = described(parameters, request.target.table)
  const where = [
    ...keyPredicates(parameters, terms.equal),
    ...filterPredicates(parameters, terms.terms),
    ...terms.through.map((entry) => throughPredicate(parameters, entry)),
    ...terms.filter.map((entry) => recordFilterPredicate(parameters, ROW, entry)),
  ]
  if (terms.search !== null) where.push(searchPredicate(parameters, ROW, terms.search.columns, terms.search.text))
  const order = orderBy(ROW, terms.sort)
  const offset = parameters.add(mssql.BigInt, terms.offset)
  const fetch = parameters.add(mssql.Int, terms.limit + 1)
  const first = parameters.add(mssql.BigInt, terms.offset + 1)
  const select = [
    ...selection(request.columns, request.target.concurrency, `${ROW}.`).map((selected) => `${selected.expression} as ${selected.name}`),
    `row_number() over (order by ${order}) as [n]`,
  ]
  const page = [
    `select ${select.join(', ')} from ${quoteTable(request.target.table)} as ${ROW}`,
    where.length > 0 ? `where ${where.join(' and ')}` : '',
    `order by ${order} offset ${offset} rows fetch next ${fetch} rows only`,
  ]
    .filter((part) => part !== '')
    .join(' ')
  const once = columns.map((column) => `case when [page].[n] is null or [page].[n] = ${first} then ${column.expression} end as ${column.name}`)
  return parameters.statement(`select ${once.join(', ')}, [page].* from ${from} outer apply (${page}) as [page] order by [page].[n]`)
}
