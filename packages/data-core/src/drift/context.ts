import type { FieldBinding, FormBindings } from '../generate/types.js'
import type { ForeignKeyMeta, KeyMeta, MetadataSnapshot, ObjectMeta, ObjectRef } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import type { DriftKind, DriftSubject } from './types.js'

/** A write the published form may offer. */
export type Operation = 'create' | 'update'

/**
 * A change before its severity is known. The severity depends on the form as
 * well as the change, so it is decided once, in one place, from these.
 */
export interface Draft {
  kind: DriftKind
  subject: DriftSubject
  affects: string[]
  message: string
  /** The writes this change makes unsafe. */
  stops: readonly Operation[]
  /** The published form can no longer even show what it binds. Stops every write, and blocks a read-only form too. */
  breaksReads: boolean
  /** The severity when nothing it stops is something this form offers. */
  otherwise: 'review' | 'info'
}

/** The writes a change stops: every one, when the form can no longer read what it binds. */
export function stopped(draft: Draft): readonly Operation[] {
  return draft.breaksReads ? ['create', 'update'] : draft.stops
}

/** One review: the two snapshots, the form, its policy's lookup filters, and its root in each. */
export interface Comparison {
  base: MetadataSnapshot
  current: MetadataSnapshot
  bindings: FormBindings
  /**
   * The published policy's lookup filters: the target columns each lookup's
   * searches compare, which the bindings do not record (0028). The root's
   * filter columns are bound columns (`validatePolicy`), compared as such.
   */
  policy: Pick<FormPolicy, 'lookups'>
  before: ObjectMeta
  after: ObjectMeta
  /**
   * Gaps a change has already given as the reason something is missing. A gap
   * that explains a vanished column is said once, on the column, and not again
   * on its own, provided the column's change stops everything the gap would.
   */
  cited: Set<string>
}

/** Codepoint order, never `localeCompare`, for the reason `snapshot.ts` gives. */
export function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function refKey(ref: ObjectRef | null): string {
  return ref === null ? '' : `${ref.schema}\u0000${ref.name}`
}

export function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.schema === right.schema && left.name === right.name
}

export function describe(ref: ObjectRef): string {
  return `${ref.schema}.${ref.name}`
}

export function list(names: readonly string[]): string {
  return names.join(', ')
}

export function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => right[index] === name)
}

export function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name) => right.includes(name))
}

/** The primary key, then the unique keys: every key a record can be identified or referenced by. */
export function candidateKeys(object: ObjectMeta): KeyMeta[] {
  return [...(object.primaryKey === null ? [] : [object.primaryKey]), ...object.uniqueKeys]
}

/** The root's columns a binding reads and writes. */
function columnsOf(binding: FieldBinding): string[] {
  return binding.kind === 'lookup' ? binding.columns : [binding.column]
}

/** The fields whose bindings name any of `columns`, in the form's order. */
export function fieldsOver(bindings: FormBindings, columns: readonly string[]): string[] {
  return bindings.fields.filter((binding) => columnsOf(binding).some((name) => columns.includes(name))).map((binding) => binding.field)
}

/** Whether a field gives `column` its value on `operation` (0027: a field is written per operation). */
export function writesOn(bindings: FormBindings, column: string, operation: Operation): boolean {
  return bindings.fields.some((binding) => binding.writes[operation] && columnsOf(binding).includes(column))
}

/** The operations on which a field gives `column` its value. */
export function writtenOn(bindings: FormBindings, column: string): Operation[] {
  return (['create', 'update'] as const).filter((operation) => writesOn(bindings, column, operation))
}

/** Whether a field gives `column` its value on any operation. */
export function writesAny(bindings: FormBindings, column: string): boolean {
  return writtenOn(bindings, column).length > 0
}

export function allFields(bindings: FormBindings): string[] {
  return bindings.fields.map((binding) => binding.field)
}

export function lookups(bindings: FormBindings): Array<Extract<FieldBinding, { kind: 'lookup' }>> {
  return bindings.fields.filter((binding) => binding.kind === 'lookup')
}

/*
 * What the bindings promise the base snapshot has, or a refusal naming it.
 * `diffSnapshots` calls each of these once on entry, so a later call for the
 * same thing cannot fail; using one function for both is what keeps the
 * promise and the check from drifting apart.
 */

export function objectIn(snapshot: MetadataSnapshot, ref: ObjectRef): ObjectMeta {
  const found = snapshot.objects.find((object) => sameRef(object.ref, ref))
  if (found === undefined) throw new Error(`the bindings name ${describe(ref)}, which the base snapshot does not have`)
  return found
}

export function foreignKeyIn(object: ObjectMeta, name: string): ForeignKeyMeta {
  const found = object.foreignKeys.find((foreignKey) => foreignKey.name === name)
  if (found === undefined) throw new Error(`the bindings name foreign key ${name} of ${describe(object.ref)}, which the base snapshot does not have`)
  return found
}

/** The key the identity rests on: one whose columns are the identity's, in its order. */
export function identityKeyIn(object: ObjectMeta, identity: readonly string[]): KeyMeta {
  const found = candidateKeys(object).find((key) => sameList(key.columns, identity))
  if (found === undefined) throw new Error(`the bindings name identity (${list(identity)}), which no key of the base snapshot covers`)
  return found
}
