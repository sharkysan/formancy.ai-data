import { createKeyAllocator, fieldKeyFor } from '../generate/names.js'
import type { FieldBinding } from '../generate/types.js'
import type { ColumnMeta } from '../metadata.js'
import type { FilterCondition } from '../runtime.js'
import { columnFilter } from './filter.js'
import type { RecordFilter, RelatedFilter } from './types.js'

/*
 * A person's conditions through a lookup (0139): on a column its label
 * shows, among the target rows the lookup may offer them. A field of the
 * list's own and a field through a lookup are told apart by their keys: a
 * formancy key is letters, digits and underscores, so a key with a dot is
 * one through a lookup, `<lookup>.<display column's key>`.
 *
 * Pure and isomorphic, as filter.ts is.
 */

/**
 * A field a person may filter a list by through a lookup: its key, the
 * lookup's, the display column as the target holds it, what a page calls
 * it, and the way to the target as the label's (`sortLabelsFor`).
 */
export interface RelatedField {
  field: string
  lookup: string
  column: ColumnMeta
  label: string
  reach: Omit<RelatedFilter, 'filter'>
}

/** Each display column of `binding` with its key through the lookup: `<lookup>.<the column's field key>`, a second column whose key is taken getting `_2` as a field would. */
export function relatedKeys(binding: Pick<Extract<FieldBinding, { kind: 'lookup' }>, 'field' | 'display'>): Array<{ field: string; column: string }> {
  const allocate = createKeyAllocator()
  return binding.display.map((column) => ({ field: `${binding.field}.${allocate(fieldKeyFor(column))}`, column }))
}

/**
 * The person's conditions through lookups, planned: one entry per lookup,
 * in the order its first condition came, each condition planned on its
 * column as a column of the list's own is (`columnFilter`) -- or why not.
 * `terms` are the conditions on a field of `offered`; the caller sends
 * each other condition its own way.
 */
export function relatedFilters(
  offered: readonly RelatedField[],
  terms: ReadonlyArray<{ field: string } & FilterCondition>,
): { ok: true; related: RelatedFilter[] } | { ok: false; message: string } {
  const byField = new Map(offered.map((entry) => [entry.field, entry]))
  const byLookup = new Map<string, { reach: RelatedField['reach']; filter: RecordFilter[] }>()
  for (const term of terms) {
    const via = byField.get(term.field)
    if (via === undefined) return { ok: false, message: `${term.field} is not a field you may filter this list by.` }
    const planned = columnFilter(via.column, term, term.field)
    if (!planned.ok) return planned
    const entry = byLookup.get(via.lookup) ?? { reach: via.reach, filter: [] }
    entry.filter.push(planned.filter)
    byLookup.set(via.lookup, entry)
  }
  return { ok: true, related: [...byLookup.values()].map(({ reach, filter }) => ({ ...reach, filter })) }
}
