import type { DeleteRequest, DeleteTerms, ObjectRef } from '@formancy/data-core'
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

/**
 * Whether no declared foreign key that acts on delete -- cascades, sets NULL
 * or sets a default -- refers to `table` or to any relation below it (0050).
 * In 0050 a delete reaches nothing past its record, and the planner refuses
 * a grant over such a key by the snapshot (`deleteProblems`); this is the
 * same rule asked of the catalog in the statement, so a key added after
 * the form was published is refused there rather than followed.
 *
 * The table is found by its bound names, as the definition's facts find it.
 * Every declared key is read, its triggers enabled or not: a key one of
 * whose triggers is disabled may still act, and one enabled again acts with
 * nothing here noticing (0049). `DECLARED_FOREIGN_KEY` is discovery's own
 * condition, so the clones PostgreSQL makes onto each partition of a
 * partitioned table are not read twice. Below the table -- its partitions
 * at any depth, and the tables that inherit from it -- because a key that
 * names one of them acts on the rows a delete from the table removes there
 * (0049, P2b), and the snapshot names those only as a gap.
 *
 * Complete for a key added onto the table or a relation below it: ADD
 * FOREIGN KEY ... REFERENCES a relation needs SHARE ROW EXCLUSIVE on it, which
 * conflicts with the delete's ROW EXCLUSIVE, so such a key either committed
 * before the statement's snapshot, and is read here, or waits until the
 * delete ends. Under READ COMMITTED the statement takes its snapshot after
 * it has locked what it plans, partitions included. Under another
 * isolation it takes it before it plans, so the locked path first locks the
 * table with every relation below it (`lockStatement`): an ALTER onto a
 * partition locks the partition alone, and with only the table locked
 * first, a key onto a partition committed while the delete waited acted
 * unseen. The `reach-moved` cases and the partition case hold both orders,
 * the partition case on both paths; a key onto an inheritance child, and a
 * partition attached while the delete waits, are not tested (0050).
 * pg_constraint has no index on
 * confrelid: measured on postgres:17-alpine (17.11), 2026-10-11 (P8), the
 * lookup is a sequential scan of pg_constraint, which held 124 rows in that
 * database -- a cost per delete that grows with the constraints of the
 * whole database, not measured past that.
 */
export function reachClear(statement: Statement, table: ObjectRef): string {
  const schema = statement.text(table.schema)
  const name = statement.text(table.name)
  return `not exists (
    with recursive "below"("relid") as (
      select c.oid
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid ${op('=')} c.relnamespace
      where n.nspname ${op('=')} ${schema} and c.relname ${op('=')} ${name}
      union
      select i.inhrelid from pg_catalog.pg_inherits i join "below" on i.inhparent ${op('=')} "below"."relid"
    )
    select from pg_catalog.pg_constraint k
    join "below" on k.confrelid ${op('=')} "below"."relid"
    where ${DECLARED_FOREIGN_KEY} and k.confdeltype ${op('=')} any ('{c,n,d}'::pg_catalog."char"[])
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
    reachClear(statement, terms.root),
    unruled(statement, terms.root),
  ]
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
 * anything now acts on delete through a key onto it, whether no rule acts
 * on a delete from it, the isolation this connection runs under, and
 * whether the record exists inside the filters and throughs and, when
 * `withVersion`, still has the version sent -- `true`, `false`, or NULL for
 * no such record. None of the digest, the reach and the rules depends on a
 * session (definition.ts), so any connection answers them as the delete's
 * would.
 */
export function whyNotDeletedStatement(request: DeleteRequest, terms: DeleteTerms, withVersion: boolean, definition: Definition): RecordStatement {
  const statement = new Statement()
  const same = `(${digestOf(factsOf(statement, terms.root))} ${op('=')} ${statement.text(definition.digest)})::pg_catalog.text`
  const reach = `(${reachClear(statement, terms.root)})::pg_catalog.text`
  const rules = `(${unruled(statement, terms.root)})::pg_catalog.text`
  const where = located(statement, terms.key, terms.terms, terms.through)
  const unchanged = withVersion ? `(${versionIs(statement, { target: request.target, expectedVersion: terms.expectedVersion })})::pg_catalog.text` : `'false'`
  const found = `${selectFrom(terms.root, [`${unchanged} as "unchanged"`], where)}\nlimit 1`
  return { text: `select ${same}, ${reach}, ${rules}, ${ISOLATION}, "found"."unchanged"\nfrom (select) as "g"\nleft join lateral (${found}) as "found" on true`, params: statement.params }
}
