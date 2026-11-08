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
 * new list, once the answer is there, and takes it without asking again. A
 * page AG Grid does not move to -- one it counts no rows for -- is dropped,
 * and the wait it began is ended (`onStuck`).
 *
 * A refusal leaves AG Grid as it was, its rows on screen and no longer
 * dimmed, with the server's sentence on the line, and Ask again asks for
 * what was refused. A new list refused *stands*: the rows on screen are the
 * last list's, which the search, the filter or the sort on screen no longer
 * name, so nothing pages or asks for that list again -- Previous rows and
 * Next rows wait (`standing`), and a turn, a save's or a delete's reload and
 * Ask again ask for the refused list, until a list is shown. A refused page
 * is forgotten once AG Grid has asked for a block of its own or a block has
 * answered (`heard`): Ask again is then for what was refused last.
 *
 * A press of Previous rows or Next rows while a page or a list is asked
 * first sends nothing: the answer coming is the one the person waits for,
 * and a second page asked from the first's would have nowhere to start
 * (0108). A reload while a new list is on its way asks for that list
 * again, so what it shows is what was saved. The grid hears the list shown
 * and the list asked for, and no other (`live`). What has answered is given
 * to AG Grid between presses, never during one (`press`): AG Grid redraws
 * the rows it is given, and a click whose press began on a row it redrew
 * would land on none.
 *
 * What it does not hold: AG Grid makes the block a task before it asks the
 * datasource for it (`InfiniteBlock.loadFromDatasource`, ag-grid-community
 * 36.2.0), so a page given to it is drawn a task after its rows are made
 * empty -- read from that source, not measured. A page asked for again
 * after a save or a delete with no other list asked for, by Ask again after
 * a refusal of AG Grid's own, or once a list starts again (0108), is asked
 * by AG Grid, as before.
 */

/** A page asked for first: from which list, from which row, and what shows it once it has answered -- false where AG Grid did not move to it. */
interface Asked {
  source: GridSource
  start: number
  show: () => boolean
}

export interface HeldRows {
  /** The list AG Grid is shown: the newest whose first page has answered, or the first. */
  source: GridSource
  /** A new list was refused and stands: the rows on screen are the last list's, and Previous rows and Next rows wait for it. */
  standing: boolean
  /** Previous rows or Next rows: the page asked for first, AG Grid moved to it once it answers; while a refused list stands, that list asked for again. */
  turn: (by: 1 | -1) => void
  /** Ask again for what was refused when asked first; false where nothing was, and AG Grid's own page is to be asked again. */
  again: () => boolean
  /** A save's or a delete's reload: the list on its way, or the refused list that stands, asked for again; false where AG Grid's own page is to be asked again. */
  reload: () => boolean
  /** AG Grid asked for a block of its own, or a block answered: a refused page is no longer what Ask again asks for. */
  heard: () => void
  /** Whether what `from` tells the grid is the page's: the list shown, or the list asked for. */
  live: (from: GridSource) => boolean
  /** The list from its first page again (0108): AG Grid moved there, or, on it already, asked for it again. */
  restart: () => void
  /** A pointer pressed on the grid, or let go: what answers meanwhile is given to AG Grid once it is let go. */
  press: (down: boolean) => void
}

