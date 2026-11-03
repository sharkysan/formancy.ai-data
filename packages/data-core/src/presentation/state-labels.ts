import type { FormPolicy } from '../policy/types.js'
import type { StateLabel } from './types.js'
import { nameProblem } from './views.js'

/*
 * The labels of a state field's states (0129): words an administrator
 * gives the values a policy holds its state field to (0112), so a person
 * picks "Placed" where the column holds `placed`. Kept in the presentation
 * as `{ state, label }`, each state spelled as its column holds it, which
 * is what the policy's moves name and what a record holds. Presentation
 * only: the values written, checked and audited are the states.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Every reason `value` is not a presentation's `states` by shape: a list,
 * not empty -- none labelled is the property left out, so a presentation
 * has one spelling -- of `{ state, label }`, each state text and once, each
 * label words a person can read.
 */
export function stateLabelShapeProblems(value: unknown): string[] {
  if (!Array.isArray(value)) return ['states must be a list of { state, label }']
  if (value.length === 0) return ['states: labels none; leave it out']
  const problems: string[] = []
  const seen = new Set<string>()
  for (const [index, entry] of (value as unknown[]).entries()) {
    const at = `/states/${String(index)}`
    if (!isRecord(entry) || Object.keys(entry).some((key) => key !== 'state' && key !== 'label')) {
      problems.push(`${at} must be { state, label } and nothing else`)
      continue
    }
    const state = entry['state']
    if (typeof state !== 'string' || state === '') problems.push(`${at}/state must be a state, as its column holds it`)
    else if (seen.has(state)) problems.push(`${at}: ${state} is labelled twice`)
    else seen.add(state)
    const label = nameProblem(entry['label'])
    if (label !== null) problems.push(`${at}/label ${label}`)
  }
  return problems
}

/** The states a policy's moves name, in the order they first appear: where each move starts, then where it goes. */
export function statesOf(policy: FormPolicy): string[] {
  const named: string[] = []
  for (const move of policy.transitions?.moves ?? []) for (const state of [move.from, move.to]) if (state !== null && !named.includes(state)) named.push(state)
  return named
}

/**
 * Every labelled state that is no state `policy`'s moves name, prefixed by
 * where it is: what a write refuses, as it refuses a list view that does
 * not fit (0105). A label for a state nothing moves to or from would be
 * shown nowhere.
 */
export function stateLabelProblems(labels: readonly StateLabel[], policy: FormPolicy): string[] {
  if (labels.length === 0) return []
  if (policy.transitions === undefined) return ['/states: the policy holds no field to moves, so there is no state to label.']
  const named = statesOf(policy)
  return labels.flatMap((entry, index) =>
    named.includes(entry.state) ? [] : [`/states/${String(index)}: ${entry.state} is no state the policy's moves name.`],
  )
}
