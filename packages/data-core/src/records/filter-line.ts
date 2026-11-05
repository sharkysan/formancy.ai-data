import type { FilterInput, FilterOp, ListFilterTerm, RangeExclusive } from '../runtime.js'

/*
 * A grid's filter as a line a person types: `status = placed and amount >
 * 1000`. The line is read here, in the browser, into the terms a list
 * request carries (0104), and written back from them; the server never
 * sees it, so it can say nothing the Filter panel could not.
 *
 *   line      := condition ("and" condition)*
 *   condition := name ("=" | ">" | ">=" | "<" | "<=" | "contains") value
 *              | name "is" ["not"] "empty"
 *   value     := a run of characters with no space, quote, <, > or =,
 *                or a "quoted" one, \" and \\ escaped
 *
 * Words and names are read in any case. `=` is an equality, `contains`
 * a contains, `is empty` NULL and `is not empty` not; a comparison bounds
 * a range, `>` and `<` leaving their own value out (0130), and a lower and
 * an upper comparison on one field are one range, since a field is named
 * once in a filter. There is no `or`, no `not` and no parenthesis: a
 * filter's conditions all hold.
 */

/** A field the line may name: the server's offer for it, its label, and the values it says, a boolean's or a state field's (0129). */
export interface LineField {
  field: string
  label: string
  operators: FilterOp[]
  input: FilterInput | null
  values?: ReadonlyArray<{ value: string; label: string }>
}

/** The line read: its terms, or why not, with the characters `at` and `length` mark. */
export type FilterLineRead = { ok: true; filter: ListFilterTerm[] } | LineRefusal

export interface LineRefusal {
  ok: false
  at: number
  length: number
  message: string
}

/** A word, a quoted value or an operator, and where in the line it stands; `open`, a quote nothing closes. */
export interface LineToken {
  kind: 'word' | 'quoted' | 'operator'
  text: string
  value: string
  at: number
  end: number
  open?: true
}

/** What may come next where the reading stands, and for which field. */
export type LineState =
  | { want: 'name'; after: LineToken | null }
  | { want: 'operator'; field: LineField; name: LineToken }
  | { want: 'is' | 'is-not'; field: LineField; name: LineToken; is: LineToken }
  | { want: 'value'; field: LineField; name: LineToken; operator: LineToken }
  | { want: 'and' }

export interface Bound {
  value: string
  exclusive: boolean
}

/** A field's condition as it is read: one term, or a range whose bounds may come in two conditions. */
export type LineEntry = { kind: 'term'; field: string; term: ListFilterTerm } | { kind: 'range'; field: string; lower: Bound | null; upper: Bound | null }

/** Longest first, so `>=` is never read as `>` and a value. */
const OPERATORS = ['>=', '<=', '!=', '=', '>', '<'] as const

/** What each operator a value follows asks for. */
const ASKS: Readonly<Record<string, FilterOp>> = { '=': 'equals', '>': 'range', '>=': 'range', '<': 'range', '<=': 'range', contains: 'contains' }

/** What the line writes for each operator a field may be offered. */
export const LINE_OPERATORS: Readonly<Record<FilterOp, readonly string[]>> = {
  equals: ['='],
  range: ['>', '>=', '<', '<='],
  contains: ['contains'],
  null: ['is empty'],
  'not-null': ['is not empty'],
}

const refuse = (token: { at: number; end: number }, message: string): LineRefusal => ({ ok: false, at: token.at, length: token.end - token.at, message })

