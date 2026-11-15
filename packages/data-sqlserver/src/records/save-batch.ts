import type {
  DeleteRequest,
  DeleteTerms,
  InsertRequest,
  ObjectRef,
  RecordColumn,
  RecordTarget,
  RecordValue,
  RowFilterTerm,
  SaveChild,
  SaveRecordStep,
  SaveStep,
  ThroughTerms,
  UpdateRequest,
} from '@formancy/data-core'
import mssql from 'mssql'
import { quoteName, quoteTable } from '../sql/quote.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { bindValue } from '../sql/values.js'
import {
  capturedKey,
  COUNT_OUTSIDE,
  COUNT_OUTSIDE_MESSAGE,
  DEFINITION_MOVED,
  DEFINITION_MOVED_MESSAGE,
  definitionGuard,
  definitionMoved,
  ENDED,
  ENDED_BY_ANOTHER_ERROR,
  insteadOfGuard,
  NOT_ONE_ROW,
  NOT_ONE_ROW_MESSAGE,
  NOT_WITHIN,
  NOT_WITHIN_MESSAGE,
  PAST_DEADLINE,
  PAST_DEADLINE_MESSAGE,
  SAME_TRANSACTION,
  STEP_UNCHANGED,
  STEP_UNCHANGED_MESSAGE,
  textStored,
  TRANSACTION_ENDED,
  TRANSACTION_ENDED_MESSAGE,
  versionAfterTriggers,
} from './batch-steps.js'
import type { Assigned, Refind, Selected } from './batch-steps.js'
import { reachDeletable, reachGuard } from './delete.js'
import { clocked, column, filterPredicates, located, NOW, ROW, selection, tableName, versionIs } from './statements.js'
import type { ExpectedVersion } from './statements.js'

/*
 * A save of a record with the rows of its together children as ONE batch on
 * SQL Server (0155): today's write batch generalised to many steps, each
 * step the statement a write alone makes, followed by the checks every step
 * of a write batch carries (batch-steps.ts), in one transaction the batch
 * owns. Every value is bound, the bounds and the deadline among them; only
 * `set lock_timeout` is spliced, from a whole number the caller checked.
 *
 * CATCH records the step that failed, SQL Server's own number and its
 * message in a table variable, which a rollback does not empty, and the
 * batch selects it rather than rethrow it: so the adapter knows the step and
 * still has the number. The message holds values -- a duplicate key's -- and
 * is read for names only, as a single write's is (errors.ts). What CATCH
 * cannot catch in its scope -- a table missing when its statement compiles,
 * an attention -- reaches the client as an error with no step, and
 * `xact_abort` rolls it back.
 */

/** A record's step as the batch writes it: its request, the definition it was decided over, its scope, and the version it is guarded by. */
export interface BatchRecord {
  step: SaveRecordStep
  definition: Buffer
  terms: readonly RowFilterTerm[]
  through: readonly ThroughTerms[]
  /** The version an update or a touch is guarded by; `null` for an insert. */
  expected: ExpectedVersion | null
}

/** One child's steps as the batch writes them. */
export interface BatchChild {
  child: SaveChild
  deletes: ReadonlyArray<{ request: DeleteRequest; terms: DeleteTerms; expected: ExpectedVersion; definition: Buffer }>
  updates: ReadonlyArray<{
    request: UpdateRequest
    terms: readonly RowFilterTerm[]
    through: readonly ThroughTerms[]
    expected: ExpectedVersion
    definition: Buffer
  }>
  creates: ReadonlyArray<{ request: InsertRequest; definition: Buffer }>
  within: { target: ObjectRef; terms: readonly RowFilterTerm[] } | null
  count: { terms: readonly RowFilterTerm[]; through: readonly ThroughTerms[]; min: number; max: number }
}

