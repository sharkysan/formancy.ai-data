import type { ActionArgument, ActionRequest, NormalizedType, RecordValue, RowFilterTerm, ThroughTerms } from '@formancy/data-core'
import mssql from 'mssql'
import { ROUTINE_TYPES } from '../discovery/routines.js'
import {
  ACTION_UNMOVED,
  ACTION_UNMOVED_MESSAGE,
  ARGUMENT_CHANGED,
  ARGUMENTS_UNREAD,
  ARGUMENTS_UNREAD_MESSAGE,
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
  SELECTION_DUPLICATE,
  SELECTION_DUPLICATE_PREFIX,
  TRANSACTION_ENDED,
  TRANSACTION_ENDED_MESSAGE,
} from '../records/batch-steps.js'
import { column, filterPredicates, keyPredicates, ROW, tableName, throughPredicate, versionIs } from '../records/statements.js'
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
 * each record's version, the arguments read and checked, the routine's
 * guard, the EXEC, and the COMMIT, each numbered in `@step`. A selection
 * (0165) is the same batch with one UPDATE per record, in key order, every
 * record's arguments read before the first call, and then a guard and an
 * EXEC per record. Every identifier is
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
 * it, as a save's does (0155). Then the moved records' keys, each with its
 * position in the request, which a rollback does not empty either, so a
 * selection that locked fewer records than it addressed says which it
 * locked.
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

/**
 * What a run's calls are given (0160, 0165): every record's arguments read
 * once, after the lock step and before the first EXEC, and each call's
 * variables set from its own record's just before it.
 */
interface Arguments {
  /** Each argument's variable, of its parameter's type, and @given, a row per record of its column arguments as read. */
  declared: string[]
  /** The read, once: every value bound and set, every record's row read into @given by its key -- exactly one row, or the run is refused -- and every code-page argument checked. */
  read: (addressed: readonly Addressed[]) => string[]
  /** Just before the call over the record at `position`: its column arguments' variables set from @given. */
  given: (position: number) => string[]
}

/**
 * Each argument into a variable of its parameter's exact type, in the
 * routine's order: a column of the locked row, read for every record into
 * @given by the record's key -- its value never leaves the database -- in
 * a column of that type, and set from there before the record's call; and
 * a value bound once and set once. Every record's row is read before the
 * first call, so each call is given what its row held once locked, never
 * what an earlier call wrote to it -- what PostgreSQL's one call statement
 * passes, read under one snapshot -- and a row not found, which only a
 * trigger of the lock can have removed, refuses the run rather than leave
 * a variable at the record before's value: a SELECT that finds no row
 * assigns nothing. A parameter that counts code-page bytes is checked to
 * read back as it was given, as nvarchar, and the run refused, nothing
 * called, where it does not: SQL Server writes a character its code page
 * lacks as `?`, or its best fit, without an error, whether the text is an
 * answer, a context value or a column under a collation of another code
 * page (0159). A char's padding is no change. @given's columns take the
 * database's collation, as a variable does.
 */
