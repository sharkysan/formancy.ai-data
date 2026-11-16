import type { FormSchema, Text } from '@formancy/spec'
import type { ActionBinding } from '../actions/types.js'
import { ACTION_REFRESH, type ActionRefresh, type FormAction } from '../actions/wire.js'
import { actionLabel } from '../generate/action-dialog.js'
import type { FormBindings } from '../generate/types.js'
import { copyOf, hasKeys, isRecord, isText, same } from './layout.js'

/*
 * The words of a form's actions (0159), as a presentation keeps them: a
 * patch over what the generator wrote -- the action's name in words, and
 * its dialog's fields -- and the sentences and views no generator writes.
 * Words alone: nothing here can add a field to a dialog, retype one, make
 * it optional or bind another routine, which the bindings hold and every
 * write compares with the generator (0030).
 */

/** The words of one dialog field over the generated ones: a label, and help text or `null` to remove the base's. */
export interface ActionInputPresentation {
  input: string
  label?: Text
  description?: Text | null
}

/**
 * The words of one action, by its name, each present only where it says
 * something the base does not: `label` over the action's name in words;
 * `confirm`, a sentence a person is asked before a run; `done`, the one
 * shown after it in place of "Done."; `refresh`, what else to read again,
 * in `ACTION_REFRESH`'s order; and `inputs`, words over the dialog's
 * fields, in its order.
 */
export interface ActionPresentation {
  action: string
  label?: Text
  confirm?: Text
  done?: Text
  refresh?: ActionRefresh[]
  inputs?: ActionInputPresentation[]
}

function inputShapeProblems(entry: unknown, at: string, seen: Set<string>): string[] {
  if (!isRecord(entry)) return [`${at} must be an object`]
  const problems: string[] = []
  if (!hasKeys(entry, ['input'], ['label', 'description'])) problems.push(`${at} holds a property an input's words do not`)
  if (typeof entry['input'] !== 'string') problems.push(`${at}/input must be a dialog field's key`)
  else if (seen.has(entry['input'])) problems.push(`${at}: ${entry['input']} appears twice`)
  else seen.add(entry['input'])
  if ('label' in entry && !isText(entry['label'])) problems.push(`${at}/label must be text`)
  if ('description' in entry && entry['description'] !== null && !isText(entry['description']))
    problems.push(`${at}/description must be text, or null to remove the base’s`)
  return problems
}

function entryShapeProblems(entry: unknown, at: string, seen: Set<string>): string[] {
  if (!isRecord(entry)) return [`${at} must be an object`]
  const problems: string[] = []
  if (!hasKeys(entry, ['action'], ['label', 'confirm', 'done', 'refresh', 'inputs'])) problems.push(`${at} holds a property an action's words do not`)
  if (typeof entry['action'] !== 'string') problems.push(`${at}/action must be an action's name`)
  else if (seen.has(entry['action'])) problems.push(`${at}: ${entry['action']} appears twice`)
  else seen.add(entry['action'])
  for (const words of ['label', 'confirm', 'done'] as const) if (words in entry && !isText(entry[words])) problems.push(`${at}/${words} must be text`)
  if ('refresh' in entry) {
    const refresh = entry['refresh']
    const ordered = ACTION_REFRESH.filter((view) => Array.isArray(refresh) && refresh.includes(view))
    if (!Array.isArray(refresh) || refresh.length === 0 || !same(refresh, ordered))
      problems.push(`${at}/refresh must be one or both of ${ACTION_REFRESH.join(' and ')}, each once, in that order`)
  }
  if ('inputs' in entry) {
    const inputs = entry['inputs']
    if (!Array.isArray(inputs) || inputs.length === 0) problems.push(`${at}/inputs must be a list of one or more inputs' words`)
    else {
      const named = new Set<string>()
      for (const [index, input] of inputs.entries()) problems.push(...inputShapeProblems(input, `${at}/inputs/${String(index)}`, named))
    }
  }
  return problems
}

/** Every reason a presentation's `actions` is not one this release reads, by shape alone; left out where there are none, never `[]`. */
export function actionShapeProblems(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ['actions must be a list of one or more actions’ words, left out where there are none']
  const seen = new Set<string>()
  return value.flatMap((entry, index) => entryShapeProblems(entry, `/actions/${String(index)}`, seen))
}

/** The dialog's field of `input`, or `undefined`. */
function fieldOf(dialog: FormSchema | null, input: string): FormSchema['model']['fields'][number] | undefined {
  return dialog?.model.fields.find((field) => field.key === input)
}

