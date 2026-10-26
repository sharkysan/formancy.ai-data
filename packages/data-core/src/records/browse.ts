import type { ApiValue } from '../codecs/codec.js'
import { SEARCHABLE_KINDS } from '../lookup/searchable.js'
import { checkPage, checkSearch } from '../lookup/search.js'
import type { PageErrorCode, SearchErrorCode } from '../lookup/search.js'
import type { LookupSearchColumn } from '../lookup/types.js'
import type { ColumnMeta, MetadataSnapshot, NormalizedTypeKind, ObjectMeta, ObjectRef } from '../metadata.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { findObject } from '../snapshot.js'
import { keyOrderProblem } from './prepare.js'
import type { ListRequest, RecordColumn, RecordRead, RecordSort } from './types.js'

/*
 * A table or view's rows, a page at a time, as the connection's account
 * reads them (0099): what an administrator holding a browse role sees in
 * the studio's Browse step. No form, no policy and no binding stands
 * between: the account's own grants and row security decide which rows and
 * columns exist, as they decided what discovery saw. The request is a list's
 * (0044), so an adapter runs it as the statement it runs for a form's page,
 * through the same `listTerms` check.
 *
 * Every name reaching SQL is one the server's own snapshot holds -- the
 * object, each column, the key -- never one the browser typed (0011).
 *
 * Pure and isomorphic, as the other planners are (plan.ts).
 */

/** No canonical text either adapter reads back, so nothing a page could show or order by (`list.ts`'s rule for a list's order). */
const NO_TEXT: ReadonlySet<NormalizedTypeKind> = new Set(['binary', 'rowversion', 'unsupported'])

/** One term of a browse's requested order: a column the page shows, and a direction. */
export interface BrowseSortTerm {
  column: string
  direction: 'asc' | 'desc'
}

/** What a browser asks for: the object, and a list's search, order and page. */
export interface BrowseQuery {
  object: ObjectRef
  search: string
  sort: BrowseSortTerm[]
  offset: number
  limit: number
}

/** Why a column is not on the page: the account may not select it, or it has no text form to show. */
export interface OmittedColumn {
  column: string
  reason: 'not-readable' | 'no-text'
}

export type BrowseRefusalCode = 'unknown-object' | 'nothing-readable' | 'not-sortable' | 'not-searchable'

export interface BrowseRefusal {
  ok: false
  code: BrowseRefusalCode
  /** A sentence a person can read. It names objects and columns, never a value. */
  message: string
}

/**
 * A browse planned: the list request an adapter runs, the columns the page
 * shows in the object's order, those it leaves out and why, and what makes
 * its order total -- `key`, a primary or unique key it shows, or `columns`,
 * every column it shows, for a view or a table with no key it may read.
 * Under `columns`, two rows equal in every shown column may trade places
 * across a page boundary: they look the same on the page, and a column it
 * leaves out may tell them apart.
 */
export interface PlannedBrowse {
  ok: true
  request: ListRequest
  columns: RecordColumn[]
  omitted: OmittedColumn[]
  ordered: 'key' | 'columns'
}

/** One page of rows as the API carries them: canonical values by column, and whether more follow. */
export interface BrowsePage {
  rows: Array<Record<string, ApiValue>>
  hasMore: boolean
}

const refuse = (code: BrowseRefusalCode, message: string): BrowseRefusal => ({ ok: false, code, message })
const nameOf = (ref: ObjectRef): string => `${ref.schema}.${ref.name}`

/**
 * The key the page is ordered by: the primary key, else the first unique
 * key, whose every column is shown and NOT NULL -- or `null`. A key the
 * account may not read cannot end an order it is shown; a nullable one
 * orders its NULLs nowhere in particular (`keyOrderProblem`).
 */
function shownKey(object: ObjectMeta, shown: ReadonlySet<string>): string[] | null {
  const keys = [...(object.primaryKey === null ? [] : [object.primaryKey]), ...object.uniqueKeys]
  const usable = keys.find((key) => key.columns.every((name) => shown.has(name)) && keyOrderProblem(object, key.columns) === null)
  return usable === undefined ? null : [...usable.columns]
}

/**
 * The page `query` asks for of an object in `snapshot`, as its account reads
 * it -- or why not.
 *
 * In this order: the object is one the snapshot holds (`unknown-object`);
 * it has a column the account may select with a text form
 * (`nothing-readable`); every sort term names a shown column
 * (`not-sortable`); a search has a text or integer column to match
 * (`not-searchable`). The order is the requested terms, then the key's
 * columns -- or, without a key it may read, every shown column -- each
 * ascending, NULLs last where the snapshot says a column holds them.
 */
