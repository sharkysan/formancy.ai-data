import type { ReactElement } from 'react'
import type { Deleting } from '@formancy/data-client'
import type { DeleteFlow } from './delete-flow.js'
import { DeleteOutcome } from './delete-outcome.js'
import { DELETING, DISCARDED_WITH_IT, heading, lead, SAVE_OUT } from './deletion.js'
import { RENDERER_NAMES, WORK } from './leave.js'
import { RegionHeading, Words } from './words.js'
import type { RegionLevel } from './words.js'

/**
 * A delete's region (0053), in place where it was asked for -- under the
 * detail's header, or under the grid whose row asked -- with no overlay: the
 * confirmation, then what the server answered (delete-outcome.tsx). Nothing
 * when there is no deletion.
 */
export function DeleteRegion({
  flow,
  deleting,
  level,
  idBase,
}: {
  flow: DeleteFlow
  deleting: Deleting
  level: RegionLevel
  idBase: string
}): ReactElement | null {
  const now = flow.deletion
  if (now.state === 'idle') return null
  if (now.state !== 'confirming' && now.state !== 'sending') return <DeleteOutcome flow={flow} level={level} idBase={idBase} />
  const sending = now.state === 'sending'
  const discards = now.state === 'confirming' ? now.discards : []
  const busy = sending ? 'true' : undefined
  // A save of the open record out: Delete it waits for its answer, which moves the version it would name.
  const waits = !sending && now.target.open && flow.saving
  return (
    // The confirmation: focused, described by what is at stake, and a frame
    // in the colour of what cannot be taken back. The next Tab reaches Keep
    // it, so the keyboard is never put on the button that deletes; Escape is
    // Keep it. While the deletion is out both answers say so and do nothing;
    // while a save of the open record is out, Delete it says so and waits.
    <div
      role="region"
      className="notice"
      data-kind="confirm"
      aria-labelledby={`${idBase}-heading`}
      aria-describedby={discards.length === 0 ? `${idBase}-lead` : `${idBase}-lead ${idBase}-list`}
      tabIndex={-1}
      ref={flow.regionRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || sending) return
        event.preventDefault()
        flow.keep()
      }}
    >
      <RegionHeading level={level} id={`${idBase}-heading`}>
        <Words said={heading(now.target)} />
      </RegionHeading>
      <div id={`${idBase}-lead`}>
        {lead(deleting).map((sentence) => (
          <p key={sentence} className="notice-text">
            {sentence}
          </p>
        ))}
        {discards.length === 0 ? null : <p className="notice-text">{DISCARDED_WITH_IT}</p>}
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
          Keep it
        </button>
        <button
          type="button"
          className="button danger"
          aria-disabled={sending || waits ? 'true' : undefined}
          aria-describedby={waits ? `${idBase}-status` : undefined}
          onClick={() => (sending ? undefined : flow.confirm())}
        >
          Delete it
        </button>
      </div>
    </div>
  )
}
