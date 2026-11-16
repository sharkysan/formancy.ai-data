import type { CoverageGap, NormalizedType, RoutineMeta, RoutineParameter, RoutineType } from '@formancy/data-core'
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
 * The routines in scope this release does not read, by sys.objects type,
 * each with what a person calls it: a `routines` gap on each says it is
 * there (0158). A CLR routine is not read because none can be made in the
 * suites' containers without an assembly, and a reader no test runs is a
 * claim nobody checked; a replication-filter procedure, made `FOR
 * REPLICATION`, takes no parameters and runs only as replication's filter.
 */
const UNREAD: ReadonlyMap<string, string> = new Map([
  ['PC', 'a CLR procedure'],
  ['FS', 'a CLR scalar function'],
  ['FT', 'a CLR table-valued function'],
  ['RF', 'a replication-filter procedure'],
])

/** The securable a routine is, as HAS_PERMS_BY_NAME must be given it: QUOTENAME'd, for the reason `OBJECT_ACCESS` gives. */
const ROUTINE = `quotename(s.name) + N'.' + quotename(o.name)`

/**
 * Every function and procedure of sys.objects `o` in the schemas the scope
 * names that Microsoft did not ship, read and unread -- a CLR aggregate (AF)
 * is neither, and is not one, as PostgreSQL's aggregates are not -- each
 * with every one of its parameters, one row per parameter, and a scalar
 * function's result, which the catalog files as parameter 0. A routine
 * without parameters, and one not read, is one row with none.
 *
 * Whether the account may call it: EXECUTE on a procedure or a scalar
 * function, and SELECT on a table-valued one, which is selected from and
 * takes no EXECUTE. The server's own check, so a grant through a role and a
 * DENY's precedence count as the server counts them.
 *
 * A char or varchar parameter takes the database's default collation, so
 * its code page -- what its length counts (0026) -- is the database's.
 *
 * Of the routines `where` names, a condition on sys.objects `o` and
 * sys.schemas `s`: those in scope, for discovery, and the one routine a
 * run's description reads again (actions/definition.ts, 0160), so the two
 * cannot read one routine two ways.
 */
export const ROUTINE_ROWS = (where: string): string => `
  select r.object_id, r.schema_name, r.routine_name, r.type, r.access_object, r.can_execute,
    p.parameter_id, p.name as parameter_name, p.user_type_id, p.max_length, p.precision, p.scale, p.is_output,
    t.name as type_name, schema_name(t.schema_id) as type_schema, t.is_user_defined, st.name as system_name,
    convert(int, collationproperty(convert(nvarchar(128), databasepropertyex(db_name(), 'Collation')), 'CodePage')) as code_page
  from (
    select o.object_id, s.name as schema_name, o.name as routine_name, rtrim(o.type) as type, ${ROUTINE} as access_object,
      case
        when o.type in ('P', 'FN') then has_perms_by_name(${ROUTINE}, N'OBJECT', N'EXECUTE')
        when o.type in ('IF', 'TF') then has_perms_by_name(${ROUTINE}, N'OBJECT', N'SELECT')
      end as can_execute
    from sys.objects o
    join sys.schemas s on s.schema_id = o.schema_id
    where o.type in ('P', 'FN', 'IF', 'TF', 'PC', 'FS', 'FT', 'RF') and o.is_ms_shipped = 0 and ${where}
  ) r
  left join sys.parameters p on p.object_id = r.object_id and r.type in ('P', 'FN', 'IF', 'TF')
  left join sys.types t on t.user_type_id = p.user_type_id
  left join sys.types st on st.user_type_id = p.system_type_id`

/** Every routine in the schemas the scope names, in object_id and parameter order. */
const ROUTINES_SQL = (_scoped: string, schemaList: string): string => `${ROUTINE_ROWS(`s.name in (${schemaList})`)}
  order by r.object_id, p.parameter_id`

/** What the statement says of the routine on every one of its rows. */
export interface RoutineRow {
  object_id: number
  schema_name: string
  routine_name: string
  type: string
  access_object: string | null
  /** HAS_PERMS_BY_NAME's answer, for a routine this release reads; NULL for one it does not. */
  can_execute: number | null
}

/** One parameter of the routine, or its result, as the row carries it. */
export interface ParameterRow {
  parameter_id: number
  parameter_name: string
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

/** A row of the statement: the routine, with one of its parameters, or with none -- a routine that has none, or one not read. */
export type CatalogRow = RoutineRow & (ParameterRow | { parameter_id: null })

const hasParameter = (row: CatalogRow): row is RoutineRow & ParameterRow => row.parameter_id !== null

/**
 * A declared type: spelled as a column of it is, normalised only when its
 * user_type_id is in the table, and identified by that id with the length,
 * precision and scale that size it -- which, unlike PostgreSQL's pg_proc,
 * the catalog keeps for a parameter. `hidden` when sys.types does not show
 * the account the declared type, as for a column (columns.ts).
 */
function routineType(row: ParameterRow): RoutineType & { hidden: boolean } {
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
    hidden: column.hidden,
  }
}

