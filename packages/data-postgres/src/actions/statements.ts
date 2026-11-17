import type { ActionArgument, ActionRequest, RecordValue, RoutineRef, RowFilterTerm, ThroughTerms } from '@formancy/data-core'
import { ROUTINE_TYPES } from '../discovery/routines.js'
import { digestOf } from '../records/definition.js'
import type { Definition } from '../records/definition.js'
import { column, guard, located, ROW, versionIs } from '../records/sql.js'
import type { RecordStatement, WritePath } from '../records/sql.js'
import { op } from '../sql/catalog.js'
import { quoteIdentifier, quoteTable } from '../sql/identifiers.js'
import { Statement } from '../sql/statement.js'
import { bindText, canonicalText } from '../sql/values.js'
import { currentDefinitionOf, routineFactsOf } from './definition.js'
import type { RoutineDefinition } from './definition.js'

/*
 * The statements of an action's run on PostgreSQL (0160): the statement
 * timeout, the lock that moves each record's version, and the call. Every
 * identifier is approved metadata and quoted here; every value is bound,
 * but the timeout, which SET takes no parameter for. Two statements, not
 * one with the call in a third CTE: a routine that writes the record must
 * find it already moved in its own transaction, which one statement would
 * hide from it.
 */

/**
 * The run's statement timeout, `ms` of its deadline (0160): spliced,
 * because SET takes no bind parameter, from a whole number the caller
 * checked, and SET LOCAL, which ends with the transaction and takes no
 * snapshot. It bounds each statement from the moment the server starts it,
 * a wait for a lock included, never the round trips between them.
 */
export function timeoutStatement(ms: number): RecordStatement {
  if (!Number.isSafeInteger(ms) || ms < 1) throw new TypeError('A statement timeout is a whole number of milliseconds above 0.')
  return { text: `set local statement_timeout = ${String(ms)}`, params: [] }
}

/**
 * The type an argument is cast to: its parameter's, by the oid the snapshot
 * recorded, spelled from the adapter's closed table (0158) and from nothing
 * else. A type outside it is a programming error: the generator binds no
 * routine with one.
 */
export function castOf(typeId: string): string {
  const name = /^[0-9]+$/.test(typeId) ? ROUTINE_TYPES.get(Number(typeId)) : undefined
  if (name === undefined) throw new Error(`A parameter of type oid ${typeId} is not one this adapter casts an argument to; no generator binds one.`)
  return `pg_catalog.${name}`
}

/** The column the lock returns last: the positions of the records a locked row answers to, as an array's text. */
const POSITIONS = `"l".${quoteIdentifier('o')}`

/**
 * Lock the records and move their versions (0160), as one statement: each
 * record by its key -- one, or every record of a selection (0165) --
 * inside the person's filters and every through -- each
 * through's parent locked FOR SHARE, so a move of the parent to another
 * tenant waits for the run, where FOR KEY SHARE would let an UPDATE that
 * leaves the parent's key alone through -- at the version its person read,
 * the open version alone on a form over versions (0113), and only while
 * the root has the definition the run was decided over (0041). The rows
 * are locked FOR NO KEY UPDATE in key order, PostgreSQL's locking after its
 * sort (measured, actions.integration.test.ts), so two runs over
 * overlapping selections take their common rows in one order whatever
 * order each was sent in, and the version moved by one in the same
 * statement. Only each moved row's key, as canonical text, its version,
 * and the positions in the request of the records whose key it equals
 * come back, in an order PostgreSQL does not promise: the positions
 * compared by the key's own equality, as the lock found the row, so a row
 * two keys of a selection name -- two spellings a nondeterministic
 * collation makes one, or two numerics of one value -- carries both, and
 * a record is never told from its row by how either is spelled (0165).
 */
