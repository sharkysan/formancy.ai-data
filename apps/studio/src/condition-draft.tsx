import type { ReactElement } from 'react'
import type { FilterCondition, FilterInput, FilterOffer, FilterOp } from '@formancy/data-core'
import { sayValue } from './related.js'

/*
 * One condition as a person types it (0104), wherever the studio asks for
 * one: a browsed page's filter, over a column, and a list view's (0105),
 * over a field. What `filterOffer` offers its subject decides the
 * operators, the boxes and what they are typed as; this module turns what
 * was typed into the condition a request carries, says the condition in
 * words, and draws the boxes with the hint under them. One place, so the
 * Browse step and a view never disagree about what a typed value means.
 */

/** What the Condition select calls each operator. */
export const OPS: Readonly<Record<FilterOp, string>> = { equals: 'equals', range: 'is in a range', contains: 'contains', null: 'is NULL', 'not-null': 'is not NULL' }

/** What has been typed or chosen for one condition's values, and not yet sent. An operator of `null` is the first one offered. */
export interface ValueDraft {
  op: FilterOp | null
  value: string
  from: string
  to: string
}

export const EMPTY_VALUES: ValueDraft = { op: null, value: '', from: '', to: '' }

/** The operator a draft asks for: its own when its subject offers it, and otherwise the first one offered. */
export function chosenOp(offer: FilterOffer, op: FilterOp | null): FilterOp {
  return op !== null && offer.operators.includes(op) ? op : (offer.operators[0] as FilterOp)
}

/**
 * The condition a draft asks for. Text is sent exactly as typed: equality
 * is the whole value, spaces included. Anything else is trimmed, as the
 * server trims it, so the page says the value compared; a contains is
 * trimmed as the search box is; and an empty bound is no bound.
 */
export function conditionOf(op: FilterOp, input: FilterInput | null, draft: ValueDraft): FilterCondition {
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

/** A condition back in its boxes, as `conditionOf` would read it again: how a saved view is opened to be edited. */
export function draftOf(condition: FilterCondition): ValueDraft {
  switch (condition.op) {
    case 'equals':
      return { ...EMPTY_VALUES, op: condition.op, value: condition.value }
    case 'contains':
      return { ...EMPTY_VALUES, op: condition.op, value: condition.text }
    case 'range':
      return { ...EMPTY_VALUES, op: condition.op, from: condition.from ?? '', to: condition.to ?? '' }
    case 'null':
    case 'not-null':
      return { ...EMPTY_VALUES, op: condition.op }
  }
}

/** A condition on `subject` as a sentence says it: `status = shipped`, `amount from 1 to 5`, `name contains “gmbh”`, `notes is NULL`. */
export function sayCondition(subject: string, condition: FilterCondition): string {
  switch (condition.op) {
    case 'equals':
      return `${subject} = ${sayValue(condition.value)}`
    case 'contains':
      return `${subject} contains “${condition.text}”`
    case 'null':
      return `${subject} is NULL`
    case 'not-null':
      return `${subject} is not NULL`
    case 'range':
      if (condition.from !== null && condition.to !== null) return `${subject} from ${sayValue(condition.from)} to ${sayValue(condition.to)}`
      return condition.from !== null ? `${subject} from ${sayValue(condition.from)}` : `${subject} up to ${sayValue(condition.to ?? '')}`
  }
}

/** What the form says under its boxes about the condition chosen on `subject`, or nothing. */
export function hintOf(subject: string, offer: FilterOffer, op: FilterOp): string | null {
  const either = 'Either may be left empty.'
  const span = 'from the start of the day From names to the end of the day To names.'
  if (op === 'range' && offer.days === 'utc') return `${subject} is filtered by whole days in UTC: ${span} ${either}`
  if (op === 'range' && offer.days === 'wall') return `${subject} holds no time zone, so it is filtered by whole days as its values are written: ${span} ${either}`
  if (op === 'range') return 'From and To are both included, and either may be left empty.'
  if (op === 'contains') return 'Found anywhere in the value, as the search finds it.'
  if (offer.input === 'text' && op === 'equals') return 'The whole value, exactly: case and spaces count.'
  if (offer.input === 'text' && op === 'null') return 'Text of no characters is a value, not NULL.'
  return null
}

/** One box, typed as its input asks: a day as a date, anything else as text, a boolean chosen. */
function Box({ id, label, input, value, hint, onChange }: { id: string; label: string; input: FilterInput | null; value: string; hint: string | null; onChange: (value: string) => void }): ReactElement {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input === 'boolean' ? (
        <select id={id} value={value === 'false' ? 'false' : 'true'} aria-describedby={hint ?? undefined} onChange={(event) => onChange(event.target.value)}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input id={id} type={input === 'date' ? 'date' : 'text'} value={value} autoComplete="off" spellCheck={false} aria-describedby={hint ?? undefined} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  )
}

/**
 * The boxes an operator asks for -- one Value, or one Text for a contains;
 * From and To for a range; none for NULL or not -- each with the id
 * `prefix` and its name, and the hint under them, which describes each box.
 */
export function ConditionValues({
  prefix,
  op,
  input,
  draft,
  hint,
  onChange,
}: {
  prefix: string
  op: FilterOp
  input: FilterInput | null
  draft: ValueDraft
  hint: string | null
  onChange: (draft: ValueDraft) => void
}): ReactElement {
  const described = hint === null ? null : `${prefix}-hint`
  return (
    <>
      {op === 'equals' || op === 'contains' ? (
        <Box id={`${prefix}-value`} label={op === 'equals' ? 'Value' : 'Text'} input={op === 'contains' ? 'text' : input} value={draft.value} hint={described} onChange={(value) => onChange({ ...draft, value })} />
      ) : null}
      {op === 'range' ? (
        <div className="pair">
          <Box id={`${prefix}-from`} label="From" input={input} value={draft.from} hint={described} onChange={(from) => onChange({ ...draft, from })} />
          <Box id={`${prefix}-to`} label="To" input={input} value={draft.to} hint={described} onChange={(to) => onChange({ ...draft, to })} />
        </div>
      ) : null}
      {hint === null ? null : (
        <p id={`${prefix}-hint`} className="hint">
          {hint}
        </p>
      )}
    </>
  )
}
