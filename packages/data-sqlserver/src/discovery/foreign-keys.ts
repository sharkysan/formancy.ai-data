import type { ForeignKeyMeta, ForeignKeyTarget, ReferentialAction } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import type { Found, ObjectGap } from './catalog.js'
import { byObjectId, groupBy, queryScope } from './catalog.js'

export interface ForeignKeyRow {
  object_id: number
  key_id: number
  name: string
  is_disabled: boolean
  is_not_trusted: boolean
  delete_referential_action: number
  update_referential_action: number
  referenced_schema: string | null
  referenced_name: string | null
  column_name: string
  referenced_column: string | null
}

/**
 * Foreign keys, one row per column pair, in constraint_column_id order -- the
 * pairing of a composite key.
 *
 * The target is LEFT joined, because what SQL Server shows an account that
 * may read the referencing table and not the referenced one is precise and
 * partial: the key, its flags, its own columns, and a referenced_object_id
 * whose OBJECT_NAME is NULL and whose columns COL_NAME cannot name. An inner
 * join would drop the key -- "no relationship", the one wrong answer -- so the
 * key is reported with an unknown target and a gap says why.
 */
export const FOREIGN_KEYS_SQL = (scoped: string): string => `
  select fk.parent_object_id as object_id, fk.object_id as key_id, fk.name, fk.is_disabled, fk.is_not_trusted,
    fk.delete_referential_action, fk.update_referential_action,
    rs.name as referenced_schema, ro.name as referenced_name,
    pc.name as column_name, rc.name as referenced_column
  from sys.foreign_keys fk
  join sys.foreign_key_columns fkc on fkc.constraint_object_id = fk.object_id
  join sys.columns pc on pc.object_id = fkc.parent_object_id and pc.column_id = fkc.parent_column_id
  left join sys.objects ro on ro.object_id = fk.referenced_object_id
  left join sys.schemas rs on rs.schema_id = ro.schema_id
  left join sys.columns rc on rc.object_id = fkc.referenced_object_id and rc.column_id = fkc.referenced_column_id
  where fk.parent_object_id in ${scoped}
  order by fk.parent_object_id, fk.object_id, fkc.constraint_column_id`

/** sys.foreign_keys' *_referential_action codes. SQL Server has no RESTRICT. */
const ACTIONS: readonly ReferentialAction[] = ['no-action', 'cascade', 'set-null', 'set-default']

function action(code: number, name: string): ReferentialAction {
  const found = ACTIONS[code]
  // Unreached on the servers tested: SQL Server 2022 has exactly these four.
  // A later one with a fifth fails loudly here rather than being reported as
  // the nearest thing.
  if (found === undefined) throw new Error(`${name} has referential action ${String(code)}, which this adapter does not know`)
  return found
}

/**
 * The target, or `null` when any part of it is hidden: a schema and a name
 * and every paired column, or nothing. Half a target -- a table without its
 * columns -- would pair the key with the wrong columns downstream.
 */
function target(rows: readonly ForeignKeyRow[]): ForeignKeyTarget | null {
  const [first] = rows as [ForeignKeyRow, ...ForeignKeyRow[]]
  const columns: string[] = []
  for (const row of rows) {
    if (row.referenced_column === null) return null
    columns.push(row.referenced_column)
  }
  if (first.referenced_schema === null || first.referenced_name === null) return null
  return { table: { schema: first.referenced_schema, name: first.referenced_name }, columns }
}

function toForeignKey(rows: readonly ForeignKeyRow[], gaps: ObjectGap[]): ForeignKeyMeta {
  const [first] = rows as [ForeignKeyRow, ...ForeignKeyRow[]]
  const references = target(rows)
  if (references === null) {
    gaps.push({
      objectId: first.object_id,
      aspect: 'foreign-keys',
      detail: `${first.name} references a table this account cannot see: the key and its own columns are visible, the name of its target and of the target's columns are not`,
    })
  }

  return {
    name: first.name,
    columns: rows.map((row) => row.column_name),
    references,
    onUpdate: action(first.update_referential_action, first.name),
    onDelete: action(first.delete_referential_action, first.name),
    // A disabled key is not checked for new rows, and SQL Server marks it
    // untrusted as well; WITH NOCHECK leaves it enabled and untrusted.
    enforced: !first.is_disabled,
    validated: !first.is_not_trusted,
  }
}

export async function readForeignKeys(pool: ConnectionPool, schemas: readonly string[]): Promise<Found<ForeignKeyMeta[]>> {
  const rows = await queryScope<ForeignKeyRow>(pool, schemas, FOREIGN_KEYS_SQL)
  const gaps: ObjectGap[] = []
  const byObject = new Map<number, ForeignKeyMeta[]>()
  for (const [objectId, group] of groupBy(rows, byObjectId)) byObject.set(objectId, foreignKeysOf(group, gaps))
  return { byObject, gaps }
}

/** One object's foreign keys from its rows, in the query's order: discovery's, and the root's description's (0041), which keeps no gaps. */
export function foreignKeysOf(rows: readonly ForeignKeyRow[], gaps: ObjectGap[]): ForeignKeyMeta[] {
  return [...groupBy(rows, (row) => row.key_id).values()].map((keyRows) => toForeignKey(keyRows, gaps))
}
