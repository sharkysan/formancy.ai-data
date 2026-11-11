import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { BuilderSession, CommandOutcome } from '@formancy/builder-core'
import { noStartingValue, shownValue, startingStateProblem, startingValue } from '@formancy/data-core'
import type { FieldBinding, FormPolicy, GenerationNote, StartingValue } from '@formancy/data-core'
import type { FieldDef } from '@formancy/spec'
import { useFocusAfterRender } from './focus.js'

/*
 * A field's starting value (0150), in the Presentation step, under its help
 * text: the answer a new record starts the field with, over the column's
 * constant default the generator gave it (0149). It says what the
 * generator noted -- "Starts with the column's default, “draft”." -- and
 * offers the column's or another: a box for text and numbers, for a yes or
 * no a choice of its own two. None is offered only where the column has no
 * default: a field left empty is left out of a create, which stores the
 * column's default without the person seeing it, so the column's is never
 * taken away. Every
 * value is read by data-core's `startingValue` before the session sees it,
 * the reading a publish refuses by, and set as the answer a record holding
 * it reads back as: “9.5000” for 9.5. A field that takes none -- a lookup,
 * one a create does not write, a date, a time, an instant, a float, a
 * uuid -- says why, and offers nothing.
 */

/** What one field's starting value is edited from. */
export interface StartingField {
  binding: FieldBinding | undefined
  /** As the generator wrote it: its own default is the column's. */
  base: FieldDef
  /** As the session's document has it now. */
  current: FieldDef
  /** The generator's note about what the field starts with, where it wrote one. */
  note: GenerationNote | undefined
  /** The policy the Policy step drew, whose create moves are the states a state field may start in (0112). */
  policy: FormPolicy
}

/** The note 0149's generator writes about what a field starts with: "Starts with …" or "Starts empty: …". */
export function startNote(notes: readonly GenerationNote[], key: string): GenerationNote | undefined {
  return notes.find((note) => note.subject === key && note.message.startsWith('Starts'))
}

/** A starting value as the step's status says what it set: as its box shows it, quoted, where data-core's sentences name a number as one. */
export function quoted(value: StartingValue): string {
  return `“${String(value)}”`
}

/** A starting value as a box shows it; none is empty. */
function asText(value: FieldDef['default']): string {
  return value === undefined ? '' : String(value)
}

/** What a box's text gives a field: a number where its control holds one and the text reads as one, else the text, for `startingValue` to take or refuse. */
function typedAnswer(field: FieldDef, text: string): StartingValue {
  return field.type === 'number' && /^-?[0-9]+(\.[0-9]+)?$/.test(text) ? Number(text) : text
}

type Reading = { ok: true; answer: StartingValue } | { ok: false; problem: string }

/** `value` as the field's starting value, read as a publish reads it: its canonical answer, or the clause that refuses it. */
function reading(field: StartingField, binding: FieldBinding, value: StartingValue): Reading {
  const taken = startingValue(binding, field.base, value)
  if (!taken.ok) return taken
  const state = startingStateProblem(field.policy, binding.field, taken.answer)
  return state === null ? taken : { ok: false, problem: `${shownValue(taken.answer)} cannot start ${binding.field}: ${state}` }
}

/** A yes or no's starts: its own two -- a checkbox ticked and not, a select's options -- after none where the column has no default. */
function choices(field: FieldDef): Array<{ value: string; label: string }> {
  const own =
    field.type === 'checkbox'
      ? [
          { value: 'true', label: 'Ticked' },
          { value: 'false', label: 'Not ticked' },
        ]
      : (field.options ?? []).map((option) => ({ value: option.value, label: typeof option.label === 'string' ? option.label : option.value }))
  return field.default === undefined ? [{ value: '', label: 'None' }, ...own] : own
}

