import type { FieldBinding, FormBindings } from '../generate/types.js'
import { byCodepoint, OPERATIONS, type ParsedFieldPolicy, type ParsedPolicy, readContext, readPolicy, type TrustedContext } from './inputs.js'
import type {
  FormPolicy,
  ForcedValues,
  PolicyContext,
  PolicyDecision,
  PolicyOperation,
  PolicyRefusal,
  PolicyRefusalCode,
  ReadableFields,
  RowFilterResult,
  RowFilterRule,
} from './types.js'
import { fitPolicy } from './validate.js'

/*
 * Access decisions for one published form, each pure and each fail-closed:
 * every function reads the context and the policy before deciding anything,
 * and answers with a refusal rather than a weaker answer.
 *
 * Every function that returns data — fields, a filter, values — authorises
 * and scopes the operation it serves before returning any, as the write check
 * does. `authorizeOperation` is the gate a caller is meant to pass first, but
 * a field grant does not imply an operation grant, and a caller that skipped
 * the gate must not be handed a WHERE clause and a column list regardless.
 *
 * Nothing here reads the form document. A hidden or disabled field is
 * presentation, not authorisation (plan section 11): the browser decides what
 * it shows, and a request can carry any key it likes, so every decision is
 * taken from the policy and the bindings alone.
 */

function refuse(code: PolicyRefusalCode, message: string): PolicyRefusal {
  return { ok: false, code, message }
}

/** Whether the actor holds any of the roles granted. Exact strings: no case folding, no prefix, no wildcard. */
function holds(granted: ReadonlySet<string>, actor: TrustedContext): boolean {
  for (const role of actor.roles) if (granted.has(role)) return true
  return false
}

type Prepared = { ok: true; policy: ParsedPolicy; actor: TrustedContext } | PolicyRefusal

/** The context and the policy, both read — and fitted to the form when there is one — or the refusal that says which was wrong. */
function prepare(policy: FormPolicy, context: PolicyContext, bindings?: FormBindings): Prepared {
  const trusted = readContext(context)
  if (!trusted.ok) return trusted
  const read = bindings === undefined ? readPolicy(policy) : fitPolicy(policy, bindings)
  if (read.parsed === null) return refuse('invalid-policy', read.problems.join('; '))
  return { ok: true, policy: read.parsed, actor: trusted.trusted }
}

/**
 * Each rule's column paired with the context's value for its attribute, or a
 * refusal. Never a shorter filter: dropping a rule whose attribute is missing
 * would return an empty filter, and an empty filter is every tenant's rows.
 */
function resolve(rules: readonly RowFilterRule[], actor: TrustedContext, where: string): RowFilterResult {
  const filter: Array<{ column: string; value: string }> = []
  for (const rule of rules) {
    const value = actor.attributes.get(rule.attribute)
    if (value === undefined || value === '') {
      return refuse(
        'missing-attribute',
        `${where}: ${rule.column} must equal the context's ${rule.attribute}, and the context has ${value === undefined ? 'none' : 'an empty one'}; refusing rather than filtering nothing`,
      )
    }
    filter.push({ column: rule.column, value })
  }
  return { ok: true, filter }
}

/**
 * The root's filter for an operation the actor may perform, or why they may
 * not: no role of theirs is granted it, or the context cannot scope it.
 */
function authorise(policy: ParsedPolicy, actor: TrustedContext, operation: PolicyOperation): RowFilterResult {
  // `operation` is typed, but a host may pass it on from a route name; a
  // string that is not an operation must not reach a property lookup.
  if (!OPERATIONS.includes(operation)) return refuse('operation-denied', `${String(operation)} is not an operation this release has`)
  if (!holds(policy.operations[operation], actor)) return refuse('operation-denied', `no role of this actor may ${operation} with this form`)
  return resolve(policy.rowFilters, actor, 'rowFilters')
}

/**
 * Whether the actor may read, create or update records of this form.
 *
 * An operation that cannot be scoped is not authorised either: when a row
 * filter names an attribute the context lacks, this refuses, so a caller that
 * checked only this would not go on to query without the filter.
 */
export function authorizeOperation(policy: FormPolicy, context: PolicyContext, operation: PolicyOperation): PolicyDecision {
  const prepared = prepare(policy, context)
  if (!prepared.ok) return prepared
  const scoped = authorise(prepared.policy, prepared.actor, operation)
  return scoped.ok ? { ok: true } : scoped
}

/**
 * The field keys whose values the actor may see, in the form's order.
 *
 * Deny by default: a field the policy has no entry for is readable by nobody.
 * An actor who may not read — whatever fields their roles are granted — is
 * refused rather than given a column list to query with.
 */
export function readableFields(policy: FormPolicy, context: PolicyContext, bindings: FormBindings): ReadableFields {
  const prepared = prepare(policy, context, bindings)
  if (!prepared.ok) return prepared
  const { policy: parsed, actor } = prepared
  const scoped = authorise(parsed, actor, 'read')
  if (!scoped.ok) return scoped
  const fields = bindings.fields.filter((binding) => {
    const entry = parsed.fields.get(binding.field)
    return entry !== undefined && holds(entry.read, actor)
  })
  return { ok: true, fields: fields.map((binding) => binding.field) }
}

