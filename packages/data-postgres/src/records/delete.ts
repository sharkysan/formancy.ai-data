import type { DeleteRequest, DeleteTerms, ObjectRef, ReachTerms } from '@formancy/data-core'
import { DECLARED_FOREIGN_KEY } from '../discovery/foreign-keys.js'
import { op } from '../sql/catalog.js'
import { quoteTable } from '../sql/identifiers.js'
import { Statement } from '../sql/statement.js'
import { canonicalText } from '../sql/values.js'
import { digestOf, factsOf, ISOLATION } from './definition.js'
import type { Definition } from './definition.js'
import { column, guard, located, ROW, selectFrom, versionIs } from './sql.js'
import type { RecordStatement, WritePath } from './sql.js'

/*
 * The delete of one record on PostgreSQL (0050): one guarded statement, and
 * the statement that tells why it deleted nothing.
 */

/** pg_constraint's code for each action a delete acts through. */
const ACTION_CODES: Readonly<Record<ReachTerms['accepted'][number]['onDelete'], string>> = { cascade: 'c', 'set-null': 'n', 'set-default': 'd' }

/** `tables` as the relations they name and every relation below each -- partitions at any depth, tables that inherit -- with `extra` carried along: a recursive CTE's two halves. */
function below(statement: Statement, name: string, tables: ReadonlyArray<{ table: ObjectRef; extra?: string }>): string {
  const carried = tables.some((entry) => entry.extra !== undefined)
  const rows = tables.map(
    ({ table, extra }) => `(${statement.text(table.schema)}, ${statement.text(table.name)}${carried ? `, ${statement.text(extra ?? null)}` : ''})`,
  )
  return `"${name}"("relid"${carried ? ', "extra"' : ''}) as (
      select c.oid${carried ? ', "t"."extra"' : ''}
      from (values ${rows.join(', ')}) as "t"("schema", "name"${carried ? ', "extra"' : ''})
      join pg_catalog.pg_namespace n on n.nspname ${op('=')} "t"."schema"
      join pg_catalog.pg_class c on c.relnamespace ${op('=')} n.oid and c.relname ${op('=')} "t"."name"
      union
      select i.inhrelid${carried ? ', "' + name + '"."extra"' : ''} from pg_catalog.pg_inherits i join "${name}" on i.inhparent ${op('=')} "${name}"."relid"
    )`
}

/**
 * Whether every declared foreign key that acts on delete -- cascades, sets
 * NULL or sets a default -- onto a table the delete removes rows of, or onto
 * any relation below one, is a key the reach accepts, by the table it is on,
 * its name, the table it refers to and its action; and whether no key
 * follows a column the delete clears by an ON UPDATE that acts (0050, 0051).
 * The planner refuses a grant over any other by the snapshot
 * (`deleteProblems`); this is the same rule asked of the catalog in the
 * statement, so a key added after the form was published is refused there
 * rather than followed.
 *
 * Every table is found by its bound names, as the definition's facts find
 * it; no identifier is spliced. Every declared key is read, its triggers
 * enabled or not: a key one of whose triggers is disabled may still act,
 * and one enabled again acts with nothing here noticing (0049).
 * `DECLARED_FOREIGN_KEY` is discovery's own condition, so the clones
 * PostgreSQL makes onto each partition of a partitioned table are not read
 * twice. Below each table -- its partitions at any depth, and the tables
 * that inherit from it -- because a key that names one of them acts on the
 * rows a delete from the table removes there (0049, P2b), and the snapshot
 * names those only as a gap; such a key is never one the reach accepts,
 * which names the table itself.
 *
 * Complete for a key added onto any table of the reach: ADD FOREIGN KEY
 * ... REFERENCES a relation needs SHARE ROW EXCLUSIVE on it, which
 * conflicts with ROW EXCLUSIVE, so such a key either committed before the
 * statement's snapshot, and is read here, or waits until the delete ends --
 * because the delete holds that lock on every table it reaches before its
 * snapshot. On the root alone a statement takes it itself under READ
 * COMMITTED; past it, a cascade opens each table only after the snapshot,
 * so a delete that reaches past its root locks every table first
 * (`reachLockStatement`), and one that reaches only its root locks it with
 * every relation below it on the locked path (0050). The `reach-moved`
 * cases hold both orders, on both paths; a key onto an inheritance child,
 * and a partition attached while the delete waits, are not tested (0050).
 * pg_constraint has no index on confrelid: measured on postgres:17-alpine
 * (17.11), 2026-10-11 (P8), the lookup is a sequential scan of
 * pg_constraint, which held 124 rows in that database -- a cost per delete
 * that grows with the constraints of the whole database, not measured past
 * that.
 */
