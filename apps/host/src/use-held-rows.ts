import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { GridApi } from 'ag-grid-community'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import type { GridRow, GridSource } from './grid-datasource.js'

/*
 * The rows on screen while the next are asked for (0146). AG Grid's
 * infinite row model draws a block's rows empty from the moment it makes
 * the block -- a page turned to, a new datasource, a sort -- until its
 * datasource answers, so a page that waited on the server blanked for as
 * long as the server took. Here the next page, and a new list's first, is
 * asked for first (`askFirst` in grid-datasource.ts) while AG Grid keeps
 * showing the rows it has, which the grid's well draws dimmed and AG Grid
 * marks busy (record-grid.tsx); AG Grid is moved to the page, or given the
 * new list, once the answer is there, and takes it without asking again.
 *
 * A refusal leaves AG Grid as it was, its rows on screen and no longer
 * dimmed, with the server's sentence on the line, and Ask again asks for
 * what was refused. A press of Previous rows or Next rows while a page or a
 * list is asked first sends nothing: the answer coming is the one the
 * person waits for, and a second page asked from the first's would have
 * nowhere to start (0108).
 *
 * What it does not hold: AG Grid makes the block a task before it asks the
 * datasource for it (`InfiniteBlock.loadFromDatasource`, ag-grid-community
 * 36.2.0), so a page given to it is drawn a task after its rows are made
 * empty -- read from that source, not measured. A page asked for again
 * after a save or a delete, by Ask again after a refusal of AG Grid's own,
 * or once a list starts again (0108), is asked by AG Grid, as before.
 */

/** A page asked for first: from which list, from which row, and what shows it once it has answered. */
interface Asked {
  source: GridSource
  start: number
  show: () => void
}

export interface HeldRows {
  /** The list AG Grid is shown: the newest whose first page has answered, or the first. */
  source: GridSource
  /** Previous rows or Next rows: the page asked for first, AG Grid moved to it once it answers. */
  turn: (by: 1 | -1) => void
  /** Ask again for what was refused when asked first; false where nothing was, and AG Grid's own page is to be asked again. */
  again: () => boolean
  /** The list from its first page again (0108): AG Grid moved there, or, on it already, asked for it again. */
  restart: () => void
}

export function useHeldRows(api: RefObject<GridApi<GridRow> | null>, datasource: GridSource): HeldRows {
  const [source, setSource] = useState(datasource)
  /** What is asked first now; a newer ask replaces it, and its answer is then nobody's. */
  const asking = useRef<Asked | null>(null)
  /** What was asked first and refused, for Ask again. */
  const refused = useRef<Asked | null>(null)

  const first = useCallback((asked: Asked) => {
    asking.current = asked
    refused.current = null
    void asked.source.askFirst(asked.start, asked.start + LIST_PAGE_SIZE).then((outcome) => {
      if (asking.current !== asked) return
      asking.current = null
      if (outcome === 'ready') asked.show()
      else if (outcome === 'refused') refused.current = asked
    })
  }, [])

  // A new list: its first page asked for while AG Grid shows the last one's
  // rows, and AG Grid given the list once it has answered.
  useEffect(() => {
    if (datasource === source) return
    first({ source: datasource, start: 0, show: () => setSource(datasource) })
  }, [datasource, source, first])

  const restart = useCallback(() => {
    const grid = api.current
    if (grid === null || grid.isDestroyed()) return
    // Asked first from the first page, AG Grid is still on it: it asks for it again.
    if (grid.paginationGetCurrentPage() === 0) grid.purgeInfiniteCache()
    else grid.paginationGoToFirstPage()
  }, [api])

  return {
    source,
    turn: (by) => {
      const grid = api.current
      if (asking.current !== null || grid === null || grid.isDestroyed()) return
      const page = grid.paginationGetCurrentPage() + by
      if (page < 0) return
      first({
        source,
        start: page * LIST_PAGE_SIZE,
        show: () => {
          if (!grid.isDestroyed()) grid.paginationGoToPage(page)
        },
      })
    },
    again: () => {
      const asked = refused.current
      if (asked === null) return false
      first(asked)
      return true
    },
    restart,
  }
}
