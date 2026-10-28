import { checkPage, checkSearch } from '../lookup/search.js'
import type { PageErrorCode, SearchErrorCode } from '../lookup/search.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import type { ListSortTerm, RecordExportQuery, RecordListQuery } from '../runtime.js'
import { readFilter } from './filter.js'

/*
 * A list request's body, read at the boundary (0044): what the browser sent,
 * as `unknown`, becomes a fresh `RecordListQuery` holding exactly the checked
 * properties, or the refusal that says which is wrong. Nothing here knows the
 * form: which fields may sort, search, filter or name a parent is the
 * planner's (`planList`), against the policy.
 *
 * The search and the page are a lookup's (`checkSearch`, `checkPage`), so
 * the same text and the same page mean the same in a select and in a grid.
 * An export's body (0079) is a list's search, sort, parent and filter, read
 * by the same checks, so a file is of the records the grid shows.
 */

/** A body's refusals: a search's, a page's, and `not-filterable` for what a filter's `contains` could not find (`readFilter`). */
export type ListQueryErrorCode = SearchErrorCode | PageErrorCode | 'not-filterable'

export type ListQueryRefusal = { ok: false; code: ListQueryErrorCode; message: string }

export type ListQueryCheck = { ok: true; query: RecordListQuery } | ListQueryRefusal

export type ExportQueryRefusal = { ok: false; code: SearchErrorCode | 'not-filterable'; message: string }

export type ExportQueryCheck = { ok: true; query: RecordExportQuery } | ExportQueryRefusal

const LIST_PROPERTIES = new Set(['search', 'sort', 'parent', 'filter', 'offset', 'limit'])
const EXPORT_PROPERTIES = new Set(['search', 'sort', 'parent', 'filter'])
const DIRECTIONS: ReadonlySet<unknown> = new Set(['asc', 'desc'])

type Malformed = { ok: false; code: 'malformed'; message: string }

function malformed(message: string): Malformed {
  return { ok: false, code: 'malformed', message }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a record has exactly these keys, so a term carrying anything else is refused rather than half-read. */
function hasExactly(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

/**
 * The requested order: a list of `{ field, direction }`, each field once. A
 * field twice would order by its first mention and say nothing with the
 * second. A list's body and an export's are read by it, and so is a list
 * view's sort (0105), so a view's order is one a request may carry.
 */
export function readSort(sort: unknown): { ok: true; sort: ListSortTerm[] } | Malformed {
  if (sort === undefined) return { ok: true, sort: [] }
  if (!Array.isArray(sort)) return malformed('The sort is a list of { field, direction }.')
  const terms: ListSortTerm[] = []
  const seen = new Set<string>()
  for (const entry of sort as unknown[]) {
    if (!isRecord(entry) || !hasExactly(entry, ['field', 'direction'])) return malformed('Each sort term is { field, direction } and nothing else.')
    const { field, direction } = entry
    if (typeof field !== 'string' || field === '') return malformed('A sort term names a field by its key.')
    if (!DIRECTIONS.has(direction)) return malformed(`${field} sorts asc or desc.`)
    if (seen.has(field)) return malformed(`${field} is named twice in the sort.`)
    seen.add(field)
    terms.push({ field, direction: direction as ListSortTerm['direction'] })
  }
  return { ok: true, sort: terms }
}

/** The parent: absent or `null` for none, otherwise exactly a field key and a record token, both text. */
function parentOf(parent: unknown): { ok: true; parent: RecordListQuery['parent'] } | Malformed {
  if (parent === undefined || parent === null) return { ok: true, parent: null }
  if (!isRecord(parent) || !hasExactly(parent, ['field', 'record'])) return malformed('The parent is { field, record } and nothing else, or null.')
  const { field, record } = parent
  if (typeof field !== 'string' || field === '' || typeof record !== 'string') return malformed("The parent names a lookup field by its key and the parent's record token.")
  return { ok: true, parent: { field, record } }
}

/** What a list and an export both read from a body: the search, the order, the parent and the filter, each checked as `validateListQuery` says. */
function selection(query: Record<string, unknown>): ({ ok: true } & RecordExportQuery) | ExportQueryRefusal {
  const search = checkSearch(query['search'] === undefined ? '' : query['search'])
  if (!search.ok) return search
  const sort = readSort(query['sort'])
  if (!sort.ok) return sort
  const parent = parentOf(query['parent'])
  if (!parent.ok) return parent
  const filter = readFilter(query['filter'], 'field')
  if (!filter.ok) return filter
  return { ok: true, search: search.search, sort: sort.sort, parent: parent.parent, filter: filter.filter }
}

/** The properties of `query` outside `allowed`. */
const others = (query: Record<string, unknown>, allowed: ReadonlySet<string>): string[] => Object.keys(query).filter((key) => !allowed.has(key))

/**
 * The list query an adapter may be planned from, from a request's body.
 *
 * Every property may be left out -- `search` is then `''`, `sort` `[]`,
 * `parent` `null`, `filter` `[]`, `offset` 0 and `limit` `LIST_PAGE_SIZE`
 * -- and any other is refused: a property ignored today is one somebody
 * reads tomorrow. A filter is `readFilter`'s, by field (0104).
 */
export function validateListQuery(query: unknown): ListQueryCheck {
  if (!isRecord(query)) return malformed('A list query is an object.')
  if (others(query, LIST_PROPERTIES).length > 0) return malformed('A list query has a search, a sort, a parent, a filter, an offset and a limit, and nothing else.')
  const selected = selection(query)
  if (!selected.ok) return selected
  const page = checkPage(query['offset'] === undefined ? 0 : query['offset'], query['limit'] === undefined ? LIST_PAGE_SIZE : query['limit'], LIST_PAGE_SIZE)
  if (!page.ok) return page
  return { ok: true, query: { search: selected.search, sort: selected.sort, parent: selected.parent, filter: selected.filter, offset: page.offset, limit: page.limit } }
}

/**
 * The query an export pages the list by (0079), from a request's body: a
 * list's search, sort, parent and filter, each left out as a list's may
 * be, and nothing else. An offset or a limit is refused with the rest: the server
 * reads every page, from the first record to the last.
 */
export function validateExportQuery(query: unknown): ExportQueryCheck {
  if (!isRecord(query)) return malformed('An export query is an object.')
  if (others(query, EXPORT_PROPERTIES).length > 0) return malformed('An export query has a search, a sort, a parent and a filter, and nothing else: the file holds every page.')
  const selected = selection(query)
  if (!selected.ok) return selected
  return { ok: true, query: { search: selected.search, sort: selected.sort, parent: selected.parent, filter: selected.filter } }
}
