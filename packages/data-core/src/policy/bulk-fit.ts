import { offeredFor, offers } from '../generate/offers.js'
import type { FieldBinding, FormBindings } from '../generate/types.js'
import { byCodepoint, type ParsedBulkUpdate, type ParsedPolicy } from './inputs.js'

/*
 * A policy's `bulk`, fitted to its form: who may delete the chosen records
 * of a page together (0173), and who may change them, in which fields
 * (0175). Each record of such a request is a write of it alone, planned,
 * scoped and sent as one, so every grant here narrows its operation's and
 * widens nothing, and a grant that some record could never honour says
 * something untrue. What a rule of the form reads is the form's, which the
 * policy does not hold: `read-together.ts` asks that of the bundle.
 */

/** Everything `bulk` says that this form cannot honour; empty for a policy that names none. */
export function bulkFitProblems(policy: ParsedPolicy, bindings: FormBindings): string[] {
  const bulk = policy.bulk
  if (bulk === null) return []
  if (bulk.delete === null && bulk.update === null) {
    // `{}` grants nobody: it fits a form that offers either write alone, and says something untrue of one that offers neither.
    if (offeredFor(bindings, 'delete', null) || offeredFor(bindings, 'update', null)) return []
    return ['bulk names who may change or delete chosen records together, and this form offers neither an update nor a delete of a record alone']
  }
  return [...deleteFit(policy, bulk.delete, bindings), ...updateFit(policy, bulk.update, bindings)]
}

/**
 * Who may delete chosen records together (0173). A grant on a form that
 * offers no delete alone says something untrue, whatever it grants: one
 * that offers none, and a together child, whose rows are deleted only in a
 * save of their record (0155) -- its policy may grant the delete that save
 * uses, and `planDelete` refuses every delete sent alone. Every role it
 * grants must be one `operations.delete` grants, or it would be refused
 * every record. What else a delete is held to -- read, scoping, the keys it
 * acts through -- `deleteGrantProblems` and `deleteProblems` already ask of
 * those roles.
 */
function deleteFit(policy: ParsedPolicy, roles: ReadonlySet<string> | null, bindings: FormBindings): string[] {
  if (roles === null) return []
  if (!offers(bindings, 'delete')) return ['bulk names who may delete chosen records together, and this form does not offer delete']
  if (!offeredFor(bindings, 'delete', null)) {
    return ["bulk names who may delete chosen records together, and this form's rows are deleted only with the record they belong to, in one save"]
  }
  return [...roles]
    .filter((role) => !policy.operations.delete.has(role))
    .sort(byCodepoint)
    .map((role) => `bulk.delete grants ${role}, who may not delete with this form: each chosen record is a delete of its own`)
}

/**
 * Who may change chosen records together, and in which fields (0175). A
 * grant on a form that offers no update alone is refused; every role must
 * be one `operations.update` grants; and every field one each of those
 * roles may write on update, which none of `unsettable`'s may be. The
 * state field may be listed: each record's move is checked from its own
 * state, as an update of it alone is (0127).
 */
function updateFit(policy: ParsedPolicy, grant: ParsedBulkUpdate | null, bindings: FormBindings): string[] {
  if (grant === null) return []
  if (!offeredFor(bindings, 'update', null)) return ['bulk.update names who may change chosen records together, and this form does not offer update']
  const updating = [...grant.roles].filter((role) => policy.operations.update.has(role)).sort(byCodepoint)
  const problems = [...grant.roles]
    .filter((role) => !policy.operations.update.has(role))
    .sort(byCodepoint)
    .map((role) => `bulk.update grants ${role}, who may not update with this form: each chosen record is an update of its own`)
  for (const field of grant.fields) {
    const refused = unsettableField(policy, bindings, field)
    if (refused !== null) {
      problems.push(`bulk.update.fields: ${field} ${refused}`)
      continue
    }
    const writers = policy.fields.get(field)?.write
    for (const role of updating) {
      if (writers?.has(role) !== true) problems.push(`bulk.update.fields: ${field} is not one ${role} may write, and bulk.update grants ${role} its change`)
    }
  }
  return problems
}

/**
 * Why no change of chosen records may set `field` of this form, whoever
 * is granted it, or `null` where one may (0175): what `validatePolicy`
 * refuses a `bulk.update` field for, in its words -- a field that is not
 * the form's, or `unsettable`'s first reason. The studio offers a field by
 * it (0176), so a box it draws and the check it publishes past are one
 * rule. Whether a role may write it is the grant's other check, and
 * whether a rule reads it together with another is the form's
 * (`readTogether`).
 */
export function unsettableField(
  policy: { readonly rowFilters: ReadonlyArray<{ readonly column: string }> },
  bindings: FormBindings,
  field: string,
): string | null {
  const binding = bindings.fields.find((candidate) => candidate.field === field)
  if (binding === undefined) return 'is not a field of this form'
  return unsettable(binding, bindings, new Set(policy.rowFilters.map((rule) => rule.column)))
}

/**
 * Why no change of chosen records may set this field, or `null`: the first
 * of these that holds. The key, which an update never sets and a token
 * names; the field a together child's rows are saved with their record
 * through (0155), written on create only; a version chain's dates and key
 * (0113), which a change from a date writes; a column a row filter pins,
 * whose value is the context's; a column the server stamps (0153); one the
 * database writes, which no write of this form gives; and one written on
 * create only (0027). The over-posting check refuses most of them for
 * every update anyway; a grant naming one is a policy that says it may be
 * set.
 */
function unsettable(binding: FieldBinding, bindings: FormBindings, pinned: ReadonlySet<string>): string | null {
  const columns = binding.kind === 'lookup' ? binding.columns : [binding.column]
  const identity = new Set(bindings.identity ?? [])
  if (columns.some((column) => identity.has(column))) return "is the record's key, which an update never sets"
  if (binding.kind === 'lookup' && binding.together !== undefined)
    return "names the record this form's rows are saved with, which a row keeps from its create (0155)"
  const validity = bindings.validity
  if (validity !== undefined && columns.some((column) => column === validity.from || column === validity.to || validity.key.includes(column)))
    return "is a version's start, end or chain, which a change from a date writes (0113)"
  if (binding.kind === 'column' && pinned.has(binding.column)) return 'is pinned by a row filter: its value comes from the context'
  if (binding.kind === 'column' && (bindings.stamps ?? []).some((stamp) => stamp.column === binding.column)) return 'is stamped by the server (0153)'
  if (!binding.writes.create && !binding.writes.update) return 'is written by the database, never by this form'
  if (!binding.writes.update) return 'is written on create only (0027)'
  return null
}
