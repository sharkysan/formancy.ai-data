import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { GridApi } from 'ag-grid-community'
import type { ListSortTerm } from '@formancy/data-client'
import type { GridRow } from './grid-datasource.js'
import { headerSort } from './grid-options.js'
import { sameSort } from './views.js'

/*
 * A record grid's sort is its section's (0105), so a view picked can set it
 * with the filter: the headers are made to show it whenever they show
 * another (`showSort`), and a header the person sorts by is told to the
 * section, which then holds that sort (`sorted`). The grid's datasource
 * asks for a block only once the headers show the section's sort
 * (grid-datasource.ts), so a new filter and a new sort together are one
 * first page.
 */

export function useGridSort(
  api: RefObject<GridApi<GridRow> | null>,
  /** The section's sort, compared by identity: the caller keeps it as state. */
  sort: readonly ListSortTerm[],
  /** A header sorted by the person: the grid's sort now, in its order, for the section to hold as given. */
  onSort: (sort: ListSortTerm[]) => void,
): { showSort: () => void; sorted: () => void } {
  /** The section's sort and where a header's is told, read when AG Grid calls. */
  const section = useRef({ sort, onSort })
  section.current = { sort, onSort }
  /**
   * The last sort the headers told the section of. AG Grid tells a press a
   * task late, so when the section holds what a press told it, the headers
   * may already show a later press on its way: showing the told one again
   * would undo it, as two quick Enters on a header did (export.test.tsx).
   */
  const told = useRef<readonly ListSortTerm[] | null>(null)

  /**
   * The section's sort on the headers, where they show another: they follow
   * it, and lead it only by a press. Every field a view or a kept sort
   * sorts by is a column here, shown or hidden (0106): a view is offered,
   * and a kept sort restored, only with fields in `list.sortable`, whose
   * fields `columnsOf` draws, leaving out only a child's parent field, a
   * lookup, which no list sorts by.
   */
  const showSort = useCallback(() => {
    const grid = api.current
    if (grid === null || grid.isDestroyed()) return
    const wanted = section.current.sort
    if (sameSort(headerSort(grid), wanted)) return
    grid.applyColumnState({
      state: wanted.map((term, index) => ({ colId: term.field, sort: term.direction, sortIndex: index })),
      defaultState: { sort: null, sortIndex: null },
    })
  }, [api])

  useEffect(() => {
    if (sort !== told.current) showSort()
  }, [sort, showSort])

  /** The headers' sort changed: told to the section where it is a sort the section does not hold yet -- the one it holds was put on the headers by `showSort`. */
  const sorted = useCallback(() => {
    const grid = api.current
    if (grid === null || grid.isDestroyed()) return
    const now = headerSort(grid)
    if (sameSort(now, section.current.sort)) return
    told.current = now
    section.current.onSort(now)
  }, [api])

  return { showSort, sorted }
}
