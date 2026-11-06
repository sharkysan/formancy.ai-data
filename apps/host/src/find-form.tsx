import { useId } from 'react'
import type { KeyboardEvent, ReactElement, RefObject } from 'react'
import type { FormMenuEntry } from '@formancy/data-client'
import { matchSaying } from './form-list.js'

/** Whether an input method is composing a word, whose Enter and Esc are its own; 229 is what Safari reports for the last key of one. */
export const composing = (event: KeyboardEvent): boolean => event.nativeEvent.isComposing || event.keyCode === 229

/** Whether a key was pressed without Shift, Ctrl, Meta or Alt: with one, an arrow selects, moves the caret, or is the screen reader's. */
export const plain = (event: KeyboardEvent): boolean => !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey

/**
 * Find a form (0144): the box that narrows the list as the person types,
 * the polite status that says how many forms match, and Clear the search
 * where none does. In the box, Enter opens the one form that matches,
 * Escape empties a box that holds something -- in an empty one it is the
 * page's -- and Down goes into the list. While an input method composes,
 * every key is its own; with a modifier, Down is the box's.
 */
export function FindForm({
  search,
  matched,
  total,
  box,
  onSearch,
  onChoose,
  onDown,
}: {
  search: string
  /** The forms that match, in the order the list draws them. */
  matched: readonly FormMenuEntry[]
  /** How many forms the menu names. */
  total: number
  box: RefObject<HTMLInputElement | null>
  onSearch: (search: string) => void
  onChoose: (formId: string, from: HTMLElement) => void
  /** Down pressed: the keyboard into the list; false where the list draws no form. */
  onDown: () => boolean
}): ReactElement {
  const id = useId()
  // TEMPORARY M3: Enter opens the first form that matches, however many do.
  const only = matched[0]

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (composing(event)) return
    if (event.key === 'Enter' && only !== undefined) {
      event.preventDefault()
      onChoose(only.id, event.currentTarget)
    } else if (event.key === 'Escape') {
      // TEMPORARY M4: Escape no longer empties the box. M15: Escape taken in an empty box too.
      event.preventDefault()
      event.stopPropagation()
    } else if (event.key === 'ArrowDown' && plain(event) && onDown()) event.preventDefault()
  }

  return (
    <div className="forms-find">
      <label htmlFor={`${id}-find`}>Find a form</label>
      <input
        id={`${id}-find`}
        type="text"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        ref={box}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        onKeyDown={onKey}
      />
      <p role="status" className="status quiet-line forms-matched">
        {matchSaying(search, matched.length, total)}
      </p>
      {/* TEMPORARY M6: Clear the search undrawn. */}
      {search.trim() !== '' && matched.length < 0 ? (
        <button
          type="button"
          className="button"
          onClick={() => {
            onSearch('')
            box.current?.focus()
          }}
        >
          Clear the search
        </button>
      ) : null}
    </div>
  )
}
