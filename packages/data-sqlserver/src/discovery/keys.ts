import type { KeyMeta } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { byObjectId, groupBy, queryScope } from './catalog.js'

interface KeyRow {
  object_id: number
  key_id: number
  name: string
  is_primary_key: boolean
  column_name: string
}

export interface Keys {
  primaryKey: KeyMeta | null
  uniqueKeys: KeyMeta[]
}

/**
 * Primary keys and unique constraints, each in its key order.
 *
 * key_ordinal, never column_id: a composite key declared (tenant_id,
 * customer_no) over columns created the other way round pairs by the key's
 * order, and a foreign key into it pairs by the same. Ordered by numbers only,
 * so the database's collation never decides an order here.
 *
 * Unique constraints only, not unique indexes: a unique index may be filtered,
 * and a filtered index is not a key.
 */
const SQL = (scoped: string): string => `
  select kc.parent_object_id as object_id, kc.object_id as key_id, kc.name,
    cast(case kc.type when 'PK' then 1 else 0 end as bit) as is_primary_key,
    c.name as column_name
  from sys.key_constraints kc
  join sys.index_columns ic on ic.object_id = kc.parent_object_id and ic.index_id = kc.unique_index_id
  join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
  where kc.parent_object_id in ${scoped} and ic.key_ordinal > 0
  order by kc.parent_object_id, kc.object_id, ic.key_ordinal`

/**
 * Each table's keys, by object_id. Keys of a table this account can see are
 * visible with it, so there is never a gap to report here.
 */
export async function readKeys(pool: ConnectionPool, schemas: readonly string[]): Promise<Map<number, Keys>> {
  const rows = await queryScope<KeyRow>(pool, schemas, SQL)
  const byObject = new Map<number, Keys>()
  for (const [objectId, group] of groupBy(rows, byObjectId)) {
    const keys: Keys = { primaryKey: null, uniqueKeys: [] }
    for (const keyRows of groupBy(group, (row) => row.key_id).values()) {
      const [first] = keyRows as [KeyRow, ...KeyRow[]]
      const key: KeyMeta = { name: first.name, columns: keyRows.map((row) => row.column_name) }
      if (first.is_primary_key) keys.primaryKey = key
      else keys.uniqueKeys.push(key)
    }
    byObject.set(objectId, keys)
  }
  return byObject
}
