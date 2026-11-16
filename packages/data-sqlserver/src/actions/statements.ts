import type { ActionArgument, ActionRequest, NormalizedType, RowFilterTerm, ThroughTerms } from '@formancy/data-core'
import mssql from 'mssql'
import { ROUTINE_TYPES } from '../discovery/routines.js'
import {
  ACTION_UNMOVED,
  ACTION_UNMOVED_MESSAGE,
  ARGUMENT_CHANGED,
  DEFINITION_MOVED,
  DEFINITION_MOVED_MESSAGE,
  definitionGuard,
  definitionMoved,
  ENDED,
  ENDED_BY_ANOTHER_ERROR,
  insteadOfGuard,
  NOT_ONE_ROW,
  NOT_ONE_ROW_MESSAGE,
  ROUTINE_DENIED,
  ROUTINE_DENIED_MESSAGE,
  ROUTINE_MOVED,
  ROUTINE_MOVED_MESSAGE,
  ROUTINE_STATUS,
  ROUTINE_STATUS_MESSAGE,
  SAME_TRANSACTION,
  TRANSACTION_ENDED,
  TRANSACTION_ENDED_MESSAGE,
} from '../records/batch-steps.js'
import { column, keyPredicates, located, ROW, tableName, versionIs } from '../records/statements.js'
import type { ExpectedVersion } from '../records/statements.js'
import { exactText } from '../sql/filters.js'
import { quoteName, quoteTable } from '../sql/quote.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { bindValue, canonicalText } from '../sql/values.js'
import { routineFactsOf, routineName } from './definition.js'

/*
 * An action's run on SQL Server as ONE batch (0160), as every write is, with
 * `xact_abort`, TRY/CATCH and 0031's transaction check: the lock that moves
 * the record's version, the routine's guard, the arguments read and checked,
 * the EXEC, and the COMMIT, each numbered in `@step`. Every identifier is
 * approved metadata and quoted here, but a parameter's name, which an EXEC
 * takes unquoted and which is held to a regular identifier instead; every
 * value is bound, but the lock timeout, which SET LOCK_TIMEOUT takes no
 * parameter for.
 *
 * CATCH records the step that failed, SQL Server's number, message and
 * severity, and the procedure the error arose in -- ERROR_PROCEDURE(),
 * which names a procedure or a trigger and is NULL for the batch's own
 * statements (measured, actions.integration.test.ts) -- in a table variable
 * a rollback does not empty, and the batch selects it rather than rethrow
 * it, as a save's does (0155). Then the moved records' keys.
 */

/** The steps of a run's batch, as `@step` numbers them. */
export const RUN_STEPS = { lock: 1, guard: 2, arguments: 3, call: 4, commit: 5 } as const

/** A parameter's name as an EXEC passes it, unquoted (0158): a regular identifier, or it is not passed. */
const PARAMETER = /^@[A-Za-z_][A-Za-z0-9_]{0,127}$/

/**
 * The type a parameter's variable is declared with: its user type, from the
 * adapter's closed table (0158), sized from the length, precision and scale
 * the snapshot recorded in its type id, and from nothing else. A type
 * outside the table is a programming error: no generator binds one.
 */
export function declaredType(typeId: string): string {
  const parts = typeId.split(':')
  const sized = parts.length === 4 && parts.every((part) => /^-?[0-9]+$/.test(part))
  const [user, length, precision, scale] = parts.map(Number) as [number, number, number, number]
  const name = sized ? ROUTINE_TYPES.get(user) : undefined
  if (name === undefined) throw new Error(`A parameter of type ${typeId} is not one this adapter declares; no generator binds one.`)
  switch (name) {
    case 'varchar':
    case 'char':
      return `${name}(${length === -1 ? 'max' : String(length)})`
    case 'nvarchar':
    case 'nchar':
      return `${name}(${length === -1 ? 'max' : String(length / 2)})`
    case 'decimal':
    case 'numeric':
      return `${name}(${String(precision)}, ${String(scale)})`
    case 'datetime2':
    case 'time':
    case 'datetimeoffset':
      return `${name}(${String(scale)})`
    default:
      return name
  }
}

/** Whether a parameter's text counts the bytes of a code page: a char or a varchar, whose code page no fact of the snapshot names (0159). */
function countsCodePage(type: NormalizedType): type is Extract<NormalizedType, { kind: 'text' }> {
  return type.kind === 'text' && type.lengthUnit === 'code-page-bytes'
}

/** The batch's arguments: what each variable is declared as, how each takes its value, and the checks that it reads back as given. */
interface Arguments {
  declared: string[]
  assigned: string[]
  checks: string[]
}

