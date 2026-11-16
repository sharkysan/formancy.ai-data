import type { NormalizedType, RoutineMeta, RoutineParameter, RoutineType, TextLengthUnit } from '@formancy/data-core'
import type { TransactionSql } from 'postgres'
import { normalizeType } from './types.js'

/**
 * The built-in types a routine's parameter or result may be cast to, by oid,
 * each with its name in pg_catalog (0158): the types a codec speaks, and no
 * other. A later record spells a cast as `pg_catalog.<name>` from this table
 * and from nothing else, so no string a catalog holds ever becomes SQL.
 *
 * Keyed by oid, which PostgreSQL fixes for every built-in type and nobody
 * can give a type of their own: a domain over int4, an enum, a composite or
 * an array has an oid of its own and is not here. Neither is `bpchar`, which
 * pg_proc records without the length that makes it char(n), nor `bytea`,
 * which has no codec. Each entry's oid is what the server answers for its
 * name on every image of the matrix (`discovery-routines.integration.test.ts`).
 */
export const ROUTINE_TYPES: ReadonlyMap<number, string> = new Map([
  [16, 'bool'],
  [20, 'int8'],
  [21, 'int2'],
  [23, 'int4'],
  [25, 'text'],
  [700, 'float4'],
  [701, 'float8'],
  [1043, 'varchar'],
  [1082, 'date'],
  [1083, 'time'],
  [1114, 'timestamp'],
  [1184, 'timestamptz'],
  [1700, 'numeric'],
  [2950, 'uuid'],
])

/** PostgreSQL's `void`, the type a function that returns nothing declares. */
const VOID = 2278

const UNSUPPORTED: NormalizedType = { kind: 'unsupported' }

/**
 * A type a routine declares, from its oid. pg_proc keeps no typmod, so a
 * `varchar(20)` or `numeric(14,2)` parameter is plain varchar or numeric:
 * what it holds is normalised with none, and is unbounded (0158). That is
 * one of the places the two engines differ: SQL Server's catalog keeps a
 * parameter's length, precision and scale.
 */
function routineType(oid: number, spelling: string, textUnit: TextLengthUnit): RoutineType {
  const name = ROUTINE_TYPES.get(oid)
  return {
    databaseType: spelling,
    typeId: String(oid),
    type: name === undefined ? UNSUPPORTED : normalizeType({ name, schema: 'pg_catalog', modifier: -1 }, textUnit),
  }
}

/**
 * The routines discovery reads, of pg_proc `p` in namespace `n`: functions
 * and procedures in scope, and none an extension installed, which an
 * extension's upgrade replaces and which are no deployment's logic. An
 * aggregate (`prokind` 'a') or a window function ('w') is neither of the
 * kinds a `RoutineMeta` is, and could never be an action: not read (0158).
 */
const IN_SCOPE = (schemas: readonly string[], sql: TransactionSql) => sql`
  n.nspname = any(${schemas})
  and p.prokind in ('f', 'p')
  and not exists (
    select from pg_catalog.pg_depend d
    where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and d.objid = p.oid and d.deptype = 'e')`

/** A routine as discovery reads it of pg_proc, and as a run's description reads it again (actions/definition.ts). */
export interface RoutineRow {
  oid: number
  schema: string
  name: string
  kind: 'f' | 'p'
  signature: string
  volatility: string
  returns_set: boolean
  result_type: number
  result_spelling: string
  security_definer: boolean
  executable: boolean
  defaults: number
}

/** One argument of a routine, in the order pg_proc lists it. */
export interface ParameterRow {
  oid: number
  name: string
  mode: string
  type_oid: number
  spelling: string
}

/** pg_proc's argument modes, by their one-letter codes. */
const MODES: Readonly<Record<string, RoutineParameter['mode']>> = { i: 'in', o: 'out', b: 'inout', v: 'variadic', t: 'table' }

/** The modes of the arguments a call passes, which `proargtypes` lists and the only ones a default can belong to. */
const PASSED: ReadonlySet<RoutineParameter['mode']> = new Set(['in', 'inout', 'variadic'])

/** A parameter as it is declared, before whether it has a default is counted. */
export type Declared = Omit<RoutineParameter, 'hasDefault'>

/**
 * Each parameter with whether it has a default: pg_proc counts them, as
 * `pronargdefaults`, and they are always the last of the arguments a call
 * passes. An OUT or TABLE parameter takes no value, and has none.
 */
function withDefaults(declared: readonly Declared[], defaults: number): RoutineParameter[] {
  const first = declared.filter((parameter) => PASSED.has(parameter.mode)).length - defaults
  let passed = 0
  return declared.map((parameter) => {
    if (!PASSED.has(parameter.mode)) return { ...parameter, hasDefault: false }
    passed += 1
    return { ...parameter, hasDefault: passed > first }
  })
}

