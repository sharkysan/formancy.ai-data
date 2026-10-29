import { useRef } from 'react'
import type { DataClient, FormRecord } from '@formancy/data-client'
import { useGuardContext } from './guard.js'
import type { LeaveRequest } from './leave.js'
import type { SaveResult, Session } from './session.js'

/*
 * How a detail -- the record's (form-view.tsx) or a child section's
 * (children.tsx) -- changes the record its panes hold (0047), decided once
 * for both.
 *
 * - **A read answers late.** The guard is asked when the person asks; the
 *   record is opened when the server answers, and by then the person may
 *   have moved on. An answer for a request the detail has since replaced --
 *   another row, New, Load, a record created here -- is dropped, and so is
 *   one that arrives while the page waits for the person about something
 *   else. Otherwise the guard is asked again, so work typed while the read
 *   was out is asked about before anything opens over it.
 * - **A record created in one pane is the one the detail shows.** Every
 *   other pane is opened on it as it was stored -- after asking, when one
 *   holds work of its own -- so the heading, every pane and the children
 *   below name one record. Kept editing, nothing moves: the created record
 *   is in the pane that created it, and in the grid.
 */

/** What opening a record says it did: its token, and whether work was discarded for it. */
export interface Opened {
  token: string
  discarded: boolean
}

/** What a detail does around a read: once it opened -- with the record as read -- once the server refused it, and where the keyboard goes when the person keeps editing. */
export interface ReadHandlers {
  opened(opened: Opened, record: FormRecord): void
  refused(message: string, discarded: boolean): void
  back(): void
}

export interface Opening {
  /**
   * Read `token` for `request`, which the guard has already let through
   * (`discarded` says whether work was dropped for it), and open it in every
   * pane once it answers -- unless the detail was asked for something else
   * meanwhile. `as` makes what the panes open of the record read: Duplicate
   * record's copy of it (0107); the record itself otherwise.
   */
  read(request: LeaveRequest, token: string, discarded: boolean, then: ReadHandlers, as?: (record: FormRecord) => FormRecord): void
  /** A request that replaces what the detail shows without a read -- New: an answer still out is dropped. */
  replaced(): void
  /** A save one of the panes answered: a record it created is the detail's, and `opened` says so once the other panes hold it. */
  answered(result: SaveResult, from: Session, opened: (opened: Opened) => void): void
}

export function useOpening({ client, formId, owner, sessions }: { client: DataClient; formId: string; owner: string; sessions: readonly Session[] }): Opening {
  const guard = useGuardContext()
  // How many times the detail has been asked to show something else: an
  // answer for an earlier request is not the person's latest.
  const asked = useRef(0)

  function read(request: LeaveRequest, token: string, discarded: boolean, then: ReadHandlers, as: (record: FormRecord) => FormRecord = (record) => record): void {
    asked.current += 1
    const mine = asked.current
    void client.read(formId, token).then((answer) => {
      if (asked.current !== mine || guard.waiting()) return
      if (!answer.ok) {
        then.refused(answer.message, discarded)
        return
      }
      const record: FormRecord = answer.value
      // Asked again: the person may have typed while the read was out. A
      // request made while this question waits replaces it, so its answer
      // is always this read's. An answer's question: it closes nothing the
      // person may be answering meanwhile -- a delete's confirmation (0053).
      guard.askOnAnswer(
        request,
        (again) => {
          for (const session of sessions) session.open(structuredClone(as(record)))
          then.opened({ token: record.record ?? token, discarded: discarded || again }, record)
        },
        then.back,
      )
    })
  }

  function answered(result: SaveResult, from: Session, opened: (opened: Opened) => void): void {
    const record = from.saved()
    if (result.kind !== 'created' || record.record === null) return
    const token = record.record
    // The keyboard was where the save was pressed; Keep editing gives it back there.
    const at = document.activeElement
    guard.askOnAnswer(
      { kind: 'created', owner, record: token, by: from.renderer },
      (discarded) => {
        asked.current += 1
        for (const session of sessions) if (session !== from) session.open(from.saved())
        opened({ token, discarded })
      },
      () => {
        if (at instanceof HTMLElement && at.isConnected) at.focus()
      },
    )
  }

  return {
    read,
    replaced: () => {
      asked.current += 1
    },
    answered,
  }
}
