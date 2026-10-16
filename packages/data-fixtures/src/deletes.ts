import type { DatabaseKind, RecordFailureCode } from '@formancy/data-core'

/*
 * What a delete of one record does on both engines (0050), written once for
 * both adapters' `delete.integration.test.ts`.
 *
 * Each suite starts its own fixture, inserts the rows a case deletes as the
 * fixture's owner, and deletes them through its adapter, from requests
 * `planDelete` builds over bindings generated from what discovery reports
 * of the parity schema -- every table there has a key the database numbers
 * but `keyed`, so a version column proves a record (0050). The answer each
 * case expects is below: a delete's `deleted`, or the failure's code.
 * Where the engines differ, the difference is named per engine and written
 * down in each adapter.
 */

/** A delete's answer: the record deleted, a failure's code, or a request the adapter throws as a programming error. */
export type DeleteAnswer = 'deleted' | RecordFailureCode | 'thrown'

/** One answer for both engines, or one per engine where they differ. */
export type DeleteExpectation = DeleteAnswer | Readonly<Record<DatabaseKind, DeleteAnswer>>

/**
 * The shared expectations, by case. `deleteCase(name)` is each one's id.
 *
 * - `deleted`: a row of tenant 1, at the version read, is deleted, and gone.
 * - `stale`: the row was updated after it was read; the delete with the
 *   version read deletes nothing.
 * - `not-found`: a key no row has.
 * - `other-tenant`: tenant 2's row, deleted with tenant 1's filter and its
 *   true version, is not found, and stays.
 * - `through`: a child of tenant 2's parent, deleted through tenant 1's
 *   scope (0043), is not found and stays; a child of tenant 1's is deleted.
 * - `moved-parent`: a child whose parent another transaction moves to
 *   tenant 2 while the delete waits for the child's row. PostgreSQL reads
 *   the parent from the statement's snapshot and deletes the child, as it
 *   writes an update (0043); SQL Server answers not-found.
 * - `recreated`: a row deleted and a new one created since: the old
 *   token, at its version, is not found. A key the database numbers is
 *   never handed out again, so the new row is never the old one's.
 * - `referenced`: a row a NO ACTION key's row still refers to: the
 *   database keeps it.
 * - `restrict`: the same through PostgreSQL's ON DELETE RESTRICT -- 23503
 *   on 15 to 17, as NO ACTION is (measured, P3), and 23001 on 18
 *   (VERSION_FACTS.restrictViolation), the same answer either way -- and
 *   SQL Server's NO ACTION.
 * - `self-reference`: a row another row of its own table refers to: SQL
 *   Server's SAME TABLE REFERENCE, PostgreSQL's 23503.
 * - `declined`: a trigger declines the delete without an error -- a
 *   PostgreSQL BEFORE DELETE trigger that returns NULL, a SQL Server INSTEAD
 *   OF DELETE trigger -- and the row stays.
 * - `trigger-refuses`: a trigger raises an error, and the row stays.
 * - `restoring`: an AFTER DELETE trigger inserts the row again; the delete
 *   is reported done, and the row is there (0050).
 * - `after-trigger-elsewhere`: an AFTER DELETE trigger writes another
 *   table; the delete is reported done, and the trigger's row is there.
 * - `permission`: an account without DELETE on the table.
 * - `row-security`: an account row security lets read the row and not
 *   delete it: PostgreSQL's DELETE policy declines it (0 rows, found at the
 *   version sent), SQL Server's BEFORE DELETE block predicate refuses it
 *   (33504) -- 0016's existing difference, written down in each adapter.
 * - `definition-moved`: the table's definition moved after the delete was
 *   decided (0041).
 * - `reach-moved`: a key that cascades onto the table was added after the
 *   delete was decided, before it ran and while it waited for its lock; the
 *   delete is refused, and nothing is deleted, children included.
 * - `visibility-narrowed`: the account lost VIEW DEFINITION on the database
 *   after the delete was decided, and a key from a table it can no longer
 *   see cascades onto the root. SQL Server's guard refuses an account that
 *   cannot see every key; PostgreSQL's catalog hides no key, and its guard
 *   sees the key. Refused either way, nothing deleted.
 * - `not-a-key`: an identity two rows share, which only a hand-made request
 *   names: the delete is refused inside its statement and nothing is
 *   deleted, a programming error the adapter throws.
 */
export const DELETE_PARITY = {
  deleted: 'deleted',
  stale: 'stale',
  'not-found': 'not-found',
  'other-tenant': 'not-found',
  through: 'not-found',
  'moved-parent': { postgres: 'deleted', sqlserver: 'not-found' },
  recreated: 'not-found',
  referenced: 'foreign-key-violation',
  restrict: 'foreign-key-violation',
  'self-reference': 'foreign-key-violation',
  declined: 'refused',
  'trigger-refuses': 'refused',
  restoring: 'deleted',
  'after-trigger-elsewhere': 'deleted',
  permission: 'permission-denied',
  'row-security': { postgres: 'refused', sqlserver: 'permission-denied' },
  'definition-moved': 'schema-changed',
  'reach-moved': 'schema-changed',
  'visibility-narrowed': 'schema-changed',
  'not-a-key': 'thrown',
} as const satisfies Readonly<Record<string, DeleteExpectation>>

export type DeleteCase = keyof typeof DELETE_PARITY

/** What `name` answers on `engine`. */
export function deleteAnswer(name: DeleteCase, engine: DatabaseKind): DeleteAnswer {
  const expected: DeleteExpectation = DELETE_PARITY[name]
  return typeof expected === 'string' ? expected : expected[engine]
}

/**
 * An update a version column cannot tell from one aimed at another record
 * (0050): another session deletes `keyed`'s row and inserts its key again,
 * and an update with the version the first row had lands on the second --
 * a typed key, where the version restarts at its default. Why no delete is
 * offered on such a table; characterised, not refused.
 */
export const UPDATE_RECREATED = 'updated' as const
