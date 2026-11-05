import type { FormEvent, ReactElement } from 'react'
import type {
  FilterableField,
  FilterCondition,
  FilterInput,
  FilterOp,
  ListSortTerm,
  StoredListView,
  ViewCondition,
  ViewFilterTerm,
  ViewValue,
} from '@formancy/data-core'
import { Box, chosenOp, ConditionValues, conditionOf, draftOf, EMPTY_VALUES, hintOf, keptExclusive, OPS, sayCondition, sayRange } from './condition-draft.js'
import type { ValueDraft } from './condition-draft.js'
import { sayValue } from './related.js'
import { RolesInput } from './roles-input.js'

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

/**
 * One condition row as typed: its field, and its values as the Browse step's
 * boxes hold them -- or, `relative` (0125), whole days from today in them,
 * or the name of the signed-in person's attribute in `value`.
 */
interface TermDraft extends ValueDraft {
  field: string
  relative?: 'today' | 'attribute'
}

/** The inputs an attribute -- text -- may be compared with for equality (0125). */
const ATTRIBUTE_INPUTS: ReadonlySet<FilterInput> = new Set(['text', 'integer', 'uuid'])

/** A row's relative value as it is stored: whole days from today, a bound left empty none; or an attribute's name. */
function relativeOf(row: TermDraft, typed: string): ViewValue | null {
  if (typed.trim() === '') return null
  return row.relative === 'attribute' ? { attribute: typed.trim() } : { today: Number(typed.trim()) }
}

/** A stored condition back in its boxes: a relative value as the row types it. */
function rowOf(term: ViewFilterTerm): TermDraft {
  const typed = (value: ViewValue | null): string =>
    value === null ? '' : typeof value === 'string' ? value : 'today' in value ? String(value.today) : value.attribute
  const relative = (value: ViewValue | null) => value !== null && typeof value !== 'string'
  if (term.op === 'equals' && typeof term.value !== 'string')
    return { ...EMPTY_VALUES, field: term.field, op: 'equals', value: typed(term.value), relative: 'today' in term.value ? 'today' : 'attribute' }
  if (term.op === 'range' && (relative(term.from) || relative(term.to))) {
    const exclusive = term.exclusive === undefined ? {} : { exclusive: term.exclusive }
    return { ...EMPTY_VALUES, field: term.field, op: 'range', from: typed(term.from), to: typed(term.to), ...exclusive, relative: 'today' }
  }
  return { ...draftOf(term as FilterCondition), field: term.field }
}

/** A view as the form holds it until it is saved. */
export interface ViewDraft {
  name: string
  filter: TermDraft[]
  sort: ListSortTerm[]
  opens: boolean
  /** The roles it is offered to (0124); none, everyone. */
  roles: string[]
}

export const EMPTY_VIEW: ViewDraft = { name: '', filter: [], sort: [], opens: false, roles: [] }

/** A saved view back in the form, to be edited: each condition in the boxes `conditionOf` reads. */
export function draftOfView(view: StoredListView): ViewDraft {
  return {
    name: view.name,
    filter: view.filter.map(rowOf),
    sort: view.sort.map((term) => ({ ...term })),
    opens: view.default === true,
    roles: [...(view.roles ?? [])],
  }
}

/**
 * The view a draft asks for: its name trimmed, as a picker shows it, and
 * each condition as `conditionOf` reads its boxes for its field's offer. A
 * row on a field the list does not offer is kept as typed, for the fit to
 * refuse in its words: left out, it would save a wider view than was asked.
 */
export function viewOf(draft: ViewDraft, offers: readonly FilterableField[]): StoredListView {
  const filter = draft.filter.map((row): ViewFilterTerm => {
    const offer = offers.find((entry) => entry.field === row.field)
    const op = offer === undefined ? (row.op ?? 'equals') : chosenOp(offer, row.op)
    if (row.relative !== undefined && op === 'equals') return { field: row.field, op, value: relativeOf(row, row.value) ?? '' }
    if (row.relative === 'today' && op === 'range') {
      const [from, to] = [relativeOf(row, row.from), relativeOf(row, row.to)]
      const exclusive = keptExclusive(row.exclusive, from, to)
      return { field: row.field, op, from, to, ...(exclusive === undefined ? {} : { exclusive }) }
    }
    return { field: row.field, ...conditionOf(op, offer?.input ?? null, row) }
  })
  return {
    name: draft.name.trim(),
    filter,
    sort: draft.sort.map((term) => ({ ...term })),
    ...(draft.opens ? { default: true as const } : {}),
    ...(draft.roles.length === 0 ? {} : { roles: [...draft.roles] }),
  }
}

/** A relative value in words (0125): a day counted from today, or the signed-in person's attribute. */
function sayRelative(value: Exclude<ViewValue, string>): string {
  if ('attribute' in value) return `your ${value.attribute}`
  const days = value.today
  if (days === 0) return 'today'
  if (days === -1) return 'yesterday'
  if (days === 1) return 'tomorrow'
  return days < 0 ? `${String(-days)} days before today` : `${String(days)} days after today`
}

