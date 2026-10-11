import type { LookupSearchColumn } from '@formancy/data-core'
import { op } from './catalog.js'
import { quoteIdentifier } from './identifiers.js'
import type { Statement } from './statement.js'
import { canonicalText } from './values.js'

/*
 * How a search matches on PostgreSQL: one spelling for a lookup's options
 * and a form's records (0044), so the same text finds the same rows in both.
 */

/**
 * LIKE's escape character. Not a backslash: a composition root may still set
 * `standard_conforming_strings = off`, and then `'\'` is not a one-character
 * literal but the start of an unterminated one.
 */
const ESCAPE = '!'

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
 * Whether a search column of `row` contains the pattern, case folded.
 *
 * The column is read as its canonical text, the text its label or its cell
 * shows: text as itself, an integer as its digits (0028), never through
 * another conversion.
 *
 * Through the database's default collation: PostgreSQL 17 refuses LIKE and
 * ILIKE outright on a column whose collation is nondeterministic (0A000), and
 * the default collation is always deterministic. ILIKE folds case as that
 * collation's ctype does; nothing folds accents, where formancy's own
 * narrowing does (README).
 *
 * Spelled as what `ilike … escape` stands for, `~~*` against `like_escape`,
 * because the keyword names its operator without a schema (`catalog.ts`).
 */
function contains(row: string, search: LookupSearchColumn, pattern: string): string {
  return `(${canonicalText(search.type, `${row}.${quoteIdentifier(search.name)}`)} collate pg_catalog."default") ${op('~~*')} pg_catalog.like_escape(${pattern}, '${ESCAPE}')`
}

/** The condition that some column of `row` contains `search`, the pattern bound once. `columns` is never empty: a search over nothing is refused before SQL. */
export function searchSql(statement: Statement, row: string, columns: readonly LookupSearchColumn[], search: string): string {
  if (columns.length === 0) throw new Error('A search names at least one column; one over none would match nothing on one engine and fail on the other.')
  const pattern = statement.text(containsPattern(search))
  return `(${columns.map((entry) => contains(row, entry, pattern)).join(' or ')})`
}
