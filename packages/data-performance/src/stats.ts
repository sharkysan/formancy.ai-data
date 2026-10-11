import type { Summary } from './results.js'

/*
 * Percentiles by nearest rank, in integers (0034). A percentile is a sample
 * that was measured, at rank ⌈q·n/100⌉, and it is published only when at
 * least ten samples sit at or above it. Whole percents, so neither the rank
 * nor that rule passes through floating point: 100 × (1 − 0.9) is not 10.
 */

/** The rank, from one, of the q-th percentile of n samples: ⌈q·n/100⌉, as `(q·n + 99) div 100`. */
export function rank(n: number, q: number): number {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`a percentile needs at least one sample, not ${String(n)}`)
  if (!Number.isInteger(q) || q < 1 || q > 100) throw new Error(`a percentile is a whole percent from 1 to 100, not ${String(q)}`)
  return Math.trunc((q * n + 99) / 100)
}

/** The q-th percentile of samples sorted ascending: the sample at its rank. */
export function nearestRank(sorted: readonly number[], q: number): number {
  const at = rank(sorted.length, q)
  for (let i = 1; i < sorted.length; i += 1) {
    if ((sorted[i] as number) < (sorted[i - 1] as number)) throw new Error('nearestRank takes samples sorted ascending')
  }
  return sorted[at - 1] as number
}

/** Whether the q-th percentile of n samples has ten samples at or above its rank, so it may be printed. */
export function supported(n: number, q: number): boolean {
  return n - rank(n, q) + 1 >= 10
}

/** n, p50, p90 and p99 where supported (null otherwise), max and mean, in the samples' unit. */
export function summarise(samples: readonly number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b)
  const n = sorted.length
  const at = (q: number): number | null => (supported(n, q) ? nearestRank(sorted, q) : null)
  return { n, p50: at(50), p90: at(90), p99: at(99), max: sorted[n - 1] as number, mean: sorted.reduce((sum, value) => sum + value, 0) / n }
}
