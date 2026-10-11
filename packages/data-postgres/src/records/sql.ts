import type { InsertRequest, ObjectRef, ReadRequest, RecordColumn, RecordTarget, RecordValue, RowFilterTerm, ThroughTerms, UpdateRequest } from '@formancy/data-core'
import { op } from '../sql/catalog.js'
import { filterSql } from '../sql/filters.js'
import { quoteIdentifier, quoteTable } from '../sql/identifiers.js'
import { Statement } from '../sql/statement.js'
import type { Param } from '../sql/statement.js'
import { sqlTypeOf } from '../sql/types.js'
import { bindText, canonicalText } from '../sql/values.js'
import { digestOf, ENCODING, factsOf, ISOLATION, READ_COMMITTED, spellingsOf } from './definition.js'
import type { Definition } from './definition.js'

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

/** The alias of a through's target inside its EXISTS. */
const PARENT = '"p"'

/**
 * One through (0043) as a condition on the record: its parent row, the one
 * the record's foreign-key columns reference, is one the target's filter
 * admits. An EXISTS in the statement itself, so the scope is in the WHERE
 * that locates the record, never in a read before it. The parent is read
 * from the statement's snapshot and never again: an update that waits for
 * the record's row and then writes it does not see a parent moved out of
 * the scope by a transaction that committed during the wait, and the write
 * lands as though it had come first -- under READ COMMITTED and REPEATABLE
 * READ alike -- where a row filter on the record itself is checked again on
 * the row the wait ends with, and SQL Server answers not-found (measured,
 * the through suites' `moved-parent` case; 0043). `for share of "p"` closes
 * it, measured the same way, and is not done: it needs UPDATE privilege on
 * the parent and locks the parent's row on every write of a child. The pair
 * compares with the database's own equality, as the foreign key does,
 * through pg_catalog's operator; every column is qualified, so a key onto
 * the same table compares the parent's key with the record's column and
 * never a row with itself. A record whose foreign key is NULL matches no
 * parent, and is outside.
 */
function throughSql(statement: Statement, through: ThroughTerms): string {
  const pairs = through.pairs.map((pair) => `${PARENT}.${quoteIdentifier(pair.references)} ${op('=')} ${column(pair.column)}`)
  return `exists (select from ${quoteTable(through.target)} as ${PARENT} where ${[...pairs, ...filterSql(statement, PARENT, through.terms)].join(' and ')})`
}

/**
 * The record named by its key, inside the trusted filters and every through:
 * the WHERE of every statement but an insert, and so of the read, the update
 * and the statement that tells a stale update from one aimed at nothing.
 */
