import type { InsertRequest, ObjectRef, ReadRequest, RecordColumn, RecordConcurrency, RecordTarget, RecordValue, RowFilterTerm, UpdateRequest } from '@formancy/data-core'
import mssql from 'mssql'
import { quoteName, quoteTable } from '../sql/quote.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { exactText, filterPredicate } from '../sql/filters.js'
import { bindValue, canonicalText, fromText, isExactKey } from '../sql/values.js'
import type { ExactKey } from '../sql/values.js'

/**
 * The SQL of each record operation. Every statement selects the same shape —
 * `[found]`, then `[c0]`, `[c1]`, … the canonical text of each requested
 * column, then `[version]` — so one function in records.ts reads all of them.
 *
 * The write batches raise errors of their own, below. A user error number is
 * anybody's — a customer's trigger may THROW 51701 too — so errors.ts takes
 * one as the adapter's only when its message is exactly the adapter's.
 */

/** Raised when a text column did not store the text it was sent: a varchar whose code page lacks a character, or that drops trailing spaces. */
export const TEXT_NOT_STORED = 51701
/** Its message: the index of the written value, in the request's order. */
export const TEXT_NOT_STORED_MESSAGE = /^formancy: text not stored as sent: ([0-9]+)$/
/** Raised when an update matched more than one row: an identity that is not a key. */
export const NOT_ONE_ROW = 51702
export const NOT_ONE_ROW_MESSAGE = 'formancy: the identity matched more than one row'
/** Raised when an enabled INSTEAD OF trigger decides what the write stores, or the account cannot see whether one does. */
export const DECIDED_BY_TRIGGER = 51703
export const DECIDED_BY_TRIGGER_MESSAGE = 'formancy: an INSTEAD OF trigger decides what this write stores, or the account cannot see whether one does'
/** Raised when a trigger ended the write's transaction and began another. */
export const TRANSACTION_REPLACED = 51704
export const TRANSACTION_REPLACED_MESSAGE = 'formancy: a trigger ended the transaction of the write and began another'

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
  if (concurrency !== null) selected.push(versionOf(concurrency, source))
  return selected
}

function versionOf(concurrency: RecordConcurrency, source: string): Selected {
  const column = `${source}${quoteName(concurrency.column)}`
  return concurrency.kind === 'rowversion'
    ? { name: '[version]', declared: 'binary(8)', expression: column }
    : { name: '[version]', declared: 'nvarchar(20)', expression: `convert(nvarchar(20), ${column})` }
}

function keyPredicates(parameters: Parameters, key: readonly RecordValue[]): string[] {
  return key.map((value) => `${quoteName(value.name)} = ${bindValue(parameters, value.type, value.value)}`)
}

