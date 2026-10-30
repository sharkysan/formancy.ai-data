import { deleteTerms, listTerms, reachesPast, rowFilterTerms, throughTerms } from '@formancy/data-core'
import type {
  ApiValue,
  DeleteOutcome,
  DeleteRequest,
  DeleteTerms,
  DescribedRead,
  ListOutcome,
  ListRequest,
  ObjectRef,
  RecordAdapter,
  RecordColumn,
  RecordFailure,
  RecordOutcome,
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
import { describedFrom, parseDefinition, READ_COMMITTED } from './definition.js'
import type { Definition } from './definition.js'
import { deleteStatement, whyNotDeletedStatement } from './delete.js'
import { connectionLost, recordFailure, sqlState } from './errors.js'
import type { Phase } from './errors.js'
import { listStatement } from './list.js'
import { checkInsert, checkKey, checkUpdate, isVersion } from './requests.js'
import {
  definitionStatement,
  DESCRIBED_COLUMNS,
  describeStatement,
  insertStatement,
  lockStatement,
  nothingChangedStatement,
  reachLockStatement,
  readStatement,
  updateStatement,
} from './sql.js'
import type { RecordStatement, WritePath } from './sql.js'

const NOT_FOUND: RecordFailure = { ok: false, code: 'not-found', message: 'No such record exists inside the filters.' }
const STALE: RecordFailure = { ok: false, code: 'stale', message: 'The record changed after it was read; its version is no longer the one sent.' }

/**
 * A write the server completed without writing the row, and without an
 * error: a BEFORE trigger that returned NULL, a rule that did something
 * else instead, or — for an update — a row security policy that lets the
 * actor see the row and not change it. `refused` (0028), as a trigger's
 * RAISE is (errors.ts): the database declined it by a rule of its own, no
 * constraint the form could have checked is named, and the same write will
 * be declined again. SQL Server's INSTEAD OF trigger is answered the same.
 */
const DECLINED_INSERT: RecordFailure = {
  ok: false,
  code: 'refused',
  message: 'PostgreSQL completed the insert without writing the row: a trigger or a rule on the table declined it.',
}
const DECLINED_UPDATE: RecordFailure = {
  ok: false,
  code: 'refused',
  message: 'PostgreSQL completed the update without writing the row, though it exists at the version sent: a trigger, a rule or a row security policy declined it.',
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
const CARDINALITY = '21000'

/** A table the catalog does not show as discovery describes one: gone, out of sight, a foreign table, a partition. Which, drift review says (0010). */
const NOT_DESCRIBED: RecordFailure = { ok: false, code: 'schema-changed', message: 'The catalog does not show this table as discovery describes one.' }
/** The read-committed path's write landed on a connection under another isolation: refused by its guard, so nothing was written. */
const ISOLATION_DIFFERS: RecordFailure = {
  ok: false,
  code: 'unavailable',
  message: "This connection's isolation is not the one the request was decided under; nothing was written.",
}

/** The outcome of one statement: its rows, or the failure the error translates to. */
type Ran = { ok: true; result: TextResult } | { ok: false; failure: RecordFailure; state: string | undefined }

async function attempt(sql: Sql | TransactionSql, statement: RecordStatement, phase: Phase): Promise<Ran> {
  try {
    return { ok: true, result: await run(sql, statement.text, statement.params) }
  } catch (error) {
    // Translated, or thrown again when it is a programming error.
    return { ok: false, failure: recordFailure(error, phase), state: sqlState(error) }
  }
}

/** A record from the row a statement returned, in the order `outputs` wrote its columns. */
function recordOf(target: RecordTarget, columns: readonly RecordColumn[], row: TextRow): Omit<RecordRead, 'ok'> {
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
function onlyRow(result: TextResult): TextRow | undefined {
  if (result.rows.length > 1) throw new Error('The identity matched more than one row; it is not a key of this table.')
  return result.rows[0]
}

/** The description a row of `describeStatement` or `readStatement` begins with, and the isolation it was read under. */
function describedBy(row: TextRow): { described: ReturnType<typeof describedFrom>; isolation: string } {
  const [facts, digest, spellings, encoding, isolation] = row as [string | null, string | null, string | null, string, string]
  return { described: facts === null ? undefined : describedFrom(facts, spellings, encoding, { digest: digest as string, isolation }), isolation }
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
function untilLost<T>(statement: Promise<T>): Promise<T> {
  return statement.catch((error: unknown) => (connectionLost(error) ? new Promise<never>(() => {}) : Promise.reject(error)))
}

/**
 * Runs `statement` in a transaction that first takes `lock`, which takes no
 * snapshot, so the statement takes its snapshot after the lock under any
 * isolation (0041). In `sql.begin`, never on a reserved
 * connection, whose statements never answer once its backend is gone; every
 * step through `untilLost`, and nothing translated inside the transaction, so
 * that a failure is either the server's, rolled back, or the connection's,
 * after which postgres.js sends nothing more. `sent` says whether the
 * statement had been sent when it failed, which decides between
 * `unavailable` and `unknown-outcome`.
 */
async function lockedTransaction(sql: Sql, lock: RecordStatement, statement: RecordStatement): Promise<{ ok: true; result: TextResult } | { ok: false; error: unknown; sent: boolean }> {
  let sent = false
  try {
    const result = await sql.begin(async (tx) => {
      await untilLost(run(tx, lock.text, lock.params))
      sent = true
      return untilLost(run(tx, statement.text, statement.params))
    })
    return { ok: true, result: result as TextResult }
  } catch (error) {
    return { ok: false, error, sent }
  }
}

/** A read's answer from its statement's rows: the record, if any, with the description of the table the same statement found, and the isolation it ran under. */
function readAnswer(request: Parameters<RecordAdapter['read']>[0], ran: Ran): { answer: DescribedRead; isolation?: string } {
  if (!ran.ok) return { answer: ran.failure }
  // Always a row: the description's, with the record beside it or not.
  const row = onlyRow(ran.result) as TextRow
  const { described, isolation } = describedBy(row)
  if (described === undefined) return { answer: NOT_DESCRIBED, isolation }
  const found = row[DESCRIBED_COLUMNS] !== null
  return { answer: { ok: true, described, record: found ? recordOf(request.target, request.columns, row.slice(DESCRIBED_COLUMNS + 1)) : null }, isolation }
}

/**
 * A list's answer from its statement's rows (0044): the page's records in
 * the statement's order, with the description the first row carries and the
 * isolation it was read under, and whether the row the page continues after
 * was found (0108), which every row says. One row with no record when the
 * page is empty.
 */
function listAnswer(request: ListRequest, ran: Ran): { answer: ListOutcome; isolation?: string } {
  if (!ran.ok) return { answer: ran.failure }
  // Always a row: the description's, with the page's first record beside it or none.
  const first = ran.result.rows[0] as TextRow
  const { described, isolation } = describedBy(first)
  if (described === undefined) return { answer: NOT_DESCRIBED, isolation }
  const after = request.after === null ? null : first[DESCRIBED_COLUMNS] === 'true' ? 'found' : 'gone'
  const rows = ran.result.rows.filter((row) => row[DESCRIBED_COLUMNS + 1] !== null).map((row) => recordOf(request.target, request.columns, row.slice(DESCRIBED_COLUMNS + 2)))
  return { answer: { ok: true, described, rows, after }, isolation }
}

/**
 * Whether the table moved, after a write that wrote nothing or failed: the
 * answer when it did, otherwise `undefined` -- or, on the read-committed
 * path, the isolation, when this connection's is not that path's. One
 * statement, on any connection.
 */
async function moved(sql: Sql, table: ObjectRef, definition: Definition, path: WritePath): Promise<RecordFailure | undefined> {
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
async function whyNothingChanged(
  sql: Sql,
  request: UpdateRequest,
  scope: { terms: readonly RowFilterTerm[]; through: readonly ThroughTerms[] },
  withVersion: boolean,
  definition: Definition,
  path: WritePath,
): Promise<RecordFailure> {
  const asked = await attempt(sql, nothingChangedStatement(request, scope.terms, scope.through, withVersion, definition), 'read')
  if (!asked.ok) return asked.failure
  const [same, isolation, unchanged] = asked.result.rows[0] as TextRow
  if (same !== 'true') return DEFINITION_MOVED
  if (path === 'read-committed' && isolation !== READ_COMMITTED) return ISOLATION_DIFFERS
  if (unchanged === null || unchanged === undefined) return NOT_FOUND
  return unchanged === 'true' ? DECLINED_UPDATE : STALE
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
async function whyNotDeleted(sql: Sql, request: DeleteRequest, terms: DeleteTerms, withVersion: boolean, definition: Definition, path: WritePath): Promise<RecordFailure> {
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
function pathOf(definition: Definition): WritePath {
  return definition.isolation === READ_COMMITTED ? 'read-committed' : 'locked'
}

/** One guarded write on its path: its rows, or what it failed with. `lock` is what the locked path takes first. */
async function sendWrite(sql: Sql, lock: RecordStatement, path: WritePath, statement: RecordStatement): Promise<Ran> {
  if (path === 'read-committed') return attempt(sql, statement, 'write')
  const done = await lockedTransaction(sql, lock, statement)
  if (done.ok) return { ok: true, result: done.result }
  return { ok: false, failure: recordFailure(done.error, done.sent ? 'write' : 'read'), state: sqlState(done.error) }
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
async function failedWrite(sql: Sql, table: ObjectRef, definition: Definition, path: WritePath, failure: RecordFailure): Promise<RecordFailure> {
  if (failure.code === 'unavailable' || failure.code === 'unknown-outcome' || failure.code === 'schema-changed') return failure
  return (await moved(sql, table, definition, path)) ?? failure
}

/**
 * The record half of the operations port on PostgreSQL (0015, 0016, 0041).
 *
 * Values are bound from canonical text and read back as canonical text made
 * by the server; identifiers are quoted one part at a time; the filters are
 * read with `rowFilterTerms` and applied in the same statement. A database
 * refusal is a `RecordFailure`; a malformed request or filters is thrown,
 * before anything is sent.
 *
 * Every read answers the table's definition from the statement that read the
 * record -- a list too, from the statement that read its page (0044) -- and
 * every write runs only while the table still has the definition it was
 * decided over. Under READ COMMITTED a statement takes its snapshot
 * after the table's lock, and the guard is in the statement. Under any other
 * isolation it does not, so a read that reports one is asked again and a
 * write decided over one is run in a transaction that locks the table first.
 */
export function createPostgresRecords(sql: Sql): RecordAdapter {
  return {
    async describe(table) {
      const ran = await attempt(sql, describeStatement(table), 'read')
      if (!ran.ok) return ran.failure
      const { described } = describedBy(ran.result.rows[0] as TextRow)
      return described === undefined ? NOT_DESCRIBED : { ok: true, described }
    },

    async read(request) {
      const terms = rowFilterTerms(request.filters)
      const through = throughTerms(request.through)
      checkKey(request.target, request.key)
      const statement = readStatement(request, terms, through)
      const first = readAnswer(request, await attempt(sql, statement, 'read'))
      if (first.isolation === undefined || first.isolation === READ_COMMITTED) return first.answer
      // Under another isolation the statement's snapshot is taken before it
      // waits for the table's lock: behind a rewriting ALTER it read the old
      // catalog and no row (measured). Its answer is set aside, and the read
      // asked again after the lock. A read may be asked again; a write never.
      const again = await lockedTransaction(sql, lockStatement(request.target.table, 'access share'), statement)
      return readAnswer(request, again.ok ? again : { ok: false, failure: recordFailure(again.error, 'read'), state: sqlState(again.error) }).answer
    },

    async list(request) {
      const terms = listTerms(request)
      const statement = listStatement(request, terms)
      const first = listAnswer(request, await attempt(sql, statement, 'read'))
      if (first.isolation === undefined || first.isolation === READ_COMMITTED) return first.answer
      // As a read (above): under another isolation the page is asked again after the table's lock.
      const again = await lockedTransaction(sql, lockStatement(request.target.table, 'access share'), statement)
      return listAnswer(request, again.ok ? again : { ok: false, failure: recordFailure(again.error, 'read'), state: sqlState(again.error) }).answer
    },

    async insert(request) {
      checkInsert(request)
      const definition = parseDefinition(request.definition)
      const path = pathOf(definition)
      const table = request.target.table
      const ran = await sendWrite(sql, lockStatement(table, 'row exclusive'), path, insertStatement(request, definition, path))
      if (!ran.ok) return failedWrite(sql, table, definition, path, ran.failure)
      // INSERT 0 0, and no error: the guard, a trigger or a rule. Without
      // RETURNING there is no row to read either way, so the command tag is
      // what says whether one was written.
      if (ran.result.count !== 1) return (await moved(sql, table, definition, path)) ?? DECLINED_INSERT
      return { ok: true, ...recordOf(request.target, request.returning, ran.result.rows[0] ?? []) }
    },

    async update(request): Promise<RecordOutcome> {
      const terms = rowFilterTerms(request.filters)
      const scope = { terms, through: throughTerms(request.through) }
      checkUpdate(request, terms)
      const definition = parseDefinition(request.definition)
      const path = pathOf(definition)
      const table = request.target.table
      // A version that is not a number names no state the record was ever
      // in. Bound, it would be an error; it is answered as any other
      // mismatch, without sending it.
      if (!isVersion(request.expectedVersion)) return whyNothingChanged(sql, request, scope, false, definition, path)

      const ran = await sendWrite(sql, lockStatement(table, 'row exclusive'), path, updateStatement(request, terms, scope.through, definition, path))
      // Under REPEATABLE READ, which a composition root may make the
      // default, PostgreSQL answers a lost race with 40001 instead of 0 rows
      // (0006). Nothing was written either way, so it is answered the same
      // way — as a race, whatever the version reads now: under SERIALIZABLE
      // a conflict over other rows is 40001 too, with this one unchanged.
      if (!ran.ok) return ran.state === '40001' ? whyNothingChanged(sql, request, scope, false, definition, path) : failedWrite(sql, table, definition, path, ran.failure)
      const row = onlyRow(ran.result)
      return row === undefined ? whyNothingChanged(sql, request, scope, true, definition, path) : { ok: true, ...recordOf(request.target, request.returning, row) }
    },

    async delete(request): Promise<DeleteOutcome> {
      const terms = deleteTerms(request)
      checkKey(request.target, terms.key)
      if (request.target.concurrency.kind !== 'version-column') throw new Error('PostgreSQL has no rowversion; a delete here is guarded by a version column.')
      const definition = parseDefinition(request.definition)
      // Past its root, a delete takes the locked path whatever the
      // isolation (0051): a cascade opens each table it reaches only after
      // the statement's snapshot, so every one is locked before it, and the
      // guard reads every key that could act on the delete.
      const past = reachesPast(terms.reach)
      const path = past ? 'locked' : pathOf(definition)
      // A version that is not a number names no state the record was ever
      // in, and is answered as any other mismatch without being sent.
      if (!isVersion(terms.expectedVersion)) return whyNotDeleted(sql, request, terms, false, definition, path)

      // The locked path locks every relation below the table too: under
      // REPEATABLE READ the statement's snapshot is taken before it locks
      // the partitions it plans, and a key added onto one while it waited
      // would act unseen by the guard (delete.ts).
      const lock = past ? reachLockStatement(terms.reach) : lockStatement(terms.root, 'row exclusive', 'below')
      const ran = await sendWrite(sql, lock, path, deleteStatement(request, terms, definition, path))
      if (!ran.ok) {
        // In a delete only: the statement's own refusal of a second row,
        // with nothing deleted -- an identity that is not a key, a
        // programming error (delete.ts). A trigger's own 21000 is reported
        // as the same, and nothing was deleted either.
        if (ran.state === CARDINALITY) throw new Error('The identity matched more than one row, so the delete was refused inside its statement and nothing was deleted: the bindings do not name a key.')
        return ran.state === '40001' ? whyNotDeleted(sql, request, terms, false, definition, path) : failedWrite(sql, terms.root, definition, path, ran.failure)
      }
      const row = ran.result.rows[0]
      if (row === undefined) return whyNotDeleted(sql, request, terms, true, definition, path)
      const removed = recordOf(request.target, request.target.identity, row)
      return { ok: true, deleted: { values: removed.values, version: removed.version as string } }
    },
  }
}
