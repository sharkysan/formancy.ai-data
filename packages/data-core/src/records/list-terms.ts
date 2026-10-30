import { rowFilterTerms, rowFilterType } from '../lookup/filters.js'
import { checkPage, checkSearch } from '../lookup/search.js'
import type { LookupSearchColumn, RowFilterTerm } from '../lookup/types.js'
import { isKeyValue, isLookupKeyType } from '../lookup/values.js'
import type { NormalizedType } from '../metadata.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { throughTerms } from './through.js'
import type { ThroughTerms } from './through.js'
import type { EqualsFilterType, ListRequest, RangeFilterType, RecordColumn, RecordFilter, RecordSort, RecordValue } from './types.js'

/**
 * A list request as an adapter builds its statement from it (0044): the
 * filters and throughs as `rowFilterTerms` and `throughTerms` read them, and
 * the parent, the person's filter (0104), the search, the order and the
 * page, each checked.
 *
 * `after` (0108): the key of the row the page continues after, and `seek`,
 * the columns of the order a row is compared with that row by -- the order
 * without every column the scope holds to one value, which every row the
 * page could hold has alike. `null` for a page from the start.
 */
export interface ListTerms {
  terms: RowFilterTerm[]
  through: ThroughTerms[]
  equal: RecordValue[]
  filter: RecordFilter[]
  search: { text: string; columns: LookupSearchColumn[] } | null
  sort: RecordSort[]
  after: { key: RecordValue[]; seek: RecordSort[] } | null
  offset: number
  limit: number
}

const refuse = (why: string) => new Error(`A list request ${why}; refusing rather than listing something else than the planner decided.`)
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** The parent's columns and values: each named once, of a key kind, and spelled as its column holds it, as a record key is. */
function equalOf(given: unknown): RecordValue[] {
  if (!Array.isArray(given)) throw refuse('narrows by a list of columns and values, [] for none')
  const seen = new Set<string>()
  return (given as unknown[]).map((entry) => {
    if (!isRecord(entry) || !isName(entry['name']) || !isRecord(entry['type'])) throw refuse('names each parent column and its type')
    const type = entry['type'] as NormalizedType
    const value = entry['value']
    if (!isLookupKeyType(type) || typeof value !== 'string' || !isKeyValue(type, value))
      throw refuse('narrows by key values spelled as their columns hold them')
    if (seen.has(entry['name'])) throw refuse(`names ${entry['name']} twice in its parent`)
    seen.add(entry['name'])
    return { name: entry['name'], type, value }
  })
}

/** An equality's type, fresh: a row filter's, or a boolean. */
function equalsType(type: unknown): EqualsFilterType | undefined {
  return isRecord(type) && type['kind'] === 'boolean' ? { kind: 'boolean' } : rowFilterType(type)
}

/** A range's type, fresh: an integer, a decimal or a date as a row filter's, or a timestamp. */
function rangeType(type: unknown): RangeFilterType | undefined {
  if (isRecord(type) && type['kind'] === 'timestamp') {
    const { withTimeZone, precision } = type
    if (typeof withTimeZone !== 'boolean' || !(precision === null || (Number.isSafeInteger(precision) && (precision as number) >= 0))) return undefined
    return { kind: 'timestamp', withTimeZone, precision: precision as number | null }
  }
  const typed = rowFilterType(type)
  return typed?.kind === 'integer' || typed?.kind === 'decimal' || typed?.kind === 'date' ? typed : undefined
}

/** A timestamp's bound as `columnFilter` spells it: the midnight starting a real day, with `Z` for an instant. */
const MIDNIGHT = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T00:00:00(Z?)$/

/** One bound of a range, or `null`: a value a number's or a date's column holds, or a timestamp's midnight. */
function boundOf(type: RangeFilterType, value: unknown, column: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw refuse(`bounds ${column} by text, or null`)
  if (type.kind !== 'timestamp') {
    if (!isKeyValue(type, value)) throw refuse(`bounds ${column} by values spelled as it holds them`)
    return value
  }
  const midnight = MIDNIGHT.exec(value)
  if (midnight === null || (midnight[2] === 'Z') !== type.withTimeZone || !isKeyValue({ kind: 'date' }, midnight[1] as string)) {
    throw refuse(`bounds ${column} by midnights spelled as its timestamps are`)
  }
  return value
}

