// @vitest-environment node
//
// Node rather than jsdom: the choice model is plain data.
import { describe, expect, test } from 'vitest'
import { createSnapshot, findObject } from '@formancy/data-core'
import type { ForeignKeyMeta, MetadataSnapshot } from '@formancy/data-core'
import { formIdFor, lookupBlocker, titleFor } from './choice.js'
import { OWNER_SNAPSHOT } from './test-server.js'

/**
 * What the Choose step offers, decided from the snapshot. The captured
 * fixture has every lookup target in sight; the two ways a target can be out
 * of it without a gap are built here from it, the one way a snapshot is made.
 */
function customerKey(snapshot: MetadataSnapshot): ForeignKeyMeta {
  const key = findObject(snapshot, { schema: 'sales', name: 'order' })?.foreignKeys.find((candidate) => candidate.name === 'fk_order_customer')
  if (key === undefined) throw new Error('the fixture has no fk_order_customer')
  return key
}

describe('which lookups can be offered', () => {
  // A target in sight can be offered; that is the ordinary case.
  test('offers a key whose target this connection can see', () => {
    expect(lookupBlocker(OWNER_SNAPSHOT, customerKey(OWNER_SNAPSHOT))).toBeNull()
  })

  // A key whose target the catalog would not name: the generator refuses it,
  // and the studio says why before anybody asks.
  test('refuses a key whose target is unknown, and says so', () => {
    const key = { ...customerKey(OWNER_SNAPSHOT), references: null }
    expect(lookupBlocker(OWNER_SNAPSHOT, key)).toBe('This connection can see that the key exists but not what it references, so it cannot be offered.')
  })

  // A target in a schema discovery is not approved for is outside the scope,
  // not hidden: a different sentence, because the fix is different.
  test('refuses a key whose target is outside the approved schemas', () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    contents.objects = contents.objects.filter((object) => object.ref.name !== 'customer')
    const outside = createSnapshot(contents)
    expect(lookupBlocker(outside, customerKey(outside))).toBe('sales.customer is outside the schemas this connection discovers, so its rows cannot be offered.')
  })
})

describe('the defaults a root suggests', () => {
  // The suggested id is one the server accepts, whatever the table is called.
  test('suggests a form id the server accepts, and a title as the generator writes labels', () => {
    expect(formIdFor({ schema: 'Sales', name: 'Order Line' })).toBe('sales-order-line')
    expect(formIdFor({ schema: '_x', name: 'y' })).toBe('x-y')
    expect(titleFor({ schema: 'sales', name: 'order_line' })).toBe('Order line')
    expect(titleFor({ schema: 'sales', name: '__' })).toBe('__')
  })
})
