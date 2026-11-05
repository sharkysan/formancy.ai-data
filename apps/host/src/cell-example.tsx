import { useContext, useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { LineField, ListFilterTerm } from '@formancy/data-client'
import { summaryOf, withTerm } from './filter-terms.js'
import type { GridRow } from './grid-datasource.js'
import { HeaderFilterContext } from './header-filter.js'
import type { HeaderFilters } from './header-filter.js'

/*
 * Filter by example (0133): a cell's value, as its row holds it, made the
 * condition on its column -- "only rows where Status is placed" -- in place
 * of the condition the column had. A person points at what they see before
 * they ever type: `=` on a focused cell, or the button a focused cell
 * shows. Only where the filter line may name the column, and only a value
 * the line could say: equal to it, or empty where the column offers that;
 * a lookup shows a label, not its value, and offers none.
 */

/** The condition a row's value puts on `field`, or null where it can say none. */
export function exampleTerm(row: GridRow | undefined, field: LineField): ListFilterTerm | null {
  if (row === undefined || row.labels[field.field] !== undefined) return null
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
  const next = withTerm(headers.filter, term)
  if (JSON.stringify(next) !== JSON.stringify(headers.filter)) headers.onFilter(next)
  return true
}

/**
 * The button a focused cell shows: an equals sign, drawn, titled for what it keeps. Its own
 * style attribute, in room variables, because no rule of host.css reaches
 * into a grid (0047), as a row's Delete is; 24 pixels a side, WCAG 2.5.8's
 * least. A pointer's way alone, out of the Tab order and out of the
 * accessibility tree: inside the cell its name would be read with the
 * cell's every time the cell is reached, and the keyboard's way, `=` on the
 * cell, is the one the filter line's hint says.
 */
const EXAMPLE_LOOK: CSSProperties = {
  // Out of the cell's flow, at its end: the cell is sized to its value,
  // and a button in its line would wrap or push the value -- and the open
  // row's bar -- once it appears.
  position: 'absolute',
  insetInlineEnd: 4,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'grid',
  placeItems: 'center',
  width: 24,
  height: 24,
  padding: 0,
  border: '1px solid var(--client)',
  borderRadius: 6,
  background: 'var(--ground)',
  color: 'var(--text)',
  font: 'inherit',
  lineHeight: 1,
  cursor: 'pointer',
}

export function ExampleButton({ cell, row, colId }: { cell: HTMLElement; row: GridRow | undefined; colId: string }): ReactElement | null {
  const headers = useContext(HeaderFilterContext)
  const [focused, setFocused] = useState(() => cell.contains(document.activeElement))
  useEffect(() => {
    const into = (): void => setFocused(true)
    const out = (event: FocusEvent): void => {
      if (!(event.relatedTarget instanceof Node) || !cell.contains(event.relatedTarget)) setFocused(false)
    }
    cell.addEventListener('focusin', into)
    cell.addEventListener('focusout', out)
    return () => {
      cell.removeEventListener('focusin', into)
      cell.removeEventListener('focusout', out)
    }
  }, [cell])
  const field = headers?.fields.find((entry) => entry.field === colId)
  const term = field === undefined ? null : exampleTerm(row, field)
  if (!focused || headers === null || field === undefined || term === null) return null
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      style={EXAMPLE_LOOK}
      title={`Only rows where ${summaryOf(term, field)}`}
      onClick={() => filterByExample(headers, row, colId)}
    >
      {/* Drawn, not written: a character here would be read into the cell's text. */}
      <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12">
        <path d="M2 4.5h8M2 7.5h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  )
}
