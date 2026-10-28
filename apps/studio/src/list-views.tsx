import { useMemo, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { listColumns, viewProblems, viewShapeProblems } from '@formancy/data-core'
import type { FormBindings, ListView } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { sayCondition } from './condition-draft.js'
import { labelOf } from './document.js'
import { useFocusAfterRender } from './focus.js'
import { draftOfView, EMPTY_VIEW, VIEW_NAME, VIEW_SAVE, ViewForm, viewOf } from './view-form.js'
import type { ViewDraft } from './view-form.js'

/*
 * A form's list views (0105), in the Presentation step: conditions and an
 * order an administrator names, which a person picks above the form's
 * grid. A view is presentation, stored beside the labels and carried by a
 * regeneration as they are, but it is no part of the form's document, so
 * the session's Undo and Redo leave it be.
 *
 * What a view may be built from is what the form's list offers anybody --
 * `listColumns` over every field, as the server fits a view at a write --
 * and each condition's boxes are the Browse step's (`condition-draft.tsx`),
 * in the form of `view-form.tsx`. The server offers a person only the views
 * they could have built from their own list, so a view naming a field
 * somebody may not read is not offered to them at all.
 */

/** The panel's heading, where the keyboard goes when the last view is removed. */
const HEADING = 'views-heading'

/** A view in words, its fields by the form's labels: `where Status = placed; sorted by Order date descending; opens the grid`. */
export function sayView(view: ListView, label: (key: string) => string): string {
  const where = view.filter.length === 0 ? 'every record' : `where ${view.filter.map((term) => sayCondition(label(term.field), term)).join(' and ')}`
  const sorted = view.sort.length === 0 ? [] : [`sorted by ${view.sort.map((term) => `${label(term.field)} ${term.direction === 'asc' ? 'ascending' : 'descending'}`).join(', then ')}`]
  return [where, ...sorted, ...(view.default === true ? ['opens the grid'] : [])].join('; ')
}

/** A view as a list says it: its name, then its words. */
export function SavedView({ view, label }: { view: ListView; label: (key: string) => string }): ReactElement {
  return (
    <p>
      <strong>{view.name}</strong>: {sayView(view, label)}.
    </p>
  )
}

/**
 * The views, each in words with what may be done to it, and the form that
 * makes one or edits one. A press that takes away the button pressed puts
 * the keyboard where a person goes on from: a moved view keeps it, on the
 * same button at its new place, or on its partner where that one is
 * disabled at the end, as a moved field does; a removed view gives it to
 * the Remove that takes its place, and after the last to the panel's
 * heading; a saved view leaves it on Save view, with the form emptied for
 * the next.
 *
 * A view is checked before it is saved by the server's own checks, its
 * shape and its fit to these bindings, and a refusal is said in their
 * words with everything typed kept.
 */
export function ListViewsPanel({ bindings, document, views, onViews }: { bindings: FormBindings; document: FormSchema; views: readonly ListView[]; onViews: (views: ListView[]) => void }): ReactElement {
  const columns = useMemo(() => listColumns(bindings, bindings.fields.map((binding) => binding.field), []), [bindings])
  const label = (key: string) => labelOf(document, key)
  const [draft, setDraft] = useState<ViewDraft>(EMPTY_VIEW)
  // The view in the form, by the name it was saved under: the name typed may change, and a move changes its place.
  const [editing, setEditing] = useState<string | null>(null)
  const [refused, setRefused] = useState<string[]>([])
  const [said, setSaid] = useState('')
  const focusAfter = useFocusAfterRender()
  const editingAt = editing === null ? -1 : views.findIndex((view) => view.name === editing)

  function startOver(): void {
    setDraft(EMPTY_VIEW)
    setEditing(null)
    setRefused([])
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    const view = viewOf(draft, columns.filterable)
    const at = editingAt === -1 ? views.length : editingAt
    // One view opens the grid: saved as the default, this one takes it from the one that had it.
    const took = view.default === true ? views.find((other, index) => index !== at && other.default === true) : undefined
    const others = views.map((other): ListView => (other === took ? { name: other.name, filter: other.filter, sort: other.sort } : other))
    const next = at === views.length ? [...others, view] : others.map((other, index) => (index === at ? view : other))
    // The fit reads what the shape lets through, so a malformed condition is said once.
    const shape = viewShapeProblems(next)
    const problems = shape.length > 0 ? shape : viewProblems(next, bindings)
    setSaid('')
    if (problems.length > 0) {
      setRefused(problems)
      return
    }
    onViews(next)
    startOver()
    setSaid(`Saved view ${String(at + 1)}, “${view.name}”${took === undefined ? '' : `, which opens the grid instead of “${took.name}”`}.`)
    focusAfter(VIEW_SAVE)
  }

  function edit(at: number): void {
    const view = views[at]
    if (view === undefined) return
    setDraft(draftOfView(view))
    setEditing(view.name)
    setRefused([])
    setSaid('')
    focusAfter(VIEW_NAME)
  }

  function remove(at: number): void {
    const view = views[at]
    if (view === undefined) return
    const rest = views.filter((_, index) => index !== at)
    onViews(rest)
    if (view.name === editing) startOver()
    setSaid(`Removed view “${view.name}”.`)
    focusAfter(rest.length === 0 ? HEADING : `view-${String(Math.min(at, rest.length - 1))}-remove`)
  }

  function move(at: number, by: -1 | 1): void {
    const to = at + by
    const view = views[at]
    const other = views[to]
    if (view === undefined || other === undefined) return
    onViews(views.map((entry, index) => (index === at ? other : index === to ? view : entry)))
    setSaid(`Moved view “${view.name}” ${by < 0 ? 'up' : 'down'}.`)
    const end = by < 0 ? to === 0 : to === views.length - 1
    focusAfter(`view-${String(to)}-${by < 0 !== end ? 'up' : 'down'}`)
  }

  return (
    <section className="list-views" aria-labelledby={HEADING}>
      <h3 id={HEADING} tabIndex={-1}>
        List views
      </h3>
      <p className="hint">
        Named filters and sort orders a person can pick above this form’s grid. A person is offered a view only if they may read every
        field it names.
      </p>
      {views.length === 0 ? (
        <p className="none">No view yet.</p>
      ) : (
        <ol className="views" aria-labelledby={HEADING}>
          {views.map((view, index) => {
            const number = String(index + 1)
            return (
              <li key={view.name}>
                <SavedView view={view} label={label} />
                <p className="actions">
                  <button type="button" id={`view-${String(index)}-edit`} className="button" onClick={() => edit(index)}>
                    Edit view {number}
                  </button>
                  <button type="button" id={`view-${String(index)}-remove`} className="button" onClick={() => remove(index)}>
                    Remove view {number}
                  </button>
                  <button type="button" id={`view-${String(index)}-up`} className="button" disabled={index === 0} onClick={() => move(index, -1)}>
                    Move view {number} up
                  </button>
                  <button type="button" id={`view-${String(index)}-down`} className="button" disabled={index === views.length - 1} onClick={() => move(index, 1)}>
                    Move view {number} down
                  </button>
                </p>
              </li>
            )
          })}
        </ol>
      )}
      <p className="said" aria-live="polite">
        {said}
      </p>
      <ViewForm
        heading={editingAt === -1 ? 'New view' : `Editing view ${String(editingAt + 1)}, “${editing ?? ''}”`}
        draft={draft}
        offers={columns.filterable}
        sortable={columns.sortable}
        label={label}
        refused={refused}
        focusAfter={focusAfter}
        onDraft={setDraft}
        onSave={save}
      />
    </section>
  )
}
