import type { KeyboardEvent, ReactElement } from 'react'
import type { Deleting } from '@formancy/data-client'
import type { ChosenDelete } from './chosen-delete-flow.js'
import { DISCARDED_WITH_THEM, heading, lead, lines, NONE_DELETED, notSent, summary } from './chosen-deletion.js'
import { DELETING, SAVE_OUT } from './deletion.js'
import { RENDERER_NAMES, WORK } from './leave.js'
import { ServerDid } from './server-did.js'
import { DECLINED_BY, RegionHeading, Words } from './words.js'

/*
 * A deletion of the records chosen (0174), in place under the bar above
 * the Records grid, with no overlay, as a delete's region is under what
 * asked (0053):
 *
 * - **confirming**: focused, headed by how many records it is over --
 *   "Delete 3 chosen Order records?" -- described by what deleting them
 *   does and also does, in the form's `deleting` words, and by the forms
 *   it drops; framed in the colour of what cannot be taken back. The next
 *   Tab reaches Keep them, so the keyboard is never put on the button that
 *   deletes; Escape is Keep them. While a save of the open record chosen
 *   is out, Delete them says so and waits; while the deletion is out, both
 *   answers say so and do nothing.
 * - **answered**: "Deleted 2 of 3 records." in the room's teal for a
 *   moment (0146) -- what the server did -- then each record not deleted,
 *   by the words a row's Delete names it with, in the server's words, and
 *   the records the request stopped before; the region the keyboard is
 *   taken to is described by all of it, so it is said as it lands. A record
 *   whose fate is not known offers Check them, and Close only once every
 *   fate is: the guard counts it until then.
 * - **refused**: the server's sentence verbatim, a reason the deployment
 *   worded said as its own (0156), and that none was deleted.
 *
 * Nothing here sends again: a deletion of the records left is a new
 * question, from the bar.
 */

/** The deletion's region under the bar; nothing while there is none. */
export function ChosenDeleteRegion({ flow, idBase }: { flow: ChosenDelete; idBase: string }): ReactElement | null {
  const now = flow.deletion
  if (now.state === 'idle' || flow.deleting === null) return null
  if (now.state === 'confirming' || now.state === 'sending') return <ChosenConfirm flow={flow} deleting={flow.deleting} idBase={idBase} />
  return <ChosenOutcome flow={flow} idBase={idBase} />
}

function ChosenConfirm({ flow, deleting, idBase }: { flow: ChosenDelete; deleting: Deleting; idBase: string }): ReactElement | null {
  const now = flow.deletion
  if (now.state !== 'confirming' && now.state !== 'sending') return null
  const sending = now.state === 'sending'
  const discards = now.state === 'confirming' ? now.discards : []
  const busy = sending ? 'true' : undefined
  // A save of the open record out, where it is chosen: Delete them waits for its answer, which moves the version it would name.
  const waits = !sending && flow.saving
  const escapes = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || sending) return
    event.preventDefault()
    flow.keep()
  }
  return (
    <div
      role="region"
      className="notice"
      data-kind="confirm"
      aria-labelledby={`${idBase}-heading`}
      aria-describedby={discards.length === 0 ? `${idBase}-lead` : `${idBase}-lead ${idBase}-list`}
      tabIndex={-1}
      ref={flow.regionRef}
      onKeyDown={escapes}
    >
      <RegionHeading level={4} id={`${idBase}-heading`}>
        {heading(now.target, true)}
      </RegionHeading>
      <div id={`${idBase}-lead`}>
        {lead(deleting, now.target.records.length).map((sentence) => (
          <p key={sentence} className="notice-text">
            {sentence}
          </p>
        ))}
        {discards.length === 0 ? null : <p className="notice-text">{DISCARDED_WITH_THEM}</p>}
      </div>
      {discards.length === 0 ? null : (
        <ul id={`${idBase}-list`} className="notice-list">
          {discards.map((pane) => (
            <li key={`${pane.owner} ${String(pane.renderer)}`}>
              <Words said={pane.name} />
              {pane.renderer === null ? '' : `, ${RENDERER_NAMES[pane.renderer]}`}: {pane.work === null ? '' : WORK[pane.work]}
            </li>
          ))}
        </ul>
      )}
      <p role="status" id={`${idBase}-status`} className="notice-text pending">
        {sending ? DELETING : waits ? SAVE_OUT : ''}
      </p>
      <div className="notice-actions delete-actions">
        <button type="button" className="button" aria-disabled={busy} onClick={() => (sending ? undefined : flow.keep())}>
          Keep them
        </button>
        <button
          type="button"
          className="button danger"
          aria-disabled={sending || waits ? 'true' : undefined}
          aria-describedby={waits ? `${idBase}-status` : undefined}
          onClick={() => (sending ? undefined : flow.confirm())}
        >
          Delete them
        </button>
      </div>
    </div>
  )
}

/** What the server answered, a focused region the keyboard is taken to, never an alert -- which would say it twice. */
function ChosenOutcome({ flow, idBase }: { flow: ChosenDelete; idBase: string }): ReactElement | null {
  const now = flow.deletion
  const headingId = `${idBase}-heading`
  const region = { role: 'region', 'aria-labelledby': headingId, tabIndex: -1, ref: flow.regionRef } as const
  const closes = (
    <button type="button" className="button" onClick={flow.close}>
      Close
    </button>
  )
  if (now.state === 'refused') {
    const described = now.declined ? `${idBase}-message ${idBase}-declined ${idBase}-none` : `${idBase}-message ${idBase}-none`
    return (
      <div {...region} className="notice" data-kind="refused" aria-describedby={described}>
        <RegionHeading level={4} id={headingId}>
          Not deleted
        </RegionHeading>
        <p id={`${idBase}-message`} className="notice-text">
          {now.message}
        </p>
        {now.declined ? (
          <p id={`${idBase}-declined`} className="notice-text">
            {DECLINED_BY}
          </p>
        ) : null}
        <p id={`${idBase}-none`} className="notice-text">
          {NONE_DELETED}
        </p>
        <div className="notice-actions">{closes}</div>
      </div>
    )
  }
  if (now.state !== 'answered') return null
  const named = lines(now)
  const stopped = notSent(now)
  const unknown = now.each.some(({ fate }) => fate.kind === 'unknown' || fate.kind === 'lost')
  // Every sentence it says, in order: how many it deleted, each record it did not, and those it never sent.
  const described = [`${idBase}-summary`, ...(named.length === 0 ? [] : [`${idBase}-each`]), ...(stopped === null ? [] : [`${idBase}-stopped`])].join(' ')
  return (
    <div {...region} className="notice" data-kind={unknown ? 'unknown' : 'done'} aria-describedby={described}>
      <RegionHeading level={4} id={headingId}>
        {heading(now.target, false)}
      </RegionHeading>
      <p id={`${idBase}-summary`} className="notice-text">
        {now.lost ? summary(now) : <ServerDid said={now.n}>{summary(now)}</ServerDid>}
      </p>
      {named.length === 0 ? null : (
        <ul id={`${idBase}-each`} className="notice-list">
          {named.map(({ record, said }) => (
            <li key={record}>
              <Words said={said} />
            </li>
          ))}
        </ul>
      )}
      {stopped === null ? null : (
        <p id={`${idBase}-stopped`} className="notice-text">
          <Words said={stopped} />
        </p>
      )}
      <div className="notice-actions">
        {unknown ? (
          <button type="button" className="button" aria-disabled={now.checking ? 'true' : undefined} onClick={flow.check}>
            Check them
          </button>
        ) : (
          closes
        )}
      </div>
    </div>
  )
}
