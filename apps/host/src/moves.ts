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
 * may go nowhere. A new record's choice starts at the field's default,
 * which the server serves only where it is a state a create of this
 * person's may start the record in (0149); a saved record's carries none,
 * since it opens at the state it holds, and a default its choice did not
 * offer would stop the engine opening it.
 *
 * Presentation only, as the rest of the host's copy is: the server checks
 * every move again (0112), and refuses the one a stale page still offers.
 */

/** `form` with the state field drawn as the moves `moves` names from `from`, the state the record holds, `null` for a new one; `form` itself where no field is held to moves. */
export function withMoves(form: FormSchema, moves: PublishedForm['moves'], from: string | null): FormSchema {
  if (moves === null) return form
  const field = form.model.fields.find((candidate) => candidate.key === moves.field)
  if (field === undefined) return form
  const to = moves.moves.filter((move) => move.from === from).map((move) => move.to)
  if (to.length === 0) return disableFields(form, [field.key])
  // A whole number's state keeps its number box: a choice answers text, which its codec would read as another value.
  if (field.type !== 'text') return form
  const states = from === null ? to : [from, ...to]
  const choice = {
    key: field.key,
    type: 'select' as const,
    ...(field.label === undefined ? {} : { label: field.label }),
    ...(field.description === undefined ? {} : { description: field.description }),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(from === null && field.default !== undefined ? { default: field.default } : {}),
    // Each by its label where the administrator gave one (0129), else as its column spells it.
    options: states.map((state) => ({ value: state, label: moves.labels.find((entry) => entry.state === state)?.label ?? state })),
  }
  return { ...form, model: { ...form.model, fields: form.model.fields.map((candidate) => (candidate === field ? choice : candidate)) } }
}
