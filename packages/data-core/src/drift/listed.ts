import type { FieldBinding, ListedBinding } from '../generate/types.js'
import type { ColumnMeta } from '../metadata.js'
import { enforcedLists, listedFor, listedName, quotedValues, sameSource } from '../generate/listed.js'
import type { EnforcedList } from '../generate/listed.js'
import { type Comparison, type Draft, writtenOn } from './context.js'

/*
 * A field drawn as a select of the values a check lists (0152), against the
 * checks as they are now, read as the generator reads them (`listed.ts`),
 * so review and generation cannot disagree about what a list holds.
 *
 * - A value the select offers that an enforced list now leaves out -- the
 *   published check narrowed, or another list beside it, NOT VALID or WITH
 *   NOCHECK included, since such a check still holds every new or changed
 *   row -- is one the database refuses: a tightened column (0010), whose
 *   writes stop.
 * - A value a row may now hold that the select does not offer is a field
 *   the column outgrew, and only for review: a value every validated list
 *   names and the select does not, or the column held to no list it reads
 *   -- the check gone, not enforced, not validated, or no longer a list.
 *   The engine refuses an answer the select does not list rather than
 *   writing another back (formancy.ai 0076), so nothing is changed unseen
 *   and nothing stops. A record holding such a value is refused on Save
 *   until a listed one is chosen; generating the form again offers it.
 * - A check the reader no longer takes may refuse a value the select
 *   offers, or not, and is review's too: the database refuses such a value
 *   with its own error, as it refuses one any changed check does.
 *
 * A check this connection can no longer read is the gap's to report, as
 * every check's is: a list in sight that refuses an offered value still
 * stops writes, and nothing is concluded about what a row may hold.
 *
 * A list of a PostgreSQL domain of the column's type (0170) is weighed as
 * one of the table's, wherever in the domain chain it is: a select drawn
 * from it, against the domains the column's type is now; and a domain's
 * list beside the table's is one more list either way.
 */

type Listed = Extract<FieldBinding, { kind: 'column' }> & { listed: ListedBinding }

function listedBindings(comparison: Comparison): Listed[] {
  return comparison.bindings.fields.filter((binding): binding is Listed => binding.kind === 'column' && binding.listed !== undefined)
}

/** `them` or `it`, for one value or more. */
const pronoun = (values: readonly string[]): string => (values.length === 1 ? 'it' : 'them')

/** Checks as a sentence names them: a, b and c. */
function named(checks: readonly string[]): string {
  return checks.length < 2 ? checks.join('') : `${checks.slice(0, -1).join(', ')} and ${checks.at(-1) as string}`
}

/** The values every list names, in the order the first gives them; `null` for no list. */
function heldTo(lists: ReadonlyArray<{ values: readonly string[] }>): string[] | null {
  const [first, ...rest] = lists
  return first === undefined ? null : first.values.filter((value) => rest.every((list) => list.values.includes(value)))
}

/** The published values the database now refuses on a write, and the lists that refuse them; a list whose values are not read refuses nothing known. */
function refused(was: ListedBinding, lists: readonly EnforcedList[]): { values: string[]; by: EnforcedList[] } {
  const read = lists.filter((list): list is EnforcedList & { values: string[] } => list.values !== null)
  const by = read.filter((list) => was.values.some((value) => !list.values.includes(value)))
  return { values: was.values.filter((value) => by.some((list) => !list.values.includes(value))), by }
}

/** Whether the check a select was drawn from is still where it was: of the table, or of a domain the column's type still is (0170). */
function stillThere(was: ListedBinding, column: ColumnMeta, comparison: Comparison): boolean {
  if (was.domain === undefined) return comparison.after.checks.some((check) => check.name === was.check)
  const { schema, name } = was.domain
  return (column.domains ?? []).some(
    (domain) => domain.ref.schema === schema && domain.ref.name === name && domain.checks.some((check) => check.name === was.check),
  )
}

