import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { LIST_PAGE_SIZE } from '@formancy/data-client'
import { CANNOT_OPEN, loading, REFUSED_FILTER_HELP, STANDING_HELP, STARTED_AGAIN } from './grid-datasource.js'
import type { Said } from './leave.js'
import type { Status } from './pager.js'

/*
 * What a record grid's line says, and which page its pager is on
 * (pager.tsx): a page asked for, answered or refused, each in the
 * sentences grid-datasource.ts makes. What the server answered is said in
 * the room's teal for a moment, a page's own sentence not (0146). A page
 * asked for first, while the rows on screen stay (use-held-rows.ts),
 * leaves the pager on their page, and one AG Grid was not moved to puts
 * back what the line said before it was asked.
 *
 * A record gone from the grid (0053) -- deleted, or not found by a delete
 * and closed -- is said once, before the sentence of the page asked for
 * again, and so is a list started again at its first page because the row
 * it came after is gone (0108).
 *
 * A filter the server refuses is said in the server's sentence with what
 * to do instead of Ask again, which would be refused the same; a new list
 * refused that stands says the rows shown are the list before. Ask again
 * keeps the keyboard until its answer, and asks once however often it is
 * pressed.
 *
 * A child's first page asked because its parent changed says nothing: the
 * parent's line has just said it.
 */

/** Where a grid's pager is: the page shown, and whether rows follow it. */
export interface PagerAt {
  page: number
  hasMore: boolean
}

/** How a grid changes its line: the same functions for the grid's life, so the hooks and the options made once with them keep them. */
export interface LineSays {
  /** A page asked for, rows `start` to `end`; `ahead`, asked before AG Grid is shown it, while the rows on screen stay (0146). */
  loading(start: number, end: number, ahead: boolean): void
  /** A page answered from `start` in the sentence `said`: true where it is Ask again's answer and the keyboard is still on Ask again. */
  answered(start: number, said: { text: string; help: string | null; clear: boolean }, hasMore: boolean): boolean
  /** A page refused, in the server's sentence and its code; `stands`, a new list refused over the last list's rows. */
  refused(message: string, code: string, ahead: boolean, stands: boolean): void
  /** The list starts again at its first page (0108): said before that page's sentence. */
  restart(): void
  /** A record gone from the grid (0053): said once, before the next page's sentence. */
  removed(said: Said): void
  /** A sentence of the page's own, until the next answer. */
  say(said: Said): void
  /** A row asked for that has no token. */
  cannotOpen(): void
  /** A page asked first that AG Grid was not moved to: the wait is over, and the line says what it said before the ask. */
  stuck(): void
  /** Ask again pressed: false where it is asking already. */
  askAgain(): boolean
}

export interface GridLine {
  status: Status
  pager: PagerAt
  /** Ask again pressed and its answer not come. */
  asking: boolean
  /** Ask again's button, where the keyboard stays until the answer. */
  retryRef: RefObject<HTMLButtonElement | null>
  line: LineSays
}

export function useGridLine({
  quiet,
  parent,
  noun,
}: {
  /** The first page is asked for without a word, and so is the first after each change of `parent`. */
  quiet: boolean
  /** The record a child grid lists the rows of. */
  parent: string | null | undefined
  /** A child grid's title: its sentences name its rows. */
  noun: string | undefined
}): GridLine {
  const [status, setStatus] = useState<Status>(() => ({
    kind: 'loading',
    text: [quiet ? '' : loading(0, LIST_PAGE_SIZE, noun)],
    help: null,
    clear: false,
    retry: false,
    said: null,
  }))
  const [pager, setPager] = useState<PagerAt>({ page: 0, hasMore: false })
  /** The title, read when a page is asked for. */
  const nounNow = useRef(noun)
  nounNow.current = noun
  /** How many times the line has said what the server answered: each time, its words are drawn in teal anew. */
  const answers = useRef(0)
  /** The line as it is, and as it was when a page was asked first: said again where AG Grid is not moved to that page. */
  const statusNow = useRef(status)
  statusNow.current = status
  const beforeAsk = useRef<Status | null>(null)
  /** What a record gone from the grid says before the next page's sentence, once. */
  const removedLine = useRef<Said | null>(null)
  /** The next page asked for says nothing. */
  const quietNext = useRef(quiet)
  /** Ask again pressed and its answer not come. */
  const retrying = useRef(false)
  const retryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // The parent changed: its line has spoken, and this one waits for the answer.
    if (quiet) quietNext.current = true
  }, [quiet, parent])

  const line = useMemo<LineSays>(() => {
    /** The sentence of a page, after the removal said first if there is one -- which it then is not again. */
    const first = (said: Said): Said => {
      const before = removedLine.current
      removedLine.current = null
      return before === null ? said : [...before, ' ', ...said]
    }
    return {
      loading: (start, end, ahead) => {
        // Asked first, the rows on screen stay, and so does the page they are on.
        if (ahead) beforeAsk.current = statusNow.current
        const words = quietNext.current ? '' : loading(start, end - start, nounNow.current)
        quietNext.current = false
        setStatus((before) => ({ kind: 'loading', text: [words], help: null, clear: false, retry: before.retry && retrying.current, said: null }))
        if (!ahead) setPager((before) => ({ ...before, page: Math.floor(start / LIST_PAGE_SIZE) }))
      },
      answered: (start, said, hasMore) => {
        const fromRetry = retrying.current && document.activeElement === retryRef.current
        retrying.current = false
        answers.current += 1
        setStatus({ kind: 'answer', text: first([said.text]), help: said.help, clear: said.clear, retry: false, said: answers.current })
        setPager({ page: Math.floor(start / LIST_PAGE_SIZE), hasMore })
        return fromRetry
      },
      refused: (message, code, ahead, stands) => {
        retrying.current = false
        // A filter the server cannot apply is refused again however often it is asked: its recovery is the condition.
        const filterRefused = code === 'not-filterable'
        setStatus({
          kind: 'refused',
          text: first([message]),
          help: filterRefused ? REFUSED_FILTER_HELP : stands ? STANDING_HELP : null,
          clear: false,
          retry: !filterRefused,
          said: null,
        })
        // Asked first, the pager is still the rows on screen's.
        if (!ahead) setPager((before) => ({ ...before, hasMore: false }))
      },
      restart: () => {
        retrying.current = false
        removedLine.current = [STARTED_AGAIN]
      },
      removed: (said) => {
        removedLine.current = said
      },
      say: (said) => {
        setStatus({ kind: 'answer', text: said, help: null, clear: false, retry: false, said: null })
      },
      cannotOpen: () => {
        setStatus({ kind: 'refused', text: [CANNOT_OPEN], help: null, clear: false, retry: false, said: null })
      },
      stuck: () => {
        if (beforeAsk.current !== null) setStatus(beforeAsk.current)
      },
      askAgain: () => {
        if (retrying.current) return false
        retrying.current = true
        setStatus((before) => ({ ...before, retry: true }))
        return true
      },
    }
  }, [])

  return { status, pager, asking: retrying.current, retryRef, line }
}
