import type { DatabaseKind } from './adapter.js'
import type { DiscoveryScope, MetadataSnapshot, NormalizedType, NormalizedTypeKind, TextLengthUnit } from './metadata.js'

/*
 * The routines a snapshot records, when its scope asks for them (0158): the
 * functions and procedures in the approved schemas, with what each takes,
 * what it returns, what it changes as the engine enforces it, whether it may
 * act beyond its caller's grants, and whether the snapshot's account may
 * execute it. What a later record may bind as an action; nothing binds, runs
 * or shows one yet.
 *
 * Every function and procedure in scope that this release reads is
 * recorded, the ones no action could bind included, with the facts that say
 * why: a set-returning function, an OUT parameter, a parameter of a type no
 * codec speaks. One in scope that it does not read -- SQL Server's CLR and
 * replication-filter routines -- is a `routines` gap on that routine, never
 * left out with nothing said, which would read as one that does not exist:
 * the silent answer (0004).
 *
 * Not a routine in this contract's sense, and so neither recorded nor
 * gapped: what is neither a function nor a procedure -- PostgreSQL's
 * aggregates and window functions, SQL Server's CLR aggregates -- which no
 * action could ever be; the functions an extension installs; the routines
 * Microsoft ships.
 */

/**
 * A routine, as three strings and never one dotted string.
 *
 * `signature` tells PostgreSQL's overloads apart: the types of the arguments
 * a call passes -- in, inout and variadic, in order -- each as its type's
 * schema and name, quoted as PostgreSQL quotes an identifier, joined by ", ".
 * Qualified, so the spelling does not depend on a session's search_path.
 * SQL Server has no overloads, and its signature is ''.
 */
export interface RoutineRef {
  schema: string
  name: string
  signature: string
}

/** A type a routine declares, for a parameter or a scalar result. */
export interface RoutineType {
  /** As the database spells it, for a person reading a report: never put in a statement. */
  databaseType: string
  /**
   * The engine's own identity for the type, in the fingerprint: PostgreSQL's
   * type oid; SQL Server's `user_type_id:max_length:precision:scale`, the
   * declared type -- an alias type's own id, not its base's -- with what
   * sizes it. An adapter spells a cast only from its own closed table of the
   * built-in types a codec speaks, keyed by this, and from nothing else.
   */
  typeId: string
  /**
   * What it holds. `unsupported` for every type outside the adapter's table:
   * a domain, an enum, a composite, an array, an alias or table type, a
   * binary -- reported, so a generator can say why it refuses the routine.
   */
  type: NormalizedType
}

/**
 * How a parameter passes its value, as the catalog says. A SQL Server OUTPUT
 * parameter also takes one in, and is `inout`. `table` is PostgreSQL's alone:
 * a column of what a RETURNS TABLE function returns, which pg_proc files as
 * an argument. A set's shape is described nowhere else -- not for RETURNS
 * SETOF, nor for a SQL Server table-valued function -- so it is not a fact
 * the two engines are compared on.
 */
export type ParameterMode = 'in' | 'out' | 'inout' | 'variadic' | 'table'

export interface RoutineParameter extends RoutineType {
  /** As the catalog spells it: SQL Server's with its `@`, and '' for a PostgreSQL parameter declared without a name. */
  name: string
  mode: ParameterMode
  /**
   * Whether a call may leave it out, as the catalog says, and `null` where
   * the catalog does not say. PostgreSQL's: the last `pronargdefaults` of
   * the arguments a call passes have a default, and no other parameter does.
   * There it decides more than a dialog: two overloads that differ only by
   * a trailing parameter with a default make every call by the shorter
   * signature ambiguous (42725), named or cast. SQL Server's catalog keeps
   * no T-SQL parameter's default, so every one there is `null`.
   */
  hasDefault: boolean | null
}

export interface RoutineMeta {
  ref: RoutineRef
  kind: 'function' | 'procedure'
  /** In the order the routine declares them, which is the order a call passes them. */
  parameters: RoutineParameter[]
  /**
   * What the routine changes, as the engine enforces it, never as a comment
   * says: PostgreSQL's STABLE and IMMUTABLE read, and so does every SQL
   * Server function, which the engine refuses to let write.
   */
  effects: 'reads' | 'writes'
  /** `void` for nothing, `scalar` for one value, `set` for rows. A SQL Server procedure is `void`: its RETURN status is the integer every procedure has. */
  returns: 'void' | 'scalar' | 'set'
  /** The type a `scalar` routine returns, and `null` for any other. */
  result: RoutineType | null
  /** It may act beyond the account's own grants: SECURITY DEFINER on PostgreSQL; on SQL Server every routine, by ownership chaining. */
  reach: 'account' | 'owner'
  /** The account may call it, as the database's own privilege check answered at discovery (0027): what was true then. */
  executable: boolean
  /**
   * Whether the engine calls the routine when an argument is NULL (0167):
   * `not-called` for PostgreSQL's STRICT (RETURNS NULL ON NULL INPUT) and
   * a SQL Server function declared RETURNS NULL ON NULL INPUT, which the
   * engine answers NULL for without running its body; `called` for every
   * other, and for every procedure, which neither engine lets declare it.
   *
   * Absent where it was not read: in every snapshot taken before 0167, and
   * on SQL Server for a function whose module row the catalog does not show
   * the account. Never `null` beside absence -- one fact in two spellings
   * would hash two ways -- and never guessed either way: absent is unknown.
   * Absent, the key is not hashed, so a snapshot stored before 0167 keeps
   * the fingerprint it was published with.
   */
  onNull?: RoutineOnNull
}

