import { createHash } from 'node:crypto'
import type { DescribedRoutine, ObjectRef, RoutineRef } from '@formancy/data-core'
import { ROUTINE_ROWS, routinesOf } from '../discovery/routines.js'
import type { CatalogRow } from '../discovery/routines.js'
import { digestOf } from '../records/definition.js'
import { described, tableName } from '../records/statements.js'
import { Parameters } from '../sql/statement.js'
import type { Statement } from '../sql/statement.js'

/*
 * The routine's definition on SQL Server (0160), beside the root's (0041):
 * the facts one statement reads of the procedure's catalog, as one FOR JSON
 * text, and its SHA-256 by HASHBYTES, which a run's batch checks just
 * before its EXEC.
 *
 * The procedure is found by OBJECT_ID of its quoted name, bound, as the
 * EXEC resolves it. The facts hold its object_id -- a DROP and CREATE gives
 * another -- its schema, name and type, the principal it executes as, and
 * each parameter's id, name, system and user type, length, precision, scale
 * and direction, in order. EXECUTE AS is SQL Server's SECURITY DEFINER:
 * ownership chaining lets every procedure reach its owner's tables (0158),
 * and stops at dynamic SQL, at an object another principal owns and at
 * another database, where EXECUTE AS OWNER, or a user named, reaches with
 * that principal's permissions. sys.sql_modules' `execute_as_principal_id`
 * -- NULL for the caller, -2 for the owner, else the principal -- is read by
 * the account the run goes as, in the description and in the run alike, so
 * it agrees with itself even where that account cannot see it. Never its
 * text, which is the deployment's logic (0159), and never `modify_date`,
 * which an ALTER of the body moves. A grant is not a new definition.
 *
 * The description is discovery's own read of the procedure
 * (`ROUTINE_ROWS`, `routinesOf`), scoped to the one object, as FOR JSON,
 * so a description and a snapshot cannot read one routine two ways.
 */

/** The facts of the procedure whose quoted name the parameter `name` holds, as one JSON text; NULL when there is no such procedure. */
export function routineFactsOf(name: string): string {
  return `(select o.object_id as [object], rtrim(o.type) as [type], schema_name(o.schema_id) as [schema], o.name as [name],
    (select m.execute_as_principal_id from sys.sql_modules as m where m.object_id = o.object_id) as [execute_as],
    (select p.parameter_id as [id], p.name as [name], p.system_type_id as [system], p.user_type_id as [user], p.max_length as [length],
      p.precision as [precision], p.scale as [scale], p.is_output as [output], p.is_readonly as [readonly]
      from sys.parameters as p where p.object_id = o.object_id order by p.parameter_id for json path, include_null_values) as [parameters]
  from sys.objects as o
  where o.object_id = object_id(${name}) and o.type = 'P' and o.is_ms_shipped = 0
  for json path, without_array_wrapper, include_null_values)`
}

/** The routine as an EXEC names it, bound as `object_id` reads it. */
export function routineName(parameters: Parameters, ref: RoutineRef): string {
  return tableName(parameters, { schema: ref.schema, name: ref.name })
}

/**
 * The root and the routine, as one row: the root's facts and digest, then
 * the routine's, and discovery's catalog rows of it as FOR JSON. One
 * statement, so the two were read under one statement's locks (0041).
 */
export function describeActionStatement(table: ObjectRef, ref: RoutineRef): Statement {
  const parameters = new Parameters()
  const root = described(parameters, table)
  const name = routineName(parameters, ref)
  const catalog = `(${ROUTINE_ROWS(`o.object_id = object_id(${name})`)} order by r.object_id, p.parameter_id for json path, include_null_values)`
  return parameters.statement(
    `select ${root.columns.map((column) => `${column.expression} as ${column.name}`).join(', ')}, [g].[routine], ${digestOf('[g].[routine]')} as [routine_digest], [g].[catalog]
from ${root.from} cross join (select ${routineFactsOf(name)} as [routine], ${catalog} as [catalog]) as [g]`,
  )
}

/**
 * The routine as the statement described it, `undefined` when there is no
 * procedure of that name -- dropped, out of sight, or not a T-SQL
 * procedure -- and `cut` when the facts that arrived are not the facts that
 * were hashed, a TEXTSIZE shorter than them, as for a table.
 */
export function describedRoutineFrom(facts: string | null, digest: Buffer | null, catalog: string | null): DescribedRoutine | 'cut' | undefined {
  if (facts === null || digest === null || catalog === null) return undefined
  if (!createHash('sha256').update(Buffer.from(facts, 'utf16le')).digest().equals(digest)) return 'cut'
  const { routines } = routinesOf(JSON.parse(catalog) as CatalogRow[])
  const [routine] = routines
  if (routine === undefined || routines.length !== 1) return undefined
  const { executable: _executable, ...rest } = routine
  return { ...rest, definition: digest.toString('hex') }
}

const DIGEST = /^[0-9a-f]{64}$/

/** A routine's definition this adapter made, as bytes to bind; another adapter's, or one made by hand, is a programming error. */
export function routineDigest(token: string): Buffer {
  if (typeof token !== 'string' || !DIGEST.test(token))
    throw new Error('A run carries the definition this adapter described the routine with: a SHA-256 in hex.')
  return Buffer.from(token, 'hex')
}
