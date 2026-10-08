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
 */
const SQL = (scoped: string): string => `
  select c.object_id, c.column_id, c.name,
    t.name as type_name, schema_name(t.schema_id) as type_schema, t.is_user_defined,
    st.name as system_name,
    c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed, c.generated_always_type,
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

/**
 * How the column gets its value. A period column (GENERATED ALWAYS AS ROW
 * START or END) is written by the database and refused in an insert, which is
 * what `computed` tells a form generator; `none` would offer it as an input.
 */
function generation(row: ColumnRow): Generation {
  if (row.is_identity) return 'identity'
  if (row.system_name === ROWVERSION_SYSTEM_TYPE) return 'rowversion'
  if (row.is_computed || row.generated_always_type !== 0) return 'computed'
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
