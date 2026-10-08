import type { ColumnMeta, Generation } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'
import { normalizeType } from './types.js'

interface ColumnRow {
  oid: number
  name: string
  ordinal: number
  database_type: string
  type_name: string
  type_schema: string
  type_modifier: number
  not_null: boolean
  identity: string
  generated: string
  default_expression: string | null
}

/** A column before its comment is attached; comments are their own concern. */
export type UncommentedColumn = Omit<ColumnMeta, 'comment'>

/**
 * The columns of every table and view in scope, by the oid of their relation.
 *
 * pg_attribute keeps system columns (negative attnum) and dropped ones
 * (`attisdropped`, renamed "........pg.dropped.N........"); neither is a
 * column anybody declared. A dropped column keeps its attnum, so the
 * ordinals that follow it do not shift, and the snapshot's ordinals are
 * allowed gaps for exactly this reason.
 *
 * `format_type` gives the type as PostgreSQL spells it in DDL --
 * `character varying(200)`, `numeric(18,4)` -- which is what a person reading
 * the report recognises; the normalised type is decoded from the catalog
 * itself, not parsed back out of that spelling.
 */
export async function readColumns(sql: TransactionSql, schemas: readonly string[]): Promise<Map<number, UncommentedColumn[]>> {
  const rows = await sql<ColumnRow[]>`
    select
      a.attrelid as oid,
      a.attname as name,
      a.attnum as ordinal,
      pg_catalog.format_type(a.atttypid, a.atttypmod) as database_type,
      t.typname as type_name,
      tn.nspname as type_schema,
      a.atttypmod as type_modifier,
      a.attnotnull as not_null,
      a.attidentity as identity,
      a.attgenerated as generated,
      -- A stored generated column's expression is filed in pg_attrdef, with
      -- atthasdef set, exactly like a default. It is not one: nothing can be
      -- written to the column, so there is nothing for a default to fill.
      case when a.attgenerated = '' then pg_catalog.pg_get_expr(d.adbin, d.adrelid) end as default_expression
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_type t on t.oid = a.atttypid
    join pg_catalog.pg_namespace tn on tn.oid = t.typnamespace
    left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = any(${schemas})
      and a.attnum > 0
      and not a.attisdropped
    order by a.attrelid, a.attnum`

  const byObject = new Map<number, UncommentedColumn[]>()
  for (const row of rows) {
    const columns = byObject.get(row.oid) ?? []
    columns.push({
      name: row.name,
      ordinal: row.ordinal,
      databaseType: row.database_type,
      type: normalizeType({ name: row.type_name, schema: row.type_schema, modifier: row.type_modifier }),
      nullable: !row.not_null,
      hasDefault: row.default_expression !== null,
      defaultExpression: row.default_expression,
      generated: generation(row),
    })
    byObject.set(row.oid, columns)
  }
  return byObject
}

/**
 * `attidentity` is `a` (ALWAYS) or `d` (BY DEFAULT); the contract has one
 * `identity` for both, because a form omits the column either way.
 * `attgenerated` is `s` for a stored generated column, the only kind
 * PostgreSQL 17 has; PostgreSQL 18's virtual columns (`v`) would fall into
 * the same branch, untested, because no suite here runs 18. `serial` is
 * neither: it is a default of nextval(), and reported as one.
 */
function generation(row: ColumnRow): Generation {
  if (row.identity !== '') return 'identity'
  if (row.generated !== '') return 'computed'
  return 'none'
}
