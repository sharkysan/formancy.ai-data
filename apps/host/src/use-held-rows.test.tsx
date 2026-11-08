import { describe, expect, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { GridApi } from 'ag-grid-community'
import type { AskedFirst, GridRow, GridSource } from './grid-datasource.js'
import { useHeldRows } from './use-held-rows.js'

/*
 * The rows on screen while the next are asked for (0146), the hook's own
 * decisions: what is asked first, of which list, what Ask again and a
 * reload ask for, and which list's word the grid hears. The grid is a
 * stand-in that keeps a page number and clamps it as AG Grid's pagination
 * does; each list answers when the test says. What AG Grid and the server
 * do with it is held-rows.test.tsx's, against the real server.
 */

/** AG Grid's pagination as the hook uses it: `pages` pages, a move to any other clamped back, as `adjustCurrentPageIfInvalid` does. */
function grid(pages: number): { api: { current: GridApi<GridRow> }; at: () => number; purged: () => number } {
  let page = 0
  let purged = 0
  const api = {
    isDestroyed: () => false,
    paginationGetCurrentPage: () => page,
    paginationGoToPage: (to: number) => {
      page = Math.min(Math.max(to, 0), pages - 1)
    },
    paginationGoToFirstPage: () => {
      page = 0
    },
    purgeInfiniteCache: () => {
      purged += 1
    },
  }
  return { api: { current: api as unknown as GridApi<GridRow> }, at: () => page, purged: () => purged }
}

/** A list that keeps the rows it was asked for from, and answers each ask when the test says, oldest first. */
function list(): { source: GridSource; asked: number[]; answer: (outcome: AskedFirst) => Promise<void>; dropped: () => number } {
  const asked: number[] = []
  const waiting: Array<(outcome: AskedFirst) => void> = []
  let dropped = 0
  const source: GridSource = {
    getRows: () => {},
    abort: () => {},
    drop: () => {
      dropped += 1
    },
    askFirst: (start) => {
      asked.push(start)
      return new Promise((resolve) => waiting.push(resolve))
    },
  }
  return {
    source,
    asked,
    answer: async (outcome) =>
      act(async () => {
        waiting.shift()?.(outcome)
        await Promise.resolve()
      }),
    dropped: () => dropped,
  }
}

const quiet = (): void => {}

describe('the rows on screen while the next are asked for (0146)', () => {
  // A new list refused leaves the last list's rows on screen, which must
  // not be paged or asked again as though they were the list the search
  // box and the chips say: the pager waits, and a turn or a reload asks
  // for the refused list again, until a list is shown (watched failing with
  // a turn paging the list shown: rows 51-100 of the last list asked for).
  test('a new list refused stands: the pager waits, and a turn or a reload asks for it again', async () => {
    const { api } = grid(3)
    const last = list()
    const next = list()
    const { result, rerender } = renderHook(({ source }) => useHeldRows(api, source, quiet), { initialProps: { source: last.source } })
    rerender({ source: next.source })
    expect(next.asked).toEqual([0])
    await next.answer('refused')
    expect({ standing: result.current.standing, shown: result.current.source }).toEqual({ standing: true, shown: last.source })
    act(() => result.current.turn(1))
    expect({ last: last.asked, next: next.asked }).toEqual({ last: [], next: [0, 0] })
    await next.answer('refused')
    let routed = false
    act(() => {
      routed = result.current.reload()
    })
    expect({ routed, next: next.asked, standing: result.current.standing }).toEqual({ routed: true, next: [0, 0, 0], standing: true })
    await next.answer('ready')
    expect({ standing: result.current.standing, shown: result.current.source }).toEqual({ standing: false, shown: next.source })
    act(() => {
      routed = result.current.reload()
    })
    expect(routed).toBe(false)
  })

  // A page AG Grid cannot move to -- one it counts no rows for -- would
  // never be asked of the list, so the wait it began would never end: what
  // was asked is dropped and the page says so (watched failing with the
  // move taken as made: nothing dropped, the wait left standing).
  test('drops a page AG Grid does not move to, and ends the wait', async () => {
    const { api, at } = grid(1)
    const shown = list()
    let stuck = 0
    const { result } = renderHook(() =>
      useHeldRows(api, shown.source, () => {
        stuck += 1
      }),
    )
    act(() => result.current.turn(1))
    await shown.answer('ready')
    expect({ page: at(), dropped: shown.dropped(), stuck }).toEqual({ page: 0, dropped: 1, stuck: 1 })
  })

  // Ask again asks for what was refused last: once AG Grid has asked for a
  // block of its own, or a block has answered, a page refused before is
  // not that, and asking for it again would move the person to it (watched
  // failing with the refusal kept: Ask again asked for rows 51-100).
  test('forgets a page refused once the grid has asked or been answered since', async () => {
    const { api } = grid(3)
    const shown = list()
    const { result } = renderHook(() => useHeldRows(api, shown.source, quiet))
    act(() => result.current.turn(1))
    await shown.answer('refused')
    act(() => result.current.heard())
    let again = true
    act(() => {
      again = result.current.again()
    })
    expect({ again, asked: shown.asked }).toEqual({ again: false, asked: [50] })
  })

  // Both lists tell the grid the same hooks: what the list shown and the
  // one asked for say is the page's, and a list replaced says nothing more
  // (watched failing with every list heard: the replaced one was).
  test('hears the list shown and the list asked for, and no other', async () => {
    const { api } = grid(3)
    const first = list()
    const second = list()
    const third = list()
    const { result, rerender } = renderHook(({ source }) => useHeldRows(api, source, quiet), { initialProps: { source: first.source } })
    rerender({ source: second.source })
    expect([result.current.live(first.source), result.current.live(second.source)]).toEqual([true, true])
    rerender({ source: third.source })
    expect([result.current.live(second.source), result.current.live(third.source)]).toEqual([false, true])
    await third.answer('ready')
    expect([result.current.live(first.source), result.current.live(third.source)]).toEqual([false, true])
  })

  // A press on a row that the list's answer would replace under the pointer
  // would lose its click: AG Grid redraws the rows, and the release lands on
  // none. The list is given to AG Grid once the press is over, so the click
  // opens the row that was pressed (watched failing with the list given at
  // once: shown while the pointer was down).
  test('gives AG Grid a list between presses, never during one', async () => {
    const { api } = grid(3)
    const shown = list()
    const coming = list()
    const { result, rerender } = renderHook(({ source }) => useHeldRows(api, source, quiet), { initialProps: { source: shown.source } })
    act(() => result.current.press(true))
    rerender({ source: coming.source })
    await coming.answer('ready')
    expect(result.current.source).toBe(shown.source)
    await act(async () => {
      result.current.press(false)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.source).toBe(coming.source)
  })

  // A save or a delete while a new list is on its way lists that list
  // again, so what is drawn once it answers is what was saved -- not the
  // list shown, whose rows are answered from the screen under the new
  // list's sort (watched failing with a reload left to AG Grid: the list on
  // its way asked once, before the save).
  test('asks a list on its way again for a reload, not the list shown', async () => {
    const { api, purged } = grid(3)
    const shown = list()
    const coming = list()
    const { result, rerender } = renderHook(({ source }) => useHeldRows(api, source, quiet), { initialProps: { source: shown.source } })
    rerender({ source: coming.source })
    let routed = false
    act(() => {
      routed = result.current.reload()
    })
    expect({ routed, coming: coming.asked, shown: shown.asked, purged: purged() }).toEqual({ routed: true, coming: [0, 0], shown: [], purged: 0 })
    await coming.answer('dropped')
    await coming.answer('ready')
    expect(result.current.source).toBe(coming.source)
  })
})
