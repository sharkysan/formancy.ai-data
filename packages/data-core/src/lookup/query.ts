import { checkPage, checkSearch } from './search.js'
import type { PageErrorCode, SearchErrorCode } from './search.js'
import type { LookupConfig, LookupQuery } from './types.js'

const PROPERTIES = new Set(['search', 'offset', 'limit'])

export type LookupQueryErrorCode =
  | SearchErrorCode
  | 'not-searchable'
  | PageErrorCode

export type LookupQueryCheck = { ok: true; query: LookupQuery } | { ok: false; code: LookupQueryErrorCode; message: string }

function refuse(code: LookupQueryErrorCode, message: string): LookupQueryCheck {
  return { ok: false, code, message }
}

/**
 * The search an adapter may run, from what a request asked for.
 *
 * Takes `unknown` because it is the boundary: the query comes from an HTTP
 * body, and this returns a fresh object holding exactly the three checked
 * properties, so nothing else a request carried can reach an adapter.
 *
 * The search and the page are `checkSearch`'s and `checkPage`'s, the
 * decisions a form's record list shares (0044). The search is trimmed, and
 * an empty one lists every row, which is what formancy's own
 * `narrowOptionsByLabel` does with a document's list, so one control behaves
 * one way wherever its options came from.
 */
export function validateLookupQuery(config: LookupConfig, query: unknown): LookupQueryCheck {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) return refuse('malformed', 'A lookup query is an object.')
  const record = query as Record<string, unknown>
  const unknown = Object.keys(record).filter((key) => !PROPERTIES.has(key))
  const missing = [...PROPERTIES].filter((key) => !Object.hasOwn(record, key))
  if (unknown.length > 0 || missing.length > 0) {
    return refuse('malformed', `A lookup query has exactly a search, an offset and a limit; this one ${unknown.length > 0 ? 'has more' : 'lacks one'}.`)
  }

  const search = checkSearch(record['search'])
  if (!search.ok) return search
  if (search.search !== '' && config.search.length === 0) {
    return refuse('not-searchable', `${config.source} has no searchable column, so it lists rows but cannot search them.`)
  }
  const page = checkPage(record['offset'], record['limit'], config.maxPageSize)
  if (!page.ok) return page
  return { ok: true, query: { search: search.search, offset: page.offset, limit: page.limit } }
}
