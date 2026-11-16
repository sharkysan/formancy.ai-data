import type {
  ClockColumn,
  InsertRequest,
  ObjectRef,
  ReadRequest,
  RecordColumn,
  RecordConcurrency,
  RecordTarget,
  RecordValue,
  RowFilterTerm,
  ThroughTerms,
  UpdateRequest,
} from '@formancy/data-core'
import mssql from 'mssql'
import { quoteName, quoteTable } from '../sql/quote.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { filterPredicate } from '../sql/filters.js'
import { bindValue, canonicalText } from '../sql/values.js'
import {
  definitionGuard,
  ENDED,
  ENDED_BY_ANOTHER_ERROR,
  insteadOfGuard,
  SAME_TRANSACTION,
  TRANSACTION_ENDED,
  TRANSACTION_ENDED_MESSAGE,
  NOT_ONE_ROW,
  NOT_ONE_ROW_MESSAGE,
  textStored,
  versionAfterTriggers,
  versionOf,
} from './batch-steps.js'
import type { Assigned, Refind, Selected } from './batch-steps.js'
import { digestOf, factsOf } from './definition.js'

/**
 * The SQL of each record operation. Every statement selects the same shape —
 * `[found]`, then `[c0]`, `[c1]`, … the canonical text of each requested
 * column, then `[version]` — so one function in records.ts reads all of them.
 *
 * The write batches raise errors of their own (batch-steps.ts), and every
 * step of a batch carries the checks that file holds, which the batch of a
 * save carries too (save-batch.ts, 0155).
 */

/** A version as it is compared: the 8 bytes of a rowversion, or a version column's decimal string. */
export type ExpectedVersion = { kind: 'rowversion'; bytes: Buffer } | { kind: 'version-column'; value: string }

/**
 * What every statement returns, from `source` — `[r].` for the table, `inserted.`
 * for an OUTPUT clause. `[found]` is always there, so a request for no
 * columns is still a statement. A rowversion comes back as its 8 bytes, which
 * `encodeRowversion` spells, so the adapter and the core cannot spell a token
 * two ways; a version column as its decimal text.
 */
export function selection(columns: readonly RecordColumn[], concurrency: RecordConcurrency | null, source: string): Selected[] {
  const selected: Selected[] = [{ name: '[found]', declared: 'int', expression: '1' }]
  columns.forEach((column, index) => {
    selected.push({ name: `[c${String(index)}]`, declared: 'nvarchar(max)', expression: canonicalText(column.type, `${source}${quoteName(column.name)}`) })
  })
  if (concurrency !== null) selected.push(versionOf(concurrency, source))
  return selected
}

/**
 * The alias of the target table in every record statement but an insert, so
 * that every column a statement names says which table it is of: a
 * correlated subquery over another table, or over the same one, can then
 * never bind a bare name to the wrong row.
 */
export const ROW = '[r]'

export function column(name: string): string {
  return `${ROW}.${quoteName(name)}`
}

export function keyPredicates(parameters: Parameters, key: readonly RecordValue[]): string[] {
  return key.map((value) => `${column(value.name)} = ${bindValue(parameters, value.type, value.value)}`)
}

/** The trusted filters, each comparing the column's canonical value exactly (../sql/filters.ts, 0028). */
export function filterPredicates(parameters: Parameters, terms: readonly RowFilterTerm[]): string[] {
  return terms.map((term) => filterPredicate(parameters, column(term.column), term))
}

/** The alias of a through's target inside its EXISTS. */
const PARENT = '[p]'

/**
 * One through (0043) as a condition on the record: its parent row, the one
 * the record's foreign-key columns reference, is one the target's filter
 * admits. An EXISTS in the statement itself, under the statement's own
 * locks. The pair compares with `=`, as the foreign key does; the filter
 * terms compare exactly (0028). Every column is qualified, so a key onto the
 * same table compares the parent's key with the record's column and never a
 * row with itself. A record whose foreign key is NULL matches no parent.
 */
export function throughPredicate(parameters: Parameters, through: ThroughTerms): string {
  const pairs = through.pairs.map((pair) => `${PARENT}.${quoteName(pair.references)} = ${column(pair.column)}`)
  const terms = through.terms.map((term) => filterPredicate(parameters, `${PARENT}.${quoteName(term.column)}`, term))
  return `exists (select 1 from ${quoteTable(through.target)} as ${PARENT} where ${[...pairs, ...terms].join(' and ')})`
}

/** What locates a record in every statement but an insert: its key, the trusted filters and every through. */
export function located(parameters: Parameters, key: readonly RecordValue[], terms: readonly RowFilterTerm[], through: readonly ThroughTerms[]): string[] {
  return [...keyPredicates(parameters, key), ...filterPredicates(parameters, terms), ...through.map((entry) => throughPredicate(parameters, entry))]
}

