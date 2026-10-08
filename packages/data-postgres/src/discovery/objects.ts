import type { CoverageGap, ObjectMeta, ObjectRef } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'

/** A table or view this account can use, with the oid every other concern is keyed by. */
export interface UsableObject {
  oid: number
  ref: ObjectRef
  kind: ObjectMeta['kind']
}

export interface ObjectsInScope {
  usable: UsableObject[]
  gaps: CoverageGap[]
}

interface ObjectRow {
  oid: number
  schema: string
  name: string
  relkind: string
  schema_usage: boolean
  any_privilege: boolean
  select_all: boolean
}

/**
 * The tables and views in scope, and what this account may do with each.
 *
 * pg_class is readable by every role: unlike information_schema, it lists
 * every relation whatever the account's privileges (0006). So visibility here
 * says nothing about access, and access is asked for explicitly:
 *
 * - USAGE on the schema, without which every read fails "permission denied
 *   for schema", whatever the table's grants say;
 * - any privilege a form could read or write with, on the table or on one of
 *   its columns;
 * - SELECT on the whole table, short of which some columns are not readable.
 *
 * Kinds: `r` a table, `p` a partitioned table, `v` a view, `m` a materialized
 * view, `f` a foreign table. A partition (`relispartition`) is storage for
 * its parent and is described through it. Indexes, sequences and composite
 * types are pg_class rows too, and are not objects.
 */
export async function readObjects(sql: TransactionSql, schemas: readonly string[]): Promise<ObjectsInScope> {
  const rows = await sql<ObjectRow[]>`
    select
      c.oid,
      n.nspname as schema,
      c.relname as name,
      c.relkind,
      pg_catalog.has_schema_privilege(n.oid, 'USAGE') as schema_usage,
      pg_catalog.has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE')
        or pg_catalog.has_any_column_privilege(c.oid, 'SELECT, INSERT, UPDATE') as any_privilege,
      pg_catalog.has_table_privilege(c.oid, 'SELECT') as select_all
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(${schemas})
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and not c.relispartition`

  const usable: UsableObject[] = []
  const gaps: CoverageGap[] = []
  for (const row of rows) {
    const ref = { schema: row.schema, name: row.name }
    const unusable = whyUnusable(row)
    if (unusable !== null) {
      gaps.push({ object: ref, aspect: 'objects', detail: unusable })
      continue
    }
    usable.push({ oid: row.oid, ref, kind: row.relkind === 'v' || row.relkind === 'm' ? 'view' : 'table' })
    if (!row.select_all) {
      gaps.push({
        object: ref,
        aspect: 'columns',
        detail:
          'this account may not select every column: its privileges are on some columns only, or only to write, ' +
          'and the snapshot does not say which columns it can use',
      })
    }
  }
  return { usable, gaps }
}

/**
 * Why an object in scope is not described, or `null` when it is.
 *
 * Not described is not the same as not reported: each of these is a gap, so
 * "there is no such table" and "this account cannot use it" stay different
 * answers, and a revoked privilege moves the fingerprint as an access change
 * rather than as a dropped table (0004).
 */
function whyUnusable(row: ObjectRow): string | null {
  if (row.relkind === 'f') {
    return 'a foreign table: its rows live on another server, behind a wrapper this release does not describe'
  }
  if (!row.schema_usage) {
    return `this account has no USAGE privilege on schema ${row.schema}, so it can neither read nor write the object`
  }
  if (!row.any_privilege) {
    return 'this account holds no privilege on it that a form could read or write with'
  }
  return null
}
