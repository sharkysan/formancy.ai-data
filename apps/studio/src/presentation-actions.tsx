import { useState } from 'react'
import type { ReactElement } from 'react'
import { actionLabel } from '@formancy/data-core'
import type { ActionBinding, ActionInputPresentation, ActionPresentation, ActionRefresh, FormBindings } from '@formancy/data-core'
import type { ActionEdit, InputEdit } from './action-words.js'
import { actionWordsProblems, shown, withActionWords, withInputWords } from './action-words.js'

/** The views a run can read again besides its record, as their boxes name them. */
const REFRESHED: ReadonlyArray<{ view: ActionRefresh; label: string }> = [
  { view: 'list', label: 'This form’s list' },
  { view: 'children', label: 'Its child grids' },
]

/**
 * A box of words, kept as typed: emptied, it stays empty under the
 * keyboard while what it stands for goes back to the generator's, which
 * its hint says.
 */
function WordsInput({
  id,
  label,
  value,
  hint,
  multiline = false,
  onWords,
}: {
  id: string
  label: ReactElement
  value: string
  hint: string
  multiline?: boolean
  onWords: (text: string) => void
}): ReactElement {
  const [draft, setDraft] = useState(value)
  const change = (text: string) => {
    setDraft(text)
    onWords(text)
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} rows={2} value={draft} aria-describedby={`${id}-hint`} onChange={(event) => change(event.target.value)} />
      ) : (
        <input id={id} value={draft} aria-describedby={`${id}-hint`} onChange={(event) => change(event.target.value)} />
      )}
      <p id={`${id}-hint`} className="hint">
        {hint}
      </p>
    </div>
  )
}

/** One question of an action's dialog: its label and its help text, each the generator's until typed over. */
function QuestionWords({
  id,
  name,
  field,
  words,
  onInput,
}: {
  id: string
  name: string
  field: NonNullable<ActionBinding['dialog']>['model']['fields'][number]
  words: ActionInputPresentation | undefined
  onInput: (input: string, edit: InputEdit) => void
}): ReactElement {
  const help = words?.description === null ? '' : shown(words?.description ?? field.description)
  return (
    <div>
      <WordsInput
        id={`${id}-label`}
        label={
          <>
            Label of {field.key} <span className="visually-hidden">in the {name} dialog</span>
          </>
        }
        value={shown(words?.label ?? field.label)}
        hint={`Empty, it is “${shown(field.label)}”, the generator’s.`}
        onWords={(label) => onInput(field.key, { label })}
      />
      <WordsInput
        id={`${id}-help`}
        label={
          <>
            Help text of {field.key} <span className="visually-hidden">in the {name} dialog</span>
          </>
        }
        value={help}
        hint="Read under the question, and with it by a screen reader. Empty, there is none."
        multiline
        onWords={(description) => onInput(field.key, { description })}
      />
    </div>
  )
}

/** One action's words: its label, the sentences before and after a run, what is read again, and each question of its dialog. */
function ActionWords({
  binding,
  entry,
  onAction,
  onInput,
}: {
  binding: ActionBinding
  entry: ActionPresentation | undefined
  onAction: (edit: ActionEdit) => void
  onInput: (input: string, edit: InputEdit) => void
}): ReactElement {
  const name = binding.name
  const id = `action-words-${name}`
  const base = actionLabel(name)
  const refresh = entry?.refresh ?? []
  const hidden = (what: string) => <span className="visually-hidden">{what}</span>
  return (
    <fieldset>
      <legend>{name}</legend>
      <WordsInput
        id={`${id}-label`}
        label={<>Label {hidden(`of the ${name} action`)}</>}
        value={entry?.label === undefined ? base : shown(entry.label)}
        hint={`On its button and its dialog. Empty, it is “${base}”, the generator’s.`}
        onWords={(label) => onAction({ label })}
      />
      <WordsInput
        id={`${id}-confirm`}
        label={<>Asked before it runs {hidden(`for the ${name} action`)}</>}
        value={shown(entry?.confirm)}
        hint="The sentence a page asks before the run. Empty, a page asks in its own words."
        multiline
        onWords={(confirm) => onAction({ confirm })}
      />
      <WordsInput
        id={`${id}-done`}
        label={<>Said once it has run {hidden(`for the ${name} action`)}</>}
        value={shown(entry?.done)}
        hint="Empty, a page says “Done.”"
        multiline
        onWords={(done) => onAction({ done })}
      />
      <fieldset className="nested">
        <legend>Read again after {name} runs</legend>
        <p className="hint">The record it ran over is always read again: the run moved its version.</p>
        {REFRESHED.map(({ view, label }) => (
          <div className="check" key={view}>
            <input
              type="checkbox"
              id={`${id}-refresh-${view}`}
              checked={refresh.includes(view)}
              onChange={(event) => onAction({ refresh: event.target.checked ? [...refresh, view] : refresh.filter((entry) => entry !== view) })}
            />
            <label htmlFor={`${id}-refresh-${view}`}>
              {label} {hidden(`after ${name}`)}
            </label>
          </div>
        ))}
      </fieldset>
      {(binding.dialog?.model.fields ?? []).map((field) => (
        <QuestionWords
          key={field.key}
          id={`${id}-input-${field.key}`}
          name={name}
          field={field}
          words={entry?.inputs?.find((candidate) => candidate.input === field.key)}
          onInput={onInput}
        />
      ))}
    </fieldset>
  )
}

/**
 * The words of the form's actions (0159, 0163): for each action the
 * bindings bind, its label, the sentence a page asks before a run and the
 * one it says after, what else it reads again, and each question of its
 * dialog. Words alone, kept in the one spelling the server reads
 * (`action-words.ts`): nothing here names a routine, gives a parameter a
 * value, or adds, removes, retypes or requires a field of a dialog, which
 * the bindings hold and every write compares with the generator. What
 * the server or formancy's validator refuses of them is said here, in
 * their words, and the Publish step waits on it.
 */
export function ActionsPanel({
  bindings,
  actions,
  onActions,
}: {
  bindings: FormBindings
  actions: readonly ActionPresentation[]
  onActions: (next: ActionPresentation[]) => void
}): ReactElement | null {
  const bound = bindings.actions ?? []
  if (bound.length === 0) return null
  const problems = actionWordsProblems(actions, bindings)
  return (
    <section className="action-words" aria-labelledby="action-words-heading">
      <h3 id="action-words-heading">Actions</h3>
      <p className="hint">
        What a person reads of each action. The routine it runs, what each parameter is given and what its dialog asks are the generator&rsquo;s, from the
        Choose step.
      </p>
      {bound.map((binding) => (
        <ActionWords
          key={binding.name}
          binding={binding}
          entry={actions.find((entry) => entry.action === binding.name)}
          onAction={(edit) => onActions(withActionWords(actions, bindings, binding.name, edit))}
          onInput={(input, edit) => onActions(withInputWords(actions, bindings, binding.name, input, edit))}
        />
      ))}
      <div aria-live="polite">
        {problems.length === 0 ? null : (
          <ul className="cannot-tell" aria-label="What the server refuses of these words">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
