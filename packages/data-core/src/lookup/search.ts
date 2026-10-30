/*
 * What a person may ask of a search, decided once for every search this
 * module runs: a lookup's options (`validateLookupQuery`) and a form's
 * records (`validateListQuery`, 0044) -- the text, which both bind into a
 * LIKE pattern on a production database, and the page, which both send as
 * an OFFSET and a LIMIT. A search one of them accepts and the other refuses
 * would be the same request meaning two things.
 */

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

export type SearchErrorCode = 'malformed' | 'search-too-long' | 'search-control-character' | 'ill-formed-text'

export type SearchCheck = { ok: true; search: string } | { ok: false; code: SearchErrorCode; message: string }

/**
 * The search an adapter may bind, from what a request carried: text, at most
 * `MAX_SEARCH_LENGTH` long, trimmed, and holding no control character and no
 * unpaired surrogate. A NUL is an error on PostgreSQL and an ordinary
 * character on SQL Server, so a search holding one would fail on one engine
 * and run on the other; nobody types one into a search box.
 *
 * Trimmed, an empty search is no search, which is what formancy's own
 * `narrowOptionsByLabel` does with a document's list. Whether the form or the
 * lookup has anything to search is the caller's to decide; this decides only
 * what the text may be.
 */
export function checkSearch(search: unknown): SearchCheck {
  if (typeof search !== 'string') return { ok: false, code: 'malformed', message: 'The search is text, and may be empty.' }
  if (search.length > MAX_SEARCH_LENGTH) {
    return {
      ok: false,
      code: 'search-too-long',
      message: `A search is at most ${String(MAX_SEARCH_LENGTH)} characters, and this one has ${String(search.length)}.`,
    }
  }
  const trimmed = search.trim()
  if (CONTROL.test(trimmed)) return { ok: false, code: 'search-control-character', message: 'A search cannot contain a control character.' }
  if (LONE_SURROGATE.test(trimmed)) return { ok: false, code: 'ill-formed-text', message: 'A search cannot contain an unpaired UTF-16 surrogate.' }
  return { ok: true, search: trimmed }
}

export type PageErrorCode = 'offset-out-of-range' | 'limit-out-of-range'

export type PageCheck = { ok: true; offset: number; limit: number } | { ok: false; code: PageErrorCode; message: string }

/**
 * A page an adapter may fetch: an offset that is a safe integer of zero or
 * more, and a limit from 1 to `maxPageSize`. A negative or fractional offset
 * means something different to each engine's OFFSET, or is an error in one
 * and not the other; an unbounded page is the full-table load paging exists
 * to avoid.
 */
export function checkPage(offset: unknown, limit: unknown, maxPageSize: number): PageCheck {
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    return { ok: false, code: 'offset-out-of-range', message: 'The offset is a whole number, zero or more.' }
  }
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > maxPageSize) {
    return { ok: false, code: 'limit-out-of-range', message: `The limit is a whole number from 1 to ${String(maxPageSize)}.` }
  }
  return { ok: true, offset, limit }
}