/**
 * One condition of the person's filter, fresh, holding what `columnFilter`
 * would have planned and nothing else: an operator from the closed set, a
 * named column, and for each operator the type it compares and values
 * spelled as that type holds them. A range has at least one bound, and its
 * upper one is `to` for a number or a date and `before` for a timestamp,
 * never the other.
 */
function filterTerm(entry: unknown): RecordFilter {
  if (!isRecord(entry) || !isName(entry['column'])) throw refuse('names the column of each filter condition')
  const column = entry['column']
  switch (entry['op']) {
    case 'null':
      return { op: 'null', column }
    case 'not-null':
      return { op: 'not-null', column }
    case 'equals': {
      const type = equalsType(entry['type'])
      const value = entry['value']
      if (type === undefined || typeof value !== 'string') throw refuse(`compares ${column} as text, an integer, a decimal, a uuid, a date or a boolean`)
      if (type.kind === 'boolean' ? value !== 'true' && value !== 'false' : !isKeyValue(type, value))
        throw refuse(`compares ${column} with a value spelled as it holds them`)
      return { op: 'equals', column, type, value }
    }
    case 'contains': {
      const type = rowFilterType(entry['type'])
      const text = checkSearch(entry['text'])
      if (type?.kind !== 'text') throw refuse(`finds text only in a text column, and ${column} is not one`)
      if (!text.ok || text.search === '' || text.search !== entry['text'])
        throw refuse(`finds text in ${column} a person may search for, trimmed and not empty`)
      return { op: 'contains', column, type, text: text.search }
    }
    case 'range': {
      const type = rangeType(entry['type'])
      if (type === undefined) throw refuse(`ranges over ${column} as an integer, a decimal, a date or a timestamp`)
      const from = boundOf(type, entry['from'], column)
      const to = boundOf(type, entry['to'], column)
      const before = boundOf(type, entry['before'], column)
      if (type.kind === 'timestamp' ? to !== null : before !== null)
        throw refuse(`bounds ${column} at most a value when it is a number or a date, and below a midnight when it is a timestamp`)
      if (from === null && to === null && before === null) throw refuse(`ranges over ${column} with at least one bound`)
      return { op: 'range', column, type, from, to, before }
    }
    default:
      throw refuse('filters by equals, range, contains, null or not-null')
  }
}

/** The person's filter: a list of conditions, `[]` for none. Two on one column both hold, as they should. */
function filterOf(given: unknown): RecordFilter[] {
  if (!Array.isArray(given)) throw refuse('filters by a list of conditions, [] for none')
  return (given as unknown[]).map((entry) => filterTerm(entry))
}

/** The search: null, or text a person may search for, trimmed and not empty, over at least one text or integer column. */
function searchOf(given: unknown): ListTerms['search'] {
  if (given === null) return null
  if (!isRecord(given) || !Array.isArray(given['columns']) || given['columns'].length === 0) throw refuse('searches null, or text over at least one column')
  const text = checkSearch(given['text'])
  if (!text.ok || text.search === '' || text.search !== given['text']) throw refuse('searches text a person may search for, trimmed and not empty')
  const columns = (given['columns'] as unknown[]).map((entry): LookupSearchColumn => {
    const type = isRecord(entry) ? entry['type'] : undefined
    if (!isRecord(entry) || !isName(entry['name']) || !isRecord(type) || (type['kind'] !== 'text' && type['kind'] !== 'integer')) {
      throw refuse('searches only text and integer columns, which both engines spell alike')
    }
    return { name: entry['name'], type: type as LookupSearchColumn['type'] }
  })
  return { text: text.search, columns }
}

/**
 * The order: each column once, ascending or descending, NULLs last or not
 * spelled, and every identity column named, so the order is total and a
 * page boundary never falls between two rows that sort equal.
 */
