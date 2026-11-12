import type { FieldDef, FormSchema } from '@formancy/spec'
import type { StateMoves } from '../runtime.js'

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
  const starts = new Set((moves?.moves ?? []).filter((move) => move.from === null).map((move) => move.to))
  const keeps = (field: FieldDef): boolean => {
    if (!given.has(field.key)) return false
    if (moves === null || field.key !== moves.field) return true
    const value = field.default
    return (typeof value === 'string' || typeof value === 'number') && starts.has(String(value))
  }
  if (!form.model.fields.some((field) => field.default !== undefined && !keeps(field))) return form
  const fields = form.model.fields.map((field) => {
    if (field.default === undefined || keeps(field)) return field
    const { default: _, ...rest } = field
    return rest
  })
  return { ...form, model: { ...form.model, fields } }
}
