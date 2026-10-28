import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { filterOffer } from '@formancy/data-core'
import type { BrowseFilterTerm, FilterCondition, FilterInput, FilterOffer, FilterOp, ObjectMeta, RecordColumn } from '@formancy/data-core'
import { sayValue } from './related.js'

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

/** A condition as a page says it: `status = shipped`, `amount from 1 to 5`, `name contains “gmbh”`, `notes is NULL`. */
export function sayCondition(term: BrowseFilterTerm): string {
  switch (term.op) {
    case 'equals':
      return `${term.column} = ${sayValue(term.value)}`
    case 'contains':
      return `${term.column} contains “${term.text}”`
    case 'null':
      return `${term.column} is NULL`
    case 'not-null':
      return `${term.column} is not NULL`
    case 'range':
      if (term.from !== null && term.to !== null) return `${term.column} from ${sayValue(term.from)} to ${sayValue(term.to)}`
      return term.from !== null ? `${term.column} from ${sayValue(term.from)}` : `${term.column} up to ${sayValue(term.to ?? '')}`
  }
}

/** What the Condition select calls each operator. */
const OPS: Readonly<Record<FilterOp, string>> = { equals: 'equals', range: 'is in a range', contains: 'contains', null: 'is NULL', 'not-null': 'is not NULL' }

/** What the person has typed or chosen and not yet applied. An empty column or operator is the first one offered. */
interface Draft {
  column: string
  op: FilterOp | null
  value: string
  from: string
  to: string
}

const EMPTY: Draft = { column: '', op: null, value: '', from: '', to: '' }

/**
 * The condition a draft asks for. Text is sent exactly as typed: equality
 * is the whole value, spaces included. Anything else is trimmed, as the
 * server trims it, so the page says the value compared; a contains is
 * trimmed as the search box is; and an empty bound is no bound.
 */
function conditionOf(op: FilterOp, input: FilterInput | null, draft: Draft): FilterCondition {
  const typed = (given: string) => (input === 'text' ? given : given.trim())
  const bound = (given: string) => (given.trim() === '' ? null : given.trim())
  switch (op) {
    case 'equals':
      return { op, value: input === 'boolean' ? (draft.value === 'false' ? 'false' : 'true') : typed(draft.value) }
    case 'contains':
      return { op, text: draft.value.trim() }
    case 'range':
      return { op, from: bound(draft.from), to: bound(draft.to) }
    case 'null':
    case 'not-null':
      return { op }
  }
}

/** What the form says under its boxes about the condition chosen, or nothing. */
function hintOf(chosen: Filterable, op: FilterOp): string | null {
  const either = 'Either may be left empty.'
  const span = 'from the start of the day From names to the end of the day To names.'
  if (op === 'range' && chosen.offer.days === 'utc') return `${chosen.column} is filtered by whole days in UTC: ${span} ${either}`
  if (op === 'range' && chosen.offer.days === 'wall') return `${chosen.column} holds no time zone, so it is filtered by whole days as its values are written: ${span} ${either}`
  if (op === 'range') return 'From and To are both included, and either may be left empty.'
  if (op === 'contains') return 'Found anywhere in the value, as the search finds it.'
  if (chosen.offer.input === 'text' && op === 'equals') return 'The whole value, exactly: case and spaces count.'
  if (chosen.offer.input === 'text' && op === 'null') return 'Text of no characters is a value, not NULL.'
  return null
}

/** One box of the form, typed as its input asks: a day as a date, anything else as text, a boolean chosen. */
function Box({ id, label, input, value, hint, onChange }: { id: string; label: string; input: FilterInput | null; value: string; hint: string | null; onChange: (value: string) => void }): ReactElement {
  const described = hint === null ? undefined : 'filter-hint'
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input === 'boolean' ? (
        <select id={id} value={value === 'false' ? 'false' : 'true'} aria-describedby={described} onChange={(event) => onChange(event.target.value)}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input id={id} type={input === 'date' ? 'date' : 'text'} value={value} autoComplete="off" spellCheck={false} aria-describedby={described} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  )
}

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
  const op = draft.op !== null && operators.includes(draft.op) ? draft.op : (operators[0] as FilterOp)
  const hint = hintOf(chosen, op)

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
      {op === 'equals' || op === 'contains' ? (
        <Box id="filter-value" label={op === 'equals' ? 'Value' : 'Text'} input={op === 'contains' ? 'text' : input} value={draft.value} hint={hint} onChange={(value) => setDraft({ ...draft, column: chosen.column, value })} />
      ) : null}
      {op === 'range' ? (
        <div className="pair">
          <Box id="filter-from" label="From" input={input} value={draft.from} hint={hint} onChange={(from) => setDraft({ ...draft, column: chosen.column, from })} />
          <Box id="filter-to" label="To" input={input} value={draft.to} hint={hint} onChange={(to) => setDraft({ ...draft, column: chosen.column, to })} />
        </div>
      ) : null}
      {hint === null ? null : (
        <p id="filter-hint" className="hint">
          {hint}
        </p>
      )}
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
              const said = sayCondition(term)
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
