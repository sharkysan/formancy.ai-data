import type { FieldDef } from '@formancy/spec'
import { givenStart, startsAtConstant, storedStart } from '../generate/defaults.js'
import type { FieldBinding } from '../generate/types.js'
import { createStates, startsAt } from '../policy/starting.js'
import { storedValue } from '../records/answers.js'
import type { FormPolicy } from '../policy/types.js'
import type { FieldPresentation, StartingValue } from './types.js'

/*
 * A field's starting value as presentation (0150): the answer a new record
 * starts it with, over the column's constant default the generator gave it
 * (0149), or where it gave none. Which fields take one, and which value
 * each takes, is decided here once -- `applyPresentation` refuses by it, a
 * rebase carries by it, and the studio offers its control and says its
 * refusal by it -- and read as the generator reads a column's constant
 * (`givenStart`): a value a field starts with is one its column's codec and
 * its box take, spelled as a record holding it reads back. The database is
 * not asked: a CHECK constraint, a trigger, a foreign key or a character a
 * SQL Server code page lacks is the save's to refuse, as for any answer.
 */

/** A kind a field may be bound to that takes none, as a sentence names it. */
const NAMED: Readonly<Record<string, string>> = {
  date: 'a date',
  time: 'a time of day',
  timestamp: 'an instant',
  float: 'a floating-point number',
  uuid: 'a UUID',
}

/**
 * Why the field `binding` binds takes no starting value, as a clause, or
 * `null` where it takes one. A lookup's answer is a record token, and the
 * record a value names may be one the person may not choose, as 0149 says
 * of its column's default; a field the create does not write is one a new
 * record never sends; and a kind 0149 reads no constant of
 * (`startsAtConstant`, the generator's own list) has no case holding it.
 */
export function noStartingValue(binding: FieldBinding): string | null {
  if (binding.kind === 'lookup')
    return "a lookup's answer is a record, and the one a starting value names may be one the person filling the form in may not choose"
  if (!binding.writes.create) return 'a create does not write it, so the database fills it'
  if (startsAtConstant(binding.type.kind)) return null
  return `one is offered for text, a whole or exact number and yes or no, and this is ${NAMED[binding.type.kind] ?? binding.type.kind}`
}

/**
 * Why a starting value is never taken away (0150): a field left empty is
 * left out of a create (`planCreate`), and the database stores the
 * column's default, so a form starting the field empty would show nothing
 * where the record will hold the default -- what 0149 ends.
 */
export const NEVER_TAKEN_AWAY =
  "a starting value is never taken away: a field left empty is left out of a create, which stores the column's default unseen by the person filling the form in"

/** A starting value's shape: what spec 5's `default` holds on a generated field, text, a finite number or true or false, never a list. */
export function isStartingValue(value: unknown): value is StartingValue {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * A starting value as a sentence says it: text quoted, as the generator's
 * notes quote a default (0149), and a number or a boolean named as one, so
 * the number 7 is never mistaken for the text “7” nor true for “true”.
 */
export function shownValue(value: StartingValue): string {
  return typeof value === 'string' ? `“${value}”` : `the ${typeof value} ${String(value)}`
}

/** Two starting values as one sentence says them: text named as text too where the other prints alike, “7” beside the number 7. */
export function shownTogether(left: StartingValue, right: StartingValue): [string, string] {
  const said = (value: StartingValue, other: StartingValue) =>
    typeof value === 'string' && typeof other !== 'string' && value === String(other) ? `the text ${shownValue(value)}` : shownValue(value)
  return [said(left, right), said(right, left)]
}

export type StartingValueOutcome = { ok: true; answer: StartingValue } | { ok: false; problem: string }

/**
 * `value` as the starting value of `field`, bound by `binding`: the answer
 * a record holding it reads back as, which may be spelled otherwise --
 * `9.5000` for `9.5` -- or the clause that refuses it, naming the field by
 * its key: a field that takes none (`noStartingValue`), or a value it does
 * not take, as `givenStart` reads it.
 */
export function startingValue(binding: FieldBinding, field: FieldDef, value: StartingValue): StartingValueOutcome {
  const none = noStartingValue(binding)
  if (none !== null) return { ok: false, problem: `${binding.field} takes no starting value: ${none}` }
  // noStartingValue answered for a lookup, so the binding is a column's.
  const given = givenStart(binding as Extract<FieldBinding, { kind: 'column' }>, field, value)
  return given.ok ? given : { ok: false, problem: `${shownValue(value)} is not an answer ${binding.field} takes (${given.reason})` }
}

type ColumnBinding = Extract<FieldBinding, { kind: 'column' }>

/**
 * `value`, the starting value of a field bound by `from`, carried to the
 * field the same column is bound to by `to` after a regeneration (0150):
 * the answer that holds the same stored value under `to`'s control --
 * the number 7 as the text “7” once the column is a bigint, true as
 * “true” once it is nullable, “9.50” as “9.5000” once its scale grew -- or
 * the clause that refuses it, as a publish would: a field that now takes
 * none, or a stored value the new field does not take.
 */
export function carriedStart(from: FieldBinding, to: FieldBinding, field: FieldDef, value: StartingValue): StartingValueOutcome {
  const none = noStartingValue(to)
  if (none !== null) return { ok: false, problem: `${to.field} takes no starting value: ${none}` }
  // A lookup takes none, so `from`, under which this value applied, is a column's, and its control held it.
  const stored = storedValue(from as ColumnBinding, value)
  const given = stored.ok ? storedStart(to as ColumnBinding, field, stored.value) : ({ ok: false, reason: stored.reason } as const)
  return given.ok ? given : { ok: false, problem: `${shownValue(value)} is not an answer ${to.field} takes (${given.reason})` }
}

/** The states as a sentence lists them. */
function listed(states: readonly string[]): string {
  return states.length === 0 ? 'none' : states.map(shownValue).join(', ')
}

/**
 * Why `value` is no starting value of `key` under `policy`: where `key` is
 * the policy's state field (0112), a value no create starts a record in --
 * a create that gives the field a state is a move from nothing -- which
 * would be served to nobody (`startingDefaults`, 0149) while the form
 * says it starts there: `startsAt`, the reading the form route serves
 * by. `null` for any other field, and for a state a create starts in.
 */
export function startingStateProblem(policy: FormPolicy, key: string, value: StartingValue): string | null {
  const rule = policy.transitions
  if (rule?.field !== key || startsAt(rule.moves, value)) return null
  return `no create starts a record in ${shownValue(value)}; the policy's moves from nothing reach ${listed(createStates(rule.moves))}`
}

/**
 * Every starting value `fields` give that `startingStateProblem` refuses,
 * prefixed by where it is: what a write refuses (0150), as it refuses a
 * label for a state the moves do not name (0129). A removal is always one.
 */
export function startingStateProblems(fields: readonly FieldPresentation[], policy: FormPolicy): string[] {
  return fields.flatMap((entry, index) => {
    const value = entry.default
    const problem = value === undefined ? null : startingStateProblem(policy, entry.field, value)
    return problem === null ? [] : [`/fields/${String(index)}/default: ${problem}.`]
  })
}