export function lockStatement(
  request: ActionRequest,
  terms: readonly RowFilterTerm[],
  through: readonly ThroughTerms[],
  definition: Definition,
  path: WritePath,
): RecordStatement {
  const { target, move } = request
  if (move.kind !== 'increment' || move.column !== target.concurrency.column)
    throw new Error('PostgreSQL has no rowversion: a run moves the version column it is guarded by.')
  const statement = new Statement()
  const keys = target.identity.map((entry) => column(entry.name))
  const records = request.records.map((record) => {
    const where = [...located(statement, record.key, terms, through, true), versionIs(statement, { target, expectedVersion: record.expectedVersion })]
    return `(${where.join(' and ')})`
  })
  const where = [`(${records.join(' or ')})`, ...(request.open === undefined ? [] : [`${column(request.open)} is null`])]
  where.push(...guard(statement, target.table, definition, path))
  const named = request.records.map((record, position) => `case when ${located(statement, record.key, [], []).join(' and ')} then ${String(position)} end`)
  // Every column of "locked" named here, so no column of the table can take a name it uses.
  const held = target.identity.map((entry, index) => `${column(entry.name)} as ${quoteIdentifier(`k${String(index)}`)}`)
  const joined = target.identity.map((entry, index) => `${column(entry.name)} ${op('=')} "l".${quoteIdentifier(`k${String(index)}`)}`)
  const returned = [
    ...target.identity.map((entry) => canonicalText(entry.type, column(entry.name))),
    `${column(move.column)}::pg_catalog.text`,
    `${POSITIONS}::pg_catalog.text`,
  ]
  const text = [
    `with "locked" as materialized (`,
    `  select ${held.join(', ')}, pg_catalog.array_remove(array[${named.join(', ')}], null) as ${quoteIdentifier('o')}`,
    `  from ${quoteTable(target.table)} as ${ROW}`,
    `  where ${where.join(' and ')}`,
    `  order by ${keys.join(', ')}`,
    `  for no key update of ${ROW}`,
    `)`,
    `update ${quoteTable(target.table)} as ${ROW}`,
    `set ${quoteIdentifier(move.column)} = ${column(move.column)} ${op('+')} 1`,
    `from "locked" as "l"`,
    `where ${joined.join(' and ')}`,
    `returning ${returned.join(', ')}`,
  ].join('\n')
  return { text, params: statement.params }
}

/** The derived table the call's bound values are read from, so none reaches the routine as a constant. */
const GIVEN = '"v"'

/**
 * One argument in the call, cast to its parameter's type: a column of the
 * locked row, which never leaves the database, or a bound canonical value,
 * read from the derived table `GIVEN` and added to `given` as its column.
 */
function argumentSql(statement: Statement, argument: ActionArgument, given: string[]): string {
  const cast = castOf(argument.typeId)
  if (argument.from.kind === 'column') return `${column(argument.from.column)}::${cast}`
  const name = quoteIdentifier(`v${String(given.length)}`)
  given.push(`${statement.as(bindText(argument.from.value, argument.type), cast)} as ${name}`)
  return `${GIVEN}.${name}`
}

/** The routine as a call names it: its schema and name, each quoted. */
function routineName(ref: RoutineRef): string {
  return `${quoteIdentifier(ref.schema)}.${quoteIdentifier(ref.name)}`
}

/**
 * The call, once per moved record (0160): the routine by name with every
 * argument named -- quoted, as PostgreSQL's named notation allows -- and
 * cast to its bound type, so the only exact match is the bound signature
 * and an overload made after publication is never the better one; over the
 * moved rows, by their keys; and only while the routine the bound
 * signature resolves to has the definition the run was decided over, an
 * uncorrelated condition that is read before any row is: its facts'
 * digest, and on the locked path (0041) its whole definition's as the
 * catalog cache holds it, which the transaction's older snapshot does not
 * hide (definition.ts). A routine dropped and created again, or changed in
 * place, gives no row and no call; the guard holds exactly as far as the
 * root's does in one statement, no further. One row comes back for each
 * call.
 *
 * Every bound value reaches the routine through a derived table the
 * planner keeps (`offset 0`), never as a constant: PostgreSQL evaluates an
 * IMMUTABLE function whose arguments are all constants while it plans the
 * statement, before any guard is read, and a custom plan makes a bound
 * value one (measured, actions.integration.test.ts). A routine with no
 * parameter has no argument to keep so, and is the cost 0160 names.
 */
export function callStatement(
  request: ActionRequest,
  moved: ReadonlyArray<readonly RecordValue[]>,
  routine: RoutineDefinition,
  path: WritePath,
): RecordStatement {
  const statement = new Statement()
  const { ref } = request.routine
  const given: string[] = []
  const args = request.routine.arguments.map((argument) => `${quoteIdentifier(argument.parameter)} => ${argumentSql(statement, argument, given)}`)
  const rows = moved.map((key) => `(${located(statement, key, [], []).join(' and ')})`)
  const guarded = [`${digestOf(routineFactsOf(statement, ref))} ${op('=')} ${statement.text(routine.facts)}`]
  if (path === 'locked') guarded.push(`${digestOf(currentDefinitionOf(statement, ref))} ${op('=')} ${statement.text(routine.current)}`)
  const text = [
    `select ${routineName(ref)}(${args.join(', ')})`,
    `from ${quoteTable(request.target.table)} as ${ROW}`,
    ...(given.length === 0 ? [] : [`cross join (select ${given.join(', ')} offset 0) as ${GIVEN}`]),
    `where (${rows.join(' or ')}) and ${guarded.join(' and ')}`,
  ].join('\n')
  return { text, params: statement.params }
}
