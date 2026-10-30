import type { ReactElement, RefObject } from 'react'
import type { PublishedForm } from '@formancy/data-client'
import { LAYOUTS } from './layout.js'
import type { Layout } from './layout.js'
import { operationTags } from './operations.js'
import { Segmented } from './segmented.js'

const LAYOUT_LABELS: Readonly<Record<Layout, string>> = { 'side-by-side': 'Side by side', stacked: 'Stacked', separate: 'Separate views', drill: 'Drill down' }

/**
 * The open form's header (UX-SPEC §5.5, §5.6): its heading, which names
 * main, what this person may do with it as tags -- a fill and no border, so
 * they are never taken for buttons -- and the Layout group, which says so
 * when the window draws Side by side stacked.
 */
export function FormHead({
  title,
  formId,
  operations,
  layout,
  note,
  headingRef,
  onLayout,
}: {
  title: string
  formId: string
  operations: PublishedForm['operations']
  layout: Layout
  note: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  onLayout: (layout: Layout) => void
}): ReactElement {
  return (
    <div className="form-head">
      <div className="form-id">
        <h2 id="form-heading" className="form-title" tabIndex={-1} ref={headingRef}>
          <span>{title}</span> <code>{formId}</code>
        </h2>
        <ul className="ops" aria-label="Operations">
          {operationTags(operations).map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      </div>
      <Segmented legend="Layout" name="layout" className="layout" options={LAYOUTS.map((value) => ({ value, label: LAYOUT_LABELS[value] }))} value={layout} onChange={onLayout} describedBy={note ? 'layout-note' : undefined}>
        {note ? (
          <p className="hint layout-note" id="layout-note">
            In a window this narrow, Side by side is drawn stacked.
          </p>
        ) : null}
      </Segmented>
    </div>
  )
}
