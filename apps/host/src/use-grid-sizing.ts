import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { GridApi } from 'ag-grid-community'
import type { GridRow } from './grid-datasource.js'
import { hiddenWell, sizing } from './grid-sizing.js'
import type { SizeState, SizeWant } from './grid-sizing.js'

/**
 * A grid's columns sized to its rows (0047), where the grid is drawn
 * (grid-sizing.ts, 0142): to the first page that has rows, once, a task
 * after its rows are drawn, so paging never makes the columns jump; every
 * column again each time the separator is let go (`refit`), to the rows on
 * the page then -- to their content, as the first page sized them, never
 * stretched to the lane's width (UX-SPEC §6.3); and columns shown while
 * nothing was listed, to the next rows that come. Where the well is hidden
 * the size is owed, and made when the well is drawn again, which its size
 * changing from nothing says. After each, `fit` fits the well to its page.
 */
export function useGridSizing({
  api,
  well,
  shown,
  fit,
  refit,
}: {
  api: RefObject<GridApi<GridRow> | null>
  well: RefObject<HTMLDivElement | null>
  shown: { current: SizeState }
  fit: () => void
  refit: number
}): { sizeOnce: () => void; sizeAdded: (columns: readonly string[]) => void } {
  /** Every column sized, or `columns` alone, where `sizing` says; otherwise what is owed recorded. */
  const size = useCallback(
    (want: SizeWant, columns?: readonly string[]) => {
      const grid = api.current
      if (grid === null || grid.isDestroyed()) return
      const now = sizing(shown.current, want, hiddenWell(well.current) && false)
      shown.current.owed = now.owed
      if (!now.size) return
      if (columns === undefined) {
        grid.autoSizeAllColumns(true)
        shown.current.sized = true
      } else grid.autoSizeColumns([...columns], true)
      fit()
    },
    [api, well, shown, fit],
  )

  const refitted = useRef(refit)
  useEffect(() => {
    if (refit === refitted.current) return
    refitted.current = refit
    size('refit')
  }, [refit, size])

  // The well drawn again -- its tab, view or level shown -- is a change of
  // its size from nothing: a size owed while it was hidden is made then.
  useEffect(() => {
    const container = well.current
    if (container === null || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => size('shown'))
    observer.observe(container)
    return () => observer.disconnect()
  }, [well, size])

  const sizeOnce = useCallback(() => {
    if (shown.current.sized || shown.current.rows === 0) return
    setTimeout(() => size('page'), 0)
  }, [shown, size])
  const sizeAdded = useCallback(
    (columns: readonly string[]) => {
      setTimeout(() => size('added', columns), 0)
    },
    [size],
  )
  return { sizeOnce, sizeAdded }
}
