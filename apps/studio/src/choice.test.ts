// @vitest-environment node
//
// Node rather than jsdom: the choice model is plain data.
import { describe, expect, test } from 'vitest'
import { createSnapshot, findObject, generateForm } from '@formancy/data-core'
import type { ForeignKeyMeta, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import { formIdFor, lookupBlocker, pinCandidates, throughBlocker, titleFor } from './choice.js'
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

describe('the columns a policy can pin', () => {
  // A pinned column is a root row filter, and a filter compares a column's
  // canonical value exactly: a boolean or a timestamp has no spelling both
  // engines compare alike, and the server refuses a filter on one at publish
  // (0028). The customer's active and created_at are written by a person and
  // still not offered; its tenant is.
  test('offers only columns a row filter can compare', () => {
    const offered = pinCandidates(rootOf(OWNER_SNAPSHOT, 'customer')).map((column) => column.name)
    expect(offered).toContain('tenant_id')
    expect(offered).toContain('name')
    expect(offered).not.toContain('active')
    expect(offered).not.toContain('created_at')
  })
})

describe('which lookups a form can be reached through (0043)', () => {
  // A line has no tenant; its order does, and its key is an integer, which a
  // through compares as the foreign key does: offered. A customer's country
  // is keyed by iso_code, char(2): the two sides are compared directly, and
  // no snapshot records a collation to compare text by, so the server
  // refuses that through at publish -- and the studio says why first, in the
  // server's own words, because it asks the same function.
  test('offers a lookup over an integer key, and says why one over a text key is not', () => {
    const generated = (root: string, foreignKey: string, display: string) =>
      generateForm(OWNER_SNAPSHOT, { connection: 'fixture', root: { schema: 'sales', name: root }, formId: root, title: root, lookups: [{ foreignKey, display: [display] }] }).bindings
    expect(throughBlocker(OWNER_SNAPSHOT, generated('order_line', 'fk_order_line_order', 'order_date'), 'order')).toBeNull()
    expect(throughBlocker(OWNER_SNAPSHOT, generated('customer', 'fk_customer_country', 'name'), 'country')).toBe(
      'it joins sales.customer.country_code and sales.country.iso_code, which a through cannot compare: only integer, decimal, uuid and date keys are compared without a collation, and the snapshot records none',
    )
  })
})
