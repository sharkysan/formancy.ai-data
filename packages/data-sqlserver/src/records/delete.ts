import type { DeleteRequest, DeleteTerms, ObjectRef, ReachTerms } from '@formancy/data-core'
import mssql from 'mssql'
import { DENIED_OBJECTS, DENIED_SCHEMAS, VIEWS_DATABASE } from '../discovery/visibility.js'
import { quoteTable } from '../sql/quote.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'
import {
  located,
  NOT_ONE_ROW,
  NOT_ONE_ROW_MESSAGE,
  REACH_MOVED,
  REACH_MOVED_MESSAGE,
  REACH_UNDELETABLE,
  REACH_UNDELETABLE_MESSAGE,
  ROW,
  selection,
  tableName,
  versionIs,
  writeBatch,
} from './statements.js'
import type { ExpectedVersion } from './statements.js'

/*
 * The delete of one record on SQL Server (0050): one statement in the write
 * batch every write runs in, checked after it and before the commit.
 */

/** sys.foreign_keys' `delete_referential_action` for each action a delete acts through. */
const ACTION_CODES: Readonly<Record<ReachTerms['accepted'][number]['onDelete'], number>> = { cascade: 1, 'set-null': 2, 'set-default': 3 }

/** A table's name as `object_id` and HAS_PERMS_BY_NAME read it: quoted, and bound. */
const named = (parameters: Parameters, table: ObjectRef): string => tableName(parameters, table)

/**
 * Whether the account still sees every key that refers to a table the delete
 * reaches, and every key that acts on it is one the reach accepts, as a
 * statement that raises 51707 when either fails (0050, 0051). The planner
 * refuses a grant over any other key by the snapshot (`deleteProblems`);
 * this is the same rule asked of the catalog inside the delete's
 * transaction, so a key added after the form was published is refused
 * there, and whatever its cascade did is rolled back with it.
 *
 * A key that acts on delete -- cascades, sets NULL or sets a default --
 * onto a table the delete removes rows of is accepted only as the reach
 * names it: the table it is on, its name, the table it refers to and its
 * action, the name compared under Latin1_General_100_BIN2, never under the
 * database's collation. A key that refers to a column the delete clears and
 * acts ON UPDATE would carry the change on, and is refused whatever it is.
 *
 * Run after the statement, under its locks: ADD FOREIGN KEY ... REFERENCES
 * a table needs a schema-modification lock, which waits for this
 * transaction. An edge constraint that cascades acts on a delete of a node
 * as such a key does, from either end of each of its clauses (0049, P2b),
 * and sys.foreign_keys does not list it, so sys.edge_constraints is read
 * too; none is ever accepted, since the snapshot names one only as a gap.
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
export function reachGuard(parameters: Parameters, reach: ReachTerms): string {
  const removed = reach.removed.map((table) => `object_id(${named(parameters, table)})`).join(', ')
  const accepted =
    reach.accepted.length === 0
      ? ''
      : ` and not exists (select 1 from (values ${reach.accepted
          .map(
            (key) =>
              `(${named(parameters, key.from)}, ${parameters.add(mssql.NVarChar(mssql.MAX), key.name)}, ${named(parameters, key.onto)}, ${parameters.add(mssql.TinyInt, ACTION_CODES[key.onDelete])})`,
          )
          .join(', ')}) as [a]([from], [key], [onto], [action])
      where [k].[parent_object_id] = object_id([a].[from]) and [k].[name] = [a].[key] collate Latin1_General_100_BIN2
        and [k].[referenced_object_id] = object_id([a].[onto]) and [k].[delete_referential_action] = [a].[action])`
  const cleared = reach.cleared.flatMap(({ table, columns }) =>
    columns.map((column) => `(${named(parameters, table)}, ${parameters.add(mssql.NVarChar(mssql.MAX), column)})`),
  )
  const followed =
    cleared.length === 0
      ? []
      : [
          `  or exists (select 1 from sys.foreign_keys as [k] join sys.foreign_key_columns as [c] on [c].[constraint_object_id] = [k].[object_id]`,
          `    join (values ${cleared.join(', ')}) as [x]([table], [column]) on [k].[referenced_object_id] = object_id([x].[table])`,
          `      and col_name([c].[referenced_object_id], [c].[referenced_column_id]) = [x].[column] collate Latin1_General_100_BIN2`,
          `    where [k].[update_referential_action] <> 0)`,
        ]
  return [
    `if coalesce(${VIEWS_DATABASE}, 0) <> 1`,
    `  or exists (select 1 from sys.database_permissions p where ${DENIED_OBJECTS})`,
    `  or exists (select 1 from sys.database_permissions p where ${DENIED_SCHEMAS})`,
    `  or exists (select 1 from sys.foreign_keys as [k] where [k].[referenced_object_id] in (${removed}) and [k].[delete_referential_action] <> 0${accepted})`,
    `  or exists (select 1 from sys.edge_constraints as [ec] join sys.edge_constraint_clauses as [cl] on [cl].[object_id] = [ec].[object_id]`,
    `    where ([cl].[from_object_id] in (${removed}) or [cl].[to_object_id] in (${removed})) and [ec].[delete_referential_action] <> 0)`,
    ...followed,
    `  throw ${String(REACH_MOVED)}, N'${REACH_MOVED_MESSAGE}', 1;`,
  ].join('\n')
}

/**
 * Whether the account may DELETE from every table past the root the delete
 * reaches, as a statement that raises 51708 when it may not (0051). SQL
 * Server asks the deleting account nothing of the tables a cascade or a SET
 * NULL reaches -- no grant, and a DENY there does not stop it: measured on
 * 16.0.4295.3, 2026-10-12 (0051 P5) -- so the batch asks, and a delete is held
 * to what its account could have deleted directly, as PostgreSQL's lock holds
 * it. HAS_PERMS_BY_NAME applies grants, denies and their precedence; NULL,
 * for a name it cannot resolve, is a refusal. The root's own DELETE is the
 * statement's to refuse, 229, before anything here runs.
 */
