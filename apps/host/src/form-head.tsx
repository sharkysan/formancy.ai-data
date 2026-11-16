import type { ReactElement, RefObject } from 'react'
import { fieldHeading } from '@formancy/data-client'
import type { PublishedForm } from '@formancy/data-client'
import { LAYOUTS } from './layout.js'
import type { Layout } from './layout.js'
import { operationTags } from './operations.js'
import { Segmented } from './segmented.js'

const LAYOUT_LABELS: Readonly<Record<Layout, string>> = { 'side-by-side': 'Side by side', stacked: 'Stacked', separate: 'Separate views', drill: 'Drill down' }

/** What a form whose rows are saved with their record says of it (0155), by its lookup's label; null for any other form. */
export function savedWith(definition: PublishedForm, title: string): string | null {
  const together = definition.together
  if (together === null) return null
  const field = definition.form.model.fields.find((each) => each.key === together.field)
  const label = field === undefined ? together.field : fieldHeading(field)
  return `${title} rows are added and removed with their ${label}, in its own save: open it to change them.`
}

/**
 * The open form's header (UX-SPEC §5.5, §5.6): its heading, which names
 * main, what this person may do with it as tags -- a fill and no border, so
 * they are never taken for buttons -- and the Layout group, which says so
 * when the window draws Side by side stacked. A form whose rows are saved
 * with their record (0155) says so under its tags: it offers no New and no
 * Delete of them here.
 */
export function FormHead({
  title,
  formId,
  operations,
  layout,
  note,
  together = null,
  headingRef,
  onLayout,
}: {
  title: string
  formId: string
  operations: PublishedForm['operations']
  layout: Layout
  note: boolean
  /** Where the form's rows are saved with their record (0155): the sentence that says so. */
  together?: string | null
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
        {together === null ? null : <p className="hint">{together}</p>}
      </div>
      <Segmented
        legend="Layout"
        name="layout"
        className="layout"
        options={LAYOUTS.map((value) => ({ value, label: LAYOUT_LABELS[value] }))}
        value={layout}
        onChange={onLayout}
        describedBy={note ? 'layout-note' : undefined}
      >
        {note ? (
          <p className="hint layout-note" id="layout-note">
            In a window this narrow, Side by side is drawn stacked.
          </p>
        ) : null}
      </Segmented>
    </div>
  )
}
