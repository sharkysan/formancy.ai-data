import { describe, expect, test } from 'vitest'
import { lookupFilters, rowFilterTerms } from './filters.js'
import type { RowFilters } from './types.js'

/** What a caller outside the type system can hand an adapter: a policy read from JSON, or JavaScript. */
const untyped = (value: unknown): RowFilters => value as RowFilters

describe('rowFilterTerms', () => {
  // An empty list used to mean "this actor sees every row", and an empty list
  // is exactly what `policy?.filters ?? []` produces when there is no policy:
  // the fail-open default. Seeing everything is now a value somebody has to
  // write, and every way of saying nothing — the old empty list, an empty
  // restriction, no filters at all — is refused before a query is built.
  test('reads no restriction only from an explicit unrestricted, and refuses every way of saying nothing', () => {
    expect(rowFilterTerms({ kind: 'unrestricted' })).toEqual([])
    for (const nothing of [[], { kind: 'restricted', equal: [] }, { kind: 'restricted' }, {}, undefined, null, 'unrestricted']) {
      expect(() => rowFilterTerms(untyped(nothing)), JSON.stringify(nothing) ?? 'undefined').toThrow(/at least one equality/)
    }
  })

  // A policy that says both "unrestricted" and "only tenant 7" contradicts
  // itself, and reading either half would be a guess. Refused, so the one
  // that grants more is never the one that won.
  test('refuses filters that carry more than their kind says', () => {
    expect(() => rowFilterTerms(untyped({ kind: 'unrestricted', equal: [{ column: 'tenant_id', value: '7' }] }))).toThrow(/at least one equality/)
    expect(() => rowFilterTerms(untyped({ kind: 'restricted', equal: [{ column: 'tenant_id', value: '7' }], or: [] }))).toThrow(/at least one equality/)
  })

  // The adapter quotes each column and binds each value. A column that is not
  // a name, or a value that is not the canonical text of one, would reach the
  // query as something nobody checked.
  test('returns each equality as a fresh column and text value, and refuses one that is not', () => {
    const filters: RowFilters = {
      kind: 'restricted',
      equal: [
        { column: 'tenant_id', value: '7' },
        { column: 'region', value: '' },
      ],
    }
    const terms = rowFilterTerms(filters)
    expect(terms).toEqual([
      { column: 'tenant_id', value: '7' },
      { column: 'region', value: '' },
    ])
    expect(terms[0]).not.toBe(filters.equal[0])

    for (const entry of [{ column: '', value: '7' }, { column: 'tenant_id', value: 7 }, { column: 'tenant_id' }, null, 'tenant_id=7']) {
      expect(() => rowFilterTerms(untyped({ kind: 'restricted', equal: [entry] })), JSON.stringify(entry)).toThrow(/a column name and a text value/)
    }
  })
})

describe('lookupFilters', () => {
  // The policy's lookupRowFilter and the lookup port were written in parallel
  // and meet here. Its filter terms must reach the adapter unchanged, and
  // nothing else it carried may.
  test('a policy filter becomes the same equalities, as fresh objects', () => {
    const policy = [{ column: 'tenant_id', value: 'acme', extra: 'dropped' } as { column: string; value: string }]
    const filters = lookupFilters(policy)
    expect(filters).toEqual({ kind: 'restricted', equal: [{ column: 'tenant_id', value: 'acme' }] })
    expect(rowFilterTerms(filters)).toEqual([{ column: 'tenant_id', value: 'acme' }])
  })

  // An empty policy filter reaches this only when the policy's entry for the
  // lookup was [] — the policy saying "every row" in so many words. A missing
  // entry or attribute is refused before. So here, and only here, [] is unrestricted.
  test('an empty policy filter is unrestricted, and rowFilterTerms reads it as no equalities', () => {
    expect(lookupFilters([])).toEqual({ kind: 'unrestricted' })
    expect(rowFilterTerms(lookupFilters([]))).toEqual([])
  })
})
