import { useEffect, useRef, useState } from 'react'
import type { GridColumn } from './grid-datasource.js'
import { headerFloor } from './widths.js'

/** Each column's floor, by its key (widths.ts's `headerFloor`). */
const measured = (columns: readonly GridColumn[]): Map<string, number> =>
  new Map(columns.map((column) => [column.key, headerFloor(column.label, column.sortable)]))

const same = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean =>
  a.size === b.size && [...a].every(([key, floor]) => b.get(key) === floor)

/**
 * Each column's floor, measured in the header's face (0151), and measured
 * again each time the page's fonts finish loading -- a canvas measures in a
 * fallback face until the web font has loaded -- but given anew only where a
 * floor changed. A font load elsewhere on the page, a paper's or a
 * typeahead's, then leaves the grid's column definitions as they were:
 * made again on every load, AG Grid drew every header and cell again
 * (header-floors.test.tsx says what was measured).
 * Nothing waits where the document has no FontFaceSet, as jsdom has none.
 */
export function useHeaderFloors(columns: readonly GridColumn[]): ReadonlyMap<string, number> {
  const [floors, setFloors] = useState(() => ({ columns, floors: measured(columns) }))
  // The columns changed: their floors, measured now, in this render.
  const current = floors.columns === columns ? floors : { columns, floors: measured(columns) }
  if (current !== floors) setFloors(current)
  const now = useRef(current)
  now.current = current
  useEffect(() => {
    if (!('fonts' in document)) return undefined
    const fonts = document.fonts
    let live = true
    const again = (): void => {
      if (!live) return
      const next = measured(now.current.columns)
      if (!same(next, now.current.floors)) setFloors({ columns: now.current.columns, floors: next })
    }
    void fonts.ready.then(again)
    fonts.addEventListener('loadingdone', again)
    return () => {
      live = false
      fonts.removeEventListener('loadingdone', again)
    }
  }, [])
  return current.floors
}
