import { useRef, useState } from 'react'
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
 * where the step speaks, in its alert, and what was typed is kept until a
 * page under it has arrived. A boolean offers its two values in a select.
 * A column the line cannot name has no box.
 */

/** Whether an input method is composing a word, whose Enter and Esc are its own; 229 is what Safari reports for the last key of one. */
const composing = (event: KeyboardEvent): boolean => event.nativeEvent.isComposing || event.keyCode === 229

interface BoxProps {
  field: LineField
  filter: readonly BrowseFilterTerm[]
  onFilter: FilterChange
  onRefused: (message: string) => void
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
 * is. Followed while rendering.
 */
function useDraft<T>(filter: readonly BrowseFilterTerm[], focused: boolean): [T | null, Dispatch<SetStateAction<T | null>>] {
  const [draft, setDraft] = useState<T | null>(null)
  const now = JSON.stringify(filter)
  const [followed, setFollowed] = useState(now)
  if (followed !== now) {
    setFollowed(now)
    if (!focused) setDraft(null)
  }
  return [draft, setDraft]
}

function TextBox({ field, filter, onFilter, onRefused }: BoxProps): ReactElement {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useDraft<string>(filter, focused)
  /** The text last refused, the line's way or the server's, so leaving the box does not say it again. */
  const refused = useRef<string | null>(null)

  function apply(leaving: boolean): void {
    if (draft === null || (leaving && refused.current === draft)) return
    const read = headerCondition(draft, field)
    if (!read.ok) {
      if (refused.current !== draft) onRefused(read.message)
      refused.current = draft
      return
    }
    refused.current = null
    const next = withCondition(filter, field.field, read.term)
    if (sameFilter(next, filter)) {
      setDraft(null)
      return
    }
    // Once the page has arrived the box shows its column's condition, unless the person typed on while it was on its way.
    const sent = draft
    void onFilter(next, null, () => setDraft((now) => (now === sent ? null : now))).then((arrived) => {
      if (!arrived) refused.current = sent
    })
  }

  return (
    <input
      type="text"
      className="header-box"
      aria-label={`Filter ${field.label}`}
      autoComplete="off"
      spellCheck={false}
      value={draft ?? headerText(conditionOn(filter, field), field)}
      onChange={(event) => setDraft(event.target.value)}
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
          refused.current = null
          setDraft(null)
        }
      }}
    />
  )
}

/** The select's value for a condition its values do not say: NULL or not, on a boolean that holds NULLs. */
const OTHER = '\u0000other'
const VALUES = ['true', 'false'] as const

/** A boolean's box: Any, then each value; a condition no value says is shown as itself. */
function ChoiceBox({ field, filter, onFilter }: BoxProps): ReactElement {
  const term = conditionOn(filter, field)
  const chosen = term === undefined ? '' : term.op === 'equals' && (VALUES as readonly string[]).includes(term.value) ? term.value : OTHER
  const [focused, setFocused] = useState(false)
  const [picked, setPicked] = useDraft<string>(filter, focused)
  return (
    <select
      className="header-box"
      aria-label={`Filter ${field.label}`}
      value={picked ?? chosen}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        const value = event.target.value
        if (value === OTHER) return
        setPicked(value)
        const arrived = () => setPicked((now) => (now === value ? null : now))
        void onFilter(withCondition(filter, field.field, value === '' ? null : { field: field.field, op: 'equals', value }), null, arrived)
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
