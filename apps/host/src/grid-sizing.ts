import { ROW_HEIGHT } from './grid-theme.js'

/*
 * When a grid sizes its columns to the rows it shows (0047). AG Grid sizes
 * a column by measuring its cells, and a cell in a hidden panel measures
 * nothing: sized there, every column took its least width, its header's
 * longest word, and kept it, since paging never sizes again. A grid in a
 * tab another hides (0142), in Separate views' hidden view or on a Drill
 * down level not shown, so sizes only where it is drawn, and otherwise
 * owes the size, which it pays when it is shown. And how tall a grid's well
 * is for the rows its page holds (`wellHeight`).
 */

/** What a grid knows of its page and its columns. */
export interface SizeState {
  /** A page has answered. */
  loaded: boolean
  /** How many rows that page drew: nothing to size to without one. */
  rows: number
  /** The columns were sized to a page: a later one leaves them. */
  sized: boolean
  /** A size it could not make while hidden, made once it is shown. */
  owed: boolean
}

/**
 * Why the grid would size now: `page`, a page with rows answered; `refit`,
 * the separator let go; `added`, columns shown while nothing was listed,
 * sized to the rows that came; `shown`, its well's size changed, as it does
 * when the well is drawn again.
 */
export type SizeWant = 'page' | 'refit' | 'added' | 'shown'

/** Whether to size now, and whether a size is owed after. */
export function sizing(state: SizeState, want: SizeWant, hidden: boolean): { size: boolean; owed: boolean } {
  const keep = { size: false, owed: state.owed }
  if (!state.loaded || state.rows === 0) return keep
  if (want === 'shown') return hidden || !state.owed ? keep : { size: true, owed: false }
  if (want === 'page' && state.sized) return keep
  if (hidden) return { size: false, owed: true }
  return { size: true, owed: want === 'added' ? state.owed : false }
}

/**
 * Whether a grid's well is drawn nowhere: under an element the page hides
 * by its `hidden` attribute, which workspace.css makes `display: none` -- a
 * view, a Drill down level, a tab's panel. Read from the document rather
 * than from a measured box, which jsdom, having no layout, gives every
 * element as empty.
 */
export function hiddenWell(well: Element | null): boolean {
  return well === null || well.closest('[hidden]') !== null
}

/**
 * How tall a well is for `rows` rows: the header, a 36px band each (two
 * when there are none), the 16px scrollbar AG Grid keeps, and the frame --
 * and where the well's own max-height caps it, whole rows only, so no row is
 * cut by the scrollbar's band (UX-SPEC §3).
 */
export function wellHeight(header: number, rows: number, cap: number): number {
  const band = 16
  let bands = Math.max(rows, 2)
  if (Number.isFinite(cap)) bands = Math.max(2, Math.min(bands, Math.floor((cap - header - band - 2) / ROW_HEIGHT)))
  return Math.ceil(header + bands * ROW_HEIGHT + band + 2)
}
