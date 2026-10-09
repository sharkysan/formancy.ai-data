import type { ColumnMeta, Generation } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import type { Found, ObjectGap } from './catalog.js'
import { byObjectId, groupBy, queryScope } from './catalog.js'
import { normalizeType } from './types.js'

interface ColumnRow {
  object_id: number
  column_id: number
  name: string
  type_name: string | null
  type_schema: string | null
  is_user_defined: boolean | null
  system_name: string | null
  max_length: number
  precision: number
  scale: number
  /** The code page of the column's collation; `null` for a type that has none, and for a collation the server does not know. */
  code_page: number | null
  is_nullable: boolean
  is_identity: boolean
  is_computed: boolean
  generated_always_type: number
  default_object_id: number
  default_name: string | null
  default_definition: string | null
  comment: string | null
}

/**
 * Columns, their types, how they are generated, their defaults and comments.
 *
 * Every join is a LEFT join, because each joined row is something this account
 * may not be allowed to see while it may see the column: the declared type
 * (a user-defined type is a securable of its own), the default's definition,
 * the comment. An inner join would drop the column, and a dropped column reads
 * as a table that never had it.
 *
 * A default is read through OBJECT_DEFINITION rather than
 * sys.default_constraints, because a default bound with the deprecated
 * sp_bindefault is a default too and is not a constraint. Both are NULL
 * without VIEW DEFINITION. Identity and computed come from sys.columns' own
 * flags: sys.identity_columns and sys.computed_columns add the seed, the
 * increment and the expression, none of which the contract carries.
 *
 * The code page is read from the column's own collation, never the
 * database's: a column may be declared under any collation, and the fixture's
 * UTF-8 varchar sits in a database whose default is code page 1252. It says
 * what a char or varchar length counts (0026).
 */
const SQL = (scoped: string): string => `
  select c.object_id, c.column_id, c.name,
    t.name as type_name, schema_name(t.schema_id) as type_schema, t.is_user_defined,
    st.name as system_name,
    c.max_length, c.precision, c.scale,
    convert(int, collationproperty(c.collation_name, 'CodePage')) as code_page,
    c.is_nullable, c.is_identity, c.is_computed, c.generated_always_type,
    c.default_object_id, object_name(c.default_object_id) as default_name,
    object_definition(c.default_object_id) as default_definition,
    cast(ep.value as nvarchar(max)) as comment
  from sys.columns c
  left join sys.types t on t.user_type_id = c.user_type_id
  left join sys.types st on st.user_type_id = c.system_type_id
  left join sys.extended_properties ep
    on ep.class = 1 and ep.major_id = c.object_id and ep.minor_id = c.column_id and ep.name = N'MS_Description'
  where c.object_id in ${scoped}
  order by c.object_id, c.column_id`

/** The name sys.types gives rowversion's system type: its deprecated synonym. */
const ROWVERSION_SYSTEM_TYPE = 'timestamp'

/** One bracketed name as SQL Server stores it in a definition, a `]` inside it doubled. */
const BRACKETED = String.raw`\[(?:[^\]]|\]\])+\]`

/**
 * A default that is exactly the next value of one sequence, as SQL Server
 * stores the definition: `(NEXT VALUE FOR [schema].[name])`, however it was
 * written. One that computes with the value has more around it.
 */
const NEXT_VALUE = new RegExp(String.raw`^\(NEXT VALUE FOR (?:${BRACKETED}\.){0,2}${BRACKETED}\)$`, 'i')

/**
 * How the column gets its value.
 *
 * IDENTITY is `identity-always`: an insert that names it is refused (544)
 * unless IDENTITY_INSERT is on, which needs ALTER on the table, and an update
 * of it is refused outright (8102). SQL Server has no BY DEFAULT identity; a
 * default of NEXT VALUE FOR a sequence is what takes its place, and behaves as
 * PostgreSQL's does: it numbers a row an insert leaves out, takes a value
 * given to it, and a value given by hand collides with the sequence later
 * (2627, measured). It is `identity-by-default`, and keeps its default (0026).
 * Its definition is read without VIEW DEFINITION only as NULL, and then the
 * column cannot be told from an ordinary default: it is `none`, and the
 * snapshot's `defaults` gap says the definition was hidden.
 *
 * A period column (GENERATED ALWAYS AS ROW START or END) is written by the
 * database and refused in an insert, which is what `computed` tells a form
 * generator; `none` would offer it as an input.
 */
function generation(row: ColumnRow): Generation {
  if (row.is_identity) return 'identity-always'
  if (row.system_name === ROWVERSION_SYSTEM_TYPE) return 'rowversion'
  if (row.is_computed || row.generated_always_type !== 0) return 'computed'
  if (row.default_definition !== null && NEXT_VALUE.test(row.default_definition)) return 'identity-by-default'
  return 'none'
}

function toColumn(row: ColumnRow, gaps: ObjectGap[]): ColumnMeta {
  const { databaseType, type, hidden } = normalizeType({
    typeName: row.type_name,
    typeSchema: row.type_schema,
    isUserDefined: row.is_user_defined,
    systemName: row.system_name,
    maxLength: row.max_length,
    precision: row.precision,
    scale: row.scale,
    codePage: row.code_page,
  })
  if (hidden) {
    gaps.push({
      objectId: row.object_id,
      aspect: 'columns',
      detail:
        type.kind === 'unsupported'
          ? `${row.name}: its type is hidden from this account, so it is reported as unsupported`
          : `${row.name}: its user-defined type is hidden from this account, so it is reported as its base type ${databaseType}`,
    })
  }

  const hasDefault = row.default_object_id !== 0
  // A default always has a definition. NULL means this account may not read
  // it -- SQL Server returns NULL rather than refusing -- and that is a gap,
  // not an absence.
  if (hasDefault && row.default_definition === null) {
    gaps.push({
      objectId: row.object_id,
      aspect: 'defaults',
      detail: `${row.name}: the definition of its default ${row.default_name ?? '(unnamed)'} is hidden without VIEW DEFINITION`,
    })
  }

  return {
    name: row.name,
    ordinal: row.column_id,
    databaseType,
    type,
    nullable: row.is_nullable,
    hasDefault,
    defaultExpression: row.default_definition,
    generated: generation(row),
    comment: row.comment,
  }
}

export async function readColumns(pool: ConnectionPool, schemas: readonly string[]): Promise<Found<ColumnMeta[]>> {
  const rows = await queryScope<ColumnRow>(pool, schemas, SQL)
  const gaps: ObjectGap[] = []
  const byObject = new Map<number, ColumnMeta[]>()
  for (const [objectId, group] of groupBy(rows, byObjectId)) {
    byObject.set(objectId, group.map((row) => toColumn(row, gaps)))
  }
  return { byObject, gaps }
}
