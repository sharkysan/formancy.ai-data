import type { KeyMeta } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'
import { op } from '../sql/catalog.js'

export interface ObjectKeys {
  primaryKey: KeyMeta | null
  uniqueKeys: KeyMeta[]
}

export interface KeyRow {
  oid: number
  name: string
  is_primary: boolean
  column: string
}

/**
 * Primary and unique keys, by the oid of their table, each in its own column
 * order -- which is the key's order, and for a composite key the pairing a
 * foreign key relies on.
 *
 * Two sources, because PostgreSQL has two:
 *
 * - **Constraints** (pg_constraint, `p` and `u`), with `conkey` in key order.
 * - **Unique indexes that are not constraints.** `CREATE UNIQUE INDEX` is what
 *   most migration tools emit, PostgreSQL accepts one as a foreign key's
 *   target, and pg_constraint does not list it. Only an index that makes its
 *   columns a key counts: valid (a failed concurrent build leaves one that is
 *   not), not partial (unique among some rows is not a key), and over plain
 *   columns (`lower(email)` is not a column). `indkey` lists INCLUDE columns
 *   after the key columns; only the first `indnkeyatts` are the key.
 *
 * An index that backs a constraint is skipped, so a key is never reported twice.
 */
/** A primary key or a unique constraint, of pg_constraint `k`. Shared with the root's definition (0041). */
export const KEY_CONSTRAINT = `k.contype ${op('=')} any ('{p,u}'::pg_catalog."char"[])`

/**
 * A unique index, of pg_index `i`, that makes its columns a key and is no
 * constraint's: valid, not partial, over plain columns, and backing no
 * primary, unique or exclusion constraint, which are reported as themselves.
 * Its first `indnkeyatts` columns, numbered `key.position`, are the key.
 * Shared with the root's definition (0041).
 */
export const UNIQUE_INDEX_KEY = `i.indisunique
      and i.indisvalid
      and i.indpred is null
      and i.indexprs is null
      and not exists (
        select from pg_catalog.pg_constraint k
        where k.conindid ${op('=')} i.indexrelid and k.conrelid ${op('=')} i.indrelid and k.contype ${op('=')} any ('{p,u,x}'::pg_catalog."char"[])
      )`
export const INDEX_KEY_COLUMN = `key.position ${op('<=')} i.indnkeyatts`

export async function readKeys(sql: TransactionSql, schemas: readonly string[]): Promise<Map<number, ObjectKeys>> {
  const rows = await sql<KeyRow[]>`
    select k.conrelid as oid, k.conname as name, k.contype = 'p' as is_primary, a.attname as column, key.position
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral unnest(k.conkey) with ordinality as key(attnum, position)
    join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attnum = key.attnum
    where n.nspname = any(${schemas})
      and ${sql.unsafe(KEY_CONSTRAINT)}

    union all

    select i.indrelid, x.relname, false, a.attname, key.position
    from pg_catalog.pg_index i
    join pg_catalog.pg_class x on x.oid = i.indexrelid
    join pg_catalog.pg_class c on c.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral unnest(i.indkey::int2[]) with ordinality as key(attnum, position)
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = key.attnum
    where n.nspname = any(${schemas})
      and ${sql.unsafe(UNIQUE_INDEX_KEY)}
      and ${sql.unsafe(INDEX_KEY_COLUMN)}

    order by oid, name, position`

  const byObject = new Map<number, ObjectKeys>()
  for (const row of rows) {
    const keys = byObject.get(row.oid) ?? { primaryKey: null, uniqueKeys: [] }
    addKeyColumn(keys, row)
    byObject.set(row.oid, keys)
  }
  return byObject
}

/** One key column, in key order, onto its object's keys: how discovery and the root's description (0041) assemble them alike. */
export function addKeyColumn(keys: ObjectKeys, row: Pick<KeyRow, 'name' | 'is_primary' | 'column'>): void {
  if (row.is_primary) {
    keys.primaryKey ??= { name: row.name, columns: [] }
    keys.primaryKey.columns.push(row.column)
    return
  }
  let key = keys.uniqueKeys.find((candidate) => candidate.name === row.name)
  if (key === undefined) {
    key = { name: row.name, columns: [] }
    keys.uniqueKeys.push(key)
  }
  key.columns.push(row.column)
}