/** What one value of the batch's `@step` stands for: the step of the save, what it does, and the values it assigns, in its order. */
export interface BatchStep {
  at: SaveStep
  kind: 'begin' | 'record' | 'within' | 'delete' | 'update' | 'create' | 'count' | 'read-back' | 'commit'
  assigned: readonly RecordValue[]
}

/** The batch, what each of its steps is, and what its result sets hold after `@failed` and the record: each child's rows, in its steps' order. */
export interface SaveBatch {
  statement: Statement
  steps: BatchStep[]
}

/** The batch as it is built: its parameters, its declarations, its body, and each table's definition, checked again in CATCH for the steps that wrote it. */
class Builder {
  readonly parameters = new Parameters()
  readonly declared: string[] = []
  readonly body: string[] = []
  readonly steps: BatchStep[] = [{ at: 'save', kind: 'begin', assigned: [] }]
  readonly selected: string[] = []
  readonly #tables = new Map<string, { name: string; definition: string; steps: number[] }>()
  readonly #checked = new Set<string>()
  clock = false
  readonly deadline: string

  constructor(deadlineMs: number) {
    this.deadline = this.parameters.add(mssql.Int, deadlineMs)
  }

  /** The table's bound name and definition, once per table and definition, and the step that writes it noted for CATCH's check. */
  table(table: ObjectRef, definition: Buffer, step: number): { name: string; definition: string } {
    const key = `${quoteTable(table)}\u0000${definition.toString('hex')}`
    let known = this.#tables.get(key)
    if (known === undefined) {
      known = { name: tableName(this.parameters, table), definition: this.parameters.add(mssql.VarBinary(32), definition), steps: [] }
      this.#tables.set(key, known)
    }
    known.steps.push(step)
    return known
  }

  /** Whether `key` is asked for the first time in this batch: a check that holds for the rest of the transaction once one step has passed it. */
  first(key: string): boolean {
    if (this.#checked.has(key)) return false
    this.#checked.add(key)
    return true
  }

  /** A new step, numbered in the batch's order, whose deadline is checked before it starts. */
  begin(at: SaveStep, kind: BatchStep['kind'], assigned: readonly RecordValue[] = []): number {
    const number = this.steps.length
    this.steps.push({ at, kind, assigned })
    this.body.push(
      `set @step = ${String(number)};`,
      `if datediff_big(millisecond, @start, sysutcdatetime()) >= ${this.deadline} throw ${String(PAST_DEADLINE)}, N'${PAST_DEADLINE_MESSAGE}', 1;`,
    )
    return number
  }

  /** In CATCH, while the transaction is still the batch's: each table that a step which failed wrote, asked whether its definition moved (0041), and the move recorded. */
  moves(): string[] {
    return [...this.#tables.values()].map(({ name, definition, steps }) => {
      const { set, moved } = definitionMoved(name, definition)
      return `if @step in (${steps.join(', ')}) begin ${set} if ${moved} insert @failed values (@step, ${String(DEFINITION_MOVED)}, N'${DEFINITION_MOVED_MESSAGE}', null); end;`
    })
  }
}

/** One write step: its statement given an OUTPUT clause into its own table variable, the checks every write step carries, and what it selects at the end. */
interface WriteStep {
  number: number
  target: RecordTarget
  table: ObjectRef
  definition: Buffer
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  statement: (output: string) => string
  assigned: readonly Assigned[]
  returned: Selected[]
  /** Finds the written row again: its version after its triggers, or the record's key for its rows. */
  refind: Refind
  /** A delete's checks of what its reach refers to, made after the first delete of that reach (0050, 0051), by the key that says which. */
  reach?: { key: string; checks: () => string[] }
  /** Whether what it wrote is selected after the batch, as a row of a child. */
  answered: boolean
}