/** A view's condition in words, as `sayCondition` says a typed one, a relative value by what it stands for. */
export function sayViewCondition(subject: string, condition: ViewCondition): string {
  const say = (value: ViewValue): string => (typeof value === 'string' ? sayValue(value) : sayRelative(value))
  if (condition.op === 'equals' && typeof condition.value !== 'string') return `${subject} = ${say(condition.value)}`
  if (condition.op === 'range' && [condition.from, condition.to].some((bound) => bound !== null && typeof bound !== 'string'))
    return sayRange(subject, condition.from, condition.to, condition.exclusive, say)
  return sayCondition(subject, condition as FilterCondition)
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

/**
 * The boxes of a relative value (0125): whole days from today, a bound each
 * for a range; or the name of an attribute. Typed as text, and read when the
 * view is saved, where the server's own shape check says what is wrong.
 */
function RelativeValues({
  prefix,
  op,
  relative,
  row,
  onRow,
}: {
  prefix: string
  op: FilterOp
  relative: 'today' | 'attribute'
  row: TermDraft
  onRow: (row: TermDraft) => void
}): ReactElement {
  const hint = `${prefix}-hint`
  return (
    <>
      {op === 'range' ? (
        <div className="pair">
          <Box id={`${prefix}-from`} label="From, days from today" input="text" value={row.from} hint={hint} onChange={(from) => onRow({ ...row, from })} />
          <Box id={`${prefix}-to`} label="To, days from today" input="text" value={row.to} hint={hint} onChange={(to) => onRow({ ...row, to })} />
        </div>
      ) : (
        <Box
          id={`${prefix}-value`}
          label={relative === 'today' ? 'Days from today' : 'Attribute'}
          input="text"
          value={row.value}
          hint={hint}
          onChange={(value) => onRow({ ...row, value })}
        />
      )}
      <p id={hint} className="hint">
        {relative === 'today'
          ? 'Whole days from the day a person is offered the view: -7 a week before, 0 that day. Either bound may be left empty.'
          : "The attribute's name, as the host's token carries it -- employee, say: each person is compared with their own value."}
      </p>
    </>
  )
}

/** One condition: a field by its label, an operator it offers, and the Browse step's boxes and hint for them -- or a relative value's (0125). */
function ConditionRow({ index, row, offers, label, onRow, onRemove }: ConditionRowProps): ReactElement {
  const id = `view-condition-${String(index)}`
  const offer = offers.find((entry) => entry.field === row.field)
  const op = offer === undefined ? (row.op ?? 'equals') : chosenOp(offer, row.op)
  const input = offer?.input ?? null
  // What the field and the operator let a value be relative to: a day where its values are dates, the person where an equality reads text.
  const mayCount = input === 'date' && (op === 'equals' || op === 'range')
  const mayAttribute = op === 'equals' && input !== null && ATTRIBUTE_INPUTS.has(input)
  const relative = (row.relative === 'today' && mayCount) || (row.relative === 'attribute' && mayAttribute) ? row.relative : undefined
  /** Values typed for one kind mean nothing to another: switching empties them. */
  const toggle = (kind: 'today' | 'attribute', on: boolean): void => {
    const { relative: _relative, ...rest } = row
    onRow({ ...rest, value: '', from: '', to: '', ...(on ? { relative: kind } : {}) })
  }
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
      {relative === undefined ? (
        <ConditionValues
          prefix={id}
          op={op}
          input={input}
          draft={row}
          hint={offer === undefined ? null : hintOf(label(row.field), offer, op, row.exclusive)}
          onChange={(values) => onRow({ ...row, ...values })}
        />
      ) : (
        <RelativeValues prefix={id} op={op} relative={relative} row={row} onRow={onRow} />
      )}
      {mayCount ? (
        <div className="check">
          <input type="checkbox" id={`${id}-today`} checked={relative === 'today'} onChange={(event) => toggle('today', event.target.checked)} />
          <label htmlFor={`${id}-today`}>Count in days from today</label>
        </div>
      ) : null}
      {mayAttribute ? (
        <div className="check">
          <input type="checkbox" id={`${id}-attribute`} checked={relative === 'attribute'} onChange={(event) => toggle('attribute', event.target.checked)} />
          <label htmlFor={`${id}-attribute`}>Equals the signed-in person’s attribute</label>
        </div>
      ) : null}
      <p className="actions">
        <button type="button" id={`${id}-remove`} className="button" onClick={onRemove}>
          Remove <span className="visually-hidden">condition {index + 1}</span>
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
          <select
            id={`${id}-direction`}
            value={term.direction}
            onChange={(event) => onTerm({ ...term, direction: event.target.value === 'desc' ? 'desc' : 'asc' })}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
      </div>
      <p className="actions">
        <button type="button" id={`${id}-remove`} className="button" onClick={onRemove}>
          Remove <span className="visually-hidden">sort {index + 1}</span>
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
          <span className="none">
            {offers.length === 0 ? 'No field of this form’s list can be filtered.' : 'Every field this list can be filtered by has a condition.'}
          </span>
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
          <span className="none">
            {sortable.length === 0 ? 'No field of this form’s list can be sorted by.' : 'Every field this list can be sorted by is in the order.'}
          </span>
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
      <RolesInput id="view-roles" label="Offered to roles, empty for everyone" roles={draft.roles} onRoles={(roles) => onDraft({ ...draft, roles })} />
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