function argumentsOf(parameters: Parameters, request: ActionRequest): Arguments {
  const declared: string[] = []
  const columns = ['[o] int not null primary key']
  const names = ['[o]']
  const read: string[] = []
  const assign: string[] = []
  const set: string[] = []
  const checks: string[] = []
  request.routine.arguments.forEach((argument: ActionArgument, index) => {
    if (!PARAMETER.test(argument.parameter)) throw new Error(`${argument.parameter} is not a parameter name an EXEC takes; no generator binds one.`)
    const variable = `@a${String(index)}`
    const type = declaredType(argument.typeId)
    declared.push(`declare ${variable} ${type};`)
    const trim = (text: string) => (argument.type.kind === 'text' && argument.type.fixedLength ? `rtrim(${text})` : text)
    const changed = `throw ${String(ARGUMENT_CHANGED)}, N'formancy: an argument did not reach its parameter as given: ${String(index)}', 1;`
    if (argument.from.kind === 'column') {
      const source = `${ROW}.${quoteName(argument.from.column)}`
      const held = `[a${String(index)}]`
      columns.push(`${held} ${type} null`)
      names.push(held)
      read.push(source)
      assign.push(`${variable} = ${held}`)
      if (countsCodePage(argument.type)) {
        const text = `[s${String(index)}]`
        columns.push(`${text} nvarchar(max) null`)
        names.push(text)
        read.push(`convert(nvarchar(max), ${source})`)
        checks.push(`if exists (select 1 from @given where not (${exactText(trim(`convert(nvarchar(max), ${held})`), trim(text))})) ${changed}`)
      }
      return
    }
    const bound = bindValue(parameters, argument.type, argument.from.value)
    set.push(`set ${variable} = ${bound};`)
    if (countsCodePage(argument.type)) {
      const given = `@s${String(index)}`
      declared.push(`declare ${given} nvarchar(max);`)
      set.push(`set ${given} = convert(nvarchar(max), ${bound});`)
      checks.push(`if not (${exactText(trim(`convert(nvarchar(max), ${variable})`), trim(given))}) ${changed}`)
    }
  })
  declared.push(`declare @given table (${columns.join(', ')});`)
  return {
    declared,
    read: (addressed) => [
      ...set,
      ...addressed.map(
        ({ position, keyed }) =>
          `insert @given (${names.join(', ')}) select ${[String(position), ...read].join(', ')} from ${quoteTable(request.target.table)} as ${ROW} where ${keyed.join(' and ')}; ` +
          `if @@rowcount <> 1 throw ${String(ARGUMENTS_UNREAD)}, N'${ARGUMENTS_UNREAD_MESSAGE}', 1;`,
      ),
      ...checks,
    ],
    given: (position) => (assign.length === 0 ? [] : [`select ${assign.join(', ')} from @given where [o] = ${String(position)};`]),
  }
}

/**
 * The positions of a request's records in the order the lock step takes
 * them (0165): by their keys, column by column -- a whole number by its
 * value, any other kind by its canonical text, code unit by code unit --
 * whatever order they were sent in, and two equal keys in the order sent.
 * Two runs over overlapping selections lock their common records in this
 * one order, so each waits for the other rather than deadlock on them. It
 * is the adapter's own total order, not the index's: a row is spelled one
 * way by every token a read returns, and two spellings a case-insensitive
 * collation makes one row sort apart, which the batch finds once both are
 * locked (`duplicateCheck`).
 */
