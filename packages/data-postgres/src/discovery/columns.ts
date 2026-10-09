import type { ColumnMeta, Generation, TextLengthUnit } from '@formancy/data-core'
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

/** A column before its comment and its access are attached; each is its own concern. */
export type UncommentedColumn = Omit<ColumnMeta, 'comment' | 'access'>

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
 * itself, not parsed back out of that spelling. A text's length unit is the
 * database's, from its encoding, and passed in (see `textUnitOf`).
 */
export async function readColumns(sql: TransactionSql, schemas: readonly string[], textUnit: TextLengthUnit): Promise<Map<number, UncommentedColumn[]>> {
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
      type: normalizeType({ name: row.type_name, schema: row.type_schema, modifier: row.type_modifier }, textUnit),
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
 * A default that is exactly the next value of one sequence, as pg_get_expr
 * deparses it: `nextval('schema.name'::regclass)`, a quote inside the name
 * doubled. `serial` is this, and so is a default written by hand.
 */
const NEXT_VALUE = /^nextval\('(?:[^']|'')+'::regclass\)$/

/**
 * `attidentity` is `a` for GENERATED ALWAYS, which refuses a value given to
 * it unless the statement says OVERRIDING SYSTEM VALUE, and `d` for BY
 * DEFAULT, which numbers a row only when the write leaves the column out and
 * accepts one otherwise. The contract names them apart (0026); a form treats
 * both as read-only, because a number chosen by hand does not advance the
 * sequence and is handed out again later. A code neither version has is
 * read as ALWAYS, the stricter: an identity of an unknown kind is never
 * offered as an ordinary column.
 *
 * A default that is exactly a sequence's next value — `serial`, or written
 * by hand — behaves as BY DEFAULT does, collision included, and is named so;
 * its default is still reported. One that computes with nextval() is an
 * ordinary default. SQL Server's NEXT VALUE FOR default is read the same way.
 *
 * `attgenerated` is `s` for a stored generated column, the only kind
 * PostgreSQL 17 has; PostgreSQL 18's virtual columns (`v`) fall into the
 * same branch, and are computed too.
 */
export function generation(row: Pick<ColumnRow, 'identity' | 'generated' | 'default_expression'>): Generation {
  if (row.identity === 'd') return 'identity-by-default'
  if (row.identity !== '') return 'identity-always'
  if (row.generated !== '') return 'computed'
  if (row.default_expression !== null && NEXT_VALUE.test(row.default_expression)) return 'identity-by-default'
  return 'none'
}

/**
 * What a text length counts in this database (0026). atttypmod's length is
 * characters of the database encoding, and the driver talks UTF-8:
 *
 * - `UTF8`: characters of Unicode, `code-points`.
 * - `SQL_ASCII`: no encoding at all. The server stores the client's UTF-8
 *   bytes as they come and counts each byte as a character, so varchar(4)
 *   refuses 'ééé' (22001): `utf8-bytes`.
 * - Any other (LATIN1, WIN1252, EUC_JP, …): characters of that encoding, and
 *   a character it lacks is refused (22P05) — `code-page-bytes`, the unit
 *   for a text whose encoding is not Unicode, checked by characters.
 */
export function textUnitOf(encoding: string): TextLengthUnit {
  if (encoding === 'UTF8') return 'code-points'
  if (encoding === 'SQL_ASCII') return 'utf8-bytes'
  return 'code-page-bytes'
}
