import { useEffect, useMemo, useState } from 'react'

/** Whether the window matches `query`, as it changes; false where there is no `matchMedia` (jsdom). */
export function useMedia(query: string): boolean {
  const list = useMemo(() => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null), [query])
  const [matches, setMatches] = useState(list?.matches ?? false)
  useEffect(() => {
    if (list === null) return undefined
    const changed = (): void => setMatches(list.matches)
    list.addEventListener('change', changed)
    return () => list.removeEventListener('change', changed)
  }, [list])
  return matches
}