/**
 * Every function and procedure in scope, with what each takes and returns,
 * and whether this account may execute it (0158).
 *
 * pg_proc shows every role every routine, as pg_class shows it every table
 * (0006), so nothing in scope is hidden and no gap is needed. `executable`
 * is the server's own answer, `has_function_privilege` ANDed with USAGE on
 * the schema, keyed by oid as `readAccess` asks a column's: EXECUTE is
 * PUBLIC's unless revoked, and a grant through a role counts as the server
 * counts it.
 *
 * A routine's parameters are pg_proc's arrays read by position:
 * `proallargtypes` when the routine has an OUT, INOUT, VARIADIC or TABLE
 * argument, `proargtypes` -- in arguments only -- when it has none; the
 * names and modes are indexed alike, and a name PostgreSQL holds as '' is a
 * parameter declared without one. The signature that tells overloads apart
 * is `proargtypes`, what a call passes, each type qualified by its schema.
 * Which of them have a default is `pronargdefaults`, recorded because two
 * overloads that differ by a trailing defaulted parameter make every call by
 * the shorter signature ambiguous (42725): a fact a generator must refuse
 * by, and one SQL Server's catalog does not keep (its adapter says `null`).
 *
 * What a routine changes is what the engine enforces: a STABLE or IMMUTABLE
 * routine reads, and anything VOLATILE -- every procedure -- may write.
 * Whether a STABLE function that calls a VOLATILE one is stopped from
 * writing through it is not checked, so a later record relies on `reads`
 * only inside a read-only transaction. SECURITY DEFINER runs as the
 * routine's owner, beyond the caller's grants.
 *
 * Spelled under the pg_catalog-first search_path discovery sets (0057), so
 * `format_type` spells PostgreSQL's own types bare whatever else the path
 * holds; the spelling is for a person, and the oid is what identifies.
 */
export async function readRoutines(sql: TransactionSql, schemas: readonly string[], textUnit: TextLengthUnit): Promise<RoutineMeta[]> {
  const routines = await sql<RoutineRow[]>`
    select
      p.oid,
      n.nspname as schema,
      p.proname as name,
      p.prokind as kind,
      coalesce((
        select pg_catalog.string_agg(pg_catalog.concat_ws('.', pg_catalog.quote_ident(tn.nspname), pg_catalog.quote_ident(t.typname)), ', ' order by a.position)
        from pg_catalog.unnest(p.proargtypes::pg_catalog.oid[]) with ordinality as a (type_oid, position)
        join pg_catalog.pg_type t on t.oid = a.type_oid
        join pg_catalog.pg_namespace tn on tn.oid = t.typnamespace), '') as signature,
      p.provolatile as volatility,
      p.proretset as returns_set,
      p.prorettype as result_type,
      pg_catalog.format_type(p.prorettype, null) as result_spelling,
      p.prosecdef as security_definer,
      p.pronargdefaults::pg_catalog.int4 as defaults,
      pg_catalog.has_schema_privilege(n.oid, 'USAGE') and pg_catalog.has_function_privilege(p.oid, 'EXECUTE') as executable
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where ${IN_SCOPE(schemas, sql)}`
  const parameters = await sql<ParameterRow[]>`
    select
      p.oid,
      coalesce(p.proargnames[a.position::pg_catalog.int4], '') as name,
      coalesce(p.proargmodes[a.position::pg_catalog.int4], 'i') as mode,
      a.type_oid,
      pg_catalog.format_type(a.type_oid, null) as spelling
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.unnest(coalesce(p.proallargtypes, p.proargtypes::pg_catalog.oid[])) with ordinality as a (type_oid, position)
    where ${IN_SCOPE(schemas, sql)}
    order by p.oid, a.position`

  const byRoutine = new Map<number, Declared[]>()
  for (const row of parameters) {
    const list = byRoutine.get(row.oid) ?? []
    list.push(declaredOf(row, textUnit))
    byRoutine.set(row.oid, list)
  }
  return routines.map((row): RoutineMeta => ({ ...routineOf(row, byRoutine.get(row.oid) ?? [], textUnit), executable: row.executable }))
}

/** One argument as `RoutineParameter` holds it, but for its default. */
export function declaredOf(row: Omit<ParameterRow, 'oid'>, textUnit: TextLengthUnit): Declared {
  const mode = MODES[row.mode]
  // pg_proc has no other mode; one a later release adds is refused, never guessed.
  if (mode === undefined) throw new Error(`a routine's parameter has mode ${JSON.stringify(row.mode)}, which this release does not read`)
  return { name: row.name, mode, ...routineType(row.type_oid, row.spelling, textUnit) }
}

/**
 * A routine from its row and its declared arguments, in order: what
 * discovery records, and what a run's description reads again of the one
 * routine it calls (actions/definition.ts), so the two cannot normalise a
 * routine two ways. Whether the account may execute it is the caller's.
 */
export function routineOf(
  row: Omit<RoutineRow, 'oid' | 'executable'>,
  declared: readonly Declared[],
  textUnit: TextLengthUnit,
): Omit<RoutineMeta, 'executable'> {
  const returns = row.returns_set ? 'set' : row.result_type === VOID ? 'void' : 'scalar'
  return {
    ref: { schema: row.schema, name: row.name, signature: row.signature },
    kind: row.kind === 'p' ? 'procedure' : 'function',
    parameters: withDefaults(declared, row.defaults),
    effects: row.volatility === 's' || row.volatility === 'i' ? 'reads' : 'writes',
    returns,
    result: returns === 'scalar' ? routineType(row.result_type, row.result_spelling, textUnit) : null,
    reach: row.security_definer ? 'owner' : 'account',
  }
}
