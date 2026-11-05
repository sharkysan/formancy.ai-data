import type { FieldBinding } from '../generate/types.js'
import { decodeKeyToken } from '../lookup/token.js'
import { isLookupKeyType } from '../lookup/values.js'
import type { ColumnMeta } from '../metadata.js'
import type { FilterCondition, FilterOffer, FilterOp } from '../runtime.js'
import { lookupAnswer } from './answers.js'
import type { RecordFilter } from './types.js'

/*
 * A person's conditions on a lookup field (0135): the record it refers to,
 * or whether it refers to one. A lookup holds a token, not the label a
 * person reads, so it is filtered by the record a person picked -- its
 * token, decoded through the root's foreign-key columns as a parent's is
 * (`list.ts`'s `parentEqual`) -- and each column is compared by the
 * database's own equality, as the foreign key compares it, never by the
 * exact equality a typed value gets (`refers`, not `equals`).
 *
 * Pure and isomorphic, as filter.ts is.
 */

type LookupBinding = Extract<FieldBinding, { kind: 'lookup' }>

/**
 * What a lookup offers a filter: the record it refers to, and, for a key
 * of one nullable column, whether it refers to one. A key of several
 * columns refers to nothing when any of them is NULL, which a page shows
 * as empty and no condition on one column says, so it offers equality
 * alone.
 */
export function lookupFilterOffer(binding: Pick<LookupBinding, 'columns' | 'nullable'>): FilterOffer {
  const nulls: FilterOp[] = binding.nullable && binding.columns.length === 1 ? ['null', 'not-null'] : []
  return { operators: ['equals', ...nulls], input: 'lookup', days: null }
}

/**
 * Why `condition` is not one a list could plan on the lookup `binding`, as
 * far as the binding tells -- or `null`: an operator it does not offer, or
 * a value that is no token of as many values as the key has columns.
 * Whether each value fits its column is `lookupFilter`'s, which has the
 * columns; a view's fit has the bindings alone (`viewFit`).
 */
export function lookupConditionProblem(binding: Pick<LookupBinding, 'columns' | 'nullable'>, condition: FilterCondition, label: string): string | null {
  if (!lookupFilterOffer(binding).operators.includes(condition.op)) return `${label} offers no ${condition.op} condition.`
  if (condition.op !== 'equals') return null
  const decoded = decodeKeyToken(condition.value)
  return decoded.ok && decoded.values.length === binding.columns.length ? null : unheldRecord(label)
}

const unheldRecord = (label: string): string => `A record given for ${label} is not one it can refer to.`

/**
 * `condition` on the lookup `binding`, planned for an adapter -- or why
 * not: an operator it does not offer, or a token no row it can refer to
 * could have. `columns` are the root's foreign-key columns, in the
 * binding's order; `label` what the message calls the field.
 */
export function lookupFilter(
  binding: LookupBinding,
  columns: readonly ColumnMeta[],
  condition: FilterCondition,
  label: string,
): { ok: true; filters: RecordFilter[] } | { ok: false; message: string } {
  const problem = lookupConditionProblem(binding, condition, label)
  if (problem !== null) return { ok: false, message: problem }
  // lookupFilterOffer offers null and not-null on a key of one column alone.
  if (condition.op === 'null' || condition.op === 'not-null') return { ok: true, filters: [{ op: condition.op, column: binding.columns[0] as string }] }
  const unheld = { ok: false as const, message: unheldRecord(label) }
  // lookupFilterOffer offers equals besides those, and nothing else.
  const decoded = lookupAnswer(binding, columns, (condition as Extract<FilterCondition, { op: 'equals' }>).value, new Map())
  if (!decoded.ok) return unheld
  const filters: RecordFilter[] = []
  for (const value of decoded.values) {
    if (!isLookupKeyType(value.type) || typeof value.value !== 'string') return unheld
    filters.push({ op: 'refers', column: value.name, type: value.type, value: value.value })
  }
  return { ok: true, filters }
}
