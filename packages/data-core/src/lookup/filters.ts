import type { ObjectMeta, TextLengthUnit } from '../metadata.js'
import type { RowFilter } from '../policy/types.js'
import type { RowFilterTerm, RowFilterType, RowFilters } from './types.js'
import { isKeyValue, isLookupKeyType } from './values.js'

/*
 * Row filters, from a policy's rule to the equalities an adapter applies.
 *
 * `scopeRowFilters` is the one way in: it types each term from the column the
 * snapshot describes and refuses a value not spelled as that column holds it,
 * for a record request and a lookup alike (0028). `rowFilterTerms` is the one
 * way out: an adapter reads the filters through it, and it refuses anything
 * that did not come in that way — at run time, where a caller in JavaScript
 * or a policy read from JSON is not held to the types.
 */

/** A scoping, or why the policy or the context cannot be applied. */
export type FilterScoping =
  | { ok: true; filters: RowFilters }
  | { ok: false; code: 'invalid-policy' | 'invalid-context'; message: string }

/**
 * Why a row filter cannot compare this column of `object`, or null: absent,
 * not readable by the snapshot's account (0027) — every statement the filter
 * scopes would be refused — or a kind outside `RowFilterType`, which has no
 * spelling both engines compare alike.
 *
 * The planner, the publish check and the studio ask this one function, so a
 * column one of them offers is never one another refuses.
 */
export function rowFilterColumnProblem(object: ObjectMeta, column: string): string | null {
  const found = object.columns.find((candidate) => candidate.name === column)
  if (found === undefined) return `${object.ref.name} has no column ${column}`
  if (!found.access.select) return `${column} is a column this connection's account may not read`
  if (!isLookupKeyType(found.type)) {
    return `${column} is ${found.databaseType}, which a row filter cannot compare: only text, integer, decimal, uuid and date columns have one spelling on both engines`
  }
  return null
}

/**
 * The filters for a policy's filter on `object`: the root's, from `rowFilter`
 * or `forcedValues`, or a lookup's target's, from `lookupRowFilter`.
 *
 * Each term is typed from the object's column. A column `rowFilterColumnProblem`
 * names is the policy's fault (`invalid-policy`); a trusted value its column
 * does not hold in that spelling — `'042'` for an integer, `'AB '` for
 * char(n), an upper-case uuid — is the context's (`invalid-context`), and is
 * refused rather than left to each engine to convert. `where` names the
 * policy entry in the message.
 *
 * The one place an empty list may become `unrestricted`: the policy functions
 * return `[]` only when the policy's entry is `[]` — the policy saying "every
 * row" in so many words; a missing entry, or a missing attribute, is a
 * refusal there and never reaches this. Anywhere else, an empty list is still
 * refused, as `RowFilters` says.
 */
export function scopeRowFilters(object: ObjectMeta, filter: RowFilter, where: string): FilterScoping {
  const terms: RowFilterTerm[] = []
  for (const { column, value } of filter) {
    const problem = rowFilterColumnProblem(object, column)
    if (problem !== null) return { ok: false, code: 'invalid-policy', message: `${where}: ${problem}.` }
    // rowFilterColumnProblem found the column and its kind is a key kind.
    const type = object.columns.find((candidate) => candidate.name === column)?.type as RowFilterType
    if (!isKeyValue(type, value)) {
      return {
        ok: false,
        code: 'invalid-context',
        message: `${where}: the trusted value for ${column} is not spelled as the column holds it; refusing rather than letting each engine convert it.`,
      }
    }
    terms.push({ column, type: rowFilterType(type) as RowFilterType, value })
  }
  const [first, ...rest] = terms
  return { ok: true, filters: first === undefined ? { kind: 'unrestricted' } : { kind: 'restricted', equal: [first, ...rest] } }
}

const NOTHING_SAID =
  "Row filters are { kind: 'unrestricted' }, or { kind: 'restricted' } with at least one equality; anything else would read as every row, so it is refused."
