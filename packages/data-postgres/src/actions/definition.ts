import type { DescribedRoutine, ObjectRef, RoutineRef, TextLengthUnit } from '@formancy/data-core'
import { declaredOf, routineOf } from '../discovery/routines.js'
import type { RoutineRow } from '../discovery/routines.js'
import { op } from '../sql/catalog.js'
import { quoteIdentifier } from '../sql/identifiers.js'
import { Statement } from '../sql/statement.js'
import { digestOf } from '../records/definition.js'
import { described } from '../records/sql.js'
import type { RecordStatement } from '../records/sql.js'

/*
 * The routine's definition on PostgreSQL (0160), beside the root's (0041):
 * what one statement reads of the routine's pg_proc row -- the facts -- and
 * the digest of them a run's call is guarded by.
 *
 * The routine is found by `to_regprocedure` of its schema, its name and its
 * signature, the argument types a call passes (0158), quoted: the lookup a
 * call by exactly those types resolves to, so the guard reads the routine
 * the call will run, whatever overload was created beside it. Every
 * argument of the call is cast to its bound type (statements.ts), and an
 * exact match is never passed over for one that needs a cast.
 *
 * The facts hold what no session setting changes, each oid as a number,
 * which jsonb would otherwise spell as text: the routine's oid -- a
 * DROP and CREATE gives another, as for a table -- its schema and name, its
 * kind, each argument's name, mode and type oid in order, its result type,
 * whether it returns a set, its volatility, SECURITY DEFINER, STRICT, and
 * how many arguments have a default. Never its body, which is the
 * deployment's logic and changes as their system does (0159), and never who
 * may execute it: a grant is not a new definition. Each type's spelling,
 * which `format_type` qualifies by the search_path, travels beside the facts
 * for the description alone and is never digested, as the root's spellings
 * are.
 *
 * A STRICT routine is described as `strict`, and no run calls it: given a
 * NULL argument PostgreSQL does not call it and answers NULL in its place,
 * so a run over a record whose field is NULL would move the version, commit
 * and answer done for a call that never happened.
 *
 * The facts are read from pg_proc as a query reads a table, under the
 * statement's snapshot; the call finds and runs the routine through the
 * catalog cache, which holds what was last committed. On the read-committed
 * path the call statement's snapshot is taken as it starts, so the two read
 * one catalog. On the locked path (0041) it is the transaction's, taken
 * when the lock statement began, and an ALTER FUNCTION, or a CREATE OR
 * REPLACE that keeps the oid, committed while that statement waited for a
 * row is not in it. So a description carries, beside the facts' digest, the
 * digest of the routine's whole definition as `pg_get_functiondef` prints
 * it from the cache, its body included, and on the locked path the call is
 * guarded by that too (statements.ts): the routine it runs is the one
 * described, read as the call reads it.
 */

/** The routine `ref` names, by the types a call passes, as `to_regprocedure` reads it: each part quoted, the signature as discovery spells it. */
export function procedureOf(ref: RoutineRef): string {
  return `${quoteIdentifier(ref.schema)}.${quoteIdentifier(ref.name)}(${ref.signature})`
}

/** The pg_proc row `p`, in namespace `n`, of the routine whose procedure text `procedure` binds: a function or a procedure, of no extension. */
function ofRoutine(procedure: string, select: string): string {
  return `(select ${select}
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid ${op('=')} p.pronamespace
  where p.oid ${op('=')} pg_catalog.to_regprocedure(${procedure})
    and (p.prokind ${op('=')} 'f' or p.prokind ${op('=')} 'p')
    and not exists (
      select from pg_catalog.pg_depend d
      where d.classid ${op('=')} 'pg_catalog.pg_proc'::pg_catalog.regclass and d.objid ${op('=')} p.oid and d.deptype ${op('=')} 'e'))`
}

/** Every argument of `p`, in order: `proallargtypes` where it has an OUT, INOUT, VARIADIC or TABLE one, `proargtypes` otherwise, as discovery reads them. */
const ARGUMENTS = `pg_catalog.unnest(coalesce(p.proallargtypes, p.proargtypes::pg_catalog.oid[])) with ordinality as a (type_oid, position)`

const FACTS = `pg_catalog.jsonb_build_object(
  'oid', p.oid::pg_catalog.int8,
  'schema', n.nspname,
  'name', p.proname,
  'kind', p.prokind,
  'volatility', p.provolatile,
  'returns_set', p.proretset,
  'result_type', p.prorettype::pg_catalog.int8,
  'security_definer', p.prosecdef,
  'strict', p.proisstrict,
  'defaults', p.pronargdefaults,
  'parameters', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      coalesce(p.proargnames[a.position::pg_catalog.int4], ''), coalesce(p.proargmodes[a.position::pg_catalog.int4], 'i'), a.type_oid::pg_catalog.int8
    ) order by a.position)
    from ${ARGUMENTS}), '[]'::pg_catalog.jsonb))`

const SPELLINGS = `pg_catalog.jsonb_build_object(
  'result', pg_catalog.format_type(p.prorettype, null),
  'parameters', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.format_type(a.type_oid, null) order by a.position)
    from ${ARGUMENTS}), '[]'::pg_catalog.jsonb))`

