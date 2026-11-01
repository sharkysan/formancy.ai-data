import type { FormBindings } from '../generate/types.js'
import { listColumns } from '../records/list.js'

/*
 * The fields a form's Filter panel does not offer (0123): an administrator's
 * choice over what a list of the form's records may be filtered by, kept in
 * the presentation as field keys beside the list views. The panel offers
 * every other such field. A field left out is still one a list is filtered
 * by -- a view may filter on it, and a client of its own may send one --
 * so this is presentation, as a label is, and never a permission.
 */

/**
 * Every reason `value` is not a presentation's `unfiltered` by shape: a
 * list, not empty -- none left out is the property left out, so a
 * presentation has one spelling -- of field keys, each once.
 */
export function unfilteredShapeProblems(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((key) => typeof key === 'string')) return ['unfiltered must be a list of field keys']
  if (value.length === 0) return ['unfiltered: leaves out none; leave it out']
  return value.flatMap((key, index) => (value.indexOf(key) === index ? [] : [`/unfiltered/${String(index)}: ${key} appears twice`]))
}

/** The fields a list of these bindings is filtered by, for any actor: what a key left out must be one of. */
function filteredBy(bindings: FormBindings): Set<string> {
  const all = bindings.fields.map((binding) => binding.field)
  return new Set(listColumns(bindings, all, []).filterable.map((field) => field.field))
}

/**
 * Every key of `unfiltered` that is not a field a list of `bindings` is
 * filtered by, prefixed by where it is: what a write refuses, as it refuses
 * a list view that does not fit (0105).
 */
export function unfilteredProblems(unfiltered: readonly string[], bindings: FormBindings): string[] {
  const offered = filteredBy(bindings)
  return unfiltered.flatMap((key, index) => (offered.has(key) ? [] : [`/unfiltered/${String(index)}: ${key} is not a field this list is filtered by.`]))
}

/**
 * The keys left out carried to a regenerated base: each followed by what it
 * stands for, as a label is, and dropped without a word where its field is
 * gone or no longer one a list is filtered by -- the panel could not offer
 * it either way. In the new bindings' order.
 */
export function carryUnfiltered(unfiltered: readonly string[], follow: (key: string) => string | undefined, bindings: FormBindings): string[] {
  const offered = filteredBy(bindings)
  const kept = new Set(unfiltered.flatMap((key) => follow(key) ?? []).filter((key) => offered.has(key)))
  return bindings.fields.map((binding) => binding.field).filter((key) => kept.has(key))
}
