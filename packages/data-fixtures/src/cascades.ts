import type { DatabaseKind } from '@formancy/data-core'
import type { DeleteAnswer, DeleteExpectation } from './deletes.js'

/*
 * What a delete does past its record on both engines (0051), written once
 * for both adapters' `cascade.integration.test.ts` and, for a lost answer,
 * their `records-lost-answer.integration.test.ts`.
 *
 * Over the parity schema's removable_parent: its removable_cascade rows go
 * with it through fk_removable_cascade_parent, and their
 * removable_grandchild rows through fk_removable_grandchild_cascade, and a
 * removable_null row loses its reference through fk_removable_null_parent
 * (SET NULL). The requests are the planner's, under a policy whose
 * `cascades` names those three keys with their actions; each case inserts
 * the rows it deletes as the fixture's owner and reads what is left.
 */

/**
 * The shared expectations, by case. `cascadeCase(name)` is each one's id.
 *
 * - `cascade`: a parent with two cascading rows is deleted, and both rows
 *   are gone; another parent's row stays.
 * - `clears`: a row that referred to the parent through SET NULL is still
 *   there, its reference NULL and its version column where it was -- the
 *   referential action writes the reference and nothing else, on both
 *   engines, so a person editing that row is not told it changed.
 * - `grandchild`: the cascading rows' own cascading rows go with them, two
 *   levels below the record.
 * - `reach-moved`: a key that cascades onto a table past the root,
 *   committed after the delete was decided: refused, nothing deleted, the
 *   rows it reaches and the rows the new key would have reached included.
 * - `reach-moved-waiting`: the same key added while the delete waits for
 *   its locks, and committed while it waits -- on PostgreSQL under READ
 *   COMMITTED and REPEATABLE READ: refused, nothing deleted.
 * - `action-changed`: an accepted key that cascades where it set NULL when
 *   the delete was decided: refused, nothing deleted.
 * - `clears-moved`: a key that follows a cleared reference ON UPDATE
 *   CASCADE, added after the delete was decided: refused, nothing deleted
 *   or cleared.
 * - `reach-privilege`: the account lost DELETE on a table the delete
 *   reaches after it was decided, in each way `REACH_PRIVILEGE_LOSSES`
 *   names: refused as the account's grants, nothing deleted. On PostgreSQL
 *   the lock is refused where the account kept no grant to write that
 *   table, and the statement's own check of DELETE refuses it where it
 *   kept one, which the lock is taken with; SQL Server's batch refuses
 *   both.
 * - `cascade-security`: row security on a table the cascade reaches hides
 *   its rows from the account, and the cascade deletes them anyway: neither
 *   engine asks the deleting account's row security, nor its privileges,
 *   of a referential action (measured, 0051 P5).
 * - `lost-answer`: the connection is cut after a cascading delete was
 *   sent and its row came back. Unknown on both engines; what is left is
 *   each engine's, named in each suite.
 */
export const CASCADE_PARITY = {
  cascade: 'deleted',
  clears: 'deleted',
  grandchild: 'deleted',
  'reach-moved': 'schema-changed',
  'reach-moved-waiting': 'schema-changed',
  'action-changed': 'schema-changed',
  'clears-moved': 'schema-changed',
  'reach-privilege': 'permission-denied',
  'cascade-security': 'deleted',
  'lost-answer': 'unknown-outcome',
} as const satisfies Readonly<Record<string, DeleteExpectation>>

export type CascadeCase = keyof typeof CASCADE_PARITY

/** What `name` answers on `engine`. */
export function cascadeAnswer(name: CascadeCase, engine: DatabaseKind): DeleteAnswer {
  const expected: DeleteExpectation = CASCADE_PARITY[name]
  return typeof expected === 'string' ? expected : expected[engine]
}

/** The keys a delete of a removable_parent row acts through, with their actions: what the cases' policy names in `cascades`. */
export const PARITY_CASCADES = [
  { table: { schema: 'parity', name: 'removable_cascade' }, foreignKey: 'fk_removable_cascade_parent', onDelete: 'cascade' },
  { table: { schema: 'parity', name: 'removable_grandchild' }, foreignKey: 'fk_removable_grandchild_cascade', onDelete: 'cascade' },
  { table: { schema: 'parity', name: 'removable_null' }, foreignKey: 'fk_removable_null_parent', onDelete: 'set-null' },
] as const

/**
 * The ways `reach-privilege` takes DELETE away from a deleting account, each
 * run on both engines: the table it is revoked on, and the grant to write
 * that table the account keeps -- none, or one that is not DELETE. The
 * keeps are the point: PostgreSQL takes a delete's ROW EXCLUSIVE lock with
 * any grant to write (0051 P5), INSERT or UPDATE included, as the fixture's
 * own writer holds INSERT on the deliveries and parcels its deletes reach.
 */
export const REACH_PRIVILEGE_LOSSES = [
  { table: 'removable_grandchild', keeps: null },
  { table: 'removable_grandchild', keeps: 'insert' },
  { table: 'removable_null', keeps: 'update' },
] as const satisfies ReadonlyArray<{ table: string; keeps: 'insert' | 'update' | null }>
