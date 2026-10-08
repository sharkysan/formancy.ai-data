import type { LookupConfig, LookupKeyColumn, LookupQuery, LookupSort, RowFilterTerm } from '@formancy/data-core'
import { filterSql } from '../sql/filters.js'
import { quoteIdentifier, quoteTable } from '../sql/identifiers.js'
import { Statement } from '../sql/statement.js'
import { sqlTypeOf } from '../sql/types.js'
import { canonicalText, displayText } from '../sql/values.js'

/** A statement ready to run: its text, and the parameters its placeholders name. */
export interface LookupStatement {
  text: string
  params: readonly (string | null)[]
}

/** The alias of the target table in every lookup query. */
const ROW = '"r"'

/**
 * LIKE's escape character. Not a backslash: a composition root may still set
 * `standard_conforming_strings = off`, and then `'\'` is not a one-character
 * literal but the start of an unterminated one.
 */
const ESCAPE = '!'

/** Maps, not object literals: `constructor` is a property of every object and of no Map. */
const DIRECTION: ReadonlyMap<unknown, string> = new Map([
  ['asc', 'asc'],
  ['desc', 'desc'],
])
const NULLS: ReadonlyMap<unknown, string> = new Map([
  ['first', 'nulls first'],
  ['last', 'nulls last'],
])

function column(name: string): string {
  return `${ROW}.${quoteIdentifier(name)}`
}

/**
 * The search, as a LIKE pattern that matches it literally: the escape
 * character, `%` and `_` each escaped, so a person typing `100%` finds
 * "100%" and not every name that starts with 100. `[` means nothing to
 * PostgreSQL's LIKE and needs nothing.
 */
export function containsPattern(search: string): string {
  return `%${search.replace(/[!%_]/g, (character) => `${ESCAPE}${character}`)}%`
}

/**
 * The key columns as canonical text, in key order, then the display columns.
 * The key is read exactly as `rejectedTokens` and `lookupPage` re-encode it:
 * as the row holds it, never as the token spelled it.
 */
function selectList(config: LookupConfig, withDisplay: boolean): string {
  const keys = config.targetColumns.map((key) => canonicalText(key.type, column(key.name)))
  const display = withDisplay ? config.display.map((name) => displayText(column(name))) : []
  return [...keys, ...display].join(', ')
}

/** The order, each column's direction and NULL placement spelled from a fixed table rather than copied. */
function orderBy(sort: readonly LookupSort[]): string {
  return sort
    .map((entry) => {
      const direction = DIRECTION.get(entry.direction)
      const nulls = NULLS.get(entry.nulls)
      if (direction === undefined || nulls === undefined) throw new Error(`${entry.column} has no order this adapter can spell.`)
      return `${column(entry.column)} ${direction} ${nulls}`
    })
    .join(', ')
}

/**
 * Whether a search column contains the pattern, case folded.
 *
 * Through the database's default collation: PostgreSQL 17 refuses LIKE and
 * ILIKE outright on a column whose collation is nondeterministic (0A000), and
 * the default collation is always deterministic. ILIKE folds case as that
 * collation's ctype does; nothing folds accents, where formancy's own
 * narrowing does (README).
 */
function contains(name: string, pattern: string): string {
  return `(${column(name)}::text collate "default") ilike ${pattern} escape '${ESCAPE}'`
}

/** A lookup query. `where` is never empty: a search excludes NULL keys, and a key query has its IN. */
function assemble(config: LookupConfig, select: string, from: readonly string[], where: readonly string[], tail = ''): string {
  return [`select ${select}`, `from ${[`${quoteTable(config.target)} as ${ROW}`, ...from].join(', ')}`, `where ${where.join(' and ')}`, tail]
    .filter((part) => part !== '')
    .join('\n')
}

/**
 * One page of a search: the rows inside the filters whose key has no NULL
 * and whose search columns contain the text, in the configured total order,
 * with one row more than the page so `lookupPage` can tell whether there is more.
 */
export function searchStatement(config: LookupConfig, query: LookupQuery, terms: readonly RowFilterTerm[]): LookupStatement {
  const statement = new Statement()
  const filters = filterSql(statement, config.target, ROW, terms)
  // No foreign key value can reference a key that holds a NULL.
  const where = [...filters.where, ...config.targetColumns.map((key) => `${column(key.name)} is not null`)]
  if (query.search !== '') {
    const pattern = statement.text(containsPattern(query.search))
    where.push(`(${config.search.map((name) => contains(name, pattern)).join(' or ')})`)
  }
  const limit = statement.as(String(query.limit + 1), 'bigint')
  const offset = statement.as(String(query.offset), 'bigint')
  const text = assemble(config, selectList(config, true), filters.from, where, `order by ${orderBy(config.sort)}\nlimit ${limit} offset ${offset}`)
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
 * has already checked and which therefore has at least one entry: `IN ()` is
 * a syntax error. With the display columns for `resolve`, without for
 * `rejects`. A one-column key is a parenthesised one-column row, which
 * PostgreSQL reads as the value itself, so one spelling serves every key.
 */
export function keysStatement(config: LookupConfig, keys: readonly (readonly string[])[], terms: readonly RowFilterTerm[], withDisplay: boolean): LookupStatement {
  const statement = new Statement()
  const filters = filterSql(statement, config.target, ROW, terms)
  const target = `(${config.targetColumns.map((key) => column(key.name)).join(', ')})`
  const tuples = keys.map((key) => keyTuple(statement, config.targetColumns, key))
  const text = assemble(config, selectList(config, withDisplay), filters.from, [...filters.where, `${target} in (${tuples.join(', ')})`])
  return { text, params: statement.params }
}
