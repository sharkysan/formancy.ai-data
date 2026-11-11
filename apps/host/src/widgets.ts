import type { FormSchema } from '@formancy/spec'

/**
 * The host's copy of `form` with `keys` drawn disabled: a `disabled` rule
 * for each, as the generator writes one for a field nothing may write.
 * Presentation only -- both renderers still submit a disabled field (0029),
 * and the server decides what is written. A field already disabled by its
 * own rule keeps it; the published form is left as it was.
 */
export function disableFields(form: FormSchema, keys: readonly string[]): FormSchema {
  const rules = form.logic?.rules ?? []
  const already = new Set(rules.filter((rule) => rule.kind === 'disabled' && rule.cel === 'true').map((rule) => rule.target))
  const added = keys.filter((key) => !already.has(key)).map((key) => ({ target: key, kind: 'disabled' as const, cel: 'true' }))
  if (added.length === 0) return form
  return { ...form, logic: { ...form.logic, rules: [...rules, ...added] } }
}

/**
 * The host's copy of `form` with `keys` starting empty: each one's
 * `default`, its column's constant one (0149), left out. For a field this
 * person does not give on create, which a renderer still submits: a
 * default there would be sent, and refused as a field this person may not
 * write, or as a move they may not make; left empty, it is left out of the
 * create, and the database fills its default as before. The published
 * form is left as it was.
 */
export function withoutDefaults(form: FormSchema, keys: readonly string[]): FormSchema {
  const dropped = new Set(keys)
  if (!form.model.fields.some((field) => field.default !== undefined && dropped.has(field.key))) return form
  const fields = form.model.fields.map((field) => {
    if (field.default === undefined || !dropped.has(field.key)) return field
    const { default: _, ...rest } = field
    return rest
  })
  return { ...form, model: { ...form.model, fields } }
}
