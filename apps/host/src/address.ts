import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { FormMenuEntry } from '@formancy/data-client'
import type { Guard } from './guard.js'
import { fragmentOf, readFragment } from './layout.js'
import type { Place } from './layout.js'

/*
 * The workspace's history (0047): the entries the page writes, and Back,
 * Forward and a fragment typed into the address bar as requests.
 *
 * Every entry the page writes carries a mark in `history.state`: its count
 * -- an id of its own, new for each sign-in -- and its number in that count,
 * one more for each entry pushed. Within one count the numbers follow the
 * entries' order, so a pop onto one of them says whether Back or Forward was
 * pressed and how far, and Keep editing goes the same distance the other
 * way. An entry with no mark -- typed into the address bar -- or with
 * another count's -- an earlier sign-in's, which Sign out and a reload keep
 * in the history -- says neither: it is asked about as an address, and when
 * the page takes over an earlier count's entry it starts a new count there,
 * since nothing says where the old count's entries are from it.
 */

/** What the page writes into `history.state`. */
interface Mark {
  count: string
  entry: number
}

/** Where the browser is: on one of this count's entries, by number; on one with no mark; or on another count's. */
type At = number | 'typed' | 'foreign'

/** A count's id: unguessable is not the point, only that two sign-ins never share one. */
function newCount(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function markOf(state: unknown): Mark | null {
  if (typeof state !== 'object' || state === null) return null
  const { count, entry } = state as Partial<Mark>
  return typeof count === 'string' && typeof entry === 'number' ? { count, entry } : null
}

export interface History {
  /** The page's state into the address: pushed as a new entry, or written over the one the browser is on. */
  write(place: Place, push: boolean): void
  count: RefObject<string>
  /** The number of the page's own entry in its count. */
  entry: RefObject<number>
  at: RefObject<At>
}

export function useHistory(): History {
  const count = useRef(newCount())
  const entry = useRef(0)
  const at = useRef<At>(0)
  const write = useCallback((place: Place, push: boolean) => {
    const url = `${window.location.pathname}${window.location.search}${fragmentOf(place)}`
    if (push) entry.current += 1
    const mark: Mark = { count: count.current, entry: entry.current }
    if (push) window.history.pushState(mark, '', url)
    else window.history.replaceState(mark, '', url)
    at.current = entry.current
  }, [])
  return useMemo(() => ({ write, count, entry, at }), [write])
}

/**
 * Back, Forward and a fragment typed into the address bar, as requests:
 * another form goes through the guard; Back or Forward between the views of
 * Separate views changes the view, and the number returned grows each time,
 * so the form moves the keyboard to what the view shows; anything else is
 * written over with the page's own address. The hashchange that follows a
 * popstate is not a second request.
 *
 * Kept editing -- or replaced by another request while it waits -- Back or
 * Forward is undone by going the same distance the other way, so the history
 * keeps the entry the person left; an address the page did not write is
 * written over with the page's own, or, after an earlier sign-in's entry,
 * pushed after it under a new count.
 */
export function useAddressRequests({
  guard,
  ids,
  menuEntry,
  openForm,
  setPlace,
  placeRef,
  history,
}: {
  guard: Guard
  ids: readonly string[]
  menuEntry: (id: string) => FormMenuEntry | undefined
  openForm: (id: string, how: { focus: boolean; push: boolean }) => Promise<void>
  setPlace: (place: Place) => void
  placeRef: RefObject<Place>
  history: History
}): number {
  const [historyView, setHistoryView] = useState(0)
  /** The fragment a popstate already handled, so the hashchange that follows it is not a second request. */
  const handled = useRef<string | null>(null)
  /** Which of this hook's requests waits for the person, if any; 0 when none does. */
  const waitingFor = useRef(0)
  const asked = useRef(0)
  /** True while an arrival asks: the request it replaces leaves the address to it. */
  const arriving = useRef(false)

  useEffect(() => {
    const { count, entry, at, write } = history

    /** The browser back on the page's own entry. */
    const restore = (): void => {
      const here = at.current
      if (typeof here === 'number') {
        const by = entry.current - here
        at.current = entry.current
        if (by !== 0) window.history.go(by)
        return
      }
      if (here === 'foreign') count.current = newCount()
      write(placeRef.current, here === 'foreign')
    }

    /** The entry the browser is on becomes the page's. Whether the page's state is then pushed after it: only after a typed address. */
    const takeOver = (): boolean => {
      const here = at.current
      if (typeof here === 'number') entry.current = here
      else if (here === 'foreign') count.current = newCount()
      return here === 'typed'
    }

    const arrived = (state: unknown): void => {
      handled.current = window.location.hash
      const asks = readFragment(window.location.hash)
      const now = placeRef.current
      const mark = markOf(state)
      const number = mark !== null && mark.count === count.current ? mark.entry : null
      at.current = number ?? (mark === null ? 'typed' : 'foreign')
      // Back on the page's own entry: after Keep editing went there, or
      // Forward after Back while the question waits, which answers it.
      if (number === entry.current) {
        if (waitingFor.current !== 0) guard.keep()
        return
      }
      if (asks.form !== null && asks.form !== now.form && ids.includes(asks.form)) {
        const target = asks.form
        const request = number === null ? ({ kind: 'form', title: menuEntry(target)?.title ?? target } as const) : ({ kind: 'history', direction: number < entry.current ? 'back' : 'forward' } as const)
        asked.current += 1
        const mine = asked.current
        const settled = (): void => {
          if (waitingFor.current === mine) waitingFor.current = 0
        }
        waitingFor.current = mine
        arriving.current = true
        try {
          guard.ask(
            request,
            () => {
              settled()
              void openForm(target, { focus: true, push: takeOver() })
            },
            () => {},
            () => {
              settled()
              if (!arriving.current) restore()
            },
          )
        } finally {
          arriving.current = false
        }
        return
      }
      // A view of Separate views, by Back or Forward between the page's own
      // entries; an address the page did not write moves no view.
      if (number !== null && asks.view !== null && asks.view !== now.view && now.layout === 'separate' && asks.form === now.form) {
        entry.current = number
        setPlace({ ...now, view: asks.view })
        setHistoryView((n) => n + 1)
        return
      }
      // Nothing the page does: its own address back -- over an earlier
      // sign-in's entry, taken over in place under a new count.
      if (at.current === 'foreign') {
        count.current = newCount()
        write(now, false)
      } else restore()
    }
    const popped = (event: PopStateEvent): void => arrived(event.state)
    const changed = (): void => {
      if (window.location.hash !== handled.current) arrived(null)
    }
    window.addEventListener('popstate', popped)
    window.addEventListener('hashchange', changed)
    return () => {
      window.removeEventListener('popstate', popped)
      window.removeEventListener('hashchange', changed)
    }
  }, [guard, ids, menuEntry, openForm, setPlace, placeRef, history])
  return historyView
}
