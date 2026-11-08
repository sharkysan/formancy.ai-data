import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { completeFilterLine, parseFilterLine, printFilterLine } from '@formancy/data-core'
import type { LineField, LineOption, LineRefusal, ListFilterTerm } from '@formancy/data-core'

/*
 * A browsed page's filter as a line a person types (0147): `country_code =
 * CH and credit_limit > 125.50`. The line is read here, by data-core's
 * reader, into the terms the browse carries (0104); the server sees those
 * terms in the browse's body and never the line. What it means, what
 * completion offers and how a filter is written are data-core's; this is
 * the combobox around them, the host's line's keys over the step's page.
 *
 * An ARIA 1.2 combobox: what may come next at the caret is a listbox under
 * it, which typing opens, ArrowDown and ArrowUp move through, Enter takes
 * the option moved to, and Esc closes. Enter with no option moved to
 * applies the line; a line that cannot be read keeps every character and
 * the caret, marks the ones it is about and says why under it, and sends
 * nothing. A second Esc puts back what is applied and gives the keyboard
 * to the table. `/`, pressed anywhere on the step outside a text box, puts
 * the keyboard on the line.
 *
 * What the line shows, while the person is not editing it, is the filter
 * applied, however it was applied -- a chip, a header's box, a Back --
 * written by the module that reads it. What was typed stays until the page
 * it asked for has arrived, so a line the server refuses is still there to
 * correct.
 */

/** What every element id of the line starts with: one line on the step. */
const ID = 'browse-filter'
const optionId = (index: number): string => `${ID}-option-${String(index)}`

/** Whether an input method is composing a word, whose Enter and Esc are its own; 229 is what Safari reports for the last key of one. */
const composing = (event: KeyboardEvent): boolean => event.nativeEvent.isComposing || event.keyCode === 229

/** Where the caret goes once the render that changes the line's text has committed, a controlled input's value having put it at the end. */
function useCaretAfterRender(box: { current: HTMLInputElement | null }): (at: number) => void {
  const [next, setNext] = useState<number | null>(null)
  useEffect(() => {
    if (next === null) return
    box.current?.setSelectionRange(next, next)
    setNext(null)
  }, [next, box])
  return setNext
}

export function FilterLine({
  fields,
  filter,
  onFilter,
  onClear,
  onLeave,
}: {
  /** The columns the line may name (`lineFields`). */
  fields: readonly LineField[]
  /** The filter as applied: what the page was asked with. */
  filter: readonly ListFilterTerm[]
  /** Asks for the page under `next`; `arrived` runs in the render that shows it. */
  onFilter: (next: ListFilterTerm[], arrived: () => void) => void
  /** Every condition removed by a line emptied and applied: the page's Undo offers them back. */
  onClear: (arrived: () => void) => void
  /** Where the keyboard goes when Esc leaves the line: the table. */
  onLeave: () => void
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
  // A filter changed elsewhere -- a chip, a box -- while the person is not
  // in the line is what the line shows: an edit they left unapplied is
  // dropped, or the line and the chips would say two filters. Followed
  // while rendering, React's way to follow a value.
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
  const caretAfterRender = useCaretAfterRender(box)
  const completion = completeFilterLine(text, caret, fields)
  const shown = open && completion.options.length > 0

  useEffect(() => {
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
  }, [])

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
    caretAfterRender(at)
  }

  function apply(): void {
    const read = parseFilterLine(text, fields)
    setOpen(false)
    // What is refused is marked under the line, and the caret stays where
    // it is: selected, the marked characters were the next key's to
    // replace, and a line not finished yet lost what was typed on.
    if (!read.ok) {
      setRefusal(read)
      return
    }
    setRefusal(null)
    const kept = filter.filter((term) => !fields.some((field) => field.field === term.field))
    const next = [...kept, ...read.filter]
    // Once the page has arrived the line shows its filter, unless the person typed on while it was on its way.
    const sent = draft
    const shows = () => setDraft((now) => (now === sent ? null : now))
    if (JSON.stringify(next) === JSON.stringify(filter)) shows()
    else if (next.length === 0) onClear(shows)
    else onFilter(next, shows)
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (composing(event)) return
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
        onLeave()
      }
    }
  }

  const described = [`${ID}-hint`, refusal === null ? null : `${ID}-problem`].filter((id) => id !== null).join(' ')
  return (
    <div className="filter-line">
      <label htmlFor={`${ID}-input`} id={`${ID}-label`}>
        Filter
      </label>
      <div className="filter-line-box">
        <input
          id={`${ID}-input`}
          ref={box}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={`${ID}-options`}
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
        <ul id={`${ID}-options`} className="filter-options" role="listbox" aria-label="What may come next" hidden={!shown}>
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
              {/* A column's name is its label here, so a name's meaning is said only where it says more. */}
              {option.hint === '' || option.hint === option.label ? null : (
                <>
                  {' '}
                  <span className="filter-option-hint">{option.hint}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="hint filter-hint" id={`${ID}-hint`}>
        {pending
          ? 'Not applied yet: Enter applies it, Esc puts back the filter.'
          : 'Conditions joined by and, applied with Enter; the box under a column’s header takes one on that column alone.'}
      </p>
      <p role="status" id={`${ID}-problem`} className="filter-problem" aria-labelledby={`${ID}-label`}>
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
