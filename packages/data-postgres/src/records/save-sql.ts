import type { ObjectRef, RecordColumn, RecordTarget, RecordValue, RowFilterTerm, ThroughTerms, TouchRequest } from '@formancy/data-core'
import { op } from '../sql/catalog.js'
import { quoteIdentifier, quoteTable } from '../sql/identifiers.js'
import { Statement } from '../sql/statement.js'
import type { Definition } from './definition.js'
import { column, guard, located, outputs, ROW, selectFrom, versionIs } from './sql.js'
import type { RecordStatement, WritePath } from './sql.js'

/*
 * The statements a save of a record with its rows adds on PostgreSQL
 * (0155), beside the ones each of its steps shares with a write alone
 * (sql.ts, delete.ts): the transaction's timeouts, the touch, `within`, a
 * child's count and the record read back by its key. Every value is bound
 * but the timeouts, which SET takes no parameter for.
 */

/**
 * The transaction's lock and statement timeouts, each the save's deadline
 * (0155): no lock is waited for, and no statement runs, longer than it --
 * 55P03 and 57014, both `unavailable`, rolled back. Spliced, because SET
 * takes no bind parameter, from a whole number of milliseconds the caller
 * has checked; anything else is thrown. SET LOCAL takes no snapshot, so
 * under REPEATABLE READ the snapshot is still the record step's, after the
 * locked path's LOCK (save-facts.integration.test.ts), where
 * `select set_config(…)` would take it here, before the LOCK.
 */
export function timeoutStatements(ms: number): RecordStatement[] {
  if (!Number.isSafeInteger(ms) || ms < 1) throw new TypeError('A save deadline is a whole number of milliseconds above 0.')
  return [
    { text: `set local lock_timeout = ${String(ms)}`, params: [] },
    { text: `set local statement_timeout = ${String(ms)}`, params: [] },
  ]
}

/**
 * The touch of a record whose own fields a save leaves alone (0155): its
 * version column moved by one, under its key, the version its person read,
 * its update filters, every through and the definition's guard -- today's
 * update with nothing else to set. One row or none, `true` for the one.
 * PostgreSQL has no rowversion, so a touch here has no touch column.
 */
export function touchStatement(
  request: TouchRequest,
  terms: readonly RowFilterTerm[],
  through: readonly ThroughTerms[],
  definition: Definition,
  path: WritePath,
): RecordStatement {
  const statement = new Statement()
  const version = request.target.concurrency.column
  const where = [...located(statement, request.key, terms, through), versionIs(statement, request), ...guard(statement, request.target.table, definition, path)]
  const text = [
    `update ${quoteTable(request.target.table)} as ${ROW}`,
    `set ${quoteIdentifier(version)} = ${column(version)} ${op('+')} 1`,
    `where ${where.join(' and ')}`,
    'returning true',
  ].join('\n')
  return { text, params: statement.params }
}

/**
 * Whether the record is a row of its table that a child's lookup filter
 * for a create admits (`within`, 0155): taken once per child, before its
 * first create, inside the transaction that holds the record's row from
 * its own step on, so nothing moves the record out of the filter between
 * the check and the inserts. `key` is the record's, every column of it,
 * compared with the database's own equality as the foreign key compares
 * it; the filter's terms compare exactly, as every row filter does (0028).
 */
export function withinStatement(target: ObjectRef, key: readonly RecordValue[], terms: readonly RowFilterTerm[]): RecordStatement {
  const statement = new Statement()
  const found = selectFrom(target, [], located(statement, key, terms, []))
  return { text: `select (exists (${found}))::pg_catalog.text`, params: statement.params }
}

/**
 * How many rows of a child the record holds once the save's steps ran, as
 * the save counts them (0155): the rows its foreign key pins to the record,
 * under the child's read filters and throughs, at most `max + 1` of them, so
 * a large set is never counted whole. The limit is bound. The derived table
 * is named: PostgreSQL before 16 refuses a subquery in FROM without an alias,
 * and 15 is in the matrix (0067).
 */
export function countStatement(
  table: ObjectRef,
  pin: readonly RecordValue[],
  terms: readonly RowFilterTerm[],
  through: readonly ThroughTerms[],
  max: number,
): RecordStatement {
  const statement = new Statement()
  const where = located(statement, pin, terms, through)
  const limit = statement.as(String(max + 1), 'pg_catalog.int8')
  return { text: `select count(*)::pg_catalog.text\nfrom (${selectFrom(table, [], where)}\nlimit ${limit}) as "c"`, params: statement.params }
}

/**
 * The record as the save leaves it, read by its key alone after every step
 * (0155): read scope is never a condition of the commit, and the columns are
 * the readable ones its step would have returned, with its version last, so
 * a total or a version a row's trigger moved after the record's own step is
 * the one answered. Two rows are an identity that is not a key.
 */
export function readBackStatement(target: RecordTarget, key: readonly RecordValue[], columns: readonly RecordColumn[]): RecordStatement {
  const statement = new Statement()
  return { text: `${selectFrom(target.table, outputs(target, columns), located(statement, key, [], []))}\nlimit 2`, params: statement.params }
}
