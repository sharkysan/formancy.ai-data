import type { GridColumn } from './grid-datasource.js'
import { ROOM_GRID } from './grid-theme.js'

/*
 * A grid column's width as a person sets it (0151), as data: the widths a
 * section keeps, read from and written to the value a viewer's browser
 * keeps of a grid (columns.ts, 0106), a press of the Columns panel's Wider
 * or Narrower, the floor a header's words set and what the panel says.
 * Where a width is drawn and how the grid reports one set by a drag is
 * record-grid.tsx's; that the page's sizing never sizes a kept column to
 * its content is use-grid-sizing.ts's.
 *
 * A width is a whole number of CSS pixels from NARROWEST to WIDEST, and
 * one the reader would not take is dropped alone: a width is the least of
 * what is kept, and losing the columns or the view kept beside it for one
 * would cost a person more than the width.
 */

/** A column's width as a person set it: a field the form offers, and whole CSS pixels. */
export interface ColumnWidth {
  field: string
  width: number
}

/** A column's width set, or taken away (`null`) so that it is sized to its content again. */
export interface WidthChange {
  field: string
  width: number | null
}

/** A column as the grid draws it now: its width, and the least and most AG Grid lets it be. */
export interface Measured {
  width: number
  min: number
  max: number
}

/** What one press of Wider or Narrower moves a column by: a ruling of 0151's, an eighth of `CONTENT_WIDTH`. */
export const WIDTH_STEP = 40

/** The widest the page sizes a column to its content, so one long note does not take the well (0047). */
export const CONTENT_WIDTH = 320

/** The widest a person may make a column, and the widest the reader takes: three times `CONTENT_WIDTH`, a ruling of 0151's. */
export const WIDEST = 960

/** The cell's padding on each side, said once: AG Grid's own, and part of every header's floor. */
const PADDING = ROOM_GRID.cellHorizontalPadding

/** What a sortable header's icon takes beside its words. */
const SORT_ICON = 22

/** What a header's floor allows beyond its words, its padding and its icon. */
const SLACK = 4

/** The narrowest any header's floor is -- its padding, with no word -- and the narrowest the reader takes. */
export const NARROWEST = 2 * PADDING + SLACK

/**
 * The face a header is drawn in, as a canvas names one: the grid theme's
 * weight and size (grid-theme.ts), in the family its room variable holds
 * where the page sets it -- the one place each is said. A canvas measures
 * in a fallback face until the web font has loaded, so the grid measures
 * its floors again once it has (use-fonts-loaded.ts).
 */
export function headerFace(): string {
  const named = /^var\((--[\w-]+)\)$/.exec(ROOM_GRID.headerFontFamily)?.[1]
  const family = named === undefined ? ROOM_GRID.headerFontFamily : getComputedStyle(document.documentElement).getPropertyValue(named).trim()
  return `${String(ROOM_GRID.headerFontWeight)} ${String(ROOM_GRID.headerFontSize)}px ${family === '' ? 'sans-serif' : family}`
}

/**
 * The narrowest a column may be, by a drag, a press or its content: its
 * header's widest word, so a header wraps between words and never cuts one
 * (WCAG 1.4.12), with that criterion's letter spacing allowed for, the
 * cell's padding, and the sort's icon. Measured in the header's face where
 * the page can draw text; estimated where it cannot.
 */
export function headerFloor(label: string, sortable: boolean): number {
  const words = label.split(/\s+/)
  let widest = Math.max(...words.map((word) => word.length * 8))
  // jsdom has no 2D canvas: the estimate stands there.
  const context = typeof CanvasRenderingContext2D === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (context !== null) {
    context.font = headerFace()
    widest = Math.max(...words.map((word) => context.measureText(word).width + word.length * 0.12 * ROOM_GRID.headerFontSize))
  }
  return Math.ceil(widest) + 2 * PADDING + (sortable ? SORT_ICON : 0) + SLACK
}

const inRange = (width: number): number => Math.min(WIDEST, Math.max(NARROWEST, Math.round(width)))

const isWidth = (value: unknown): value is ColumnWidth => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  const width = entry['width']
  return (
    Object.keys(entry).every((key) => key === 'field' || key === 'width') &&
    typeof entry['field'] === 'string' &&
    entry['field'] !== '' &&
    typeof width === 'number' &&
    Number.isInteger(width) &&
    width >= NARROWEST &&
    width <= WIDEST
  )
}

/**
 * The widths in what a browser kept (`value`, the kept value's `widths`):
 * each one this release would write, in its order, a field's first only;
 * every other entry dropped alone, and nothing for anything but a list.
 */
export function readWidths(value: unknown): ColumnWidth[] {
  if (!Array.isArray(value)) return []
  const named = new Set<string>()
  const widths: ColumnWidth[] = []
  for (const entry of value) {
    if (!isWidth(entry) || named.has(entry.field)) continue
    named.add(entry.field)
    widths.push({ field: entry.field, width: entry.width })
  }
  return widths
}

/** The kept widths of the columns the form offers now: a field it no longer offers has no column to be wide. */
export function offeredWidths(widths: readonly ColumnWidth[], columns: readonly GridColumn[]): ColumnWidth[] {
  const offered = new Set(columns.map((column) => column.key))
  return widths.filter((each) => offered.has(each.field))
}

/** `widths` with each change made: a width set in place, or after the others where the field had none, whole and in range; a `null` taking the field's away. */
export function withWidths(widths: readonly ColumnWidth[], changes: readonly WidthChange[]): ColumnWidth[] {
  let next = [...widths]
  for (const { field, width } of changes) {
    if (width === null) {
      next = next.filter((each) => each.field !== field)
      continue
    }
    const set = { field, width: inRange(width) }
    next = next.some((each) => each.field === field) ? next.map((each) => (each.field === field ? set : each)) : [...next, set]
  }
  return next
}

/**
 * Of the widths a person's resize finished at, those that moved from the
 * width their column had when it began (`settled`): a click on a header's
 * edge -- AG Grid starts its resize on the press and tells the release as
 * finished -- or Alt and an arrow at an end sets none. A column with no
 * settled width is taken as moved.
 */
export function changedWidths(finished: readonly ColumnWidth[], settled: ReadonlyMap<string, number>): ColumnWidth[] {
  return finished.filter(({ field, width }) => settled.get(field) !== width)
}

/** The width one press of Wider (1) or Narrower (-1) gives a column drawn `now`: one step, never past its floor or `WIDEST`. */
export function stepWidth(now: Measured, by: -1 | 1): number {
  const least = Math.max(NARROWEST, Math.ceil(now.min))
  const most = Math.min(WIDEST, Math.floor(now.max))
  return Math.min(most, Math.max(least, Math.round(now.width) + by * WIDTH_STEP))
}

/** What the Columns panel says of a press: the width set, an end reached, or the column sized to its content again. */
export function widthSaid(label: string, width: number, how: 'set' | 'widest' | 'narrowest' | 'fitted'): string {
  if (how === 'fitted') return `${label} is sized to its content.`
  if (how === 'widest') return `${label} is as wide as a column goes: ${String(width)} pixels.`
  if (how === 'narrowest') return `${label} is as narrow as its header lets it be: ${String(width)} pixels.`
  return `${label} is ${String(width)} pixels wide.`
}