/** The table's quoted name, bound as `object_id` reads it. */
export function tableName(parameters: Parameters, table: ObjectRef): string {
  return parameters.add(mssql.NVarChar(mssql.MAX), quoteTable(table))
}

/** One column of a table's description: its name in the result, and the SQL that computes it. */
export interface DescribedColumnSql {
  name: string
  expression: string
}

/** The table's facts and their digest, as `[facts]` and `[digest]` of a derived table `[f]`. */
export function described(parameters: Parameters, table: ObjectRef): { columns: DescribedColumnSql[]; from: string } {
  return {
    columns: [
      { name: '[facts]', expression: '[f].[facts]' },
      { name: '[digest]', expression: digestOf('[f].[facts]') },
    ],
    from: `(select ${factsOf(tableName(parameters, table))} as [facts]) as [f]`,
  }
}

/** A description's columns as a select list. */
function describedSelect(columns: readonly DescribedColumnSql[]): string {
  return columns.map((column) => `${column.expression} as ${column.name}`).join(', ')
}

/** The table's description, in one statement: its facts and their digest. */
export function describeStatement(table: ObjectRef): Statement {
  const parameters = new Parameters()
  const { columns, from } = described(parameters, table)
  return parameters.statement(`select ${describedSelect(columns)} from ${from}`)
}

/**
 * One record under the filters, with the table as this same statement found
 * it (0041): one statement, which holds a schema-stability lock on the table
 * while it runs, so no ALTER lands between the facts and the record.
 * `top (2)`, so an identity that matched more than one row is noticed
 * without reading every row it matched; one row with a NULL `[found]` when
 * none is inside the filters.
 */
export function readStatement(request: ReadRequest, terms: readonly RowFilterTerm[], through: readonly ThroughTerms[]): Statement {
  const parameters = new Parameters()
  const { columns, from } = described(parameters, request.target.table)
  const where = located(parameters, request.key, terms, through)
  const record = selection(request.columns, request.target.concurrency, `${ROW}.`).map((selected) => `${selected.expression} as ${selected.name}`)
  return parameters.statement(
    `select ${describedSelect(columns)}, [record].* from ${from} outer apply (select top (2) ${record.join(', ')} from ${quoteTable(request.target.table)} as ${ROW} where ${where.join(' and ')}) as [record]`,
  )
}

/**
 * Whether a record is there for this actor -- what tells a stale update from
 * one aimed at nothing -- and whether the table's definition is still the
 * one the update was decided over (0041), which comes first. Located as the
 * update is, inside the filters and every through (0043), so a record outside
 * them is not found whatever version was sent.
 */
export function existsStatement(
  request: Pick<UpdateRequest, 'target' | 'key'>,
  terms: readonly RowFilterTerm[],
  through: readonly ThroughTerms[],
  definition: Buffer,
  ended?: { open: string; concurrency: RecordConcurrency; expected: ExpectedVersion },
): Statement {
  const parameters = new Parameters()
  const table = request.target.table
  const same = `case when ${digestOf(factsOf(tableName(parameters, table)))} = ${parameters.add(mssql.VarBinary(32), definition)} then 1 else 0 end`
  const where = located(parameters, request.key, terms, through)
  // A version that has ended at the version sent (0113): the person read it ended, and nothing changed it since.
  const over =
    ended === undefined
      ? '0'
      : `(select count(*) from ${quoteTable(table)} as ${ROW} where ${[...located(parameters, request.key, terms, through), versionIs(parameters, ended.concurrency, ended.expected), `${column(ended.open)} is not null`].join(' and ')})`
  return parameters.statement(
    `select (select count(*) from ${quoteTable(table)} as ${ROW} where ${where.join(' and ')}) as [found], ${same} as [same], ${over} as [ended]`,
  )
}

/**
 * The variable a write's batch reads the clock into, once (0153): UTC, at
 * datetime2(7), the finest SQL Server keeps. Every stamp of one write is
 * that one instant, which no reading per column would promise: each of
 * `sysutcdatetime()` and `sysdatetimeoffset()` is a reading of its own.
 */
export const NOW = '@now'

/**
 * The batch's one reading of the clock as a stamped column's type holds it
 * (0153), as fixed SQL: nothing of a request but the column's name, quoted
 * where it is named. An instant is the reading at +00:00 -- the server's
 * own offset, which `sysdatetimeoffset()` and a default of it store, is
 * never written, and the API reads an instant in UTC either way; a wall
 * clock is the reading, UTC's, as PostgreSQL's is; a day is UTC's day. A
 * column of less precision -- datetime2(3), datetime, smalldatetime --
 * rounds it, as SQL Server rounds every datetime2 assigned to one.
 */
