import { grantsOnKey, reassignedKeys } from '@formancy/data-core'
import type { FieldAnchor, FormBindings, FormPolicy, ReassignedKey } from '@formancy/data-core'

/*
 * What a publish must say about keys that now stand for something else
 * (0039). A grant names a key, and a key renumbers when a colliding column
 * comes or goes (0030), so a grant written for what a key stood for applies
 * afterwards to whatever it stands for now. The policy shows a removal; only
 * the publish can say a key was kept.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function anchorOf(value: unknown): FieldAnchor | undefined {
  if (!isRecord(value)) return undefined
  if (value['kind'] === 'column' && typeof value['column'] === 'string') return { kind: 'column', column: value['column'] }
  if (value['kind'] === 'lookup' && typeof value['foreignKey'] === 'string') return { kind: 'lookup', foreignKey: value['foreignKey'] }
  return undefined
}

/**
 * A publish's `keysConfirmed`: absent is none, and anything but a list of
 * `{ field, was, now }`, each anchor a column or a lookup's foreign key, is
 * `undefined`. Each entry is rebuilt from what it names, so nothing else a
 * client sent is carried.
 */
export function readKeysConfirmed(value: unknown): ReassignedKey[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const keys: ReassignedKey[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry['field'] !== 'string') return undefined
    const was = anchorOf(entry['was'])
    const now = anchorOf(entry['now'])
    if (was === undefined || now === undefined) return undefined
    keys.push({ field: entry['field'], was, now })
  }
  return keys
}

const sameAnchor = (left: FieldAnchor, right: FieldAnchor): boolean =>
  left.kind === 'column' ? right.kind === 'column' && left.column === right.column : right.kind === 'lookup' && left.foreignKey === right.foreignKey

/**
 * The keys `replaced` bound to another column or lookup than `published`
 * does, that `published`'s policy grants on -- a role on the key's field,
 * `grantsOnKey`, the function the studio asks with -- and that `confirmed`
 * does not name exactly as reassigned: the same key, the column or lookup it
 * stood for, and the one it stands for now. A confirmation matched by key
 * alone would carry a decision to a column nobody was shown -- a studio
 * draft generated again after its keys were decided can renumber one again.
 * One for a key that was not reassigned grants nothing, and is ignored.
 *
 * An anchor is a column's or a foreign key's name, not its table's: a
 * publish that moves the form to another root or connection is compared by
 * name, and its grants follow their keys unasked (0039's costs).
 */
export function unconfirmedKeys(replaced: FormBindings, published: { bindings: FormBindings; policy: FormPolicy }, confirmed: readonly ReassignedKey[]): ReassignedKey[] {
  return reassignedKeys(replaced, published.bindings).filter(
    (key) => grantsOnKey(published.policy, key.field) && !confirmed.some((entry) => entry.field === key.field && sameAnchor(entry.was, key.was) && sameAnchor(entry.now, key.now)),
  )
}
