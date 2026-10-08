import type { TransactionSql } from 'postgres'

export interface ObjectComments {
  /** COMMENT ON TABLE / VIEW, or `null`. */
  object: string | null
  /** COMMENT ON COLUMN, by the column's attnum. */
  columns: Map<number, string>
}

interface CommentRow {
  oid: number
  column_number: number
  comment: string
}

/**
 * Comments on the tables and views in scope and on their columns, by the oid
 * of the relation.
 *
 * pg_description holds every comment in the database, told apart by the
 * catalog the commented object lives in (`classoid`) and, for a relation, by
 * `objsubid`: zero for the relation itself, the column's attnum for a column.
 * Readable by every role, so a comment is never hidden from a restricted
 * account on PostgreSQL.
 */
export async function readComments(sql: TransactionSql, schemas: readonly string[]): Promise<Map<number, ObjectComments>> {
  const rows = await sql<CommentRow[]>`
    select d.objoid as oid, d.objsubid as column_number, d.description as comment
    from pg_catalog.pg_description d
    join pg_catalog.pg_class c on c.oid = d.objoid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where d.classoid = 'pg_catalog.pg_class'::pg_catalog.regclass
      and n.nspname = any(${schemas})`

  const byObject = new Map<number, ObjectComments>()
  for (const row of rows) {
    const comments = byObject.get(row.oid) ?? { object: null, columns: new Map<number, string>() }
    if (row.column_number === 0) comments.object = row.comment
    else comments.columns.set(row.column_number, row.comment)
    byObject.set(row.oid, comments)
  }
  return byObject
}
