import type { FieldBinding, FormBindings } from '../generate/types.js'
import { type ParsedPolicy, readPolicy } from './inputs.js'
import type { FormPolicy, PolicyValidation } from './types.js'

/**
 * The root columns this form is bound to: its fields' columns, its identity
 * and its concurrency token. A row filter may name only these, because a
 * column outside them is an identifier nobody approved for this form.
 */
function boundColumns(bindings: FormBindings): Set<string> {
  const columns = new Set<string>(bindings.identity ?? [])
  if (bindings.concurrency !== null) columns.add(bindings.concurrency.column)
  for (const binding of bindings.fields) {
    for (const column of binding.kind === 'lookup' ? binding.columns : [binding.column]) columns.add(column)
  }
  return columns
}

/**
 * A lookup that sets a pinned root column must pin the paired target column —
 * paired by the foreign key's order — to the same attribute.
 *
 * The order form's customer lookup sets tenant_id. A selection is checked on
 * save against the lookup's row filter; unless that filter pins the
 * customer's tenant_id to the same tenant, a customer of another tenant
 * passes, and its tenant_id is written into this tenant's order.
 */
function lookupProblems(binding: Extract<FieldBinding, { kind: 'lookup' }>, policy: ParsedPolicy, pinned: ReadonlyMap<string, string>): string[] {
  const target = `${binding.target.table.schema}.${binding.target.table.name}`
  const rules = policy.lookups.get(binding.field)
  if (rules === undefined) return [`lookups has no entry for ${binding.field}: say which rows of ${target} it may offer, or [] for every row`]
  const problems: string[] = []
  for (const [index, column] of binding.columns.entries()) {
    const attribute = pinned.get(column)
    if (attribute === undefined) continue
    const paired = binding.target.columns[index]
    if (!rules.some((rule) => rule.column === paired && rule.attribute === attribute)) {
      problems.push(
        `lookups.${binding.field} must pin ${target}.${String(paired)} to ${attribute}, because ${binding.field} sets ${column}, which a row filter pins to ${attribute}`,
      )
    }
  }
  return problems
}

/** Everything in a well-formed policy that does not fit this form. */
function fitProblems(policy: ParsedPolicy, bindings: FormBindings): string[] {
  const problems: string[] = []
  const byField = new Map(bindings.fields.map((binding) => [binding.field, binding]))
  const pinned = new Map(policy.rowFilters.map((rule) => [rule.column, rule.attribute]))

  // A grant nothing can honour is a policy that says something untrue.
  for (const operation of ['create', 'update'] as const) {
    if (policy.operations[operation].size > 0 && !bindings.operations[operation]) {
      problems.push(`operations.${operation} grants roles, and this form does not offer ${operation}`)
    }
  }

  for (const [key, entry] of policy.fields) {
    const binding = byField.get(key)
    if (binding === undefined) {
      problems.push(`fields.${key}: the form has no field ${key}`)
      continue
    }
    if (entry.write.size === 0) continue
    // Written on one operation is written: a grant on a create-only field means something on create (0027).
    if (!binding.writes.create && !binding.writes.update) problems.push(`fields.${key} grants write, and the form never writes ${key}`)
    else if (binding.kind === 'column' && pinned.has(binding.column)) {
      problems.push(`fields.${key} grants write, and ${binding.column} is pinned by a row filter: its value comes from the context`)
    }
  }

  const bound = boundColumns(bindings)
  for (const rule of policy.rowFilters) {
    if (!bound.has(rule.column)) problems.push(`rowFilters: ${rule.column} is not a column this form is bound to`)
  }

  for (const key of policy.lookups.keys()) {
    if (byField.get(key)?.kind !== 'lookup') problems.push(`lookups.${key}: ${key} is not a lookup field of this form`)
  }
  for (const binding of bindings.fields) {
    if (binding.kind === 'lookup') problems.push(...lookupProblems(binding, policy, pinned))
  }
  return problems
}

/** The policy, read and fitted to the form, or every reason it cannot be applied to it. */
export function fitPolicy(policy: FormPolicy, bindings: FormBindings): { parsed: ParsedPolicy; problems: [] } | { parsed: null; problems: string[] } {
  const read = readPolicy(policy)
  if (read.parsed === null) return read
  const problems = fitProblems(read.parsed, bindings)
  return problems.length === 0 ? read : { parsed: null, problems }
}

/**
 * Whether a policy can be published with a form: well formed, and about this
 * form's fields, operations, columns and lookups.
 *
 * Refused, not repaired. A policy that names a field the form does not have
 * was written for another form, or for this one before a regeneration renamed
 * something, and nothing else in it can be trusted to mean what its author
 * meant. A field the policy does NOT name is not a problem: it is readable and
 * writable by nobody, which is what deny by default means.
 *
 * The target table of a lookup is not in the bindings, so a lookup filter on a
 * column the target lacks is not caught here; the adapter refuses an
 * identifier that is not in approved metadata when it builds the query.
 */
export function validatePolicy(policy: FormPolicy, bindings: FormBindings): PolicyValidation {
  const { problems } = fitPolicy(policy, bindings)
  return problems.length === 0 ? { ok: true } : { ok: false, code: 'invalid-policy', message: problems.join('; '), problems }
}
