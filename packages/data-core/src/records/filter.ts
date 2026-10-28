import { checkSearch, MAX_SEARCH_LENGTH } from '../lookup/search.js'
import { isKeyValue } from '../lookup/values.js'
import type { ColumnMeta, NormalizedTypeKind } from '../metadata.js'
import type { FilterCondition, FilterOffer, FilterOp } from '../runtime.js'
import type { EqualsFilterType, RangeFilterType, RecordFilter } from './types.js'

/*
 * A person's own conditions on a list's columns (0104): what a column
 * offers, what a request carries, and the `RecordFilter` an adapter
 * compares. One decision for a form's list and its export (`list.ts`) and
 * for a browse (`browse.ts`), so a condition one of them offers is one each
 * of them accepts, and means the same in each.
 *
 * Structured, never SQL: a condition names a column the server's own
 * snapshot holds, an operator from a closed set, and values as text, each
 * checked and spelled as its column holds it before anything is bound
 * (0011). Every condition must hold, and none permits: the policy's filters
 * and throughs still decide which rows exist.
 *
 * Pure and isomorphic, as the other planners are (plan.ts).
 */

/**
 * What each kind offers besides `null` and `not-null`. A kind missing here
 * offers only those: a float is not equal to the decimal a person types, a
 * time is read cut to the minute, and binary, a rowversion or an
 * unsupported column has no text to compare. A timestamp offers no
 * equality, since a page shows it cut to the second (0040) and a person
 * would type what the page shows: its range is whole days.
 */
const OWN: Partial<Record<NormalizedTypeKind, Omit<FilterOffer, 'days'>>> = {
  text: { operators: ['equals', 'contains'], input: 'text' },
  integer: { operators: ['equals', 'range'], input: 'integer' },
  decimal: { operators: ['equals', 'range'], input: 'decimal' },
  date: { operators: ['equals', 'range'], input: 'date' },
  timestamp: { operators: ['range'], input: 'date' },
  uuid: { operators: ['equals'], input: 'uuid' },
  boolean: { operators: ['equals'], input: 'boolean' },
}

/**
 * What a column offers a filter, from its type and whether it holds NULLs:
 * its kind's own operators, then `null` and `not-null` where the snapshot
 * says it holds NULLs -- or `null` when it offers nothing. A timestamp's
 * offer says whose clock its days are on, which only its type knows. A
 * form's list (`listColumns`), its planner, a browse's planner and the
 * studio ask this one function.
 */
export function filterOffer(column: Pick<ColumnMeta, 'type' | 'nullable'>): FilterOffer | null {
  const own = OWN[column.type.kind]
  const nulls: FilterOp[] = column.nullable ? ['null', 'not-null'] : []
  if (own === undefined) return nulls.length === 0 ? null : { operators: nulls, input: null, days: null }
  const days = column.type.kind !== 'timestamp' ? null : column.type.withTimeZone ? 'utc' : 'wall'
  return { operators: [...own.operators, ...nulls], input: own.input, days }
}

/*
 * Each pattern matches its text one way only, and the zeros a number may
 * lead or trail with are cut by `withoutZeros` rather than by a pattern
 * that could match them twice: a value is the body's, as long as the body,
 * and a run of zeros a pattern backtracks over is time squared.
 */
const INTEGER = /^([+-]?)([0-9]+)$/
const DECIMAL = /^([+-]?)([0-9]*)(?:\.([0-9]*))?$/

/** `digits` without the zeros it leads with (`start`) or trails with (`end`), in one pass. */
function withoutZeros(digits: string, from: 'start' | 'end'): string {
  if (from === 'start') {
    let first = 0
    while (first < digits.length && digits[first] === '0') first += 1
    return digits.slice(first)
  }
  let last = digits.length
  while (last > 0 && digits[last - 1] === '0') last -= 1
  return digits.slice(0, last)
}

