import { useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { clampSplit, shareLimits, SPLITS, stepShare } from './prefs.js'
import type { Axis, Limits } from './prefs.js'

/** A rem in pixels, as the document has it now. */
const rem = (): number => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

/** The size a line on `axis` shares: the lanes' width, or the window's height. */
function sizeOf(axis: Axis, lanes: HTMLElement): number {
  return axis === 'width' ? lanes.getBoundingClientRect().width : document.documentElement.clientHeight
}

/**
 * How far the line on `axis` may move in these lanes, as the room it shares
 * changes: Side by side's split by the lanes' width -- a window resized, a
 * scrollbar arriving -- and Stacked's line by the window's height (0145).
 * With no line, Side by side's outer bounds, which nothing reads. A size
 * measured for the other axis is not this one's: until it is measured
 * again, there is none.
 */
export function useShareLimits(axis: Axis | null, lanes: RefObject<HTMLElement | null>): Limits {
  const [measured, setMeasured] = useState<{ axis: Axis | null; size: number }>({ axis: null, size: 0 })

  useEffect(() => {
    const element = lanes.current
    if (axis === null || element === null) return undefined
    const measure = (): void => setMeasured({ axis, size: sizeOf(axis, element) })
    measure()
    if (axis === 'height') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [axis, lanes])

  if (axis === null) return { ...SPLITS.width.outer }
  return shareLimits(axis, measured.axis === axis ? measured.size : 0, rem())
}

/**
 * A line between the records and the record: the ARIA window splitter -- a
 * focusable `separator` with its value, its limits and its orientation --
 * dragged with a pointer, or moved with its arrow keys, Home and End.
 * Named by the records' heading, the part it sizes.
 *
 * Side by side's split (0047, the person's decision of 2026-10-10) is drawn
 * down between the two lanes, so its orientation is vertical, and shares
 * their width; where the window draws Side by side stacked, the stylesheet
 * hides it. Stacked's line (0145) is drawn across between the records and
 * the record, horizontal, and shares the window's height, which the Records
 * panel is drawn as tall as. `limits` are `useShareLimits`'.
 *
 * The share changes while it moves; `onSettle` is told where it was left --
 * on release, or after a key -- which is when the page keeps it and the
 * grids fit their columns again. A drag the browser cancels ends without
 * being kept.
 */
export function Split({
  axis,
  share,
  limits,
  lanes,
  labelledBy,
  onMove,
  onSettle,
}: {
  axis: Axis
  share: number
  limits: Limits
  lanes: RefObject<HTMLElement | null>
  labelledBy: string
  onMove: (share: number) => void
  onSettle: (share: number) => void
}): ReactElement {
  /** The drag under way: where the pointer was pressed, and the share then. */
  const dragging = useRef<{ y: number; share: number } | null>(null)
  const value = clampSplit(share, limits)

  /**
   * The share the pointer asks for. Across, where it is in the lanes, from
   * their left edge. Down, the share the drag started at, moved by as much
   * of the window's height as the pointer has moved: the lanes' top is no
   * fixed place to read from while the Records panel's height changes under
   * the pointer, since a browser may scroll the page to keep in view what
   * it showed.
   */
  const at = (event: { clientX: number; clientY: number }): number => {
    const element = lanes.current
    const begun = dragging.current
    if (element === null || begun === null) return value
    const size = sizeOf(axis, element)
    if (size <= 0) return value
    if (axis === 'height') return clampSplit(Math.round(begun.share + ((event.clientY - begun.y) / size) * 100), limits)
    return clampSplit(Math.round(((event.clientX - element.getBoundingClientRect().left) / size) * 100), limits)
  }

  return (
    <div
      role="separator"
      aria-orientation={axis === 'width' ? 'vertical' : 'horizontal'}
      aria-labelledby={labelledBy}
      aria-valuenow={value}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuetext={`Records ${String(value)}%, the record ${String(100 - value)}%`}
      tabIndex={0}
      className={axis === 'width' ? 'split' : 'stack-line'}
      onKeyDown={(event) => {
        const moved = stepShare(axis, value, event.key, limits)
        if (moved === null) return
        event.preventDefault()
        onMove(moved)
        onSettle(moved)
      }}
      onPointerDown={(event) => {
        dragging.current = { y: event.clientY, share: value }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (dragging.current !== null) onMove(at(event))
      }}
      onPointerUp={(event) => {
        if (dragging.current === null) return
        const settled = at(event)
        dragging.current = null
        onSettle(settled)
      }}
      // The browser took the drag over -- a touch turned into a scroll, the
      // capture went elsewhere: it is over, and nothing is kept.
      onPointerCancel={() => {
        dragging.current = null
      }}
      onLostPointerCapture={() => {
        dragging.current = null
      }}
    />
  )
}
