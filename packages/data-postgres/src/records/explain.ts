import type {
  ApiValue,
  DeleteRequest,
  DeleteTerms,
  ObjectRef,
  RecordColumn,
  RecordFailure,
  RecordRead,
  RecordTarget,
  RowFilterTerm,
  ThroughTerms,
  UpdateRequest,
} from '@formancy/data-core'
import type { Sql, TransactionSql } from 'postgres'
import { run } from '../sql/statement.js'
import type { TextResult, TextRow } from '../sql/statement.js'
import { decodeCanonical } from '../sql/values.js'
import { READ_COMMITTED } from './definition.js'
import type { Definition } from './definition.js'
import { whyNotDeletedStatement } from './delete.js'
import { connectionLost, recordFailure, sqlState } from './errors.js'
import type { Phase } from './errors.js'
import { definitionStatement, nothingChangedStatement } from './sql.js'
import type { RecordStatement, WritePath } from './sql.js'

/*
 * What a write on PostgreSQL is answered with once it changed nothing or
 * failed, shared by a single write (records.ts) and every step of a save
 * (save.ts, 0155): the one statement that tells a stale write from one aimed
 * at nothing, a moved definition from a refusal, and the path a definition
 * chooses. One copy, so a save's step and a write alone cannot answer one
 * outcome two ways.
 */

const NOT_FOUND: RecordFailure = { ok: false, code: 'not-found', message: 'No such record exists inside the filters.' }
const STALE: RecordFailure = { ok: false, code: 'stale', message: 'The record changed after it was read; its version is no longer the one sent.' }
const VERSION_ENDED: RecordFailure = {
  ok: false,
  code: 'version-ended',
  message: 'The version has ended, at the version sent: only the open version of a chain is changed (0113).',
}
/**
 * A write the server completed without writing the row, and without an
 * error: a BEFORE trigger that returned NULL, a rule that did something
 * else instead, or — for an update — a row security policy that lets the
 * actor see the row and not change it. `refused` (0028), as a trigger's
 * RAISE is (errors.ts): the database declined it by a rule of its own, no
 * constraint the form could have checked is named, and the same write will
 * be declined again. SQL Server's INSTEAD OF trigger is answered the same.
 */
export const DECLINED_INSERT: RecordFailure = {
  ok: false,
  code: 'refused',
  message: 'PostgreSQL completed the insert without writing the row: a trigger or a rule on the table declined it.',
}
const DECLINED_UPDATE: RecordFailure = {
  ok: false,
  code: 'refused',
  message:
    'PostgreSQL completed the update without writing the row, though it exists at the version sent: a trigger, a rule or a row security policy declined it.',
}

/**
 * The table moved under a write (0041). The record was not written; a
 * statement-level trigger on the table still fired, for the statement that
 * changed no row, and outside a transaction what it did is kept -- SQL
 * Server's batch rolls the same back.
 */
const DEFINITION_MOVED: RecordFailure = {
  ok: false,
  code: 'schema-changed',
  message: "The table's definition is not the one this write was decided over; nothing was written.",
}
/**
 * A delete the server completed without deleting the row, without an
 * error, though the row is there at the version sent: a BEFORE DELETE
 * trigger that returned NULL, or a row security policy for DELETE stricter
 * than the one for SELECT (measured, 0050 P4). `refused`, as a declined
 * update is. A rule that acts on delete is told apart before this
 * (`RULED`).
 */
const DECLINED_DELETE: RecordFailure = {
  ok: false,
  code: 'refused',
  message: 'PostgreSQL completed the delete without deleting the row, though it exists at the version sent: a trigger or a row security policy declined it.',
}
/**
 * A key that acts on delete now refers to the table, or to one below it,
 * and the delete was not decided over it (0050): nothing was deleted. Drift
 * review says which key.
 */
const REACH_MOVED: RecordFailure = {
  ok: false,
  code: 'schema-changed',
  message: 'A foreign key now acts on a delete from this table that this delete was not decided over; nothing was deleted.',
}
/**
 * The account may not DELETE from a table past the root the delete reaches
 * (0051): the statement's own check refused it under the lock, so nothing
 * was deleted. The lock itself is refused, 42501, to an account with no
 * grant to write the table at all.
 */
