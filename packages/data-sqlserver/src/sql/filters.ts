import type { RowFilterTerm } from '@formancy/data-core'
import mssql from 'mssql'
import type { Parameters } from './statement.js'
import { bindValue } from './values.js'

/**
 * How a row filter and the write check compare text exactly (0028): the
 * column's canonical value is the trusted value, UTF-16 unit for unit, as
 * PostgreSQL compares two `"C"`-collated texts.
 *
 * SQL Server has no such operator. Every collation, BIN2 included, ignores
 * trailing spaces in `=`, so `N'acme' = N'acme ' collate BIN2` is true (C2),
 * and a filter of BIN2 alone let tenant `acme` read the rows of `acme `
 * (C2-table). Two equal-length strings that BIN2 calls equal are the same
 * string, so the byte lengths are compared too.
 */

/** A collation that compares code point by code point: case and accents count, trailing spaces still do not. */
const EXACT_COLLATION = 'Latin1_General_100_BIN2'

/**
 * SQL that is true when two nvarchar expressions are exactly the same text.
 * Both sides are canonical text — what `canonicalText` reads, or a bound
 * value — so a char(n)'s padding is already gone from both.
 */
export function exactText(left: string, right: string): string {
  return `${left} = ${right} collate ${EXACT_COLLATION} and datalength(${left}) = datalength(${right})`
}

/**
 * One row filter on `column`, binding its value once.
 *
 * A non-text value is bound as its column's type, as a record key is: the
 * canonical spelling `scopeRowFilters` checked converts to exactly one value.
 *
 * Text is compared three ways, all on one parameter:
 *
 * - `column = @p`, in the column's own collation, which admits a superset —
 *   an exactly equal pair is equal under every collation — and is the
 *   conjunct an index seeks on. Measured on SQL Server 2022 (16.0.4295) on
 *   2026-10-09 over 20,004 rows (C5): an nvarchar or nchar column seeks
 *   (`GetRangeWithMismatchedTypes`), and so does a char or varchar under a
 *   Windows collation; a char or varchar under a `SQL_` collation still
 *   converts every row and scans, as it did before (0017). BIN2 alone never
 *   seeked: the fixture's lookup scanned another index and looked each row up.
 * - the same under BIN2, so case and accents count.
 * - for variable-length text, the byte lengths, so trailing spaces count.
 *   A fixed-length column needs none: its canonical value has no padding, a
 *   value ending in a space is refused before this (`scopeRowFilters`), and
 *   `=` ignores the padding the column stores.
 *
 * The parameter is nvarchar(max), never the column's length, which the
 * server would truncate it to without a word.
 */
export function filterPredicate(parameters: Parameters, column: string, term: RowFilterTerm): string {
  const { type } = term
  if (type.kind !== 'text') return `${column} = ${bindValue(parameters, type, term.value)}`
  const value = parameters.add(mssql.NVarChar(mssql.MAX), term.value)
  const exact = `${column} = ${value} and ${column} = ${value} collate ${EXACT_COLLATION}`
  return type.fixedLength ? exact : `${exact} and datalength(convert(nvarchar(max), ${column})) = datalength(${value})`
}
