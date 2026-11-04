import type { PolicyContext } from '../policy/types.js'
import type { FilterInput, ListFilterTerm, ViewFilterTerm, ViewValue } from '../runtime.js'

/*
 * The values a stored list view may compare with that are relative to whom
 * and when it is offered (0125): `{ today: n }`, whole days from the day it
 * is offered -- on a date, the bound itself; on a timestamp, the whole days
 * a range of it reads (0104) -- and `{ attribute: name }`, the signed-in
 * person's attribute of that name, as their token carries it: "my orders"
 * where the deployment's token carries the employee a person is. The server
 * resolves them when it offers a person the view (`viewsFor`), so what a
 * person picks is a list request with typed values, as before; a relative
 * value is never sent to a page.
 */

/** How far from the day it is offered a relative day may be: a century, either way. */
const DAYS = 36_500

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether `value` is a relative value, by shape alone; what each must hold is `valueProblem`'s. */
export function isRelative(value: unknown): value is Exclude<ViewValue, string> {
  return isRecord(value) && (Object.hasOwn(value, 'today') || Object.hasOwn(value, 'attribute'))
}

/** Why a relative value is not one a view may hold, at `at`, or `null`. */
function valueProblem(value: Record<string, unknown>, at: string): string | null {
  const keys = Object.keys(value)
  if (keys.length !== 1) return `${at} must be text, { today: whole days } or { attribute: a name }`
  if (keys[0] === 'today') {
    const days = value['today']
    return typeof days === 'number' && Number.isSafeInteger(days) && Math.abs(days) <= DAYS
      ? null
      : `${at}/today must be whole days, at most ${String(DAYS)} either way`
  }
  const name = value['attribute']
  return typeof name === 'string' && name !== '' ? null : `${at}/attribute must name an attribute`
}

/**
 * Every reason the relative values of one stored condition are not shaped
 * as a view's, and the condition with each replaced by text of the same
 * place, for the rest of its shape to be read as a request's. Text stands
 * in for a relative value only here; what it compares with is checked when
 * the view is fitted (`standIn`) and when it is offered (`resolveTerm`).
 */
export function relativeShape(term: Record<string, unknown>, at: string): { problems: string[]; read: Record<string, unknown> } {
  const problems: string[] = []
  const read = { ...term }
  for (const place of ['value', 'from', 'to'] as const) {
    const value = term[place]
    if (!isRecord(value)) continue
    const problem = valueProblem(value, `${at}/${place}`)
    if (problem !== null) problems.push(problem)
    read[place] = 'relative'
  }
  return { problems, read }
}

/** `date` plus `days`, as a date: the calendar's, with no clock. */
function shifted(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/** A value for a person on `today`, or `null` where it names an attribute they do not carry. */
function resolveValue(value: ViewValue, today: string, context: PolicyContext): string | null {
  if (typeof value === 'string') return value
  if ('today' in value) return shifted(today, value.today)
  return Object.hasOwn(context.attributes, value.attribute) ? (context.attributes[value.attribute] as string) : null
}

/**
 * A stored condition as a person of `context` is offered it on `today`, a
 * date: each relative value resolved, or `null` where one names an
 * attribute they do not carry -- the view is then not theirs, closed as a
 * row filter is on a missing attribute (0011).
 */
export function resolveTerm(term: ViewFilterTerm, today: string, context: PolicyContext): ListFilterTerm | null {
  switch (term.op) {
    case 'equals': {
      const value = resolveValue(term.value, today, context)
      return value === null ? null : { field: term.field, op: 'equals', value }
    }
    case 'range': {
      const from = term.from === null ? null : resolveValue(term.from, today, context)
      const to = term.to === null ? null : resolveValue(term.to, today, context)
      if ((term.from !== null && from === null) || (term.to !== null && to === null)) return null
      return { field: term.field, op: 'range', from, to, ...(term.exclusive === undefined ? {} : { exclusive: term.exclusive }) }
    }
    default:
      return term
  }
}

/** What stands in for an attribute's value when a view is fitted at a write: one each input's codec reads, as some person's could be. */
const STAND_IN: Partial<Record<FilterInput, string>> = { text: 'x', integer: '0', uuid: '00000000-0000-4000-8000-000000000000' }

/**
 * A stored condition as a write fits it, on `today`: a relative day
 * resolved, and an attribute replaced by a value of the field's input -- or
 * why the field cannot hold a relative value: a day where its values are no
 * dates, an attribute but for an equality on text, a whole number or a
 * uuid, since a person's attribute is text and nothing else. Whether a
 * person's own value fits the column is decided when they are offered it.
 */
export function standIn(term: ViewFilterTerm, input: FilterInput | null, today: string): { ok: true; term: ListFilterTerm } | { ok: false; message: string } {
  const values = term.op === 'equals' ? [term.value] : term.op === 'range' ? [term.from, term.to] : []
  for (const value of values) {
    if (value === null || typeof value === 'string') continue
    if ('today' in value && input !== 'date') return { ok: false, message: `${term.field} holds no dates, so it cannot be compared with a day from today.` }
    if ('attribute' in value && (term.op !== 'equals' || input === null || STAND_IN[input] === undefined))
      return {
        ok: false,
        message: `${term.field} cannot be compared with a person's attribute: an attribute is text, compared for equality with text, a whole number or a uuid.`,
      }
  }
  const stood = (value: ViewValue): string =>
    typeof value === 'string' ? value : 'today' in value ? shifted(today, value.today) : (STAND_IN[input as FilterInput] as string)
  if (term.op === 'equals') return { ok: true, term: { field: term.field, op: 'equals', value: stood(term.value) } }
  if (term.op === 'range')
    return {
      ok: true,
      term: {
        field: term.field,
        op: 'range',
        from: term.from === null ? null : stood(term.from),
        to: term.to === null ? null : stood(term.to),
        ...(term.exclusive === undefined ? {} : { exclusive: term.exclusive }),
      },
    }
  return { ok: true, term }
}

/** The day a server offers views on: today's date, as UTC counts it. */
export function todayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}