const UNTYPED =
  "A row filter term carries its column's type, as the snapshot describes it: text, integer, decimal, uuid or date. Any other kind, or a type no snapshot holds, is refused."

const LENGTH_UNITS: ReadonlySet<unknown> = new Set<TextLengthUnit>(['code-points', 'utf16-code-units', 'utf8-bytes', 'code-page-bytes'])
/** As a snapshot spells an integer's bounds: no sign but a minus, no leading zero. */
const BOUND = /^-?(?:0|[1-9][0-9]*)$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isSafeOrNull = (value: unknown): value is number | null => value === null || Number.isSafeInteger(value)

/**
 * A row filter's type, rebuilt from what a caller handed over, or undefined
 * when it is not one: a kind outside `RowFilterType`, or a field that kind
 * needs missing or of the wrong shape. Fresh, and holding nothing else.
 */
function rowFilterType(type: unknown): RowFilterType | undefined {
  if (!isRecord(type)) return undefined
  switch (type.kind) {
    case 'text': {
      const { maxLength, lengthUnit, fixedLength } = type
      const length = maxLength === null || (Number.isSafeInteger(maxLength) && (maxLength as number) >= 0)
      if (!length || !LENGTH_UNITS.has(lengthUnit) || typeof fixedLength !== 'boolean') return undefined
      return { kind: 'text', maxLength: maxLength as number | null, lengthUnit: lengthUnit as TextLengthUnit, fixedLength }
    }
    case 'integer': {
      const { min, max } = type
      if (typeof min !== 'string' || typeof max !== 'string' || !BOUND.test(min) || !BOUND.test(max)) return undefined
      return { kind: 'integer', min, max }
    }
    case 'decimal': {
      const { precision, scale } = type
      return isSafeOrNull(precision) && isSafeOrNull(scale) ? { kind: 'decimal', precision, scale } : undefined
    }
    case 'uuid':
    case 'date':
      return { kind: type.kind }
    default:
      return undefined
  }
}

/** Whether a record has exactly these keys, so a contradictory policy is not half-read. */
function hasExactly(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

function term(entry: unknown): RowFilterTerm {
  const { column, value, type } = isRecord(entry) ? entry : {}
  if (typeof column !== 'string' || column === '' || typeof value !== 'string') throw new Error('A row filter is a column name and a text value.')
  const typed = rowFilterType(type)
  if (typed === undefined) throw new Error(UNTYPED)
  if (!isKeyValue(typed, value)) throw new Error(`The row filter value for ${column} is not spelled as its column holds it, so it could match nothing the column reads back.`)
  return { column, type: typed, value }
}

/**
 * The equalities an adapter adds to every query it scopes, from the actor's
 * row filters: none for an actor the policy leaves unrestricted, one or more
 * otherwise. Each compares the column's canonical value with `value` exactly
 * (0028), bound as `type`.
 *
 * `RowFilters` already keeps an empty list from meaning "every row"; this
 * keeps it at run time too. Anything but an explicit `unrestricted`, or a
 * `restricted` with at least one typed equality and nothing else, is refused,
 * so a request that arrives without a policy fails instead of seeing every
 * row — and so does a term without its column's type, of a kind a filter
 * cannot compare, or with a value its type does not hold in that spelling.
 * The terms and their types are fresh objects, so nothing else the filters
 * carried reaches a query.
 */
export function rowFilterTerms(filters: RowFilters): RowFilterTerm[] {
  const given: unknown = filters
  if (!isRecord(given)) throw new Error(NOTHING_SAID)
  if (given.kind === 'unrestricted' && hasExactly(given, ['kind'])) return []
  if (given.kind !== 'restricted' || !hasExactly(given, ['kind', 'equal'])) throw new Error(NOTHING_SAID)
  const equal: unknown = given.equal
  if (!Array.isArray(equal) || equal.length === 0) throw new Error(NOTHING_SAID)
  return (equal as unknown[]).map((entry) => term(entry))
}
