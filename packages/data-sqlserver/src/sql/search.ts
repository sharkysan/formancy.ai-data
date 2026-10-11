import type { LookupSearchColumn } from '@formancy/data-core'
import mssql from 'mssql'
import { quoteName } from './quote.js'
import type { Parameters } from './statement.js'
import { canonicalText } from './values.js'

/*
 * How a search matches on SQL Server: one spelling for a lookup's options
 * and a form's records (0044), so the same text finds the same rows in both.
 */

/**
 * The search as a LIKE pattern that matches only itself: `\` is the escape,
 * and the escape, `%`, `_` and `[` are escaped by it. `[` too, because
 * SQL Server reads `[a-c]` as a character class; `]`, `^` and `-` mean
 * something only inside one.
 */
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_[]/g, (character) => `\\${character}`)}%`
}

/**
 * What a search column of `row` is matched as: text as itself, so the
 * column's collation folds case and accents as it does in an index; an
 * integer as its canonical text, the digits its label or its cell shows,
 * converted explicitly rather than by LIKE's implicit conversion (0028).
 */
function searched(row: string, search: LookupSearchColumn): string {
  const column = `${row}.${quoteName(search.name)}`
  return search.type.kind === 'integer' ? canonicalText(search.type, column) : column
}

/** The condition that some column of `row` contains `search`, the pattern bound once. `columns` is never empty: a search over nothing is refused before SQL. */
export function searchPredicate(parameters: Parameters, row: string, columns: readonly LookupSearchColumn[], search: string): string {
  if (columns.length === 0) throw new Error('A search names at least one column; one over none would match nothing on one engine and fail on the other.')
  const pattern = parameters.add(mssql.NVarChar(mssql.MAX), containsPattern(search))
  return `(${columns.map((entry) => `${searched(row, entry)} like ${pattern} escape N'\\'`).join(' or ')})`
}
