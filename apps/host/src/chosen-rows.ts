import { useMemo, useSyncExternalStore } from 'react'
import type { GridRow } from './grid-datasource.js'
import { listed } from './grid-datasource.js'
import { counted } from './running.js'
import type { RunRecord } from './running.js'
import type { SessionState } from './session.js'

/*
 * The records a person chose of the page a grid shows, for an action over
 * a selection (0165, 0166). The grid's own selection is the open row
 * (`singleRow`, 0047), so the choice is the page's, kept here and drawn
 * by a column of checkboxes (choose-column.tsx).
 *
 * - **Of the page shown.** A choice is made on one page of one list --
 *   the list a search, a filter, a sort or a view asks for, and the page
 *   of it the grid draws -- since a run is over one page at most (0165).
 *   A page of another list, or another page of this one, drawn in its
 *   place clears it, and says so; a page drawn again in its place -- after
 *   a save, a delete or Ask again -- keeps it, each record at the version
 *   that read gave it, and a record no longer on it is no longer chosen,
 *   which is said too.
 * - **At the version read.** A chosen record is sent at the version the
 *   page read it at, or, where the detail heard a newer one since -- the
 *   person saved the open record -- at that one (`heard`): either is the
 *   latest this page knows, by when it arrived. A form tells what it holds
 *   each time a save is sent too, at the version it was opened at, which
 *   is nothing new: only a version a form did not hold before is heard
 *   (`hearForms`), as a delete hears one (delete-flow.ts's `useHeard`).
 * - **In the page's order**, whatever order the boxes were ticked in: the
 *   order a run sends, and a refusal names, the records in.
 */

/** The list a page was drawn from, by identity: the grid's datasource for one search, filter and sort. */
export type ListIdentity = object

/** What the bar says of the choice now, and which records are chosen. */
export interface ChoiceNow {
  chosen: ReadonlySet<string>
  /** The status line's sentence: how many are chosen, or what cleared them. */
  said: string
  /** How many times it was said: each saying a new one, so a sentence said again is heard again (selection-bar.tsx). */
  count: number
}

/** The choice of one grid's page, which the column draws and an action over a selection runs over. */
export interface ChosenRows {
  subscribe: (listener: () => void) => () => void
  now: () => ChoiceNow
  /** How a chosen record is named, in the words a row's Delete names it with: "Order k1:7". */
  name: (token: string) => string
  /** A page the grid drew: of `list`, from row `start`. */
  page: (list: ListIdentity, start: number, rows: readonly GridRow[]) => void
  /** A record's version the detail heard, by a save or a read: the version it is sent at where it is chosen. */
  heard: (record: string, version: string) => void
  /** A row's box pressed: chosen, or no longer. A row with no token or no version cannot be addressed, and is not. */
  toggle: (row: GridRow) => void
  /** Choose every record on this page. */
  all: () => void
  /** Clear the choice: `said`, what the line says then, where it is not how many are chosen. */
  clear: (said?: string) => void
  /** The records chosen, in the page's order, each at its version now. */
  records: () => RunRecord[]
  /** A record's version now, where it is on the page: as the page read it, or as the detail heard it since. */
  version: (token: string) => string | null
}

/** What the line says while nothing is chosen. */
export const NONE_CHOSEN = 'Nothing chosen.'

/** "3 chosen." */
export const chosenText = (n: number): string => (n === 0 ? NONE_CHOSEN : `${String(n)} chosen.`)

/** What the line says when a page of another list, or another page, cleared a choice: a choice is of the page shown (0166). */
export const clearedText = (n: number): string => `The choice of ${counted(n)} was cleared: a choice is of the page shown. ${NONE_CHOSEN}`

/** A row that can be chosen: one a run could address, by its token at a version. */
const addressable = (row: GridRow): row is GridRow & { record: string; version: string } => row.record !== null && row.version !== null

export function createChosenRows(noun: string): ChosenRows {
  const listeners = new Set<() => void>()
  /** The page the choice is of, and its rows as drawn last, each version as last heard. */
  let shown: { list: ListIdentity; start: number; rows: Array<{ record: string; version: string }> } | null = null
  let chosen = new Set<string>()
  let state: ChoiceNow = { chosen, said: NONE_CHOSEN, count: 0 }
  const name = (token: string): string => `${noun} ${token}`

  function set(next: Set<string>, said = chosenText(next.size)): void {
    chosen = next
    state = { chosen, said, count: state.count + 1 }
    for (const listener of listeners) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    now: () => state,
    name,
    page(list, start, rows) {
      const drawn = rows.filter(addressable).map(({ record, version }) => ({ record, version }))
      const same = shown !== null && shown.list === list && shown.start === start
      shown = { list, start, rows: drawn }
      if (chosen.size === 0) return
      if (!same) {
        set(new Set(), clearedText(chosen.size))
        return
      }
      const on = new Set(drawn.map((row) => row.record))
      const gone = [...chosen].filter((token) => !on.has(token))
      if (gone.length === 0) return
      const kept = new Set([...chosen].filter((token) => on.has(token)))
      set(kept, `${listed(gone.map(name))} ${gone.length === 1 ? 'is' : 'are'} no longer on this page, so not chosen. ${chosenText(kept.size)}`)
    },
    heard(record, version) {
      const row = shown?.rows.find((each) => each.record === record)
      if (row !== undefined) row.version = version
    },
    toggle(row) {
      if (!addressable(row) || shown?.rows.some((each) => each.record === row.record) !== true) return
      const next = new Set(chosen)
      if (next.has(row.record)) next.delete(row.record)
      else next.add(row.record)
      set(next)
    },
    all() {
      set(new Set(shown?.rows.map((row) => row.record) ?? []))
    },
    clear(said) {
      set(new Set(), said)
    },
    records: () => (shown?.rows ?? []).filter((row) => chosen.has(row.record)).map(({ record, version }) => ({ record, version })),
    version: (token) => shown?.rows.find((row) => row.record === token)?.version ?? null,
  }
}

/** What the choice hears of one of the record's forms: what it tells, and what it holds as it tells it (session.ts). */
export interface HeardForm {
  subscribe: (listener: () => void) => () => void
  state: () => Pick<SessionState, 'record' | 'version'>
}

/**
 * What the record's forms hear, the choice hears too (0166): a version of
 * the open record one of them did not hold before -- a read, a save
 * answered -- moves the version it is sent at where it is chosen. A form
 * telling again what it holds, as it does when a save is sent, is not
 * heard: it would put back a version older than one the page read since.
 * The listeners' removal is returned.
 */
export function hearForms(chosen: Pick<ChosenRows, 'heard'>, sessions: readonly HeardForm[]): () => void {
  const seen = new Map<object, string>()
  const offs = sessions.map((session) =>
    session.subscribe(() => {
      const { record, version } = session.state()
      const at = `${String(record)} ${String(version)}`
      if (seen.get(session) === at) return
      seen.set(session, at)
      if (record !== undefined && version !== undefined) chosen.heard(record, version)
    }),
  )
  return () => {
    for (const off of offs) off()
  }
}

/** A grid's choice, made once for its form's records, and what it says now, drawn again whenever that changes. */
export function useChosenRows(noun: string): { rows: ChosenRows; now: ChoiceNow } {
  const rows = useMemo(() => createChosenRows(noun), [noun])
  const now = useSyncExternalStore(rows.subscribe, rows.now)
  return { rows, now }
}
