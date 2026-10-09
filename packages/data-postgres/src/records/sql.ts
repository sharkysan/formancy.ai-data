import type { InsertRequest, ObjectRef, ReadRequest, RecordColumn, RecordTarget, RecordValue, RowFilterTerm, UpdateRequest } from '@formancy/data-core'
import { op } from '../sql/catalog.js'
import { filterSql } from '../sql/filters.js'
import { quoteIdentifier, quoteTable } from '../sql/identifiers.js'
import { Statement } from '../sql/statement.js'
import type { Param } from '../sql/statement.js'
import { sqlTypeOf } from '../sql/types.js'
import { bindText, canonicalText } from '../sql/values.js'

/** A statement ready to run: its text, and the parameters its placeholders name. */
export interface RecordStatement {
  text: string
  params: readonly Param[]
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
  if (target.concurrency !== null) list.push(`${column(target.concurrency.column)}::pg_catalog.text`)
  return list
}

/** The record named by its key, inside the trusted filters: the WHERE of every statement but an insert. */
function located(statement: Statement, key: readonly RecordValue[], terms: readonly RowFilterTerm[]): string[] {
  const where = key.map((value) => `${column(value.name)} ${op('=')} ${bound(statement, value)}`)
  return [...where, ...filterSql(statement, ROW, terms)]
}

/**
 * Whether the version column still holds the version the update expected.
 *
 * Compared as a numeric, so a version column of any integer type compares
 * exactly; the key and the filters drive the plan, so the cast costs nothing.
 * pg_catalog has no `=` between an integer and a numeric: the one named here
 * is numeric's own, the integer side cast implicitly, and only because it is
 * named in pg_catalog can no `=(bigint, numeric)` on the search path take its
 * place (`sql/catalog.ts`).
 */
function versionIs(statement: Statement, request: UpdateRequest): string {
  return `${column(request.target.concurrency.column)} ${op('=')} ${statement.as(request.expectedVersion, 'pg_catalog.numeric')}`
}

function selectFrom(table: ObjectRef, select: readonly string[], where: readonly string[]): string {
  // An empty select list is legal in PostgreSQL, and reads as a mistake.
  return [`select ${select.length > 0 ? select.join(', ') : 'true'}`, `from ${quoteTable(table)} as ${ROW}`, `where ${where.join(' and ')}`].join('\n')
}

/** One record's columns and version, if it exists inside the filters. */
export function readStatement(request: ReadRequest, terms: readonly RowFilterTerm[]): RecordStatement {
  const statement = new Statement()
  const where = located(statement, request.key, terms)
  return { text: selectFrom(request.target.table, outputs(request.target, request.columns), where), params: statement.params }
}

/**
 * Whether the record exists inside the filters and, when `withVersion`,
 * whether its version is still the expected one, as `true` or `false`: what
 * tells `not-found`, `stale` and a write the database declined apart after
 * an update changed nothing.
 */
export function existsStatement(request: UpdateRequest, terms: readonly RowFilterTerm[], withVersion: boolean): RecordStatement {
  const statement = new Statement()
  const where = located(statement, request.key, terms)
  const unchanged = withVersion ? `(${versionIs(statement, request)})::pg_catalog.text` : `'false'`
  return { text: selectFrom(request.target.table, [unchanged], where), params: statement.params }
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
 */
export function updateStatement(request: UpdateRequest, terms: readonly RowFilterTerm[]): RecordStatement {
  const statement = new Statement()
  const version = request.target.concurrency.column
  const set = request.set.map((value) => `${quoteIdentifier(value.name)} = ${bound(statement, value)}`)
  set.push(`${quoteIdentifier(version)} = ${column(version)} ${op('+')} 1`)
  const where = [...located(statement, request.key, terms), versionIs(statement, request)]
  const text = [
    `update ${quoteTable(request.target.table)} as ${ROW}`,
    `set ${set.join(', ')}`,
    `where ${where.join(' and ')}`,
    `returning ${outputs(request.target, request.returning).join(', ')}`,
  ].join('\n')
  return { text, params: statement.params }
}
