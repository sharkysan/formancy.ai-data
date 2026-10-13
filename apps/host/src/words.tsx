import type { ReactElement, ReactNode } from 'react'
import type { Said } from './leave.js'

/** A sentence of the page's, with its tokens and ids set as code. */
export function Words({ said }: { said: Said }): ReactElement {
  return <>{said.map((part, index) => (typeof part === 'string' ? part : <code key={index}>{part.code}</code>))}</>
}

/**
 * A notice's heading, one level under its pane's: h5 under a record's h4.
 * A child row's pane heading is already h6, the last level, so its notice's
 * title is a paragraph that still names the region (UX-SPEC D7).
 */
export function NoticeHeading({ level, id, children }: { level: 4 | 6; id: string; children: string }): ReactElement {
  return level === 4 ? (
    <h5 id={id} className="notice-heading">
      {children}
    </h5>
  ) : (
    <p id={id} className="notice-heading">
      {children}
    </p>
  )
}

/** A delete's region heading, one level below what it sits in: h4 under a detail's or the Records' h3, h5 under a child's h4, h6 under a child row's h5 (0053). */
export type RegionLevel = 4 | 5 | 6

export function RegionHeading({ level, id, children }: { level: RegionLevel; id: string; children: ReactNode }): ReactElement {
  const Heading = level === 4 ? 'h4' : level === 5 ? 'h5' : 'h6'
  return (
    <Heading id={id} className="notice-heading">
      {children}
    </Heading>
  )
}
