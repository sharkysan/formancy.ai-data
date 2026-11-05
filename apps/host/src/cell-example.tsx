import type { LineField, ListFilterTerm } from '@formancy/data-client'
import { withTerm } from './filter-terms.js'
import type { GridRow } from './grid-datasource.js'
import type { HeaderFilters } from './header-filter.js'

/*
 * Filter by example (0133): a cell's value, as its row holds it, made the
 * condition on its column -- "only rows where Status is placed" -- in place
 * of the condition the column had, by `=` on a focused cell. Only where the
 * filter line may name the column, and only a value the line could say:
 * equal to it, or empty where the column offers that. A lookup's cell
 * shows a label and holds the record's token, which is what its column is
 * filtered by (0135), and the page hears of the label the cell shows.
 */

/** The condition a row's value puts on `field`, or null where it can say none. */
export function exampleTerm(row: GridRow | undefined, field: LineField): ListFilterTerm | null {
  if (row === undefined) return null
  const value = row.answers[field.field]
  if (value === null || value === undefined) return field.operators.includes('null') ? { field: field.field, op: 'null' } : null
  if (!field.operators.includes('equals')) return null
  if (typeof value === 'string') return { field: field.field, op: 'equals', value }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return { field: field.field, op: 'equals', value: String(value) }
  return null
}

/** `row`'s value in column `colId` applied as its condition; false where the column offers none. */
export function filterByExample(headers: HeaderFilters | null, row: GridRow | undefined, colId: string): boolean {
  const field = headers?.fields.find((entry) => entry.field === colId)
  const term = field === undefined ? null : exampleTerm(row, field)
  if (headers === null || term === null) return false
  const label = row?.labels[colId]
  if (term.op === 'equals' && label !== undefined) headers.heard?.(colId, [{ token: term.value, label }])
  const next = withTerm(headers.filter, term)
  if (JSON.stringify(next) !== JSON.stringify(headers.filter)) headers.onFilter(next)
  return true
}
