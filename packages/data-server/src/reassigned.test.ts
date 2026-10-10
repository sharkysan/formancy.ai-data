import { validatePolicy } from '@formancy/data-core'
import type { FieldBinding, FormBindings, FormPolicy } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { readKeysConfirmed, unconfirmedKeys } from './reassigned.js'

/*
 * What a publish must say about keys that now stand for something else
 * (0039), without a route: the route tests in admin-evolution.test.ts and
 * the suite on both engines prove the refusal; this proves it for a lookup's
 * key, which the fake database there has no way to re-point. What counts as
 * a grant is data-core's `grantsOnKey`, tested where it lives.
 */

const WRITES = { create: true, update: true }
const TEXT = { kind: 'text', maxLength: 40, lengthUnit: 'code-points', fixedLength: false } as const

const columnBinding = (field: string, column: string): FieldBinding => ({ kind: 'column', field, column, type: TEXT, nullable: true, writes: WRITES })
const lookupBinding = (field: string, foreignKey: string): FieldBinding => ({
  kind: 'lookup', field, foreignKey, columns: [`${field}_id`], target: { table: { schema: 'sales', name: field }, columns: ['id'] }, display: ['name'], source: `erp-${foreignKey}`, nullable: true, writes: WRITES,
} as FieldBinding)

const bindings = (...fields: FieldBinding[]): FormBindings => ({
  version: 2, root: { schema: 'sales', name: 'order' }, rootKind: 'table', identity: ['id'], concurrency: null, operations: { create: true, update: true }, fields, snapshotFingerprint: 'sha256:0',
})

const policy = (fields: FormPolicy['fields'], lookups: FormPolicy['lookups'] = {}): FormPolicy => ({
  version: 1, operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] }, fields, rowFilters: [], lookups,
})

/** `policy` over `after`, as the route has it: the bundle validated, so a state the route never receives is never asserted on. */
function fitted(after: FormBindings, policy: FormPolicy): { bindings: FormBindings; policy: FormPolicy } {
  const checked = validatePolicy(policy, after)
  if (!checked.ok) throw new Error(checked.problems.join('; '))
  return { bindings: after, policy }
}

describe('unconfirmedKeys', () => {
  // A lookup re-pointed to another foreign key keeps its key, and a role on
  // its field is a grant to decide. A lookup's filter is not one by itself:
  // a policy must have one for every lookup field, `[]` for every row, so a
  // filter counted as a grant left no way to remove a lookup key's grants,
  // and a field nobody may read or write has no options to search (the
  // runtime's field-denied). Watched failing with every lookup entry
  // counted: the key with no role was refused.
  test('a role on a re-pointed lookup needs confirming; its filter alone, which every lookup field has, does not', () => {
    const before = bindings(columnBinding('note', 'note'), lookupBinding('customer', 'fk_order_customer'))
    const after = bindings(columnBinding('note', 'note'), lookupBinding('customer', 'fk_order_buyer'))
    const repointed = { field: 'customer', was: { kind: 'lookup', foreignKey: 'fk_order_customer' }, now: { kind: 'lookup', foreignKey: 'fk_order_buyer' } } as const
    const granted = fitted(after, policy({ customer: { read: ['clerk'], write: [] } }, { customer: [] }))
    expect(unconfirmedKeys(before, granted, [])).toEqual([repointed])
    expect(unconfirmedKeys(before, granted, [repointed])).toEqual([])
    expect(unconfirmedKeys(before, fitted(after, policy({ customer: { read: [], write: ['clerk'] } }, { customer: [{ column: 'tenant', attribute: 'tenant' }] })), [])).toEqual([repointed])
    expect(unconfirmedKeys(before, fitted(after, policy({}, { customer: [] })), [])).toEqual([])
    expect(unconfirmedKeys(before, fitted(after, policy({ customer: { read: [], write: [] } }, { customer: [] })), [])).toEqual([])
  })

  // A key that became a lookup stands for something else as surely as a
  // renumbered column does, and a confirmation is of what it stands for, by
  // kind: a column that happens to share the foreign key's name is not the
  // lookup, and confirming one does not confirm the other.
  test('a column key that now names a lookup is reassigned, and only a confirmation of the lookup confirms it', () => {
    const before = bindings(columnBinding('customer', 'customer'))
    const after = bindings(lookupBinding('customer', 'fk_order_customer'))
    const published = fitted(after, policy({ customer: { read: ['clerk'], write: ['clerk'] } }, { customer: [] }))
    const now = { field: 'customer', was: { kind: 'column', column: 'customer' }, now: { kind: 'lookup', foreignKey: 'fk_order_customer' } } as const
    expect(unconfirmedKeys(before, published, [])).toEqual([now])
    expect(unconfirmedKeys(before, published, [{ ...now, now: { kind: 'column', column: 'fk_order_customer' } }])).toEqual([now])
    expect(unconfirmedKeys(before, published, [now])).toEqual([])
  })
})

describe('readKeysConfirmed', () => {
  // Absent is the publish every client sent before 0039, and it confirms nothing.
  test('absent is none; each entry is rebuilt from the anchors it names', () => {
    expect(readKeysConfirmed(undefined)).toEqual([])
    expect(readKeysConfirmed([{ field: 'note', was: { kind: 'column', column: 'note', extra: 1 }, now: { kind: 'lookup', foreignKey: 'fk', column: 'x' }, by: 'me' }])).toEqual([
      { field: 'note', was: { kind: 'column', column: 'note' }, now: { kind: 'lookup', foreignKey: 'fk' } },
    ])
  })
})
