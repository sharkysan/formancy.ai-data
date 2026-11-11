import type { FormSchema } from '@formancy/spec'
import type { PublishedForm } from '@formancy/data-client'
import { disableFields, withoutDefaults } from './widgets.js'

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
 * may go nowhere. The field's default, its column's constant one (0149),
 * is kept only where it is a state the choice offers: on a new record, one
 * a create may start it in. Any other would be sent and refused as a move.
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
  if (to.length === 0) return withoutDefaults(disableFields(form, [field.key]), [field.key])
  const states = from === null ? to : [from, ...to]
  // A whole number's default is spelled as a state is: its digits.
  const kept = field.default !== undefined && states.includes(String(field.default))
  // A whole number's state keeps its number box: a choice answers text, which its codec would read as another value.
  if (field.type !== 'text') return kept ? form : withoutDefaults(form, [field.key])
  const choice = {
    key: field.key,
    type: 'select' as const,
    ...(field.label === undefined ? {} : { label: field.label }),
    ...(field.description === undefined ? {} : { description: field.description }),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(kept ? { default: field.default } : {}),
    // Each by its label where the administrator gave one (0129), else as its column spells it.
    options: states.map((state) => ({ value: state, label: moves.labels.find((entry) => entry.state === state)?.label ?? state })),
  }
  return { ...form, model: { ...form.model, fields: form.model.fields.map((candidate) => (candidate === field ? choice : candidate)) } }
}
