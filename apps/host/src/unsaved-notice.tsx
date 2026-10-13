import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { Pending } from './guard.js'
import { lead, RENDERER_NAMES, WORK } from './leave.js'
import { Words } from './words.js'

/**
 * "Unsaved changes" (0047): the request a person made would drop forms that
 * hold work, and the page waits. A focused region, as the stale notice is,
 * not a modal: nothing traps the keyboard, and its frame is the cue. It
 * names what was asked for, and each form with what it holds, and is
 * described by both, so the focus move says what is at stake.
 *
 * "Keep editing" -- or Escape -- changes nothing and gives the keyboard back
 * to what asked; "Discard and continue" drops the work and carries the
 * request out, unless more was typed while it waited, which it names first.
 * A second request replaces the first.
 */
export function UnsavedNotice({ pending, onKeep, onDiscard }: { pending: Pending; onKeep: () => void; onDiscard: () => void }): ReactElement {
  const region = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = region.current
    if (element === null) return
    element.focus({ preventScroll: true })
    // To the top of the window, and only downwards or upwards: a sideways
    // scroll would move the whole page by the width of the scrollbar's gutter.
    // Only where the page is laid out: jsdom draws no boxes.
    if (element.getClientRects().length > 0) window.scrollBy({ top: element.getBoundingClientRect().top - 16, behavior: 'instant' })
    // Opacity, not motion: a dissolve is what reduced-motion settings put in
    // place of movement (UX-SPEC §8). The Web Animations API, so no stylesheet
    // rule and no media query; jsdom has none.
    element.animate?.([{ opacity: 0.35 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
  }, [pending.n])

  return (
    <div
      className="notice unsaved"
      role="region"
      aria-labelledby="unsaved-heading"
      aria-describedby="unsaved-lead unsaved-list"
      tabIndex={-1}
      ref={region}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        onKeep()
      }}
    >
      <div className="unsaved-text">
        <div className="unsaved-line">
          <h3 className="notice-heading" id="unsaved-heading">
            Unsaved changes
          </h3>
          <p className="notice-text" id="unsaved-lead">
            <Words said={lead(pending.request)} />
          </p>
        </div>
        <ul id="unsaved-list">
          {pending.risky.map((pane) => (
            <li key={`${pane.owner} ${String(pane.renderer)}`}>
              <Words said={pane.name} />
              {pane.renderer === null ? '' : `, ${RENDERER_NAMES[pane.renderer]}`}: {pane.work === null ? '' : WORK[pane.work]}
            </li>
          ))}
        </ul>
      </div>
      <div className="notice-actions">
        <button type="button" className="button" onClick={onKeep}>
          Keep editing
        </button>
        <button type="button" className="button danger" onClick={onDiscard}>
          Discard and continue
        </button>
      </div>
    </div>
  )
}
