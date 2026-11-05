import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { completeFilterLine, parseFilterLine, printFilterLine } from '@formancy/data-client'
import type { LineField, LineOption, LineRefusal, ListFilterTerm } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'

/*
 * A grid's filter as a line a person types: `status = placed and amount >
 * 1000`. The line is read here, by data-core's reader through the client,
 * into the terms the panel would have sent; the server sees those terms in
 * the list's body and never the line.
 *
 * An ARIA 1.2 combobox: what may come next at the caret is a listbox under
 * it, which typing opens, ArrowDown and ArrowUp move through, Enter takes
 * the option moved to, and Esc closes. Enter with no option moved to
 * applies the line; a line that cannot be read keeps every character and
 * the caret, marks the ones it is about and says why under it, and sends
 * nothing. A
 * second Esc puts back what is applied and gives the keyboard to the grid.
 *
 * What the line shows, while the person is not editing it, is the filter
 * applied, however it was applied -- a chip, a view, the panel -- written
 * by the same module that reads it. A condition on a field the line does
 * not offer (0123) is a chip, not in the line, and applying the line keeps
 * it, before what the line says.
 */

export function FilterLine({
  idBase,
  fields,
  filter,
  onFilter,
  onClear,
  slash = false,
  onLeave,
}: {
  /** What every element id of the line starts with: one line per grid. */
  idBase: string
  /** The fields the line may name: those the form's Filter panel offers. */
  fields: readonly LineField[]
  /** The filter as applied: what the grid lists and a file holds. */
  filter: readonly ListFilterTerm[]
  onFilter: (next: ListFilterTerm[]) => void
  /** Every condition removed by a line cleared and applied: the grid's Undo offers them back. */
  onClear?: () => void
  /** Whether `/`, pressed outside a text box, puts the keyboard on this line: the Records grid's. */
  slash?: boolean
  /** Where the keyboard goes when Esc leaves the line: the grid. */
  onLeave?: () => void
}): ReactElement {
  const applied = printFilterLine(filter, fields)
  /** What the person has typed since the line last showed the filter applied; null while it shows it. */
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? applied
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [refusal, setRefusal] = useState<LineRefusal | null>(null)
  const [focused, setFocused] = useState(false)
  // A filter changed elsewhere -- a view, a chip, the panel -- while the
  // person is not in the line is what the line shows: an edit they left
  // unapplied is dropped, or the line and the chips would say two filters.
  // Followed while rendering, React's way to follow a value.
  const [followed, setFollowed] = useState(applied)
  if (followed !== applied) {
    setFollowed(applied)
    if (!focused) {
      setDraft(null)
      setRefusal(null)
    }
  }
  const pending = draft !== null && draft !== applied
  const box = useRef<HTMLInputElement>(null)
  const after = useAfterRender()
  const completion = completeFilterLine(text, caret, fields)
  const shown = open && completion.options.length > 0
  const optionId = (index: number) => `${idBase}-option-${String(index)}`

  useEffect(() => {
    if (!slash) return undefined
    const listener = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== '/' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      const line = box.current
      if (line === null) return
      event.preventDefault()
      line.focus()
      line.setSelectionRange(line.value.length, line.value.length)
      setCaret(line.value.length)
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [slash])

  /** The text typed, the caret where it is, and completion opened on it. */
  function typed(next: string, at: number): void {
    setDraft(next)
    setCaret(at)
    setOpen(true)
    setActive(-1)
    setRefusal(null)
  }

  /** An option in place of the word it completes, the caret after it. */
  function take(option: LineOption): void {
    const next = text.slice(0, completion.from) + option.insert + text.slice(completion.to)
    const at = completion.from + option.insert.length
    typed(next, at)
    after(() => box.current?.setSelectionRange(at, at))
  }

  function apply(): void {
    const read = parseFilterLine(text, fields)
    setOpen(false)
    // What is refused is marked under the line, and the caret stays where
    // it is: selected, the marked characters were the next key's to replace,
    // and a line not finished yet lost what was typed on.
    if (!read.ok) {
      setRefusal(read)
      return
    }
    setRefusal(null)
    setDraft(null)
    const kept = filter.filter((term) => !fields.some((field) => field.field === term.field))
    const next = [...kept, ...read.filter]
    if (JSON.stringify(next) === JSON.stringify(filter)) return
    if (next.length === 0 && onClear !== undefined) onClear()
    else onFilter(next)
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // An input method composing a word owns Enter and Esc until it is done;
    // 229 is the key a browser reports for them, Safari's after the
    // composition has already ended.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const count = completion.options.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (count === 0) return
      event.preventDefault()
      if (!shown) {
        setOpen(true)
        setActive(event.key === 'ArrowDown' ? 0 : count - 1)
      } else setActive((active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = shown ? completion.options[active] : undefined
      if (option !== undefined) take(option)
      else apply()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (shown) setOpen(false)
      else {
        setDraft(null)
        setRefusal(null)
        onLeave?.()
      }
    }
  }

  const described = [`${idBase}-hint`, refusal === null ? null : `${idBase}-problem`].filter((id) => id !== null).join(' ')
  return (
    <div className="filter-line">
      <label htmlFor={`${idBase}-input`} id={`${idBase}-label`}>
        Filter
      </label>
      <div className="filter-line-box">
        <input
          id={`${idBase}-input`}
          ref={box}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={`${idBase}-options`}
          aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
          aria-describedby={described}
          aria-invalid={refusal === null ? undefined : true}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => typed(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onSelect={(event) => {
            // A caret moved offers other options: none of them is the one moved to.
            const at = event.currentTarget.selectionStart ?? 0
            if (at === caret) return
            setCaret(at)
            setActive(-1)
          }}
          onKeyDown={keyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setOpen(false)
          }}
        />
        <ul id={`${idBase}-options`} className="filter-options" role="listbox" aria-label="What may come next" hidden={!shown}>
          {completion.options.map((option, index) => (
            <li
              key={`${option.label}-${option.insert}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                // Taken where it is pressed, the keyboard staying in the line.
                event.preventDefault()
                take(option)
              }}
            >
              <span className="filter-option-label">{option.label}</span>
              <span className="filter-option-hint">{option.hint}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="hint filter-hint" id={`${idBase}-hint`}>
        {pending
          ? 'Not applied yet: Enter applies it, Esc puts back the filter.'
          : 'Conditions joined by and, applied with Enter. On a cell, = keeps the rows with its value.'}
      </p>
      <p role="status" id={`${idBase}-problem`} className="status filter-problem" data-kind="refused" aria-labelledby={`${idBase}-label`}>
        {refusal === null ? '' : refusal.message}
        {refusal === null ? null : <Marked text={text} refusal={refusal} />}
      </p>
    </div>
  )
}

/** The line again, the characters a refusal is about marked: for the eye, since the box selects them too. */
function Marked({ text, refusal }: { text: string; refusal: LineRefusal }): ReactElement {
  const end = refusal.at + refusal.length
  return (
    <code className="filter-marked" aria-hidden="true">
      {text.slice(0, refusal.at)}
      <mark>{text.slice(refusal.at, end)}</mark>
      {text.slice(end)}
    </code>
  )
}