export function reachDeletable(parameters: Parameters, reach: ReachTerms): string[] {
  const past = [...reach.removed.slice(1), ...reach.cleared.map((entry) => entry.table)]
  if (past.length === 0) return []
  const tables = past.map((table) => `(${named(parameters, table)})`).join(', ')
  return [
    `if exists (select 1 from (values ${tables}) as [t]([table]) where coalesce(has_perms_by_name([t].[table], N'OBJECT', N'DELETE'), 0) <> 1)`,
    `  throw ${String(REACH_UNDELETABLE)}, N'${REACH_UNDELETABLE_MESSAGE}', 1;`,
  ]
}

/**
 * ONE guarded delete (0050): the key, the trusted filters, every through and
 * the expected version in a single WHERE, in the write batch, so nothing can
 * change between the check and the delete and nothing it did outlives a
 * check that fails. OUTPUT ... INTO the batch's table variable returns the
 * key and the version the row was deleted at, the root's row alone -- not a
 * row a cascade deleted, measured (0051 P5); an AFTER DELETE trigger runs
 * before the checks, and what it does is the database's (0050). After the
 * statement, in order: the transaction is still the batch's, the definition
 * is the one the delete was decided over (0041), no INSTEAD OF DELETE
 * trigger decided it, the reach is what the delete was decided over and
 * visible (`reachGuard`), the account may delete from every table of it
 * (`reachDeletable`, 0051), and one row or none was deleted -- more is an
 * identity that is not a key, and the batch rolls back rather than delete
 * several.
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
    afterWrite: [
      reachGuard(parameters, terms.reach),
      ...reachDeletable(parameters, terms.reach),
      `if @rows > 1 throw ${String(NOT_ONE_ROW)}, N'${NOT_ONE_ROW_MESSAGE}', 1;`,
    ],
  })
  return parameters.statement(sql)
}
