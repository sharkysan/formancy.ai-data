import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { filterOffer } from '@formancy/data-core'
import type { BrowseFilterTerm, FilterOffer, FilterOp, ObjectMeta, RecordColumn } from '@formancy/data-core'
import { chosenOp, ConditionValues, conditionOf, EMPTY_VALUES, hintOf, OPS, sayCondition } from './condition-draft.js'
import type { ValueDraft } from './condition-draft.js'

/*
 * A browsed page's filter (0104): the person's own conditions on the
 * columns the page shows, each one its column offers, every one of them
 * holding at once. The studio offers what `filterOffer` says each column
 * offers, from its own discovery; the server plans every condition again
 * over its own and refuses one it does not offer, or a value its column
 * cannot hold, in words the step's alert says (0011).
 */

/**
 * A column the page shows that offers a filter: what `filterOffer` offers
 * it, a timestamp's among it whose clock its whole days are on -- UTC for
 * an instant, as its values are written for one in no zone.
 */
export interface Filterable {
  column: string
  offer: FilterOffer
}

/**
 * What each column of a page offers a filter, in the page's order: the
 * columns the server showed, each read from the studio's discovery of the
 * object, which says what the page does not -- whether it holds NULLs. A
 * column the discovery does not hold, or one that offers nothing, is left
 * out.
 */
export function filterables(object: ObjectMeta | undefined, shown: readonly RecordColumn[]): Filterable[] {
  const byName = new Map((object?.columns ?? []).map((column) => [column.name, column]))
  return shown.flatMap((column): Filterable[] => {
    const meta = byName.get(column.name)
    const offer = meta === undefined ? null : filterOffer(meta)
    if (meta === undefined || offer === null) return []
    return [{ column: column.name, offer }]
  })
}

/** What the person has typed or chosen and not yet applied. An empty column is the first one offered. */
interface Draft extends ValueDraft {
  column: string
}

const EMPTY: Draft = { column: '', ...EMPTY_VALUES }

/**
 * The form that adds one condition: a column without one, an operator it
 * offers, and the value or the bounds its input asks for. Applied, it is
 * emptied for the next; refused, it keeps what was typed. With every
 * column already holding a condition, it says so instead.
 */
function AddCondition({ available, onAdd }: { available: Filterable[]; onAdd: (term: BrowseFilterTerm, focus: string) => Promise<boolean> }): ReactElement {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const chosen = available.find((entry) => entry.column === draft.column) ?? available[0]
  if (chosen === undefined) return <p className="none">Every column this page can be filtered by has a condition.</p>
  const { operators, input } = chosen.offer
  const op = chosenOp(chosen.offer, draft.op)
  const hint = hintOf(chosen.column, chosen.offer, op)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    // The column applied leaves the choice: after the last one the form is gone, and the keyboard goes to the button that opened it.
    const term: BrowseFilterTerm = { column: chosen.column, ...conditionOf(op, input, draft) }
    if (await onAdd(term, available.length > 1 ? 'filter-apply' : 'filter-toggle')) setDraft(EMPTY)
  }

  return (
    <form className="filter-add" aria-label="Add a condition" onSubmit={(event) => void submit(event)}>
      <div className="pair">
        <div className="field">
          <label htmlFor="filter-column">Column</label>
          <select id="filter-column" value={chosen.column} onChange={(event) => setDraft({ ...EMPTY, column: event.target.value })}>
            {available.map((entry) => (
              <option key={entry.column} value={entry.column}>
                {entry.column}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-op">Condition</label>
          <select id="filter-op" value={op} onChange={(event) => setDraft({ ...draft, column: chosen.column, op: event.target.value as FilterOp })}>
            {operators.map((operator) => (
              <option key={operator} value={operator}>
                {OPS[operator]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ConditionValues prefix="filter" op={op} input={input} draft={draft} hint={hint} onChange={(values) => setDraft({ ...draft, ...values, column: chosen.column })} />
      <div className="actions">
        <button type="submit" id="filter-apply" className="button">
          Apply
        </button>
      </div>
    </form>
  )
}

/**
 * A page's filter: the conditions it is filtered by, each removable on its
 * own and all of them at once, and a button that opens the form adding
 * one. Every change asks page one again through `onFilter`, which answers
 * whether the page arrived, and puts the keyboard on the element named
 * once it has: a Remove takes the button pressed with it, so the keyboard
 * goes to the Remove that takes its place, and after the last to the
 * button that opens the form.
 *
 * Mounted afresh for every page a move reaches, so the form starts shut
 * and empty there; a page, a sort or a condition keeps it as it is.
 */
export function FilterPanel({ columns, active, onFilter }: { columns: Filterable[]; active: BrowseFilterTerm[]; onFilter: (filter: BrowseFilterTerm[], focus: string) => Promise<boolean> }): ReactElement {
  const [open, setOpen] = useState(false)
  if (columns.length === 0 && active.length === 0) return <p className="hint">No column this page shows can be filtered.</p>
  const remove = (at: number) => {
    const rest = active.filter((_, index) => index !== at)
    void onFilter(rest, rest.length === 0 ? 'filter-toggle' : `filter-remove-${String(Math.min(at, rest.length - 1))}`)
  }
  const available = columns.filter((entry) => !active.some((term) => term.column === entry.column))
  return (
    <div className="browse-filter">
      {active.length === 0 ? null : (
        <div className="filter-conditions">
          <p id="filtered-by">Filtered by</p>
          <ul aria-labelledby="filtered-by">
            {active.map((term, index) => {
              const said = sayCondition(term.column, term)
              return (
                <li key={term.column}>
                  <span>{said}</span>
                  <button type="button" id={`filter-remove-${String(index)}`} className="filter-remove" onClick={() => remove(index)}>
                    Remove{' '}<span className="visually-hidden">{said}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <button type="button" className="button" onClick={() => void onFilter([], 'filter-toggle')}>
            Clear the filter
          </button>
        </div>
      )}
      <p className="actions">
        <button type="button" id="filter-toggle" className="button filter-toggle" aria-expanded={open} aria-controls={open ? 'filter-add' : undefined} onClick={() => setOpen((was) => !was)}>
          Filter rows
        </button>
      </p>
      {open ? (
        <div id="filter-add">
          <AddCondition available={available} onAdd={(term, focus) => onFilter([...active, term], focus)} />
        </div>
      ) : null}
    </div>
  )
}
