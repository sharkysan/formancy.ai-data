import type { DeleteRequest, DeleteTerms } from '@formancy/data-core'
import { DENIED_OBJECTS, DENIED_SCHEMAS, VIEWS_DATABASE } from '../discovery/visibility.js'
import { quoteTable } from '../sql/quote.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import { located, NOT_ONE_ROW, NOT_ONE_ROW_MESSAGE, REACH_MOVED, REACH_MOVED_MESSAGE, ROW, selection, tableName, versionIs, writeBatch } from './statements.js'
import type { ExpectedVersion } from './statements.js'

/*
 * The delete of one record on SQL Server (0050): one statement in the write
 * batch every write runs in, checked after it and before the commit.
 */

/**
 * Whether the account still sees every key that refers to the table, and
 * none that acts on a delete from it -- cascades, sets NULL or sets a
 * default -- refers to it, as a statement that raises 51707 when either
 * fails (0050). In 0050 a delete reaches nothing past its record, and the
 * planner refuses a grant over such a key by the snapshot
 * (`deleteProblems`); this is the same rule asked of the catalog inside the
 * delete's transaction, so a key added after the form was published is
 * refused there, and whatever its cascade did is rolled back with it.
 *
 * Run after the statement, under its locks: ADD FOREIGN KEY ... REFERENCES
 * the table needs a schema-modification lock on it, which waits for this
 * transaction. An edge constraint that cascades acts on a delete of a node
 * as such a key does, from either end of each of its clauses (0049, P2b),
 * and sys.foreign_keys does not list it, so sys.edge_constraints is read
 * too; one added after the snapshot is refused as a key is.
 *
 * SQL Server lists a key only to an account that may see the table the key
 * is on (0049, P2), so the catalog alone could miss one. The account sees
 * every key exactly under discovery's own conditions for a snapshot without
 * a `referenced-by` gap -- VIEW DEFINITION on the database, and no VIEW
 * DEFINITION or CONTROL deny on an object or a schema that binds it --
 * shared from `visibility.ts`, so the guard and the gap cannot disagree; an
 * account that lost either since its snapshot is refused, whether or not a
 * key is hidden from it. A disabled key is counted: enabled again, it acts
 * without anything here noticing. sys.foreign_keys is read by the
 * referenced object's id through an index seek (measured on 16.0.4295.3,
 * 2026-10-11, P8); the edge constraints' plan and cost are not measured.
 */
export function reachGuard(table: string): string {
  return [
    `if coalesce(${VIEWS_DATABASE}, 0) <> 1`,
    `  or exists (select 1 from sys.database_permissions p where ${DENIED_OBJECTS})`,
    `  or exists (select 1 from sys.database_permissions p where ${DENIED_SCHEMAS})`,
    `  or exists (select 1 from sys.foreign_keys as [k] where [k].[referenced_object_id] = object_id(${table}) and [k].[delete_referential_action] <> 0)`,
    `  or exists (select 1 from sys.edge_constraints as [ec] join sys.edge_constraint_clauses as [cl] on [cl].[object_id] = [ec].[object_id]`,
    `    where object_id(${table}) in ([cl].[from_object_id], [cl].[to_object_id]) and [ec].[delete_referential_action] <> 0)`,
    `  throw ${String(REACH_MOVED)}, N'${REACH_MOVED_MESSAGE}', 1;`,
  ].join('\n')
}

/**
 * ONE guarded delete (0050): the key, the trusted filters, every through and
 * the expected version in a single WHERE, in the write batch, so nothing can
 * change between the check and the delete and nothing it did outlives a
 * check that fails. OUTPUT ... INTO the batch's table variable returns the
 * key and the version the row was deleted at; an AFTER DELETE trigger runs
 * before the checks, and what it does is the database's (0050). After the
 * statement, in order: the transaction is still the batch's, the
 * definition is the one the delete was decided over (0041), no INSTEAD OF
 * DELETE trigger decided it, the reach is the root's alone and visible
 * (`reachGuard`), and one row or none was deleted -- more is an identity
 * that is not a key, and the batch rolls back rather than delete several.
 */
export function deleteStatement(request: DeleteRequest, terms: DeleteTerms, expected: ExpectedVersion, definition: Buffer): Statement {
  const parameters = new Parameters()
  const { target } = request
  const where = [...located(parameters, terms.key, terms.terms, terms.through), versionIs(parameters, target.concurrency, expected)]
  const sql = writeBatch(parameters, {
    target,
    definition,
    operation: 'DELETE',
    statement: (output) => `delete ${ROW} ${output} from ${quoteTable(terms.root)} as ${ROW} where ${where.join(' and ')}`,
    assigned: [],
    returned: selection(target.identity, target.concurrency, 'deleted.'),
    afterWrite: [reachGuard(tableName(parameters, terms.root)), `if @rows > 1 throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`],
  })
  return parameters.statement(sql)
}
