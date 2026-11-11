import { filterOffer, nameableFields } from '@formancy/data-core'
import type { BrowseFilterTerm, FilterDays, FilterOffer, LineField, ListFilterTerm, ObjectMeta, RecordColumn } from '@formancy/data-core'
import type { Press } from './browse-pages.js'
import { sayCondition } from './condition-draft.js'

/*
 * A browsed page's filter (0104): the person's own conditions on the
 * columns the page shows, each one its column offers, every one of them
 * holding at once. The studio offers what `filterOffer` says each column
 * offers, from its own discovery; the server plans every condition again
 * over its own and refuses one it does not offer, or a value its column
 * cannot hold, in words the step's alert says (0011).
 *
 * One filter, three views of it (0147): the line above the table, read and
 * written by data-core's reader and printer, the chips under it in the
 * step's own words, and a box under each column's header. Each asks for
 * the page under the filter it makes, and all three show the filter the
 * page was asked with, so they never say two.
 */

/**
 * A column the page shows that offers a filter: what `filterOffer` offers
 * it, a timestamp's among it whose clock its whole days are on -- UTC for
 * an instant, as its values are written for one in no zone.
 */
export interface Filterable {
  column: string
  offer: FilterOffer
}

/**
 * What each column of a page offers a filter, in the page's order: the
 * columns the server showed, each read from the studio's discovery of the
 * object, which says what the page does not -- whether it holds NULLs. A
 * column the discovery does not hold, or one that offers nothing, is left
 * out.
 */
export function filterables(object: ObjectMeta | undefined, shown: readonly RecordColumn[]): Filterable[] {
  const byName = new Map((object?.columns ?? []).map((column) => [column.name, column]))
  return shown.flatMap((column): Filterable[] => {
    const meta = byName.get(column.name)
    const offer = meta === undefined ? null : filterOffer(meta)
    if (meta === undefined || offer === null) return []
    return [{ column: column.name, offer }]
  })
}

/**
 * The columns the line and the boxes may name: each filterable column, as
 * a field the line reads, keyed and labelled by the column's name -- which
 * the line names it by, lower-cased, `order_date` for `Order Date` -- and
 * offered what its column offers. A column whose name the line cannot read
 * back as it alone, two that differ only in case among them, is left out
 * (data-core's `nameableFields`): it has no name to type and no box.
 */
export function lineFields(columns: readonly Filterable[]): LineField[] {
  return nameableFields(columns.map(({ column, offer }) => ({ field: column, label: column, operators: offer.operators, input: offer.input })))
}

/** A browse's terms as the line reads and writes them: each column the field the line names. */
export const asLine = (filter: readonly BrowseFilterTerm[]): ListFilterTerm[] => filter.map(({ column, ...condition }) => ({ field: column, ...condition }))

/** The line's terms as a browse carries them: each field the column it names. */
export const asBrowse = (filter: readonly ListFilterTerm[]): BrowseFilterTerm[] => filter.map(({ field, ...condition }) => ({ column: field, ...condition }))

/** Whether two filters are one: the same conditions in the same order. */
export const sameFilter = (a: readonly BrowseFilterTerm[], b: readonly BrowseFilterTerm[]): boolean => JSON.stringify(a) === JSON.stringify(b)

/** `filter` with `column`'s condition replaced by the line's `term`, in its place, or last; left out for none. A column is named once (0104). */
export function withCondition(filter: readonly BrowseFilterTerm[], column: string, term: ListFilterTerm | null): BrowseFilterTerm[] {
  if (term === null) return filter.filter((given) => given.column !== column)
  const [condition] = asBrowse([term]) as [BrowseFilterTerm]
  const at = filter.findIndex((given) => given.column === column)
  return at === -1 ? [...filter, condition] : filter.map((given, index) => (index === at ? condition : given))
}

/** What a range of days is counted on, said after it, as the host's chips say it. */
const DAYS: Readonly<Record<FilterDays, string>> = { utc: ', whole days in UTC', wall: ', whole days as stored' }

/** A condition as its chip says it: the step's own words, `credit_limit > 125.50`, and a range of days on whose clock they are. */
export function sayFiltered(term: BrowseFilterTerm, columns: readonly Filterable[]): string {
  const days = term.op === 'range' ? (columns.find((entry) => entry.column === term.column)?.offer.days ?? null) : null
  return `${sayCondition(term.column, term)}${days === null ? '' : DAYS[days]}`
}

/**
 * Asks for page one under what `change` makes of the filter as it will
 * stand -- the page's, or the one a press on its way will leave -- and
 * answers whether that page arrived: `press.focus` names what takes the
 * keyboard once it has, `press.arrived` runs in the render that shows it,
 * and `press.owner` is the header box whose press it is.
 */
export type FilterChange = (change: (filter: BrowseFilterTerm[]) => BrowseFilterTerm[], press?: Press) => Promise<boolean>