/**
 * One write step in the batch. The table's definition guard (0041) and its
 * INSTEAD OF guard follow the first step that writes the table, and a
 * delete's reach checks the first delete of that reach, and none after
 * them: that step's statement left the transaction holding IX on the table
 * to its end, which keeps out the Sch-M lock an ALTER, an added key and a
 * CREATE TRIGGER need, so what they checked holds for every later step. A
 * check per step was measured repeating the catalog's facts for each row,
 * the batch growing by about 4.8 KB of SQL a line and taking 8.7 s to
 * compile at 60 lines (mcr.microsoft.com/mssql/server:2022-latest,
 * 2026-11-16). The text check, the row count and the version read after
 * triggers stay every step's own.
 */
function write(batch: Builder, step: WriteStep): void {
  const written = `@w${String(step.number)}`
  const { stored, checks } = textStored(step.assigned, written)
  const captured = [...step.returned, ...stored, ...step.refind.captured]
  const { name, definition } = batch.table(step.table, step.definition, step.number)
  batch.declared.push(`declare ${written} table (${captured.map((entry) => `${entry.name} ${entry.declared}`).join(', ')});`, ...step.refind.declared)
  const output = `output ${captured.map((entry) => entry.expression).join(', ')} into ${written} (${captured.map((entry) => entry.name).join(', ')})`
  batch.body.push(
    `${step.statement(output)};`,
    'set @rows = @@rowcount;',
    SAME_TRANSACTION,
    ...(batch.first(`definition ${name}`) ? definitionGuard(name, definition) : []),
    ...(batch.first(`instead of ${name} ${step.operation}`) ? [insteadOfGuard(name, step.operation)] : []),
    ...(step.reach !== undefined && batch.first(step.reach.key) ? step.reach.checks() : []),
    `if @rows > 1 throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`,
    `if @rows = 0 throw ${String(STEP_UNCHANGED)}, N'${STEP_UNCHANGED_MESSAGE}', 1;`,
    ...checks,
    ...step.refind.statements,
  )
  if (step.answered) batch.selected.push(`select ${step.returned.map((entry) => entry.name).join(', ')} from ${written};`)
}

/** Each value bound as its column's type: what a write assigns. */
function assign(batch: Builder, values: readonly RecordValue[]): Assigned[] {
  return values.map((value) => ({ value, sql: bindValue(batch.parameters, value.type, value.value) }))
}

/** A SET's assignments, then the clock's stamps, then a version column's increment. */
function setList(assigned: readonly Assigned[], request: Pick<UpdateRequest, 'clock' | 'target'>, batch: Builder): string[] {
  const set = assigned.map(({ value, sql }) => `${quoteName(value.name)} = ${sql}`)
  const stamped = clocked(request.clock)
  if (stamped.length > 0) batch.clock = true
  for (const [name, sql] of stamped) set.push(`${name} = ${sql}`)
  const { concurrency } = request.target
  if (concurrency.kind === 'version-column') set.push(`${quoteName(concurrency.column)} = ${column(concurrency.column)} + 1`)
  return set
}

