/**
 * A seeded source of numbers: mulberry32, 32 bits of state, written here
 * rather than installed. The demo's data must be the same rows on every
 * build, on every machine, for as long as the seed is the same, and a
 * dependency's next release is a different sequence; this is a dozen lines
 * whose sequence only an edit to this file can change.
 *
 * Not for anything secret: it is a generator of plausible sample data.
 */
export interface Random {
  /** A whole number from 0 to 2^32 − 1. */
  uint32(): number
  /** A number from 0, inclusive, to 1, exclusive. */
  next(): number
  /** A whole number from `min` to `max`, both inclusive. */
  int(min: number, max: number): number
  /** True with probability `p`. */
  chance(p: number): boolean
  /** One element of a non-empty list, each as likely. */
  pick<T>(list: readonly T[]): T
  /** One value, each as likely as its weight is of the weights' sum. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T
}

export function seeded(seed: number): Random {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error(`a seed is a whole number from 0 to 2^32 - 1, not ${String(seed)}`)
  let state = seed
  const uint32 = (): number => {
    state = (state + 0x6d2b_79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
  const next = (): number => uint32() / 0x1_0000_0000
  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new Error(`int(${String(min)}, ${String(max)}) is no range of whole numbers`)
    return min + Math.floor(next() * (max - min + 1))
  }
  return {
    uint32,
    next,
    int,
    chance: (p) => next() < p,
    pick: (list) => {
      if (list.length === 0) throw new Error('pick from an empty list')
      return list[int(0, list.length - 1)] as (typeof list)[number]
    },
    weighted: (entries) => {
      if (entries.some(([, weight]) => !(weight >= 0))) throw new Error('a weight is zero or more')
      const drawable = entries.filter(([, weight]) => weight > 0)
      const last = drawable.at(-1)
      if (last === undefined) throw new Error('weighted needs a positive weight')
      let point = next() * drawable.reduce((sum, [, weight]) => sum + weight, 0)
      for (const [value, weight] of drawable.slice(0, -1)) {
        point -= weight
        if (point < 0) return value
      }
      // The last drawable value takes the rest, rounding included.
      return last[0]
    },
  }
}

/**
 * A stream of its own for one part of the data, from the seed and the part's
 * name (FNV-1a over its UTF-16 code units, mixed into the seed), so a change
 * to how customers are drawn does not redraw every order after them.
 */
export function stream(seed: number, part: string): Random {
  let hash = 0x811c_9dc5
  for (let i = 0; i < part.length; i += 1) hash = Math.imul(hash ^ part.charCodeAt(i), 0x0100_0193) >>> 0
  return seeded((seed ^ hash) >>> 0)
}