/**
 * Each argument into a variable of its parameter's exact type, in the
 * routine's order: a column of the locked row read into it in one SELECT,
 * by the record's key -- its value never leaves the database -- and a
 * value bound and set. A parameter that counts code-page bytes is checked
 * to read back as it was given, as nvarchar, and the run refused,
 * nothing called, where it does not: SQL Server writes a character its
 * code page lacks as `?`, or its best fit, without an error, whether the
 * text is an answer, a context value or a column under a collation of
 * another code page (0159). A char's padding is no change.
 */
function argumentsOf(parameters: Parameters, request: ActionRequest): Arguments {
  const declared: string[] = []
  const read: string[] = []
  const set: string[] = []
  const checks: string[] = []
  request.routine.arguments.forEach((argument: ActionArgument, index) => {
    if (!PARAMETER.test(argument.parameter)) throw new Error(`${argument.parameter} is not a parameter name an EXEC takes; no generator binds one.`)
    const variable = `@a${String(index)}`
    const given = `@s${String(index)}`
    declared.push(`declare ${variable} ${declaredType(argument.typeId)}, ${given} nvarchar(max);`)
    if (argument.from.kind === 'column') {
      const source = `${ROW}.${quoteName(argument.from.column)}`
      read.push(`${variable} = ${source}`, `${given} = convert(nvarchar(max), ${source})`)
    } else {
      const bound = bindValue(parameters, argument.type, argument.from.value)
      set.push(`set ${variable} = ${bound};`)
      if (countsCodePage(argument.type)) set.push(`set ${given} = convert(nvarchar(max), ${bound});`)
    }
    if (countsCodePage(argument.type)) {
      const trim = (text: string) => (argument.type.kind === 'text' && argument.type.fixedLength ? `rtrim(${text})` : text)
      checks.push(
        `if not (${exactText(trim(`convert(nvarchar(max), ${variable})`), trim(given))}) ` +
          `throw ${String(ARGUMENT_CHANGED)}, N'formancy: an argument did not reach its parameter as given: ${String(index)}', 1;`,
      )
    }
  })
  const record = request.records[0] as ActionRequest['records'][number]
  const assigned =
    read.length === 0
      ? set
      : [`select ${read.join(', ')} from ${quoteTable(request.target.table)} as ${ROW} where ${keyPredicates(parameters, record.key).join(' and ')};`, ...set]
  return { declared, assigned, checks }
}

/** The lock and the move: the version column incremented, or a rowversion's touch column set to itself, which moves the rowversion (0155, 0159). */
function moveOf(request: ActionRequest): string {
  const { move, target } = request
  if (move.kind === 'increment') {
    if (target.concurrency.kind !== 'version-column' || move.column !== target.concurrency.column)
      throw new Error('A run increments the version column the record is guarded by.')
    return `${quoteName(move.column)} = ${column(move.column)} + 1`
  }
  if (target.concurrency.kind !== 'rowversion' || move.column === target.concurrency.column)
    throw new Error('A run sets a rowversion table’s touch column to itself, and never the rowversion.')
  return `${quoteName(move.column)} = ${column(move.column)}`
}

/**
 * The batch of one run (0160):
 *
 * 1. SET LOCK_TIMEOUT to `lockTimeoutMs`, then the record locked and moved
 *    in one UPDATE, WITH (UPDLOCK, HOLDLOCK), under its key, the person's
 *    filters and every through -- each parent read WITH (HOLDLOCK), so
 *    held to the COMMIT -- at the version they read, the open version
 *    alone on a form over versions (0113); then the checks a write's step
 *    carries: the transaction still the batch's, the root's definition the
 *    one decided over (0041), no INSTEAD OF trigger, one row. None is the
 *    adapter's own error, THROWn, and explained by a read after. Then
 *    LOCK_TIMEOUT back to -1, the default: the routine's own waits are
 *    bounded by the request's timeout alone.
 * 2. The routine's guard: OBJECT_ID and its definition's digest, compared
 *    with the bundle's, just before the EXEC -- unlike the root's, not
 *    inside the statement it guards, and nothing closes the window between
 *    the two: the cost, which 0160 names. Then EXECUTE, as
 *    HAS_PERMS_BY_NAME answers it: a 229 at the EXEC names the procedure in
 *    ERROR_PROCEDURE() as one inside it does, so it is asked first.
 * 3. Each argument read into a variable of its parameter's type, checked.
 * 4. The EXEC, its status kept; then the transaction still the one the
 *    batch began -- a procedure that ended it may have committed (0031
 *    P8) -- and a status other than 0 THROWn, so the batch rolls back.
 * 5. The COMMIT.
 */
