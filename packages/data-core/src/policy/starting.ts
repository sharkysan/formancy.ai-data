import type { FieldDef, FormSchema } from '@formancy/spec'
import type { StateMoves } from '../runtime.js'

/** A move of a state field, as a policy and a person's moves both hold one: from a state, or from nothing on a create, to another. */
type Move = { from: string | null; to: string }

/** The states a create starts a record in (0112): each one a move from nothing reaches, in the moves' order. */
export function createStates(moves: readonly Move[]): string[] {
  const states: string[] = []
  for (const move of moves) if (move.from === null && !states.includes(move.to)) states.push(move.to)
  return states
}

/**
 * Whether a create may start the record at `value`: a state `createStates`
 * names, compared as the state is spelled -- a whole number by its digits,
 * and text or a number alone, as a state field holds no other. The one
 * reading of it: the form route serves a default by it (`startingDefaults`)
 * and a publish takes a starting value by it (`startingStateProblem`, 0150).
 */
export function startsAt(moves: readonly Move[], value: unknown): boolean {
  return (typeof value === 'string' || typeof value === 'number') && createStates(moves).includes(String(value))
}

/**
 * The published form as one person starts a new record with it (0149):
 * each field's `default`, its column's constant one, kept only where the
 * create would take it from them. A renderer submits every field it draws,
 * a disabled one too, and a page that leaves out only the fields neither
 * write accepts (0117) would send a default untouched -- refused as a
 * field this person may not give on create (0122), or as a move they may
 * not make -- where the field left empty was left out, and the create
 * stored the database's default.
 *
 * So a default is kept on a field `create` names -- `writableFields` for
 * the create, `null` where the person may not create, which keeps none --
 * and, on the state field `moves` holds (0127), only where one of this
 * person's moves from nothing starts a record in it, compared as the state
 * is spelled: a whole number's by its digits. Decided here once, and served
 * by `GET /v1/forms/:id`, so no page decides it again. The form is handed
 * back itself where nothing is dropped, and is never changed.
 */
export function startingDefaults(form: FormSchema, create: readonly string[] | null, moves: StateMoves | null): FormSchema {
  const given = new Set(create ?? [])
  const keeps = (field: FieldDef): boolean => {
    if (!given.has(field.key)) return false
    return moves === null || field.key !== moves.field || startsAt(moves.moves, field.default)
  }
  if (!form.model.fields.some((field) => field.default !== undefined && !keeps(field))) return form
  const fields = form.model.fields.map((field) => {
    if (field.default === undefined || keeps(field)) return field
    const { default: _, ...rest } = field
    return rest
  })
  return { ...form, model: { ...form.model, fields } }
}
