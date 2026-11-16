import type { FormBindings } from '../generate/types.js'
import { actionLabel } from '../generate/action-dialog.js'
import type { ActionInputPresentation, ActionPresentation } from './actions.js'
import { same } from './layout.js'
import type { PresentationConflict } from './types.js'

/** What `carryActions` reads: the published actions' words, the regenerated bindings, and where a dropped one is said. */
export interface ActionCarry {
  actions: readonly ActionPresentation[]
  bindings: Pick<FormBindings, 'actions'>
  /** The words at `index` of the published ones, or one of their inputs', could not be carried. */
  report: (index: number, conflict: Extract<PresentationConflict, { kind: 'action-dropped' | 'action-input-dropped' }>) => void
}

/**
 * One input's words carried to the regenerated dialog: a label or help
 * text the new field already has is no longer an override and goes
 * without a word, as does a removal of help text the field no longer has.
 */
function carriedInput(words: ActionInputPresentation, field: { label?: unknown; description?: unknown }): ActionInputPresentation | null {
  const carried: ActionInputPresentation = { input: words.input }
  if (words.label !== undefined && !same(words.label, field.label)) carried.label = words.label
  if (words.description === null) {
    if (field.description !== undefined) carried.description = null
  } else if (words.description !== undefined && !same(words.description, field.description)) carried.description = words.description
  return Object.keys(carried).length === 1 ? null : carried
}

/**
 * The published words of the form's actions carried to a regenerated base
 * (0159), by the action's name and each input's key, in the new bindings'
 * order. The words of an action the regenerated bindings do not bind --
 * the request no longer names it, or the generator now refuses it -- are
 * dropped and said; so are an input's, where the new dialog has no field
 * of its key. A sentence, a refresh and a label are the action's, not a
 * field's, and go with it while it is bound. What the regenerated base
 * already says is no longer an override, and goes without a word.
 */
export function carryActions({ actions, bindings, report }: ActionCarry): ActionPresentation[] {
  const carried: ActionPresentation[] = []
  for (const [index, entry] of actions.entries()) {
    const binding = bindings.actions?.find((action) => action.name === entry.action)
    if (binding === undefined) {
      report(index, {
        kind: 'action-dropped',
        action: entry.action,
        resolution: 'dropped',
        message: `The words of action ${entry.action} were dropped: the regenerated form does not offer it.`,
      })
      continue
    }
    const inputs: ActionInputPresentation[] = []
    for (const words of entry.inputs ?? []) {
      const field = binding.dialog?.model.fields.find((candidate) => candidate.key === words.input)
      if (field === undefined) {
        report(index, {
          kind: 'action-input-dropped',
          action: entry.action,
          input: words.input,
          resolution: 'dropped',
          message: `The words of ${words.input} in action ${entry.action}'s dialog were dropped: the regenerated dialog asks for no ${words.input}.`,
        })
        continue
      }
      const kept = carriedInput(words, field)
      if (kept !== null) inputs.push(kept)
    }
    const order = binding.dialog?.model.fields.map((field) => field.key) ?? []
    inputs.sort((left, right) => order.indexOf(left.input) - order.indexOf(right.input))
    const next: ActionPresentation = {
      action: entry.action,
      ...(entry.label === undefined || same(entry.label, actionLabel(entry.action)) ? {} : { label: entry.label }),
      ...(entry.confirm === undefined ? {} : { confirm: entry.confirm }),
      ...(entry.done === undefined ? {} : { done: entry.done }),
      ...(entry.refresh === undefined ? {} : { refresh: [...entry.refresh] }),
      ...(inputs.length === 0 ? {} : { inputs }),
    }
    if (Object.keys(next).length > 1) carried.push(next)
  }
  const order = (bindings.actions ?? []).map((action) => action.name)
  return carried.sort((left, right) => order.indexOf(left.action) - order.indexOf(right.action))
}