export function runBatch(
  request: ActionRequest,
  terms: readonly RowFilterTerm[],
  through: readonly ThroughTerms[],
  expected: ExpectedVersion,
  definition: Buffer,
  routine: Buffer,
  lockTimeoutMs: number,
): Statement {
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1) throw new TypeError('A lock timeout is a whole number of milliseconds above 0.')
  const parameters = new Parameters()
  const { target } = request
  const record = request.records[0] as ActionRequest['records'][number]
  const where = [...located(parameters, record.key, terms, through, true), versionIs(parameters, target.concurrency, expected)]
  if (request.open !== undefined) where.push(`${column(request.open)} is null`)
  const keys = target.identity.map((entry, index) => ({
    name: `[k${String(index)}]`,
    expression: canonicalText(entry.type, `inserted.${quoteName(entry.name)}`),
  }))
  const table = tableName(parameters, target.table)
  const root = parameters.add(mssql.VarBinary(32), definition)
  const name = routineName(parameters, request.routine.ref)
  const bound = parameters.add(mssql.VarBinary(32), routine)
  const args = argumentsOf(parameters, request)
  const exec = request.routine.arguments.map((argument, index) => `${argument.parameter} = @a${String(index)}`)
  const { set: moved, moved: rootMoved } = definitionMoved(table, root)
  const sql = [
    'set nocount on;',
    'set xact_abort on;',
    'declare @step int = 0, @transaction bigint, @rows int, @status int, @ended bit, @d varbinary(32);',
    'declare @failed table ([step] int, [number] int, [message] nvarchar(4000), [severity] int, [procedure] nvarchar(128));',
    `declare @moved table (${keys.map((key) => `${key.name} nvarchar(max)`).join(', ')});`,
    ...args.declared,
    'begin try',
    `set lock_timeout ${String(lockTimeoutMs)};`,
    'begin transaction;',
    'set @transaction = current_transaction_id();',
    `set @step = ${String(RUN_STEPS.lock)};`,
    `update ${ROW} set ${moveOf(request)} output ${keys.map((key) => key.expression).join(', ')} into @moved (${keys.map((key) => key.name).join(', ')}) ` +
      `from ${quoteTable(target.table)} as ${ROW} with (updlock, holdlock) where ${where.join(' and ')};`,
    'set @rows = @@rowcount;',
    SAME_TRANSACTION,
    ...definitionGuard(table, root),
    insteadOfGuard(table, 'UPDATE'),
    `if @rows > 1 throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`,
    `if @rows = 0 throw ${String(ACTION_UNMOVED)}, N'${ACTION_UNMOVED_MESSAGE}', 1;`,
    'set lock_timeout -1;',
    `set @step = ${String(RUN_STEPS.guard)};`,
    `set @d = hashbytes('SHA2_256', ${routineFactsOf(name)});`,
    `if @d is null or @d <> ${bound} throw ${String(ROUTINE_MOVED)}, N'${ROUTINE_MOVED_MESSAGE}', 1;`,
    `if coalesce(has_perms_by_name(${name}, N'OBJECT', N'EXECUTE'), 0) <> 1 throw ${String(ROUTINE_DENIED)}, N'${ROUTINE_DENIED_MESSAGE}', 1;`,
    `set @step = ${String(RUN_STEPS.arguments)};`,
    ...args.assigned,
    ...args.checks,
    `set @step = ${String(RUN_STEPS.call)};`,
    `exec @status = ${quoteTable({ schema: request.routine.ref.schema, name: request.routine.ref.name })}${exec.length === 0 ? '' : ` ${exec.join(', ')}`};`,
    SAME_TRANSACTION,
    `if @status <> 0 throw ${String(ROUTINE_STATUS)}, N'${ROUTINE_STATUS_MESSAGE}', 1;`,
    `set @step = ${String(RUN_STEPS.commit)};`,
    'commit transaction;',
    'end try',
    'begin catch',
    ENDED,
    'if @@trancount > 0 rollback transaction;',
    // A procedure or a trigger that ended the transaction may have committed what came before it (0031): recorded as that, and the catalog not read.
    `if ${ENDED_BY_ANOTHER_ERROR} insert @failed values (@step, ${String(TRANSACTION_ENDED)}, N'${TRANSACTION_ENDED_MESSAGE}', null, null);`,
    'else insert @failed values (@step, error_number(), error_message(), error_severity(), error_procedure());',
    // A statement that failed against a moved root is answered as the move, as a write's is (0041).
    `if @ended = 0 and @step = ${String(RUN_STEPS.lock)} begin ${moved} if ${rootMoved} insert @failed values (@step, ${String(DEFINITION_MOVED)}, N'${DEFINITION_MOVED_MESSAGE}', null, null); end;`,
    'end catch;',
    'select [step], [number], [message], [severity], [procedure] from @failed;',
    `select ${keys.map((key) => key.name).join(', ')} from @moved;`,
  ].join('\n')
  return parameters.statement(sql)
}
