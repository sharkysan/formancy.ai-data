import type { InsertRequest, ObjectRef, ReadRequest, RecordColumn, RecordConcurrency, RecordValue, RowFilterTerm, UpdateRequest } from '@formancy/data-core'
import mssql from 'mssql'
import { quoteName, quoteTable } from '../sql/quote.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { bindFilterValue, bindValue, canonicalText, EXACT_COLLATION } from '../sql/values.js'

/**
 * The SQL of each record operation. Every statement selects the same shape —
 * `[found]`, then `[c0]`, `[c1]`, … the canonical text of each requested
 * column, then `[version]` — so one function in records.ts reads all of them.
 *
 * The write batches raise two errors of their own. A user error number is
 * anybody's — a customer's trigger may THROW 51701 too — so errors.ts takes
 * one as the adapter's only when its message is exactly the adapter's.
 */

/** Raised when a text column did not store the text it was sent: a varchar whose code page lacks a character. */
export const TEXT_NOT_STORED = 51701
/** Its message: the index of the written value, in the request's order. */
export const TEXT_NOT_STORED_MESSAGE = /^formancy: text not stored as sent: ([0-9]+)$/
/** Raised when an update matched more than one row: an identity that is not a key. */
export const NOT_ONE_ROW = 51702
export const NOT_ONE_ROW_MESSAGE = 'formancy: the identity matched more than one row'

/** A version as it is compared: the 8 bytes of a rowversion, or a version column's decimal string. */
export type ExpectedVersion = { kind: 'rowversion'; bytes: Buffer } | { kind: 'version-column'; value: string }

/** One column of what a statement returns: its name in the result, its type in a table variable, and the SQL that computes it. */
interface Selected {
  name: string
  declared: string
  expression: string
}

/**
 * What every statement returns, from `source` — '' for a table, `inserted.`
 * for an OUTPUT clause. `[found]` is always there, so a request for no
 * columns is still a statement. A rowversion comes back as its 8 bytes, which
 * `encodeRowversion` spells, so the adapter and the core cannot spell a token
 * two ways; a version column as its decimal text.
 */
function selection(columns: readonly RecordColumn[], concurrency: RecordConcurrency | null, source: string): Selected[] {
  const selected: Selected[] = [{ name: '[found]', declared: 'int', expression: '1' }]
  columns.forEach((column, index) => {
    selected.push({ name: `[c${String(index)}]`, declared: 'nvarchar(max)', expression: canonicalText(column.type, `${source}${quoteName(column.name)}`) })
  })
  if (concurrency !== null) {
    const column = `${source}${quoteName(concurrency.column)}`
    selected.push(
      concurrency.kind === 'rowversion'
        ? { name: '[version]', declared: 'binary(8)', expression: column }
        : { name: '[version]', declared: 'nvarchar(20)', expression: `convert(nvarchar(20), ${column})` },
    )
  }
  return selected
}

function keyPredicates(parameters: Parameters, key: readonly RecordValue[]): string[] {
  return key.map((value) => `${quoteName(value.name)} = ${bindValue(parameters, value.type, value.value)}`)
}

function filterPredicates(parameters: Parameters, terms: readonly RowFilterTerm[]): string[] {
  return terms.map((term) => `${quoteName(term.column)} = ${bindFilterValue(parameters, term.value)}`)
}

/** One record under the filters. `top (2)`, so an identity that matched more than one row is noticed without reading every row it matched. */
export function readStatement(request: ReadRequest, terms: readonly RowFilterTerm[]): Statement {
  const parameters = new Parameters()
  const where = [...keyPredicates(parameters, request.key), ...filterPredicates(parameters, terms)]
  const select = selection(request.columns, request.target.concurrency, '').map((column) => `${column.expression} as ${column.name}`)
  return parameters.statement(`select top (2) ${select.join(', ')} from ${quoteTable(request.target.table)} where ${where.join(' and ')}`)
}

/** Whether a record is there for this actor: what tells a stale update from one aimed at nothing. */
export function existsStatement(table: ObjectRef, key: readonly RecordValue[], terms: readonly RowFilterTerm[]): Statement {
  const parameters = new Parameters()
  const where = [...keyPredicates(parameters, key), ...filterPredicates(parameters, terms)]
  return parameters.statement(`select count(*) as [found] from ${quoteTable(table)} where ${where.join(' and ')}`)
}

/** A value a write assigns — an insert's VALUES or an update's SET — and the SQL it was bound as. */
interface Assigned {
  value: RecordValue
  sql: string
}