export function clockSql(type: ClockColumn['type']): string {
  if (type.kind === 'date') return `convert(date, ${NOW})`
  return type.withTimeZone ? `todatetimeoffset(${NOW}, 0)` : NOW
}

/** The columns a write stamps with the clock, as `[name, SQL]`; none for a request that carries none. */
export function clocked(columns: readonly ClockColumn[] | undefined): Array<[string, string]> {
  return (columns ?? []).map((entry) => [quoteName(entry.name), clockSql(entry.type)])
}

/** One write: the statement given its OUTPUT clause, what it assigns, what it returns, and what is checked straight after it. */
export interface Write {
  target: RecordTarget
  /** The definition it was decided over (0041). */
  definition: Buffer
  /**
   * `DELETE` since 0050: it assigns nothing, and its row is not there to
   * read a version back from. `SUPERSEDE` since 0113: an UPDATE that ends a
   * version and an INSERT of the next, whose OUTPUT is the batch's.
   */
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'SUPERSEDE'
  statement: (output: string) => string
  /**
   * The statement sets `@rows` itself. `@@ROWCOUNT` after several
   * statements is the last one's -- an assignment's 1, or a skipped IF's --
   * so a statement of several says which rows were written (0113).
   */
  counted?: boolean
  assigned: readonly Assigned[]
  returned: Selected[]
  /** Checks that may read `@rows`, the rows the statement changed. */
  afterWrite: readonly string[]
  /** The statement stamps a column with the clock (0153), and the batch reads it into `@now` first. */
  clock?: boolean
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
 *   batch cannot tell the two apart, and says so (errors.ts). CATCH asks the
 *   same question: a trigger that committed and then raised an error of its
 *   own has stored the write, and its error is not the refusal it looks
 *   like. Measured (0031): in CATCH the transaction is no longer the one the
 *   batch began after a trigger's COMMIT, its COMMIT and BEGIN, and its
 *   ROLLBACK, and still is after a constraint's error or a trigger that only
 *   raises. So the error is replaced by one that says the transaction ended
 *   -- unknown-outcome, over-reported for the ROLLBACK -- unless it is 3609
 *   or the batch's own replaced-transaction error, which already say so.
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
 * - The table's definition is the one the write was decided over (0041),
 *   read after the statement, while its locks keep any ALTER out: ALTER
 *   needs a schema-modification lock, which waits for this transaction. And
 *   again in CATCH, after the rollback: a statement that failed against a
 *   moved table -- 'many' into a column retyped to int, 245 -- is answered
 *   as the move. Only while the transaction is still the batch's own: one a
 *   trigger ended is answered as ended, 3609, 51704 or 51705, before the
 *   catalog is read, because the trigger may have committed the write
 *   (0031). Measured: asked first, the definition answered "nothing was
 *   written" over a row a trigger's COMMIT had stored. The catalog reads in
 *   CATCH even when the transaction was doomed, once it is rolled back
 *   (measured, the probes before 0041).
 */
export function writeBatch(
  parameters: Parameters,
  { target, definition, operation, statement, assigned, returned, afterWrite, counted = false, clock = false }: Write,
): string {
  const { stored, checks } = textStored(assigned, '@written')
  // A deleted row's version is the one OUTPUT saw it deleted at: the row is
  // gone, and one a trigger inserted again is another row's to read (0050).
  const refind: Refind = operation === 'DELETE' ? { captured: [], declared: [], statements: [] } : versionAfterTriggers(target, '@written', '')
  const table = tableName(parameters, target.table)
  const moved = definitionGuard(table, parameters.add(mssql.VarBinary(32), definition))
  const captured = [...returned, ...stored, ...refind.captured]
  const output = `output ${captured.map((column) => column.expression).join(', ')} into @written (${captured.map((column) => column.name).join(', ')})`
  return [
    'set nocount on;',
    'set xact_abort on;',
    `declare @written table (${captured.map((column) => `${column.name} ${column.declared}`).join(', ')});`,
    'declare @transaction bigint, @rows int, @ended bit, @d varbinary(32);',
    ...(clock ? [`declare ${NOW} datetime2(7) = sysutcdatetime();`] : []),
    ...refind.declared,
    'begin try',
    'begin transaction;',
    'set @transaction = current_transaction_id();',
    `${statement(output)};`,
    ...(counted ? [] : ['set @rows = @@rowcount;']),
    SAME_TRANSACTION,
    ...moved,
    insteadOfGuard(table, operation),
    ...afterWrite,
    ...checks,
    ...refind.statements,
    'commit transaction;',
    'end try',
    'begin catch',
    ENDED,
    'if @@trancount > 0 rollback transaction;',
    `if ${ENDED_BY_ANOTHER_ERROR} throw ${String(TRANSACTION_ENDED)}, N'${TRANSACTION_ENDED_MESSAGE}', 1;`,
    'if @ended = 1 throw;',
    ...moved,
    'throw;',
    'end catch;',
    `select ${returned.map((column) => column.name).join(', ')} from @written;`,
  ].join('\n')
}

/**
 * Whether no row has the chain's key a create writes (0113), compared with
 * the values the insert binds: the insert's own condition, so it holds only
 * where it starts a chain. UPDLOCK and HOLDLOCK keep the range of that key
 * locked to the end of the batch's transaction, so a second create of the
 * same chain waits, and then finds the first.
 */
function freshPredicate(request: InsertRequest, assigned: readonly Assigned[]): string | undefined {
  if (request.fresh === undefined) return undefined
  const parts = request.fresh.map((name) => `[c].${quoteName(name)} = ${(assigned.find(({ value }) => value.name === name) as Assigned).sql}`)
  return `not exists (select 1 from ${quoteTable(request.target.table)} as [c] with (updlock, holdlock) where ${parts.join(' and ')})`
}

/** Exactly the given columns, so a column with a default gets it and a generated one is never named; then the columns stamped with the clock (0153). */
export function insertStatement(request: InsertRequest, definition: Buffer): Statement {
  const parameters = new Parameters()
  const assigned = request.values.map((value) => ({ value, sql: bindValue(parameters, value.type, value.value) }))
  const stamped = clocked(request.clock)
  const table = quoteTable(request.target.table)
  const columns = [...assigned.map(({ value }) => quoteName(value.name)), ...stamped.map(([name]) => name)].join(', ')
  const values = [...assigned.map(({ sql }) => sql), ...stamped.map(([, sql]) => sql)].join(', ')
  const fresh = freshPredicate(request, assigned)
  const sql = writeBatch(parameters, {
    target: request.target,
    definition,
    operation: 'INSERT',
    clock: stamped.length > 0,
    statement: (output) =>
      columns === ''
        ? `insert into ${table} ${output} default values`
        : fresh === undefined
          ? `insert into ${table} (${columns}) ${output} values (${values})`
          : `insert into ${table} (${columns}) ${output} select ${values} where ${fresh}`,
    assigned,
    returned: selection(request.returning, request.target.concurrency, 'inserted.'),
    afterWrite: [],
  })
  return parameters.statement(sql)
}

/** Whether the row's version is still the one expected: a rowversion's 8 bytes, or a version column compared as a bigint. An update's and a delete's (0050). */
export function versionIs(parameters: Parameters, concurrency: RecordConcurrency, expected: ExpectedVersion): string {
  const version = column(concurrency.column)
  return expected.kind === 'rowversion'
    ? `${version} = ${parameters.add(mssql.VarBinary(8), expected.bytes)}`
    : `${version} = convert(bigint, ${parameters.add(mssql.NVarChar(mssql.MAX), expected.value)})`
}

/**
 * ONE guarded statement (0015): the key, the trusted filters, every through
 * (0043) and the expected version in a single WHERE, and for a version column
 * the increment in the same SET, so nothing can change between the check and
 * the write. A row the filters or a through exclude is not matched, so another
 * tenant's record cannot be changed even with its current version in hand.
 * More than one row matched means the identity is not a key, and the batch
 * rolls back rather than change several. The table is aliased, `update [r]
 * … from <table> as [r]`, so that the through's EXISTS can name the row.
 */
export function updateStatement(
  request: UpdateRequest,
  terms: readonly RowFilterTerm[],
  through: readonly ThroughTerms[],
  expected: ExpectedVersion,
  definition: Buffer,
): Statement {
  const parameters = new Parameters()
  const { target } = request
  const assigned = request.set.map((value) => ({ value, sql: bindValue(parameters, value.type, value.value) }))
  // A SET names a column of the table updated, so it is not qualified; what it is set from is.
  const set = assigned.map(({ value, sql }) => `${quoteName(value.name)} = ${sql}`)
  const stamped = clocked(request.clock)
  for (const [name, sql] of stamped) set.push(`${name} = ${sql}`)
  const version = column(target.concurrency.column)
  if (target.concurrency.kind === 'version-column') set.push(`${quoteName(target.concurrency.column)} = ${version} + 1`)
  const where = [...located(parameters, request.key, terms, through), versionIs(parameters, target.concurrency, expected)]
  // A version that has ended is not updated (0113).
  if (request.open !== undefined) where.push(`${column(request.open)} is null`)
  const sql = writeBatch(parameters, {
    target,
    definition,
    operation: 'UPDATE',
    clock: stamped.length > 0,
    statement: (output) => `update ${ROW} set ${set.join(', ')} ${output} from ${quoteTable(target.table)} as ${ROW} where ${where.join(' and ')}`,
    assigned,
    returned: selection(request.returning, target.concurrency, 'inserted.'),
    afterWrite: [`if @rows > 1 throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`],
  })
  return parameters.statement(sql)
}
