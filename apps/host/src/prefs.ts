import { LAYOUTS } from './layout.js'
import type { Layout } from './layout.js'

/*
 * What one viewer's browser keeps of the workspace, and nothing else: which
 * renderer draws the record, and where the split between the records and
 * the record sits (0047, the person's decisions of 2026-10-10), the layout
 * they chose last and where Stacked's line sits (0145), and for each form a
 * grid's columns and the list it shows, one value per kind of section
 * (0106, columns.ts). Kept in `localStorage` for that viewer alone; every
 * call is wrapped, because a browser with site data blocked throws on each
 * one, and the page then works with the defaults. The token is never kept
 * (0029), and no condition of a filter is (0104).
 */

/** The renderers a person may have the record drawn with: one of the two, or both side by side. */
export type RendererChoice = 'react' | 'angular' | 'both'

export const RENDERER_CHOICES: readonly RendererChoice[] = ['react', 'angular', 'both']

/**
 * The keys, said once, so a test can name every key the page may write:
 * `grid` is the prefix of a grid's, one per form in its Records panel and
 * one per form and parent field in a child section (`gridKey`).
 */
export const PREFERENCES = {
  renderer: 'formancy-data-host.renderer',
  layout: 'formancy-data-host.layout',
  split: 'formancy-data-host.split',
  stack: 'formancy-data-host.stack',
  grid: 'formancy-data-host.grid.',
} as const

/** Which grid of a form a kept value is for: its Records panel's, or a child section's, narrowed by one of its lookup fields. */
export type GridSection = { kind: 'records' } | { kind: 'child'; field: string }

/**
 * The key of a form's grid in one kind of section: the kind first, so no
 * form id can spell another's; a child section's by the field its rows are
 * narrowed by too, so an employee's orders created and approved, both on
 * screen, keep two arrangements and neither writes over the other. A form
 * id is `[a-z0-9][a-z0-9._-]*` and a field key letters, digits and
 * underscores, so the slash between them is no one's.
 */
export function gridKey(section: GridSection, formId: string): string {
  return section.kind === 'records' ? `${PREFERENCES.grid}records.${formId}` : `${PREFERENCES.grid}child.${formId}/${section.field}`
}

/**
 * Which way a line between the records and the record moves (0145): Side by
 * side's split across the width the two lanes share, Stacked's line down
 * the window's height.
 */
export type Axis = 'width' | 'height'

/** The records' share of each axis, in percent. */
export type Shares = Readonly<Record<Axis, number>>

/** How far a line may move, in percent. */
export interface Limits {
  min: number
  max: number
}

/**
 * Each line's share, the records' in percent: its default, the step an
 * arrow key moves it by, the outer bounds every limit is inside, the least
 * each side may be in rem, and the key it is kept under.
 *
 * Side by side's is the person's (0047): 55 by default, across the width
 * the two lanes share. Not measured: the shares are the prototype's, and the
 * least widths what the records' toolbar and a paper's two columns were
 * drawn at in it.
 *
 * Stacked's (0145) is a share of the window's height, which the Records
 * panel is drawn as tall as. Not measured either, but summed from the
 * stylesheets' own heights and rounded up: the records' least, 18rem, is
 * their heading's row and the search's, 2.5rem each (controls.css), the
 * grid's header, its row of boxes and one row, 134 pixels at
 * grid-theme.ts's heights, and the panel's padding and gaps; the record's,
 * 12rem, is the 7.5rem the app bar and the form's header take above the
 * lanes on a wide window (workspace.css), the line's 0.75rem, and the
 * record's heading's row inside its panel's padding. 60 is where the two
 * meet in the shortest window that holds both, 30rem: 18 of the 30.
 */
export const SPLITS = {
  width: { key: PREFERENCES.split, initial: 55, step: 5, outer: { min: 25, max: 75 }, least: { records: 20, record: 24 } },
  height: { key: PREFERENCES.stack, initial: 60, step: 5, outer: { min: 25, max: 75 }, least: { records: 18, record: 12 } },
} as const

/** The keys that move a line towards less of the records and towards more: Side by side's split takes either arrow of each pair, as it always has; Stacked's line, drawn across, Up and Down alone, as the window splitter pattern has a horizontal one. */
const KEYS: Readonly<Record<Axis, { less: readonly string[]; more: readonly string[] }>> = {
  width: { less: ['ArrowLeft', 'ArrowUp'], more: ['ArrowRight', 'ArrowDown'] },
  height: { less: ['ArrowUp'], more: ['ArrowDown'] },
}

