/*
 * What one viewer's browser keeps of the workspace, and nothing else: which
 * renderer draws the record, and where the split between the records and
 * the record sits (0047, the person's decisions of 2026-10-10). Kept in
 * `localStorage` for that viewer alone; every call is wrapped, because a
 * browser with site data blocked throws on each one, and the page then works
 * with the defaults. The token is never kept (0029).
 */

/** The renderers a person may have the record drawn with: one of the two, or both side by side. */
export type RendererChoice = 'react' | 'angular' | 'both'

export const RENDERER_CHOICES: readonly RendererChoice[] = ['react', 'angular', 'both']

/** The keys, said once, so a test can name every key the page may write. */
export const PREFERENCES = { renderer: 'formancy-data-host.renderer', split: 'formancy-data-host.split' } as const

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

function read(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // Not kept: the choice holds for this page until it is reloaded.
  }
}

export function readRenderer(storage: Storage | undefined): RendererChoice {
  const kept = read(storage, PREFERENCES.renderer)
  return RENDERER_CHOICES.find((choice) => choice === kept) ?? 'react'
}

export function writeRenderer(storage: Storage | undefined, choice: RendererChoice): void {
  write(storage, PREFERENCES.renderer, choice)
}

export function readSplit(storage: Storage | undefined): number {
  const kept = Number(read(storage, PREFERENCES.split))
  return Number.isInteger(kept) && kept >= SPLIT.outer.min && kept <= SPLIT.outer.max ? kept : SPLIT.initial
}

export function writeSplit(storage: Storage | undefined, share: number): void {
  write(storage, PREFERENCES.split, String(share))
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