/** What one action's words do not fit: an input the dialog lacks, out of order, or a word equal to the base's or saying nothing. */
function inputProblems(binding: ActionBinding, entry: ActionPresentation, at: string): string[] {
  const problems: string[] = []
  const order = binding.dialog?.model.fields.map((field) => field.key) ?? []
  let previous = -1
  for (const [index, words] of (entry.inputs ?? []).entries()) {
    const where = `${at}/inputs/${String(index)}`
    const field = fieldOf(binding.dialog, words.input)
    if (field === undefined) {
      problems.push(`${where}/input: ${binding.name}'s dialog has no field ${words.input}`)
      continue
    }
    if (order.indexOf(words.input) < previous) problems.push(`${at}/inputs: not in the dialog's field order`)
    previous = order.indexOf(words.input)
    if (words.label === undefined && words.description === undefined) problems.push(`${where}: says nothing; leave the input out`)
    if (words.label !== undefined && same(words.label, field.label)) problems.push(`${where}/label: equals the base's; leave it out`)
    if (words.description === null && field.description === undefined) problems.push(`${where}/description: the base has no help text to remove; leave it out`)
    if (words.description !== undefined && words.description !== null && same(words.description, field.description))
      problems.push(`${where}/description: equals the base's; leave it out`)
  }
  return problems
}

/**
 * Every reason a presentation's actions do not fit the bindings (0159):
 * an action they do not bind, out of their order, an entry that says
 * nothing, a label equal to the base's, and words over a dialog field
 * that is not there or that say what it already says -- so a
 * presentation has one spelling, as a field's entry has.
 */
export function actionPresentationProblems(actions: readonly ActionPresentation[] | undefined, bindings: Pick<FormBindings, 'actions'>): string[] {
  const problems: string[] = []
  const order = (bindings.actions ?? []).map((action) => action.name)
  let previous = -1
  for (const [index, entry] of (actions ?? []).entries()) {
    const at = `/actions/${String(index)}`
    const binding = bindings.actions?.find((action) => action.name === entry.action)
    if (binding === undefined) {
      problems.push(`${at}/action: the form binds no action ${entry.action}`)
      continue
    }
    if (order.indexOf(entry.action) < previous) problems.push("/actions: not in the bindings' action order")
    previous = order.indexOf(entry.action)
    const said = [entry.label, entry.confirm, entry.done, entry.refresh, entry.inputs].some((words) => words !== undefined)
    if (!said) problems.push(`${at}: says nothing; leave the action out`)
    if (entry.label !== undefined && same(entry.label, actionLabel(binding.name))) problems.push(`${at}/label: equals the base's; leave it out`)
    if (entry.inputs !== undefined && binding.dialog === null) problems.push(`${at}/inputs: ${binding.name} has no dialog`)
    else problems.push(...inputProblems(binding, entry, at))
  }
  return problems
}

/**
 * The dialog with an action's words applied: its section labelled with the
 * action's label, and its title too where that is a literal, which a
 * form's title must be; and each input's label and help text.
 */
function wordedDialog(dialog: FormSchema | null, label: Text, entry: ActionPresentation | undefined): FormSchema | null {
  if (dialog === null) return null
  const worded = copyOf(dialog)
  if (typeof label === 'string') worded.title = label
  const section = worded.layouts?.[0]?.nodes[0] as { label?: Text } | undefined
  if (section !== undefined) section.label = label
  for (const words of entry?.inputs ?? []) {
    const field = fieldOf(worded, words.input)
    if (field === undefined) continue
    if (words.label !== undefined) field.label = words.label
    if (words.description === null) delete field.description
    else if (words.description !== undefined) field.description = words.description
  }
  return worded
}

/**
 * Every action the bindings bind, as a page would be offered it, with the
 * presentation's words applied -- or what the generator wrote where it
 * says nothing. Not narrowed: who may run which, and which drift leaves
 * runnable, is the caller's to decide (`runnableActions`, the drift
 * verdict's `actions`). Asked of a presentation `actionPresentationProblems`
 * accepted.
 */
export function presentedActions(bindings: Pick<FormBindings, 'actions'>, actions: readonly ActionPresentation[] | undefined): FormAction[] {
  return (bindings.actions ?? []).map((binding) => {
    const entry = actions?.find((candidate) => candidate.action === binding.name)
    const label = entry?.label ?? actionLabel(binding.name)
    return {
      name: binding.name,
      label,
      scope: binding.scope,
      confirm: entry?.confirm ?? null,
      done: entry?.done ?? null,
      dialog: wordedDialog(binding.dialog, label, entry),
      refresh: [...(entry?.refresh ?? [])],
    }
  })
}
