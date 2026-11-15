import { useLayoutEffect, useState } from 'react'

/**
 * Where the keyboard goes when a press takes away the button pressed.
 *
 * A row removed, a box closed, a button disabled at the end of a list: the
 * browser drops the focus of an element that leaves the document or turns
 * disabled, to the top of the page, and a keyboard or screen reader user
 * starts the step again from there. The caller names the element that should
 * have the focus instead, by id, and it is focused once the render that
 * removed the other has committed -- so it may be an element that render
 * creates.
 *
 * In that commit, as a layout effect, not a task later. A press whose answer
 * arrives from the server -- a browsed page's Undo or next Remove, a
 * followed key's heading -- is drawn outside any event, and a passive effect
 * then ran in a task of its own after the render that drew the element:
 * whatever read the document in between, a screen reader or a test waiting
 * for the status line, found the keyboard on the page itself.
 * browse-line.test.tsx failed so once on CI's runner (pull request #185) and
 * passed when run again.
 */
export function useFocusAfterRender(): (id: string) => void {
  const [next, setNext] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (next === null) return
    document.getElementById(next)?.focus()
    setNext(null)
  }, [next])
  return setNext
}