const REACH_UNDELETABLE: RecordFailure = {
  ok: false,
  code: 'permission-denied',
  message: 'This account may not DELETE from a table this delete reaches; nothing was deleted.',
}
/**
 * A rule acts on a delete from the table (0050): PostgreSQL refuses the
 * delete's statement under most rules itself, and the statement's guard
 * under the one it would run in the delete's place (delete.ts), so nothing
 * was deleted or done instead. `refused`: the same delete is refused again
 * until the rule is gone, as SQL Server's batch refuses an INSTEAD OF
 * trigger.
 */
const RULED: RecordFailure = {
  ok: false,
  code: 'refused',
  message: 'A rule on this table acts on a delete, and this module does not delete from such a table; nothing was deleted.',
}
/** The SQLSTATE of a scalar subquery that returned more than one row: in a delete, the statement's own refusal of a second row (delete.ts). */
export const CARDINALITY = '21000'

/** The read-committed path's write landed on a connection under another isolation: refused by its guard, so nothing was written. */
const ISOLATION_DIFFERS: RecordFailure = {
  ok: false,
  code: 'unavailable',
  message: "This connection's isolation is not the one the request was decided under; nothing was written.",
}

/** The outcome of one statement: its rows, or the failure the error translates to. */
export type Ran = { ok: true; result: TextResult } | { ok: false; failure: RecordFailure; state: string | undefined }

export async function attempt(sql: Sql | TransactionSql, statement: RecordStatement, phase: Phase): Promise<Ran> {
  try {
    return { ok: true, result: await run(sql, statement.text, statement.params) }
  } catch (error) {
    // Translated, or thrown again when it is a programming error.
    return { ok: false, failure: recordFailure(error, phase), state: sqlState(error) }
  }
}

/** A record from the row a statement returned, in the order `outputs` wrote its columns. */
export function recordOf(target: RecordTarget, columns: readonly RecordColumn[], row: TextRow): Omit<RecordRead, 'ok'> {
  const values: Record<string, ApiValue> = {}
  columns.forEach((entry, index) => {
    values[entry.name] = decodeCanonical(entry.type, row[index] ?? null)
  })
  return { values, version: target.concurrency === null ? null : (row[columns.length] ?? null) }
}

/**
 * The single row a statement addressed by key. Never more than one against a
 * real key; more is a binding whose identity is not one, and is thrown.
 */
export function onlyRow(result: TextResult): TextRow | undefined {
  if (result.rows.length > 1) throw new Error('The identity matched more than one row; it is not a key of this table.')
  return result.rows[0]
}

/**
 * A statement inside `sql.begin`, which never settles once the connection
 * fails under it. postgres.js 3.4.9 rejects `begin` itself when the
 * transaction's connection closes, and then goes on: a body that settles is
 * followed by its ROLLBACK or COMMIT, written to the closed connection, whose
 * socket is gone -- a TypeError thrown outside any promise, which ends the
 * process, and a connection left half-used that never answers the pool's next
 * query (measured, `records-lost-answer.integration.test.ts`; the same as the
 * probes before 0041 measured for a reserved connection). A body that never
 * settles sends neither, and `begin`'s own rejection is the answer. A refusal
 * from the server, on a connection still there, settles as it is, and the
 * transaction is rolled back as usual.
 *
 * A promise of its own each time, which nothing else holds, so the
 * abandoned body -- the statement, and the values in it -- is collected with
 * it. One promise shared by every lost step is held by the module, and kept
 * every lost transaction's values for the life of the process (measured, the
 * same suite: 64 MB after four lost writes of 16 MB each).
 */
export function untilLost<T>(statement: Promise<T>): Promise<T> {
  return statement.catch((error: unknown) => {
    if (connectionLost(error)) return new Promise<never>(() => {})
    throw error
  })
}

/**
 * Whether the table moved, after a write that wrote nothing or failed: the
 * answer when it did, otherwise `undefined` -- or, on the read-committed
 * path, the isolation, when this connection's is not that path's. One
 * statement, on any connection.
 */
export async function moved(sql: Sql, table: ObjectRef, definition: Definition, path: WritePath): Promise<RecordFailure | undefined> {
  const asked = await attempt(sql, definitionStatement(table, definition), 'read')
  // Unanswered, nothing tells; the write's own answer stands, and nothing was written either way.
  if (!asked.ok) return undefined
  const [same, isolation] = asked.result.rows[0] as TextRow
  if (same !== 'true') return DEFINITION_MOVED
  return path === 'read-committed' && isolation !== READ_COMMITTED ? ISOLATION_DIFFERS : undefined
}

