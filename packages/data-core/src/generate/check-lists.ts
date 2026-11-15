import type { DatabaseKind } from '../adapter.js'

/*
 * A check that lists the values one column may hold (0152) -- `status IN
 * ('draft', 'placed', 'shipped')` -- read out of the spelling the snapshot
 * already holds, per engine, as `defaults.ts` reads a column's constant
 * (0149): PostgreSQL's `pg_get_expr`, SQL Server's
 * `sys.check_constraints.definition`. Each server writes a check again from
 * its parse, never as it was typed, so each has one spelling of one column
 * compared by `=` with literals, and that spelling is the only one read.
 *
 * Read, never evaluated, executed or handed back to SQL: a cursor walks the
 * text and accepts each engine's spelling and nothing else -- another
 * column, a function, NOT IN, LIKE, a range, NULL, an AND, a COLLATE, a cast
 * it does not name, a spacing the server does not write. No list beats a
 * wrong one: a check not read leaves its column the control it was.
 */

/** One literal a list compares its column with, as the check spells it: text with its quotes undoubled, or a whole number's digits. `national` is T-SQL's N prefix. */
export type ListedLiteral = { kind: 'text'; text: string; national: boolean } | { kind: 'number'; text: string }

/** A check read as a list: the one column it compares, and each literal it compares the column with, in the order its spelling names them. */
export interface CheckList {
  column: string
  literals: ListedLiteral[]
}

/** A step of the cursor: where it stands after what it read, and what that was; `null` where the text is not what was expected there. */
type Step<T> = { at: number; value: T } | null

/** `token` at `at`, exactly. */
function token(text: string, at: number, expected: string): number | null {
  return text.startsWith(expected, at) ? at + expected.length : null
}

/** The first of `tokens` at `at`, the longest first so that none is read as a prefix of another. */
function oneOf(text: string, at: number, tokens: readonly string[]): number | null {
  for (const expected of [...tokens].sort((a, b) => b.length - a.length)) {
    const next = token(text, at, expected)
    if (next !== null) return next
  }
  return null
}

/** `pattern`, sticky, at `at`. */
function match(text: string, at: number, pattern: RegExp): Step<string> {
  const sticky = new RegExp(pattern.source, 'y')
  sticky.lastIndex = at
  const found = sticky.exec(text)
  return found === null ? null : { at: sticky.lastIndex, value: found[0] }
}

/** Text between single quotes, each quote inside doubled -- both engines' spelling -- from the opening quote at `at`. */
function quoted(text: string, at: number): Step<string> {
  if (text[at] !== "'") return null
  let value = ''
  for (let index = at + 1; index < text.length; index += 1) {
    const char = text[index] as string
    if (char !== "'") {
      value += char
      continue
    }
    if (text[index + 1] !== "'") return { at: index + 1, value }
    value += "'"
    index += 1
  }
  return null
}

/** Text between `open` and `close`, each `close` inside doubled: PostgreSQL's `"…"`, SQL Server's `[…]`. Never empty. */
function delimited(text: string, at: number, open: string, close: string): Step<string> {
  if (text[at] !== open) return null
  let value = ''
  for (let index = at + 1; index < text.length; index += 1) {
    const char = text[index] as string
    if (char !== close) {
      value += char
      continue
    }
    if (text[index + 1] !== close) return value === '' ? null : { at: index + 1, value }
    value += close
    index += 1
  }
  return null
}

/** The lists `terms` read, as one: every term over the same column, its literals in order. */
function joined(terms: readonly CheckList[]): CheckList | null {
  const [first] = terms
  if (first === undefined || terms.some((term) => term.column !== first.column)) return null
  return { column: first.column, literals: terms.flatMap((term) => term.literals) }
}

/*
 * PostgreSQL, as `pg_get_expr` deparses a check (ruleutils.c): every
 * operator in parentheses; a column by its name, in double quotes where it
 * needs them, or `(name)::text` where a varchar is compared as text, which
 * the deparser shows; `= ANY (ARRAY[…])` for an IN list of two or more, the
 * array cast `::text[]` where its elements are varchar; `=` for a list of
 * one; ` OR ` between parenthesised comparisons. A literal is a positive
 * integer bare; a negative one, or one of another integer type, quoted and
 * cast; text quoted and cast to its type, with no modifier.
 *
 * Measured on 17.11: `((status)::text = ANY ((ARRAY['draft'::character
 * varying, 'placed'::character varying, 'shipped'::character
 * varying])::text[]))`, the shared fixture's ck_order_status, which the
 * captured snapshots hold. The other spellings are ruleutils.c's, held per
 * engine by the parity suites' CHECK_LIST_PARITY.
 */

const PG_TEXT_CASTS = ['text', 'character varying', 'bpchar'] as const
const PG_NUMBER_CASTS = ['integer', 'bigint', 'smallint'] as const
const PG_NAME = /[a-z_][a-z0-9_]*/

function pgIdentifier(text: string, at: number): Step<string> {
  return text[at] === '"' ? delimited(text, at, '"', '"') : match(text, at, PG_NAME)
}

/** A column as a comparison names it: bare, or relabelled as text. */
function pgColumn(text: string, at: number): Step<string> {
  const relabelled = text[at] === '(' ? pgIdentifier(text, at + 1) : null
  if (relabelled !== null) {
    const after = token(text, relabelled.at, ')::text')
    return after === null ? null : { at: after, value: relabelled.value }
  }
  return pgIdentifier(text, at)
}