/** Whether the engine calls a routine when an argument is NULL, as `RoutineMeta.onNull` records it (0167). */
export type RoutineOnNull = 'called' | 'not-called'

/** Every value of each closed field, as a record so that a new one is a compile error here until it is listed. */
const KINDS: Readonly<Record<RoutineMeta['kind'], true>> = { function: true, procedure: true }
const EFFECTS: Readonly<Record<RoutineMeta['effects'], true>> = { reads: true, writes: true }
const RETURNS: Readonly<Record<RoutineMeta['returns'], true>> = { void: true, scalar: true, set: true }
const REACHES: Readonly<Record<RoutineMeta['reach'], true>> = { account: true, owner: true }
const ON_NULL: Readonly<Record<RoutineOnNull, true>> = { called: true, 'not-called': true }
const MODES: Readonly<Record<ParameterMode, true>> = { in: true, out: true, inout: true, variadic: true, table: true }
const TYPE_KINDS: Readonly<Record<NormalizedTypeKind, true>> = {
  text: true,
  boolean: true,
  integer: true,
  decimal: true,
  float: true,
  date: true,
  time: true,
  timestamp: true,
  uuid: true,
  binary: true,
  rowversion: true,
  enum: true,
  unsupported: true,
}
const TEXT_UNITS: Readonly<Record<TextLengthUnit, true>> = { 'code-points': true, 'utf16-code-units': true, 'utf8-bytes': true, 'code-page-bytes': true }

const isListed = (record: Readonly<Record<string, true>>, value: unknown): boolean => typeof value === 'string' && Object.hasOwn(record, value)
const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Codepoint order, for the reason `createSnapshot`'s gives. */
const byCodepoint = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

/** A routine as a person reads its name: `sales.ship_order(pg_catalog.int8)`, and on SQL Server `sales.ship_order()`. */
export function describeRoutine(ref: RoutineRef): string {
  return `${ref.schema}.${ref.name}(${ref.signature})`
}

/** A type read back from JSON, held to what the contract names: nothing about its shape is assumed. */
function assertType(at: string, value: unknown): void {
  if (!isRecord(value)) throw new Error(`${at} is not a type`)
  if (typeof value['databaseType'] !== 'string') throw new Error(`${at} has no database type`)
  if (!isName(value['typeId'])) throw new Error(`${at} has no type id`)
  const type = value['type']
  if (!isRecord(type) || !isListed(TYPE_KINDS, type['kind'])) throw new Error(`${at} has a type that is not one the contract names`)
  if (type['kind'] === 'text' && !isListed(TEXT_UNITS, type['lengthUnit'])) throw new Error(`${at} is text with no length unit`)
  // A routine's types are read by oid among PostgreSQL's own (0158): an enum's never is, so one here was written by hand (0170).
  if (type['kind'] === 'enum') throw new Error(`${at} is an enum, and a routine's type is read among the engine's own types only`)
}

