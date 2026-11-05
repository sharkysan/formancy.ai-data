import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { ListFilterTerm } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import { summaryOf } from './filter-terms.js'
import type { PanelField } from './filter-terms.js'

/*
 * The conditions a grid's filter holds, each a chip in plain words --
 * "Amount is over 1000" -- with its own Remove named for what it says, and
 * Clear filter after them. A removal is forgiven: Undo puts back what was
 * removed, and stays until the filter changes some other way, never on a
 * timer (WCAG 2.2.1). A list nothing matches is no dead end: the chips
 * offer to try it without the last condition, a removal like any other.
 *
 * A removal puts the keyboard on the next chip's Remove, or the one
 * before, or on Undo once none is left; Undo puts it on the Remove of the
 * condition it put back.
 */

/** What Undo puts back: the filter before a removal, while the filter is still what the removal left. */
interface Undoing {
  before: ListFilterTerm[]
  left: string
  words: string
}

const same = (a: readonly ListFilterTerm[], b: readonly ListFilterTerm[]): boolean => JSON.stringify(a) === JSON.stringify(b)

export function FilterChips({
  idBase,
  fields,
  filter,
  onFilter,
  empty,
}: {
  idBase: string
  /** The fields the list is filtered by, offered or not, for their labels. */
  fields: readonly PanelField[]
  filter: readonly ListFilterTerm[]
  onFilter: (next: ListFilterTerm[]) => void
  /** Whether the grid's first page under this filter came back with no rows. */
  empty: boolean
}): ReactElement | null {
  const byField = new Map(fields.map((field) => [field.field, field]))
  const [undoing, setUndoing] = useState<Undoing | null>(null)
  const removes = useRef(new Map<string, HTMLButtonElement>())
  const undoRef = useRef<HTMLButtonElement>(null)
  const after = useAfterRender()
  const undo = undoing !== null && undoing.left === JSON.stringify(filter) ? undoing : null
  const words = (term: ListFilterTerm): string => summaryOf(term, byField.get(term.field))

  /** `next` applied in place of `filter`, Undo offered for it in `said`. */
  function removing(next: ListFilterTerm[], said: string): void {
    setUndoing({ before: [...filter], left: JSON.stringify(next), words: said })
    onFilter(next)
  }

  function remove(index: number): void {
    const term = filter[index]
    if (term === undefined) return
    const next = filter.filter((_, at) => at !== index)
    removing(next, `removing ${words(term)}`)
    after(() => {
      const then = next[index] ?? next[index - 1]
      if (then === undefined) undoRef.current?.focus()
      else removes.current.get(then.field)?.focus()
    })
  }

  function clear(): void {
    removing([], 'clearing the filter')
    after(() => undoRef.current?.focus())
  }

  function putBack(): void {
    if (undo === null) return
    const back = undo.before.find((term) => !filter.some((given) => same([given], [term]))) ?? undo.before[0]
    setUndoing(null)
    onFilter(undo.before)
    after(() => {
      if (back !== undefined) removes.current.get(back.field)?.focus()
    })
  }

  const last = filter.at(-1)
  if (filter.length === 0 && undo === null) return null
  return (
    <div className="filter-active">
      {filter.length === 0 ? null : (
        <>
          <p className="filter-label" id={`${idBase}-active`}>
            Filtered by
          </p>
          <ul className="filter-terms" aria-labelledby={`${idBase}-active`}>
            {filter.map((term, index) => (
              <li key={term.field} className="filter-chip">
                <span>{words(term)}</span>
                <button
                  type="button"
                  className="button quiet filter-chip-remove"
                  aria-label={`Remove ${words(term)}`}
                  ref={(element) => {
                    if (element === null) removes.current.delete(term.field)
                    else removes.current.set(term.field, element)
                  }}
                  onClick={() => remove(index)}
                >
                  <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12">
                    <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="button" onClick={clear}>
            Clear filter
          </button>
        </>
      )}
      {undo === null ? null : (
        <button type="button" className="button quiet" ref={undoRef} onClick={putBack}>
          Undo {undo.words}
        </button>
      )}
      {empty && last !== undefined ? (
        <p className="filter-dead-end">
          No rows match all of these.{' '}
          <button type="button" className="button" onClick={() => remove(filter.length - 1)}>
            Try without {words(last)}
          </button>
        </p>
      ) : null}
    </div>
  )
}
