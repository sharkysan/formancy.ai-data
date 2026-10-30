import type { ApiValue } from '../codecs/codec.js'
import { isLookupKeyType } from '../lookup/values.js'
import type { MetadataSnapshot, ObjectMeta, ObjectRef } from '../metadata.js'
import { findObject, gapCovers } from '../snapshot.js'
import type { BrowseEqualTerm } from './browse.js'

/*
 * The foreign keys a browsed row can be followed through, either way (0103):
 * to the row it refers to, and to the rows that refer to it. A follow is a
 * browse of the other end narrowed to the row's values (`planBrowse`'s
 * `equal`), so it is offered where that browse would be planned: both ends
 * in the snapshot, and every column of the key, at both ends, one the
 * account may select, of a key kind. The server plans every follow again
 * over its own discovery, and refuses one this snapshot offered and the
 * catalog no longer allows.
 *
 * Pure and isomorphic: the studio derives what it offers from the snapshot
 * it holds.
 */

/** A foreign key a row of the browsed object can be followed through. */
export interface BrowseRelation {
  /** `refers-to`: a key of the browsed object's own; `referred-by`: a key on another table, or on itself, that refers to it. */
  direction: 'refers-to' | 'referred-by'
  /** The key's name, as the catalog spells it. */
  key: string
  /** The browsed object's columns a row's values are read from, in the key's order. */
  from: string[]
  /** The object a follow browses, and its columns, paired with `from` by position. */
  to: { object: ObjectRef; columns: string[] }
}

/**
 * Why a key cannot be followed: `unseen`, it refers to something this
 * connection cannot see (`object` is then `null`, and a gap says so);
 * `not-browsed`, the other end is outside the approved schemas;
 * `not-comparable`, a column of it, at either end, is one the account may
 * not select or of a kind a browse is not narrowed by.
 */
export interface UnfollowedKey {
  direction: BrowseRelation['direction']
  key: string
  object: ObjectRef | null
  reason: 'unseen' | 'not-browsed' | 'not-comparable'
}

export interface BrowseRelations {
  /** What a row can be followed through: the object's own keys in snapshot order, then those referring to it in `referencedBy`'s. */
  relations: BrowseRelation[]
  /** Each key that cannot be followed, in the same order, and why. */
  unfollowed: UnfollowedKey[]
  /**
   * Whether the keys referring to the object are all there are: false when
   * a `referenced-by` gap covers it, or the snapshot predates 0049 and does
   * not say.
   */
  inboundComplete: boolean
}

/** Whether a browse may be narrowed by this column: one the account may select, of a kind whose values have one spelling on both engines. */
function comparable(object: ObjectMeta, names: readonly string[]): boolean {
  return names.every((name) => {
    const column = object.columns.find((candidate) => candidate.name === name)
    return column !== undefined && column.access.select && isLookupKeyType(column.type)
  })
}

/** Each foreign key at either end of `ref` in `snapshot`, followable or not and why. */
export function browseRelations(snapshot: MetadataSnapshot, ref: ObjectRef): BrowseRelations {
  const object = findObject(snapshot, ref)
  if (object === undefined) return { relations: [], unfollowed: [], inboundComplete: false }
  const relations: BrowseRelation[] = []
  const unfollowed: UnfollowedKey[] = []
  const consider = (relation: BrowseRelation): void => {
    const other = findObject(snapshot, relation.to.object)
    if (other === undefined) unfollowed.push({ direction: relation.direction, key: relation.key, object: relation.to.object, reason: 'not-browsed' })
    else if (!comparable(object, relation.from) || !comparable(other, relation.to.columns))
      unfollowed.push({ direction: relation.direction, key: relation.key, object: relation.to.object, reason: 'not-comparable' })
    else relations.push(relation)
  }
  for (const key of object.foreignKeys) {
    if (key.references === null) unfollowed.push({ direction: 'refers-to', key: key.name, object: null, reason: 'unseen' })
    else consider({ direction: 'refers-to', key: key.name, from: [...key.columns], to: { object: key.references.table, columns: [...key.references.columns] } })
  }
  for (const key of object.referencedBy ?? []) {
    consider({ direction: 'referred-by', key: key.name, from: [...key.referencedColumns], to: { object: key.table, columns: [...key.columns] } })
  }
  const inboundComplete = object.referencedBy !== undefined && !snapshot.gaps.some((gap) => gap.aspect === 'referenced-by' && gapCovers(gap, object.ref))
  return { relations, unfollowed, inboundComplete }
}

/**
 * What following `relation` from `row` narrows the other end to: each of
 * its columns equal to the row's value in the column it pairs with -- or
 * `null` when a value is NULL or not on the page. A foreign key with a NULL
 * in it refers to no row on either engine (MATCH SIMPLE), and a follow from
 * one would find the rows that merely share its other columns.
 */
export function followTerms(relation: BrowseRelation, row: Readonly<Record<string, ApiValue | undefined>>): BrowseEqualTerm[] | null {
  const terms: BrowseEqualTerm[] = []
  for (const [index, name] of relation.from.entries()) {
    const value = row[name]
    if (typeof value !== 'string') return null
    terms.push({ column: relation.to.columns[index] as string, value })
  }
  return terms
}
