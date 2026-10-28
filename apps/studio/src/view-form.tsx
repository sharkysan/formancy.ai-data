import type { FormEvent, ReactElement } from 'react'
import type { FilterableField, FilterOp, ListSortTerm, ListView } from '@formancy/data-core'
import { chosenOp, ConditionValues, conditionOf, draftOf, EMPTY_VALUES, hintOf, OPS } from './condition-draft.js'
import type { ValueDraft } from './condition-draft.js'

/*
 * The form that makes a list view or edits one (0105): what is typed, and
 * the view it asks for. Which views there are, and what saving one does to
 * them, is the panel's (`list-views.tsx`).
 */

/** Where the keyboard goes: the form's name and its Save, which the panel names too, and the buttons that add a row. */
export const VIEW_NAME = 'view-name'
export const VIEW_SAVE = 'view-save'
const ADD_CONDITION = 'view-add-condition'
const ADD_SORT = 'view-add-sort'

/** One condition row as typed: its field, and its values as the Browse step's boxes hold them. */
interface TermDraft extends ValueDraft {
  field: string
}

/** A view as the form holds it until it is saved. */
export interface ViewDraft {
  name: string
  filter: TermDraft[]
  sort: ListSortTerm[]
  opens: boolean
}

export const EMPTY_VIEW: ViewDraft = { name: '', filter: [], sort: [], opens: false }

/** A saved view back in the form, to be edited: each condition in the boxes `conditionOf` reads. */
export function draftOfView(view: ListView): ViewDraft {
  return { name: view.name, filter: view.filter.map((term) => ({ ...draftOf(term), field: term.field })), sort: view.sort.map((term) => ({ ...term })), opens: view.default === true }
}

/**
 * The view a draft asks for: its name trimmed, as a picker shows it, and
 * each condition as `conditionOf` reads its boxes for its field's offer. A
 * row on a field the list does not offer is kept as typed, for the fit to
 * refuse in its words: left out, it would save a wider view than was asked.
 */
export function viewOf(draft: ViewDraft, offers: readonly FilterableField[]): ListView {
  const filter = draft.filter.map((row) => {
    const offer = offers.find((entry) => entry.field === row.field)
    return { field: row.field, ...conditionOf(offer === undefined ? (row.op ?? 'equals') : chosenOp(offer, row.op), offer?.input ?? null, row) }
  })
  return { name: draft.name.trim(), filter, sort: draft.sort.map((term) => ({ ...term })), ...(draft.opens ? { default: true as const } : {}) }
}

/** The fields the rows of `rows` other than the one at `except` name: a list request names each field once. */
const takenBy = (rows: ReadonlyArray<{ field: string }>, except: number) => new Set(rows.filter((_, index) => index !== except).map((row) => row.field))

interface ConditionRowProps {
  index: number
  row: TermDraft
  /** The fields this row may name: those offered that no other row names. */
  offers: readonly FilterableField[]
  label: (key: string) => string
  onRow: (row: TermDraft) => void
  onRemove: () => void
}