/** An integer as a column reads it back: no plus, no leading zero, no negative zero. */
function integerText(given: string): string | null {
  const match = INTEGER.exec(given)
  if (match === null) return null
  const [, sign = '', typed = ''] = match
  const digits = withoutZeros(typed, 'start') || '0'
  return digits === '0' || sign !== '-' ? digits : `-${digits}`
}

/**
 * A decimal as a column of this scale reads it back: no plus, no leading
 * zero, the fraction padded to the scale, and no negative zero. Zeros past
 * the scale change nothing and are dropped; any other digit there is a
 * value the column cannot hold, and the decimal is refused rather than
 * rounded, as each engine would round it its own way. With no scale --
 * PostgreSQL's unconstrained numeric -- the fraction stays as typed: `12.5`
 * and `12.50` are two of its values (0028).
 */
function decimalText(given: string, scale: number | null): string | null {
  const match = DECIMAL.exec(given)
  if (match === null) return null
  const [, sign = '', whole = '', typed = ''] = match
  if (whole === '' && typed === '') return null
  let fraction = typed
  if (scale !== null) {
    fraction = withoutZeros(fraction, 'end')
    if (fraction.length > scale) return null
    fraction = fraction.padEnd(scale, '0')
  }
  const digits = withoutZeros(whole, 'start') || '0'
  const zero = digits === '0' && withoutZeros(fraction, 'start') === ''
  return `${sign === '-' && !zero ? '-' : ''}${digits}${fraction === '' ? '' : `.${fraction}`}`
}

/**
 * `given` spelled as a column of this type holds it, or `null` when no value
 * of the column is spelled so. Text is taken exactly as it is; anything
 * else is trimmed first, a uuid lowercased, and a number spelled without a
 * plus or a leading zero, so a person need not type the canonical form.
 * What is left must be a value the column can hold (`isKeyValue`): a
 * number outside its range or precision is refused, never clamped.
 */