export function planBrowse(snapshot: MetadataSnapshot, query: BrowseQuery): PlannedBrowse | BrowseRefusal {
  const object = findObject(snapshot, query.object)
  if (object === undefined) return refuse('unknown-object', `${nameOf(query.object)} is not a table or view this connection can see.`)
  const omitted: OmittedColumn[] = []
  const shown: ColumnMeta[] = []
  for (const column of object.columns) {
    if (!column.access.select) omitted.push({ column: column.name, reason: 'not-readable' })
    else if (NO_TEXT.has(column.type.kind)) omitted.push({ column: column.name, reason: 'no-text' })
    else shown.push(column)
  }
  if (shown.length === 0) return refuse('nothing-readable', `${nameOf(object.ref)} has no column this connection may read that a page can show.`)
  const byName = new Map(shown.map((column) => [column.name, column]))

  const requested: BrowseSortTerm[] = []
  for (const term of query.sort) {
    if (!byName.has(term.column)) return refuse('not-sortable', `${term.column} is not a column of ${nameOf(object.ref)} this page shows.`)
    requested.push(term)
  }
  const searchable = shown.filter((column) => SEARCHABLE_KINDS.has(column.type.kind))
  if (query.search !== '' && searchable.length === 0) return refuse('not-searchable', `${nameOf(object.ref)} has no text or number column a search can match.`)

  const key = shownKey(object, new Set(byName.keys()))
  const identity = (key ?? shown.map((column) => column.name)).map((name) => byName.get(name) as ColumnMeta)
  const nulls = (column: ColumnMeta): RecordSort['nulls'] => (column.nullable ? 'last' : null)
  const sort: RecordSort[] = requested.map((term) => ({ column: term.column, direction: term.direction, nulls: nulls(byName.get(term.column) as ColumnMeta) }))
  const named = new Set(sort.map((term) => term.column))
  for (const column of identity) if (!named.has(column.name)) sort.push({ column: column.name, direction: 'asc', nulls: nulls(column) })

  const columns = shown.map((column): RecordColumn => ({ name: column.name, type: column.type }))
  const request: ListRequest = {
    target: { table: object.ref, identity: identity.map((column) => ({ name: column.name, type: column.type })), concurrency: null },
    columns,
    filters: { kind: 'unrestricted' },
    through: [],
    equal: [],
    search: query.search === '' ? null : { text: query.search, columns: searchable.map((column) => ({ name: column.name, type: column.type }) as LookupSearchColumn) },
    sort,
    offset: query.offset,
    limit: query.limit,
  }
  return { ok: true, request, columns, omitted, ordered: key === null ? 'columns' : 'key' }
}

/** The rows an adapter fetched, up to `limit + 1`: the page, without the extra row that says more follow. */
export function browsePage(rows: ReadonlyArray<Omit<RecordRead, 'ok'>>, limit: number): BrowsePage {
  return { rows: rows.slice(0, limit).map((row) => row.values), hasMore: rows.length > limit }
}

export type BrowseQueryCheck = { ok: true; query: BrowseQuery } | { ok: false; code: 'malformed' | SearchErrorCode | PageErrorCode; message: string }

const PROPERTIES = new Set(['object', 'search', 'sort', 'offset', 'limit'])
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''
const malformed = (message: string): BrowseQueryCheck => ({ ok: false, code: 'malformed', message })

/** Whether a record has exactly these keys, so one carrying anything else is refused rather than half-read. */
function hasExactly(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

function sortOf(sort: unknown): { ok: true; sort: BrowseSortTerm[] } | { ok: false; message: string } {
  if (sort === undefined) return { ok: true, sort: [] }
  if (!Array.isArray(sort)) return { ok: false, message: 'The sort is a list of { column, direction }.' }
  const seen = new Set<string>()
  const terms: BrowseSortTerm[] = []
  for (const entry of sort as unknown[]) {
    if (!isRecord(entry) || !hasExactly(entry, ['column', 'direction'])) return { ok: false, message: 'Each sort term is { column, direction } and nothing else.' }
    const { column, direction } = entry
    if (!isName(column)) return { ok: false, message: 'A sort term names a column.' }
    if (direction !== 'asc' && direction !== 'desc') return { ok: false, message: `${column} sorts asc or desc.` }
    if (seen.has(column)) return { ok: false, message: `${column} is named twice in the sort.` }
    seen.add(column)
    terms.push({ column, direction })
  }
  return { ok: true, sort: terms }
}

/**
 * The query a browse is planned from, from a request's body: the object as
 * `{ schema, name }` and nothing else, then a list's search and page, read
 * by a list's own checks, and a sort by column. Everything but the object
 * may be left out -- the search is then `''`, the sort `[]`, the offset 0
 * and the limit `LIST_PAGE_SIZE` -- and any other property is refused.
 */
export function validateBrowseQuery(body: unknown): BrowseQueryCheck {
  if (!isRecord(body)) return malformed('A browse query is an object.')
  const unknown = Object.keys(body).filter((key) => !PROPERTIES.has(key))
  if (unknown.length > 0) return malformed(`A browse query has an object, a search, a sort, an offset and a limit, and not ${unknown.join(', ')}.`)
  const object = body['object']
  if (!isRecord(object) || !hasExactly(object, ['schema', 'name']) || !isName(object['schema']) || !isName(object['name'])) {
    return malformed('The object is { schema, name }, both named.')
  }
  const search = checkSearch(body['search'] === undefined ? '' : body['search'])
  if (!search.ok) return search
  const sort = sortOf(body['sort'])
  if (!sort.ok) return malformed(sort.message)
  const page = checkPage(body['offset'] ?? 0, body['limit'] ?? LIST_PAGE_SIZE, LIST_PAGE_SIZE)
  if (!page.ok) return page
  return { ok: true, query: { object: { schema: object['schema'], name: object['name'] }, search: search.search, sort: sort.sort, offset: page.offset, limit: page.limit } }
}