export function reachClear(statement: Statement, reach: ReachTerms): string {
  const accepted =
    reach.accepted.length === 0
      ? ''
      : `
      and not exists (
        select from (values ${reach.accepted
          .map(
            (key) =>
              `(${[key.from.schema, key.from.name, key.name, key.onto.schema, key.onto.name, ACTION_CODES[key.onDelete]].map((value) => statement.text(value)).join(', ')})`,
          )
          .join(', ')}) as "a"("from_schema", "from_name", "key", "onto_schema", "onto_name", "action")
        join pg_catalog.pg_namespace fn on fn.nspname ${op('=')} "a"."from_schema"
        join pg_catalog.pg_class f on f.relnamespace ${op('=')} fn.oid and f.relname ${op('=')} "a"."from_name"
        join pg_catalog.pg_namespace tn on tn.nspname ${op('=')} "a"."onto_schema"
        join pg_catalog.pg_class t on t.relnamespace ${op('=')} tn.oid and t.relname ${op('=')} "a"."onto_name"
        where k.conrelid ${op('=')} f.oid and k.conname ${op('=')} "a"."key" and k.confrelid ${op('=')} t.oid and k.confdeltype ${op('=')} "a"."action"::pg_catalog."char"
      )`
  const removed = `not exists (
    with recursive ${below(
      statement,
      'removed',
      reach.removed.map((table) => ({ table })),
    )}
    select from pg_catalog.pg_constraint k
    join "removed" on k.confrelid ${op('=')} "removed"."relid"
    where ${DECLARED_FOREIGN_KEY} and k.confdeltype ${op('=')} any ('{c,n,d}'::pg_catalog."char"[])${accepted}
  )`
  if (reach.cleared.length === 0) return removed
  const cleared = reach.cleared.flatMap(({ table, columns }) => columns.map((extra) => ({ table, extra })))
  return `${removed} and not exists (
    with recursive ${below(statement, 'cleared', cleared)}
    select from pg_catalog.pg_constraint k
    join "cleared" on k.confrelid ${op('=')} "cleared"."relid"
    join pg_catalog.pg_attribute a on a.attrelid ${op('=')} k.confrelid and a.attnum ${op('=')} any (k.confkey) and a.attname ${op('=')} "cleared"."extra"
    where ${DECLARED_FOREIGN_KEY} and k.confupdtype ${op('=')} any ('{c,n,d}'::pg_catalog."char"[])
  )`
}

/**
 * Whether the account may DELETE from every table past the root a delete
 * reaches -- every other table it removes rows of, and every table it
 * clears a reference in -- or nothing, for a delete that reaches no further
 * than its root, whose own DELETE the statement asks itself (0051).
 *
 * PostgreSQL asks the deleting account nothing of those tables: a cascade
 * or a SET NULL runs as the referring table's owner (0051 P5). And the ROW
 * EXCLUSIVE lock the delete takes on each first is granted with any grant
 * to write it, not DELETE alone -- measured on postgres:17-alpine (17.11),
 * 2026-10-12: with INSERT on a cascaded table and DELETE revoked, the lock
 * was taken and the cascade deleted its rows. So the statement asks:
 * `has_table_privilege` reads the current user's grants as a DELETE from
 * the table would, roles it inherits included, and a table the bound names
 * no longer find is a refusal too. Asked by the statement, under the lock;
 * the follow-up after no row asks the same, so the refusal is
 * `permission-denied` with nothing deleted, as SQL Server's 51708 is.
 */
export function reachDeletable(statement: Statement, reach: ReachTerms): string | undefined {
  const past = [...reach.removed.slice(1), ...reach.cleared.map((entry) => entry.table)]
  if (past.length === 0) return undefined
  const rows = past.map((table) => `(${statement.text(table.schema)}, ${statement.text(table.name)})`).join(', ')
  return `not exists (
    select from (values ${rows}) as "t"("schema", "name")
    left join pg_catalog.pg_namespace n on n.nspname ${op('=')} "t"."schema"
    left join pg_catalog.pg_class c on c.relnamespace ${op('=')} n.oid and c.relname ${op('=')} "t"."name"
    where not coalesce(pg_catalog.has_table_privilege(c.oid, 'DELETE'), false)
  )`
}

/**
 * Whether no rule acts on a delete from `table` (0050). PostgreSQL refuses
 * the delete's data-modifying CTE, 0A000, under a DO ALSO rule, a DO
 * INSTEAD NOTHING rule, and a DO INSTEAD rule without RETURNING or with
 * several actions, and a conditional rule cannot have RETURNING; but it
 * runs an unconditional DO INSTEAD rule with RETURNING inside the CTE: the
 * rule's action in the delete's place, and what the action returns read as
 * the row deleted -- measured on postgres:17-alpine (17.11), 2026-10-11
 * (P4): a soft delete's update, and an insert that names no column of the
 * row, each answered as a deletion, the row still there. In the
 * statement's WHERE, which the rewriter adds to the rule's action, so the
 * action changes nothing (measured the same day) and the follow-up says
 * why. Enabled or not: which rules fire depends on the session's
 * replication role. A rule on a relation below the table is never applied
 * to a delete from the table. An uncorrelated subquery, so it runs once
 * per statement; pg_rewrite is indexed by the table's oid.
 */