function pgLiteral(text: string, at: number): Step<ListedLiteral> {
  const bare = match(text, at, /[0-9]+/)
  if (bare !== null) return { at: bare.at, value: { kind: 'number', text: bare.value } }
  const inside = quoted(text, at)
  const cast = inside === null ? null : token(text, inside.at, '::')
  if (inside === null || cast === null) return null
  const number = /^-?[0-9]+$/.test(inside.value) ? oneOf(text, cast, PG_NUMBER_CASTS) : null
  if (number !== null) return { at: number, value: { kind: 'number', text: inside.value } }
  // A backslash is itself under standard_conforming_strings and an escape
  // without it, and the snapshot does not say which the server spelled by.
  const textual = inside.value.includes('\\') ? null : oneOf(text, cast, PG_TEXT_CASTS)
  return textual === null ? null : { at: textual, value: { kind: 'text', text: inside.value, national: false } }
}

/** `ARRAY[l, l, …]`, or that in parentheses cast to `text[]`. */
function pgArray(text: string, at: number): Step<ListedLiteral[]> {
  const cast = text[at] === '('
  let next = token(text, cast ? at + 1 : at, 'ARRAY[')
  const literals: ListedLiteral[] = []
  while (next !== null) {
    const literal = pgLiteral(text, next)
    if (literal === null) return null
    literals.push(literal.value)
    const more = token(text, literal.at, ', ')
    if (more !== null) {
      next = more
      continue
    }
    const closed = token(text, literal.at, ']')
    if (closed === null) return null
    const end = cast ? token(text, closed, ')::text[]') : closed
    return end === null ? null : { at: end, value: literals }
  }
  return null
}

/** `(column = literal)` or `(column = ANY (array))`. */
function pgComparison(text: string, at: number): Step<CheckList> {
  const column = text[at] === '(' ? pgColumn(text, at + 1) : null
  const equals = column === null ? null : token(text, column.at, ' = ')
  if (column === null || equals === null) return null
  const any = token(text, equals, 'ANY (')
  if (any !== null) {
    const array = pgArray(text, any)
    const end = array === null ? null : token(text, array.at, '))')
    return array === null || end === null ? null : { at: end, value: { column: column.value, literals: array.value } }
  }
  const literal = pgLiteral(text, equals)
  const end = literal === null ? null : token(text, literal.at, ')')
  return literal === null || end === null ? null : { at: end, value: { column: column.value, literals: [literal.value] } }
}

/** A comparison, or two or more terms joined by OR in one pair of parentheses. */
function pgTerm(text: string, at: number): Step<CheckList> {
  const comparison = pgComparison(text, at)
  if (comparison !== null) return comparison
  if (text[at] !== '(') return null
  const terms: CheckList[] = []
  let next = at + 1
  for (;;) {
    const term = pgTerm(text, next)
    if (term === null) return null
    terms.push(term.value)
    const or = token(text, term.at, ' OR ')
    if (or !== null) {
      next = or
      continue
    }
    const end = token(text, term.at, ')')
    const list = terms.length > 1 ? joined(terms) : null
    return end === null || list === null ? null : { at: end, value: list }
  }
}

/*
 * SQL Server, as it writes a check's definition again from its parse: the
 * whole in one pair of parentheses; an IN list as one `=` per value, joined
 * by ` OR `, the last value first; a column in brackets, `]` doubled inside;
 * no space around `=`; text quoted, N before a national literal; a number in
 * parentheses, its sign inside.
 *
 * Measured on 2022 (16.0.4295.3): `([status]='shipped' OR [status]='placed'
 * OR [status]='draft')`, the shared fixture's ck_order_status, which the
 * captured snapshots hold; a number's parentheses in its `([weight_kg]>(0))`.
 */

function msLiteral(text: string, at: number): Step<ListedLiteral> {
  const number = token(text, at, '(')
  if (number !== null) {
    const digits = match(text, number, /-?[0-9]+/)
    const end = digits === null ? null : token(text, digits.at, ')')
    return digits === null || end === null ? null : { at: end, value: { kind: 'number', text: digits.value } }
  }
  const national = text[at] === 'N'
  const inside = quoted(text, national ? at + 1 : at)
  return inside === null ? null : { at: inside.at, value: { kind: 'text', text: inside.value, national } }
}

/** `[column]=literal`, or a disjunction in parentheses. */
function msTerm(text: string, at: number): Step<CheckList> {
  if (text[at] === '(') return msGroup(text, at)
  const column = delimited(text, at, '[', ']')
  const equals = column === null ? null : token(text, column.at, '=')
  const literal = equals === null ? null : msLiteral(text, equals)
  return column === null || literal === null ? null : { at: literal.at, value: { column: column.value, literals: [literal.value] } }
}

/** One or more terms joined by OR, in one pair of parentheses. */
function msGroup(text: string, at: number): Step<CheckList> {
  if (text[at] !== '(') return null
  const terms: CheckList[] = []
  let next = at + 1
  for (;;) {
    const term = msTerm(text, next)
    if (term === null) return null
    terms.push(term.value)
    const or = token(text, term.at, ' OR ')
    if (or !== null) {
      next = or
      continue
    }
    const end = token(text, term.at, ')')
    const list = joined(terms)
    return end === null || list === null ? null : { at: end, value: list }
  }
}

/**
 * The list `expression` is, as `kind`'s catalog spells a check: its one
 * column and each literal it compares the column with; `null` where it is
 * anything else, or nothing read with certainty. What the list means for a
 * field -- the column's kind, the check's state, what its codec takes -- is
 * `listed.ts`'s.
 */
export function readCheckList(kind: DatabaseKind, expression: string): CheckList | null {
  const read = kind === 'postgres' ? pgTerm(expression, 0) : msGroup(expression, 0)
  return read !== null && read.at === expression.length ? read.value : null
}
