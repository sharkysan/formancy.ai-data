import { describe, expect, test } from 'vitest'
import { lookupConditionProblem, lookupFilterOffer } from './lookup-filter.js'

/*
 * What a lookup field offers a filter (0135), on the shapes of key the
 * fixtures' forms do not all have: every composite key there holds no
 * NULL, so the rule for one that may is held here.
 */

describe('a lookup’s offer', () => {
  // A key of several nullable columns refers to nothing when any of them
  // is NULL, which the grid shows as empty and no condition on one column
  // says: it offers equality alone, and refuses emptiness. A key of one
  // nullable column offers both. Watched failing with the column count
  // unasked: the two-column key offered `null` and planned it on its
  // first column alone.
  test('offers emptiness only on a key of one nullable column', () => {
    const composite = { columns: ['tenant_id', 'customer_no'], nullable: true }
    expect(lookupFilterOffer(composite)).toEqual({ operators: ['equals'], input: 'lookup', days: null })
    expect(lookupConditionProblem(composite, { op: 'null' }, 'customer')).toBe('customer offers no null condition.')
    expect(lookupFilterOffer({ columns: ['approved_by'], nullable: true }).operators).toEqual(['equals', 'null', 'not-null'])
    expect(lookupFilterOffer({ columns: ['created_by'], nullable: false }).operators).toEqual(['equals'])
  })
})
