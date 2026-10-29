import type { FormBindings } from '../generate/types.js'
import type { MetadataSnapshot } from '../metadata.js'
import { checkSubmittedFields, readableFields } from '../policy/evaluate.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { columnsOf, prepare } from './prepare.js'

/**
 * The fields a copy of one of this form's records carries into a new record,
 * for this person (0107), in the bindings' order: the fields they may read
 * whose answer a create would accept from them, less every field over a
 * column of one of the root's keys, primary or unique.
 *
 * Whether a create accepts a field is the over-posting check's, asked one
 * field at a time as the runtime route asks it of an echo, so a field the
 * database generates, a pinned tenant, one the account may not INSERT and
 * one the policy does not let this person write are left out by the rule
 * that would refuse them, not by a second list of it. A key is left out
 * because a copy of it names the record copied from: a create would be
 * refused as a second one, or -- a key the database fills -- is not the
 * person's to give anyway. The version is never a field, so it never
 * travels.
 *
 * Empty when the bindings do not fit their snapshot, when this person may not
 * read the form, or when they may not create: nothing to copy, and a page
 * offers no copy.
 */
export function copiedFields(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy, context: PolicyContext): string[] {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return []
  const readable = readableFields(policy, context, bindings)
  if (!readable.ok) return []
  const { root } = ready.prepared
  const keyed = new Set([...(root.primaryKey === null ? [] : [root.primaryKey]), ...root.uniqueKeys].flatMap((key) => key.columns))
  const copied = new Set(
    bindings.fields
      .filter((binding) => !columnsOf(binding).some((column) => keyed.has(column)))
      .filter((binding) => checkSubmittedFields(policy, context, bindings, 'create', [binding.field]).ok)
      .map((binding) => binding.field),
  )
  return readable.fields.filter((field) => copied.has(field))
}
