import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react'
import { headerCondition, headerText } from '@formancy/data-client'
import type { LineField, ListFilterTerm, LookupRow } from '@formancy/data-client'
import type { IFilterComp, IFloatingFilterParams, SuppressHeaderKeyboardEventParams } from 'ag-grid-community'
import { createPortal } from 'react-dom'
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
 * select instead, and a lookup's column searches its lookup (0135). A
 * column the line cannot name has no box.
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
  /** The id of the filter line's hint, which says `=` on a cell (0133): the grid is described by it. */
  hint?: string
  /** A lookup field's records whose labels match `search` (0135), or the server's refusal; none where the grid has no search of its lookups. */
  records?: (field: string, search: string, signal: AbortSignal) => Promise<readonly LookupRow[] | string>
  /** Records a box picked or found, which the line then reads and writes by their labels. */
  heard?: (field: string, rows: readonly LookupRow[]) => void
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
  if (field.input === 'lookup') return <LookupBox field={field} headers={headers} />
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

/**
 * Where a lookup column's listbox opens: under its box, at least as wide,
 * and toward the side of the window with room -- from the box's left edge,
 * or, for a box in the window's right half, back from its right edge -- so
 * on a phone it stays inside the window.
 */
function listPlace(box: DOMRect): CSSProperties {
  const top = `${String(box.bottom + 4)}px`
  const minWidth = `${String(Math.min(box.width, window.innerWidth - 32))}px`
  return box.left > window.innerWidth / 2
    ? { top, right: `${String(Math.max(16, window.innerWidth - box.right))}px`, minWidth }
    : { top, left: `${String(Math.max(16, box.left))}px`, minWidth }
}

/** What a lookup column's listbox offers: whether the field refers to a record, or a record a search found. */
type LookupOption = { kind: 'null' | 'not-null'; words: string } | { kind: 'record'; row: LookupRow }

/** The emptiness conditions `field` offers, in the line's words. */
const emptiness = (field: LineField): LookupOption[] => [
  ...(field.operators.includes('null') ? [{ kind: 'null' as const, words: 'is empty' }] : []),
  ...(field.operators.includes('not-null') ? [{ kind: 'not-null' as const, words: 'is not empty' }] : []),
]

/** A lookup's records whose labels match what is typed, searched as it is typed. */
interface LookupSearch {
  found: readonly LookupRow[]
  /** Search for `text`, abandoning the search before it; nothing for empty text. */
  search: (text: string) => void
  /** Abandon the search under way. */
  abandon: () => void
}

/**
 * Each keystroke's search abandons the one before it, which stops in the
 * database (0061) and whose rejection is heard here and dropped; a search
 * the server refuses is said once, however many keystrokes it took.
 */
function useLookupSearch(field: LineField, headers: HeaderFilters): LookupSearch {
  const [found, setFound] = useState<readonly LookupRow[]>([])
  const searching = useRef<AbortController | null>(null)
  /** The search refusal last said, so each keystroke of one refused search does not say it again. */
  const said = useRef<string | null>(null)
  const abandon = (): void => searching.current?.abort()
  function search(text: string): void {
    abandon()
    if (text.trim() === '' || headers.records === undefined) {
      setFound([])
      return
    }
    const controller = new AbortController()
    searching.current = controller
    headers.records(field.field, text, controller.signal).then(
      (rows) => {
        if (controller.signal.aborted) return
        if (typeof rows === 'string') {
          if (said.current !== rows) headers.refused(rows)
          said.current = rows
          setFound([])
          return
        }
        said.current = null
        setFound(rows)
      },
      // Abandoned for the next keystroke, or as the box closed: nothing to say.
      () => {},
    )
  }
  return { found, search, abandon }
}

/**
 * A lookup column's listbox, drawn over the page under its box, since the
 * grid's header clips what its cells hold. A record whose label another
 * shares shows its token beside it. A press anywhere on the list keeps the
 * keyboard in the box, and the option the arrows reach is kept in view.
 */