/**
 * `stale`, `not-found` or declined, for an update that changed nothing -- or
 * that the table moved (0041), or that the connection's isolation refused:
 * one more statement, inside the same filters and throughs (0043), so a
 * record outside them is not-found here too, whatever its version, and its
 * existence is not disclosed. The update's
 * outcome is known by now — nothing was written — so this is a read.
 *
 * A record that is there with the version the update was sent with was not
 * changed by anybody else: versions only move forward, by one per write. The
 * database declined the update itself, and answering `stale` would send the
 * person back to reload a record that has not changed, to be told the same
 * thing again. `withVersion` is false where the version says nothing about
 * that: one that was never bound names no state the record was ever in, and
 * a serialization failure is a race whatever the version reads now.
 *
 * The isolation is this statement's connection's. In a pool whose
 * connections differ in it, that may not be the write's: the answer can then
 * name another cause than the one that refused, and nothing was written
 * either way.
 */
export async function whyNothingChanged(
  sql: Sql,
  request: Pick<UpdateRequest, 'target' | 'key' | 'expectedVersion' | 'open'>,
  scope: { terms: readonly RowFilterTerm[]; through: readonly ThroughTerms[] },
  withVersion: boolean,
  definition: Definition,
  path: WritePath,
): Promise<RecordFailure> {
  const asked = await attempt(sql, nothingChangedStatement(request, scope.terms, scope.through, withVersion, definition), 'read')
  if (!asked.ok) return asked.failure
  const [same, isolation, unchanged, open] = asked.result.rows[0] as TextRow
  if (same !== 'true') return DEFINITION_MOVED
  if (path === 'read-committed' && isolation !== READ_COMMITTED) return ISOLATION_DIFFERS
  if (unchanged === null || unchanged === undefined) return NOT_FOUND
  if (unchanged !== 'true') return STALE
  // At the version sent and ended: the person's read was of an ended version (0113).
  return open === 'false' ? VERSION_ENDED : DECLINED_UPDATE
}

/**
 * `stale`, `not-found`, declined, a definition or a reach that moved, a
 * table past the root the account may no longer DELETE from, a rule, or an
 * isolation that refused, for a delete that deleted nothing
 * (0050): one more
 * statement, inside the same filters and throughs, as for an update. A
 * record that is there at the version sent was not changed by anybody else
 * -- a version column on a table whose key the database numbers names one
 * state of one record for good (0050) -- so the database declined the
 * delete itself.
 */
export async function whyNotDeleted(
  sql: Sql,
  request: DeleteRequest,
  terms: DeleteTerms,
  withVersion: boolean,
  definition: Definition,
  path: WritePath,
): Promise<RecordFailure> {
  const asked = await attempt(sql, whyNotDeletedStatement(request, terms, withVersion, definition), 'read')
  if (!asked.ok) return asked.failure
  const [same, reach, deletable, rules, isolation, unchanged] = asked.result.rows[0] as TextRow
  if (same !== 'true') return DEFINITION_MOVED
  if (reach !== 'true') return REACH_MOVED
  if (deletable !== 'true') return REACH_UNDELETABLE
  if (rules !== 'true') return RULED
  if (path === 'read-committed' && isolation !== READ_COMMITTED) return ISOLATION_DIFFERS
  if (unchanged === null || unchanged === undefined) return NOT_FOUND
  return unchanged === 'true' ? DECLINED_DELETE : STALE
}

/** The path a definition's isolation chooses, before anything is sent, so a write is never sent twice (0015). */
export function pathOf(definition: Definition): WritePath {
  return definition.isolation === READ_COMMITTED ? 'read-committed' : 'locked'
}

/**
 * What a failed write is answered with (0041): the failure, unless the table
 * moved. A value the moved column refuses fails while the statement is
 * planned, before its guard runs -- a cast PostgreSQL folds, measured on 17:
 * ten characters into the narrowed varchar(8) was 22001, an overflow of the
 * narrowed numeric 22003 -- so the definition is asked after any refusal.
 * Not after `unavailable` or `unknown-outcome`, whose answer is that nothing
 * could be told.
 */
export async function failedWrite(sql: Sql, table: ObjectRef, definition: Definition, path: WritePath, failure: RecordFailure): Promise<RecordFailure> {
  if (failure.code === 'unavailable' || failure.code === 'unknown-outcome' || failure.code === 'schema-changed') return failure
  return (await moved(sql, table, definition, path)) ?? failure
}
