// @vitest-environment node
//
// Node rather than jsdom: the choice model is plain data.
import { describe, expect, test } from 'vitest'
import { createSnapshot, findObject } from '@formancy/data-core'
import type { ForeignKeyMeta, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import { formIdFor, lookupBlocker, titleFor } from './choice.js'
import { OWNER_SNAPSHOT, WRITER_SNAPSHOT } from './test-server.js'

/**
 * What the Choose step offers, decided from the snapshot. The captured
 * fixture has every lookup target in sight; the two ways a target can be out
 * of it without a gap are built here from it, the one way a snapshot is made.
 */
function rootOf(snapshot: MetadataSnapshot, name = 'order'): ObjectMeta {
  const root = findObject(snapshot, { schema: 'sales', name })
  if (root === undefined) throw new Error(`the fixture has no sales.${name}`)
  return root
}

function keyOf(snapshot: MetadataSnapshot, root: string, name: string): ForeignKeyMeta {
  const key = rootOf(snapshot, root).foreignKeys.find((candidate) => candidate.name === name)
  if (key === undefined) throw new Error(`the fixture has no ${name}`)
  return key
}

const customerKey = (snapshot: MetadataSnapshot): ForeignKeyMeta => keyOf(snapshot, 'order', 'fk_order_customer')

describe('which lookups can be offered', () => {
  // A target in sight can be offered; that is the ordinary case.
  test('offers a key whose target this connection can see', () => {
    expect(lookupBlocker(OWNER_SNAPSHOT, rootOf(OWNER_SNAPSHOT), customerKey(OWNER_SNAPSHOT))).toBeNull()
  })

  // A key whose target the catalog would not name: the generator refuses it,
  // and the studio says why before anybody asks.
  test('refuses a key whose target is unknown, and says so', () => {
    const key = { ...customerKey(OWNER_SNAPSHOT), references: null }
    expect(lookupBlocker(OWNER_SNAPSHOT, rootOf(OWNER_SNAPSHOT), key)).toBe('This connection can see that the key exists but not what it references, so it cannot be offered.')
  })

  // A target in a schema discovery is not approved for is outside the scope,
  // not hidden: a different sentence, because the fix is different.
  test('refuses a key whose target is outside the approved schemas', () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    contents.objects = contents.objects.filter((object) => object.ref.name !== 'customer')
    const outside = createSnapshot(contents)
    expect(lookupBlocker(outside, rootOf(outside), customerKey(outside))).toBe('sales.customer is outside the schemas this connection discovers, so its rows cannot be offered.')
  })

  // In scope but hidden is a third answer: a gap on the target's schema says
  // the catalog may leave it out, and the studio repeats why, because the
  // remedy is a grant and not a change of scope.
  test('refuses a key whose target a schema gap hides, with the gap', () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    contents.objects = contents.objects.filter((object) => object.ref.name !== 'customer')
    contents.gaps = [{ subject: { kind: 'schema', schema: 'sales' }, aspect: 'objects', detail: 'no VIEW DEFINITION on schema sales' }]
    const hidden = createSnapshot(contents)
    expect(lookupBlocker(hidden, rootOf(hidden), customerKey(hidden))).toBe('sales.customer is not visible to this connection: no VIEW DEFINITION on schema sales.')
  })

  // The generator reads a lookup's own columns on the root as well as its
  // target's key (0027): the writer may read customer's country_code on
  // neither side. The reason names the root's column, which is the one the
  // form would have bound.
  test("refuses a key whose own columns on the root this connection may not read, naming the column", () => {
    const customer = rootOf(WRITER_SNAPSHOT, 'customer')
    expect(lookupBlocker(WRITER_SNAPSHOT, customer, keyOf(WRITER_SNAPSHOT, 'customer', 'fk_customer_country'))).toBe(
      'country_code of sales.customer cannot be read by this connection, so the lookup cannot be offered.',
    )
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
