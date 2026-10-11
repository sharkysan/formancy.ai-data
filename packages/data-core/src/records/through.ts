import { rowFilterTerms } from '../lookup/filters.js'
import type { RowFilterTerm } from '../lookup/types.js'
import type { NormalizedType, ObjectRef } from '../metadata.js'
import { isThroughKeyType } from '../policy/through.js'
import type { Through } from './types.js'

/** A through as an adapter builds its EXISTS from it: the target, each root column with the target column it references, and the target's filter terms. */
export interface ThroughTerms {
  target: ObjectRef
  pairs: Array<{ column: string; references: string }>
  terms: RowFilterTerm[]
}

const NOT_A_LIST = "A request's throughs are a list, [] for none; anything else would read as no scope at all, so it is refused."

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''

function hasExactly(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

/** One side of the key: each column named and of a kind a through compares without a collation, or undefined. */
function keyColumns(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const names: string[] = []
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || !isName(entry['name']) || !isRecord(entry['type']) || !isThroughKeyType(entry['type'] as NormalizedType)) return undefined
    names.push(entry['name'])
  }
  return names
}

function read(entry: unknown): ThroughTerms {
  const refuse = (why: string) => new Error(`A through ${why}; refusing rather than scoping less than the policy said.`)
  if (!isRecord(entry) || !hasExactly(entry, ['columns', 'target', 'targetColumns', 'filters'])) throw refuse('is columns, a target, its key columns and filters, and nothing else')
  const target = entry['target']
  if (!isRecord(target) || !hasExactly(target, ['schema', 'name']) || !isName(target['schema']) || !isName(target['name'])) throw refuse('names its target table by schema and name')
  const columns = keyColumns(entry['columns'])
  const references = keyColumns(entry['targetColumns'])
  if (columns === undefined || references === undefined || columns.length !== references.length) {
    throw refuse('pairs each root column with the target column it references, each an integer, decimal, uuid or date')
  }
  const terms = rowFilterTerms(entry['filters'] as Through['filters'])
  if (terms.length === 0) throw refuse("scopes nothing without its target's filter")
  return { target: { schema: target['schema'], name: target['name'] }, pairs: columns.map((column, index) => ({ column, references: references[index] as string })), terms }
}

/**
 * The throughs an adapter puts in every statement that locates a record
 * (0043), read as `rowFilterTerms` reads the filters: at run time, where a
 * caller in JavaScript or a request rebuilt from JSON is not held to the
 * types. A list, `[]` for none; each entry a target, its key paired with the
 * root's foreign-key columns, each of a kind `isThroughKeyType` accepts, and
 * a filter that restricts. Anything else throws before a statement is built.
 * The result is fresh, so nothing else the request carried reaches SQL.
 */
export function throughTerms(through: readonly Through[]): ThroughTerms[] {
  const given: unknown = through
  if (!Array.isArray(given)) throw new Error(NOT_A_LIST)
  return (given as unknown[]).map((entry) => read(entry))
}
