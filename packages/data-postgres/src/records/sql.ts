import type { InsertRequest, ObjectRef, ReadRequest, RecordColumn, RecordTarget, RecordValue, RowFilterTerm, UpdateRequest } from '@formancy/data-core'
import { filterSql } from '../sql/filters.js'
import { quoteIdentifier, quoteTable } from '../sql/identifiers.js'
import { Statement } from '../sql/statement.js'
import { sqlTypeOf } from '../sql/types.js'
import { bindText, canonicalText } from '../sql/values.js'

/** A statement ready to run: its text, and the parameters its placeholders name. */
export interface RecordStatement {
  text: string
  params: readonly (string | null)[]
}

/** The alias of the target table in every record statement. */
const ROW = '"r"'

function column(name: string): string {
  return `${ROW}.${quoteIdentifier(name)}`
}

/** A value from canonical text, converted by the server to its column's type (`sql/statement.ts`). */
function bound(statement: Statement, value: RecordValue): string {
  return statement.as(bindText(value.value, value.type), sqlTypeOf(value.type))
}

/**
 * What a statement reads back: each column as its canonical text, then the
 * version column as text when the target has one. Positional, and
 * `decodeOutputs` reads it in the same order.
 */
function outputs(target: RecordTarget, columns: readonly RecordColumn[]): string[] {
  const list = columns.map((entry) => canonicalText(entry.type, column(entry.name)))
  if (target.concurrency !== null) list.push(`${column(target.concurrency.column)}::text`)
  return list
}

/** The record named by its key, inside the trusted filters: the WHERE of every statement but an insert. */
function located(statement: Statement, table: ObjectRef, key: readonly RecordValue[], terms: readonly RowFilterTerm[]): { from: string[]; where: string[] } {
  const where = key.map((value) => `${column(value.name)} = ${bound(statement, value)}`)
  const filters = filterSql(statement, table, ROW, terms)
  return { from: filters.from, where: [...where, ...filters.where] }
}

function selectFrom(table: ObjectRef, select: readonly string[], from: readonly string[], where: readonly string[]): string {
  // An empty select list is legal in PostgreSQL, and reads as a mistake.
  return [`select ${select.length > 0 ? select.join(', ') : 'true'}`, `from ${[`${quoteTable(table)} as ${ROW}`, ...from].join(', ')}`, `where ${where.join(' and ')}`].join('\n')
}

/** One record's columns and version, if it exists inside the filters. */
export function readStatement(request: ReadRequest, terms: readonly RowFilterTerm[]): RecordStatement {
  const statement = new Statement()
  const { from, where } = located(statement, request.target.table, request.key, terms)
  return { text: selectFrom(request.target.table, outputs(request.target, request.columns), from, where), params: statement.params }
}

/** Whether the record exists inside the filters: what tells `stale` from `not-found` after an update matched nothing. */
export function existsStatement(request: UpdateRequest, terms: readonly RowFilterTerm[]): RecordStatement {
  const statement = new Statement()
  const { from, where } = located(statement, request.target.table, request.key, terms)
  return { text: selectFrom(request.target.table, [], from, where), params: statement.params }
}

/**
 * An insert of exactly the given columns, so a column left out gets its
 * default and a generated one is never named, returning what was asked for
 * and the version the row starts at.
 */
export function insertStatement(request: InsertRequest): RecordStatement {
  const statement = new Statement()
  const table = `insert into ${quoteTable(request.target.table)} as ${ROW}`
  const body =
    request.values.length === 0
      ? 'default values'
      : `(${request.values.map((value) => quoteIdentifier(value.name)).join(', ')})\nvalues (${request.values.map((value) => bound(statement, value)).join(', ')})`
  const returning = outputs(request.target, request.returning)
  const text = [table, body, returning.length > 0 ? `returning ${returning.join(', ')}` : ''].filter((part) => part !== '').join('\n')
  return { text, params: statement.params }
}

/**
 * One guarded update (0015): the key, the trusted filters and the expected
 * version in one WHERE, and the version column moved by one in the same
 * statement, so nothing can change between the check and the write and
 * every writer through this module sees the change.
 *
 * The expected version is compared as a numeric, so a version column of any
 * integer type compares exactly; the key and the filters drive the plan, so
 * the cast costs nothing.
 */
export function updateStatement(request: UpdateRequest, terms: readonly RowFilterTerm[]): RecordStatement {
  const statement = new Statement()
  const version = request.target.concurrency.column
  const set = request.set.map((value) => `${quoteIdentifier(value.name)} = ${bound(statement, value)}`)
  set.push(`${quoteIdentifier(version)} = ${column(version)} + 1`)
  const { from, where } = located(statement, request.target.table, request.key, terms)
  where.push(`${column(version)} = ${statement.as(request.expectedVersion, 'numeric')}`)
  const text = [
    `update ${quoteTable(request.target.table)} as ${ROW}`,
    `set ${set.join(', ')}`,
    from.length > 0 ? `from ${from.join(', ')}` : '',
    `where ${where.join(' and ')}`,
    `returning ${outputs(request.target, request.returning).join(', ')}`,
  ]
    .filter((part) => part !== '')
    .join('\n')
  return { text, params: statement.params }
}
