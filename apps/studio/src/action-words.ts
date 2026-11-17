import { ACTION_REFRESH, actionLabel, actionPresentationProblems, actionShapeProblems, presentedActions } from '@formancy/data-core'
import type { ActionBinding, ActionInputPresentation, ActionPresentation, ActionRefresh, FormBindings } from '@formancy/data-core'
import { validateSchema } from '@formancy/spec/validate'
import type { Text } from '@formancy/spec'

/*
 * The words of a form's actions (0159, 0163), as the Presentation step
 * edits them: a patch over what the generator wrote, kept in the one
 * spelling the server reads -- an action's entry only where it says
 * something, each word only where it differs from the base's, in the
 * bindings' and the dialog's order -- so what a person types publishes,
 * and a word typed back to the base's leaves nothing behind. Words alone:
 * nothing here names a routine, a parameter or a dialog field's type,
 * which the bindings hold and every write compares with the generator.
 */

/** A text as a box shows it: a literal, or the key of a message reference, which the step does not edit. */
export function shown(text: Text | undefined): string {
  return text === undefined ? '' : typeof text === 'string' ? text : text.$t
}

/** The dialog field of `input`, as the generator wrote it. */
function fieldOf(binding: ActionBinding, input: string): NonNullable<ActionBinding['dialog']>['model']['fields'][number] | undefined {
  return binding.dialog?.model.fields.find((field) => field.key === input)
}

/** What one action's words change, as boxes give it: each a string as typed, '' for none -- the base's label, no sentence, no help text. */
export type ActionEdit = { label: string } | { confirm: string } | { done: string } | { refresh: ActionRefresh[] }

/** What one dialog field's words change, as boxes give it. */
export type InputEdit = { label: string } | { description: string }

/** An entry with only what it says: `undefined` for one that says nothing, which the server refuses. */
function spoken(entry: ActionPresentation): ActionPresentation | undefined {
  const { action, ...words } = entry
  return Object.keys(words).length === 0 ? undefined : { action, ...words }
}

/** `actions` with `entry` in the bindings' place for its action, or without one where it says nothing. */
function placed(
  actions: readonly ActionPresentation[],
  bindings: Pick<FormBindings, 'actions'>,
  name: string,
  entry: ActionPresentation | undefined,
): ActionPresentation[] {
  const others = new Map(actions.filter((candidate) => candidate.action !== name).map((candidate) => [candidate.action, candidate]))
  if (entry !== undefined) others.set(name, entry)
  return (bindings.actions ?? []).flatMap((binding) => {
    const found = others.get(binding.name)
    return found === undefined ? [] : [found]
  })
}

/**
 * `actions` with one of `name`'s words changed: the label left out where
 * it is empty or the base's, a sentence where it is blank, the views in
 * `ACTION_REFRESH`'s order and left out where there are none.
 */
export function withActionWords(
  actions: readonly ActionPresentation[],
  bindings: Pick<FormBindings, 'actions'>,
  name: string,
  edit: ActionEdit,
): ActionPresentation[] {
  const entry: ActionPresentation = structuredClone(actions.find((candidate) => candidate.action === name) ?? { action: name })
  if ('label' in edit) {
    if (edit.label.trim() === '' || edit.label === actionLabel(name)) delete entry.label
    else entry.label = edit.label
  } else if ('refresh' in edit) {
    const refresh = ACTION_REFRESH.filter((view) => edit.refresh.includes(view))
    if (refresh.length === 0) delete entry.refresh
    else entry.refresh = refresh
  } else {
    const [which, text] = 'confirm' in edit ? (['confirm', edit.confirm] as const) : (['done', edit.done] as const)
    if (text.trim() === '') delete entry[which]
    else entry[which] = text
  }
  return placed(actions, bindings, name, spoken(entry))
}

/**
 * `actions` with the words of `input`, a field of `name`'s dialog,
 * changed: its label left out where it is empty or the field's own, and
 * its help text where it is the field's own -- or, emptied, the field's
 * removed where it has one and left out where it has none.
 */
export function withInputWords(
  actions: readonly ActionPresentation[],
  bindings: Pick<FormBindings, 'actions'>,
  name: string,
  input: string,
  edit: InputEdit,
): ActionPresentation[] {
  const binding = bindings.actions?.find((candidate) => candidate.name === name)
  const field = binding === undefined ? undefined : fieldOf(binding, input)
  if (binding === undefined || field === undefined) return [...actions]
  const entry: ActionPresentation = structuredClone(actions.find((candidate) => candidate.action === name) ?? { action: name })
  const words: ActionInputPresentation = entry.inputs?.find((candidate) => candidate.input === input) ?? { input }
  if ('label' in edit) {
    if (edit.label.trim() === '' || edit.label === shown(field.label)) delete words.label
    else words.label = edit.label
  } else if (edit.description === '') {
    if (field.description === undefined) delete words.description
    else words.description = null
  } else if (edit.description === shown(field.description)) delete words.description
  else words.description = edit.description
  const order = binding.dialog?.model.fields.map((candidate) => candidate.key) ?? []
  const inputs = [
    ...(entry.inputs ?? []).filter((candidate) => candidate.input !== input),
    ...(words.label === undefined && words.description === undefined ? [] : [words]),
  ].sort((left, right) => order.indexOf(left.input) - order.indexOf(right.input))
  if (inputs.length === 0) delete entry.inputs
  else entry.inputs = inputs
  return placed(actions, bindings, name, spoken(entry))
}

/**
 * What the server refuses of the words, in its words -- their shape
 * (`actionShapeProblems`) and their fit to the bindings
 * (`actionPresentationProblems`), the checks a publish runs -- and of each
 * dialog with them applied, in formancy's validator's -- the dialog a page
 * is served (`presentedActions`), which no renderer draws once a word of
 * it is one formancy refuses, and which the server's bundle check refuses
 * in this sentence (data-server's `bundle-format2.ts`, 0163).
 */
export function actionWordsProblems(actions: readonly ActionPresentation[], bindings: Pick<FormBindings, 'actions'>): string[] {
  if (actions.length === 0) return []
  const fitted = [...actionShapeProblems(actions), ...actionPresentationProblems(actions, bindings)]
  if (fitted.length > 0) return fitted
  return presentedActions(bindings, actions).flatMap((action) => {
    if (action.dialog === null) return []
    const checked = validateSchema(action.dialog)
    // The first, which names what to change: the rest are the alternatives the schema tried after it.
    const [first] = checked.valid ? [] : checked.errors
    return first === undefined ? [] : [`the dialog of ${action.name}, at ${first.path}: ${first.message}`]
  })
}