/** The routine's facts, as text, NULL when there is no such routine: what the call's guard digests again, the same expression. */
export function routineFactsOf(statement: Statement, ref: RoutineRef): string {
  return `${ofRoutine(statement.text(procedureOf(ref)), FACTS)}::pg_catalog.text`
}

/**
 * The routine's whole definition as the catalog cache holds it, what
 * `pg_get_functiondef` prints, NULL when there is no such routine: found by
 * `to_regprocedure` and read from the cache, as the call finds and runs it,
 * never under the transaction's snapshot. A function or a procedure alone,
 * asked first, since `pg_get_functiondef` refuses an aggregate, which a
 * DROP and CREATE could put in its place.
 */
export function currentDefinitionOf(statement: Statement, ref: RoutineRef): string {
  const procedure = `pg_catalog.to_regprocedure(${statement.text(procedureOf(ref))})`
  return `(case when exists (select from pg_catalog.pg_proc p where p.oid ${op('=')} ${procedure} and (p.prokind ${op('=')} 'f' or p.prokind ${op('=')} 'p'))
  then pg_catalog.pg_get_functiondef(${procedure}::pg_catalog.oid) end)`
}

/**
 * The root and the routine, as one row: the root's description as a
 * record's describe reads it (records/sql.ts), then the routine's facts,
 * their digest, their spellings, and the digest of its whole definition as
 * the catalog cache holds it. One statement, so the two were read from one
 * snapshot of the catalog (0041). The derived table is kept from being
 * pulled up, as the root's is, so each fact is computed once.
 */
export function describeActionStatement(table: ObjectRef, ref: RoutineRef): RecordStatement {
  const statement = new Statement()
  const root = described(statement, table)
  const facts = routineFactsOf(statement, ref)
  const spellings = `${ofRoutine(statement.text(procedureOf(ref)), SPELLINGS)}::pg_catalog.text`
  const current = currentDefinitionOf(statement, ref)
  return {
    text: `select ${root.columns.join(', ')}, "a"."facts", ${digestOf('"a"."facts"')}, "a"."spellings", ${digestOf('"a"."current"')}
from ${root.from}
cross join (select ${facts} as "facts", ${spellings} as "spellings", ${current} as "current" offset 0) as "a"`,
    params: statement.params,
  }
}

type ParameterFact = [string, string, number]

interface Facts {
  schema: string
  name: string
  kind: 'f' | 'p'
  volatility: string
  returns_set: boolean
  result_type: number
  security_definer: boolean
  strict: boolean
  defaults: number
  parameters: ParameterFact[]
}

/** What one description read of the routine, each as the statement returned it: NULL where there is no such routine. */
export interface RoutineRead {
  facts: string | null
  digest: string | null
  spellings: string | null
  current: string | null
}

/**
 * The routine as the statement described it, normalised by discovery's own
 * functions (`routineOf`, `declaredOf`), so a description and a snapshot
 * cannot read one routine two ways; `undefined` when there were no facts:
 * no routine of that signature, or one discovery would not describe; and
 * `strict` for a STRICT routine, which no run calls (above). Its ref is the
 * one asked for: `to_regprocedure` found exactly that schema, name and
 * signature. `definition` is what the call is guarded by, the facts'
 * digest and the whole definition's (`routineDigest`).
 */
export function describedRoutineFrom(ref: RoutineRef, read: RoutineRead, textUnit: TextLengthUnit): DescribedRoutine | 'strict' | undefined {
  const { facts, digest, spellings, current } = read
  if (facts === null || digest === null || spellings === null || current === null) return undefined
  const parsed = JSON.parse(facts) as Facts
  if (parsed.strict) return 'strict'
  const spelled = JSON.parse(spellings) as { result: string; parameters: string[] }
  // Both are one statement's read of the same pg_proc row.
  if (spelled.parameters.length !== parsed.parameters.length) throw new Error("the routine's facts and their spellings disagree about its arguments")
  const row: Omit<RoutineRow, 'oid' | 'executable'> = {
    schema: parsed.schema,
    name: parsed.name,
    kind: parsed.kind,
    signature: ref.signature,
    volatility: parsed.volatility,
    returns_set: parsed.returns_set,
    result_type: parsed.result_type,
    result_spelling: spelled.result,
    security_definer: parsed.security_definer,
    defaults: parsed.defaults,
  }
  const declared = parsed.parameters.map(([name, mode, typeOid], index) =>
    declaredOf({ name, mode, type_oid: typeOid, spelling: spelled.parameters[index] as string }, textUnit),
  )
  return { ...routineOf(row, declared, textUnit), definition: `${digest}:${current}` }
}

/** What a run's call is guarded by: the digest of the routine's facts, and of its whole definition as the catalog cache holds it. */
export interface RoutineDefinition {
  facts: string
  current: string
}

const TOKEN = /^([0-9a-f]{64}):([0-9a-f]{64})$/

/** A routine's definition this adapter made, or a programming error: another adapter's, or one made by hand. */
export function routineDigest(token: string): RoutineDefinition {
  const found = typeof token === 'string' ? TOKEN.exec(token) : null
  if (found === null)
    throw new Error("A run carries the definition this adapter described the routine with: the facts' SHA-256 and the whole definition's, in hex.")
  return { facts: found[1] as string, current: found[2] as string }
}
