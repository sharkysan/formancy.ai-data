import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { DataClient, PublishedForm } from '@formancy/data-client'
import type { ChildForm } from './children.js'
import { recordName } from './crumbs.js'
import type { Demo } from './demo-tools.js'
import type { MasterOpen } from './detail.js'
import { copiedLine, copyOf, leftOut } from './duplicate.js'
import { useGuardContext } from './guard.js'
import type { Said } from './leave.js'
import { useMasterPanes } from './master-panes.js'
import type { SaveFrom } from './pane-reach.js'
import { isOpen, nextLine, nextOf } from './next-version.js'
import type { Opening } from './opening.js'
import type { OpenHow, RecordGridHandle, RowAt } from './record-grid.js'
import { useTabStart } from './record-tabs.js'
import type { SaveSet } from './save-set.js'
import type { SaveResult, Session } from './session.js'

/*
 * What the record's detail holds on an open form (0047) -- a record by its
 * token, the next version of one (0115), a new record, or nothing -- and
 * every way the page changes it: a row of the grid or of the tree (0110)
 * opened through the guard, New, Duplicate record (0107), Change from a
 * date (0115), Load, a save one of its panes answered, and the record
 * gone from the page. With it, what the detail says of what it holds: its
 * line, a Load's refusal, what the crumb calls the record, and the
 * record's answers as stored, which its sections' conditions read (0109).
 *
 * A read answers late, as opening.ts decides for every detail, and the
 * record's own forms are made in master-panes.ts. Where the form shows
 * the detail, and which Drill down levels go when the detail holds
 * something else, are the form's (form-view.tsx): `toDetail` and
 * `dropLevels`. Kept out of form-view.tsx, which draws the form and its
 * lanes, as what changes when the way a record opens or is answered does.
 */

export const DISCARDED: Said = ['Discarded the unsaved changes. ']

export interface MasterRecordOptions {
  client: DataClient
  formId: string
  definition: PublishedForm
  /** The form's title, which names the record. */
  title: string
  childForms: readonly ChildForm[]
  /** Both renderers are shown: the line speaks of both forms. */
  both: boolean
  /** The form is in Drill down, where every open goes down a level: a click and Space too (0090). */
  drilling: boolean
  grid: RefObject<RecordGridHandle | null>
  /** The form's way to act once the page has rendered (after-render.ts). */
  after: (action: () => void) => void
  /** The demo's controls, shown where a Load is refused (0146). */
  demo: Demo
  /** The detail shown, with the keyboard on its heading. */
  toDetail: () => void
  /** The detail holds something else now: every Drill down level below the record is dropped (use-drill.ts). */
  dropLevels: () => void
}

export interface MasterRecord {
  open: MasterOpen
  /** What the detail holds as of its last change, for a callback or an effect to read where a render's `open` may be stale. */
  openRef: RefObject<MasterOpen>
  /** The detail's line: what the page last did with what it holds, or refused. */
  line: { said: Said; kind: 'answer' | 'refused' }
  say: (said: Said, kind?: 'answer' | 'refused') => void
  /** What a Load was refused with, said in the demo's controls. */
  loadRefusal: string | null
  /** What the record's crumb calls it, from what is stored (crumbs.ts). */
  name: string | null
  /** The open record's answers as stored -- as read, or as its last save left them -- which a section's condition is read from (0109); null for a new record. */
  stored: Readonly<Record<string, unknown>> | null
  /** What the record's tabs start from (record-tabs.tsx's `useTabStart`). */
  tabStart: unknown
  saveSet: SaveSet
  sessions: Session[]
  opening: Opening
  /** The buttons that ask for another record -- New, Load, Duplicate record and Change from a date -- which the keyboard goes back to when the person keeps editing. */
  newRef: RefObject<HTMLButtonElement | null>
  loadRef: RefObject<HTMLButtonElement | null>
  duplicateRef: RefObject<HTMLButtonElement | null>
  changeRef: RefObject<HTMLButtonElement | null>
  /** The form offers this person a copy (0107): Duplicate record. */
  canDuplicate: boolean
  /** The open record is an open version this person may change from a date (0115). */
  canChange: boolean
  /** A row of the grid asked for, and the keyboard back on its cell where the person keeps editing; `then`, once it is open -- F2's edit of it (0179). */
  askRow: (token: string, how: OpenHow, at: RowAt, then?: () => void) => void
  /** A record opened from the grid or the tree (0110), through the guard; `toRow` gives the keyboard back to where it was opened from; `then`, once it is open. */
  openFrom: (token: string, how: OpenHow, toRow: () => void, then?: () => void) => void
  startNew: () => void
  /** Duplicate record (0107), or Change from a date (0115). */
  startCopy: (kind: 'duplicate' | 'change') => void
  load: (token: string) => void
  /** A save the server answered in one of the record's panes: from its Save, or from the grid leaving the record's row (0179). */
  answered: (result: SaveResult, session: Session, from?: SaveFrom) => void
  /** What the crumb calls the record, and what its sections' conditions read, from what `session` holds as stored. */
  storedIn: (session: Session) => void
  /** A pane's "Load the saved record". */
  loadedSaved: (session: Session) => void
  /** `token` closed where it is the open record: its forms emptied (0053, 0174). */
  close: (token: string) => void
}

