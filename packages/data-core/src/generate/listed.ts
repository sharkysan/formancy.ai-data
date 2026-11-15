import type { DatabaseKind } from '../adapter.js'
import { codecForType } from '../codecs/codec.js'
import type { ColumnMeta, ObjectMeta } from '../metadata.js'
import { readCheckList } from './check-lists.js'
import type { ListedLiteral } from './check-lists.js'
import type { ControlPlan } from './controls.js'
import { withoutLeadingZeros } from './defaults.js'

/*
 * A column whose values one check lists is a select of exactly them (0152).
 * `check-lists.ts` reads each engine's spelling of a list; this decides,
 * once, for the generator and for drift review, what a list means for one
 * column of one table: a select, nothing, or a refusal a note says.
 *
 * A select is drawn only where the database holds every row to the list
 * and nothing else might: one check, enforced and validated, every other
 * check of the table readable, over a text or whole-number column, each
 * value one the column's codec reads back as itself and none empty. Its
 * options are the values as a record holding each reads back, each
 * labelled as it is stored, in a stated order -- a whole number's by its
 * value, a text's by codepoint -- because SQL Server writes an IN list
 * back to front and an OR as typed, so the order a person wrote is not one
 * both engines can say.
 */

/** What a list means for one column: a select of `values`, in the order drawn, from `check`; a refusal, why not; or no list at all. */
export type Listed = { kind: 'none' } | { kind: 'select'; check: string; values: string[] } | { kind: 'refused'; check: string; reason: string }

const NONE: Listed = { kind: 'none' }

/** What every code page SQL Server reads a literal in holds alike. */
const ASCII = /^[ -~]*$/

/** A value as a sentence quotes it, as the generator's other notes quote one, so blanks are seen. */
export function quotedValue(value: string): string {
  return `“${value}”`
}

/** Values as a sentence lists them: “a”, “b” and “c”. */
export function quotedValues(values: readonly string[]): string {
  const quoted = values.map(quotedValue)
  return quoted.length < 2 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1) as string}`
}

/**
 * What the codec of `column` is handed for `literal`: the value the column
 * stores for it, or `undefined` where the literal is not one of the
 * column's kind read with certainty -- a number on a text column, text on
 * a whole-number one, and on SQL Server text past ASCII in a literal other
 * than N on an nvarchar, which it reads in a code page the snapshot does
 * not record (as 0149 reads a default).
 */
function asStored(kind: DatabaseKind, literal: ListedLiteral, column: ColumnMeta): string | undefined {
  const type = column.type
  if (type.kind === 'integer') return literal.kind === 'number' ? withoutLeadingZeros(literal.text) : undefined
  if (type.kind !== 'text' || literal.kind !== 'text') return undefined
  if (kind === 'sqlserver' && !ASCII.test(literal.text) && !(literal.national && type.lengthUnit === 'utf16-code-units')) return undefined
  return literal.text
}

/** A codec's sentence inside the generator's: its first letter lowered, its full stop dropped. */
function clause(sentence: string): string {
  return `${sentence.charAt(0).toLowerCase()}${sentence.slice(1).replace(/\.$/, '')}`
}

/** A whole number's values by their value, which codepoint order is not past one digit; text by codepoint. */
function ordered(column: ColumnMeta, values: readonly string[]): string[] {
  const numeric = column.type.kind === 'integer'
  return [...values].sort((a, b) => {
    if (numeric) return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/**
 * What the checks of `object` list for `column`, as `kind`'s catalog spells
 * them. A text or whole-number column only: another kind keeps its own
 * control, and a list over it is read as none, as a spelling not read is.
 */
export function listedFor(kind: DatabaseKind, object: ObjectMeta, column: ColumnMeta): Listed {
  if (column.type.kind !== 'text' && column.type.kind !== 'integer') return NONE
  const lists = object.checks.flatMap((check) => {
    const read = check.expression === null ? null : readCheckList(kind, check.expression)
    return read !== null && read.column === column.name ? [{ check, read }] : []
  })
  const [only] = lists
  if (only === undefined) return NONE
  const { check, read } = only
  const refused = (reason: string): Listed => ({ kind: 'refused', check: check.name, reason })
  if (lists.length > 1) return refused(`${lists.map((entry) => entry.check.name).join(' and ')} each list its values, and a select is drawn from one check`)
  if (!check.enforced) return refused('the database does not enforce it, so a row may hold a value it does not list')
  if (!check.validated) return refused('it was not validated, so a row from before it may hold a value it does not list, which a select could not show')
  const hidden = object.checks.find((other) => other.expression === null)
  if (hidden !== undefined) return refused(`${hidden.name} cannot be read by this connection, and may refuse a value it lists`)

  const codec = codecForType(column.type, column.nullable)
  const values = new Set<string>()
  for (const literal of read.literals) {
    const stored = asStored(kind, literal, column)
    if (stored === undefined) return NONE
    const parsed = codec.parse(stored)
    if (!parsed.ok) return refused(`${quotedValue(stored)} is not a value the column holds: ${clause(parsed.message)}`)
    // Never null: the codec was handed a value, and its canonical text is what a record holding it reads back as.
    const value = String(parsed.value)
    if (value === '') return refused('one of its values is empty, which a select cannot tell from no answer')
    values.add(value)
  }
  return { kind: 'select', check: check.name, values: ordered(column, [...values]) }
}

/** The control a select of listed values is: each value its own label, as the column holds it (0152). */
export function listedControl(listed: Extract<Listed, { kind: 'select' }>): ControlPlan {
  return {
    field: { type: 'select', options: listed.values.map((value) => ({ value, label: value })) },
    describe: `a select of the values ${listed.check} lists, ${quotedValues(listed.values)}, each offered as the column holds it,`,
  }
}
