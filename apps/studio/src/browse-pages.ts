import { useRef, useState } from 'react'
import { describeRef } from './choice.js'
import type { BrowseEqualTerm, BrowseFilterTerm, BrowseSortTerm, ObjectRef } from '@formancy/data-core'
import type { BrowseAnswer } from '@formancy/data-server'

/*
 * How the Browse step asks for its pages (0099, 0147): one at a time, and a
 * press made while one is on its way is not dropped. It is sent once that
 * page has settled, on the page as it then stands -- the one that arrived,
 * or the one on screen where it was refused -- and a further press while it
 * waits builds on it, the latest sent last: a box left and then Clear the
 * filter is the box's condition and then none. A press that no longer
 * applies where the page then stands -- a box, a sort or a follow of a page
 * a move is leaving -- is dropped, as a press on a page already gone would
 * be.
 */

/** What a page asks for, so the next and previous pages, a sort and a Back ask for the same object, values, filter and search. */
export interface Asked {
  object: ObjectRef
  /** The columns and values the page is narrowed to: a follow's (0103), and `[]` for a page Show rows asked for. */
  equal: BrowseEqualTerm[]
  /** The person's own conditions on the page's columns (0104): `[]` for a page Show rows or a follow asked for. */
  filter: BrowseFilterTerm[]
  search: string
  sort: BrowseSortTerm | null
  offset: number
}

/** A page as it stands or will: what it asks for, and the pages the follows on the way to it left, the last one first back. */
export interface Place {
  asked: Asked
  trail: Asked[]
}

/**
 * What a press makes of the page as it will stand, and whether it moves --
 * `moved`, the selector, the search box and the keyboard going with it to
 * the page reached -- or null where it no longer applies there. A press
 * that is no move keeps the trail and the filter's views as they are.
 */
export type Build = (base: Place | null) => { place: Place; move: { moved: boolean } | null } | null

/** What a press asks for: its build, and what happens once its page has arrived. */
export interface Press {
  /** What takes the keyboard once the page has arrived. */
  focus?: string | null
  /** Runs in the render that shows the page. */
  arrived?: () => void
  /** The header box whose press this is, which owns a refusal of it until the box changes (0147). */
  owner?: string | null
}

interface Wanted {
  build: Build
  focus: string | null
  arrived: Array<() => void>
  settled: Array<(arrived: boolean) => void>
  owner: string | null
}

/** Whether two asks are of one page: one object, narrowed to the same values, whatever its filter, sort or offset. */
export const samePage = (a: Asked, b: Asked): boolean => describeRef(a.object) === describeRef(b.object) && JSON.stringify(a.equal) === JSON.stringify(b.equal)

/** `later` built on what `earlier` makes: both presses, the later's keyboard and owner, every one's arrival and settling. */
function joined(earlier: Wanted, later: Wanted): Wanted {
  return {
    build: (base) => {
      const first = earlier.build(base)
      const second = later.build(first?.place ?? base)
      return second === null ? first : { place: second.place, move: second.move ?? first?.move ?? null }
    },
    focus: later.focus ?? earlier.focus,
    arrived: [...earlier.arrived, ...later.arrived],
    settled: [...earlier.settled, ...later.settled],
    owner: later.owner ?? earlier.owner,
  }
}

/** What the step does with what a page asked: shows it, or says the server's refusal. */
export interface Heard {
  /** A page is asked for: a refusal no box owns is said no longer. */
  asking: () => void
  arrived: (place: Place, move: { moved: boolean } | null, answer: BrowseAnswer, press: { focus: string | null; arrived: Array<() => void> }) => void
  refused: (message: string, owner: string | null) => void
}

export interface Pages {
  /** Asks for what `build` makes, now or once the page on its way has settled; answers whether its page arrived. */
  ask: (build: Build, press?: Press) => Promise<boolean>
  /** The page as it will stand once every press made has been answered; null while none is on its way. */
  ahead: Place | null
}

export function usePages(answer: (asked: Asked) => Promise<{ ok: true; value: BrowseAnswer } | { ok: false; message: string }>, heard: Heard): Pages {
  // The page on screen, the one on its way and the press waiting for it: read and written outside React's renders.
  const at = useRef<Place | null>(null)
  const flight = useRef<Place | null>(null)
  const waiting = useRef<Wanted | null>(null)
  const [ahead, setAhead] = useState<Place | null>(null)
  const latest = useRef({ answer, heard })
  latest.current = { answer, heard }

  async function send(wanted: Wanted): Promise<void> {
    const built = wanted.build(at.current)
    if (built === null) {
      for (const settle of wanted.settled) settle(false)
      setAhead(null)
      return
    }
    flight.current = built.place
    setAhead(built.place)
    latest.current.heard.asking()
    const outcome = await latest.current.answer(built.place.asked)
    flight.current = null
    if (outcome.ok) {
      at.current = built.place
      latest.current.heard.arrived(built.place, built.move, outcome.value, wanted)
    } else latest.current.heard.refused(outcome.message, wanted.owner)
    for (const settle of wanted.settled) settle(outcome.ok)
    const next = waiting.current
    waiting.current = null
    if (next === null) setAhead(null)
    else await send(next)
  }

  function ask(build: Build, press: Press = {}): Promise<boolean> {
    return new Promise((settle) => {
      const wanted: Wanted = {
        build,
        focus: press.focus ?? null,
        arrived: press.arrived === undefined ? [] : [press.arrived],
        settled: [settle],
        owner: press.owner ?? null,
      }
      if (flight.current === null) {
        void send(wanted)
        return
      }
      waiting.current = waiting.current === null ? wanted : joined(waiting.current, wanted)
      setAhead(waiting.current.build(flight.current)?.place ?? flight.current)
    })
  }

  return { ask, ahead }
}
