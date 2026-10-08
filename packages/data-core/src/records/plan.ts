import type { ApiValue } from '../codecs/codec.js'
import { codecFor } from '../codecs/codec.js'
import { decodeRowversion } from '../codecs/rowversion.js'
import type { FormBindings } from '../generate/types.js'
import { buildLookupConfig } from '../lookup/config.js'
import type { LookupConfig, RowFilters } from '../lookup/types.js'
import { isKeyValue, isLookupKeyType } from '../lookup/values.js'
import type { ColumnMeta, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { checkSubmittedFields, forcedValues, lookupRowFilter, readableFields, rowFilter } from '../policy/evaluate.js'
import type { FormPolicy, PolicyContext, RowFilter } from '../policy/types.js'
import { findObject } from '../snapshot.js'
import { columnAnswer, lookupAnswer } from './answers.js'
import type { FieldError, InvalidValues, MembershipCheck, PlannedInsert, PlannedRead, PlannedUpdate, PlanRefusal } from './plan-types.js'
import { columnsOf, inCatalogOrder, prepare, type Prepared, refuse, scopedFilters } from './prepare.js'
import { decodeRecordKey } from './token.js'
import type { RecordColumn, RecordValue } from './types.js'

/*
 * The one place a request from a browser becomes a request to an adapter:
 * where the policy, the codecs, the tokens and the bindings meet, so both
 * adapters receive the same typed request for the same answers, and neither
 * decides anything this file decides.
 *
 * Each planner checks, in this order: the bindings against their snapshot,
 * whether the form offers the operation, the shape of the answers, the
 * policy, the record token and the version, and then every answer through its
 * column's codec. A refusal at any step is the answer; nothing is planned from
 * a partial check.
 *
 * The policy is asked for the root's filter first, which authorises the
 * operation and scopes it to the tenant, and then for the fields — which also
 * fits the policy to the form, and refuses over-posting. Each of those
 * functions authorises on its own (0011), so whichever ran second could never
 * refuse for a reason the first had not; in this order each guards something.
 *
 * Pure and isomorphic: no I/O and no clock. What cannot be decided without the
 * database — whether a selected row is one this actor may reference — is
 * returned as a membership check for the caller to run before it writes.
 */

/** The answers by field key, own properties only, so `constructor` is never found on a prototype. */
function readAnswers(answers: unknown): { ok: true; answers: ReadonlyMap<string, unknown> } | PlanRefusal {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return refuse('invalid-request', 'The answers are an object of field keys and values.')
  }
  return { ok: true, answers: new Map(Object.entries(answers)) }
}

function unaddressable(prepared: Prepared): PlanRefusal {
  return refuse(
    'operation-unavailable',
    prepared.target.identity.length === 0
      ? 'This form identifies no record: the table has no primary or unique key.'
      : 'This form cannot address a record: a key column has no settled spelling for a token.',
  )
}

function invalid(errors: FieldError[]): InvalidValues {
  return { ok: false, code: 'invalid-values', message: `${errors.map((error) => error.field).join(', ')} cannot be written`, fieldErrors: errors }
}

/** Values in the root's catalog order, however they were assembled. */
function inCatalogValues(root: ObjectMeta, values: readonly RecordValue[]): RecordValue[] {
  const position = new Map(root.columns.map((column, index) => [column.name, index]))
  return [...values].sort((left, right) => (position.get(left.name) as number) - (position.get(right.name) as number))
}

/** The root's filter for an operation, each value spelled as its column holds it. */
function filtersFor(prepared: Prepared, policy: FormPolicy, context: PolicyContext, operation: 'read' | 'update'): { ok: true; filter: RowFilter; filters: RowFilters } | PlanRefusal {
  const filter = rowFilter(policy, context, operation)
  if (!filter.ok) return filter
  const scoped = scopedFilters(prepared.root, filter.filter, 'rowFilters')
  return scoped.ok ? { ok: true, filter: filter.filter, filters: scoped.filters } : scoped
}

/**
 * The columns to read back: the key, when a token can carry it, and the
 * columns of every field the actor may see. Nothing else, so a column the
 * policy keeps from this actor is never fetched.
 */
function readColumns(prepared: Prepared, bindings: FormBindings, fields: readonly string[]): RecordColumn[] {
  const names = new Set<string>(prepared.addressable ? prepared.target.identity.map((column) => column.name) : [])
  const wanted = new Set(fields)
  for (const binding of bindings.fields) if (wanted.has(binding.field)) for (const name of columnsOf(binding)) names.add(name)
  return inCatalogOrder(prepared.root, names)
}

/** What a write reads back, and the fields `toFormAnswers` may show: nothing but the key for an actor who may not read. */
function readBack(prepared: Prepared, bindings: FormBindings, policy: FormPolicy, context: PolicyContext): { fields: string[]; returning: RecordColumn[] } {
  const readable = readableFields(policy, context, bindings)
  const fields = readable.ok ? readable.fields : []
  return { fields, returning: readColumns(prepared, bindings, fields) }
}

