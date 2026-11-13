import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { GridApi } from 'ag-grid-community'
import type { ArrangedColumn } from './columns.js'
import type { GridRow } from './grid-datasource.js'
import { hiddenWell, sizedToContent, sizing } from './grid-sizing.js'
import type { SizeState, SizeWant } from './grid-sizing.js'
import { CONTENT_WIDTH } from './widths.js'
import type { ColumnWidth } from './widths.js'

/**
 * A grid's columns sized to its rows (0047), where the grid is drawn
 * (grid-sizing.ts, 0142): to the first page that has rows, once, a task
 * after its rows are drawn, so paging never makes the columns jump; every
 * column again each time the separator is let go (`refit`), to the rows on
 * the page then -- to their content, as the first page sized them, never
 * stretched to the lane's width (UX-SPEC §6.3) and never past
 * `CONTENT_WIDTH`; and a column shown again, or given back to its content
 * by Fit or Reset columns (0151), to the rows on the page -- or, shown
 * while nothing was listed, to the next rows that come (`sizeWaiting`).
 * Where the well is hidden the size is owed, and made when the well is
 * drawn again, which its size changing from nothing says. After each, `fit`
 * fits the well to its page.
 *
 * A column whose width the person set is never sized, whatever asks
 * (`sizedToContent`): its width is the person's until Fit or Reset columns
 * gives it back.
 */
export function useGridSizing({
  api,
  well,
  shown,
  fit,
  refit,
  arranged,
  widths,
}: {
  api: RefObject<GridApi<GridRow> | null>
  well: RefObject<HTMLDivElement | null>
  shown: { current: SizeState }
  fit: () => void
  refit: number
  /** The grid's columns as the section arranged them (0106). */
  arranged: readonly ArrangedColumn[]
  /** The widths the person set (0151). */
  widths: readonly ColumnWidth[]
}): { sizeOnce: () => void; sizeWaiting: (rows: number) => void } {
  /** The widths set, read when a size is made: a task after it is asked for. */
  const kept = useRef(widths)
  kept.current = widths
  /** Columns shown, or given back to their content, while nothing was listed: sized to the next page that has rows. */
  const unsized = useRef(new Set<string>())

  /** `columns` sized to their content, but those whose width the person set: never past CONTENT_WIDTH, never below their floor. */
  const toContent = useCallback((grid: GridApi<GridRow>, columns: readonly string[]) => {
    const colIds = sizedToContent(columns, kept.current)
    if (colIds.length > 0) grid.autoSizeColumns({ colIds, skipHeader: true, defaultMaxWidth: CONTENT_WIDTH })
  }, [])

  /** Every column sized, or `columns` alone, where `sizing` says; otherwise what is owed recorded. */
  const size = useCallback(
    (want: SizeWant, columns?: readonly string[]) => {
      const grid = api.current
      if (grid === null || grid.isDestroyed()) return
      const now = sizing(shown.current, want, hiddenWell(well.current))
      shown.current.owed = now.owed
      if (!now.size) return
      if (columns === undefined) {
        toContent(
          grid,
          grid.getAllDisplayedColumns().map((column) => column.getColId()),
        )
        shown.current.sized = true
      } else toContent(grid, columns)
      fit()
    },
    [api, well, shown, fit, toContent],
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
  /** A page with `rows` answered: the columns waiting for one sized to it, once its rows are drawn -- or, hidden, owed with the rest. */
  const sizeWaiting = useCallback(
    (rows: number) => {
      if (rows === 0 || unsized.current.size === 0) return
      const waiting = [...unsized.current]
      unsized.current.clear()
      sizeAdded(waiting)
    },
    [sizeAdded],
  )

  // A column shown that was hidden when the page was sized, or whose width
  // was given back to its content: sized now, to the rows shown, and the
  // well fitted to a header the change may have made taller or shorter.
  // Shown while a page loads, or over a page with no rows, it waits in
  // `unsized` for the next page that has some (`sizeWaiting`): with nothing
  // to size it to, it would keep AG Grid's width, or the one given back,
  // until the separator is let go, and Stacked has none.
  const drawn = useRef({ arranged, widths })
  useEffect(() => {
    const before = drawn.current
    if (before.arranged === arranged && before.widths === widths) return
    drawn.current = { arranged, widths }
    const shownBefore = new Set(before.arranged.filter((column) => column.shown).map((column) => column.key))
    const keptBefore = new Set(before.widths.map((each) => each.field))
    const keptNow = new Set(widths.map((each) => each.field))
    const given = (key: string): boolean => keptBefore.has(key) && !keptNow.has(key)
    const added = arranged.filter((column) => column.shown && (!shownBefore.has(column.key) || given(column.key))).map((column) => column.key)
    // A width set changes no header's height and leaves no column to size.
    if (before.arranged === arranged && added.length === 0) return
    const grid = api.current
    if (grid === null || grid.isDestroyed()) return
    if (!shown.current.loaded || shown.current.rows === 0) {
      for (const key of added) unsized.current.add(key)
      if (shown.current.loaded) setTimeout(() => (grid.isDestroyed() ? undefined : fit()), 0)
      return
    }
    setTimeout(() => {
      if (grid.isDestroyed()) return
      if (added.length > 0) toContent(grid, added)
      fit()
    }, 0)
  }, [api, arranged, widths, shown, fit, toContent])

  return { sizeOnce, sizeWaiting }
}