/** One condition: a field by its label, an operator it offers, and the Browse step's boxes and hint for them. */
function ConditionRow({ index, row, offers, label, onRow, onRemove }: ConditionRowProps): ReactElement {
  const id = `view-condition-${String(index)}`
  const offer = offers.find((entry) => entry.field === row.field)
  const op = offer === undefined ? (row.op ?? 'equals') : chosenOp(offer, row.op)
  return (
    <fieldset className="view-term">
      <legend>Condition {index + 1}</legend>
      <div className="pair">
        <div className="field">
          <label htmlFor={`${id}-field`}>Field</label>
          {/* Another field asks for other boxes: what was typed for this one goes. */}
          <select id={`${id}-field`} value={row.field} onChange={(event) => onRow({ field: event.target.value, ...EMPTY_VALUES })}>
            {offers.map((entry) => (
              <option key={entry.field} value={entry.field}>
                {label(entry.field)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-op`}>Condition</label>
          <select id={`${id}-op`} value={op} onChange={(event) => onRow({ ...row, op: event.target.value as FilterOp })}>
            {(offer?.operators ?? [op]).map((operator) => (
              <option key={operator} value={operator}>
                {OPS[operator]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ConditionValues
        prefix={id}
        op={op}
        input={offer?.input ?? null}
        draft={row}
        hint={offer === undefined ? null : hintOf(label(row.field), offer, op)}
        onChange={(values) => onRow({ ...row, ...values })}
      />
      <p className="actions">
        <button type="button" id={`${id}-remove`} className="button" onClick={onRemove}>
          Remove{' '}<span className="visually-hidden">condition {index + 1}</span>
        </button>
      </p>
    </fieldset>
  )
}

interface SortRowProps {
  index: number
  term: ListSortTerm
  /** The fields this row may sort by: those offered that no other row names. */
  sortable: readonly string[]
  label: (key: string) => string
  onTerm: (term: ListSortTerm) => void
  onRemove: () => void
}

/** One field of the order, by its label, and its direction. */
function SortRow({ index, term, sortable, label, onTerm, onRemove }: SortRowProps): ReactElement {
  const id = `view-sort-${String(index)}`
  return (
    <fieldset className="view-term">
      <legend>Sort {index + 1}</legend>
      <div className="pair">
        <div className="field">
          <label htmlFor={`${id}-field`}>Sort by</label>
          <select id={`${id}-field`} value={term.field} onChange={(event) => onTerm({ ...term, field: event.target.value })}>
            {sortable.map((field) => (
              <option key={field} value={field}>
                {label(field)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-direction`}>Direction</label>
          <select id={`${id}-direction`} value={term.direction} onChange={(event) => onTerm({ ...term, direction: event.target.value === 'desc' ? 'desc' : 'asc' })}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
      </div>
      <p className="actions">
        <button type="button" id={`${id}-remove`} className="button" onClick={onRemove}>
          Remove{' '}<span className="visually-hidden">sort {index + 1}</span>
        </button>
      </p>
    </fieldset>
  )
}

export interface ViewFormProps {
  heading: string
  draft: ViewDraft
  /** What the form's list offers anybody, from `listColumns` over every field. */
  offers: readonly FilterableField[]
  sortable: readonly string[]
  label: (key: string) => string
  /** Why the last save was refused, in the server's checks' words; `[]` for none. */
  refused: readonly string[]
  focusAfter: (id: string) => void
  onDraft: (draft: ViewDraft) => void
  onSave: (event: FormEvent) => void
}

/**
 * The form: the view's name; its conditions, one row each, each on a field
 * no other row names; its order, a row per field, in the order they sort;
 * and whether the grid opens on it. A row added takes the keyboard to its
 * field; a row removed gives it to the Remove that takes its place, and
 * after the last to the button that adds one. With every field taken, the
 * button is gone and the form says so.
 */
export function ViewForm({ heading, draft, offers, sortable, label, refused, focusAfter, onDraft, onSave }: ViewFormProps): ReactElement {
  const freeOffer = offers.find((entry) => !takenBy(draft.filter, -1).has(entry.field))
  const freeSort = sortable.find((field) => !takenBy(draft.sort, -1).has(field))

  function addTerm(offer: FilterableField): void {
    onDraft({ ...draft, filter: [...draft.filter, { field: offer.field, ...EMPTY_VALUES }] })
    focusAfter(`view-condition-${String(draft.filter.length)}-field`)
  }

  function removeTerm(at: number): void {
    const rest = draft.filter.filter((_, index) => index !== at)
    onDraft({ ...draft, filter: rest })
    focusAfter(at < rest.length ? `view-condition-${String(at)}-remove` : ADD_CONDITION)
  }

  function addSort(field: string): void {
    onDraft({ ...draft, sort: [...draft.sort, { field, direction: 'asc' }] })
    focusAfter(`view-sort-${String(draft.sort.length)}-field`)
  }

  function removeSort(at: number): void {
    const rest = draft.sort.filter((_, index) => index !== at)
    onDraft({ ...draft, sort: rest })
    focusAfter(at < rest.length ? `view-sort-${String(at)}-remove` : ADD_SORT)
  }

  return (
    <form className="view-form" aria-labelledby="view-form-heading" onSubmit={onSave}>
      <h4 id="view-form-heading">{heading}</h4>
      <div className="field">
        <label htmlFor={VIEW_NAME}>Name</label>
        <input id={VIEW_NAME} value={draft.name} autoComplete="off" onChange={(event) => onDraft({ ...draft, name: event.target.value })} />
      </div>
      {draft.filter.length === 0 ? null : (
        <ol className="view-rows">
          {draft.filter.map((row, index) => (
            // A row has no identity but its place: every box is controlled by the draft, so nothing typed moves with a removal.
            <li key={index}>
              <ConditionRow
                index={index}
                row={row}
                offers={offers.filter((entry) => !takenBy(draft.filter, index).has(entry.field))}
                label={label}
                onRow={(next) => onDraft({ ...draft, filter: draft.filter.map((entry, at) => (at === index ? next : entry)) })}
                onRemove={() => removeTerm(index)}
              />
            </li>
          ))}
        </ol>
      )}
      <p className="actions">
        {freeOffer === undefined ? (
          <span className="none">{offers.length === 0 ? 'No field of this form’s list can be filtered.' : 'Every field this list can be filtered by has a condition.'}</span>
        ) : (
          <button type="button" id={ADD_CONDITION} className="button" onClick={() => addTerm(freeOffer)}>
            Add condition
          </button>
        )}
      </p>
      {draft.sort.length === 0 ? null : (
        <ol className="view-rows">
          {draft.sort.map((term, index) => (
            <li key={index}>
              <SortRow
                index={index}
                term={term}
                sortable={sortable.filter((field) => !takenBy(draft.sort, index).has(field))}
                label={label}
                onTerm={(next) => onDraft({ ...draft, sort: draft.sort.map((entry, at) => (at === index ? next : entry)) })}
                onRemove={() => removeSort(index)}
              />
            </li>
          ))}
        </ol>
      )}
      <p className="actions">
        {freeSort === undefined ? (
          <span className="none">{sortable.length === 0 ? 'No field of this form’s list can be sorted by.' : 'Every field this list can be sorted by is in the order.'}</span>
        ) : (
          <button type="button" id={ADD_SORT} className="button" onClick={() => addSort(freeSort)}>
            Add sort
          </button>
        )}
      </p>
      <div className="check">
        <input type="checkbox" id="view-default" checked={draft.opens} onChange={(event) => onDraft({ ...draft, opens: event.target.checked })} />
        <label htmlFor="view-default">The grid opens on this view</label>
      </div>
      {refused.length === 0 ? null : (
        <div role="alert" className="problem-box">
          <p>The view was not saved:</p>
          <ul>
            {refused.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="actions">
        <button type="submit" id={VIEW_SAVE} className="button">
          Save view
        </button>
      </p>
    </form>
  )
}
