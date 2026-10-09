import { canonicalize } from '@formancy/spec'
import { versionColumnProblem } from '../generate/generate.js'
import type { FieldBinding, FormBindings } from '../generate/types.js'
import { bindingsVersionProblem } from '../generate/version.js'
import { lookupFilters } from '../lookup/filters.js'
import type { RowFilters } from '../lookup/types.js'
import { isKeyValue, isLookupKeyType } from '../lookup/values.js'
import type { ColumnMeta, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import type { RowFilter } from '../policy/types.js'
import { findObject } from '../snapshot.js'
import type { PlanRefusal, PlanRefusalCode } from './plan-types.js'
import type { RecordColumn, RecordConcurrency, RecordTarget } from './types.js'

/*
 * The bindings, read against the snapshot they name, before any request is
 * planned from them.
 *
 * The fingerprint proves the snapshot is the one the bindings were generated
 * from; it does not cover the bindings themselves, which are a stored file.
 * So every column a binding names is looked up in that snapshot and must say
 * what the snapshot says, and every type a request carries is the snapshot's.
 */

export function refuse(code: PlanRefusalCode, message: string): PlanRefusal {
  return { ok: false, code, message }
}

/** The root, its columns by name, and the target every request of this form names. */
export interface Prepared {
  root: ObjectMeta
  columns: ReadonlyMap<string, ColumnMeta>
  target: RecordTarget
  /** Whether a record of this form has a key a token can carry, so it can be read and updated at all. */
  addressable: boolean
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

/** The root columns a field writes: its own, or a lookup's foreign-key columns. */
export function columnsOf(binding: FieldBinding): readonly string[] {
  return binding.kind === 'lookup' ? binding.columns : [binding.column]
}

/**
 * Why a field's columns claim more than the account may do with them, or
 * `null` (0027): each must be readable, and each written on an operation must
 * be one the account may INSERT, or UPDATE. The generator never writes such a
 * file; a hand edit can, and the database would refuse what it plans.
 */
function accessProblem(columns: ReadonlyMap<string, ColumnMeta>, binding: FieldBinding): string | null {
  for (const name of columnsOf(binding)) {
    const access = (columns.get(name) as ColumnMeta).access
    if (!access.select) return `${binding.field} is bound to ${name}, which this connection's account may not read`
    if (binding.writes.create && !access.insert) return `${binding.field} is written on create, and this connection's account may not INSERT ${name}`
    if (binding.writes.update && !access.update) return `${binding.field} is written on update, and this connection's account may not UPDATE ${name}`
  }
  return null
}

/** Why a field binding does not fit the root, or `null`. A lookup's target is checked when a selection of it is planned. */
function fieldProblem(root: ObjectMeta, columns: ReadonlyMap<string, ColumnMeta>, binding: FieldBinding): string | null {
  for (const name of columnsOf(binding)) if (!columns.has(name)) return `${binding.field} is bound to ${name}, which the table does not have`
  const access = accessProblem(columns, binding)
  if (access !== null) return access
  if (binding.kind === 'lookup') {
    const foreignKey = root.foreignKeys.find((candidate) => candidate.name === binding.foreignKey)
    if (foreignKey === undefined || !sameList(foreignKey.columns, binding.columns)) {
      return `${binding.field} names columns that are not those of a foreign key ${binding.foreignKey}`
    }
    return null
  }
  const column = columns.get(binding.column) as ColumnMeta
  if (canonicalize(column.type) !== canonicalize(binding.type) || column.nullable !== binding.nullable) {
    return `${binding.field} describes ${binding.column} as something other than what the snapshot says it is`
  }
  return null
}

/**
 * The identity is a key of the root: its primary key or one of its unique
 * keys, column for column. Anything else could name more than one row, and
 * an update guarded by it would change all of them.
 */
function identityProblem(root: ObjectMeta, identity: readonly string[] | null): string | null {
  if (identity === null) return null
  const keys = [...(root.primaryKey === null ? [] : [root.primaryKey]), ...root.uniqueKeys]
  return keys.some((key) => sameList(key.columns, identity)) ? null : `the identity (${identity.join(', ')}) is not a key of the table`
}

/**
 * A rowversion is the engine's. A version column is one every writer through
 * this module increments, held to the rule the generator confirms one by —
 * never the key, a field's column or a generated one — so an update cannot
 * move the record's address or its tenant. `bound` is every column a field is
 * bound to.
 */
function concurrencyProblem(columns: ReadonlyMap<string, ColumnMeta>, bindings: FormBindings, bound: ReadonlySet<string>): string | null {
  const concurrency = bindings.concurrency
  if (concurrency === null) return null
  const column = columns.get(concurrency.column)
  let problem: string | null
  if (column === undefined) problem = 'the table does not have it'
  else if (concurrency.kind === 'rowversion') {
    if (column.type.kind !== 'rowversion') problem = `it is ${column.databaseType}`
    else problem = column.access.select ? null : "this connection's account may not read it"
  }
  else problem = versionColumnProblem(column, bindings.identity ?? [], bound)
  return problem === null ? null : `${concurrency.column} cannot be a ${concurrency.kind}: ${problem}`
}

function bindingsProblem(root: ObjectMeta, columns: ReadonlyMap<string, ColumnMeta>, bindings: FormBindings): string | null {
  if (root.kind !== bindings.rootKind) return `the bindings call ${root.ref.name} a ${bindings.rootKind}, and it is a ${root.kind}`
  const bound = new Set<string>()
  for (const binding of bindings.fields) {
    const problem = fieldProblem(root, columns, binding)
    if (problem !== null) return problem
    for (const name of columnsOf(binding)) {
      // Two fields writing one column would give a create two values for it.
      if (bound.has(name)) return `${name} is bound by two fields`
      bound.add(name)
    }
  }
  for (const name of bindings.identity ?? []) {
    const column = columns.get(name)
    if (column === undefined) return `the identity names ${name}, which the table does not have`
    // A key the account cannot read cannot be read back into a token: it addresses nothing.
    if (!column.access.select) return `the identity names ${name}, which this connection's account may not read`
  }
  return identityProblem(root, bindings.identity) ?? concurrencyProblem(columns, bindings, bound)
}

/**
 * The bindings as a request is planned from them, or the refusal that says
 * why they cannot be trusted: another snapshot's (`drift`), or a file that
 * says something its own snapshot does not (`invalid-bindings`).
 */
export function prepare(snapshot: MetadataSnapshot, bindings: FormBindings): { ok: true; prepared: Prepared } | PlanRefusal {
  const version = bindingsVersionProblem(bindings.version)
  if (version !== null) return refuse('invalid-bindings', `${version}.`)
  if (snapshot.fingerprint !== bindings.snapshotFingerprint) {
    return refuse('drift', 'These bindings were generated from a different snapshot; review the drift before planning a request from them.')
  }
  const root = findObject(snapshot, bindings.root)
  if (root === undefined) return refuse('invalid-bindings', `${bindings.root.schema}.${bindings.root.name} is not in the snapshot.`)
  const columns = new Map(root.columns.map((column) => [column.name, column]))
  const problem = bindingsProblem(root, columns, bindings)
  if (problem !== null) return refuse('invalid-bindings', `The bindings do not fit their snapshot: ${problem}.`)

  const identity = (bindings.identity ?? []).map((name): RecordColumn => ({ name, type: (columns.get(name) as ColumnMeta).type }))
  // An inferred version column is a suggestion, never a guard (0009).
  const concurrency: RecordConcurrency | null =
    bindings.concurrency?.confirmed === true ? { kind: bindings.concurrency.kind, column: bindings.concurrency.column } : null
  return {
    ok: true,
    prepared: {
      root,
      columns,
      target: { table: { ...root.ref }, identity, concurrency },
      addressable: identity.length > 0 && identity.every((column) => isLookupKeyType(column.type)),
    },
  }
}

/** The named columns of the root, in catalog order: one order for every column list a request carries, however it was assembled. */
export function inCatalogOrder(root: ObjectMeta, names: ReadonlySet<string>): RecordColumn[] {
  return root.columns.filter((column) => names.has(column.name)).map((column) => ({ name: column.name, type: column.type }))
}

/**
 * Row filters for a request, each value spelled exactly as its column holds
 * it, as a key value is (0012).
 *
 * A filter term carries no type, so an adapter binds its text and each engine
 * converts it: a tenant of `'042'` is 42 to both, `'acme'` an error on both,
 * and neither is the context the host meant. A trusted value its column
 * cannot hold in that spelling is refused, and a filter on a column with no
 * settled spelling — a float, a timestamp — is a policy that cannot be applied.
 */
export function scopedFilters(object: ObjectMeta, filter: RowFilter, where: string): { ok: true; filters: RowFilters } | PlanRefusal {
  for (const term of filter) {
    const column = object.columns.find((candidate) => candidate.name === term.column)
    if (column === undefined) return refuse('invalid-policy', `${where}: ${object.ref.name} has no column ${term.column}.`)
    if (!isLookupKeyType(column.type)) {
      return refuse('invalid-policy', `${where}: ${term.column} is ${column.databaseType}, which a row filter cannot compare as text.`)
    }
    if (!isKeyValue(column.type, term.value)) {
      return refuse('invalid-context', `${where}: the trusted value for ${term.column} is not spelled as the column holds it; refusing rather than letting each engine convert it.`)
    }
  }
  return { ok: true, filters: lookupFilters(filter) }
}