/** Why one submitted key is over-posting, or `null` when the actor may write it. */
function overPosted(binding: FieldBinding | undefined, entry: ParsedFieldPolicy | undefined, actor: TrustedContext, pinned: ReadonlySet<string>): string | null {
  if (binding === undefined) return 'is not a field of this form'
  if (!binding.writable) return 'is never written by this form'
  // On create the column is written from the context; on update a new value
  // would move the record into another tenant. Neither is the request's.
  if (binding.kind === 'column' && pinned.has(binding.column)) {
    return 'is pinned by a row filter: its value comes from the trusted context, never from the request'
  }
  if (entry === undefined || !holds(entry.write, actor)) return 'is not writable for this actor'
  return null
}

/**
 * Whether every submitted key is one this actor may write with this
 * operation — the over-posting check.
 *
 * It authorises and scopes the operation first, so a write path that calls
 * only this is still closed. A lookup that sets a pinned column is accepted
 * because the policy is refused unless the lookup's target is pinned to the
 * same attribute: a selection rechecked against `lookupRowFilter` — the lookup
 * contract's job on save — is then one of this tenant's rows, and the value it
 * carries is the context's.
 */
export function checkSubmittedFields(
  policy: FormPolicy,
  context: PolicyContext,
  bindings: FormBindings,
  operation: 'create' | 'update',
  submittedKeys: readonly string[],
): PolicyDecision {
  const prepared = prepare(policy, context, bindings)
  if (!prepared.ok) return prepared
  const { policy: parsed, actor } = prepared
  if (operation !== 'create' && operation !== 'update') return refuse('operation-denied', `${String(operation)} submits no values`)
  const scoped = authorise(parsed, actor, operation)
  if (!scoped.ok) return scoped

  const pinned = new Set(parsed.rowFilters.map((rule) => rule.column))
  const reasons: string[] = []
  for (const key of [...new Set(submittedKeys)].sort(byCodepoint)) {
    const binding = bindings.fields.find((candidate) => candidate.field === key)
    const reason = overPosted(binding, parsed.fields.get(key), actor, pinned)
    if (reason !== null) reasons.push(`${key} ${reason}`)
  }
  return reasons.length === 0 ? { ok: true } : refuse('over-posting', reasons.join('; '))
}

/**
 * The root table's filter for an operation this actor may perform: every
 * pinned column equal to the context's value. On read and update it is the
 * WHERE clause; on create, the values `forcedValues` writes.
 *
 * Empty only when the policy says `rowFilters: []`; a missing attribute is a
 * refusal, never a shorter filter. An actor not granted the operation is
 * refused, so a filter is never the only thing standing between a caller and
 * a query it was not allowed to run.
 */
export function rowFilter(policy: FormPolicy, context: PolicyContext, operation: PolicyOperation): RowFilterResult {
  const prepared = prepare(policy, context)
  if (!prepared.ok) return prepared
  return authorise(prepared.policy, prepared.actor, operation)
}

/**
 * The filter on a lookup's TARGET table, for the operation whose form offers
 * it: the options it lists, and the membership a selection is rechecked
 * against on save. A lookup token is a reference, not a permission (plan
 * section 9).
 *
 * The operation is authorised and the root scoped first. The policy is fitted
 * to the form, as for the write check, because whether a target must be
 * pinned depends on which root columns the lookup sets: the options are
 * listed before anything is saved, and a save refused afterwards would not
 * take back a list of every tenant's rows.
 *
 * A lookup the policy has no entry for offers nothing; `[]` is how a policy
 * says its target is shared. Searching a lookup reads the target's rows, so
 * an actor who may neither read nor write the field is refused.
 */
export function lookupRowFilter(
  policy: FormPolicy,
  context: PolicyContext,
  bindings: FormBindings,
  operation: PolicyOperation,
  lookupField: string,
): RowFilterResult {
  const prepared = prepare(policy, context, bindings)
  if (!prepared.ok) return prepared
  const { policy: parsed, actor } = prepared
  const scoped = authorise(parsed, actor, operation)
  if (!scoped.ok) return scoped
  const rules = parsed.lookups.get(lookupField)
  if (rules === undefined) return refuse('unknown-lookup', `the policy says nothing about which rows ${lookupField} may offer, so it offers none`)
  const entry = parsed.fields.get(lookupField)
  if (entry === undefined || !(holds(entry.read, actor) || holds(entry.write, actor))) {
    return refuse('field-denied', `this actor may neither read nor write ${lookupField}, so its options are not theirs to search`)
  }
  return resolve(rules, actor, `lookups.${lookupField}`)
}

/**
 * The root columns a create writes from the context: every column a row
 * filter pins, with the context's value. The same rules as `rowFilter`,
 * resolved the same way, so a record a person creates is one they can read.
 * A submitted value for one of these columns is over-posting. An actor who
 * may not create is refused.
 */
export function forcedValues(policy: FormPolicy, context: PolicyContext): ForcedValues {
  const filter = rowFilter(policy, context, 'create')
  return filter.ok ? { ok: true, values: filter.filter } : filter
}