function LookupList({
  id,
  label,
  options,
  active,
  shown,
  place,
  onPick,
}: {
  id: string
  label: string
  options: readonly LookupOption[]
  active: number
  shown: boolean
  place: DOMRect | undefined
  onPick: (option: LookupOption) => void
}): ReactElement {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (shown && active >= 0) list.current?.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }, [shown, active])
  const shared = (row: LookupRow): boolean =>
    options.some((other) => other.kind === 'record' && other.row !== row && other.row.label.toLowerCase() === row.label.toLowerCase())
  return createPortal(
    <ul
      ref={list}
      id={`${id}-records`}
      className="filter-options lookup-options"
      role="listbox"
      aria-label={`Records of ${label}`}
      hidden={!shown}
      style={place === undefined ? undefined : listPlace(place)}
      // A press on the list, its scroll bar included, keeps the keyboard in the box.
      onMouseDown={(event) => event.preventDefault()}
    >
      {options.map((option, index) => (
        <li
          key={option.kind === 'record' ? option.row.token : option.kind}
          id={`${id}-record-${String(index)}`}
          role="option"
          aria-selected={index === active}
          onMouseDown={() => onPick(option)}
        >
          <span className="filter-option-label">{option.kind === 'record' ? option.row.label : option.words}</span>
          {option.kind === 'record' && shared(option.row) ? <span className="filter-option-hint">{option.row.token}</span> : null}
        </li>
      ))}
    </ul>,
    document.body,
  )
}

/**
 * A lookup column's box (0135): an ARIA 1.2 combobox that searches the
 * lookup as the person types (`useLookupSearch`) and offers the records it
 * finds by their labels, or, while empty, whether the field refers to a
 * record. A record picked is the column's condition by its token, and the
 * page hears of it, so the line says it by its label. Enter on typed text,
 * or leaving the box, reads it as the line would -- a label the page knows,
 * or the words `is empty` -- and Esc gives an edit up.
 */
function LookupBox({ field, headers }: { field: LineField; headers: HeaderFilters }): ReactElement {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const { found, search, abandon } = useLookupSearch(field, headers)
  // The records found count as known: a label typed whole names one of them, and one picked is shown by its label.
  const known: LineField = {
    ...field,
    values: [
      ...new Map([...(field.values ?? []).map((entry) => [entry.value, entry.label] as const), ...found.map((row) => [row.token, row.label] as const)]),
    ].map(([value, label]) => ({ value, label })),
  }
  const shown = headerText(
    headers.filter.find((term) => term.field === field.field),
    known,
  )
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const givingUp = useRef(false)
  const refusedText = useRef<string | null>(null)
  const now = JSON.stringify(headers.filter)
  const [followed, setFollowed] = useState(now)
  if (followed !== now) {
    setFollowed(now)
    if (!focused) setDraft(null)
  }
  const options: LookupOption[] = (draft ?? '').trim() === '' ? emptiness(field) : found.map((row) => ({ kind: 'record', row }))
  const listed = open && options.length > 0

  function close(): void {
    abandon()
    setOpen(false)
    setActive(-1)
  }

  function commit(term: ListFilterTerm | null): void {
    refusedText.current = null
    setDraft(null)
    close()
    const next = withCondition(headers.filter, field.field, term)
    if (JSON.stringify(next) !== JSON.stringify(headers.filter)) headers.onFilter(next)
  }

  function pick(option: LookupOption): void {
    if (option.kind !== 'record') {
      commit({ field: field.field, op: option.kind })
      return
    }
    headers.heard?.(field.field, [option.row])
    commit({ field: field.field, op: 'equals', value: option.row.token })
  }

  function applyTyped(): void {
    if (draft === null) return
    const read = headerCondition(draft, known)
    if (!read.ok) {
      if (refusedText.current !== draft) headers.refused(read.message)
      refusedText.current = draft
      return
    }
    const term = read.term
    const row = term?.op === 'equals' ? found.find((entry) => entry.token === term.value) : undefined
    if (row !== undefined) headers.heard?.(field.field, [row])
    commit(term)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (composing(event.nativeEvent)) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((at) => (options.length === 0 ? -1 : (at + step + options.length) % options.length))
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    const option = listed && active >= 0 ? options[active] : undefined
    if (option === undefined) applyTyped()
    else pick(option)
  }

  return (
    <>
      <input
        ref={input}
        type="text"
        className={TEXT_BOX}
        role="combobox"
        aria-label={`Filter ${field.label}`}
        aria-autocomplete="list"
        aria-expanded={listed}
        aria-controls={`${id}-records`}
        aria-activedescendant={listed && active >= 0 ? `${id}-record-${String(active)}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={draft ?? shown}
        onChange={(event) => {
          setDraft(event.target.value)
          setOpen(true)
          setActive(-1)
          search(event.target.value)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          close()
          if (givingUp.current) givingUp.current = false
          else applyTyped()
        }}
        // Before AG Grid's own listener on the cell, which hears Esc first and blurs the box.
        onKeyDownCapture={(event: KeyboardEvent<HTMLInputElement>) => {
          if (composing(event.nativeEvent) || event.key !== 'Escape') return
          givingUp.current = true
          setDraft(null)
          close()
        }}
        onKeyDown={onKeyDown}
      />
      <LookupList id={id} label={field.label} options={options} active={active} shown={listed} place={input.current?.getBoundingClientRect()} onPick={pick} />
    </>
  )
}
