import { useEffect, useState } from 'react'

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
 */
export function useFocusAfterRender(): (id: string) => void {
  const [next, setNext] = useState<string | null>(null)
  useEffect(() => {
    if (next === null) return
    document.getElementById(next)?.focus()
    setNext(null)
  }, [next])
  return setNext
}