/** The record's own step, and how its key is named to its rows' statements, its `within` and its read-back. */
function recordStep(batch: Builder, record: BatchRecord): { key: (alias: string) => string[]; value: (name: string) => string } {
  const number = batch.begin(
    'record',
    'record',
    record.step.kind === 'update' ? record.step.request.set : record.step.kind === 'insert' ? record.step.request.values : [],
  )
  const { step } = record
  if (step.kind === 'insert') {
    const { request } = step
    const assigned = assign(batch, request.values)
    const stamped = clocked(request.clock)
    if (stamped.length > 0) batch.clock = true
    const key = capturedKey(request.target, `@w${String(number)}`, `s${String(number)}`)
    if (key === undefined) throw new Error("A record saved with its rows is found again by its key, and this record's key does not travel as text.")
    const table = quoteTable(request.target.table)
    const columns = [...assigned.map(({ value }) => quoteName(value.name)), ...stamped.map(([name]) => name)].join(', ')
    const values = [...assigned.map(({ sql }) => sql), ...stamped.map(([, sql]) => sql)].join(', ')
    write(batch, {
      number,
      target: request.target,
      table: request.target.table,
      definition: record.definition,
      operation: 'INSERT',
      statement: (output) =>
        columns === '' ? `insert into ${table} ${output} default values` : `insert into ${table} (${columns}) ${output} values (${values})`,
      assigned,
      returned: [{ name: '[found]', declared: 'int', expression: '1' }],
      refind: key,
      answered: false,
    })
    return { key: (alias) => key.found(alias), value: (name) => key.variables.get(name) as string }
  }
  const { request } = step
  const expected = record.expected as ExpectedVersion
  const assigned = step.kind === 'update' ? assign(batch, step.request.set) : []
  const set = step.kind === 'update' ? setList(assigned, step.request, batch) : touchList(step.request.target, step.request.touch)
  const where = [...located(batch.parameters, request.key, record.terms, record.through), versionIs(batch.parameters, request.target.concurrency, expected)]
  write(batch, {
    number,
    target: request.target,
    table: request.target.table,
    definition: record.definition,
    operation: 'UPDATE',
    statement: (output) => `update ${ROW} set ${set.join(', ')} ${output} from ${quoteTable(request.target.table)} as ${ROW} where ${where.join(' and ')}`,
    assigned,
    returned: [{ name: '[found]', declared: 'int', expression: '1' }],
    refind: { captured: [], declared: [], statements: [] },
    answered: false,
  })
  return {
    key: (alias) => request.key.map((value) => `${alias}.${quoteName(value.name)} = ${bindValue(batch.parameters, value.type, value.value)}`),
    value: (name) => {
      const known = request.key.find((value) => value.name === name) as RecordValue
      return bindValue(batch.parameters, known.type, known.value)
    },
  }
}

/** A touch's SET (0155): a version column incremented, or a rowversion table's confirmed touch column set to itself, which moves its rowversion and fires its UPDATE triggers with UPDATE(column) true (save-facts.integration.test.ts). */
function touchList(target: RecordTarget & { concurrency: { kind: string; column: string } }, touch: string | null): string[] {
  if (target.concurrency.kind === 'version-column') return [`${quoteName(target.concurrency.column)} = ${column(target.concurrency.column)} + 1`]
  if (touch === null) throw new Error('A rowversion moves only when a column is set, and this touch names no touch column.')
  return [`${quoteName(touch)} = ${column(touch)}`]
}

/** The pin of a child's rows to the record: each foreign-key column with the record's key value, bound where it is known, or the record's own key as its step wrote it. */
function pinOf(
  batch: Builder,
  child: SaveChild,
  record: { value: (name: string) => string },
): Array<{ column: RecordColumn; sql: string; value: RecordValue | null }> {
  return child.parent.map((entry) =>
    'value' in entry
      ? { column: entry.column, sql: bindValue(batch.parameters, entry.column.type, entry.value.value), value: { ...entry.column, value: entry.value.value } }
      : { column: entry.column, sql: record.value(entry.returned), value: null },
  )
}

