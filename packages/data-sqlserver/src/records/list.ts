import type { LabelTerms, ListRequest, ListTerms, LookupReach, RelatedTerms, SortTerm } from '@formancy/data-core'
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
 *     where <parent> and <filters> and <throughs> and <the person's filter>
 *       and <their conditions through lookups> and <search> and <after [a] in the order>
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
    ...terms.related.map((entry, index) => relatedPredicate(parameters, ROW, entry, `[x${String(index)}]`)),
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
  const ordered = (term: SortTerm): OrderTerm => {
    if (!('label' in term)) return term
    // Every term of the seek is one of the order's; a label read in no join would order by a root column of its name.
    const value = labels.get(term)
    if (value === undefined) throw new Error(`The label of ${term.label.display} was read in no join to order by.`)
    return { column: term.label.display, direction: term.direction, nulls: 'last', value }
  }
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
 * Where `alias`, a row of a lookup's target, is the one `row`'s foreign key
 * finds as the page reads its label (0136, 0139), under the lookup's filters
 * on the target. The key is matched exactly, as PostgreSQL's is: a text key
 * by the columns' own equality, which a foreign key holds to one collation
 * and the target's index serves, and again as nvarchar, byte for byte
 * (`exactText`), so a row is found by the label its page shows, which a
 * token resolves to only on an exact match -- under the fixture's
 * case-insensitive collation a child naming `c` finds no row.
 */
function reachedRow(parameters: Parameters, row: string, reach: LookupReach, alias: string): string[] {
  const pairs = reach.pairs.map((pair) => {
    const target = `${alias}.${quoteName(pair.references)}`
    const root = `${row}.${quoteName(pair.column)}`
    return pair.type.kind === 'text'
      ? `${target} = ${root} and ${exactText(`convert(nvarchar(max), ${target})`, `convert(nvarchar(max), ${root})`)}`
      : `${target} = ${root}`
  })
  return [...pairs, ...reach.terms.map((term) => filterPredicate(parameters, `${alias}.${quoteName(term.column)}`, term))]
}

/**
 * A lookup's label a list is ordered by (0136): the target's display
 * column for `row`'s foreign key (`reachedRow`) -- NULL where the target
 * holds no such row or the filters hide it. A scalar subquery: one value
 * per row, so it multiplies none; a target key that stopped being unique
 * fails the statement (512).
 */
function labelSql(parameters: Parameters, row: string, label: LabelTerms, alias: string): string {
  return `(select ${alias}.${quoteName(label.display)} from ${quoteTable(label.target)} as ${alias} where ${reachedRow(parameters, row, label, alias).join(' and ')})`
}

/**
 * A person's conditions through a lookup (0139): whether the target row
 * `row`'s foreign key finds as its label does (`reachedRow`) holds every
 * one, each spelled on that row as the person's filter is on the root
 * (`filter.ts`). EXISTS, as a through is: a row is on the page once
 * whatever the target holds, never joined to it, and a row whose foreign
 * key finds no row -- NULL, dangling, hidden by the lookup's filters --
 * holds no condition. No plan of it is measured.
 */
function relatedPredicate(parameters: Parameters, row: string, related: RelatedTerms, alias: string): string {
  const where = [
    ...reachedRow(parameters, row, { ...related, terms: [] }, alias),
    ...related.filter.map((entry) => recordFilterPredicate(parameters, alias, entry)),
  ]
  return `exists (select 1 from ${quoteTable(related.target)} as ${alias} where ${where.join(' and ')})`
}
