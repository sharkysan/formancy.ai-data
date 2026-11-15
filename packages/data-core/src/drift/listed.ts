import type { FieldBinding, ListedBinding } from '../generate/types.js'
import { listedFor, quotedValues } from '../generate/listed.js'
import { type Comparison, type Draft, writtenOn } from './context.js'

/*
 * A field drawn as a select of the values a check lists (0152), against the
 * check as it is now: the generator's own `listedFor`, asked of the table as
 * the current snapshot has it, so review and generation cannot disagree
 * about what a select would hold.
 *
 * - Values gone from the list: the select offers a value the database now
 *   refuses, which is a tightened column (0010): writes of the field stop.
 * - Values added, or the column no longer held to a list -- the check gone,
 *   not enforced, not validated, or no longer a list -- is a field the
 *   column outgrew, and only for review: the select cannot offer what a row
 *   may now hold, and the engine refuses an answer it does not list rather
 *   than writing another back (formancy.ai 0076), so nothing is changed
 *   unseen and nothing stops. A record holding such a value is refused on
 *   Save until a listed one is chosen; generating the form again offers it.
 *
 * A check this connection can no longer read is the gap's to report, as
 * every check's is: nothing about the field is concluded from it.
 */

type Listed = Extract<FieldBinding, { kind: 'column' }> & { listed: ListedBinding }

function listedBindings(comparison: Comparison): Listed[] {
  return comparison.bindings.fields.filter((binding): binding is Listed => binding.kind === 'column' && binding.listed !== undefined)
}

/** `them` or `it`, for one value or more. */
const pronoun = (values: readonly string[]): string => (values.length === 1 ? 'it' : 'them')

/** Every change to the list a select of the form rests on, two per field at most: what it no longer lists, what it does that the field does not offer. */
export function listedChanges(comparison: Comparison): Draft[] {
  const { after, current, bindings } = comparison
  if (after.checks.some((check) => check.expression === null)) return []
  return listedBindings(comparison).flatMap((binding): Draft[] => {
    const column = after.columns.find((candidate) => candidate.name === binding.column)
    // Gone or out of sight: the column's own change says so (`columns.ts`).
    if (column === undefined) return []
    const was = binding.listed
    const subject = { kind: 'column', object: after.ref, name: column.name } as const
    const outgrew = (message: string): Draft => ({
      kind: 'column-outgrew-field',
      subject,
      affects: [binding.field],
      stops: [],
      breaksReads: false,
      otherwise: 'review',
      message: `${message} The select cannot offer a value it does not list, and refuses to save a record holding one until a listed value is chosen; generate the form again to offer what the column now holds.`,
    })
    const now = listedFor(current.kind, after, column)
    if (now.kind === 'none') {
      const named = after.checks.some((check) => check.name === was.check)
      return [outgrew(`${was.check}, whose values ${binding.field} offers, ${named ? 'no longer lists the values of' : 'is gone from'} ${column.name}.`)]
    }
    if (now.kind === 'refused')
      return [outgrew(`${binding.field} offers the values ${was.check} listed, and ${now.check} no longer holds ${column.name} to a list: ${now.reason}.`)]

    const drafts: Draft[] = []
    const removed = was.values.filter((value) => !now.values.includes(value))
    const added = now.values.filter((value) => !was.values.includes(value))
    if (removed.length > 0) {
      const on = writtenOn(bindings, column.name)
      drafts.push({
        kind: 'column-tightened',
        subject,
        affects: [binding.field],
        stops: on,
        breaksReads: false,
        otherwise: 'info',
        message:
          on.length > 0
            ? `${now.check} no longer lists ${quotedValues(removed)}, which ${binding.field} still offers and the database now refuses, so writes of ${binding.field} are blocked until the form is generated again.`
            : `${now.check} no longer lists ${quotedValues(removed)}. The form only shows ${binding.field}, and every value it shows is one it offers.`,
      })
    }
    if (added.length > 0) drafts.push(outgrew(`${now.check} now lists ${quotedValues(added)} too, and ${binding.field} does not offer ${pronoun(added)}.`))
    return drafts
  })
}
