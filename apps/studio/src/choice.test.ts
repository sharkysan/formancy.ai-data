// @vitest-environment node
//
// Node rather than jsdom: the choice model is plain data.
import { describe, expect, test } from 'vitest'
import { createSnapshot, findObject, generateForm } from '@formancy/data-core'
import type { ForeignKeyMeta, MetadataSnapshot, ObjectMeta } from '@formancy/data-core'
import { choiceFor, choiceProblems, formIdFor, lookupBlocker, pinCandidates, proposalFor, throughBlocker, titleFor } from './choice.js'
import { OWNER_SNAPSHOT, SQLSERVER_SNAPSHOT, WRITER_SNAPSHOT } from './test-server.js'

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
    expect(lookupBlocker(OWNER_SNAPSHOT, rootOf(OWNER_SNAPSHOT), key)).toBe(
      'This connection can see that the key exists but not what it references, so it cannot be offered.',
    )
  })

  // A target in a schema discovery is not approved for is outside the scope,
  // not hidden: a different sentence, because the fix is different.
  test('refuses a key whose target is outside the approved schemas', () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    contents.objects = contents.objects.filter((object) => object.ref.name !== 'customer')
    const outside = createSnapshot(contents)
    expect(lookupBlocker(outside, rootOf(outside), customerKey(outside))).toBe(
      'sales.customer is outside the schemas this connection discovers, so its rows cannot be offered.',
    )
  })

  // In scope but hidden is a third answer: a gap on the target's schema says
  // the catalog may leave it out, and the studio repeats why, because the
  // remedy is a grant and not a change of scope.
  test('refuses a key whose target a schema gap hides, with the gap', () => {
    const { fingerprint: _, ...contents } = structuredClone(OWNER_SNAPSHOT)
    contents.objects = contents.objects.filter((object) => object.ref.name !== 'customer')
    contents.gaps = [{ subject: { kind: 'schema', schema: 'sales' }, aspect: 'objects', detail: 'no VIEW DEFINITION on schema sales' }]
    const hidden = createSnapshot(contents)
    expect(lookupBlocker(hidden, rootOf(hidden), customerKey(hidden))).toBe(
      'sales.customer is not visible to this connection: no VIEW DEFINITION on schema sales.',
    )
  })

  // The generator reads a lookup's own columns on the root as well as its
  // target's key (0027): the writer may read customer's country_code on
  // neither side. The reason names the root's column, which is the one the
  // form would have bound.
  test('refuses a key whose own columns on the root this connection may not read, naming the column', () => {
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
      generateForm(OWNER_SNAPSHOT, {
        connection: 'fixture',
        root: { schema: 'sales', name: root },
        formId: root,
        title: root,
        lookups: [{ foreignKey, display: [display] }],
      }).bindings
    expect(throughBlocker(OWNER_SNAPSHOT, generated('order_line', 'fk_order_line_order', 'order_date'), 'order')).toBeNull()
    expect(throughBlocker(OWNER_SNAPSHOT, generated('customer', 'fk_customer_country', 'name'), 'country')).toBe(
      'it joins sales.customer.country_code and sales.country.iso_code, which a through cannot compare: only integer, decimal, uuid and date keys are compared without a collation, and the snapshot records none',
    )
  })
})

describe('rows saved with their record, and a touch column, as the request carries them (0155)', () => {
  // What the Choose step chose is what the generator is asked for: a
  // lookup's bounds on its choice and the touch column on the request, and
  // neither where none is chosen -- the one spelling of none the server
  // reads. Watched failing with each left out of proposalFor, one at a
  // time: the request carried neither.
  test('carries a lookup’s bounds and the touch column, and nothing where none is chosen', () => {
    const order = choiceFor({ schema: 'sales', name: 'order' }, SQLSERVER_SNAPSHOT)
    expect(proposalFor('fixture-sqlserver', order, [])).not.toHaveProperty('touchColumn')
    expect(proposalFor('fixture-sqlserver', order, []).lookups.some((lookup) => 'together' in lookup)).toBe(false)
    const together = {
      ...order,
      touchColumn: 'status',
      lookups: order.lookups.map((lookup) => (lookup.foreignKey === 'fk_order_customer' ? { ...lookup, together: { min: 1, max: 20 } } : lookup)),
    }
    const asked = proposalFor('fixture-sqlserver', together, [])
    expect(asked.touchColumn).toBe('status')
    expect(asked.lookups.find((lookup) => lookup.foreignKey === 'fk_order_customer')?.together).toEqual({ min: 1, max: 20 })
  })

  // A box left empty is no number, and JSON has none to send: the step
  // refuses it before anything is sent, in the server's words for a
  // request's bounds. Watched failing with the bounds unasked: no problem
  // listed, so Generate would have sent it.
  test('refuses a bound that is no number, in the server’s words', () => {
    const lines = choiceFor({ schema: 'sales', name: 'order_line' }, OWNER_SNAPSHOT)
    const emptied = { ...lines, lookups: lines.lookups.map((lookup) => ({ ...lookup, together: { min: 0, max: Number.NaN } })) }
    expect(choiceProblems(emptied, [])).toEqual(['fk_order_line_order is saved with its record, and its bounds are not whole numbers.'])
  })

  // An order saved with its customer is reached through no other lookup:
  // the bundle check refuses a through by its creator, and the Policy step
  // says so where it would offer the box, in that check's words; through
  // the customer itself is offered. Watched failing with
  // togetherPolicyProblems left out of throughBlocker: the creator's
  // through had nothing against it, and its box would have been offered.
  test('says why a through by another field than the together one is not offered', () => {
    const bindings = generateForm(OWNER_SNAPSHOT, {
      connection: 'fixture',
      root: { schema: 'sales', name: 'order' },
      formId: 'sales-order',
      title: 'Order',
      lookups: [
        { foreignKey: 'fk_order_customer', display: ['name'], together: { min: 0, max: 5 } },
        { foreignKey: 'fk_order_created_by', display: ['name'] },
      ],
      versionColumn: 'row_version',
    }).bindings
    expect(throughBlocker(OWNER_SNAPSHOT, bindings, 'customer')).toBeNull()
    expect(throughBlocker(OWNER_SNAPSHOT, bindings, 'created_by')).toBe(
      "it scopes the rows by another field than customer, which is saved with its record: a person could read some of a record's rows and not others",
    )
  })
})
