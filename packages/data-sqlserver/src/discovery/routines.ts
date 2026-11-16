import type { NormalizedType, RoutineMeta, RoutineParameter, RoutineType } from '@formancy/data-core'
import type { ConnectionPool } from 'mssql'
import { groupBy, queryScope } from './catalog.js'
import { normalizeType } from './types.js'

/**
 * The types a routine's parameter or result may be declared with, by
 * user_type_id, each with its name (0158): the system types a codec speaks,
 * and no other. A later record declares a variable or casts an argument as
 * this name, sized from the parameter's own length, precision and scale, and
 * from nothing else, so no string a catalog holds ever becomes SQL.
 *
 * Keyed by user_type_id, which is a system type's own id for a system type
 * and an id of its own for every alias and table type: `create type
 * sales.money_amount from decimal(14, 2)` and `sysname` (256, over nvarchar)
 * are not here, though their system_type_id is. Neither are binary,
 * varbinary and rowversion, which have no codec, nor xml, sql_variant and
 * the CLR types. Each entry's id is what `TYPE_ID` answers for its name on
 * every image of the matrix (`discovery-routines.integration.test.ts`).
 */
export const ROUTINE_TYPES: ReadonlyMap<number, string> = new Map([
  [36, 'uniqueidentifier'],
  [40, 'date'],
  [41, 'time'],
  [42, 'datetime2'],
  [43, 'datetimeoffset'],
  [48, 'tinyint'],
  [52, 'smallint'],
  [56, 'int'],
  [58, 'smalldatetime'],
  [59, 'real'],
  [60, 'money'],
  [61, 'datetime'],
  [62, 'float'],
  [104, 'bit'],
  [106, 'decimal'],
  [108, 'numeric'],
  [122, 'smallmoney'],
  [127, 'bigint'],
  [167, 'varchar'],
  [175, 'char'],
  [231, 'nvarchar'],
  [239, 'nchar'],
])

const UNSUPPORTED: NormalizedType = { kind: 'unsupported' }

/**
 * The routines discovery reads, of sys.objects `o`: T-SQL procedures (P),
 * scalar functions (FN), and inline and multi-statement table-valued
 * functions (IF, TF), in the schemas the scope names -- never one Microsoft
 * shipped. A CLR routine (PC, FS, FT) is not read: none can be made in the
 * suites' containers without an assembly, and a reader no test runs is a
 * claim nobody checked (0158).
 */
const ROUTINE_OBJECT = `o.type in ('P', 'FN', 'IF', 'TF') and o.is_ms_shipped = 0`

/** The securable a routine is, as HAS_PERMS_BY_NAME must be given it: QUOTENAME'd, for the reason `OBJECT_ACCESS` gives. */
const ROUTINE = `quotename(s.name) + N'.' + quotename(o.name)`

/**
 * Whether the account may call it: EXECUTE on a procedure or a scalar
 * function, and SELECT on a table-valued one, which is selected from and
 * takes no EXECUTE. The server's own check, so a grant through a role and a
 * DENY's precedence count as the server counts them.
 */
const ROUTINES_SQL = (_scoped: string, schemaList: string): string => `
  select o.object_id, s.name as schema_name, o.name as routine_name, rtrim(o.type) as type,
    ${ROUTINE} as access_object,
    has_perms_by_name(${ROUTINE}, N'OBJECT', case when o.type in ('IF', 'TF') then N'SELECT' else N'EXECUTE' end) as can_execute
  from sys.objects o
  join sys.schemas s on s.schema_id = o.schema_id
  where ${ROUTINE_OBJECT} and s.name in (${schemaList})`

/**
 * Each routine's parameters in order, and a scalar function's result, which
 * the catalog files as parameter 0. A char or varchar parameter takes the
 * database's default collation, so its code page -- what its length
 * counts (0026) -- is the database's.
 */
const PARAMETERS_SQL = (_scoped: string, schemaList: string): string => `
  select p.object_id, p.parameter_id, p.name, p.user_type_id, p.max_length, p.precision, p.scale, p.is_output,
    t.name as type_name, schema_name(t.schema_id) as type_schema, t.is_user_defined, st.name as system_name,
    convert(int, collationproperty(convert(nvarchar(128), databasepropertyex(db_name(), 'Collation')), 'CodePage')) as code_page
  from sys.parameters p
  join sys.objects o on o.object_id = p.object_id
  join sys.schemas s on s.schema_id = o.schema_id
  left join sys.types t on t.user_type_id = p.user_type_id
  left join sys.types st on st.user_type_id = p.system_type_id
  where ${ROUTINE_OBJECT} and s.name in (${schemaList})
  order by p.object_id, p.parameter_id`