/** One child's `within`, deletes, updates and creates, each pinned to the record. */
function childSteps(batch: Builder, index: number, prepared: BatchChild, record: { key: (alias: string) => string[]; value: (name: string) => string }): void {
  const { child } = prepared
  if (prepared.within !== null) {
    batch.begin({ child: index, within: true }, 'within')
    const where = [...record.key(ROW), ...filterPredicates(batch.parameters, prepared.within.terms)]
    batch.body.push(
      `if not exists (select 1 from ${quoteTable(prepared.within.target)} as ${ROW} where ${where.join(' and ')}) throw ${String(NOT_WITHIN)}, N'${NOT_WITHIN_MESSAGE}', 1;`,
    )
  }
  prepared.deletes.forEach(({ request, terms, expected, definition }, position) => {
    const number = batch.begin({ child: index, delete: position }, 'delete')
    const pin = pinOf(batch, child, record).map(({ column: pinned, sql }) => `${column(pinned.name)} = ${sql}`)
    const where = [
      ...located(batch.parameters, terms.key, terms.terms, terms.through),
      ...pin,
      versionIs(batch.parameters, request.target.concurrency, expected),
    ]
    write(batch, {
      number,
      target: request.target,
      table: terms.root,
      definition,
      operation: 'DELETE',
      statement: (output) => `delete ${ROW} ${output} from ${quoteTable(terms.root)} as ${ROW} where ${where.join(' and ')}`,
      assigned: [],
      returned: selection(request.target.identity, request.target.concurrency, 'deleted.'),
      // A deleted row's version is the one OUTPUT saw it deleted at (0050).
      refind: { captured: [], declared: [], statements: [] },
      reach: {
        key: `reach ${JSON.stringify(terms.reach)}`,
        checks: () => [reachGuard(batch.parameters, terms.reach), ...reachDeletable(batch.parameters, terms.reach)],
      },
      answered: true,
    })
  })
  prepared.updates.forEach(({ request, terms, through, expected, definition }, position) => {
    const number = batch.begin({ child: index, update: position }, 'update', request.set)
    const assigned = assign(batch, request.set)
    const set = setList(assigned, request, batch)
    const pin = pinOf(batch, child, record).map(({ column: pinned, sql }) => `${column(pinned.name)} = ${sql}`)
    const where = [...located(batch.parameters, request.key, terms, through), ...pin, versionIs(batch.parameters, request.target.concurrency, expected)]
    write(batch, {
      number,
      target: request.target,
      table: request.target.table,
      definition,
      operation: 'UPDATE',
      statement: (output) => `update ${ROW} set ${set.join(', ')} ${output} from ${quoteTable(request.target.table)} as ${ROW} where ${where.join(' and ')}`,
      assigned,
      returned: selection(request.returning, request.target.concurrency, 'inserted.'),
      refind: versionAfterTriggers(request.target, `@w${String(number)}`, `s${String(number)}`),
      answered: true,
    })
  })
  prepared.creates.forEach(({ request, definition }, position) => {
    const pins = pinOf(batch, child, record)
    const number = batch.begin({ child: index, create: position }, 'create', request.values)
    const assigned = assign(batch, request.values)
    const stamped = clocked(request.clock)
    if (stamped.length > 0) batch.clock = true
    const names = [
      ...assigned.map(({ value }) => quoteName(value.name)),
      ...pins.map(({ column: pinned }) => quoteName(pinned.name)),
      ...stamped.map(([name]) => name),
    ]
    const values = [...assigned.map(({ sql }) => sql), ...pins.map(({ sql }) => sql), ...stamped.map(([, sql]) => sql)]
    const table = quoteTable(request.target.table)
    write(batch, {
      number,
      target: request.target,
      table: request.target.table,
      definition,
      operation: 'INSERT',
      statement: (output) => `insert into ${table} (${names.join(', ')}) ${output} values (${values.join(', ')})`,
      assigned,
      returned: selection(request.returning, request.target.concurrency, 'inserted.'),
      refind: versionAfterTriggers(request.target, `@w${String(number)}`, `s${String(number)}`),
      answered: true,
    })
  })
}

/**
 * A child's count once every step ran (0155): its rows the record's key
 * pins, under its read filters and throughs, at most `max + 1` of them --
 * `top (@k)`, so a large set is never counted whole -- held to `min` and
 * `max`, all three bound. `@n` is kept for CATCH, which records it.
 */
