import type { ReactElement } from 'react'
import type { DeleteFlow } from './delete-flow.js'
import { checkedText, NOT_FOUND } from './deletion.js'
import { RegionHeading, Words } from './words.js'
import type { RegionLevel } from './words.js'

/**
 * What the server answered a delete, in the region that asked (0053), each
 * a focused region the keyboard is taken to, never an alert -- which would
 * say it twice:
 *
 * - **not found** (404): the record may be gone, deleted by somebody else
 *   or by an earlier delete whose answer was lost, or be one the person may
 *   no longer see; never "Not deleted", never "Deleted". Close the record
 *   takes it from the page, said as closed.
 * - **refused**: "Not deleted", in the warm colour, and the server's sentence
 *   verbatim; stale offers the saved record.
 * - **unknown** (0031): "It may have been deleted", teal, the sentence, and
 *   a check that reads the record and says what the read showed in a status
 *   line already on the page. The keyboard then moves to the region, and no
 *   button takes the place of Check under it, so a second Enter does
 *   nothing; while it reads, Check does nothing either. Still at the version
 *   sent, Delete it again asks again.
 */
export function DeleteOutcome({ flow, level, idBase }: { flow: DeleteFlow; level: RegionLevel; idBase: string }): ReactElement | null {
  const now = flow.deletion
  const headingId = `${idBase}-heading`
  const region = { role: 'region', 'aria-labelledby': headingId, tabIndex: -1, ref: flow.regionRef } as const
  if (now.state === 'not-found') {
    return (
      <div {...region} className="notice" data-kind="gone">
        <RegionHeading level={level} id={headingId}>
          <Words said={[`Cannot find ${now.target.noun} `, { code: now.target.record }]} />
        </RegionHeading>
        <p className="notice-text">{NOT_FOUND}</p>
        <div className="notice-actions">
          <button type="button" className="button" onClick={flow.closeRecord}>
            Close the record
          </button>
        </div>
      </div>
    )
  }
  if (now.state === 'refused') {
    return (
      <div {...region} className="notice" data-kind="refused">
        <RegionHeading level={level} id={headingId}>
          Not deleted
        </RegionHeading>
        <p className="notice-text">{now.message}</p>
        <div className="notice-actions">
          {now.stale ? (
            <button type="button" className="button" onClick={flow.load}>
              Load the saved record
            </button>
          ) : null}
          <button type="button" className="button" onClick={flow.close}>
            Close
          </button>
        </div>
      </div>
    )
  }
  if (now.state !== 'unknown' && now.state !== 'checked') return null
  const found = now.state === 'checked' ? now.found : null
  const unread = found === null || found.kind === 'unread'
  return (
    <div {...region} className="notice" data-kind="unknown">
      <RegionHeading level={level} id={headingId}>
        It may have been deleted
      </RegionHeading>
      <p className="notice-text">{now.unknown.message}</p>
      <p role="status" className="notice-text">
        {found === null ? '' : checkedText(found)}
      </p>
      <div className="notice-actions">
        {unread ? (
          <button type="button" className="button" aria-disabled={now.state === 'unknown' && now.checking ? 'true' : undefined} onClick={flow.check}>
            Check whether it was deleted
          </button>
        ) : null}
        {found?.kind === 'absent' ? (
          <button type="button" className="button" onClick={flow.closeRecord}>
            Close the record
          </button>
        ) : null}
        {found?.kind === 'unchanged' ? (
          <button type="button" className="button danger" onClick={flow.again}>
            Delete it again
          </button>
        ) : null}
        {found?.kind === 'changed' ? (
          <button type="button" className="button" onClick={flow.load}>
            Load the saved record
          </button>
        ) : null}
      </div>
    </div>
  )
}