interface DecodedAnswers {
  values: RecordValue[]
  errors: FieldError[]
  /** Each lookup answered with a token, by field key: what `rejects` is asked about. */
  selections: Array<[string, string]>
}

/**
 * Every answer through its column's codec, in the form's order, collecting
 * every error rather than stopping at the first. On create, a field left out
 * whose column the database would refuse to leave NULL is an error too: NOT
 * NULL, no default, not generated and not pinned. One with a default is left
 * out of the request, which is how the default applies.
 */
function decodeAnswers(
  prepared: Prepared,
  bindings: FormBindings,
  answers: ReadonlyMap<string, unknown>,
  fixed: ReadonlyMap<string, ApiValue>,
  operation: 'create' | 'update',
): DecodedAnswers {
  const decoded: DecodedAnswers = { values: [], errors: [], selections: [] }
  for (const binding of bindings.fields) {
    const columns = columnsOf(binding).map((name) => prepared.columns.get(name) as ColumnMeta)
    if (!answers.has(binding.field)) {
      const required = columns.some((column) => !fixed.has(column.name) && !column.nullable && !column.hasDefault && column.generated === 'none')
      if (operation === 'create' && required) decoded.errors.push({ field: binding.field, code: 'required', message: 'A value is required.' })
      continue
    }
    const answer = answers.get(binding.field)
    const outcome = binding.kind === 'column' ? columnAnswer(binding, columns[0] as ColumnMeta, answer, fixed) : lookupAnswer(binding, columns, answer, fixed)
    if (!outcome.ok) {
      decoded.errors.push(outcome.error)
      continue
    }
    decoded.values.push(...outcome.values)
    if (binding.kind === 'lookup' && typeof answer === 'string') decoded.selections.push([binding.field, answer])
  }
  return decoded
}

/**
 * What the caller asks `rejects` before writing: each selection, the config
 * derived from the bindings and their snapshot, and the actor's filters on
 * the lookup's target. A lookup that cannot be configured offers no options,
 * so a selection of it cannot be rechecked and the request is refused.
 */
function membershipChecks(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  policy: FormPolicy,
  context: PolicyContext,
  operation: 'create' | 'update',
  selections: ReadonlyArray<[string, string]>,
): { ok: true; checks: MembershipCheck[] } | PlanRefusal {
  const checks: MembershipCheck[] = []
  for (const [field, token] of selections) {
    const filter = lookupRowFilter(policy, context, bindings, operation, field)
    if (!filter.ok) return filter
    let config: LookupConfig
    try {
      config = buildLookupConfig(bindings, field, { snapshot })
    } catch (error) {
      // buildLookupConfig throws an Error naming what it refused, and nothing else.
      return refuse('invalid-bindings', `${field} cannot be rechecked: ${(error as Error).message}`)
    }
    // buildLookupConfig found the target in this snapshot, or it would have thrown.
    const scoped = scopedFilters(findObject(snapshot, config.target) as ObjectMeta, filter.filter, `lookups.${field}`)
    if (!scoped.ok) return scoped
    checks.push({ field, config, tokens: [token], filters: scoped.filters })
  }
  return { ok: true, checks }
}

/**
 * The record a token names, for the columns this actor may read, under the
 * actor's filters — or why not. `fields` is what `toFormAnswers` shows.
 *
 * The key is always read, even when its field is not readable: the record
 * token is the address the actor already holds, and the next one is made from it.
 */
export function planRead(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy, context: PolicyContext, recordToken: string): PlannedRead {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return ready
  const { prepared } = ready
  if (!prepared.addressable) return unaddressable(prepared)
  const filters = filtersFor(prepared, policy, context, 'read')
  if (!filters.ok) return filters
  const readable = readableFields(policy, context, bindings)
  if (!readable.ok) return readable
  const key = decodeRecordKey(prepared.target.identity, recordToken)
  if (!key.ok) return refuse('invalid-record-token', key.message)
  return {
    ok: true,
    request: { target: prepared.target, key: key.key, columns: readColumns(prepared, bindings, readable.fields), filters: filters.filters },
    fields: readable.fields,
  }
}

/** The pinned columns a create writes from the context, through their columns' codecs. */
function pinnedValues(prepared: Prepared, policy: FormPolicy, context: PolicyContext): { ok: true; values: RecordValue[] } | PlanRefusal {
  const forced = forcedValues(policy, context)
  if (!forced.ok) return forced
  const scoped = scopedFilters(prepared.root, forced.values, 'rowFilters')
  if (!scoped.ok) return scoped
  const values: RecordValue[] = []
  for (const { column: name, value } of forced.values) {
    const column = prepared.columns.get(name) as ColumnMeta
    const parsed = codecFor(column).parse(value)
    if (!parsed.ok) return refuse('invalid-policy', `rowFilters: ${name} cannot be written from the context: ${parsed.message}`)
    values.push({ name, type: column.type, value: parsed.value })
  }
  return { ok: true, values }
}