function countStep(batch: Builder, index: number, prepared: BatchChild, record: { value: (name: string) => string }): void {
  batch.begin({ child: index, count: true }, 'count')
  const { parameters } = batch
  const pin = pinOf(batch, prepared.child, record).map(({ column: pinned, sql }) => `${column(pinned.name)} = ${sql}`)
  const where = [...pin, ...located(parameters, [], prepared.count.terms, prepared.count.through)]
  const limit = parameters.add(mssql.Int, prepared.count.max + 1)
  const min = parameters.add(mssql.Int, prepared.count.min)
  const max = parameters.add(mssql.Int, prepared.count.max)
  batch.body.push(
    `select @n = count(*) from (select top (${limit}) 1 as [x] from ${quoteTable(prepared.child.table)} as ${ROW} where ${where.join(' and ')}) as [c];`,
    `if @n < ${min} or @n > ${max} throw ${String(COUNT_OUTSIDE)}, N'${COUNT_OUTSIDE_MESSAGE}', 1;`,
  )
}

/**
 * The batch of one save: the record's step, each child's, the counts, the
 * record read back by its key into `@r`, and the commit; CATCH records the
 * step that failed; then `@failed`, the record and every child row step's
 * rows are selected, in that order. `lockTimeoutMs` is spliced, the only
 * value that is, because SET LOCK_TIMEOUT takes no parameter here.
 */
export function saveBatch(record: BatchRecord, children: readonly BatchChild[], readBack: readonly RecordColumn[], deadlineMs: number): SaveBatch {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) throw new TypeError('A save deadline is a whole number of milliseconds above 0.')
  const batch = new Builder(deadlineMs)
  batch.body.push('begin transaction;', 'set @transaction = current_transaction_id();')
  const key = recordStep(batch, record)
  children.forEach((child, index) => childSteps(batch, index, child, key))
  children.forEach((child, index) => countStep(batch, index, child, key))
  const target = record.step.request.target
  const back = selection(readBack, target.concurrency, `${ROW}.`)
  batch.begin('record', 'read-back')
  batch.declared.push(`declare @r table (${back.map((entry) => `${entry.name} ${entry.declared}`).join(', ')});`)
  batch.body.push(
    `insert @r (${back.map((entry) => entry.name).join(', ')}) select top (2) ${back.map((entry) => entry.expression).join(', ')} from ${quoteTable(target.table)} as ${ROW} where ${key.key(ROW).join(' and ')};`,
    'set @rows = @@rowcount;',
    `if @rows > 1 throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`,
    `if @rows = 0 throw ${String(STEP_UNCHANGED)}, N'${STEP_UNCHANGED_MESSAGE}', 1;`,
  )
  batch.begin('save', 'commit')
  batch.body.push(SAME_TRANSACTION, 'commit transaction;')
  const sql = [
    'set nocount on;',
    'set xact_abort on;',
    `set lock_timeout ${String(deadlineMs)};`,
    'declare @start datetime2(7) = sysutcdatetime();',
    'declare @step int = 0, @transaction bigint, @rows int, @ended bit, @d varbinary(32), @n int;',
    'declare @failed table ([step] int, [number] int, [message] nvarchar(4000), [held] int);',
    ...(batch.clock ? [`declare ${NOW} datetime2(7) = sysutcdatetime();`] : []),
    ...batch.declared,
    'begin try',
    ...batch.body,
    'end try',
    'begin catch',
    ENDED,
    'if @@trancount > 0 rollback transaction;',
    // A trigger that ended the transaction may have committed what came before it (0031): recorded as that, and the catalog not read.
    `if ${ENDED_BY_ANOTHER_ERROR} begin insert @failed values (@step, ${String(TRANSACTION_ENDED)}, N'${TRANSACTION_ENDED_MESSAGE}', @n); end`,
    'else begin insert @failed values (@step, error_number(), error_message(), @n); end;',
    `if @ended = 0 begin ${batch.moves().join(' ')} end;`,
    'end catch;',
    'select [step], [number], [message], [held] from @failed;',
    `select ${back.map((entry) => entry.name).join(', ')} from @r;`,
    ...batch.selected,
  ].join('\n')
  return { statement: batch.parameters.statement(sql), steps: batch.steps }
}