/** The trusted filters, each comparing the column's canonical value exactly (../sql/filters.ts, 0028). */
function filterPredicates(parameters: Parameters, terms: readonly RowFilterTerm[]): string[] {
  return terms.map((term) => filterPredicate(parameters, quoteName(term.column), term))
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

/** What reads a written row's version back: the key it captures, the variables it holds it in, and the statements. */
interface Refind {
  captured: Selected[]
  declared: string[]
  statements: string[]
}

/**
 * Reads the version back from the row itself, after the statement and its
 * AFTER triggers and before the commit. OUTPUT saw the row before a trigger
 * that touches it — an audit column, a version the application's own trigger
 * moves — changed its version again; a token taken from OUTPUT would be stale
 * before anyone held it, and refuse the next save.
 *
 * The row is found by its identity as the statement wrote it, a generated one
 * included, captured as canonical text and converted back as a bound key is,
 * so it is found exactly as a later save names it. The text goes through
 * variables rather than a join on the table variable, whose column would
 * bring the database's collation into the comparison and conflict with a key
 * column's own (468). A target with no identity, or with a key column of
 * another kind — a time or an instant, whose text is cut short, a boolean or
 * a float, which do not travel as text — keeps the version the statement saw.
 */
function versionAfterTriggers(target: RecordTarget): Refind {
  const keys = target.identity.map((column, index) => ({ column: quoteName(column.name), type: column.type, variable: `@i${String(index)}`, name: `[i${String(index)}]` }))
  const exact = (key: (typeof keys)[number]): key is (typeof keys)[number] & { type: ExactKey } => isExactKey(key.type)
  if (target.concurrency === null || keys.length === 0 || !keys.every(exact)) return { captured: [], declared: [], statements: [] }
  const where = keys.map((key) => `[stored].${key.column} = ${fromText(key.type, key.variable)}`)
  const version = versionOf(target.concurrency, '[stored].')
  return {
    captured: keys.map((key) => ({ name: key.name, declared: 'nvarchar(max)', expression: canonicalText(key.type, `inserted.${key.column}`) })),
    declared: [`declare ${keys.map((key) => `${key.variable} nvarchar(max)`).join(', ')};`],
    statements: [
      `select ${keys.map((key) => `${key.variable} = ${key.name}`).join(', ')} from @written;`,
      `update [written] set [version] = ${version.expression} from @written as [written] cross join ${quoteTable(target.table)} as [stored] where ${where.join(' and ')};`,
    ],
  }
}

/**
 * Whether an INSTEAD OF trigger decides what this write stores. Such a
 * trigger runs in place of the statement, and OUTPUT returns the row as if
 * the statement had run — the identity 0, the values before the trigger
 * changed them, a row for an update that changed nothing — so nothing the
 * batch reads says what the trigger stored, and the write is refused.
 *
 * Asked of the catalog after the statement, so a table that is not there has
 * already failed it as schema-changed (208). A table the account writes but
 * cannot see in the catalog — denied VIEW DEFINITION — is refused too, because
 * whether a trigger decides its writes cannot be told: fail closed. The
 * table's name is bound, as `object_id` reads it.
 */
function insteadOfGuard(parameters: Parameters, table: ObjectRef, operation: 'INSERT' | 'UPDATE'): string {
  const name = parameters.add(mssql.NVarChar(mssql.MAX), quoteTable(table))
  const deciding =
    'select 1 from sys.triggers as [t] join sys.trigger_events as [e] on [e].[object_id] = [t].[object_id] ' +
    `where [t].[parent_id] = object_id(${name}) and [t].[is_instead_of_trigger] = 1 and [t].[is_disabled] = 0 and [e].[type_desc] = N'${operation}'`
  return `if object_id(${name}) is null or exists (${deciding}) throw ${String(DECIDED_BY_TRIGGER)}, N'${DECIDED_BY_TRIGGER_MESSAGE}', 1;`
}

/** One write: the statement given its OUTPUT clause, what it assigns, what it returns, and what is checked straight after it. */
interface Write {
  target: RecordTarget
  operation: 'INSERT' | 'UPDATE'
  statement: (output: string) => string
  assigned: readonly Assigned[]
  returned: Selected[]
  /** Checks that may read `@rows`, the rows the statement changed. */
  afterWrite: readonly string[]
}

/**
 * The batch every write runs in, so that what it stored is checked before it
 * commits, and nothing it did outlives an error:
 *
 * - `OUTPUT … INTO` a table variable, never a bare `OUTPUT`, which SQL Server
 *   refuses (334) on a table with an enabled trigger. The output is the row as
 *   the statement wrote it, before any AFTER trigger changed it; the version
 *   is read back from the row afterwards (`versionAfterTriggers`).
 * - The transaction is the one the batch began. A trigger that rolls it back
 *   and begins another leaves `@@trancount` as it was, so nothing is raised,
 *   and the commit would commit an empty transaction over a write that is
 *   gone; one that commits it and begins another has stored the write. The
 *   batch cannot tell the two apart, and says so (errors.ts).
 * - No INSTEAD OF trigger decided what was stored (`insteadOfGuard`).
 * - Every text value is compared with what its column stored, exactly, and a
 *   difference rolls the write back: SQL Server converts nvarchar to a
 *   single-byte varchar without an error, a character its code page lacks
 *   becoming its "best fit" or `?` (0017), and a varchar created under
 *   ANSI_PADDING OFF drops trailing spaces without one (C12, 0028). The stored
 *   side is canonical text, a char(n)'s padding trimmed, so one comparison
 *   (`exactText`) serves both lengths. OUTPUT shows the row before an AFTER
 *   trigger changed it, so this sees what the statement stored, not a trigger.
 * - TRY…CATCH rolls back on every error it catches, then rethrows it as it
 *   was. xact_abort alone does not: a trigger's RAISERROR, unlike THROW, ends
 *   nothing, so the statement and the commit would run and the driver would
 *   still report the error — a refusal over a write that committed.
 * - `xact_abort`, for what CATCH cannot catch in its own scope: a table
 *   missing when the batch compiles is resolved only when its statement
 *   runs, after `begin transaction`, and without xact_abort its 208 leaves
 *   the transaction open on the pooled connection. Both settings end with the
 *   request, which runs inside `sp_executesql` (../sql/statement.ts).
 */
function writeBatch(parameters: Parameters, { target, operation, statement, assigned, returned, afterWrite }: Write): string {
  const guarded = assigned.flatMap(({ value, sql }, index) => (value.type.kind === 'text' && value.value !== null ? [{ value, sql, index }] : []))
  const stored = guarded.map(({ value }, position) => ({
    name: `[w${String(position)}]`,
    declared: 'nvarchar(max)',
    expression: canonicalText(value.type, `inserted.${quoteName(value.name)}`),
  }))
  const refind = versionAfterTriggers(target)
  const captured = [...returned, ...stored, ...refind.captured]
  const output = `output ${captured.map((column) => column.expression).join(', ')} into @written (${captured.map((column) => column.name).join(', ')})`
  const checks = guarded.map(
    ({ sql, index }, position) =>
      `if exists (select 1 from @written where not (${exactText(`[w${String(position)}]`, sql)})) ` +
      `throw ${String(TEXT_NOT_STORED)}, N'formancy: text not stored as sent: ${String(index)}', 1;`,
  )
  return [
    'set nocount on;',
    'set xact_abort on;',
    `declare @written table (${captured.map((column) => `${column.name} ${column.declared}`).join(', ')});`,
    'declare @transaction bigint, @rows int;',
    ...refind.declared,
    'begin try',
    'begin transaction;',
    'set @transaction = current_transaction_id();',
    `${statement(output)};`,
    'set @rows = @@rowcount;',
    `if coalesce(current_transaction_id(), 0) <> @transaction throw ${String(TRANSACTION_REPLACED)}, N'${TRANSACTION_REPLACED_MESSAGE}', 1;`,
    insteadOfGuard(parameters, target.table, operation),
    ...afterWrite,
    ...checks,
    ...refind.statements,
    'commit transaction;',
    'end try',
    'begin catch',
    'if @@trancount > 0 rollback transaction;',
    'throw;',
    'end catch;',
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
  const sql = writeBatch(parameters, {
    target: request.target,
    operation: 'INSERT',
    statement: (output) => (assigned.length === 0 ? `insert into ${table} ${output} default values` : `insert into ${table} (${columns}) ${output} values (${values})`),
    assigned,
    returned: selection(request.returning, request.target.concurrency, 'inserted.'),
    afterWrite: [],
  })
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
  const sql = writeBatch(parameters, {
    target,
    operation: 'UPDATE',
    statement: (output) => `update ${quoteTable(target.table)} set ${set.join(', ')} ${output} where ${where.join(' and ')}`,
    assigned,
    returned: selection(request.returning, target.concurrency, 'inserted.'),
    afterWrite: [`if @rows > 1 throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`],
  })
  return parameters.statement(sql)
}