/**
 * The insert for a person's answers — or why not, or which fields are wrong.
 *
 * Over-posting is refused before any value is read. The tenant is written
 * from the context; an omitted field is left out so the database's default
 * applies; every selection is returned in `memberships`, to be rechecked
 * under the actor's filters before the insert runs.
 */
export function planCreate(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy, context: PolicyContext, answers: unknown): PlannedInsert {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return ready
  const { prepared } = ready
  if (!bindings.operations.create) return refuse('operation-unavailable', 'This form does not offer create.')
  const submitted = readAnswers(answers)
  if (!submitted.ok) return submitted
  const pinned = pinnedValues(prepared, policy, context)
  if (!pinned.ok) return pinned
  const allowed = checkSubmittedFields(policy, context, bindings, 'create', [...submitted.answers.keys()])
  if (!allowed.ok) return allowed

  const fixed = new Map(pinned.values.map((entry) => [entry.name, entry.value]))
  const decoded = decodeAnswers(prepared, bindings, submitted.answers, fixed, 'create')
  if (decoded.errors.length > 0) return invalid(decoded.errors)
  const memberships = membershipChecks(snapshot, bindings, policy, context, 'create', decoded.selections)
  if (!memberships.ok) return memberships

  const { fields, returning } = readBack(prepared, bindings, policy, context)
  return {
    ok: true,
    request: { target: prepared.target, values: inCatalogValues(prepared.root, [...pinned.values, ...decoded.values]), returning },
    fields,
    memberships: memberships.checks,
  }
}

/** Whether a version is one this target's concurrency could have returned: a rowversion's hex, or a canonical integer in the column's range. */
function versionFits(prepared: Prepared, kind: 'rowversion' | 'version-column', column: string, version: unknown): boolean {
  if (typeof version !== 'string') return false
  if (kind === 'rowversion') return decodeRowversion(version) !== undefined
  const type = (prepared.columns.get(column) as ColumnMeta).type
  return isLookupKeyType(type) && isKeyValue(type, version)
}

/**
 * The update for a person's answers, guarded by the key, the actor's filters
 * and the version they read — or why not, or which fields are wrong.
 *
 * A patch: an omitted field is not mentioned, an explicit null clears where
 * the column allows it. The key and the pinned columns are never set: a key
 * field equal to the record's is accepted and dropped, a different one is
 * refused, and a selection that carries the tenant must carry this one.
 */
export function planUpdate(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  policy: FormPolicy,
  context: PolicyContext,
  recordToken: string,
  expectedVersion: string,
  answers: unknown,
): PlannedUpdate {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return ready
  const { prepared } = ready
  if (!bindings.operations.update) return refuse('operation-unavailable', 'This form does not offer update.')
  const concurrency = prepared.target.concurrency
  if (concurrency === null) {
    return refuse('operation-unavailable', 'Update needs a confirmed concurrency token, and this form has none: a stale save could not be detected.')
  }
  if (!prepared.addressable) return unaddressable(prepared)
  const submitted = readAnswers(answers)
  if (!submitted.ok) return submitted
  const filters = filtersFor(prepared, policy, context, 'update')
  if (!filters.ok) return filters
  const allowed = checkSubmittedFields(policy, context, bindings, 'update', [...submitted.answers.keys()])
  if (!allowed.ok) return allowed
  const key = decodeRecordKey(prepared.target.identity, recordToken)
  if (!key.ok) return refuse('invalid-record-token', key.message)
  if (!versionFits(prepared, concurrency.kind, concurrency.column, expectedVersion)) {
    return refuse('invalid-version', `This is not a version a ${concurrency.kind} returns.`)
  }

  const fixed = new Map<string, ApiValue>(filters.filter.map((term) => [term.column, term.value]))
  for (const part of key.key) if (!fixed.has(part.name)) fixed.set(part.name, part.value)
  const decoded = decodeAnswers(prepared, bindings, submitted.answers, fixed, 'update')
  if (decoded.errors.length > 0) return invalid(decoded.errors)
  // No statement sets nothing alike on both engines, so an empty patch is refused here, once.
  if (decoded.values.length === 0) return refuse('nothing-to-update', 'These answers change no column.')
  const memberships = membershipChecks(snapshot, bindings, policy, context, 'update', decoded.selections)
  if (!memberships.ok) return memberships

  const { fields, returning } = readBack(prepared, bindings, policy, context)
  return {
    ok: true,
    request: {
      target: { ...prepared.target, concurrency },
      key: key.key,
      set: inCatalogValues(prepared.root, decoded.values),
      expectedVersion,
      filters: filters.filters,
      returning,
    },
    fields,
    memberships: memberships.checks,
  }
}
