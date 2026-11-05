import type { LabelTerms, ListRequest, ListTerms, SortTerm } from '@formancy/data-core'
import mssql from 'mssql'
import { exactText, filterPredicate } from '../sql/filters.js'
import { after, orderBy } from '../sql/order.js'
import type { OrderTerm } from '../sql/order.js'
import { quoteName, quoteTable } from '../sql/quote.js'
import { searchPredicate } from '../sql/search.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { recordFilterPredicate } from './filter.js'
import { described, filterPredicates, keyPredicates, located, ROW, selection, throughPredicate } from './statements.js'

/**
 * One page of a form's records on SQL Server (0044), with the table as this
 * same statement found it (0041), in one statement -- which holds a
 * schema-stability lock on the table while it runs, as a read does, so no
 * ALTER lands between the facts and the page:
 *
 *   select <description, on the page's first row>, [a].[found], [page].*
 *   from (select <the table's facts> as [facts]) as [f]
 *   outer apply (
 *     select 1 as [found], <the order's columns> from <table> as [r]
 *     where <its key> and <filters> and <throughs>
 *   ) as [a]
 *   outer apply (
 *     select 1 as [found], [c0], …, [version], row_number() over (order by <order>) as [n]
 *     from <table> as [r]
 *     where <parent> and <filters> and <throughs> and <the person's filter> and <search>
 *       and <after [a] in the order>
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
 * A page that continues after a row (0108) finds that row, [a], by its key
 * under the filters and every through, as a read finds it, and holds the
 * rows after it in the order, compared column against column (`after`,
 * `sql/order.ts`); a page from the start has neither, and an offset only for
 * a browse. Whether [a] was found is on every row, so a page after a row
 * that is gone -- which holds none -- says so. In the same statement, so
 * one lock covers the row and the page.
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
  // Each lookup's label in the order (0136), read once per row, in an apply of its own: never a subquery in the window's order.
  const labels = new Map<SortTerm, string>()
  const applied: string[] = []
  for (const term of terms.sort) {
    if (!('label' in term)) continue
    const at = String(applied.length)
    applied.push(`cross apply (select ${labelSql(parameters, ROW, term.label, `[t${at}]`)} as [v]) as [l${at}]`)
    labels.set(term, `[l${at}].[v]`)
  }
  const ordered = (term: SortTerm): OrderTerm =>
    'label' in term ? { column: term.label.display, direction: term.direction, nulls: 'last', value: labels.get(term) as string } : term
  const anchor = terms.after === null ? null : anchorSql(parameters, request.target.table, terms, terms.after)
  if (terms.after !== null) where.push(after(ROW, (index) => `${ANCHOR}.${seekName(index)}`, terms.after.seek.map(ordered)))
  const order = orderBy(ROW, terms.sort.map(ordered))
  const offset = parameters.add(mssql.BigInt, terms.offset)
  const fetch = parameters.add(mssql.Int, terms.limit + 1)
  const first = parameters.add(mssql.BigInt, terms.offset + 1)
  const select = [
    ...selection(request.columns, request.target.concurrency, `${ROW}.`).map((selected) => `${selected.expression} as ${selected.name}`),
    `row_number() over (order by ${order}) as [n]`,
  ]
  const page = [
    `select ${select.join(', ')} from ${quoteTable(request.target.table)} as ${ROW}`,
    ...applied,
    where.length > 0 ? `where ${where.join(' and ')}` : '',
    `order by ${order} offset ${offset} rows fetch next ${fetch} rows only`,
  ]
    .filter((part) => part !== '')
    .join(' ')
  const once = columns.map((column) => `case when [page].[n] is null or [page].[n] = ${first} then ${column.expression} end as ${column.name}`)
  const found = anchor === null ? 'convert(int, null)' : `${ANCHOR}.[found]`
  const applies = [...(anchor === null ? [] : [`outer apply (${anchor}) as ${ANCHOR}`]), `outer apply (${page}) as [page]`]
  return parameters.statement(`select ${once.join(', ')}, ${found} as [anchored], [page].* from ${from} ${applies.join(' ')} order by [page].[n]`)
}

/** The alias of the row a page continues after, and the name of its value of the seek's term at `index`. */
const ANCHOR = '[a]'
const seekName = (index: number): string => `[s${String(index)}]`

/** The row a page continues after (0108), by its key, under the filters and every through, as a read finds it: whether it is there, and its value of each term the page compares by. */
function anchorSql(parameters: Parameters, table: ListRequest['target']['table'], terms: ListTerms, anchor: NonNullable<ListTerms['after']>): string {
  const select = [
    '1 as [found]',
    ...anchor.seek.map(
      (term, index) =>
        `${'label' in term ? labelSql(parameters, ROW, term.label, `[t${String(index)}]`) : `${ROW}.${quoteName(term.column)}`} as ${seekName(index)}`,
    ),
  ]
  return `select ${select.join(', ')} from ${quoteTable(table)} as ${ROW} where ${located(parameters, anchor.key, terms.terms, terms.through).join(' and ')}`
}

/**
 * A lookup's label a list is ordered by (0136): the target's display
 * column for `row`'s foreign key, under the lookup's filters on the target,
 * as the page reads the label -- NULL where the target holds no such row or
 * the filters hide it. The key is matched exactly, as PostgreSQL's is: a
 * text key under the database's default collation, for the target's index,
 * and again byte for byte (`exactText`), so a row sorts by the label its
 * page shows, which a token resolves to only on an exact match -- under the
 * fixture's case-insensitive collation `ch` sorts with the rows that show
 * no label -- and a key whose two columns differ in collation is compared
 * rather than refused (468). A scalar subquery: one value per row, so it
 * multiplies none; a target key that stopped being unique fails the
 * statement (512).
 */
function labelSql(parameters: Parameters, row: string, label: LabelTerms, alias: string): string {
  const pairs = label.pairs.map((pair) => {
    const target = `${alias}.${quoteName(pair.references)}`
    const root = `${row}.${quoteName(pair.column)}`
    return pair.type.kind === 'text' ? `${target} = ${root} collate database_default and ${exactText(target, root)}` : `${target} = ${root}`
  })
  const terms = label.terms.map((term) => filterPredicate(parameters, `${alias}.${quoteName(term.column)}`, term))
  return `(select ${alias}.${quoteName(label.display)} from ${quoteTable(label.target)} as ${alias} where ${[...pairs, ...terms].join(' and ')})`
}