/**
 * One field's starting value: its control, what the generator noted, and
 * the column's default offered back where another replaced it or none did.
 * A refused value is said where the step says what it did, its live
 * status, and under the control, which names it and is marked invalid,
 * and the document keeps what it had; the box keeps what was typed, and follows the
 * document when Undo, Redo or the button change it to something the typing
 * does not read as. The button goes once pressed, and gives the keyboard
 * to the control it set.
 */
export function StartingValueControl({
  id,
  field,
  session,
  report,
  refuse,
}: {
  id: string
  field: StartingField
  session: BuilderSession
  report: (outcome: CommandOutcome, done: string) => CommandOutcome
  /** Says a refusal where the step says what it did. */
  refuse: (message: string) => void
}): ReactElement {
  const { binding, base, current } = field
  const key = base.key
  const value = asText(current.default)
  const [draft, setDraft] = useState(value)
  const [problem, setProblem] = useState<string | null>(null)
  const focusAfter = useFocusAfterRender()
  useEffect(() => {
    setDraft((typed) => {
      if (binding === undefined || typed === '') return value
      const read = reading(field, binding, typedAnswer(base, typed))
      return read.ok && asText(read.answer) === value ? typed : value
    })
    setProblem(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the box follows the document's value alone; the field it is read against is made again on every render
  }, [value])

  const none = binding === undefined ? 'it is bound to nothing' : noStartingValue(binding)
  if (binding === undefined || none !== null) return <p className="hint">No starting value: {none}.</p>

  const refused = (message: string) => {
    setProblem(message)
    refuse(message)
  }
  const set = (answer: StartingValue | undefined, done: string) => {
    const outcome = report(session.setFieldProperty([key], 'default', answer), done)
    if (outcome.ok) setProblem(null)
    else refused(`${outcome.message} The field keeps the starting value it had.`)
  }
  const column = base.default as StartingValue | undefined
  const give = (text: string, answer: StartingValue) => {
    if (text === '' && column !== undefined) {
      return refused(
        `Left empty, a new record would store the column’s default, ${quoted(column)}, without showing it. Until it has a value, the field keeps the starting value it had.`,
      )
    }
    if (text === '') return set(undefined, `Removed the starting value of ${key}.`)
    const read = reading(field, binding, answer)
    if (!read.ok) return refused(`${read.problem}. Until it is one, the field keeps the starting value it had.`)
    return set(read.answer, `Gave ${key} the starting value ${quoted(read.answer)}.`)
  }
  const hint = `${id}-hint`
  const described = problem === null ? hint : `${hint} ${id}-problem`
  const choice = binding.kind === 'column' && binding.type.kind === 'boolean'
  return (
    <div className="field starting">
      <label htmlFor={id}>
        Starting value <span className="visually-hidden">of {key}</span>
      </label>
      {choice ? (
        <select
          id={id}
          value={value}
          aria-invalid={problem !== null}
          aria-describedby={described}
          // A checkbox answers true or false; a select, the option's value.
          onChange={(event) => give(event.target.value, base.type === 'checkbox' ? event.target.value === 'true' : event.target.value)}
        >
          {choices(base).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          value={draft}
          aria-invalid={problem !== null}
          aria-describedby={described}
          onChange={(event) => {
            setDraft(event.target.value)
            give(event.target.value, typedAnswer(base, event.target.value))
          }}
        />
      )}
      <p id={hint} className="hint">
        Generated: {field.note?.message ?? 'starts empty.'}
        {choice || column !== undefined ? null : ' Empty, a new record starts it empty.'}
      </p>
      {problem === null ? null : (
        <p id={`${id}-problem`} className="field-problem">
          {problem}
        </p>
      )}
      {column === undefined || current.default === column ? null : (
        <button
          type="button"
          className="button"
          onClick={() => {
            set(column, `Gave ${key} the column’s default, ${quoted(column)}.`)
            focusAfter(id)
          }}
        >
          Use the column&rsquo;s default <span className="visually-hidden">for {key}</span>
        </button>
      )}
    </div>
  )
}
