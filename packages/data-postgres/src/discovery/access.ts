import type { ColumnAccess } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'

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
