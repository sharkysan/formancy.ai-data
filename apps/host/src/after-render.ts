import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Run an action once the page has rendered what the state it just set says:
 * focus on a heading that a view change un-hides, or on a row that a page
 * load draws. Asked for, not placed: asking twice for the same place moves
 * the keyboard twice.
 */
export function useAfterRender(): (action: () => void) => void {
  const queue = useRef<Array<() => void>>([])
  const [, rendered] = useState(0)
  useEffect(() => {
    for (const action of queue.current.splice(0)) action()
  })
  return useCallback((action: () => void) => {
    queue.current.push(action)
    rendered((n) => n + 1)
  }, [])
}
