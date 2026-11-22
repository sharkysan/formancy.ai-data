import type { FormSchema } from '@formancy/spec'
import type { PublishedForm } from '@formancy/data-client'
import { disableFields } from './widgets.js'

/*
 * A state field as the moves its person may make (0127). Where the policy
 * holds a field to its moves (0112), the server names those this person
 * may make (`PublishedForm.moves`), and the host's copy of the form draws
 * the field as a choice of where it may go from where the record is: the
 * state it holds, first, and each it may move to. With nowhere to go it is
 * drawn disabled, as a field nothing writes. A new record starts from
 * nothing: a choice of the states a create may start it in, or disabled,
 * left to the column's default, where none is listed for this person. A
 * whole number held to moves keeps its box, and is only disabled where it
 * may go nowhere; a select of the values a check lists (0152), text or a
 * whole number, answers text and is drawn as the moves, so it never offers
 * every value its check lists where the policy holds it to a few. A new
 * record's choice starts at the field's default, which the server serves
 * only where it is a state a create of this person's may start the record
 * in (0149); a saved record's carries none, since it opens at the state it
 * holds, and a default its choice did not offer would stop the engine
 * opening it.
 *
 * Presentation only, as the rest of the host's copy is: the server checks
 * every move again (0112), and refuses the one a stale page still offers.
 */

/** `form` with the state field drawn as the moves `moves` names from `from`, the state the record holds, `null` for a new one; `form` itself where no field is held to moves. */
export function withMoves(form: FormSchema, moves: PublishedForm['moves'], from: string | null): FormSchema {
  if (moves === null) return form
  const to = moves.moves.filter((move) => move.from === from).map((move) => move.to)
  return drawnAs(form, moves, from === null ? to : [from, ...to], to.length > 0, from === null)
}

/**
 * `form` with the state field drawn as the states the records a change of
 * chosen records is over may move to (0176): one state is set for every
 * record, and the server checks each record's move from its own state
 * (0175), so the choice offers every state one of `froms` may reach, none
 * of them first, since the records are in no one state. A record whose
 * state the page did not read -- `undefined`, its field no column of the
 * page -- may be in any, so every state a move from a state reaches is
 * offered for it. Nowhere to go, the field is drawn disabled; and never
 * with a default, which is a create's.
 */
export function withMovesOver(form: FormSchema, moves: PublishedForm['moves'], froms: ReadonlyArray<string | null | undefined>): FormSchema {
  if (moves === null) return form
  const reaches = (from: string | null | undefined): string[] =>
    moves.moves.filter((move) => (from === undefined ? move.from !== null : move.from === from)).map((move) => move.to)
  const to = [...new Set(froms.flatMap(reaches))]
  return drawnAs(form, moves, to, to.length > 0, false)
}

/** The state field drawn as a choice of `states` by `moves`' labels, or disabled where it `goes` nowhere; `defaults`, a new record's, keeps the field's default. */
function drawnAs(form: FormSchema, moves: NonNullable<PublishedForm['moves']>, states: readonly string[], goes: boolean, defaults: boolean): FormSchema {
  const field = form.model.fields.find((candidate) => candidate.key === moves.field)
  if (field === undefined) return form
  if (!goes) return disableFields(form, [field.key])
  // A whole number's state keeps its number box: a choice answers text, which its codec would read as another value.
  // A select of the values a check lists already answers text, a whole number's too (0152), and is drawn as the moves like a box.
  if (field.type !== 'text' && !(field.type === 'select' && field.options !== undefined)) return form
  const choice = {
    key: field.key,
    type: 'select' as const,
    ...(field.label === undefined ? {} : { label: field.label }),
    ...(field.description === undefined ? {} : { description: field.description }),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(defaults && field.default !== undefined ? { default: field.default } : {}),
    // Each by its label where the administrator gave one (0129), else as its column spells it.
    options: states.map((state) => ({ value: state, label: moves.labels.find((entry) => entry.state === state)?.label ?? state })),
  }
  return { ...form, model: { ...form.model, fields: form.model.fields.map((candidate) => (candidate === field ? choice : candidate)) } }
}