export function lockOrder(records: ActionRequest['records']): number[] {
  const compare = (left: RecordValue, right: RecordValue): number => {
    if (left.value === right.value) return 0
    if (left.value === null) return -1
    if (right.value === null) return 1
    if (left.type.kind === 'integer') {
      const [a, b] = [BigInt(String(left.value)), BigInt(String(right.value))]
      return a < b ? -1 : a > b ? 1 : 0
    }
    const [a, b] = [String(left.value), String(right.value)]
    return a < b ? -1 : a > b ? 1 : 0
  }
  return records
    .map((_, index) => index)
    .sort((x, y) => {
      const [a, b] = [(records[x] as (typeof records)[number]).key, (records[y] as (typeof records)[number]).key]
      for (const [index, part] of a.entries()) {
        const order = compare(part, b[index] as RecordValue)
        if (order !== 0) return order
      }
      return x - y
    })
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

/** One record of the run as the batch names it: its position in the request, its key as bound, and where the lock finds it at its version. */
interface Addressed {
  position: number
  keyed: string[]
  where: string[]
}

/** What the lock step names: the root, its definition's digest, and the moved keys' columns -- each with the key column it is read from. */
interface LockParts {
  table: string
  root: string
  keys: Array<{ name: string; expression: string; column: string; type: NormalizedType }>
}

/**
 * Two keys of a selection that the database's own equality makes one row
 * (0165) -- `a` and `A` under a case-insensitive key collation -- found
 * once the lock step's UPDATEs ran, before any call, and THROWn naming
 * their positions: two that both moved the row, at two versions sent, by
 * the row's own spelling OUTPUT twice; and a record that moved nothing
 * whose key finds a row another record of the selection moved. The row
 * found is read WITH (NOLOCK): its key matches a row this transaction
 * moved, which it holds, so no lock is needed to see it, and a row it did
 * not move -- stale, perhaps held by another -- is no duplicate, and never
 * waited for. Every comparison is the exact one, code point by code point,
 * of canonical text (`exactText`).
 */
function duplicateCheck(request: ActionRequest, addressed: readonly Addressed[], parts: LockParts): string[] {
  const same = (left: string, right: (key: LockParts['keys'][number]) => string) =>
    parts.keys.map((key) => exactText(`${left}.${key.name}`, right(key))).join(' and ')
  const unmoved = addressed.map(
    ({ position, keyed }) =>
      `insert @twice ([o]) select [m].[o] from ${quoteTable(request.target.table)} as ${ROW} with (nolock) cross join @moved as [m] ` +
      `where ${keyed.join(' and ')} and not exists (select 1 from @moved where [o] = ${String(position)}) ` +
      `and ${same('[m]', (key) => canonicalText(key.type, `${ROW}.${quoteName(key.column)}`))}; ` +
      `if @@rowcount > 0 insert @twice ([o]) values (${String(position)});`,
  )
  return [
    `insert @twice ([o]) select [a].[o] from @moved as [a] join @moved as [b] on [a].[o] <> [b].[o] and ${same('[a]', (key) => `[b].${key.name}`)};`,
    `if (select count(*) from @moved) < ${String(addressed.length)}`,
    'begin',
    ...unmoved,
    'end;',
    'if exists (select 1 from @twice)',
    'begin',
    "  select @which = string_agg(convert(nvarchar(10), [o]), N',') within group (order by [o]) from (select distinct [o] from @twice) as [t];",
    `  set @which = N'${SELECTION_DUPLICATE_PREFIX}' + @which;`,
    `  throw ${String(SELECTION_DUPLICATE)}, @which, 1;`,
    'end;',
  ]
}

/**
 * The lock step: LOCK_TIMEOUT to `lockTimeoutMs`, then each record locked
 * and moved in one UPDATE WITH (UPDLOCK, HOLDLOCK) under its own `where`,
 * in `lockOrder`'s order, its keys and its position OUTPUT into @moved:
 * SQL Server does not promise the order in which one UPDATE locks the rows
 * it finds, and one UPDATE per record does. Then the checks a write's step
 * carries, the duplicates of a selection, every record moved or the
 * adapter's own error, and LOCK_TIMEOUT back to -1, the default: the
 * routine's own waits are bounded by the request's timeout alone.
 */
function lockStep(request: ActionRequest, addressed: readonly Addressed[], parts: LockParts, lockTimeoutMs: number): string[] {
  const { table, root, keys } = parts
  const updates = lockOrder(request.records).flatMap((position) => [
    `update ${ROW} set ${moveOf(request)} output ${String(position)}, ${keys.map((key) => key.expression).join(', ')} into @moved ([o], ${keys.map((key) => key.name).join(', ')}) ` +
      `from ${quoteTable(request.target.table)} as ${ROW} with (updlock, holdlock) where ${(addressed[position] as Addressed).where.join(' and ')};`,
    SAME_TRANSACTION,
  ])
  return [
    `set lock_timeout ${String(lockTimeoutMs)};`,
    'begin transaction;',
    'set @transaction = current_transaction_id();',
    `set @step = ${String(RUN_STEPS.lock)};`,
    ...updates,
    ...definitionGuard(table, root),
    insteadOfGuard(table, 'UPDATE'),
    `if exists (select [o] from @moved group by [o] having count(*) > 1) throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`,
    ...(addressed.length > 1 ? duplicateCheck(request, addressed, parts) : []),
    `if (select count(*) from @moved) < ${String(addressed.length)} throw ${String(ACTION_UNMOVED)}, N'${ACTION_UNMOVED_MESSAGE}', 1;`,
    'set lock_timeout -1;',
  ]
}

/**
 * The routine's guard, just before the EXEC: OBJECT_ID and the
 * definition's digest, then EXECUTE, as HAS_PERMS_BY_NAME answers it. A
 * 229 at the EXEC itself names the procedure in ERROR_PROCEDURE() as an
 * error inside it would, so it is not left to the EXEC. The digest comes
 * first: SQL Server shows an account only what it holds some permission
 * on, so a procedure whose only permission there was EXECUTE is, once that
 * is revoked, out of its sight as one dropped would be, and
 * HAS_PERMS_BY_NAME answers 0 for both (measured,
 * actions.integration.test.ts). Nothing the account can ask tells the two
 * apart, and the run answers both as the procedure gone, `schema-changed`,
 * as drift review would: the engines' difference ACTION_PARITY names.
 */
function guardStep(name: string, bound: string): string[] {
  return [
    `set @step = ${String(RUN_STEPS.guard)};`,
    `set @d = hashbytes('SHA2_256', ${routineFactsOf(name)});`,
    `if @d is null or @d <> ${bound} throw ${String(ROUTINE_MOVED)}, N'${ROUTINE_MOVED_MESSAGE}', 1;`,
    `if coalesce(has_perms_by_name(${name}, N'OBJECT', N'EXECUTE'), 0) <> 1 throw ${String(ROUTINE_DENIED)}, N'${ROUTINE_DENIED_MESSAGE}', 1;`,
  ]
}

/**
 * CATCH: the transaction rolled back, and what failed recorded in @failed,
 * which a rollback does not empty -- a procedure or a trigger that ended
 * the transaction as that, and the catalog not read, since what came
 * before it may have committed (0031); a statement of the lock step that
 * failed against a moved root as the move, as a write's is (0041).
 */
function catchBlock(table: string, root: string): string[] {
  const { set: moved, moved: rootMoved } = definitionMoved(table, root)
  return [
    'begin catch',
    ENDED,
    'if @@trancount > 0 rollback transaction;',
    `if ${ENDED_BY_ANOTHER_ERROR} insert @failed values (@step, ${String(TRANSACTION_ENDED)}, N'${TRANSACTION_ENDED_MESSAGE}', null, null);`,
    'else insert @failed values (@step, error_number(), error_message(), error_severity(), error_procedure());',
    `if @ended = 0 and @step = ${String(RUN_STEPS.lock)} begin ${moved} if ${rootMoved} insert @failed values (@step, ${String(DEFINITION_MOVED)}, N'${DEFINITION_MOVED_MESSAGE}', null, null); end;`,
    'end catch;',
  ]
}

/**
 * The batch of one run (0160), over one record or a selection (0165):
 *
 * 1. The lock step (`lockStep`): each record locked and moved under its
 *    key, the person's filters and every through -- each parent read WITH
 *    (HOLDLOCK), so held to the COMMIT -- at the version they read, the
 *    open version alone on a form over versions (0113), in key order; then
 *    the checks a write's step carries: the transaction still the batch's,
 *    the root's definition the one decided over (0041), no INSTEAD OF
 *    trigger, one row per record; two keys of a selection the database
 *    makes one row; and every record moved. None is the adapter's own
 *    error, THROWn, and explained by a read after.
 * 2. Every record's arguments, read from its locked row by its key before
 *    any call (`argumentsOf`), each found exactly once, and checked.
 * 3. For each record, in the order sent: the routine's guard
 *    (`guardStep`), OBJECT_ID and the definition's digest compared with
 *    the bundle's, then EXECUTE, just before its EXEC -- unlike the root's,
 *    not inside the statement it guards, and nothing closes the window
 *    between the two: the cost, which 0160 names; its arguments set from
 *    what step 2 read; and the EXEC, its status kept, then the transaction
 *    still the one the batch began -- a procedure that ended it may have
 *    committed (0031 P8), every record's version and the calls so far with
 *    it -- and a status other than 0 THROWn, so the batch rolls back,
 *    every record with it.
 * 4. The COMMIT, and CATCH (`catchBlock`).
 *
 * `expected` is each record's version, in the request's order. The
 * filters and every through are bound once and named by every record's
 * statements, and each record's key once, named by its UPDATE, its
 * duplicate check and its arguments' read.
 */
export function runBatch(
  request: ActionRequest,
  terms: readonly RowFilterTerm[],
  through: readonly ThroughTerms[],
  expected: readonly ExpectedVersion[],
  definition: Buffer,
  routine: Buffer,
  lockTimeoutMs: number,
): Statement {
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1) throw new TypeError('A lock timeout is a whole number of milliseconds above 0.')
  if (expected.length !== request.records.length) throw new Error('A run binds one version for each record it addresses.')
  const parameters = new Parameters()
  const { target } = request
  const scoped = [...filterPredicates(parameters, terms), ...through.map((entry) => throughPredicate(parameters, entry, true))]
  const open = request.open === undefined ? [] : [`${column(request.open)} is null`]
  const addressed: Addressed[] = request.records.map((record, position) => {
    const keyed = keyPredicates(parameters, record.key)
    return { position, keyed, where: [...keyed, ...scoped, versionIs(parameters, target.concurrency, expected[position] as ExpectedVersion), ...open] }
  })
  const keys = target.identity.map((entry, index) => ({
    name: `[k${String(index)}]`,
    expression: canonicalText(entry.type, `inserted.${quoteName(entry.name)}`),
    column: entry.name,
    type: entry.type,
  }))
  const table = tableName(parameters, target.table)
  const root = parameters.add(mssql.VarBinary(32), definition)
  const name = routineName(parameters, request.routine.ref)
  const bound = parameters.add(mssql.VarBinary(32), routine)
  const args = argumentsOf(parameters, request)
  const exec = request.routine.arguments.map((argument, index) => `${argument.parameter} = @a${String(index)}`)
  const calls = addressed.flatMap(({ position }) => [
    ...guardStep(name, bound),
    `set @step = ${String(RUN_STEPS.arguments)};`,
    ...args.given(position),
    `set @step = ${String(RUN_STEPS.call)};`,
    `exec @status = ${quoteTable({ schema: request.routine.ref.schema, name: request.routine.ref.name })}${exec.length === 0 ? '' : ` ${exec.join(', ')}`};`,
    SAME_TRANSACTION,
    `if @status <> 0 throw ${String(ROUTINE_STATUS)}, N'${ROUTINE_STATUS_MESSAGE}', 1;`,
  ])
  const sql = [
    'set nocount on;',
    'set xact_abort on;',
    'declare @step int = 0, @transaction bigint, @status int, @ended bit, @d varbinary(32), @which nvarchar(2048);',
    'declare @failed table ([step] int, [number] int, [message] nvarchar(4000), [severity] int, [procedure] nvarchar(128));',
    `declare @moved table ([o] int, ${keys.map((key) => `${key.name} nvarchar(max)`).join(', ')});`,
    'declare @twice table ([o] int);',
    ...args.declared,
    'begin try',
    ...lockStep(request, addressed, { table, root, keys }, lockTimeoutMs),
    `set @step = ${String(RUN_STEPS.arguments)};`,
    ...args.read(addressed),
    ...calls,
    `set @step = ${String(RUN_STEPS.commit)};`,
    'commit transaction;',
    'end try',
    ...catchBlock(table, root),
    'select [step], [number], [message], [severity], [procedure] from @failed;',
    `select ${keys.map((key) => key.name).join(', ')}, [o] from @moved order by [o];`,
  ].join('\n')
  return parameters.statement(sql)
}
