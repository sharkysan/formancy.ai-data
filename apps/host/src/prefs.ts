/*
 * What one viewer's browser keeps of the workspace, and nothing else: which
 * renderer draws the record, and where the split between the records and
 * the record sits (0047, the person's decisions of 2026-10-10), and for
 * each form a grid's columns and the list it shows, one value per kind of
 * section (0106, columns.ts). Kept in `localStorage` for that viewer alone;
 * every call is wrapped, because a browser with site data blocked throws on
 * each one, and the page then works with the defaults. The token is never
 * kept (0029), and no condition of a filter is (0104).
 */

/** The renderers a person may have the record drawn with: one of the two, or both side by side. */
export type RendererChoice = 'react' | 'angular' | 'both'

export const RENDERER_CHOICES: readonly RendererChoice[] = ['react', 'angular', 'both']

/**
 * The keys, said once, so a test can name every key the page may write:
 * `grid` is the prefix of a grid's, one per form in its Records panel and
 * one per form and parent field in a child section (`gridKey`).
 */
export const PREFERENCES = { renderer: 'formancy-data-host.renderer', split: 'formancy-data-host.split', grid: 'formancy-data-host.grid.' } as const

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
 * The split, as the records' share of the width in percent. 55 is the
 * person's default; `outer` bounds every limit, and a step is what an arrow
 * key moves it by. Not measured: the shares are the prototype's, and the
 * content minimums below are what the records' toolbar and a paper's two
 * columns were drawn at in it.
 */
export const SPLIT = { initial: 55, step: 5, outer: { min: 25, max: 75 } } as const

/** The narrowest each side may be, in rem: the Records panel's toolbar, and a form's paper. */
const MINIMUM = { records: 20, record: 24 } as const

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

export function readSplit(storage: Storage | undefined): number {
  const kept = Number(readPreference(storage, PREFERENCES.split))
  return Number.isInteger(kept) && kept >= SPLIT.outer.min && kept <= SPLIT.outer.max ? kept : SPLIT.initial
}

export function writeSplit(storage: Storage | undefined, share: number): void {
  writePreference(storage, PREFERENCES.split, String(share))
}

/**
 * How far the separator may move when the two lanes share `width` pixels and
 * a rem is `rem` pixels: neither side narrower than its content's minimum,
 * within the outer bounds. With no width to go by -- a lane not laid out --
 * the outer bounds; with too little for both minimums, the default alone.
 */
export function splitLimits(width: number, rem: number): { min: number; max: number } {
  if (!(width > 0)) return { ...SPLIT.outer }
  const min = Math.max(SPLIT.outer.min, Math.ceil(((MINIMUM.records * rem) / width) * 100))
  const max = Math.min(SPLIT.outer.max, Math.floor(100 - ((MINIMUM.record * rem) / width) * 100))
  return min > max ? { min: SPLIT.initial, max: SPLIT.initial } : { min, max }
}

/** `share` held inside `limits`. */
export function clampSplit(share: number, limits: { min: number; max: number }): number {
  return Math.min(limits.max, Math.max(limits.min, share))
}

/** Where a key moves the separator from `share`, or null for a key it does not answer. */
export function stepSplit(share: number, key: string, limits: { min: number; max: number }): number | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return clampSplit(share - SPLIT.step, limits)
    case 'ArrowRight':
    case 'ArrowDown':
      return clampSplit(share + SPLIT.step, limits)
    case 'Home':
      return limits.min
    case 'End':
      return limits.max
    default:
      return null
  }
}