export interface RoutineRow {
  object_id: number
  schema_name: string
  routine_name: string
  type: 'P' | 'FN' | 'IF' | 'TF'
  access_object: string | null
  can_execute: number | null
}

export interface ParameterRow {
  object_id: number
  parameter_id: number
  name: string
  user_type_id: number
  max_length: number
  precision: number
  scale: number
  is_output: boolean
  type_name: string | null
  type_schema: string | null
  is_user_defined: boolean | null
  system_name: string | null
  code_page: number | null
}

/**
 * A declared type: spelled as a column of it is, normalised only when its
 * user_type_id is in the table, and identified by that id with the length,
 * precision and scale that size it -- which, unlike PostgreSQL's pg_proc,
 * the catalog keeps for a parameter.
 */
function routineType(row: ParameterRow): RoutineType {
  const column = normalizeType({
    typeName: row.type_name,
    typeSchema: row.type_schema,
    isUserDefined: row.is_user_defined,
    systemName: row.system_name,
    maxLength: row.max_length,
    precision: row.precision,
    scale: row.scale,
    codePage: row.code_page,
  })
  return {
    databaseType: column.databaseType,
    typeId: `${String(row.user_type_id)}:${String(row.max_length)}:${String(row.precision)}:${String(row.scale)}`,
    type: ROUTINE_TYPES.has(row.user_type_id) ? column.type : UNSUPPORTED,
  }
}

/**
 * Every T-SQL procedure and function in scope that this account can see,
 * with what each takes and returns, and whether it may call it (0158).
 *
 * The catalog is filtered by permission (0007): a routine the account holds
 * nothing on is not listed, and nor are its parameters. Whether that can
 * have hidden one is `routineGaps`' to say (visibility.ts), so "no routine"
 * and "cannot tell" stay different answers.
 *
 * Engine facts written down rather than smoothed over:
 *
 * - A function cannot change data: SQL Server refuses a write inside one at
 *   CREATE. Every function `reads`, and every procedure may write.
 * - Ownership chaining: a module reaches its owner's objects without the
 *   caller's grants, with or without EXECUTE AS, so every routine's reach is
 *   the owner's (measured for a procedure and a scalar function in
 *   `discovery-routines.integration.test.ts`).
 * - An OUTPUT parameter also takes a value in, and is `inout`.
 * - A procedure returns its RETURN status, the integer every procedure has,
 *   and no result: `void`. A scalar function's result is parameter 0.
 */
export async function readRoutines(pool: ConnectionPool, schemas: readonly string[]): Promise<RoutineMeta[]> {
  const [routines, parameters] = await Promise.all([
    queryScope<RoutineRow>(pool, schemas, ROUTINES_SQL),
    queryScope<ParameterRow>(pool, schemas, PARAMETERS_SQL),
  ])
  const byRoutine = groupBy(parameters, (row) => row.object_id)
  return routines.map((row) => toRoutine(row, byRoutine.get(row.object_id) ?? []))
}

/**
 * One routine from its row and its parameters' rows. A NULL from
 * HAS_PERMS_BY_NAME is a name it could not resolve, which quoting rules
 * out: read as "no", a quoting slip would take a routine away for a reason
 * nobody could see, so it is a defect, said, as for a column (access.ts).
 * A scalar function whose result row is missing is handed on without one,
 * and `createSnapshot` refuses it as no catalog's.
 */
export function toRoutine(row: RoutineRow, declared: readonly ParameterRow[]): RoutineMeta {
  if (row.can_execute === null) throw new Error(`HAS_PERMS_BY_NAME could not resolve ${row.access_object ?? '(unnamed routine)'} for EXECUTE`)
  const result = declared.find((parameter) => parameter.parameter_id === 0)
  const kind = row.type === 'P' ? 'procedure' : 'function'
  const returns = row.type === 'P' ? 'void' : row.type === 'FN' ? 'scalar' : 'set'
  return {
    ref: { schema: row.schema_name, name: row.routine_name, signature: '' },
    kind,
    parameters: declared
      .filter((parameter) => parameter.parameter_id > 0)
      .map((parameter): RoutineParameter => ({ name: parameter.name, mode: parameter.is_output ? 'inout' : 'in', ...routineType(parameter) })),
    effects: kind === 'procedure' ? 'writes' : 'reads',
    returns,
    result: returns === 'scalar' && result !== undefined ? routineType(result) : null,
    reach: 'owner',
    executable: row.can_execute === 1,
  }
}
