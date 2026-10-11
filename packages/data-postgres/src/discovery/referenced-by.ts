import type { CoverageGap, InboundKey } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'
import { action, DECLARED_FOREIGN_KEY, TRIGGERS_ENABLED } from './foreign-keys.js'
import { DESCRIBED_RELATION } from './objects.js'

interface InboundRow {
  /** The referenced relation: a table in scope. */
  oid: number
  /** The constraint, which names one key on one referring table. */
  key: number
  name: string
  referring_schema: string
  referring_name: string
  on_update: string
  on_delete: string
  triggers_enabled: boolean
  column: string
  referenced_column: string
}

/**
 * Every declared foreign key that refers to a relation in scope, from a table
 * in any schema, by the oid of the relation referred to (0049).
 *
 * The scope bounds what is described, not what refers to it: a delete of a
 * row reaches every table whose key acts on delete, wherever it is, so a key
 * from outside is named here -- its table, its columns, its actions -- and
 * nothing else of that table is read. pg_catalog shows every role every
 * constraint, class and attribute, so the list is complete for any account:
 * measured on postgres:17-alpine (17.11), 2026-10-11 (P2), the reader, with no
 * USAGE on the referring table's schema, reads the key, its table's name and
 * its column's. What it lists is therefore complete for the relation each
 * key names; a key that names a partition or an inheriting table instead is
 * `readKeysBelow`'s.
 *
 * The same two conditions as the referring side's foreign keys, so a key
 * between two tables in scope is the same key at both ends, which
 * `createSnapshot` holds them to: DECLARED_FOREIGN_KEY leaves out the clones
 * PostgreSQL makes on each partition of a partitioned referring table, which
 * refer to the same relation; TRIGGERS_ENABLED reads enforcement over the
 * declared key and every clone.
 */
export async function readReferencedBy(sql: TransactionSql, schemas: readonly string[]): Promise<Map<number, InboundKey[]>> {
  const rows = await sql<InboundRow[]>`
    select
      k.confrelid as oid,
      k.oid as key,
      k.conname as name,
      n.nspname as referring_schema,
      c.relname as referring_name,
      k.confupdtype as on_update,
      k.confdeltype as on_delete,
      ${sql.unsafe(TRIGGERS_ENABLED)} as triggers_enabled,
      a.attname as column,
      ta.attname as referenced_column
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_class tc on tc.oid = k.confrelid
    join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
    cross join lateral unnest(k.conkey, k.confkey) with ordinality as pair(attnum, target_attnum, position)
    join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attnum = pair.attnum
    join pg_catalog.pg_attribute ta on ta.attrelid = k.confrelid and ta.attnum = pair.target_attnum
    where tn.nspname = any(${schemas})
      and ${sql.unsafe(DECLARED_FOREIGN_KEY)}
    order by k.confrelid, k.oid, pair.position`

  const byObject = new Map<number, InboundKey[]>()
  const byKey = new Map<number, InboundKey>()
  for (const row of rows) {
    let key = byKey.get(row.key)
    if (key === undefined) {
      key = {
        table: { schema: row.referring_schema, name: row.referring_name },
        name: row.name,
        columns: [],
        referencedColumns: [],
        onDelete: action(row.on_delete, row.name),
        onUpdate: action(row.on_update, row.name),
        enforced: row.triggers_enabled,
      }
      byKey.set(row.key, key)
      byObject.set(row.oid, [...(byObject.get(row.oid) ?? []), key])
    }
    key.columns.push(row.column)
    key.referencedColumns.push(row.referenced_column)
  }
  return byObject
}

interface BelowRow {
  /** The described relation above the one the key names. */
  schema: string
  name: string
  key: string
  referring_schema: string
  referring_name: string
  below_schema: string
  below_name: string
  partition: boolean
}

/**
 * A `referenced-by` gap on a described relation for every declared key that
 * names a relation below it -- one of its partitions, at any depth, or a
 * table that inherits from it (0049).
 *
 * pg_constraint records such a key on the partition or the child alone, so
 * `readReferencedBy` lists it there, and a partition is not described. Yet a
 * delete from the parent reaches the partition's or the child's rows, and
 * the key acts on them: measured on postgres:17-alpine (17.11), 2026-10-11,
 * a cascade onto one partition and onto an inheriting table each ran on a
 * delete from the parent (`discovery.integration.test.ts`). The key is read
 * whole, but this release says a key only on the relation it names, so
 * listing it on the parent would say a key refers to a table it does not;
 * a gap on the parent says the list is short and which key it lacks.
 *
 * pg_inherits holds both partitions and inheritance children, walked up to
 * every ancestor, which is in scope whatever the schema of the relation
 * below. DECLARED_FOREIGN_KEY leaves out the clones PostgreSQL makes onto
 * each partition for a key that names the parent: that key is listed on the
 * parent already.
 */
export async function readKeysBelow(sql: TransactionSql, schemas: readonly string[]): Promise<CoverageGap[]> {
  const rows = await sql<BelowRow[]>`
    with recursive below(relid, ancestor) as (
      select i.inhrelid, i.inhparent from pg_catalog.pg_inherits i
      union
      select below.relid, i.inhparent from below join pg_catalog.pg_inherits i on i.inhrelid = below.ancestor
    )
    select n.nspname as schema, c.relname as name, k.conname as key,
      rn.nspname as referring_schema, r.relname as referring_name,
      bn.nspname as below_schema, b.relname as below_name, b.relispartition as partition
    from pg_catalog.pg_constraint k
    join below on below.relid = k.confrelid
    join pg_catalog.pg_class c on c.oid = below.ancestor
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_class b on b.oid = k.confrelid
    join pg_catalog.pg_namespace bn on bn.oid = b.relnamespace
    join pg_catalog.pg_class r on r.oid = k.conrelid
    join pg_catalog.pg_namespace rn on rn.oid = r.relnamespace
    where n.nspname = any(${schemas})
      and ${sql.unsafe(DESCRIBED_RELATION)}
      and ${sql.unsafe(DECLARED_FOREIGN_KEY)}`

  return rows.map((row) => ({
    subject: { kind: 'object', object: { schema: row.schema, name: row.name } },
    aspect: 'referenced-by',
    detail: `foreign key ${row.key} of ${row.referring_schema}.${row.referring_name} refers to ${row.below_schema}.${row.below_name}, ${row.partition ? 'a partition of this table' : 'a table that inherits from this one'}, and a delete from this table reaches its rows; this release lists a key only on the table it names`,
  }))
}
