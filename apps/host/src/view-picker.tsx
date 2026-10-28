import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { ListFilterTerm, ListSortTerm, ListView } from '@formancy/data-client'
import { viewMatching } from './views.js'

/*
 * A grid's View picker (0105): the views the server offered this person for
 * the form's list, by their names, in a native select labelled View, and
 * Show view, before the Filter panel. Not drawn when the server offered
 * none.
 *
 * What it says is what the section's filter and sort are (views.ts): "All
 * records" when both are empty, a view's name when they are exactly that
 * view's, and otherwise "Your own filter and sort" -- a choice there only
 * while it is true. So a condition the person applies, or a header they
 * sort by, is said at once, and the view's own conditions put back say the
 * view again.
 *
 * A form, as the search is, and for the search's reason: nothing is sent
 * per key. Where a closed select answers an arrow with a change -- Chromium
 * on Windows and Linux, Firefox -- each step would otherwise be a pick and a
 * request, and a step off "Your own filter and sort" would throw the
 * person's conditions away. So the select holds a draft, which starts as
 * what the section shows and goes back to it whenever that changes; only
 * Show view puts the draft into the filter and the sort, together, so the
 * grid asks for one first page (record-grid.tsx), and only when the draft
 * is another choice than the section's. The keyboard stays on Show view,
 * as it stays on Search.
 */

const ALL = 'all'
const OWN = 'own'

export function ViewPicker({
  idBase,
  views,
  filter,
  sort,
  onPick,
}: {
  /** What the select's id starts with: one picker per grid. */
  idBase: string
  /** The views the server offered this person (`list.views`), in its order. */
  views: readonly ListView[]
  /** The section's filter and sort, as the grid lists by them. */
  filter: readonly ListFilterTerm[]
  sort: readonly ListSortTerm[]
  /** A view shown, or "All records": the filter and the sort the section is to list by, together. */
  onPick: (filter: ListFilterTerm[], sort: ListSortTerm[]) => void
}): ReactElement | null {
  const matching = viewMatching(views, filter, sort)
  const own = matching === null && (filter.length > 0 || sort.length > 0)
  /** The choice the section's filter and sort are. */
  const current = matching !== null ? String(views.indexOf(matching)) : own ? OWN : ALL
  const [draft, setDraft] = useState(current)
  // The draft goes back to what the section shows whenever that changes: a
  // view shown, a condition applied, a header pressed. Set while rendering,
  // React's way to follow a value, so no frame shows the old draft.
  const [followed, setFollowed] = useState(current)
  if (followed !== current) {
    setFollowed(current)
    setDraft(current)
  }
  if (views.length === 0) return null

  function show(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (draft === current) return
    if (draft === ALL) {
      onPick([], [])
      return
    }
    const view = draft === OWN ? undefined : views[Number(draft)]
    if (view !== undefined) onPick(view.filter, view.sort)
  }

  return (
    <form className="view-picker" onSubmit={show}>
      <label htmlFor={`${idBase}-view`}>View</label>
      <select id={`${idBase}-view`} value={draft} onChange={(event) => setDraft(event.target.value)}>
        <option value={ALL}>All records</option>
        {views.map((view, index) => (
          <option key={view.name} value={String(index)}>
            {view.name}
          </option>
        ))}
        {own ? <option value={OWN}>Your own filter and sort</option> : null}
      </select>
      <button type="submit" className="button">
        Show view
      </button>
    </form>
  )
}
