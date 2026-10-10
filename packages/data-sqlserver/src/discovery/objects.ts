import type { ObjectMeta } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { queryScope } from './catalog.js'

interface ObjectRow {
  object_id: number
  schema_name: string
  object_name: string
  kind: 'table' | 'view'
  comment: string | null
}

/**
 * The tables and views in scope, with their MS_Description.
 *
 * Only what this account holds some permission on: SQL Server filters
 * sys.objects without a word. Whether that filter can have hidden anything is
 * the schemas concern's question, not this one's.
 *
 * Comments are extended properties, and an account that can see the object
 * can see them: no gap is needed for comments, which was found by asking a
 * real server as a reader with SELECT only.
 */
/** An object's kind, of sys.objects `o`: discovery's mapping, and the root's definition's (0041). `o.type` is char(2), so 'V' is compared as 'V '. */
export const OBJECT_KIND = `case o.type when 'V' then 'view' else 'table' end`

const SQL = (scoped: string): string => `
  select o.object_id, s.name as schema_name, o.name as object_name,
    ${OBJECT_KIND} as kind,
    cast(ep.value as nvarchar(max)) as comment
  from sys.objects o
  join sys.schemas s on s.schema_id = o.schema_id
  left join sys.extended_properties ep
    on ep.class = 1 and ep.major_id = o.object_id and ep.minor_id = 0 and ep.name = N'MS_Description'
  where o.object_id in ${scoped}`

/** An object before its row security is known: that is another concern's (row-security.ts). */
export type ObjectFound = Omit<ObjectMeta, 'rowSecurity'>

/** Each object in scope, by object_id, with nothing attached yet. */
export async function readObjects(pool: ConnectionPool, schemas: readonly string[]): Promise<Map<number, ObjectFound>> {
  const rows = await queryScope<ObjectRow>(pool, schemas, SQL)
  return new Map(
    rows.map((row) => [
      row.object_id,
      {
        ref: { schema: row.schema_name, name: row.object_name },
        kind: row.kind,
        comment: row.comment,
        columns: [],
        primaryKey: null,
        uniqueKeys: [],
        foreignKeys: [],
        checks: [],
      },
    ]),
  )
}
