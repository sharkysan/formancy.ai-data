import type { ReactElement, ReactNode } from 'react'
import { useMedia } from './use-media.js'

/** Where the person asks for reduced motion: the colour changes without a transition (0146). */
export const STILL = '(prefers-reduced-motion: reduce)'

/**
 * Words that say what the server did -- a page, a filter or a view
 * answered, a record deleted, a save, a view kept, a file made -- in the
 * room's teal as they are said, back to the line's own colour after a
 * moment (0146): `server-did` in styles/records.css. `said` is the
 * how-manyth time the line says what the server did, and a new one is a new
 * element, so the colour comes again where the words are the last time's.
 * It sits inside the line's live region and is never the region, which a
 * screen reader hears when its text changes, not when it arrives holding
 * some; the words stay on the line, said as before.
 *
 * Under `prefers-reduced-motion: reduce` the colour changes at the end of
 * the moment without a transition (`data-still`). The preference is read
 * here rather than by an `@media` rule: the host's browser gate measures the
 * page past every `@media` condition it reads, and reads a `max-width` in
 * rem alone (scripts/browser/styles.mjs).
 */
export function ServerDid({ said, children }: { said: number; children: ReactNode }): ReactElement {
  const still = useMedia(STILL)
  return (
    <span key={said} className="server-did" data-still={still ? '' : undefined}>
      {children}
    </span>
  )
}