function located(statement: Statement, key: readonly RecordValue[], terms: readonly RowFilterTerm[], through: readonly ThroughTerms[]): string[] {
  const where = key.map((value) => `${column(value.name)} ${op('=')} ${bound(statement, value)}`)
  return [...where, ...filterSql(statement, ROW, terms), ...through.map((entry) => throughSql(statement, entry))]
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

/**
 * How a guarded write is run (0041). `read-committed`: one statement, which
 * takes its snapshot after the table's lock, guarded by the digest and by the
 * connection's isolation being read committed. `locked`: in a transaction
 * that locks the table first, under whatever isolation the session has, so
 * the statement's snapshot follows the lock; guarded by the digest alone.
 */
export type WritePath = 'read-committed' | 'locked'

/**
 * The guard every write carries: the table's definition is the one the write
 * was decided over -- an uncorrelated subquery, so it runs once per
 * statement -- and, on the read-committed path, the connection's isolation
 * is that path's. Under another isolation the statement's snapshot is taken
 * when it is parsed, before it waits for the table's lock, and the guard
 * would read the catalog from before an ALTER the statement is then analysed
 * after: measured (the probes before 0041), an insert stored 1234.57 that way.
 */
function guard(statement: Statement, table: ObjectRef, definition: Definition, path: WritePath): string[] {
  const moved = `${digestOf(factsOf(statement, table))} ${op('=')} ${statement.text(definition.digest)}`
  return path === 'read-committed' ? [moved, `${ISOLATION} ${op('=')} '${READ_COMMITTED}'`] : [moved]
}

/**
 * The description of `table`, as one row: its facts, their digest, their
 * spellings, the encoding and the isolation, in this order.
 *
 * The facts are named twice, once as themselves and once inside their
 * digest. `offset 0` keeps the derived table that computes them from being
 * pulled up into the statement, where each name would be its own copy of
 * the catalog walk: measured on 17 (2026-10-10), eleven scans of
 * pg_attribute where the facts and the spellings make six, and twice the
 * planning and execution of every describe and read. The records-definition
 * suite counts them.
 */
function described(statement: Statement, table: ObjectRef): { select: string; from: string } {
  return {
    select: ['"g"."facts"', digestOf('"g"."facts"'), '"g"."spellings"', ENCODING, ISOLATION].join(', '),
    from: `(select ${factsOf(statement, table)} as "facts", ${spellingsOf(statement, table)} as "spellings" offset 0) as "g"`,
  }
}

/** How many columns of a row `described` takes, before what the statement adds. */
export const DESCRIBED_COLUMNS = 5

/** The table's description, in one statement: always one row. */
export function describeStatement(table: ObjectRef): RecordStatement {
  const statement = new Statement()
  const { select, from } = described(statement, table)
  return { text: `select ${select}\nfrom ${from}`, params: statement.params }
}

/**
 * One record's columns and version, if it exists inside the filters, with
 * the table as this same statement found it: the description, then `true`
 * when the record is there, then its columns and version. One row with no
 * record when none is inside the filters; two when the identity is not a key.
 */
export function readStatement(request: ReadRequest, terms: readonly RowFilterTerm[], through: readonly ThroughTerms[]): RecordStatement {
  const statement = new Statement()
  const { select, from } = described(statement, request.target.table)
  const where = located(statement, request.key, terms, through)
  const record = selectFrom(request.target.table, ['true', ...outputs(request.target, request.columns)], where)
  return { text: `select ${select}, "record".*\nfrom ${from}\nleft join lateral (${record}) as "record" on true`, params: statement.params }
}

/**
 * Why an update changed nothing, in one statement, on any connection: whether
 * the table's definition is still the one it was decided over, the isolation
 * this connection runs under, and whether the record exists inside the
 * filters and, when `withVersion`, still has the expected version -- `true`,
 * `false`, or NULL for no such record. The digest depends on no session
 * (definition.ts), so any connection answers it as the write's would.
 */
export function nothingChangedStatement(request: UpdateRequest, terms: readonly RowFilterTerm[], through: readonly ThroughTerms[], withVersion: boolean, definition: Definition): RecordStatement {
  const statement = new Statement()
  const same = `(${digestOf(factsOf(statement, request.target.table))} ${op('=')} ${statement.text(definition.digest)})::pg_catalog.text`
  const where = located(statement, request.key, terms, through)
  const unchanged = withVersion ? `(${versionIs(statement, request)})::pg_catalog.text` : `'false'`
  const found = `${selectFrom(request.target.table, [`${unchanged} as "unchanged"`], where)}\nlimit 1`
  return { text: `select ${same}, ${ISOLATION}, "found"."unchanged"\nfrom (select) as "g"\nleft join lateral (${found}) as "found" on true`, params: statement.params }
}

/** Whether the table's definition is still `definition`, and this connection's isolation: after a write that wrote nothing or failed. */
export function definitionStatement(table: ObjectRef, definition: Definition): RecordStatement {
  const statement = new Statement()
  const same = `(${digestOf(factsOf(statement, table))} ${op('=')} ${statement.text(definition.digest)})::pg_catalog.text`
  return { text: `select ${same}, ${ISOLATION}`, params: statement.params }
}

/**
 * An insert of exactly the given columns, so a column left out gets its
 * default and a generated one is never named, returning what was asked for
 * and the version the row starts at -- and only while the table's definition
 * is `definition` (0041): `insert … select … where`, which inserts nothing
 * when the guard is false. With no columns it is `select where`, which
 * inserts one row of defaults as `default values` does (measured on
 * PostgreSQL 17, the probes before 0041).
 */
export function insertStatement(request: InsertRequest, definition: Definition, path: WritePath): RecordStatement {
  const statement = new Statement()
  const table = `insert into ${quoteTable(request.target.table)} as ${ROW}`
  const columns = request.values.length === 0 ? '' : ` (${request.values.map((value) => quoteIdentifier(value.name)).join(', ')})`
  const values = request.values.map((value) => bound(statement, value)).join(', ')
  const body = `select ${values}\nwhere ${guard(statement, request.target.table, definition, path).join(' and ')}`
  const returning = outputs(request.target, request.returning)
  const text = [`${table}${columns}`, body, returning.length > 0 ? `returning ${returning.join(', ')}` : ''].filter((part) => part !== '').join('\n')
  return { text, params: statement.params }
}

/**
 * One guarded update (0015): the key, the trusted filters, every through
 * (0043) and the expected version in one WHERE, and the version column
 * moved by one in the same statement, so nothing can change between the
 * check and the write and every writer through this module sees the change.
 * The same WHERE holds the table to the definition the update was decided
 * over (0041).
 */
export function updateStatement(request: UpdateRequest, terms: readonly RowFilterTerm[], through: readonly ThroughTerms[], definition: Definition, path: WritePath): RecordStatement {
  const statement = new Statement()
  const version = request.target.concurrency.column
  const set = request.set.map((value) => `${quoteIdentifier(value.name)} = ${bound(statement, value)}`)
  set.push(`${quoteIdentifier(version)} = ${column(version)} ${op('+')} 1`)
  const where = [...located(statement, request.key, terms, through), versionIs(statement, request), ...guard(statement, request.target.table, definition, path)]
  const text = [
    `update ${quoteTable(request.target.table)} as ${ROW}`,
    `set ${set.join(', ')}`,
    `where ${where.join(' and ')}`,
    `returning ${outputs(request.target, request.returning).join(', ')}`,
  ].join('\n')
  return { text, params: statement.params }
}

/** The lock the locked path takes first: the one the write would take, or a read's. */
export function lockStatement(table: ObjectRef, mode: 'access share' | 'row exclusive'): RecordStatement {
  return { text: `lock table only ${quoteTable(table)} in ${mode} mode`, params: [] }
}
