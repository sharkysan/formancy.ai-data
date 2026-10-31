import type { InsertRequest, RowFilterTerm, SupersedeRequest, ThroughTerms } from '@formancy/data-core'
import { op } from '../sql/catalog.js'
import { quoteIdentifier, quoteTable } from '../sql/identifiers.js'
import { Statement } from '../sql/statement.js'
import type { Definition } from './definition.js'
import { bound, column, freshSql, guard, located, outputs, ROW, versionIs } from './sql.js'
import type { RecordStatement, WritePath } from './sql.js'

/*
 * A table of versions (0113) on PostgreSQL: the chain a create starts, and
 * the change from a date that ends the open version and inserts the next.
 */

/** The CTE that ends the open version, and the one that inserts the next. */
const ENDED = '"e"'
const NEXT = '"n"'

/** Whether no row has the chain's key a create wrote, now: after a create of a chain that inserted nothing, `'false'` where the chain was there. */
export function freshStatement(request: InsertRequest): RecordStatement {
  const statement = new Statement()
  return { text: `select (${freshSql(statement, request) as string})::pg_catalog.text`, params: statement.params }
}

/**
 * A change from a date as one statement (0113): a data-modifying CTE that
 * ends the open version -- under the key, the trusted filters, every
 * through, the version read, an end still NULL and the definition, as an
 * update is guarded (0015, 0041), its version moved by one -- and an INSERT
 * of the next version that selects from the row ended: the chain's key as
 * that row holds it, the start, the values. Nothing ended, nothing inserted.
 *
 * The SELECT over both is the statement's own check, as the delete's is
 * (delete.ts): its scalar subquery returns one row for each version ended
 * and one more when a version was ended and none inserted -- a trigger or a
 * rule that declined the insert -- and two rows fail it with 21000, which
 * undoes the whole statement. So the chain is never left with its open
 * version ended and no next one, and an identity that is not a key ends
 * nothing rather than several rows. `one` is NULL when nothing was ended;
 * the next version's columns follow it, as `outputs` writes them.
 */
export function supersedeStatement(
  request: SupersedeRequest,
  terms: readonly RowFilterTerm[],
  through: readonly ThroughTerms[],
  definition: Definition,
  path: WritePath,
): RecordStatement {
  const statement = new Statement()
  const table = request.target.table
  const version = request.target.concurrency.column
  const set = [`${quoteIdentifier(request.ends)} = ${bound(statement, request.start)}`, `${quoteIdentifier(version)} = ${column(version)} ${op('+')} 1`]
  const where = [
    ...located(statement, request.key, terms, through),
    versionIs(statement, request),
    `${column(request.ends)} is null`,
    ...guard(statement, table, definition, path),
  ]
  const names = [...request.chain.map((entry) => entry.name), request.start.name, ...request.values.map((value) => value.name)]
  const selected = [
    ...request.chain.map((entry) => `${ENDED}.${quoteIdentifier(entry.name)}`),
    bound(statement, request.start),
    ...request.values.map((value) => bound(statement, value)),
  ]
  const text = [
    `with ${ENDED} as (`,
    `update ${quoteTable(table)} as ${ROW}`,
    `set ${set.join(', ')}`,
    `where ${where.join(' and ')}`,
    `returning ${request.chain.map((entry) => column(entry.name)).join(', ')}`,
    `), ${NEXT} as (`,
    `insert into ${quoteTable(table)} as ${ROW} (${names.map(quoteIdentifier).join(', ')})`,
    `select ${selected.join(', ')} from ${ENDED}`,
    `returning ${outputs(request.target, request.returning).join(', ')}`,
    ')',
    `select (select true from ${ENDED} union all select true from ${ENDED} where not exists (select from ${NEXT}))::pg_catalog.text as "one", ${NEXT}.*`,
    `from (select) as "g" left join ${NEXT} on true`,
  ].join('\n')
  return { text, params: statement.params }
}