/** `a, b and c`. */
const listed = (words: readonly string[], joiner: string): string =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} ${joiner} ${words.at(-1) ?? ''}`

/** What a field may be compared by, as the line writes it. */
export const offerWords = (field: LineField): string[] => field.operators.flatMap((op) => LINE_OPERATORS[op])

/**
 * Each field's name in the line: its label lower-cased, letters of any
 * script and digits kept and every other run one `_` -- `größe_cm` for
 * "Größe (cm)". Its key instead where that name is empty, is another
 * field's name too or is another field's key, so a name says one field.
 */
function slug(label: string): string {
  // Every run is one `_` by now, so at most one is at either end: trimmed without a second pattern over the label.
  // A letter keeps its marks (\p{M}), and a label typed decomposed reads as one composed.
  const joined = label
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '_')
  const start = joined.startsWith('_') ? 1 : 0
  const end = joined.length > start && joined.endsWith('_') ? joined.length - 1 : joined.length
  return joined.slice(start, end)
}

export function lineNames(fields: readonly LineField[]): Map<string, string> {
  const keys = new Set(fields.map((field) => field.field.toLowerCase()))
  const candidates = fields.map((field) => slug(field.label))
  return new Map(
    fields.map((field, index) => {
      const name = candidates[index] ?? ''
      const shared = candidates.filter((candidate) => candidate === name).length > 1
      const anothers = keys.has(name) && name !== field.field.toLowerCase()
      return [field.field, name === '' || shared || anothers ? field.field : name]
    }),
  )
}

/** The line in tokens: spaces separate them, and an operator or a quote ends a word. */
export function lineTokens(text: string): LineToken[] {
  const found: LineToken[] = []
  let at = 0
  while (at < text.length) {
    const char = text.charAt(at)
    const operator = OPERATORS.find((candidate) => text.startsWith(candidate, at))
    if (/\s/u.test(char)) at += 1
    else if (char === '"') {
      const quoted = quotedAt(text, at)
      found.push(quoted)
      at = quoted.end
    } else if (operator !== undefined) {
      found.push({ kind: 'operator', text: operator, value: operator, at, end: at + operator.length })
      at += operator.length
    } else {
      let end = at
      while (end < text.length && !/[\s"<>=]/u.test(text.charAt(end)) && !text.startsWith('!=', end)) end += 1
      found.push({ kind: 'word', text: text.slice(at, end), value: text.slice(at, end), at, end })
      at = end
    }
  }
  return found
}

/** The quoted value that starts at `at`, a backslash taking the next character as it is. */
function quotedAt(text: string, at: number): LineToken {
  let value = ''
  let end = at + 1
  while (end < text.length) {
    const char = text.charAt(end)
    if (char === '"') return { kind: 'quoted', text: text.slice(at, end + 1), value, at, end: end + 1 }
    if (char === '\\' && end + 1 < text.length) {
      value += text.charAt(end + 1)
      end += 2
    } else {
      value += char
      end += 1
    }
  }
  return { kind: 'quoted', text: text.slice(at), value, at, end, open: true }
}

/** A value in quotes, its backslashes and quotes escaped: one value whatever it holds. */
export const quoted = (value: string): string => `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`

/** A value as the line writes it: bare where it reads back as one word, and quoted otherwise. */
export function written(value: string): string {
  if (value !== '' && !/[\s"<>=]/u.test(value) && !value.includes('!=')) return value
  return quoted(value)
}

interface Context {
  fields: readonly LineField[]
  names: Map<string, string>
  entries: LineEntry[]
}

/** The field a word names: by its name in the line, or by its key. */
function fieldNamed(word: string, context: Context): LineField | undefined {
  const lower = word.normalize('NFC').toLowerCase()
  return (
    context.fields.find((field) => context.names.get(field.field)?.toLowerCase() === lower) ??
    context.fields.find((field) => field.field.toLowerCase() === lower)
  )
}

/**
 * The line's tokens read as far as they go: where the reading stands and
 * what it has read, or the first thing it cannot read. Where it stands is
 * what completion offers from; an unfinished line is not refused here.
 */
export function readLine(
  found: readonly LineToken[],
  fields: readonly LineField[],
): { ok: true; state: LineState; entries: readonly LineEntry[] } | LineRefusal {
  const context: Context = { fields, names: lineNames(fields), entries: [] }
  let state: LineState = { want: 'name', after: null }
  for (const [index, token] of found.entries()) {
    if (token.open === true) return refuse(token, 'This quote is not closed.')
    const next = step(state, token, context, found.slice(index + 1))
    if ('ok' in next) return next
    state = next
  }
  return { ok: true, state, entries: context.entries }
}

/**
 * The field a person meant by a name the line does not know: the name, or
 * it and the words after it up to an operator, written as a label is --
 * `order-date`, `"Order date"`, `order date` -- and the characters that
 * said it. Undefined where they say no field.
 */
function meantBy(token: LineToken, rest: readonly LineToken[], context: Context): { field: LineField; end: number } | undefined {
  if (token.kind === 'operator') return undefined
  const following = rest.findIndex((next) => next.kind !== 'word')
  const words = [token, ...(following === -1 ? rest : rest.slice(0, following))]
  for (let count = words.length; count > 0; count -= 1) {
    const field = fieldNamed(
      slug(
        words
          .slice(0, count)
          .map((word) => word.value)
          .join(' '),
      ),
      context,
    )
    if (field !== undefined) return { field, end: words[count - 1]?.end ?? token.end }
  }
  return undefined
}

function step(state: LineState, token: LineToken, context: Context, rest: readonly LineToken[]): LineState | LineRefusal {
  const word = token.kind === 'word' ? token.value.toLowerCase() : null
  switch (state.want) {
    case 'name': {
      const field = word === null ? undefined : fieldNamed(token.value, context)
      if (field !== undefined) return { want: 'operator', field, name: token }
      if (word === 'and') return refuse(token, state.after === null ? 'A condition comes before and.' : 'A condition comes after and.')
      const meant = meantBy(token, rest, context)
      if (meant !== undefined) {
        const said = [token, ...rest.filter((next) => next.end <= meant.end)].map((next) => next.text).join(' ')
        return refuse(
          { at: token.at, end: meant.end },
          `No field is called ${said}: it is ${context.names.get(meant.field.field) ?? meant.field.field} in the line.`,
        )
      }
      const names = [...context.names.values()]
      const shown = names.length > 12 ? `${names.slice(0, 12).join(', ')}, …` : names.join(', ')
      return refuse(token, `No field is called ${token.text}. Fields: ${shown}.`)
    }
    case 'operator': {
      if (word === 'is') return { want: 'is', field: state.field, name: state.name, is: token }
      const asks = token.kind === 'quoted' ? undefined : ASKS[token.value.toLowerCase()]
      if (asks !== undefined && state.field.operators.includes(asks)) return { want: 'value', field: state.field, name: state.name, operator: token }
      return refuse(token, `${state.field.label} offers ${listed(offerWords(state.field), 'and')}, not ${token.text}.`)
    }
    case 'is':
      if (word === 'not') return { ...state, want: 'is-not' }
      if (word === 'empty') return added(context, state.field, state.name, { op: 'null' }, { at: state.is.at, end: token.end })
      return refuse(token, 'After is comes empty or not empty.')
    case 'is-not':
      if (word === 'empty') return added(context, state.field, state.name, { op: 'not-null' }, { at: state.is.at, end: token.end })
      return refuse(token, 'After is not comes empty.')
    case 'value':
      return valued(state, token, context)
    case 'and':
      if (word === 'and') return { want: 'name', after: token }
      if (word === 'or') return refuse(token, 'There is no or: conditions are joined by and, and every one holds.')
      return refuse(token, 'Join conditions with and.')
  }
}

type Asked =
  | { op: 'equals'; value: string }
  | { op: 'contains'; text: string }
  | { op: 'null' }
  | { op: 'not-null' }
  | { op: 'lower'; bound: Bound }
  | { op: 'upper'; bound: Bound }

/** The condition a value completes, its operator read by what it bounds. */
function valued(state: Extract<LineState, { want: 'value' }>, token: LineToken, context: Context): LineState | LineRefusal {
  const { field, name, operator } = state
  if (token.kind === 'operator') return refuse(operator, `${field.label} ${operator.text} needs a value.`)
  const value = spelled(field, operator.text === '=', token)
  if (typeof value !== 'string') return value
  const span = { at: operator.at, end: token.end }
  switch (operator.value.toLowerCase()) {
    case '=':
      return added(context, field, name, { op: 'equals', value }, span)
    case 'contains':
      return added(context, field, name, { op: 'contains', text: value }, span)
    case '>':
    case '>=':
      return added(context, field, name, { op: 'lower', bound: { value, exclusive: operator.text === '>' } }, span)
    default:
      return added(context, field, name, { op: 'upper', bound: { value, exclusive: operator.text === '<' } }, span)
  }
}

/**
 * A value as the term carries it: a boolean's yes or no as `true` or
 * `false`, a state by its value where its label was typed, and a number
 * typed with separators refused with the number it is read as.
 */
function spelled(field: LineField, equality: boolean, token: LineToken): string | LineRefusal {
  const typed = token.value
  if (field.input === 'boolean' && equality) {
    const said = typed.toLowerCase()
    if (said === 'yes' || said === 'true') return 'true'
    if (said === 'no' || said === 'false') return 'false'
    return refuse(token, `${field.label} is yes or no.`)
  }
  if ((field.input === 'integer' || field.input === 'decimal') && /['’,]/u.test(typed))
    return refuse(token, `Write numbers with a point and no separators: ${pointed(typed)}.`)
  if (equality && field.values !== undefined && !field.values.some((entry) => entry.value === typed))
    return field.values.find((entry) => entry.label.toLowerCase() === typed.toLowerCase())?.value ?? typed
  return typed
}

/** `1'000,50` as the number it is read as: apostrophes dropped, the last point or comma the decimal point. */
function pointed(typed: string): string {
  const bare = typed.replace(/['’]/gu, '')
  if (bare.includes('.') && bare.includes(',')) {
    const point = Math.max(bare.lastIndexOf('.'), bare.lastIndexOf(','))
    return `${bare.slice(0, point).replace(/[.,]/gu, '')}.${bare.slice(point + 1)}`
  }
  return (bare.match(/,/gu) ?? []).length === 1 ? bare.replace(',', '.') : bare.replace(/,/gu, '')
}

/** A condition read, kept beside the others: a field once, a range's two bounds from two conditions. */
function added(context: Context, field: LineField, name: LineToken, asked: Asked, span: { at: number; end: number }): LineState | LineRefusal {
  const ask: FilterOp = asked.op === 'lower' || asked.op === 'upper' ? 'range' : asked.op
  if (!field.operators.includes(ask)) return refuse(span, `${field.label} offers ${listed(offerWords(field), 'and')}, not ${LINE_OPERATORS[ask][0] ?? ask}.`)
  const existing = context.entries.find((entry) => entry.field === field.field)
  if (asked.op === 'lower' || asked.op === 'upper') {
    if (existing === undefined)
      context.entries.push({
        kind: 'range',
        field: field.field,
        lower: asked.op === 'lower' ? asked.bound : null,
        upper: asked.op === 'upper' ? asked.bound : null,
      })
    else if (existing.kind === 'range' && existing[asked.op] === null) existing[asked.op] = asked.bound
    else if (existing.kind === 'range') return refuse(name, `${field.label} has two ${asked.op} bounds: keep one.`)
    else return refuse(name, `${field.label} is named twice: keep one.`)
    return { want: 'and' }
  }
  if (existing !== undefined) return refuse(name, `${field.label} is named twice: keep one.`)
  context.entries.push({ kind: 'term', field: field.field, term: { field: field.field, ...asked } })
  return { want: 'and' }
}

/** Why a line that stops where it stands is not whole, or null when it is. */
function unfinished(state: LineState): LineRefusal | null {
  switch (state.want) {
    case 'name':
      return state.after === null ? null : refuse(state.after, 'A condition comes after and.')
    case 'operator':
      return refuse(state.name, `After ${state.name.text} comes ${listed(offerWords(state.field), 'or')}.`)
    case 'is':
      return refuse(state.is, 'After is comes empty or not empty.')
    case 'is-not':
      return refuse(state.is, 'After is not comes empty.')
    case 'value':
      return refuse(state.operator, `${state.field.label} ${state.operator.text} needs a value.`)
    case 'and':
      return null
  }
}

/** A line read into the terms a list request carries, or the first thing in it that cannot be read. */
export function parseFilterLine(text: string, fields: readonly LineField[]): FilterLineRead {
  const read = readLine(lineTokens(text), fields)
  if (!read.ok) return read
  const stops = unfinished(read.state)
  if (stops !== null) return stops
  return {
    ok: true,
    filter: read.entries.map((entry): ListFilterTerm => {
      if (entry.kind === 'term') return entry.term
      const exclusive = rangeExclusive(entry.lower?.exclusive === true, entry.upper?.exclusive === true)
      return {
        field: entry.field,
        op: 'range',
        from: entry.lower?.value ?? null,
        to: entry.upper?.value ?? null,
        ...(exclusive === undefined ? {} : { exclusive }),
      }
    }),
  }
}

const rangeExclusive = (lower: boolean, upper: boolean): RangeExclusive | undefined => (lower && upper ? 'both' : lower ? 'from' : upper ? 'to' : undefined)

/**
 * The line that reads as `filter`: each term by its field's name, a range
 * as its comparisons, a value quoted where it must be. A term on a field
 * the line does not offer is left out: the chips show it, and the host
 * keeps it when an edited line is applied.
 */
export function printFilterLine(filter: readonly ListFilterTerm[], fields: readonly LineField[]): string {
  const names = lineNames(fields)
  return filter
    .flatMap((term) => {
      const field = fields.find((entry) => entry.field === term.field)
      const name = names.get(term.field)
      return field === undefined || name === undefined ? [] : conditionsOf(term, name, field)
    })
    .join(' and ')
}

/** A term's conditions as the line writes them, each led by `name`. */
export function conditionsOf(term: ListFilterTerm, name: string, field: LineField): string[] {
  switch (term.op) {
    case 'equals':
      return [
        `${name} = ${field.input === 'boolean' && (term.value === 'true' || term.value === 'false') ? (term.value === 'true' ? 'yes' : 'no') : written(term.value)}`,
      ]
    case 'contains':
      return [`${name} contains ${written(term.text)}`]
    case 'null':
      return [`${name} is empty`]
    case 'not-null':
      return [`${name} is not empty`]
    case 'range': {
      const leaves = (side: 'from' | 'to') => term.exclusive === side || term.exclusive === 'both'
      return [
        ...(term.from === null ? [] : [`${name} ${leaves('from') ? '>' : '>='} ${written(term.from)}`]),
        ...(term.to === null ? [] : [`${name} ${leaves('to') ? '<' : '<='} ${written(term.to)}`]),
      ]
    }
  }
}
