import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { shownCrumbs } from './crumbs.js'
import type { Crumb } from './crumbs.js'
import { Words } from './words.js'

/**
 * Drill down's trail (0090): one crumb per level from the records to the
 * one shown. Every crumb above is a button, since no level has an address
 * of its own -- a record is never in one (0047) -- and the one shown is
 * text, the page. On a phone, past three crumbs, the first, a button that
 * draws the rest, and the last two (crumbs.ts); pressed, the button is
 * gone, so the keyboard goes to the first crumb it drew.
 */
export function Trail({ crumbs, compact, onUp }: { crumbs: readonly Crumb[]; compact: boolean; onUp: (level: number, button: HTMLButtonElement) => void }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const shownLevel = crumbs.at(-1)?.level ?? 0
  /** The first crumb the button drew, once it has drawn them. */
  const drawn = useRef<HTMLButtonElement>(null)
  const pressed = useRef(false)
  useEffect(() => {
    if (!expanded || !pressed.current) return
    pressed.current = false
    drawn.current?.focus()
  }, [expanded])
  return (
    <nav className="trail" aria-label="Breadcrumb">
      <ol>
        {shownCrumbs(crumbs, compact, expanded).map((crumb) =>
          'more' in crumb ? (
            <li key="more">
              <button
                type="button"
                className="crumb more"
                aria-expanded="false"
                aria-label={`Show all ${String(crumb.more)} levels`}
                onClick={() => {
                  pressed.current = true
                  setExpanded(true)
                }}
              >
                …
              </button>
            </li>
          ) : (
            <li key={crumb.level}>
              {crumb.level === shownLevel ? (
                <span className="crumb" aria-current="page">
                  <Words said={crumb.said} />
                </span>
              ) : (
                <button type="button" className="crumb" ref={crumb.level === crumbs[1]?.level ? drawn : undefined} onClick={(event) => onUp(crumb.level, event.currentTarget)}>
                  <Words said={crumb.said} />
                </button>
              )}
            </li>
          ),
        )}
      </ol>
    </nav>
  )
}
