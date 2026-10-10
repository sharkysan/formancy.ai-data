import type { CoverageAspect } from '@formancy/data-core'
import mssql from 'mssql'
import type { ConnectionPool, IRecordSet } from 'mssql'

/**
 * A gap found while reading one concern, before the object it belongs to has
 * a name: the concern knows the object_id, the assembler knows the ref.
 */
export interface ObjectGap {
  objectId: number
  aspect: CoverageAspect
  detail: string
}

/** What one catalog concern found, by object_id, and what it could not read. */
export interface Found<T> {
  byObject: Map<number, T>
  gaps: ObjectGap[]
}

/** The objects discovery describes, of sys.objects `o`: user tables and views. Shared with the root's definition (0041). */
export const DESCRIBED_OBJECT = `o.type in ('U', 'V') and o.is_ms_shipped = 0`

/**
 * Runs one catalog query over the tables and views in scope.
 *
 * Each schema is bound as its own parameter, `@schema0`, `@schema1`, and the
 * query text receives only those generated names: a schema name is a value
 * and never part of the statement, whatever it contains. A list of
 * parameters rather than one JSON or delimited parameter, because OPENJSON and
 * STRING_SPLIT need compatibility level 130 and a customer's database is often
 * older than its server.
 *
 * `scoped` is a subquery of the object_ids in scope: user tables and views
 * whose schema the database's own collation matches to a scope name. Matching
 * by the database's rules, not by exact spelling, because on a
 * case-insensitive database `SALES` IS `sales`, and reporting it absent would
 * be the silent answer.
 */
export async function queryScope<Row>(
  pool: ConnectionPool,
  schemas: readonly string[],
  sql: (scoped: string, schemaList: string) => string,
): Promise<IRecordSet<Row>> {
  const request = pool.request()
  const names = schemas.map((schema, index) => {
    // nvarchar(max), never nvarchar(128): a declared length shorter than the
    // value is truncated, and a truncated name can match a different schema.
    request.input(`schema${String(index)}`, mssql.NVarChar(mssql.MAX), schema)
    return `@schema${String(index)}`
  })
  const schemaList = names.join(', ')
  const scoped = `(select o.object_id from sys.objects o join sys.schemas s on s.schema_id = o.schema_id
    where ${DESCRIBED_OBJECT} and s.name in (${schemaList}))`
  const result = await request.query<Row>(sql(scoped, schemaList))
  return result.recordset
}

/** Rows grouped by a key, each group in the order the query returned it. */
export function groupBy<Row, Key>(rows: readonly Row[], key: (row: Row) => Key): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>()
  for (const row of rows) {
    const group = groups.get(key(row))
    if (group === undefined) groups.set(key(row), [row])
    else group.push(row)
  }
  return groups
}

export const byObjectId = (row: { object_id: number }): number => row.object_id
