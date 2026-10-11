import { checkPage, checkSearch } from '../lookup/search.js'
import type { PageErrorCode, SearchErrorCode } from '../lookup/search.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import type { ListSortTerm, RecordListQuery } from '../runtime.js'

/*
 * A list request's body, read at the boundary (0044): what the browser sent,
 * as `unknown`, becomes a fresh `RecordListQuery` holding exactly the checked
 * properties, or the refusal that says which is wrong. Nothing here knows the
 * form: which fields may sort, search or name a parent is the planner's
 * (`planList`), against the policy.
 *
 * The search and the page are a lookup's (`checkSearch`, `checkPage`), so
 * the same text and the same page mean the same in a select and in a grid.
 */

export type ListQueryErrorCode = SearchErrorCode | PageErrorCode

export type ListQueryRefusal = { ok: false; code: ListQueryErrorCode; message: string }

export type ListQueryCheck = { ok: true; query: RecordListQuery } | ListQueryRefusal

const PROPERTIES = new Set(['search', 'sort', 'parent', 'offset', 'limit'])
const DIRECTIONS: ReadonlySet<unknown> = new Set(['asc', 'desc'])

function malformed(message: string): ListQueryRefusal {
  return { ok: false, code: 'malformed', message }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a record has exactly these keys, so a term carrying anything else is refused rather than half-read. */
function hasExactly(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

/** The requested order: a list of `{ field, direction }`, each field once. A field twice would order by its first mention and say nothing with the second. */
function sortOf(sort: unknown): { ok: true; sort: ListSortTerm[] } | ListQueryRefusal {
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
function parentOf(parent: unknown): { ok: true; parent: RecordListQuery['parent'] } | ListQueryRefusal {
  if (parent === undefined || parent === null) return { ok: true, parent: null }
  if (!isRecord(parent) || !hasExactly(parent, ['field', 'record'])) return malformed('The parent is { field, record } and nothing else, or null.')
  const { field, record } = parent
  if (typeof field !== 'string' || field === '' || typeof record !== 'string') return malformed("The parent names a lookup field by its key and the parent's record token.")
  return { ok: true, parent: { field, record } }
}

/**
 * The list query an adapter may be planned from, from a request's body.
 *
 * Every property may be left out -- `search` is then `''`, `sort` `[]`,
 * `parent` `null`, `offset` 0 and `limit` `LIST_PAGE_SIZE` -- and any other
 * is refused: a property ignored today is one somebody reads tomorrow.
 */
export function validateListQuery(query: unknown): ListQueryCheck {
  if (!isRecord(query)) return malformed('A list query is an object.')
  const unknown = Object.keys(query).filter((key) => !PROPERTIES.has(key))
  if (unknown.length > 0) return malformed('A list query has a search, a sort, a parent, an offset and a limit, and nothing else.')
  const given = (key: string, otherwise: unknown): unknown => (query[key] === undefined ? otherwise : query[key])
  const search = checkSearch(given('search', ''))
  if (!search.ok) return search
  const sort = sortOf(query['sort'])
  if (!sort.ok) return sort
  const parent = parentOf(query['parent'])
  if (!parent.ok) return parent
  const page = checkPage(given('offset', 0), given('limit', LIST_PAGE_SIZE), LIST_PAGE_SIZE)
  if (!page.ok) return page
  return { ok: true, query: { search: search.search, sort: sort.sort, parent: parent.parent, offset: page.offset, limit: page.limit } }
}
