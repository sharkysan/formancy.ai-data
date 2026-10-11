import { useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { clampSplit, splitLimits, stepSplit } from './prefs.js'

/**
 * The separator between the records and the record in Side by side (0047,
 * the person's decision of 2026-10-10): the ARIA window splitter -- a
 * focusable `separator` with its value, its limits and its orientation --
 * dragged with a pointer, or moved with the arrow keys, Home and End.
 * Named by the records' heading, the pane it sizes. The limits keep each
 * side as wide as its content needs, from the width the two lanes share;
 * where the window draws Side by side stacked, the stylesheet hides it.
 *
 * The share changes while it moves; `onSettle` is told where it was left --
 * on release, or after a key -- which is when the page keeps it and the
 * grids fit their columns again. A drag the browser cancels ends without
 * being kept.
 */
export function Split({
  share,
  lanes,
  labelledBy,
  onMove,
  onSettle,
}: {
  share: number
  lanes: RefObject<HTMLElement | null>
  labelledBy: string
  onMove: (share: number) => void
  onSettle: (share: number) => void
}): ReactElement {
  const [width, setWidth] = useState(0)
  const dragging = useRef(false)

  // The lanes' width, as it changes: a window resized, or a scrollbar arriving.
  useEffect(() => {
    const element = lanes.current
    if (element === null) return undefined
    const measure = (): void => setWidth(element.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [lanes])

  const rem = (): number => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const limits = splitLimits(width, rem())
  const value = clampSplit(share, limits)

  const at = (clientX: number): number => {
    const box = lanes.current?.getBoundingClientRect()
    if (box === undefined || box.width <= 0) return value
    return clampSplit(Math.round(((clientX - box.left) / box.width) * 100), limits)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-labelledby={labelledBy}
      aria-valuenow={value}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuetext={`Records ${String(value)}%, the record ${String(100 - value)}%`}
      tabIndex={0}
      className="split"
      onKeyDown={(event) => {
        const moved = stepSplit(value, event.key, limits)
        if (moved === null) return
        event.preventDefault()
        onMove(moved)
        onSettle(moved)
      }}
      onPointerDown={(event) => {
        dragging.current = true
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (dragging.current) onMove(at(event.clientX))
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return
        dragging.current = false
        onSettle(at(event.clientX))
      }}
      // The browser took the drag over -- a touch turned into a scroll, the
      // capture went elsewhere: it is over, and nothing is kept.
      onPointerCancel={() => {
        dragging.current = false
      }}
      onLostPointerCapture={() => {
        dragging.current = false
      }}
    />
  )
}
