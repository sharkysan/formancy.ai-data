import { useContext, useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import type { GridApi } from 'ag-grid-community'
import { filterByExample } from './cell-example.js'
import type { GridColumn, GridRow } from './grid-datasource.js'
import { HeaderFilterContext } from './header-filter.js'
import { pageRecords } from './known-records.js'

/*
 * A record grid's side of its section's filter where the grid draws it
 * (`HeaderFilterContext`): a box under each header the filter line may
 * name (0132, header-filter.tsx); `=` on a cell, its value kept as its
 * column's condition (0133, cell-example.tsx), and the keyboard back on
 * the row it was pressed on once the list it asked for answers; the grid
 * described by the line's hint, which says `=`; and the records a page
 * shows, heard of by the labels the line, the chips and the boxes say a
 * lookup's condition by (0135). A grid under no filter line has no boxes,
 * and `=` keeps nothing.
 */

/** What a grid tells its section's filter, and asks of it: the same functions for the grid's life. */
export interface HeaderFilterHooks {
  /** The grid made: described by the line's hint, where there is a line to say it. */
  ready(grid: GridApi<GridRow>): void
  /** A page's rows: the records its lookups' cells show, heard of (0135). */
  heard(columns: readonly GridColumn[], rows: readonly GridRow[]): void
  /** `=` on a cell: its value kept as its column's condition, and true; false where the column offers none. */
  example(row: GridRow | undefined, colId: string): boolean
  /** A page answered from `start`: after `=`, the keyboard back on the row it was pressed on, or the first, in its column (0133). */
  listed(start: number, rows: readonly GridRow[]): void
}

export function useHeaderFilters(api: RefObject<GridApi<GridRow> | null>): { boxedKeys: string; headers: HeaderFilterHooks } {
  const headerFilters = useContext(HeaderFilterContext)
  const headersNow = useRef(headerFilters)
  headersNow.current = headerFilters
  /** Where `=` kept a cell's value (0133): the keyboard goes back to that row and column once the list it asked for answers. */
  const exampleAt = useRef<{ record: string | null; colId: string } | null>(null)
  // The grid described by the filter line's hint, which says `=`, where there is a line to say it.
  const describedBy = headerFilters !== null && headerFilters.fields.length > 0 ? (headerFilters.hint ?? null) : null
  useEffect(() => {
    const grid = api.current
    if (grid !== null && !grid.isDestroyed()) grid.setGridAriaProperty('describedby', describedBy)
  }, [api, describedBy])

  const headers = useMemo<HeaderFilterHooks>(
    () => ({
      ready: (grid) => {
        const now = headersNow.current
        if (now !== null && now.fields.length > 0 && now.hint !== undefined) grid.setGridAriaProperty('describedby', now.hint)
      },
      heard: (columns, rows) => {
        for (const [field, named] of pageRecords(columns, rows)) headersNow.current?.heard?.(field, named)
      },
      example: (row, colId) => {
        if (!filterByExample(headersNow.current, row, colId)) return false
        exampleAt.current = { record: row?.record ?? null, colId }
        return true
      },
      listed: (start, rows) => {
        const example = exampleAt.current
        if (example === null || start !== 0) return
        exampleAt.current = null
        const grid = api.current
        const node = example.record === null ? undefined : grid?.getRowNode(example.record)
        const at = node?.rowIndex ?? (rows.length > 0 ? 0 : null)
        if (grid !== null && !grid.isDestroyed() && at !== null) {
          grid.ensureIndexVisible(at)
          grid.setFocusedCell(at, example.colId)
        }
      },
    }),
    [api],
  )

  // A box under each header the section's filter line may name (0132), the
  // keys as one string so the grid's columns are made again only when they change.
  const boxedKeys = (headerFilters?.fields ?? []).map((field) => field.field).join('\n')
  return { boxedKeys, headers }
}