export function useHeldRows(api: RefObject<GridApi<GridRow> | null>, datasource: GridSource, onStuck: () => void): HeldRows {
  const [source, setSource] = useState(datasource)
  /** The list shown, as soon as it is given to AG Grid: `source` is a render later. */
  const shown = useRef(datasource)
  /** What is asked first now; a newer ask replaces it, and its answer is then nobody's. */
  const asking = useRef<Asked | null>(null)
  /** What was asked first and refused, for Ask again. */
  const refused = useRef<Asked | null>(null)
  /** The new list refused that stands, until a list is shown or another asked for. */
  const standingList = useRef<GridSource | null>(null)
  const [standing, setStanding] = useState(false)
  const stuck = useRef(onStuck)
  stuck.current = onStuck
  /** A pointer is down on the grid, and what answered while it was, to be shown once it is let go. */
  const pressed = useRef(false)
  const deferred = useRef<(() => void) | null>(null)

  const stand = useCallback((list: GridSource | null) => {
    standingList.current = list
    setStanding(list !== null)
  }, [])

  const first = useCallback(
    (ask: Asked) => {
      // A fresh ask, never one already on its way: an answer is known by the ask it is for.
      const asked = { ...ask }
      asking.current = asked
      refused.current = null
      deferred.current = null
      if (standingList.current !== null && standingList.current !== asked.source) stand(null)
      void asked.source.askFirst(asked.start, asked.start + LIST_PAGE_SIZE).then((outcome) => {
        if (asking.current !== asked) return
        asking.current = null
        if (outcome === 'ready') {
          const settle = (): void => {
            if (asked.show()) return
            asked.source.drop()
            stuck.current()
          }
          if (pressed.current) deferred.current = settle
          else settle()
        } else if (outcome === 'refused') {
          refused.current = asked
          if (asked.source !== shown.current) stand(asked.source)
        }
      })
    },
    [stand],
  )

  /** A new list's first page, shown by giving AG Grid the list. */
  // A press is let go wherever the pointer is: what answered meanwhile is shown then.
  const pressRef = useRef<(down: boolean) => void>(() => {})
  useEffect(() => {
    const release = (): void => pressRef.current(false)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [])

  const listOf = useCallback(
    (list: GridSource): Asked => ({
      source: list,
      start: 0,
      show: () => {
        shown.current = list
        setSource(list)
        stand(null)
        return true
      },
    }),
    [stand],
  )

  // A new list: its first page asked for while AG Grid shows the last one's
  // rows, and AG Grid given the list once it has answered.
  useEffect(() => {
    if (datasource === shown.current) return
    first(listOf(datasource))
  }, [datasource, first, listOf])

  const restart = useCallback(() => {
    const grid = api.current
    if (grid === null || grid.isDestroyed()) return
    // Asked first from the first page, AG Grid is still on it: it asks for it again.
    if (grid.paginationGetCurrentPage() === 0) grid.purgeInfiniteCache()
    else grid.paginationGoToFirstPage()
  }, [api])

  /** The newest list asked for and not shown: on its way, or refused and standing. */
  const newest = (): GridSource | null => {
    const coming = asking.current?.source
    if (coming !== undefined && coming !== shown.current) return coming
    return standingList.current
  }

  const press = (down: boolean): void => {
    pressed.current = down
    if (down || deferred.current === null) return
    // A task later: the click that ends the press is the row's that was pressed.
    setTimeout(() => {
      const settle = deferred.current
      deferred.current = null
      if (!pressed.current) settle?.()
      else deferred.current = settle
    }, 0)
  }
  pressRef.current = press

  return {
    source,
    standing,
    turn: (by) => {
      const grid = api.current
      if (asking.current !== null || grid === null || grid.isDestroyed()) return
      const list = standingList.current
      if (list !== null) {
        first(listOf(list))
        return
      }
      const page = grid.paginationGetCurrentPage() + by
      if (page < 0) return
      first({
        source: shown.current,
        start: page * LIST_PAGE_SIZE,
        show: () => {
          if (grid.isDestroyed()) return true
          grid.paginationGoToPage(page)
          return grid.paginationGetCurrentPage() === page
        },
      })
    },
    again: () => {
      const asked = refused.current
      if (asked === null) return false
      first(asked)
      return true
    },
    reload: () => {
      const list = newest()
      if (list === null) return false
      first(listOf(list))
      return true
    },
    heard: () => {
      if (refused.current?.source === shown.current) refused.current = null
    },
    live: (from) => from === shown.current || from === asking.current?.source,
    restart,
    press,
  }
}