/** What no catalog could have produced of one routine, refused naming it. */
function assertRoutine(kind: DatabaseKind, routine: unknown): RoutineMeta {
  const ref = isRecord(routine) ? routine['ref'] : undefined
  if (!isRecord(ref) || !isName(ref['schema']) || !isName(ref['name']) || typeof ref['signature'] !== 'string') {
    throw new Error(`a routine's ref is not one the contract names: ${ref === undefined ? 'none' : JSON.stringify(ref)}`)
  }
  const fields = routine as Record<string, unknown>
  const where = describeRoutine(ref as unknown as RoutineRef)
  if (kind === 'sqlserver' && ref['signature'] !== '') throw new Error(`${where}: SQL Server has no overloads, so a routine's signature is empty`)
  if (!isListed(KINDS, fields['kind'])) throw new Error(`${where}: kind ${JSON.stringify(fields['kind'])} is not one the contract names`)
  if (!isListed(EFFECTS, fields['effects'])) throw new Error(`${where}: effects ${JSON.stringify(fields['effects'])} is not one the contract names`)
  if (!isListed(RETURNS, fields['returns'])) throw new Error(`${where}: returns ${JSON.stringify(fields['returns'])} is not one the contract names`)
  if (!isListed(REACHES, fields['reach'])) throw new Error(`${where}: reach ${JSON.stringify(fields['reach'])} is not one the contract names`)
  if (typeof fields['executable'] !== 'boolean') throw new Error(`${where}: executable is not a boolean`)
  // Absent is "not read" (0167); present, it is one of the two. A key set to
  // `undefined` or `null` is neither, and would hash otherwise than absence.
  if (Object.hasOwn(fields, 'onNull') && !isListed(ON_NULL, fields['onNull']))
    throw new Error(`${where}: onNull ${JSON.stringify(fields['onNull']) ?? 'undefined'} is not one the contract names`)
  // Neither engine has the option for a procedure: CREATE PROCEDURE takes no STRICT, and no RETURNS NULL ON NULL INPUT.
  if (fields['kind'] === 'procedure' && fields['onNull'] === 'not-called') throw new Error(`${where}: a procedure is called whatever its arguments`)
  // A scalar names what it returns, and nothing else names a result: a void
  // routine has none, and a set's rows are not one type on either engine.
  if (fields['returns'] === 'scalar') assertType(`${where}: its result`, fields['result'])
  else if (fields['result'] !== null) throw new Error(`${where}: returns ${String(fields['returns'])} and names a result`)
  const parameters = fields['parameters']
  if (!Array.isArray(parameters)) throw new Error(`${where}: parameters is not a list`)
  parameters.forEach((parameter: unknown, index) => {
    const at = `${where}: parameter ${String(index + 1)}`
    assertType(at, parameter)
    const { name, mode, hasDefault } = parameter as Record<string, unknown>
    if (typeof name !== 'string') throw new Error(`${at} has a name that is not a string`)
    if (!isListed(MODES, mode)) throw new Error(`${at} has a mode ${JSON.stringify(mode)} that is not one the contract names`)
    if (typeof hasDefault !== 'boolean' && hasDefault !== null) throw new Error(`${at} has a default that is neither a boolean nor null`)
  })
  return routine as RoutineMeta
}

/**
 * The routines a snapshot carries, checked and in codepoint order of schema,
 * name and signature -- or `undefined` when its scope did not ask for them.
 *
 * Present exactly when the scope asks (0158): a scope without `routines`
 * reads nothing more and makes the snapshot it made before, to the byte, so
 * every snapshot and bundle stored before this record keeps its fingerprint.
 * An empty list is an answer -- asked, and none in scope -- and is not the
 * absence of one. A `routines` gap is carried only where the scope asked,
 * too: a server older than this record refuses the aspect, and that cost
 * stays with the snapshots that asked only while no other carries one. Read
 * back from JSON, so nothing about the shape is assumed.
 */
export function checkedRoutines(input: Pick<MetadataSnapshot, 'kind' | 'routines' | 'gaps'> & { scope: DiscoveryScope }): RoutineMeta[] | undefined {
  const asked = (input.scope as { routines?: unknown }).routines
  const routines = input.routines as unknown
  if (asked !== undefined && asked !== true) throw new Error(`the scope asks for routines as ${JSON.stringify(asked)}, which is neither true nor absent`)
  if (asked === undefined) {
    if (routines !== undefined) throw new Error('the snapshot records routines its scope did not ask for')
    if (input.gaps.some((gap) => gap.aspect === 'routines')) throw new Error('the snapshot has a routines gap and its scope did not ask for routines')
    return undefined
  }
  if (!Array.isArray(routines)) throw new Error('the scope asks for routines and the snapshot has no list of them: an adapter that did not read them')
  const checked = routines.map((routine) => assertRoutine(input.kind, routine))
  const seen = new Set<string>()
  for (const { ref } of checked) {
    const key = `${ref.schema}\u0000${ref.name}\u0000${ref.signature}`
    if (seen.has(key)) throw new Error(`${describeRoutine(ref)} is reported twice`)
    seen.add(key)
  }
  return checked.sort((a, b) => byCodepoint(a.ref.schema, b.ref.schema) || byCodepoint(a.ref.name, b.ref.name) || byCodepoint(a.ref.signature, b.ref.signature))
}

/**
 * Whether a snapshot records routines: its scope asked for them (0158). Drift
 * compares what concerns routines only between two snapshots that both do,
 * as it compares what refers to a table only between two that record that
 * (0049): one that did not look never saw a routine.
 */
export function recordsRoutines(snapshot: Pick<MetadataSnapshot, 'routines'>): boolean {
  return snapshot.routines !== undefined
}