export function unruled(statement: Statement, table: ObjectRef): string {
  return `not exists (
    select from pg_catalog.pg_rewrite w
    join pg_catalog.pg_class c on c.oid ${op('=')} w.ev_class
    join pg_catalog.pg_namespace n on n.oid ${op('=')} c.relnamespace
    where n.nspname ${op('=')} ${statement.text(table.schema)} and c.relname ${op('=')} ${statement.text(table.name)}
      and w.ev_type ${op('=')} '4'::pg_catalog."char"
  )`
}

/**
 * One guarded delete (0050): the key, the trusted filters, every through
 * and the expected version in one WHERE, with the definition's guard (0041),
 * the reach's and the rules', returning the key as canonical text and the
 * version.
 *
 * It deletes one row or none. The scalar subquery over the CTE's rows fails
 * with 21000 when the delete returned two -- measured on postgres:17-alpine
 * (17.11), 2026-10-11 (P3): the statement fails and both rows are still
 * there -- so an identity that is not a key, which only a unique index
 * dropped CONCURRENTLY during the delete leaves the digest unchanged for
 * (0041), deletes nothing instead of several rows.
 *
 * A table a rule acts on refuses every delete here, `refused`, with nothing
 * deleted: PostgreSQL itself under most rules, and `unruled` under the one
 * it would run. SQL Server has no rules at all.
 */
export function deleteStatement(request: DeleteRequest, terms: DeleteTerms, definition: Definition, path: WritePath): RecordStatement {
  const statement = new Statement()
  const where = [
    ...located(statement, terms.key, terms.terms, terms.through),
    versionIs(statement, { target: request.target, expectedVersion: terms.expectedVersion }),
    ...guard(statement, terms.root, definition, path),
    reachClear(statement, terms.reach),
    unruled(statement, terms.root),
  ]
  const deletable = reachDeletable(statement, terms.reach)
  if (deletable !== undefined) where.push(deletable)
  const returning = request.target.identity.map((entry, index) => `${canonicalText(entry.type, column(entry.name))} as "c${String(index)}"`)
  returning.push(`${column(request.target.concurrency.column)}::pg_catalog.text as "version"`)
  const text = [
    'with "d" as (',
    `delete from ${quoteTable(terms.root)} as ${ROW}`,
    `where ${where.join(' and ')}`,
    `returning ${returning.join(', ')})`,
    'select "d".*, (select true from "d") as "one" from "d"',
  ].join('\n')
  return { text, params: statement.params }
}

/**
 * Why a delete deleted nothing, in one statement, on any connection: whether
 * the table's definition is still the one it was decided over, whether
 * anything now acts on delete through a key onto a table it reaches,
 * whether the account may still DELETE from every table past the root,
 * whether no rule acts on a delete from it, the isolation this connection
 * runs under, and whether the record exists inside the filters and throughs
 * and, when `withVersion`, still has the version sent -- `true`, `false`,
 * or NULL for no such record. None of the digest, the reach and the rules
 * depends on a session (definition.ts), and the grants are the current
 * user's, the account every connection of the pool logs in as, so any
 * connection answers them as the delete's would.
 */
export function whyNotDeletedStatement(request: DeleteRequest, terms: DeleteTerms, withVersion: boolean, definition: Definition): RecordStatement {
  const statement = new Statement()
  const same = `(${digestOf(factsOf(statement, terms.root))} ${op('=')} ${statement.text(definition.digest)})::pg_catalog.text`
  const reach = `(${reachClear(statement, terms.reach)})::pg_catalog.text`
  const deletable = `(${reachDeletable(statement, terms.reach) ?? 'true'})::pg_catalog.text`
  const rules = `(${unruled(statement, terms.root)})::pg_catalog.text`
  const where = located(statement, terms.key, terms.terms, terms.through)
  const unchanged = withVersion ? `(${versionIs(statement, { target: request.target, expectedVersion: terms.expectedVersion })})::pg_catalog.text` : `'false'`
  const found = `${selectFrom(terms.root, [`${unchanged} as "unchanged"`], where)}\nlimit 1`
  return {
    text: `select ${same}, ${reach}, ${deletable}, ${rules}, ${ISOLATION}, "found"."unchanged"\nfrom (select) as "g"\nleft join lateral (${found}) as "found" on true`,
    params: statement.params,
  }
}
