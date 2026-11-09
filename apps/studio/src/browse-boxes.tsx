import { useState } from 'react'
import type { Dispatch, KeyboardEvent, ReactElement, SetStateAction } from 'react'
import { headerCondition, headerText } from '@formancy/data-core'
import type { BrowseFilterTerm, LineField, RecordColumn } from '@formancy/data-core'
import { asLine, sameFilter, withCondition } from './browse-terms.js'
import type { FilterChange } from './browse-terms.js'

/*
 * Each column header's filter box (0147): a row of the table's header,
 * under the row that sorts, with a box under each column the line can
 * name, named "Filter" and the column's name. What is typed is read as the
 * filter line reads it with the column's name in front (data-core's
 * `headerCondition`), so a box is the line's condition on one column and
 * nothing the line could not say: Enter, or leaving the box, applies it,
 * and Esc gives an edit up. A refusal, the line's or the server's, is said
 * where the step speaks, in its alert, which the box owns -- kept through
 * other pages, the box described by it and marked invalid -- until the box
 * changes, is given up or applies; what was typed is kept until a page
 * under it has arrived, and leaving the box again sends what was refused
 * no more. A boolean offers its two values in a select. A column the line
 * cannot name has no box.
 */

/** Whether an input method is composing a word, whose Enter and Esc are its own; 229 is what Safari reports for the last key of one. */
const composing = (event: KeyboardEvent): boolean => event.nativeEvent.isComposing || event.keyCode === 229

/** The step's alert, which a box it owns is described by. */
const ALERT = 'browse-refusal'

interface BoxProps {
  field: LineField
  /** The filter of the page on screen, which a text box shows. */
  filter: readonly BrowseFilterTerm[]
  /** The filter as it will stand once what is on its way has arrived, which a select shows. */
  ahead: readonly BrowseFilterTerm[]
  onFilter: FilterChange
  /** The box whose refusal the step's alert says, if one's. */
  refusedBy: string | null
  onRefused: (message: string, owner: string) => void
  onUnsaid: (owner: string) => void
}

/** The row of boxes, one cell under each header: empty under Related, and under a column the line cannot name. */
export function HeaderBoxes({
  columns,
  relating,
  fields,
  ...box
}: { columns: readonly RecordColumn[]; relating: boolean; fields: readonly LineField[] } & Omit<BoxProps, 'field'>): ReactElement {
  return (
    <tr className="boxes">
      {relating ? <td /> : null}
      {columns.map((column) => {
        const field = fields.find((entry) => entry.field === column.name)
        return (
          <td key={column.name}>
            {field === undefined ? null : field.input === 'boolean' ? <ChoiceBox field={field} {...box} /> : <TextBox field={field} {...box} />}
          </td>
        )
      })}
    </tr>
  )
}

/** The condition `filter` has on `field`'s column, as the line's reader holds it. */
const conditionOn = (filter: readonly BrowseFilterTerm[], field: LineField) => asLine(filter.filter((term) => term.column === field.field))[0]

/**
 * What the person typed since the box last showed its column's condition,
 * null while it shows it; dropped when the filter changes while the person
 * is elsewhere -- Clear the filter, a chip, the line -- as the line's edit
 * is, unless it is `sent`, on its way. Followed while rendering.
 */
function useDraft(filter: readonly BrowseFilterTerm[], focused: boolean, sent: string | null): [string | null, Dispatch<SetStateAction<string | null>>] {
  const [draft, setDraft] = useState<string | null>(null)
  const now = JSON.stringify(filter)
  const [followed, setFollowed] = useState(now)
  if (followed !== now) {
    setFollowed(now)
    if (!focused && (draft === null || draft !== sent)) setDraft(null)
  }
  return [draft, setDraft]
}

function TextBox({ field, filter, onFilter, refusedBy, onRefused, onUnsaid }: BoxProps): ReactElement {
  const owner = field.field
  const [focused, setFocused] = useState(false)
  /** What the box applied and whose page has not arrived yet. */
  const [sent, setSent] = useState<string | null>(null)
  const [draft, setDraft] = useDraft(filter, focused, sent)
  /** The text last refused, the line's way or the server's, so leaving the box does not send or say it again. */
  const [refused, setRefused] = useState<string | null>(null)
  const invalid = draft !== null && draft === refused

  /** Says no longer what this box had refused. */
  function unsay(): void {
    setRefused(null)
    onUnsaid(owner)
  }

  function apply(leaving: boolean): void {
    if (draft === null || (leaving && refused === draft)) return
    const read = headerCondition(draft, field)
    if (!read.ok) {
      if (refused !== draft) onRefused(read.message, owner)
      setRefused(draft)
      return
    }
    if (sameFilter(withCondition(filter, owner, read.term), filter)) {
      setDraft(null)
      unsay()
      return
    }
    // Once the page has arrived the box shows its column's condition, unless the person typed on while it was on its way.
    const applying = draft
    setSent(applying)
    const arrived = (): void => {
      setDraft((now) => (now === applying ? null : now))
      unsay()
    }
    void onFilter((base) => withCondition(base, owner, read.term), { arrived, owner }).then((done) => {
      setSent(null)
      if (!done) setRefused(applying)
    })
  }

  return (
    <input
      type="text"
      className="header-box"
      aria-label={`Filter ${field.label}`}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={invalid && refusedBy === owner ? ALERT : undefined}
      autoComplete="off"
      spellCheck={false}
      value={draft ?? headerText(conditionOn(filter, field), field)}
      onChange={(event) => {
        setDraft(event.target.value)
        if (refused !== null) unsay()
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        apply(true)
      }}
      onKeyDown={(event) => {
        if (composing(event)) return
        if (event.key === 'Enter') {
          event.preventDefault()
          apply(false)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(null)
          if (refused !== null) unsay()
        }
      }}
    />
  )
}

/** The select's value for a condition its values do not say: NULL or not, on a boolean that holds NULLs. */
const OTHER = '\u0000other'
const VALUES = ['true', 'false'] as const

/**
 * A boolean's box: Any, then each value; a condition no value says is
 * shown as itself. Controlled by the filter alone, as it will stand, so a
 * value chosen while a page is on its way is the one it shows, and the next
 * step of its arrow keys goes on from it.
 */
function ChoiceBox({ field, ahead, onFilter }: BoxProps): ReactElement {
  const term = conditionOn(ahead, field)
  const chosen = term === undefined ? '' : term.op === 'equals' && (VALUES as readonly string[]).includes(term.value) ? term.value : OTHER
  return (
    <select
      className="header-box"
      aria-label={`Filter ${field.label}`}
      value={chosen}
      onChange={(event) => {
        const value = event.target.value
        if (value === OTHER) return
        void onFilter((base) => withCondition(base, field.field, value === '' ? null : { field: field.field, op: 'equals', value }))
      }}
    >
      <option value="">Any</option>
      {VALUES.map((value) => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
      {chosen === OTHER && term !== undefined ? <option value={OTHER}>{headerText(term, field)}</option> : null}
    </select>
  )
}
