import type { ColumnAccess, ObjectAccess } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'
import { DESCRIBED_RELATION } from './objects.js'

interface AccessRow {
  oid: number
  ordinal: number
  select: boolean
  insert: boolean
  update: boolean
}

/**
 * What this account may do with every column of every table and view in
 * scope, by the oid of its relation and then by the column's ordinal (0027).
 *
 * The server's own privilege functions answer, so grants on the table, on the
 * column, through PUBLIC and through inherited role memberships are all
 * counted as the server counts them -- a membership WITH INHERIT FALSE
 * included, which grants nothing until a SET ROLE this module never issues
 * (B4). Asked of the column, `has_column_privilege` is true when the table
 * grant or the column grant gives it.
 *
 * Each is ANDed with USAGE on the schema: without it every statement fails
 * "permission denied for schema", whatever the table's grants say (B2).
 *
 * Keyed by oid and attnum, never by a name cast to `regclass`: that cast
 * itself needs USAGE on the schema, and fails for exactly the objects whose
 * answer is "no" (B2). A dropped column keeps its pg_attribute row and its
 * privilege check answers NULL, so it is left out, as `readColumns` leaves it
 * out. That filter is tidiness, not a guard: the answers are looked up by the
 * attnums `readColumns` returned, so a dropped column's entry would never be
 * read. Measured on postgres:17-alpine, 2026-10-09: over every column of the
 * fixture, as the owner, the reader and the writer, each answer here is the
 * one a SELECT, an UPDATE … SET c = NULL and an INSERT (c) get from the
 * server (`discovery-access.integration.test.ts`).
 *
 * Like `format_type`, the privilege functions read the live catalog rather
 * than the transaction's snapshot; a NULL from a relation dropped mid-read
 * reaches `createSnapshot`, which refuses it.
 */
export async function readAccess(sql: TransactionSql, schemas: readonly string[]): Promise<Map<number, Map<number, ColumnAccess>>> {
  const rows = await sql<AccessRow[]>`
    select
      a.attrelid as oid,
      a.attnum as ordinal,
      pg_catalog.has_schema_privilege(n.oid, 'USAGE') and pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT') as select,
      pg_catalog.has_schema_privilege(n.oid, 'USAGE') and pg_catalog.has_column_privilege(c.oid, a.attnum, 'INSERT') as insert,
      pg_catalog.has_schema_privilege(n.oid, 'USAGE') and pg_catalog.has_column_privilege(c.oid, a.attnum, 'UPDATE') as update
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${schemas})
      and c.relkind in ('r', 'p', 'v', 'm')
      and not c.relispartition
      and a.attnum > 0
      and not a.attisdropped`

  const byObject = new Map<number, Map<number, ColumnAccess>>()
  for (const row of rows) {
    const columns = byObject.get(row.oid) ?? new Map<number, ColumnAccess>()
    columns.set(row.ordinal, { select: row.select, insert: row.insert, update: row.update })
    byObject.set(row.oid, columns)
  }
  return byObject
}

interface ObjectAccessRow {
  oid: number
  delete: boolean
}

/**
 * Whether this account may DELETE from each table and view in scope, by the
 * oid of the relation (0049): `has_table_privilege`, ANDed with USAGE on the
 * schema, keyed by oid for the reasons `readAccess` gives. Grants through
 * PUBLIC and inherited memberships count as the server counts them.
 *
 * DELETE alone deletes nothing by a key: a WHERE or a RETURNING that names a
 * column needs SELECT on it too, which the columns' access says. Measured on
 * postgres:17-alpine (17.11), 2026-10-11 (P1): a role with DELETE and no SELECT
 * runs `delete … where false` and is refused 42501 for `where id = 1`; given
 * SELECT on id, `where id = 1 returning id` runs and `returning v` is
 * refused. DELETE alone also takes `lock table only … in row exclusive mode`.
 * And over every table of the fixture, as the owner, the reader and a writer
 * granted DELETE on order and order_line, each answer here was the one
 * `delete … where false` got (`discovery-access.integration.test.ts`); a view
 * that cannot be updated is refused 55000 before any privilege is asked, so
 * a view's answer is its grant's.
 */
export async function readObjectAccess(sql: TransactionSql, schemas: readonly string[]): Promise<Map<number, ObjectAccess>> {
  const rows = await sql<ObjectAccessRow[]>`
    select
      c.oid,
      pg_catalog.has_schema_privilege(n.oid, 'USAGE') and pg_catalog.has_table_privilege(c.oid, 'DELETE') as delete
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${schemas})
      and ${sql.unsafe(DESCRIBED_RELATION)}`
  return new Map(rows.map((row) => [row.oid, { delete: row.delete }]))
}
