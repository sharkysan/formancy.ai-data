import { useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { clampSplit, lineLimits, stepShare } from './prefs.js'
import type { Axis, Limits, Shares } from './prefs.js'

/** A rem in pixels, as the document has it now. */
const rem = (): number => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

/** The window's height, as the document lays it out. */
const windowHeight = (): number => document.documentElement.clientHeight

/** A line drawn between the records and the record: which way it moves, how far, and where it sits, its share inside those limits. */
export interface Line {
  axis: Axis
  limits: Limits
  value: number
}

/**
 * The line `axis` draws in these lanes for `shares`, as the room it shares
 * changes: Side by side's split by the lanes' width -- a window resized, a
 * scrollbar arriving -- and Stacked's line by the window's height (0145).
 * Null where there is none: in Separate views and Drill down, and in a
 * window too short for Stacked's line to move (`lineLimits`), where the
 * Records panel is as tall as what it holds. The value is the share inside
 * the limits, which the line says and the page draws the panel at, so a
 * share kept in a taller window is moved inside a shorter one's.
 *
 * Each size is kept as a number, so a `resize` that changes nothing -- a
 * phone's toolbar moving, a screenshot of the whole page -- renders nothing
 * again. A width measured in another layout is read again before it is
 * trusted.
 */
export function useLine(axis: Axis | null, shares: Shares, lanes: RefObject<HTMLElement | null>): Line | null {
  const [width, setWidth] = useState<number | null>(null)
  const [height, setHeight] = useState(windowHeight)

  useEffect(() => {
    if (axis !== 'height') return undefined
    const measure = (): void => setHeight(windowHeight())
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [axis])

  useEffect(() => {
    const element = lanes.current
    if (axis !== 'width' || element === null) return undefined
    const measure = (): void => setWidth(element.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver !== 'function') return () => setWidth(null)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      setWidth(null)
    }
  }, [axis, lanes])

  if (axis === null) return null
  const limits = lineLimits(axis, axis === 'width' ? (width ?? 0) : height, rem())
  return limits === null ? null : { axis, limits, value: clampSplit(shares[axis], limits) }
}

/** The size a line on `axis` shares: the lanes' width, or the window's height. */
function sizeOf(axis: Axis, lanes: HTMLElement): number {
  return axis === 'width' ? lanes.getBoundingClientRect().width : windowHeight()
}

/**
 * A line between the records and the record: the ARIA window splitter -- a
 * focusable `separator` with its value, its limits and its orientation,
 * controlling the Records panel, its primary pane -- dragged with a
 * pointer, or moved with its arrow keys, Home and End. Named by the
 * records' heading, the part it sizes.
 *
 * Side by side's split (0047, the person's decision of 2026-10-10) is drawn
 * down between the two lanes, so its orientation is vertical, and shares
 * their width, its value said as the two lanes' shares; where the window
 * draws Side by side stacked, the stylesheet hides it. Stacked's line
 * (0145) is drawn across between the records and the record, horizontal,
 * and shares the window's height, which the Records panel is drawn that
 * share of; its value is said as that alone, since the record below takes
 * what the page leaves it. `line` is `useLine`'s.
 *
 * The share changes while it moves; `onSettle` is told where it was left --
 * on release, or after a key -- which is when the page keeps it and the
 * grids fit their columns again. A drag the browser cancels ends without
 * being kept.
 */
export function Split({
  line,
  controls,
  lanes,
  labelledBy,
  onMove,
  onSettle,
}: {
  line: Line
  /** The id of the Records panel. */
  controls: string
  lanes: RefObject<HTMLElement | null>
  labelledBy: string
  onMove: (share: number) => void
  onSettle: (share: number) => void
}): ReactElement {
  const { axis, limits, value } = line
  /** The drag under way: where the pointer was pressed, and the share then. */
  const dragging = useRef<{ y: number; share: number } | null>(null)

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
      aria-controls={controls}
      aria-valuenow={value}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuetext={axis === 'width' ? `Records ${String(value)}%, the record ${String(100 - value)}%` : `Records ${String(value)}% of the window's height`}
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