function valueOf(type: EqualsFilterType | Exclude<RangeFilterType, { kind: 'timestamp' }>, given: string): string | null {
  const trimmed = given.trim()
  switch (type.kind) {
    case 'boolean':
      return trimmed === 'true' || trimmed === 'false' ? trimmed : null
    case 'text':
      return isKeyValue(type, given) ? given : null
    case 'integer': {
      const value = integerText(trimmed)
      return value !== null && isKeyValue(type, value) ? value : null
    }
    case 'decimal': {
      const value = decimalText(trimmed, type.scale)
      return value !== null && isKeyValue(type, value) ? value : null
    }
    case 'uuid':
      return isKeyValue(type, trimmed.toLowerCase()) ? trimmed.toLowerCase() : null
    case 'date':
      return isKeyValue(type, trimmed) ? trimmed : null
  }
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/**
 * The day after a real `YYYY-MM-DD`, or `null` after 9999-12-31, the last
 * day both engines store. Counted by hand: a JavaScript Date reads the
 * years 0 to 99 as 1900 to 1999.
 */
export function dayAfter(day: string): string | null {
  let year = Number(day.slice(0, 4))
  let month = Number(day.slice(5, 7))
  let date = Number(day.slice(8, 10)) + 1
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  if (date > (month === 2 && leap ? 29 : (DAYS_IN_MONTH[month - 1] as number))) {
    date = 1
    month += 1
  }
  if (month > 12) {
    month = 1
    year += 1
  }
  return year > 9999 ? null : `${pad(year, 4)}-${pad(month, 2)}-${pad(date, 2)}`
}

/** A condition planned for an adapter, or why it cannot be: a sentence naming the field or column, never a value. */
export type FilterPlanning = { ok: true; filter: RecordFilter } | { ok: false; message: string }

const unheld = (label: string): FilterPlanning => ({ ok: false, message: `A value given for ${label} is not one it can hold.` })

/**
 * A range on a column. A number's or a date's bounds are values the column
 * can hold, inclusive. A timestamp's are dates: from the start of `from`
 * to the end of `to`, compared as at least `from`'s midnight and below the
 * next midnight after `to` -- in UTC for an instant, which a page shows in
 * UTC, and on the wall clock for a timestamp in no zone. A range to
 * 9999-12-31 has no next midnight both engines store, so it has no upper
 * end; with no `from` either it holds every value, and is `not-null`.
 */
function rangeOf(column: Pick<ColumnMeta, 'name'> & { type: RangeFilterType }, from: string | null, to: string | null, label: string): FilterPlanning {
  const { name, type } = column
  if (from === null && to === null) return { ok: false, message: `A range on ${label} has a from, a to or both.` }
  const spell = (given: string): string | null => (type.kind === 'timestamp' ? valueOf({ kind: 'date' }, given) : valueOf(type, given))
  const low = from === null ? null : spell(from)
  const high = to === null ? null : spell(to)
  if ((from !== null && low === null) || (to !== null && high === null)) return unheld(label)
  if (type.kind !== 'timestamp') return { ok: true, filter: { op: 'range', column: name, type, from: low, to: high, before: null } }
  const zone = type.withTimeZone ? 'Z' : ''
  const next = high === null ? null : dayAfter(high)
  if (low === null && next === null) return { ok: true, filter: { op: 'not-null', column: name } }
  const midnight = (day: string | null): string | null => (day === null ? null : `${day}T00:00:00${zone}`)
  return { ok: true, filter: { op: 'range', column: name, type, from: midnight(low), to: null, before: midnight(next) } }
}

/**
 * `condition` on `column`, planned for an adapter -- or why not: an
 * operator `filterOffer` does not offer the column, or a value or a bound
 * it cannot hold. `label` is what the message calls the column: a form's
 * field key, or a browsed column's name.
 *
 * The condition is one `readFilter` read, so a `contains` holds trimmed
 * text that is not empty; `listTerms` holds the result to that again.
 */
export function columnFilter(column: Pick<ColumnMeta, 'name' | 'type' | 'nullable'>, condition: FilterCondition, label: string): FilterPlanning {
  const offer = filterOffer(column)
  if (offer === null || !offer.operators.includes(condition.op)) return { ok: false, message: `${label} offers no ${condition.op} condition.` }
  const { name, type } = column
  switch (condition.op) {
    case 'null':
    case 'not-null':
      return { ok: true, filter: { op: condition.op, column: name } }
    case 'contains':
      // filterOffer offers contains on text alone.
      return { ok: true, filter: { op: 'contains', column: name, type: type as Extract<EqualsFilterType, { kind: 'text' }>, text: condition.text } }
    case 'equals': {
      // filterOffer offers equals on these kinds alone.
      const value = valueOf(type as EqualsFilterType, condition.value)
      return value === null ? unheld(label) : { ok: true, filter: { op: 'equals', column: name, type: type as EqualsFilterType, value } }
    }
    case 'range':
      // filterOffer offers a range on these kinds alone.
      return rangeOf({ name, type: type as RangeFilterType }, condition.from, condition.to, label)
  }
}

/**
 * A filter as a request carried it, read, or why it is not one: `malformed`
 * for a body not shaped as a filter, `not-filterable` for what `contains`
 * would find that a search could not -- the filter's to correct, not the
 * search's.
 */
export type FilterRead<Term> = { ok: true; filter: Term[] } | { ok: false; code: 'malformed' | 'not-filterable'; message: string }

/** The properties of each condition besides its name and its operator. */
const SHAPES: Readonly<Record<FilterOp, readonly string[]>> = { equals: ['value'], range: ['from', 'to'], contains: ['text'], null: [], 'not-null': [] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const malformed = (message: string): { ok: false; code: 'malformed'; message: string } => ({ ok: false, code: 'malformed', message })

/** Whether a record has exactly these keys, so a condition carrying anything else is refused rather than half-read. */
function hasExactly(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

/**
 * Why what a `contains` on `name` finds is no text a search could be, in a
 * sentence of the condition's own: the rules are `checkSearch`'s, and the
 * person typed a condition, not a search.
 */
function unfindable(name: string, code: 'search-too-long' | 'search-control-character' | 'ill-formed-text', length: number): { ok: false; code: 'not-filterable'; message: string } {
  const finds = `What a contains condition on ${name} finds`
  switch (code) {
    case 'search-too-long':
      return { ok: false, code: 'not-filterable', message: `${finds} is at most ${String(MAX_SEARCH_LENGTH)} characters, and this has ${String(length)}.` }
    case 'search-control-character':
      return { ok: false, code: 'not-filterable', message: `${finds} cannot contain a control character.` }
    case 'ill-formed-text':
      return { ok: false, code: 'not-filterable', message: `${finds} cannot contain an unpaired UTF-16 surrogate.` }
  }
}

/** One condition's own properties, checked: text where text is asked for, a bound or `null`, and a search's own check on what `contains` finds. */
function conditionOf(op: FilterOp, entry: Record<string, unknown>, name: string): { ok: true; condition: FilterCondition } | { ok: false; code: 'malformed' | 'not-filterable'; message: string } {
  switch (op) {
    case 'null':
    case 'not-null':
      return { ok: true, condition: { op } }
    case 'equals': {
      const value = entry['value']
      if (typeof value !== 'string') return malformed(`The value ${name} equals is text.`)
      return { ok: true, condition: { op, value } }
    }
    case 'range': {
      const { from, to } = entry
      if ((typeof from !== 'string' && from !== null) || (typeof to !== 'string' && to !== null)) return malformed(`A range on ${name} has bounds of text, or null.`)
      if (from === null && to === null) return malformed(`A range on ${name} has a from, a to or both.`)
      return { ok: true, condition: { op, from, to } }
    }
    case 'contains': {
      const given = entry['text']
      const text = checkSearch(given)
      if (!text.ok) return text.code === 'malformed' ? malformed(`The text a contains condition on ${name} finds is text.`) : unfindable(name, text.code, (given as string).length)
      if (text.search === '') return malformed(`A contains condition on ${name} has text to find.`)
      return { ok: true, condition: { op, text: text.search } }
    }
  }
}

/**
 * A filter from a request's body: a list of conditions, each
 * `{ <key>, op, … }` with exactly the properties its operator has -- a
 * `value` to equal, a `from` and a `to` of a range, the `text` a column
 * contains, nothing more for `null` and `not-null` -- and each `key` named
 * once. Left out, it is `[]`. What `contains` finds is read as a search is
 * (`checkSearch`), trimmed; a value or a bound is read as text and checked
 * against its column by `columnFilter`, which only the planner can.
 */
export function readFilter(given: unknown, key: 'field'): FilterRead<{ field: string } & FilterCondition>
export function readFilter(given: unknown, key: 'column'): FilterRead<{ column: string } & FilterCondition>
export function readFilter(given: unknown, key: 'field' | 'column'): FilterRead<Record<string, unknown>> {
  if (given === undefined) return { ok: true, filter: [] }
  if (!Array.isArray(given)) return malformed(`The filter is a list of { ${key}, op, … }.`)
  const seen = new Set<string>()
  const filter: Array<Record<string, unknown>> = []
  for (const entry of given as unknown[]) {
    if (!isRecord(entry)) return malformed(`Each filter condition is { ${key}, op, … }.`)
    const name = entry[key]
    const op = entry['op']
    if (typeof name !== 'string' || name === '') return malformed(`A filter condition names a ${key}.`)
    if (typeof op !== 'string' || !Object.hasOwn(SHAPES, op)) return malformed(`${name} is filtered by equals, range, contains, null or not-null.`)
    const shape = [key, 'op', ...SHAPES[op as FilterOp]]
    if (!hasExactly(entry, shape)) return malformed(`A ${op} condition on ${name} is { ${shape.join(', ')} } and nothing else.`)
    if (seen.has(name)) return malformed(`${name} is named twice in the filter.`)
    seen.add(name)
    const condition = conditionOf(op as FilterOp, entry, name)
    if (!condition.ok) return condition
    filter.push({ [key]: name, ...condition.condition })
  }
  return { ok: true, filter }
}
