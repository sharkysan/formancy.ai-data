import type { LookupConfig, LookupKeyColumn, LookupQuery, RowFilterTerm } from '@formancy/data-core'
import { op } from '../sql/catalog.js'
import { filterSql } from '../sql/filters.js'
import { quoteIdentifier, quoteTable } from '../sql/identifiers.js'
import { orderBy } from '../sql/order.js'
import { searchSql } from '../sql/search.js'
import { Statement } from '../sql/statement.js'
import type { Param } from '../sql/statement.js'
import { sqlTypeOf } from '../sql/types.js'
import { canonicalText } from '../sql/values.js'

/** A statement ready to run: its text, and the parameters its placeholders name. */
export interface LookupStatement {
  text: string
  params: readonly Param[]
}

/** The alias of the target table in every lookup query. */
const ROW = '"r"'

function column(name: string): string {
  return `${ROW}.${quoteIdentifier(name)}`
}

/**
 * The key columns as canonical text, in key order, then the display columns.
 * The key is read exactly as `rejectedTokens` and `lookupPage` re-encode it:
 * as the row holds it, never as the token spelled it. A display column is
 * read by the record reader too, by its type, and `displayText` in the core
 * spells the label (0028): no session setting reaches it. `to_jsonb`, which
 * this used before, wrote an instant in the session's TimeZone and a float
 * by `extra_float_digits` (C6-pg).
 */
function selectList(config: LookupConfig, withDisplay: boolean): string {
  const keys = config.targetColumns.map((key) => canonicalText(key.type, column(key.name)))
  const display = withDisplay ? config.display.map((entry) => canonicalText(entry.type, column(entry.name))) : []
  return [...keys, ...display].join(', ')
}

/** A lookup query. `where` is never empty: a search excludes NULL keys, and a key query has its keys. */
function assemble(config: LookupConfig, select: string, where: readonly string[], tail = ''): string {
  return [`select ${select}`, `from ${quoteTable(config.target)} as ${ROW}`, `where ${where.join(' and ')}`, tail].filter((part) => part !== '').join('\n')
}

/**
 * One page of a search: the rows inside the filters whose key has no NULL
 * and whose search columns contain the text, in the configured total order,
 * with one row more than the page so `lookupPage` can tell whether there is more.
 */
export function searchStatement(config: LookupConfig, query: LookupQuery, terms: readonly RowFilterTerm[]): LookupStatement {
  const statement = new Statement()
  // No foreign key value can reference a key that holds a NULL.
  const where = [...filterSql(statement, ROW, terms), ...config.targetColumns.map((key) => `${column(key.name)} is not null`)]
  // Matched as a record list matches (sql/search.ts), and ordered as one is ordered (sql/order.ts).
  if (query.search !== '') where.push(searchSql(statement, ROW, config.search, query.search))
  const limit = statement.as(String(query.limit + 1), 'pg_catalog.int8')
  const offset = statement.as(String(query.offset), 'pg_catalog.int8')
  const text = assemble(config, selectList(config, true), where, `order by ${orderBy(ROW, config.sort)}\nlimit ${limit} offset ${offset}`)
  return { text, params: statement.params }
}

/**
 * One key as a row of values, each converted from text to its column's own
 * type, so the comparison can use the key's index. `lookupKeys` has checked
 * that every key has one value per column; a missing one would bind NULL,
 * which matches nothing.
 */
function keyTuple(statement: Statement, columns: readonly LookupKeyColumn[], key: readonly string[]): string {
  return `(${columns.map((keyColumn, index) => statement.as(key[index] ?? null, sqlTypeOf(keyColumn.type))).join(', ')})`
}

/**
 * The rows inside the filters whose key is one of `keys`, which `lookupKeys`
 * has already checked and which therefore has at least one entry: an empty
 * VALUES is a syntax error. With the display columns for `resolve`, without
 * for `rejects`.
 *
 * `= any (values …)` rather than `in (…)`: IN names its `=` without a
 * schema, and this one is pg_catalog's (`sql/catalog.ts`). A row compared
 * with a named `=` is compared column by column with it, and the planner
 * makes the whole a semi-join that probes the key's index once per distinct
 * key (EXPLAIN on PostgreSQL 17). A one-column key is a parenthesised
 * one-column row, which PostgreSQL reads as the value itself, so one
 * spelling serves every key.
 */
export function keysStatement(
  config: LookupConfig,
  keys: readonly (readonly string[])[],
  terms: readonly RowFilterTerm[],
  withDisplay: boolean,
): LookupStatement {
  const statement = new Statement()
  const filters = filterSql(statement, ROW, terms)
  const target = `(${config.targetColumns.map((key) => column(key.name)).join(', ')})`
  const tuples = keys.map((key) => keyTuple(statement, config.targetColumns, key))
  const text = assemble(config, selectList(config, withDisplay), [...filters, `${target} ${op('=')} any (values ${tuples.join(', ')})`])
  return { text, params: statement.params }
}
