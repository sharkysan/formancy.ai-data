import type { RowFilter } from '../policy/types.js'
import type { RowFilterTerm, RowFilters } from './types.js'

/**
 * The lookup filters for what `lookupRowFilter` returned.
 *
 * The one place an empty list may become `unrestricted`: `lookupRowFilter`
 * returns `[]` only when the policy's entry for the lookup is `[]`, which is
 * the policy saying "every row" in so many words — a missing entry, or a
 * missing attribute, is a refusal there and never reaches this. Anywhere
 * else, an empty list is still refused, as `RowFilters` says.
 */
export function lookupFilters(filter: RowFilter): RowFilters {
  const [first, ...rest] = filter.map(({ column, value }) => ({ column, value }))
  return first === undefined ? { kind: 'unrestricted' } : { kind: 'restricted', equal: [first, ...rest] }
}

const NOTHING_SAID =
  "Row filters are { kind: 'unrestricted' }, or { kind: 'restricted' } with at least one equality; anything else would read as every row, so it is refused."

/** Whether a record has exactly these keys, so a contradictory policy is not half-read. */
function hasExactly(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

function term(entry: unknown): RowFilterTerm {
  if (typeof entry === 'object' && entry !== null) {
    const { column, value } = entry as Record<string, unknown>
    if (typeof column === 'string' && column !== '' && typeof value === 'string') return { column, value }
  }
  throw new Error('A row filter is a column name and a text value.')
}

/**
 * The equalities an adapter adds to every lookup query, from the actor's row
 * filters: none for an actor the policy leaves unrestricted, one or more
 * otherwise.
 *
 * `RowFilters` already keeps an empty list from meaning "every row"; this
 * keeps it at run time too. Anything but an explicit `unrestricted`, or a
 * `restricted` with at least one column-and-text equality and nothing else, is
 * refused, so a request that arrives without a policy fails instead of seeing
 * every row. The terms are fresh objects, so nothing else the filters carried
 * reaches a query.
 */
export function rowFilterTerms(filters: RowFilters): RowFilterTerm[] {
  const given: unknown = filters
  if (typeof given !== 'object' || given === null || Array.isArray(given)) throw new Error(NOTHING_SAID)
  const record = given as Record<string, unknown>
  if (record.kind === 'unrestricted' && hasExactly(record, ['kind'])) return []
  if (record.kind !== 'restricted' || !hasExactly(record, ['kind', 'equal'])) throw new Error(NOTHING_SAID)
  const equal: unknown = record.equal
  if (!Array.isArray(equal) || equal.length === 0) throw new Error(NOTHING_SAID)
  return (equal as unknown[]).map((entry) => term(entry))
}
