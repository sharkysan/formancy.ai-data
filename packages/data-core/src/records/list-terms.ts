import { rowFilterTerms } from '../lookup/filters.js'
import { checkPage, checkSearch } from '../lookup/search.js'
import type { LookupSearchColumn, RowFilterTerm } from '../lookup/types.js'
import { isKeyValue, isLookupKeyType } from '../lookup/values.js'
import type { NormalizedType } from '../metadata.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { throughTerms } from './through.js'
import type { ThroughTerms } from './through.js'
import type { ListRequest, RecordSort, RecordValue } from './types.js'

/**
 * A list request as an adapter builds its statement from it (0044): the
 * filters and throughs as `rowFilterTerms` and `throughTerms` read them, and
 * the parent, the search, the order and the page, each checked.
 */
export interface ListTerms {
  terms: RowFilterTerm[]
  through: ThroughTerms[]
  equal: RecordValue[]
  search: { text: string; columns: LookupSearchColumn[] } | null
  sort: RecordSort[]
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
    if (!isRecord(entry) || !isName(entry['name']) || !isRecord(entry['type'])) throw refuse("names each parent column and its type")
    const type = entry['type'] as NormalizedType
    const value = entry['value']
    if (!isLookupKeyType(type) || typeof value !== 'string' || !isKeyValue(type, value)) throw refuse('narrows by key values spelled as their columns hold them')
    if (seen.has(entry['name'])) throw refuse(`names ${entry['name']} twice in its parent`)
    seen.add(entry['name'])
    return { name: entry['name'], type, value }
  })
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
    if ((direction !== 'asc' && direction !== 'desc') || (nulls !== 'last' && nulls !== null)) throw refuse(`orders ${column} asc or desc, its NULLs last or unspelled`)
    if (seen.has(column)) throw refuse(`orders by ${column} twice`)
    seen.add(column)
    return { column, direction, nulls }
  })
  if (!identity.every((name) => seen.has(name))) throw refuse('is ordered by every identity column, so the order is total')
  return sort
}

/**
 * The terms an adapter builds a list statement from, read as `rowFilterTerms`
 * reads the filters: at run time, where a caller in JavaScript or a request
 * rebuilt from JSON is not held to the types. Anything `planList` would not
 * have produced -- an order that is not total, a page larger than
 * `LIST_PAGE_SIZE`, a search over a kind the engines spell apart, a parent
 * value its column cannot hold -- throws before a statement is built. The
 * result is fresh, so nothing else the request carried reaches SQL.
 */
export function listTerms(request: ListRequest): ListTerms {
  const identity = request.target.identity.map((column) => column.name)
  if (identity.length === 0) throw refuse('lists a target with an identity')
  const page = checkPage(request.offset, request.limit, LIST_PAGE_SIZE)
  if (!page.ok) throw refuse(`pages from an offset of zero or more, at most ${String(LIST_PAGE_SIZE)} rows at a time`)
  return {
    terms: rowFilterTerms(request.filters),
    through: throughTerms(request.through),
    equal: equalOf(request.equal),
    search: searchOf(request.search),
    sort: sortOf(request.sort, identity),
    offset: page.offset,
    limit: page.limit,
  }
}