/** The line a layout draws between the records and the record: none where one view is shown at a time. */
export function axisOf(layout: Layout): Axis | null {
  return layout === 'side-by-side' ? 'width' : layout === 'stacked' ? 'height' : null
}

/** `localStorage`, or nothing where reading it throws. */
export function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** What `storage` holds under `key`, or null where it holds nothing or throws. */
export function readPreference(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** `value` kept under `key`, where `storage` keeps anything. */
export function writePreference(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // Not kept: the choice holds for this page until it is reloaded.
  }
}

/** Nothing kept under `key` any more, where `storage` can be asked. */
export function removePreference(storage: Storage | undefined, key: string): void {
  try {
    storage?.removeItem(key)
  } catch {
    // Not removed: what was kept comes back on the next opening, as it would have.
  }
}

export function readRenderer(storage: Storage | undefined): RendererChoice {
  const kept = readPreference(storage, PREFERENCES.renderer)
  return RENDERER_CHOICES.find((choice) => choice === kept) ?? 'react'
}

export function writeRenderer(storage: Storage | undefined, choice: RendererChoice): void {
  writePreference(storage, PREFERENCES.renderer, choice)
}

export function readShare(storage: Storage | undefined, axis: Axis): number {
  const { key, initial, outer } = SPLITS[axis]
  const kept = Number(readPreference(storage, key))
  return Number.isInteger(kept) && kept >= outer.min && kept <= outer.max ? kept : initial
}

export function writeShare(storage: Storage | undefined, axis: Axis, share: number): void {
  writePreference(storage, SPLITS[axis].key, String(share))
}

/** The layout the viewer chose last, or null where none is kept or what is kept names none. */
export function readLayout(storage: Storage | undefined): Layout | null {
  const kept = readPreference(storage, PREFERENCES.layout)
  return LAYOUTS.find((layout) => layout === kept) ?? null
}

export function writeLayout(storage: Storage | undefined, layout: Layout): void {
  writePreference(storage, PREFERENCES.layout, layout)
}

/**
 * How far the line on `axis` may move when it shares `size` pixels -- the
 * lanes' width, or the window's height -- and a rem is `rem` pixels: neither
 * side smaller than its least, within the outer bounds. With no size to go
 * by -- a lane not laid out -- the outer bounds; with too little for both
 * leasts, the default alone.
 */
export function shareLimits(axis: Axis, size: number, rem: number): Limits {
  const { initial, outer, least } = SPLITS[axis]
  if (!(size > 0)) return { ...outer }
  const min = Math.max(outer.min, Math.ceil(((least.records * rem) / size) * 100))
  const max = Math.min(outer.max, Math.floor(100 - ((least.record * rem) / size) * 100))
  return min > max ? { min: initial, max: initial } : { min, max }
}

/**
 * The limits of the line `axis` draws in `size` pixels, or null where it
 * would have no room to move: Stacked's in a window too short for the
 * records' least and the record's together with room between them -- 488
 * pixels at 16 to the rem, about 30.5rem, as a phone on its side or a
 * laptop at 200% is (0145) -- there Stacked draws no line, and its
 * Records panel is as tall as what it holds. Side by side's split keeps its
 * pinned default where its lanes are too narrow, as it always has.
 */
export function lineLimits(axis: Axis, size: number, rem: number): Limits | null {
  const limits = shareLimits(axis, size, rem)
  return axis === 'height' && limits.min >= limits.max ? null : limits
}

/** `share` held inside `limits`. */
export function clampSplit(share: number, limits: Limits): number {
  return Math.min(limits.max, Math.max(limits.min, share))
}

/** Where a key moves the line on `axis` from `share`, or null for a key it does not answer. */
export function stepShare(axis: Axis, share: number, key: string, limits: Limits): number | null {
  const { step } = SPLITS[axis]
  if (KEYS[axis].less.includes(key)) return clampSplit(share - step, limits)
  if (KEYS[axis].more.includes(key)) return clampSplit(share + step, limits)
  if (key === 'Home') return limits.min
  if (key === 'End') return limits.max
  return null
}
