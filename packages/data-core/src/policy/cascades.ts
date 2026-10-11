import type { FormBindings } from '../generate/types.js'
import type { InboundKey, MetadataSnapshot, ObjectRef, ReferentialAction } from '../metadata.js'
import type { DeleteReach } from '../records/types.js'
import type { Deleting } from '../runtime.js'
import { findObject, gapCovers } from '../snapshot.js'
import type { FormPolicy } from './types.js'

/*
 * What deleting a record of a form's root also does, through the foreign
 * keys that refer to it, and whether the policy may grant it (0050).
 *
 * One decision, asked at publish and on every read of a bundle
 * (`policyProblems`), by the planner before a delete is sent, by drift review
 * through `unaccepted`, and by the studio: so a delete the policy cannot
 * grant is refused alike everywhere, and a key that would act on a delete
 * stops it in review exactly where it would be refused at publish.
 *
 * 0050 reaches nothing past the root: a key that deletes, clears or sets a
 * default in another table's rows on a delete makes the grant refused, and a
 * key that only refuses -- NO ACTION, RESTRICT -- is the database's to
 * enforce, which a person is told may happen. Triggers and rules are not
 * keys: what the database runs on a delete beyond them is its own (0050).
 */

/** What an acting key does to the rows that refer to the record deleted, for a sentence. */
const ACTIONS: Readonly<Partial<Record<ReferentialAction, string>>> = {
  cascade: 'ON DELETE CASCADE',
  'set-null': 'ON DELETE SET NULL',
  'set-default': 'ON DELETE SET DEFAULT',
}

/** Whether a key changes other rows when a row it refers to is deleted: cascades, or sets NULL or a default. */
export function actsOnDelete(action: ReferentialAction): boolean {
  return ACTIONS[action] !== undefined
}

/**
 * Whether a key onto a table a delete reaches does something on delete the
 * policy has not accepted: in 0050, any key that acts, because no policy
 * accepts one. Counted whatever its `enforced` flag: on PostgreSQL a key
 * some of whose triggers are disabled may still act (0049), and one enabled
 * again acts without anything here noticing.
 *
 * Drift review asks this of a key that appeared or changed, so a change it
 * calls unaccepted is one the publish check would refuse.
 */
export function unaccepted(_policy: Pick<FormPolicy, 'operations'>, key: Pick<InboundKey, 'onDelete'>): boolean {
  return actsOnDelete(key.onDelete)
}

/** The roles a stored policy grants delete, whatever shape a hand edit left it in; `validatePolicy` reports a bad shape. */
function deleteRoles(policy: Pick<FormPolicy, 'operations'>): string[] {
  const operations: unknown = (policy as { operations?: unknown }).operations
  const roles: unknown = typeof operations === 'object' && operations !== null && Object.hasOwn(operations, 'delete') ? (operations as Record<string, unknown>)['delete'] : undefined
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string' && role !== '') : []
}

/** Whether a stored policy lets any role delete. */
export function grantsDelete(policy: Pick<FormPolicy, 'operations'>): boolean {
  return deleteRoles(policy).length > 0
}

/** What a delete of one record of the form's root reaches, as the snapshot shows it, and whether a key may refuse it. */
export interface DeleteReachFacts {
  reach: DeleteReach
  /** A NO ACTION or RESTRICT key refers to a table the delete reaches: the database may refuse it while the record is referred to. */
  restricted: boolean
}

/**
 * What deleting one record of `root` reaches (0050): the root alone, which
 * the delete removes, and nothing it clears or accepts. `restricted` says
 * whether the snapshot shows a key that would refuse the delete while a row
 * refers to the record, whether or not one does.
 */
export function deleteReach(snapshot: MetadataSnapshot, root: ObjectRef): DeleteReachFacts {
  const keys = findObject(snapshot, root)?.referencedBy ?? []
  return {
    reach: { removed: [{ schema: root.schema, name: root.name }], cleared: [], accepted: [] },
    restricted: keys.some((key) => key.onDelete === 'no-action' || key.onDelete === 'restrict'),
  }
}

/**
 * What a delete of a record of `root` does besides removing it, for a page
 * to word its confirmation by (0050): it cascades and clears nothing in
 * 0050, and may be refused where the snapshot shows a key that refuses it.
 */
export function deleteEffects(snapshot: MetadataSnapshot, root: ObjectRef): Deleting {
  return { cascades: false, clears: false, restricted: deleteReach(snapshot, root).restricted }
}

function describe(ref: ObjectRef): string {
  return `${ref.schema}.${ref.name}`
}

/** What one acting key does to the rows that refer to a record of `root` that is deleted, as a clause: drift review says it too. */
export function deleteEffect(root: ObjectRef, key: Pick<InboundKey, 'table' | 'name' | 'columns' | 'onDelete'>): string {
  const of = describe(key.table)
  const action = ACTIONS[key.onDelete] as string
  if (key.onDelete === 'cascade') return `deleting a record of ${describe(root)} also deletes rows of ${of} (${key.name}, ${action})`
  const columns = key.columns.join(', ')
  return `deleting a record of ${describe(root)} also sets ${columns} of ${of} to ${key.onDelete === 'set-null' ? 'NULL' : 'its default'} in the rows that refer to it (${key.name}, ${action})`
}

/**
 * Why a policy may not grant delete on this form, as the snapshot shows the
 * form's root, or nothing (0050): nothing when it grants delete to nobody.
 *
 * Refused when the snapshot does not record what refers to the root -- one
 * taken before 0049 -- or says by a `referenced-by` gap that it cannot see
 * all of it; and for every key that refers to the root and acts on delete,
 * enforced or not, which 0050 does not let a delete reach through.
 */
export function deleteProblems(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy): string[] {
  if (!grantsDelete(policy)) return []
  const root = findObject(snapshot, bindings.root)
  // A root the snapshot lacks is the bindings' problem, reported as such.
  if (root === undefined) return []
  const table = describe(root.ref)
  if (root.referencedBy === undefined) {
    return [`operations.delete grants roles, and this snapshot does not record what refers to ${table}, so what a delete also does cannot be seen: discover again`]
  }
  const problems = snapshot.gaps
    .filter((gap) => gap.aspect === 'referenced-by' && gapCovers(gap, root.ref))
    .map((gap) => `operations.delete grants roles, and this snapshot cannot show everything that refers to ${table}: ${gap.detail}`)
  for (const key of root.referencedBy) {
    if (unaccepted(policy, key)) problems.push(`operations.delete grants roles, and ${deleteEffect(root.ref, key)}, which this release does not offer`)
  }
  return problems
}
