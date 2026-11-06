import { useState } from 'react'
import type { ReactElement } from 'react'
import type { BrowseFilterTerm } from '@formancy/data-core'
import { sameFilter, sayFiltered } from './browse-terms.js'
import type { FilterChange, Filterable } from './browse-terms.js'

/*
 * The conditions a browsed page is filtered by (0104), each a chip in the
 * step's own words -- `credit_limit > 125.50`, the words the status line
 * says it in -- with its own Remove named for what it says, and Clear the
 * filter after them (0147). A removal is forgiven: Undo puts back what was
 * removed, and stays until the filter changes some other way, never on a
 * timer (WCAG 2.2.1), as the host's chips do.
 *
 * A removal puts the keyboard on the next chip's Remove, or the one before,
 * or on Undo once none is left; Clear the filter puts it on Undo, and Undo
 * on the Remove of the condition it put back. Each once the page has
 * arrived, which is when the element it names is there.
 */

/** The id of a chip's Remove, by its place, and of Undo: one filter on the step. */
const removeId = (index: number): string => `browse-remove-${String(index)}`
const UNDO = 'browse-undo'

/** What Undo puts back: the filter before a removal, and what Undo says. */
interface Undoing {
  before: BrowseFilterTerm[]
  /** The filter the removal left, as JSON: Undo lasts while the filter is that. */
  left: string
  words: string
}

/** A page's Undo, which the chips and the line share: what it puts back, a removal that offers it, and putting back. */
export interface UndoState {
  undo: Undoing | null
  /** `next` asked for in place of the filter, Undo offered for it in `words` once the page has arrived; `arrived` runs then too. */
  removing: (next: BrowseFilterTerm[], words: string, focus: string | null, arrived?: () => void) => void
  /** The filter before the removal asked for again, the keyboard on the Remove of the condition it puts back first. */
  putBack: () => void
}

/**
 * The Undo of a page's filter. Offered in the render that shows the page a
 * removal asked for, never before it arrived -- a removal the server
 * refused, or one pressed while a page was on its way, offers nothing --
 * and forgotten as soon as the filter changes any other way, followed
 * while rendering, React's way to follow a value, so it never comes back
 * when the filter later returns to what the removal left.
 */
export function useUndo(filter: readonly BrowseFilterTerm[], onFilter: FilterChange): UndoState {
  const [undoing, setUndoing] = useState<Undoing | null>(null)
  const now = JSON.stringify(filter)
  const [seen, setSeen] = useState(now)
  if (seen !== now) {
    setSeen(now)
    if (undoing !== null && undoing.left !== now) setUndoing(null)
  }
  const undo = undoing !== null && undoing.left === now ? undoing : null
  return {
    undo,
    removing: (next, words, focus, arrived) => {
      const before = [...filter]
      void onFilter(next, focus, () => {
        setUndoing({ before, left: JSON.stringify(next), words })
        arrived?.()
      })
    },
    putBack: () => {
      if (undo === null) return
      const back = undo.before.findIndex((term) => !filter.some((given) => sameFilter([given], [term])))
      void onFilter(undo.before, removeId(Math.max(0, back) + 1))
    },
  }
}

export function FilterChips({
  columns,
  filter,
  undoing,
}: {
  /** What each column offers, for what a chip says of a range of days. */
  columns: readonly Filterable[]
  filter: readonly BrowseFilterTerm[]
  /** The page's Undo, shared with its line. */
  undoing: UndoState
}): ReactElement | null {
  const { undo, removing, putBack } = undoing

  function remove(index: number): void {
    const term = filter[index]
    if (term === undefined) return
    const next = filter.filter((_, at) => at !== index)
    removing(next, `removing ${sayFiltered(term, columns)}`, next.length === 0 ? removeId(0) : removeId(index + 1))
  }

  if (filter.length === 0 && undo === null) return null
  return (
    <div className="filter-conditions">
      {filter.length === 0 ? null : (
        <>
          <p id="filtered-by">Filtered by</p>
          <ul aria-labelledby="filtered-by">
            {filter.map((term, index) => {
              const said = sayFiltered(term, columns)
              return (
                <li key={term.column}>
                  <span>{said}</span>
                  <button type="button" id={removeId(index)} className="filter-remove" onClick={() => remove(index)}>
                    Remove <span className="visually-hidden">{said}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <button type="button" className="button" onClick={() => removing([], 'clearing the filter', UNDO)}>
            Clear the filter
          </button>
        </>
      )}
      {undo === null ? null : (
        <button type="button" id={UNDO} className="button filter-undo" onClick={putBack}>
          Undo {undo.words}
        </button>
      )}
    </div>
  )
}
