import { useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import type { FormRecord, Reconciliation } from '@formancy/data-client'
import type { Session } from './session.js'

/** What the notice says once "Enter it again anyway" has been confirmed. */
export const ALLOWED = 'Press Save to enter it again.'

/**
 * What a check found, in words -- only what the read showed -- and the record
 * to load when there is one. `origin` is where the save's answer was lost.
 */
export function verdict(found: Reconciliation, origin: 'database' | 'transport' | undefined): { text: string; current?: FormRecord } {
  if (!found.ok) return { text: `It could not be checked: ${found.message} Whether the save was stored is still unknown.` }
  switch (found.state) {
    case 'unchanged':
      return { text: 'Not in the record yet. Saving again is safe: press Save; it is stored at most once.' }
    case 'changed':
      return { text: 'The record has changed since it was read, by this save or by someone else.', current: found.current }
    case 'present':
      return { text: `A record with this key is stored, record ${String(found.current.record)}. Load it to see whether it holds what was entered here.`, current: found.current }
    case 'absent':
      return { text: 'This form cannot find a record with its key. Saving it again is safe: the key stops a second copy.' }
    case 'unverifiable':
      return {
        text:
          origin === 'transport'
            ? 'This form cannot tell: the answer was lost before the server could say which record it made. Check by your own means; entering it again may store it twice.'
            : 'This form cannot tell: the database numbers new records. Check by your own means; entering it again may store it twice.',
      }
  }
}

/**
 * The notice a save whose outcome is unknown opens (0031): the server's or
 * the client's sentence under "It may have been saved", never "Not saved".
 * A focused region, as the stale notice is, and not an alert, which a screen
 * reader would announce on top of the focus move (0029).
 *
 * Nothing here sends the save again. "Check whether it was saved" reads what
 * it addressed and says what that shows, in a status line that is on the
 * page before it speaks; "Load the saved record" opens what is stored; and
 * for a create nobody can find, "Enter it again anyway" asks once more before
 * the session lets the next press create.
 */
export function UnknownNotice({
  session,
  message,
  label,
  noticeId,
  noticeRef,
  onLoad,
}: {
  session: Session
  message: string
  /** The ids that name the region: the pane's heading, then the notice's. */
  label: string
  noticeId: string
  noticeRef: RefObject<HTMLDivElement | null>
  onLoad: (record: FormRecord) => void
}): ReactElement {
  const [found, setFound] = useState<{ text: string; current?: FormRecord; unverifiable: boolean } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const allow = useRef<HTMLButtonElement>(null)
  const again = useRef<HTMLButtonElement>(null)
  // Where the keyboard goes when the button it pressed goes away. A request,
  // not a place: asking for the same place twice -- "Enter it again anyway",
  // a check, "Enter it again anyway" -- must move it twice.
  const [focus, setFocus] = useState<{ to: 'allow' | 'again' | 'notice'; n: number } | null>(null)
  const focusOn = (to: 'allow' | 'again' | 'notice'): void => setFocus((asked) => ({ to, n: (asked?.n ?? 0) + 1 }))

  useEffect(() => {
    if (focus?.to === 'allow') allow.current?.focus()
    else if (focus?.to === 'again') again.current?.focus()
    else if (focus?.to === 'notice') noticeRef.current?.focus()
  }, [focus, noticeRef])

  async function check(): Promise<void> {
    const result = await session.check()
    setFound({ ...verdict(result, session.unknown()?.origin), unverifiable: result.ok && result.state === 'unverifiable' })
    setConfirming(false)
  }

  const current = found?.current
  return (
    <div role="region" aria-labelledby={label} tabIndex={-1} ref={noticeRef} className="notice" data-kind="unknown">
      <h3 id={noticeId} className="notice-heading">
        It may have been saved
      </h3>
      <p className="notice-text">{message}</p>
      <p role="status" className="notice-text">
        {allowed ? ALLOWED : (found?.text ?? '')}
      </p>
      <div className="notice-actions">
        <button type="button" className="button" onClick={() => void check()}>
          Check whether it was saved
        </button>
        {current === undefined ? null : (
          <button type="button" className="button" onClick={() => onLoad(current)}>
            Load the saved record
          </button>
        )}
        {found?.unverifiable === true && !allowed && !confirming ? (
          <button
            type="button"
            className="button"
            ref={again}
            onClick={() => {
              setConfirming(true)
              focusOn('allow')
            }}
          >
            Enter it again anyway
          </button>
        ) : null}
      </div>
      {confirming ? (
        <div role="group" aria-labelledby={`${noticeId}-confirm`} className="notice-actions">
          <p id={`${noticeId}-confirm`} className="notice-text">
            Only if you have checked that it is not stored: entering it again may store it twice.
          </p>
          <button
            type="button"
            className="button"
            ref={allow}
            onClick={() => {
              session.allowAgain()
              setAllowed(true)
              setConfirming(false)
              focusOn('notice')
            }}
          >
            Allow saving it again
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setConfirming(false)
              focusOn('again')
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