function sortOf(given: unknown, identity: readonly string[]): RecordSort[] {
  if (!Array.isArray(given) || given.length === 0) throw refuse('is ordered by at least one column')
  const seen = new Set<string>()
  const sort = (given as unknown[]).map((entry): RecordSort => {
    if (!isRecord(entry) || !isName(entry['column'])) throw refuse('orders by named columns')
    const { column, direction, nulls } = entry
    if ((direction !== 'asc' && direction !== 'desc') || (nulls !== 'last' && nulls !== null))
      throw refuse(`orders ${column} asc or desc, its NULLs last or unspelled`)
    if (seen.has(column)) throw refuse(`orders by ${column} twice`)
    seen.add(column)
    return { column, direction, nulls }
  })
  if (!identity.every((name) => seen.has(name))) throw refuse('is ordered by every identity column, so the order is total')
  return sort
}

/**
 * The key a page continues after: every identity column, in the identity's
 * order, each of a key kind and spelled as it holds it, as a record key is.
 */
function afterKey(given: unknown, identity: readonly RecordColumn[]): RecordValue[] {
  if (!Array.isArray(given) || given.length !== identity.length) throw refuse('continues after a key of every identity column')
  return (given as unknown[]).map((entry, index) => {
    const column = identity[index] as RecordColumn
    if (!isRecord(entry) || entry['name'] !== column.name) throw refuse("continues after a key in the identity's order")
    const value = entry['value']
    if (!isLookupKeyType(column.type) || typeof value !== 'string' || !isKeyValue(column.type, value))
      throw refuse(`continues after a ${column.name} spelled as it holds it`)
    return { name: column.name, type: column.type, value }
  })
}

/**
 * The columns of `sort` a row is compared with the row a page continues
 * after by: every one but those the scope holds to one value -- a trusted
 * filter's equality, the parent's, the person's own `equals`. Every row the
 * page could hold has that value, so it ties there with the row it continues
 * after and never comes after it by that column; compared anyway, a key
 * whose first column is the tenant would be a comparison of two columns no
 * index seeks by, where the column after it alone is a range of the key's
 * index.
 */
function seekOf(sort: readonly RecordSort[], terms: readonly RowFilterTerm[], equal: readonly RecordValue[], filter: readonly RecordFilter[]): RecordSort[] {
  const held = new Set([
    ...terms.map((term) => term.column),
    ...equal.map((value) => value.name),
    ...filter.filter((term) => term.op === 'equals').map((term) => term.column),
  ])
  return sort.filter((term) => !held.has(term.column))
}

/**
 * The terms an adapter builds a list statement from, read as `rowFilterTerms`
 * reads the filters: at run time, where a caller in JavaScript or a request
 * rebuilt from JSON is not held to the types. Anything `planList` would not
 * have produced -- an order that is not total, a page larger than
 * `LIST_PAGE_SIZE`, a search over a kind the engines spell apart, a parent
 * value its column cannot hold, a filter condition `columnFilter` would not
 * have planned, a key to continue after that is not one of the identity's,
 * or both a key and an offset -- throws before a statement is built. The
 * result is fresh, so nothing else the request carried reaches SQL.
 */
export function listTerms(request: ListRequest): ListTerms {
  const identity = request.target.identity.map((column) => column.name)
  if (identity.length === 0) throw refuse('lists a target with an identity')
  const page = checkPage(request.offset, request.limit, LIST_PAGE_SIZE)
  if (!page.ok) throw refuse(`pages from an offset of zero or more, at most ${String(LIST_PAGE_SIZE)} rows at a time`)
  const terms = rowFilterTerms(request.filters)
  const equal = equalOf(request.equal)
  const filter = filterOf(request.filter)
  const sort = sortOf(request.sort, identity)
  let after: ListTerms['after'] = null
  if (request.after !== null) {
    if (page.offset !== 0) throw refuse('starts either after a key or at an offset, never both')
    after = { key: afterKey(request.after, request.target.identity), seek: seekOf(sort, terms, equal, filter) }
  }
  return {
    terms,
    through: throughTerms(request.through),
    equal,
    filter,
    search: searchOf(request.search),
    sort,
    after,
    offset: page.offset,
    limit: page.limit,
  }
}
