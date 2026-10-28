import type { ReactElement } from 'react'
import type { ListFilterTerm, ListSortTerm, ListView } from '@formancy/data-client'
import { viewMatching } from './views.js'

/*
 * A grid's View picker (0105): the views the server offered this person for
 * the form's list, by their names, in a native select labelled View, before
 * the Filter panel. Not drawn when the server offered none.
 *
 * It holds nothing. What it shows is what the section's filter and sort are
 * (views.ts): "All records" when both are empty, a view's name when they are
 * exactly that view's, and otherwise "Your own filter and sort" -- a choice
 * there only while it is true. So a condition the person applies, or a
 * header they sort by, is said at once, and the view's own conditions put
 * back say the view again. Picking a view sets its filter and its sort
 * together, and "All records" empties both, so the grid asks for one first
 * page (record-grid.tsx).
 *
 * A native select, whose keys are the browser's own, as the filter panel's
 * choices are (filter-panel.tsx); it changes the list and nothing else, so
 * the keyboard stays on it.
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
  /** A view picked, or "All records": the filter and the sort the section is to list by, together. */
  onPick: (filter: ListFilterTerm[], sort: ListSortTerm[]) => void
}): ReactElement | null {
  if (views.length === 0) return null
  const matching = viewMatching(views, filter, sort)
  const own = matching === null && (filter.length > 0 || sort.length > 0)
  const value = matching !== null ? String(views.indexOf(matching)) : own ? OWN : ALL

  function choose(chosen: string): void {
    if (chosen === ALL) {
      onPick([], [])
      return
    }
    const view = chosen === OWN ? undefined : views[Number(chosen)]
    if (view !== undefined) onPick(view.filter, view.sort)
  }

  return (
    <div className="view-picker">
      <label htmlFor={`${idBase}-view`}>View</label>
      <select id={`${idBase}-view`} value={value} onChange={(event) => choose(event.target.value)}>
        <option value={ALL}>All records</option>
        {views.map((view, index) => (
          <option key={view.name} value={String(index)}>
            {view.name}
          </option>
        ))}
        {own ? <option value={OWN}>Your own filter and sort</option> : null}
      </select>
    </div>
  )
}
