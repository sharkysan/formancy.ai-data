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