/** What a field over a listed column is weighed with: the column as it is now, and every enforced list of it. */
interface Weighed {
  binding: Listed
  column: ColumnMeta
  lists: EnforcedList[]
}

/** The tightened column, where an enforced list refuses a value the select offers: writes of the field stop. */
function tightened({ binding, column, lists }: Weighed, comparison: Comparison): Draft | null {
  const was = binding.listed
  const gone = refused(was, lists)
  if (gone.values.length === 0) return null
  const on = writtenOn(comparison.bindings, column.name)
  const [only] = gone.by
  const by = gone.by.map(listedName)
  const says =
    gone.by.length > 1
      ? `${named(by)} between them do not list`
      : only !== undefined && sameSource(only, was)
        ? `${listedName(was)} no longer lists`
        : `${by.join('')} does not list`
  return {
    kind: 'column-tightened',
    subject: { kind: 'column', object: comparison.after.ref, name: column.name },
    affects: [binding.field],
    stops: on,
    breaksReads: false,
    otherwise: 'info',
    message:
      on.length > 0
        ? `${says} ${quotedValues(gone.values)}, which ${binding.field} still offers and the database now refuses, so writes of ${binding.field} are blocked until the form is generated again.`
        : `${says} ${quotedValues(gone.values)}. The form only shows ${binding.field}, and every value it shows is one it offers.`,
  }
}

/** Why a row may now hold a value the select does not offer, or `null` where every row is held to values it offers. */
function outgrownBecause({ binding, column, lists }: Weighed, comparison: Comparison): string | null {
  const { after, current } = comparison
  const was = binding.listed
  const holding = lists.filter((list): list is EnforcedList & { values: string[] } => list.validated && list.values !== null)
  const held = heldTo(holding)
  if (held !== null) {
    const added = held.filter((value) => !was.values.includes(value))
    if (added.length === 0) return null
    const holders = holding.map(listedName)
    return `${named(holders)} now ${holders.length > 1 ? 'list' : 'lists'} ${quotedValues(added)} too, and ${binding.field} does not offer ${pronoun(added)}.`
  }
  const now = listedFor(current.kind, after, column)
  const published = listedName(was)
  if (now.kind === 'refused')
    return `${binding.field} offers the values ${published} listed, and ${listedName(now)} no longer holds ${column.name} to a list: ${now.reason}.`
  if (!stillThere(was, column, comparison)) return `${published}, whose values ${binding.field} offers, is gone from ${column.name}.`
  return `${published}, whose values ${binding.field} offers, is no longer a list this release reads, so whether it still takes every value ${binding.field} offers is not known; the database refuses one it does not, with a check violation.`
}

/** Every change to the lists a select of the form rests on, two per field at most: what it offers that is now refused, and what a row may hold that it does not offer. */
export function listedChanges(comparison: Comparison): Draft[] {
  const { after, current } = comparison
  const hidden = after.checks.some((check) => check.expression === null)
  return listedBindings(comparison).flatMap((binding): Draft[] => {
    const column = after.columns.find((candidate) => candidate.name === binding.column)
    // Gone or out of sight: the column's own change says so (`columns.ts`).
    if (column === undefined) return []
    const weighed: Weighed = { binding, column, lists: enforcedLists(current.kind, after, column) }
    const stop = tightened(weighed, comparison)
    // What a row may hold is not concluded past a check out of sight, which may be the list itself.
    const because = hidden ? null : outgrownBecause(weighed, comparison)
    const review: Draft | null =
      because === null
        ? null
        : {
            kind: 'column-outgrew-field',
            subject: { kind: 'column', object: after.ref, name: column.name },
            affects: [binding.field],
            stops: [],
            breaksReads: false,
            otherwise: 'review',
            message: `${because} The select cannot offer a value it does not list, and refuses to save a record holding one until a listed value is chosen; generate the form again to offer what the column now holds.`,
          }
    return [stop, review].filter((draft): draft is Draft => draft !== null)
  })
}
