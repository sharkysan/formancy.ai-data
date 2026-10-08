import type { LookupConfig, LookupQuery } from './types.js'

/**
 * The longest search string an adapter is handed.
 *
 * A guard and not a measurement: it is the bound formancy already places on
 * what this same control stores (`acceptRemoteOptions`, 200 characters), so
 * one number bounds everything a person sends through a select. Chosen
 * 2026-10-08; nothing has measured a search that needed more.
 */
export const MAX_SEARCH_LENGTH = 200

/** C0, DEL and C1. In `u` mode, so it reads code points. */
const CONTROL = /\p{Cc}/u
const LONE_SURROGATE = /\p{Cs}/u
const PROPERTIES = new Set(['search', 'offset', 'limit'])

export type LookupQueryErrorCode =
  | 'malformed'
  | 'search-too-long'
  | 'search-control-character'
  | 'ill-formed-text'
  | 'not-searchable'
  | 'offset-out-of-range'
  | 'limit-out-of-range'

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
 * The search is trimmed, and an empty one lists every row, which is what
 * formancy's own `narrowOptionsByLabel` does with a document's list: one
 * control behaves one way wherever its options came from.
 */
export function validateLookupQuery(config: LookupConfig, query: unknown): LookupQueryCheck {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) return refuse('malformed', 'A lookup query is an object.')
  const record = query as Record<string, unknown>
  const unknown = Object.keys(record).filter((key) => !PROPERTIES.has(key))
  const missing = [...PROPERTIES].filter((key) => !Object.hasOwn(record, key))
  if (unknown.length > 0 || missing.length > 0) {
    return refuse('malformed', `A lookup query has exactly a search, an offset and a limit; this one ${unknown.length > 0 ? 'has more' : 'lacks one'}.`)
  }

  const { search, offset, limit } = record
  if (typeof search !== 'string') return refuse('malformed', 'The search is text, and may be empty.')
  if (search.length > MAX_SEARCH_LENGTH) {
    return refuse('search-too-long', `A search is at most ${String(MAX_SEARCH_LENGTH)} characters, and this one has ${String(search.length)}.`)
  }

  const trimmed = search.trim()
  if (CONTROL.test(trimmed)) return refuse('search-control-character', 'A search cannot contain a control character.')
  if (LONE_SURROGATE.test(trimmed)) return refuse('ill-formed-text', 'A search cannot contain an unpaired UTF-16 surrogate.')
  if (trimmed !== '' && config.search.length === 0) {
    return refuse('not-searchable', `${config.source} has no searchable column, so it lists rows but cannot search them.`)
  }

  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    return refuse('offset-out-of-range', 'The offset is a whole number, zero or more.')
  }
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > config.maxPageSize) {
    return refuse('limit-out-of-range', `The limit is a whole number from 1 to ${String(config.maxPageSize)}.`)
  }

  return { ok: true, query: { search: trimmed, offset, limit } }
}
