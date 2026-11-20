import type { DatabaseKind } from '../adapter.js'
import { codecForType } from '../codecs/codec.js'
import type { CheckMeta, ColumnMeta, ObjectMeta } from '../metadata.js'
import { readCheckList, readDomainList } from './check-lists.js'
import type { ListedLiteral } from './check-lists.js'
import type { ControlPlan } from './controls.js'
import type { ListedBinding } from './types.js'
import { withoutLeadingZeros } from './defaults.js'
import { listedName } from './list-source.js'
import type { ListSource } from './list-source.js'
import { quotedValue, quotedValues } from './quoted.js'

export { quotedValue, quotedValues } from './quoted.js'
export { listedName, sameSource } from './list-source.js'
export type { ListSource } from './list-source.js'

/*
 * A column whose values one check lists is a select of exactly them (0152).
 * `check-lists.ts` reads each engine's spelling of a list; this decides,
 * once, for the generator and for drift review, what a list means for one
 * column of one table: a select, nothing, or a refusal a note says.
 *
 * A select is drawn only where the database holds every row to the list:
 * one check, enforced and validated, over a text or whole-number column,
 * each value one the column's codec reads back as itself and none empty.
 * No other check is evaluated, readable or not: one that refuses a listed
 * value leaves the select offering it, and the database refuses it. Its
 * options are the values as a record holding each reads back, each
 * labelled as it is stored, in a stated order -- a whole number's by its
 * value, a text's by codepoint -- because SQL Server writes an IN list
 * back to front and an OR as typed, so the order a person wrote is not one
 * both engines can say.
 *
 * A check of a PostgreSQL domain the column's type is, at any depth of its
 * chain, is a list like the table's own (0170): the column's values are
 * the domain's, and the database holds every row to it as it holds them
 * to the table's checks. One list in all is a select; two, wherever each
 * is, are not intersected, as two of the table's are not.
 */

/** What a list means for one column: a select of `values`, in the order drawn, from its source; a refusal, why not; or no list at all. */
export type Listed = { kind: 'none' } | ({ kind: 'select'; values: string[] } & ListSource) | ({ kind: 'refused'; reason: string } & ListSource)

const NONE: Listed = { kind: 'none' }

/** What every code page SQL Server reads a literal in holds alike. */
const ASCII = /^[ -~]*$/

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

/** One check read as a list of a column's values: the check, where it comes from, and its literals. */
interface Found {
  check: CheckMeta
  source: ListSource
  literals: ListedLiteral[]
}

/**
 * Each check of `object`, then each of every domain of `column`'s type,
 * outermost first (0170), read as a list of `column`'s values, in the
 * snapshot's order. A text or whole-number column's only.
 */
function listsOf(kind: DatabaseKind, object: ObjectMeta, column: ColumnMeta): Found[] {
  if (column.type.kind !== 'text' && column.type.kind !== 'integer') return []
  const own = object.checks.flatMap((check): Found[] => {
    const read = check.expression === null ? null : readCheckList(kind, check.expression)
    return read !== null && read.column === column.name ? [{ check, source: { check: check.name }, literals: read.literals }] : []
  })
  const domains = (kind === 'postgres' ? (column.domains ?? []) : []).flatMap((domain) =>
    domain.checks.flatMap((check): Found[] => {
      const literals = check.expression === null ? null : readDomainList(check.expression)
      return literals === null ? [] : [{ check, source: { check: check.name, domain: domain.ref }, literals }]
    }),
  )
  return [...own, ...domains]
}

/**
 * The values `list` names, each as a record holding it reads back, in the
 * order drawn, and the first reason a select could not offer them all; a
 * value the column cannot hold is none of them, since no row holds it.
 * `null` where a literal is not one of the column's kind read with
 * certainty: what the list admits is then not known.
 */
function valuesOf(kind: DatabaseKind, literals: readonly ListedLiteral[], column: ColumnMeta): { values: string[]; refusal: string | undefined } | null {
  const codec = codecForType(column.type, column.nullable)
  const values = new Set<string>()
  let refusal: string | undefined
  for (const literal of literals) {
    const stored = asStored(kind, literal, column)
    if (stored === undefined) return null
    const parsed = codec.parse(stored)
    if (!parsed.ok) {
      refusal ??= `${quotedValue(stored)} is not a value the column holds: ${clause(parsed.message)}`
      continue
    }
    // Never null: the codec was handed a value, and its canonical text is what a record holding it reads back as.
    const value = String(parsed.value)
    if (value === '') refusal ??= 'one of its values is empty, which a select cannot tell from no answer'
    values.add(value)
  }
  return { values: ordered(column, [...values]), refusal }
}

/**
 * What the checks of `object` list for `column`, as `kind`'s catalog spells
 * them. A text or whole-number column only: another kind keeps its own
 * control, and a list over it is read as none, as a spelling not read is.
 */
export function listedFor(kind: DatabaseKind, object: ObjectMeta, column: ColumnMeta): Listed {
  const lists = listsOf(kind, object, column)
  const [only] = lists
  if (only === undefined) return NONE
  const { check, source, literals } = only
  const refused = (reason: string): Listed => ({ kind: 'refused', ...source, reason })
  if (lists.length > 1)
    return refused(`${lists.map((entry) => listedName(entry.source)).join(' and ')} each list its values, and a select is drawn from one check`)
  if (!check.enforced) return refused('the database does not enforce it, so a row may hold a value it does not list')
  if (!check.validated) return refused('it was not validated, so a row from before it may hold a value it does not list, which a select could not show')
  const named = valuesOf(kind, literals, column)
  if (named === null) return NONE
  if (named.refusal !== undefined) return refused(named.refusal)
  return { kind: 'select', ...source, values: named.values }
}

/** One enforced check that lists a column's values, as drift review weighs it: where it comes from, whether every row was proved against it, and what it admits -- `null` where that is not read with certainty. */
export interface EnforcedList extends ListSource {
  validated: boolean
  values: string[] | null
}

/**
 * Every enforced check of `object` that lists `column`'s values, read as
 * `listedFor` reads one (0152): what the database refuses on a write --
 * a list added NOT VALID or WITH NOCHECK holds every new or changed row --
 * and, where validated, what every row already holds.
 */
export function enforcedLists(kind: DatabaseKind, object: ObjectMeta, column: ColumnMeta): EnforcedList[] {
  return listsOf(kind, object, column)
    .filter(({ check }) => check.enforced)
    .map(({ check, source, literals }) => ({ ...source, validated: check.validated, values: valuesOf(kind, literals, column)?.values ?? null }))
}

/** What a binding holds of a select of listed values: its check, the domain where it is a domain's (0170) and nowhere else, and its values. */
export function listedBinding(listed: Extract<Listed, { kind: 'select' }>): ListedBinding {
  return { check: listed.check, ...(listed.domain === undefined ? {} : { domain: { ...listed.domain } }), values: [...listed.values] }
}

/** The control a select of listed values is: each value its own label, as the column holds it (0152). */
export function listedControl(listed: Extract<Listed, { kind: 'select' }>): ControlPlan {
  return {
    field: { type: 'select', options: listed.values.map((value) => ({ value, label: value })) },
    describe: `a select of the values ${listedName(listed)} lists, ${quotedValues(listed.values)}, each offered as the column holds it,`,
  }
}