/**
 * Every T-SQL procedure and function in scope that this account can see,
 * with what each takes and returns, and whether it may call it -- and a
 * `routines` gap on each routine it cannot describe (0158).
 *
 * The catalog is filtered by permission (0007): a routine the account holds
 * nothing on is not listed, and nor are its parameters. Whether that can
 * have hidden one is `routineGaps`' to say (visibility.ts), so "no routine"
 * and "cannot tell" stay different answers.
 *
 * One statement, each routine joined to its parameters on object_id,
 * rather than two side by side: a routine dropped and made again between
 * two statements could be recorded with another's parameters. Under READ
 * COMMITTED a statement is still not one consistent read, and an ALTER that
 * commits while it runs is not claimed to be seen whole; `createSnapshot`
 * refuses what no catalog could produce, and drift review sees the change
 * next time, as for the tables (discover.ts).
 */
export async function readRoutines(pool: ConnectionPool, schemas: readonly string[]): Promise<{ routines: RoutineMeta[]; gaps: CoverageGap[] }> {
  return routinesOf(await queryScope<CatalogRow>(pool, schemas, ROUTINES_SQL))
}

/**
 * The routines and gaps the statement's rows say, grouped by routine.
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
 * - A T-SQL parameter's default is not in the catalog: sys.parameters'
 *   `has_default_value` is kept for CLR routines alone, so whether one has a
 *   default is `null`, where PostgreSQL's pg_proc says.
 * - A procedure returns its RETURN status, the integer every procedure has,
 *   and no result: `void`. A scalar function's result is parameter 0.
 * - A parameter's alias type the account holds nothing on is not in
 *   sys.types for it: recorded as unsupported, spelled as its base type, and
 *   said by a gap on the routine, as a column's is (columns.ts).
 */
export function routinesOf(rows: readonly CatalogRow[]): { routines: RoutineMeta[]; gaps: CoverageGap[] } {
  const routines: RoutineMeta[] = []
  const gaps: CoverageGap[] = []
  for (const group of groupBy(rows, (row) => row.object_id).values()) {
    const [row] = group as [CatalogRow, ...CatalogRow[]]
    const subject = { kind: 'object', object: { schema: row.schema_name, name: row.routine_name } } as const
    const unread = UNREAD.get(row.type)
    if (unread !== undefined) {
      gaps.push({
        subject,
        aspect: 'routines',
        detail: `${row.schema_name}.${row.routine_name} is ${unread}, which this release does not read, so it is not among the routines recorded`,
      })
      continue
    }
    const hidden: Hidden = (label, base) =>
      gaps.push({
        subject,
        aspect: 'routines',
        detail: `${label}: its user-defined type is hidden from this account, so it is recorded as unsupported${base === null ? '' : `, spelled as its base type ${base}`}`,
      })
    routines.push(toRoutine(row, group.filter(hasParameter), hidden))
  }
  return { routines, gaps }
}

/** Says that a parameter's or the result's declared type is hidden from the account, with the base type it is spelled as, when the catalog names one. */
type Hidden = (label: string, base: string | null) => void

/**
 * One routine from its row and its parameters' rows. A NULL from
 * HAS_PERMS_BY_NAME is a name it could not resolve, which quoting rules
 * out: read as "no", a quoting slip would take a routine away for a reason
 * nobody could see, so it is a defect, said, as for a column (access.ts).
 * A scalar function whose result row is missing is handed on without one,
 * and `createSnapshot` refuses it as no catalog's.
 */
function toRoutine(row: RoutineRow, declared: readonly ParameterRow[], hidden: Hidden): RoutineMeta {
  const permission = row.type === 'IF' || row.type === 'TF' ? 'SELECT' : 'EXECUTE'
  if (row.can_execute === null) throw new Error(`HAS_PERMS_BY_NAME could not resolve ${row.access_object ?? '(unnamed routine)'} for ${permission}`)
  const typed = (parameter: ParameterRow, label: string): RoutineType => {
    const { hidden: isHidden, ...type } = routineType(parameter)
    if (isHidden) hidden(label, parameter.system_name === null ? null : type.databaseType)
    return type
  }
  const result = declared.find((parameter) => parameter.parameter_id === 0)
  const kind = row.type === 'P' ? 'procedure' : 'function'
  const returns = row.type === 'P' ? 'void' : row.type === 'FN' ? 'scalar' : 'set'
  return {
    ref: { schema: row.schema_name, name: row.routine_name, signature: '' },
    kind,
    parameters: declared
      .filter((parameter) => parameter.parameter_id > 0)
      .map((parameter): RoutineParameter => ({
        name: parameter.parameter_name,
        mode: parameter.is_output ? 'inout' : 'in',
        hasDefault: null,
        ...typed(parameter, `parameter ${parameter.parameter_name}`),
      })),
    effects: kind === 'procedure' ? 'writes' : 'reads',
    returns,
    result: returns === 'scalar' && result !== undefined ? typed(result, 'its result') : null,
    reach: 'owner',
    executable: row.can_execute === 1,
  }
}
