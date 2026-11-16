import { deleteTerms, listTerms, reachesPast, rowFilterTerms, throughTerms } from '@formancy/data-core'
import type { DeleteOutcome, DescribedRead, InsertRequest, ListOutcome, ListRequest, RecordAdapter, RecordFailure, RecordOutcome } from '@formancy/data-core'
import type { Sql } from 'postgres'
import { run } from '../sql/statement.js'
import type { TextResult, TextRow } from '../sql/statement.js'
import { describedFrom, parseDefinition, READ_COMMITTED } from './definition.js'
import { deleteStatement } from './delete.js'
import { recordFailure, sqlState } from './errors.js'
import { attempt, CARDINALITY, DECLINED_INSERT, failedWrite, moved, onlyRow, pathOf, recordOf, untilLost, whyNotDeleted, whyNothingChanged } from './explain.js'
import type { Ran } from './explain.js'
import { listStatement } from './list.js'
import { checkInsert, checkKey, checkSupersede, checkUpdate, isVersion } from './requests.js'
import { savePostgres } from './save.js'
import { DESCRIBED_COLUMNS, describeStatement, insertStatement, lockStatement, reachLockStatement, readStatement, updateStatement } from './sql.js'
import type { RecordStatement, WritePath } from './sql.js'
import { freshStatement, supersedeStatement } from './versions.js'

const CHAIN_EXISTS: RecordFailure = {
  ok: false,
  code: 'chain-exists',
  message: 'The chain this create would start has a version already: its open version is changed from a date instead (0113).',
}
/**
 * A change from a date whose own check undid it (0113): it ended a version
 * and inserted none -- a trigger or a rule declined the next one -- or the
 * key matched more than one row. Nothing was written either way.
 */
const DECLINED_CHANGE: RecordFailure = {
  ok: false,
  code: 'refused',
  message:
    'PostgreSQL undid the change from a date: the next version was declined by a trigger or a rule, or the key matched more than one row. Nothing was written.',
}

/** A table the catalog does not show as discovery describes one: gone, out of sight, a foreign table, a partition. Which, drift review says (0010). */
const NOT_DESCRIBED: RecordFailure = { ok: false, code: 'schema-changed', message: 'The catalog does not show this table as discovery describes one.' }
/** The description a row of `describeStatement` or `readStatement` begins with, and the isolation it was read under. */
function describedBy(row: TextRow): { described: ReturnType<typeof describedFrom>; isolation: string } {
  const [facts, digest, spellings, encoding, isolation] = row as [string | null, string | null, string | null, string, string]
  return { described: facts === null ? undefined : describedFrom(facts, spellings, encoding, { digest: digest as string, isolation }), isolation }
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
async function lockedTransaction(
  sql: Sql,
  lock: RecordStatement,
  statement: RecordStatement,
): Promise<{ ok: true; result: TextResult } | { ok: false; error: unknown; sent: boolean }> {
  let sent = false
  try {
    const result = await sql.begin(async (tx) => {
      await untilLost(run(tx, lock.text, lock.params))
      sent = true
      return untilLost(run(tx, statement.text, statement.params))
    })
    return { ok: true, result }
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
  const rows = ran.result.rows
    .filter((row) => row[DESCRIBED_COLUMNS + 1] !== null)
    .map((row) => recordOf(request.target, request.columns, row.slice(DESCRIBED_COLUMNS + 2)))
  return { answer: { ok: true, described, rows, after }, isolation }
}

/**
 * `chain-exists` for a create of a chain's first version that inserted
 * nothing where its chain now has a version (0113), or `undefined`: another
 * cause, or a create that starts no chain. Asked after the write, as a read.
 */
async function chainThere(sql: Sql, request: InsertRequest): Promise<RecordFailure | undefined> {
  if (request.fresh === undefined) return undefined
  const asked = await attempt(sql, freshStatement(request), 'read')
  return asked.ok && (asked.result.rows[0] as TextRow)[0] === 'false' ? CHAIN_EXISTS : undefined
}

/** One guarded write on its path: its rows, or what it failed with. `lock` is what the locked path takes first. */
async function sendWrite(sql: Sql, lock: RecordStatement, path: WritePath, statement: RecordStatement): Promise<Ran> {
  if (path === 'read-committed') return attempt(sql, statement, 'write')
  const done = await lockedTransaction(sql, lock, statement)
  if (done.ok) return { ok: true, result: done.result }
  return { ok: false, failure: recordFailure(done.error, done.sent ? 'write' : 'read'), state: sqlState(done.error) }
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
      if (ran.result.count !== 1) return (await moved(sql, table, definition, path)) ?? (await chainThere(sql, request)) ?? DECLINED_INSERT
      return { ok: true, ...recordOf(request.target, request.returning, ran.result.rows[0] ?? []) }
    },

    async supersede(request): Promise<RecordOutcome> {
      const terms = rowFilterTerms(request.filters)
      const scope = { terms, through: throughTerms(request.through) }
      checkSupersede(request)
      const definition = parseDefinition(request.definition)
      const path = pathOf(definition)
      const table = request.target.table
      const located = { target: request.target, key: request.key, expectedVersion: request.expectedVersion, open: request.ends }
      if (!isVersion(request.expectedVersion)) return whyNothingChanged(sql, located, scope, false, definition, path)
      const ran = await sendWrite(sql, lockStatement(table, 'row exclusive'), path, supersedeStatement(request, terms, scope.through, definition, path))
      if (!ran.ok) {
        if (ran.state === CARDINALITY) return DECLINED_CHANGE
        return ran.state === '40001' ? whyNothingChanged(sql, located, scope, false, definition, path) : failedWrite(sql, table, definition, path, ran.failure)
      }
      // Always one row: `one` NULL where nothing was ended, the next version beside it otherwise.
      const row = onlyRow(ran.result) as TextRow
      return row[0] === null
        ? whyNothingChanged(sql, located, scope, true, definition, path)
        : { ok: true, ...recordOf(request.target, request.returning, row.slice(1)) }
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
      if (!ran.ok)
        return ran.state === '40001' ? whyNothingChanged(sql, request, scope, false, definition, path) : failedWrite(sql, table, definition, path, ran.failure)
      const row = onlyRow(ran.result)
      return row === undefined
        ? whyNothingChanged(sql, request, scope, true, definition, path)
        : { ok: true, ...recordOf(request.target, request.returning, row) }
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
        if (ran.state === CARDINALITY)
          throw new Error(
            'The identity matched more than one row, so the delete was refused inside its statement and nothing was deleted: the bindings do not name a key.',
          )
        return ran.state === '40001' ? whyNotDeleted(sql, request, terms, false, definition, path) : failedWrite(sql, terms.root, definition, path, ran.failure)
      }
      const row = ran.result.rows[0]
      if (row === undefined) return whyNotDeleted(sql, request, terms, true, definition, path)
      const removed = recordOf(request.target, request.target.identity, row)
      return { ok: true, deleted: { values: removed.values, version: removed.version as string } }
    },

    // A record and its rows in one transaction (0155): save.ts.
    save: (request) => savePostgres(sql, request),
  }
}
