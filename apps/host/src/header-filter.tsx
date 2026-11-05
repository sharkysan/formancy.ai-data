import { createContext, useContext, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { headerCondition, headerText } from '@formancy/data-client'
import type { LineField, ListFilterTerm } from '@formancy/data-client'
import type { IFilterComp, IFloatingFilterParams, SuppressHeaderKeyboardEventParams } from 'ag-grid-community'
import { withTerm } from './filter-terms.js'

/*
 * Each column header's filter box (0132): AG Grid's floating filter row,
 * which holds the page's own control in a cell under each header, named
 * "Filter" and the column's label. What is typed is read as the filter
 * line reads it with the column's name in front (data-core's
 * `headerCondition`), so a box is the line's condition on one column and
 * nothing the line could not say: Enter, or leaving the box, applies it,
 * and a refusal is said where the grid speaks, what was typed kept. A
 * column whose field has values -- a state, a boolean -- offers them in a
 * select instead. A column the line cannot name has no box.
 *
 * The keyboard reaches a box as AG Grid's header keys do: Down from a
 * header to its box's cell and Enter into the box; Esc gives up an edit
 * and goes back to the cell; Tab goes on to the next column's box, and
 * from the last out of the grid, Shift+Tab back. Inside the box its keys
 * are the box's own, and while an input method composes a word, its.
 *
 * Nothing of the page's stylesheet reaches into a grid, whose look is its
 * theme's (grid-theme.ts): a text box wears the theme's input style through
 * AG Grid's own input classes, and a select is the browser's, in the
 * theme's dark scheme.
 */

/** A text box's classes: the page's, which AG Grid's keys are held from, and AG Grid's input style. */
const TEXT_BOX = 'header-box ag-input-field-input ag-text-field-input'

/** What a grid's boxes read and change: the fields the line may name, the filter, and where a refusal is said. */
export interface HeaderFilters {
  fields: readonly LineField[]
  filter: readonly ListFilterTerm[]
  onFilter: (next: ListFilterTerm[]) => void
  refused: (message: string) => void
}

/** A grid's boxes' filter, for the boxes AG Grid draws in its header. */
export const HeaderFilterContext = createContext<HeaderFilters | null>(null)

/** The filter AG Grid needs before it draws a column's box. It filters nothing: the server lists what the filter holds. */
export class NeverFilter implements IFilterComp {
  private readonly gui = document.createElement('div')

  init(): void {
    // Nothing to set up: the box is the page's, and the server filters.
  }

  getGui(): HTMLElement {
    return this.gui
  }

  isFilterActive(): boolean {
    return false
  }

  doesFilterPass(): boolean {
    return true
  }

  getModel(): null {
    return null
  }

  setModel(): void {
    // No model to keep: the section holds the filter.
  }
}

/** Whether an input method is composing a word, whose Enter and Esc are its own; 229 is what Safari reports for the last key of one. */
const composing = (event: globalThis.KeyboardEvent): boolean => event.isComposing || event.keyCode === 229

/** Whether AG Grid keeps its hands off a key pressed in a box: every key but the Esc and Tab that take the keyboard out of it, and those too while an input method composes. */
export function boxKeys(params: SuppressHeaderKeyboardEventParams): boolean {
  const target = params.event.target
  if (!(target instanceof HTMLElement) || target.closest('.header-box') === null) return false
  return composing(params.event) || (params.event.key !== 'Escape' && params.event.key !== 'Tab')
}

/** The box AG Grid draws under a column's header: the page's, for the field the column shows. */
export function HeaderBox({ column }: IFloatingFilterParams): ReactElement | null {
  const headers = useContext(HeaderFilterContext)
  const field = headers?.fields.find((entry) => entry.field === column.getColId())
  if (headers === null || field === undefined) return null
  return field.input === 'boolean' || field.values !== undefined ? <ChoiceBox field={field} headers={headers} /> : <TextBox field={field} headers={headers} />
}

/** `filter` with `field`'s condition replaced by `term`, or left out for none. */
const withCondition = (filter: readonly ListFilterTerm[], field: string, term: ListFilterTerm | null): ListFilterTerm[] =>
  term === null ? filter.filter((given) => given.field !== field) : withTerm(filter, term)

function TextBox({ field, headers }: { field: LineField; headers: HeaderFilters }): ReactElement {
  const shown = headerText(
    headers.filter.find((term) => term.field === field.field),
    field,
  )
  /** What the person typed since the box last showed its column's condition; null while it shows it. */
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  // Any change of the filter while the person is not in the box -- Clear
  // filter, a view, the line -- drops an edit left there, as the line's is.
  // Followed while rendering.
  const now = JSON.stringify(headers.filter)
  const [followed, setFollowed] = useState(now)
  if (followed !== now) {
    setFollowed(now)
    if (!focused) setDraft(null)
  }
  /** Esc pressed: AG Grid blurs the box before the box hears the key, and the blur must not apply what Esc gives up. */
  const givingUp = useRef(false)
  /** The text last refused, so leaving the box does not say the same refusal again. */
  const refusedText = useRef<string | null>(null)

  function apply(): void {
    if (draft === null) return
    const read = headerCondition(draft, field)
    if (!read.ok) {
      if (refusedText.current !== draft) headers.refused(read.message)
      refusedText.current = draft
      return
    }
    refusedText.current = null
    setDraft(null)
    const next = withCondition(headers.filter, field.field, read.term)
    if (JSON.stringify(next) !== JSON.stringify(headers.filter)) headers.onFilter(next)
  }

  return (
    <input
      type="text"
      className={TEXT_BOX}
      aria-label={`Filter ${field.label}`}
      autoComplete="off"
      spellCheck={false}
      value={draft ?? shown}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        if (givingUp.current) givingUp.current = false
        else apply()
      }}
      // Before AG Grid's own listener on the cell, which hears Esc first and blurs the box.
      onKeyDownCapture={(event: KeyboardEvent<HTMLInputElement>) => {
        if (composing(event.nativeEvent) || event.key !== 'Escape') return
        givingUp.current = true
        setDraft(null)
      }}
      onKeyDown={(event) => {
        if (composing(event.nativeEvent) || event.key !== 'Enter') return
        event.preventDefault()
        apply()
      }}
    />
  )
}

/** A column whose field says its values: Any, then each, by its label; a condition no value says is shown as itself. */
function ChoiceBox({ field, headers }: { field: LineField; headers: HeaderFilters }): ReactElement {
  const term = headers.filter.find((given) => given.field === field.field)
  const values =
    field.input === 'boolean'
      ? [
          { value: 'true', label: 'yes' },
          { value: 'false', label: 'no' },
        ]
      : (field.values ?? [])
  const chosen = term === undefined ? '' : term.op === 'equals' && values.some((entry) => entry.value === term.value) ? term.value : OTHER
  return (
    <select
      className="header-box"
      aria-label={`Filter ${field.label}`}
      value={chosen}
      onChange={(event) => {
        const value = event.target.value
        if (value === OTHER) return
        headers.onFilter(withCondition(headers.filter, field.field, value === '' ? null : { field: field.field, op: 'equals', value }))
      }}
    >
      <option value="">Any</option>
      {values.map((entry) => (
        <option key={entry.value} value={entry.value}>
          {entry.label}
        </option>
      ))}
      {chosen === OTHER && term !== undefined ? <option value={OTHER}>{headerText(term, field)}</option> : null}
    </select>
  )
}

/** The select's value for a condition its values do not say. */
const OTHER = '\u0000other'
