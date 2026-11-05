import { rowFilterTerms } from '../lookup/filters.js'
import type { LookupKeyType, RowFilterTerm } from '../lookup/types.js'
import { isLookupKeyType } from '../lookup/values.js'
import type { NormalizedType, ObjectRef } from '../metadata.js'
import type { SortLabel } from './types.js'

/*
 * A lookup's label in a list's order (0136), as an adapter reads it: at run
 * time, where a caller in JavaScript or a request rebuilt from JSON is not
 * held to the types, as a through is read (`through.ts`). What the planner
 * never writes is thrown, never ordered by.
 */

/** A lookup's label as an adapter orders by it: the target, each root column with the target column it references and that column's kind, the target's filter terms -- none where it filters nothing -- and the display column's name. */
export interface LabelTerms extends LookupReach {
  display: string
}

/** One term of the order an adapter builds a list statement from: a lookup's label, its NULLs always last. */
export interface LabelSortTerm {
  label: LabelTerms
  direction: 'asc' | 'desc'
  nulls: 'last'
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''

function hasExactly(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

/** One side of the key: each column named and of a key kind, or undefined. */
function keyColumns(value: unknown): Array<{ name: string; type: LookupKeyType }> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const columns: Array<{ name: string; type: LookupKeyType }> = []
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || !isName(entry['name']) || !isRecord(entry['type']) || !isLookupKeyType(entry['type'] as NormalizedType)) return undefined
    columns.push({ name: entry['name'], type: entry['type'] as LookupKeyType })
  }
  return columns
}

/** A lookup's way to its target as an adapter reaches it (0136, 0139): the target, each root column with the target column it references and that column's kind, and the target's filter terms, none where it filters nothing. */
export interface LookupReach {
  target: ObjectRef
  pairs: Array<{ column: string; references: string; type: LookupKeyType }>
  terms: RowFilterTerm[]
}

/** The way to a lookup's target a label or a related filter carries, read fresh, or why not: `refuse` words the refusal as the rest of the request's are. */
export function readReach(entry: Record<string, unknown>, refuse: (why: string) => Error): LookupReach {
  const target = entry['target']
  if (!isRecord(target) || !hasExactly(target, ['schema', 'name']) || !isName(target['schema']) || !isName(target['name']))
    throw refuse('reaches a lookup’s target named by schema and name')
  const columns = keyColumns(entry['columns'])
  const references = keyColumns(entry['targetColumns'])
  if (columns === undefined || references === undefined || columns.length !== references.length)
    throw refuse('reaches a lookup’s target by each root column paired with the key column it references, each of a key kind')
  let terms: RowFilterTerm[]
  try {
    terms = rowFilterTerms(entry['filters'] as SortLabel['filters'])
  } catch {
    throw refuse('reaches a lookup’s target under its lookup’s filters, read as a row filter is')
  }
  return {
    target: { schema: target['schema'], name: target['name'] },
    pairs: columns.map((column, index) => {
      const reference = references[index] as { name: string; type: LookupKeyType }
      return { column: column.name, references: reference.name, type: { ...reference.type } }
    }),
    terms,
  }
}

/** A label term of a list request's order, read fresh, or why not: `refuse` words the adapter's refusal as the rest of the request's are. */
export function readLabelSort(entry: Record<string, unknown>, refuse: (why: string) => Error): LabelSortTerm {
  const { label, direction, nulls } = entry
  if (!hasExactly(entry, ['label', 'direction', 'nulls']) || (direction !== 'asc' && direction !== 'desc') || nulls !== 'last')
    throw refuse('orders by a lookup’s label asc or desc, its NULLs last')
  if (!isRecord(label) || !hasExactly(label, ['columns', 'target', 'targetColumns', 'filters', 'display']))
    throw refuse('orders by a label of columns, a target, its key columns, filters and a display column, and nothing else')
  const reach = readReach(label, refuse)
  const display = label['display']
  if (!isRecord(display) || !hasExactly(display, ['name', 'type']) || !isName(display['name'])) throw refuse('orders by a label’s named display column')
  return { label: { ...reach, display: display['name'] }, direction, nulls }
}
