import { DRIFTING } from '@formancy/data-fixtures'
import type { DriftingCase } from '@formancy/data-fixtures'
import { describe, expect, test } from 'vitest'
import { driftedCase } from './drifted.js'

/** The shared cases with `narrowed-decimal` changed by `change`. */
function changed(change: (entry: DriftingCase) => DriftingCase): DriftingCase[] {
  return DRIFTING.map((entry) => (entry.name === 'narrowed-decimal' ? change(entry) : entry))
}

describe("the refusals' case", () => {
  // The refusals count what a write drift review stops still sends. Over a
  // case that no longer stops a write they would count a write that reached
  // the database and call it a refusal, and over one that stops reads too
  // the update would be refused before the read the pin counts.
  test('is the shared narrowed-decimal case, which stops both writes and allows reading', () => {
    expect(driftedCase().name).toBe('narrowed-decimal')
    expect(() => driftedCase(changed((entry) => ({ ...entry, verdict: { read: true, create: true, update: false } })))).toThrow(/no longer stops both writes while allowing reads/)
    expect(() => driftedCase(changed((entry) => ({ ...entry, verdict: { read: false, create: false, update: false } })))).toThrow(/no longer stops both writes while allowing reads/)
  })

  // Both engines are counted; a case one engine lost would leave that
  // engine's refusals with no table to change.
  test('refuses a case that no longer runs on both engines, or is gone', () => {
    expect(() => driftedCase(changed((entry) => ({ ...entry, setUp: { postgres: entry.setUp.postgres ?? [] } })))).toThrow(/no longer runs on both engines/)
    expect(() => driftedCase(DRIFTING.filter((entry) => entry.name !== 'narrowed-decimal'))).toThrow(/has no narrowed-decimal case/)
  })
})