/**
 * The batch every write runs in, so that what it stored is checked before it
 * commits:
 *
 * - `OUTPUT … INTO` a table variable, never a bare `OUTPUT`, which SQL Server
 *   refuses (334) on a table with an enabled trigger. The output is the row as
 *   the statement wrote it, before any AFTER trigger changed it.
 * - Every text value is compared with what its column stored, and a
 *   difference rolls the write back: SQL Server converts nvarchar to a
 *   single-byte varchar without an error, a character its code page lacks
 *   becoming its "best fit" or `?` (0017).
 * - `xact_abort`, so any error — a constraint, a THROW, a name that is gone —
 *   rolls the transaction back rather than leaving it open on a pooled
 *   connection. The setting does not stay on the pooled connection after the
 *   request, which the records suite checks for a batch with no parameters,
 *   the one that does not run inside `sp_executesql`.
 */
function writeBatch(write: (output: string) => string, assigned: readonly Assigned[], returned: Selected[], afterWrite: readonly string[]): string {
  const guarded = assigned.flatMap(({ value, sql }, index) => (value.type.kind === 'text' && value.value !== null ? [{ value, sql, index }] : []))
  const stored = guarded.map(({ value }, position) => ({
    name: `[w${String(position)}]`,
    declared: 'nvarchar(max)',
    expression: canonicalText(value.type, `inserted.${quoteName(value.name)}`),
  }))
  const captured = [...returned, ...stored]
  const output = `output ${captured.map((column) => column.expression).join(', ')} into @written (${captured.map((column) => column.name).join(', ')})`
  const checks = guarded.map(
    ({ sql, index }, position) =>
      `if exists (select 1 from @written where not ([w${String(position)}] = ${sql} collate ${EXACT_COLLATION})) ` +
      `throw ${String(TEXT_NOT_STORED)}, N'formancy: text not stored as sent: ${String(index)}', 1;`,
  )
  return [
    'set nocount on;',
    'set xact_abort on;',
    `declare @written table (${captured.map((column) => `${column.name} ${column.declared}`).join(', ')});`,
    'begin transaction;',
    `${write(output)};`,
    ...afterWrite,
    ...checks,
    'commit transaction;',
    `select ${returned.map((column) => column.name).join(', ')} from @written;`,
  ].join('\n')
}

/** Exactly the given columns, so a column with a default gets it and a generated one is never named. */
export function insertStatement(request: InsertRequest): Statement {
  const parameters = new Parameters()
  const assigned = request.values.map((value) => ({ value, sql: bindValue(parameters, value.type, value.value) }))
  const table = quoteTable(request.target.table)
  const columns = assigned.map(({ value }) => quoteName(value.name)).join(', ')
  const values = assigned.map(({ sql }) => sql).join(', ')
  const returned = selection(request.returning, request.target.concurrency, 'inserted.')
  const sql = writeBatch(
    (output) => (assigned.length === 0 ? `insert into ${table} ${output} default values` : `insert into ${table} (${columns}) ${output} values (${values})`),
    assigned,
    returned,
    [],
  )
  return parameters.statement(sql)
}

/**
 * ONE guarded statement (0015): the key, the trusted filters and the expected
 * version in a single WHERE, and for a version column the increment in the
 * same SET, so nothing can change between the check and the write. A row the
 * filters exclude is not matched, so another tenant's record cannot be changed
 * even with its current version in hand. More than one row matched means the
 * identity is not a key, and the batch rolls back rather than change several.
 */
export function updateStatement(request: UpdateRequest, terms: readonly RowFilterTerm[], expected: ExpectedVersion): Statement {
  const parameters = new Parameters()
  const { target } = request
  const assigned = request.set.map((value) => ({ value, sql: bindValue(parameters, value.type, value.value) }))
  const set = assigned.map(({ value, sql }) => `${quoteName(value.name)} = ${sql}`)
  const version = quoteName(target.concurrency.column)
  if (target.concurrency.kind === 'version-column') set.push(`${version} = ${version} + 1`)
  const where = [...keyPredicates(parameters, request.key), ...filterPredicates(parameters, terms)]
  where.push(
    expected.kind === 'rowversion'
      ? `${version} = ${parameters.add(mssql.VarBinary(8), expected.bytes)}`
      : `${version} = convert(bigint, ${parameters.add(mssql.NVarChar(mssql.MAX), expected.value)})`,
  )
  const returned = selection(request.returning, target.concurrency, 'inserted.')
  const sql = writeBatch(
    (output) => `update ${quoteTable(target.table)} set ${set.join(', ')} ${output} where ${where.join(' and ')}`,
    assigned,
    returned,
    [`if @@rowcount > 1 throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`],
  )
  return parameters.statement(sql)
}