export function useMasterRecord({
  client,
  formId,
  definition,
  title,
  childForms,
  both,
  drilling,
  grid,
  after,
  demo,
  toDetail,
  dropLevels,
}: MasterRecordOptions): MasterRecord {
  const { ask } = useGuardContext()
  const newRef = useRef<HTMLButtonElement>(null)
  const loadRef = useRef<HTMLButtonElement>(null)
  const duplicateRef = useRef<HTMLButtonElement>(null)
  const changeRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<MasterOpen>(null)
  const openRef = useRef<MasterOpen>(null)
  openRef.current = open
  const tabs = useTabStart(open)
  const [line, setLine] = useState<{ said: Said; kind: 'answer' | 'refused' }>({ said: [], kind: 'answer' })
  const [loadRefusal, setLoadRefusal] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [stored, setStored] = useState<Readonly<Record<string, unknown>> | null>(null)
  /** What a copy carries (0107): `null` from the server where it offers no create, and then no Duplicate record. */
  const copied = definition.copied ?? []
  /** Where a version may be changed from a date (0113): the fields it starts and ends at, and the chain's key; else null. */
  const versions = definition.versions
  const { saveSet, sessions, opening } = useMasterPanes({ client, formId, definition, title, childForms, open: openRef })
  const nameOf = (session: Session): string | null => recordName(definition.form.model.fields, session.saved().answers, null)
  const say = (said: Said, kind: 'answer' | 'refused' = 'answer'): void => setLine({ said, kind })

  /** The record now open in every pane, and what the detail's line says of it, if anything. */
  function opened(token: string, said?: Said): void {
    dropLevels()
    setOpen({ kind: 'record', token })
    setName(sessions[0] === undefined ? null : nameOf(sessions[0]))
    setStored(sessions[0]?.saved().answers ?? null)
    setLoadRefusal(null)
    if (said !== undefined) say(said)
  }

  function askRow(token: string, how: OpenHow, at: RowAt, then?: () => void): void {
    openFrom(token, how, () => grid.current?.focusAt(at), then)
  }

  function openFrom(token: string, how: OpenHow, toRow: () => void, then?: () => void): void {
    // In Drill down every open goes down a level: a click and Space too (0090).
    const moves = how === 'enter' || drilling
    if (openRef.current?.kind === 'record' && openRef.current.token === token) {
      if (moves) toDetail()
      then?.()
      return
    }
    const request = { kind: 'row', record: token } as const
    ask(
      request,
      (discarded) =>
        opening.read(request, token, discarded, {
          opened: (now) => {
            opened(now.token, [...(now.discarded ? DISCARDED : []), 'Opened ', { code: token }, '.'])
            if (moves) toDetail()
            else if (now.discarded) after(toRow)
            if (then !== undefined) after(then)
          },
          refused: (message, dropped) => {
            say([message], 'refused')
            if (dropped) after(toRow)
          },
          back: toRow,
        }),
      toRow,
    )
  }

  function startNew(): void {
    ask(
      { kind: 'new' },
      (discarded) => {
        opening.replaced()
        dropLevels()
        for (const session of sessions) session.open()
        setOpen({ kind: 'new' })
        setName(null)
        setStored(null)
        setLoadRefusal(null)
        say([...(discarded ? DISCARDED : []), both ? 'Both forms are empty, for a new record.' : 'The form is empty, for a new record.'])
        toDetail()
      },
      () => newRef.current?.focus(),
    )
  }

  /**
   * Duplicate record (0107): the open record read again, and every pane
   * opened on a copy of it as a new record -- the answers the server names,
   * no token, no version -- after asking, as New does, about work the
   * detail holds. The line says what was copied and what was not. Change
   * from a date (0115) is the same read, every pane opened on the next
   * version of the open one, which its save ends.
   */
  function startCopy(kind: 'duplicate' | 'change'): void {
    const now = openRef.current
    if (now?.kind !== 'record' || (kind === 'change' && versions === null)) return
    const request = { kind, record: now.token } as const
    const back = (): void => (kind === 'duplicate' ? duplicateRef : changeRef).current?.focus()
    ask(
      request,
      (discarded) =>
        opening.read(
          request,
          now.token,
          discarded,
          {
            opened: (done, record) => {
              dropLevels()
              setOpen(kind === 'duplicate' ? { kind: 'new' } : { kind: 'next', of: done.token })
              setName(null)
              setStored(null)
              setLoadRefusal(null)
              const line =
                kind === 'duplicate' ? copiedLine(done.token, leftOut(definition.form.model.fields, record, copied), both) : nextLine(done.token, both)
              say([...(done.discarded ? DISCARDED : []), ...line])
              toDetail()
            },
            refused: (message) => say([message], 'refused'),
            back,
          },
          (record) => (kind === 'duplicate' || versions === null ? copyOf(record, copied) : nextOf(record, versions)),
          (record) => (kind === 'change' && record.record !== null && record.version !== null ? { record: record.record, version: record.version } : undefined),
        ),
      back,
    )
  }

  function load(token: string): void {
    setLoadRefusal(null)
    const request = { kind: 'load', record: token } as const
    const toLoad = (): void => loadRef.current?.focus()
    ask(
      request,
      (discarded) =>
        opening.read(request, token, discarded, {
          opened: (now) =>
            opened(now.token, [...(now.discarded ? DISCARDED : []), 'Loaded record ', { code: token }, both ? ' into both forms.' : ' into the form.']),
          refused: (message) => {
            setLoadRefusal(message)
            demo.reveal()
          },
          back: toLoad,
        }),
      toLoad,
    )
  }

  /**
   * The grid shows what is stored, and a created record is the detail's
   * (opening.ts). A save from the grid leaving the record's row reads no
   * page: its row takes what is stored in place, so no row moves under the
   * keyboard (use-grid-edit.ts, 0179).
   */
  function answered(result: SaveResult, session: Session, from: SaveFrom = 'form'): void {
    if (from === 'form') grid.current?.reload()
    opening.answered(result, session, (now) => {
      tabs.created()
      opened(now.token, now.discarded ? [...DISCARDED, 'Opened ', { code: now.token }, '.'] : undefined)
    })
    if (result.kind === 'saved') storedIn(session)
  }

  function storedIn(session: Session): void {
    setName(nameOf(session))
    setStored(session.saved().answers)
  }

  /** The grid and the crumb say what is stored, as after a save. */
  function loadedSaved(session: Session): void {
    grid.current?.reload()
    storedIn(session)
  }

  function close(token: string): void {
    const now = openRef.current
    if (now?.kind !== 'record' || now.token !== token) return
    opening.replaced()
    dropLevels()
    for (const session of sessions) session.open()
    openRef.current = null
    setOpen(null)
    setLoadRefusal(null)
    say([])
  }

  return {
    open,
    openRef,
    line,
    say,
    loadRefusal,
    name,
    stored,
    tabStart: tabs.start,
    saveSet,
    sessions,
    opening,
    newRef,
    loadRef,
    duplicateRef,
    changeRef,
    canDuplicate: copied.length > 0,
    canChange: open?.kind === 'record' && isOpen(stored, versions),
    askRow,
    openFrom,
    startNew,
    startCopy,
    load,
    answered,
    storedIn,
    loadedSaved,
    close,
  }
}
