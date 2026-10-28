import type { ListFilterTerm, ListSortTerm, ListView } from '@formancy/data-client'
import { canonicalize } from '@formancy/spec'

/*
 * A form's list views on the host page (0105), as data: which view a grid's
 * filter and sort are, and which one the grid opens on. A view is nothing
 * but a filter and a sort a list request carries, so the picker
 * (view-picker.tsx) holds no view of its own: what it shows is derived from
 * the section's filter and sort every time, and a condition the person
 * changes is said as their own at once.
 *
 * Which views a person is offered is the server's: `list.views`, only those
 * they could have built from what their list offers them.
 */

/** Two sorts are one when they order by the same fields in the same order, each the same way. */
export function sameSort(a: readonly ListSortTerm[], b: readonly ListSortTerm[]): boolean {
  return a.length === b.length && a.every((term, index) => term.field === b[index]?.field && term.direction === b[index]?.direction)
}

/** A filter's conditions in one spelling, whatever order they were applied in: each whole, in canonical JSON, sorted. */
const spelled = (filter: readonly ListFilterTerm[]): string[] => filter.map((term) => canonicalize(term)).sort()

/**
 * Two filters are one when they hold the same conditions, whatever order
 * they were applied in: a filter names each field once (0104), so it is a
 * set by field, and a condition is its whole term -- another bound, another
 * operator or text as typed is another request.
 */
function sameFilter(a: readonly ListFilterTerm[], b: readonly ListFilterTerm[]): boolean {
  if (a.length !== b.length) return false
  const theirs = spelled(b)
  return spelled(a).every((term, index) => term === theirs[index])
}

/** The first of `views` that is exactly `filter` and `sort`, or null: "All records" when both are empty, the person's own otherwise. */
export function viewMatching(views: readonly ListView[], filter: readonly ListFilterTerm[], sort: readonly ListSortTerm[]): ListView | null {
  return views.find((view) => sameSort(view.sort, sort) && sameFilter(view.filter, filter)) ?? null
}

/** The view a grid opens on: the one the server offered as the default, or null for every record. */
export function openingView(views: readonly ListView[]): ListView | null {
  return views.find((view) => view.default === true) ?? null
}
