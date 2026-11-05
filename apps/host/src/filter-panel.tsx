import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { FilterInput, ListFilterTerm } from '@formancy/data-client'
import { conditionOf, draftFor, draftHint, OPERATOR_WORDS, withTerm } from './filter-terms.js'
import type { Draft, PanelField } from './filter-terms.js'

/*
 * A grid's condition builder (0104): the page's own controls, beside the
 * filter line (filter-line.tsx), never AG Grid's filter menus, whose words
 * would reach the person. One per grid -- the Records panel's, and each
 * child section's own -- each with its own filter.
 *
 * Behind a disclosure, as opening a record by its token is (record-bar.tsx):
 * a button that says whether it is expanded. Inside, a person picks a field
 * the server's `list.filterable` offers, by its label, one of the operators
 * it offers, and a value or the bounds of a range as its input says; Apply
 * puts the condition into the filter, in place of the one its field had,
 * and the grid starts again from its first page. What was typed stays, as
 * a search's text stays in its box: a condition the server refuses is
 * corrected where it was typed, and the refusal is said on the grid's line.
 * The conditions applied are the chips' (filter-chips.tsx).
 */

/** How a value of each input is typed: a date by the browser's date control, a number by a keypad where a device has one, the rest as text. */
const KEYPAD: Readonly<Partial<Record<FilterInput, 'numeric' | 'decimal'>>> = { integer: 'numeric', decimal: 'decimal' }

/** One box for a value or a bound, labelled. */
function Box({
  id,
  label,
  input,
  value,
  describedBy,
  onChange,
}: {
  id: string
  label: string
  input: FilterInput | null
  value: string
  describedBy: string | undefined
  onChange: (value: string) => void
}): ReactElement {
  const keypad = input === null ? undefined : KEYPAD[input]
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={input === 'date' ? 'date' : 'text'}
        {...(keypad === undefined ? {} : { inputMode: keypad })}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={describedBy}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

/** One choice of the panel's, labelled: a native select, whose keys are the browser's own. */
function Choice({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}): ReactElement {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** What the draft's operator asks for: nothing, a value -- yes or no for a boolean -- the text contains finds, or a range's two bounds. */
function Values({
  idBase,
  field,
  draft,
  describedBy,
  onDraft,
}: {
  idBase: string
  field: PanelField
  draft: Draft
  describedBy: string | undefined
  onDraft: (next: Draft) => void
}): ReactElement | null {
  const { op } = draft
  if (op === 'null' || op === 'not-null') return null
  if (op === 'range') {
    return (
      <>
        <Box
          id={`${idBase}-from`}
          label="From"
          input={field.input}
          value={draft.from}
          describedBy={describedBy}
          onChange={(from) => onDraft({ ...draft, from })}
        />
        <Box id={`${idBase}-to`} label="To" input={field.input} value={draft.to} describedBy={describedBy} onChange={(to) => onDraft({ ...draft, to })} />
      </>
    )
  }
  if (op === 'equals' && field.input === 'boolean') {
    return (
      <div className="field">
        <label htmlFor={`${idBase}-value`}>Value</label>
        <select
          id={`${idBase}-value`}
          aria-describedby={describedBy}
          value={draft.value}
          onChange={(event) => onDraft({ ...draft, value: event.target.value })}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </div>
    )
  }
  return (
    <Box
      id={`${idBase}-value`}
      label={op === 'contains' ? 'Text' : 'Value'}
      input={op === 'contains' ? 'text' : field.input}
      value={draft.value}
      describedBy={describedBy}
      onChange={(value) => onDraft({ ...draft, value })}
    />
  )
}

export function FilterPanel({
  idBase,
  fields,
  filter,
  onFilter,
}: {
  /** What every element id of the panel starts with: one panel per grid. */
  idBase: string
  /** The fields the Field menu offers: those the form's Filter panel offers (0123), never none. */
  fields: readonly PanelField[]
  /** The filter as applied: what the grid lists and a file holds. */
  filter: readonly ListFilterTerm[]
  onFilter: (next: ListFilterTerm[]) => void
}): ReactElement {
  const byField = new Map(fields.map((field) => [field.field, field]))
  const [open, setOpen] = useState(false)
  const first = fields[0] as PanelField
  const [draft, setDraft] = useState<Draft>(() => draftFor(first))
  /** Why the draft is not a condition yet, until it changes. */
  const [problem, setProblem] = useState('')
  const field = byField.get(draft.field) ?? first
  const hint = draftHint(draft, field)
  const held = filter.some((term) => term.field === draft.field)
  /** What describes the draft's controls: the hint and the field's condition already applied, when there are any. */
  const described = [hint === null ? null : `${idBase}-hint`, held ? `${idBase}-held` : null].filter((id) => id !== null).join(' ') || undefined

  const edit = (next: Draft): void => {
    setDraft(next)
    setProblem('')
  }

  /** Another field: its operator kept where it offers it, and what was typed kept where it is typed the same way. */
  const chooseField = (key: string): void => {
    const next = byField.get(key)
    if (next === undefined) return
    const fresh = draftFor(next)
    const op = next.operators.includes(draft.op) ? draft.op : fresh.op
    edit(next.input === field.input ? { ...draft, field: key, op } : { ...fresh, op })
  }

  function apply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const made = conditionOf(draft)
    if (!made.ok) {
      setProblem(made.problem)
      return
    }
    setProblem('')
    onFilter(withTerm(filter, made.term))
  }

  return (
    <>
      <button type="button" className="button quiet disclosure" aria-expanded={open} aria-controls={`${idBase}-tool`} onClick={() => setOpen(!open)}>
        <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12">
          <path d={open ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Build a condition
      </button>
      <div id={`${idBase}-tool`} hidden={!open}>
        <form className="filter-form" noValidate onSubmit={apply}>
          <Choice
            id={`${idBase}-field`}
            label="Field"
            value={draft.field}
            options={fields.map((choice) => ({ value: choice.field, label: choice.label }))}
            onChange={chooseField}
          />
          <Choice
            id={`${idBase}-op`}
            label="Condition"
            value={draft.op}
            options={field.operators.map((op) => ({ value: op, label: OPERATOR_WORDS[op] }))}
            onChange={(op) => edit({ ...draft, op: op as Draft['op'] })}
          />
          <Values idBase={idBase} field={field} draft={draft} describedBy={described} onDraft={edit} />
          <button
            type="submit"
            className="button"
            id={`${idBase}-apply`}
            aria-describedby={[described, `${idBase}-problem`].filter((id) => id !== undefined).join(' ')}
          >
            Apply
          </button>
          {hint === null ? null : (
            <p className="hint filter-hint" id={`${idBase}-hint`}>
              {hint}
            </p>
          )}
          {held ? (
            <p className="hint filter-hint" id={`${idBase}-held`}>
              Apply replaces the condition {field.label} has.
            </p>
          ) : null}
          <p role="status" id={`${idBase}-problem`} className="status filter-problem" data-kind="refused" aria-labelledby={`${idBase}-apply`}>
            {problem}
          </p>
        </form>
      </div>
    </>
  )
}
