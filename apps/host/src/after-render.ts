import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Run an action once the page has rendered what the state it just set says:
 * focus on a heading that a view change un-hides, or on a row that a page
 * load draws. Asked for, not placed: asking twice for the same place moves
 * the keyboard twice.
 *
 * Each action waits for the render that took its request, and is run by
 * that render's effect, never by an earlier one's. React runs the effects a
 * commit still has pending before it renders again, so a press landing
 * between a commit and its effects -- an answer drawn just before a crumb is
 * pressed -- would otherwise have the earlier effect run the press's action
 * first, on the page as it was: a level still hidden, whose heading takes
 * no keyboard, while the crumb pressed goes, and the keyboard with it.
 */
export function useAfterRender(): (action: () => void) => void {
  /** Each action, by the number of the request that asked for it. */
  const queue = useRef<Array<{ asked: number; action: () => void }>>([])
  const asked = useRef(0)
  /** The last request this render took. */
  const [rendered, setRendered] = useState(0)
  useEffect(() => {
    const due = queue.current.filter((each) => each.asked <= rendered)
    if (due.length === 0) return
    queue.current = queue.current.filter((each) => each.asked > rendered)
    for (const { action } of due) action()
  })
  return useCallback((action: () => void) => {
    asked.current += 1
    queue.current.push({ asked: asked.current, action })
    setRendered(asked.current)
  }, [])
}
