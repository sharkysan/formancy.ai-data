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

/** `form` with `key` left out of its model, its layouts and its rules: a together row's field that names its record, which the save supplies. */
export function withoutField(form: FormSchema, key: string): FormSchema {
  type Node = NonNullable<FormSchema['layouts']>[number]['nodes'][number]
  const prune = (nodes: readonly Node[]): Node[] =>
    nodes.flatMap((node): Node[] => {
      if (node.kind === 'field') return node.path === key ? [] : [node]
      return 'children' in node ? [{ ...node, children: prune(node.children) }] : [node]
    })
  const rules = form.logic?.rules?.filter((rule) => rule.target !== key)
  return {
    ...form,
    model: { ...form.model, fields: form.model.fields.filter((field) => field.key !== key) },
    ...(form.layouts === undefined ? {} : { layouts: form.layouts.map((layout) => ({ ...layout, nodes: prune(layout.nodes) })) }),
    ...(form.logic === undefined ? {} : { logic: { ...form.logic, ...(rules === undefined ? {} : { rules }) } }),
  }
}

/**
 * `form` narrowed to `keys`: every other field left out by `withoutField`,
 * and a section, row or other container left with none of them dropped
 * with its heading, as nothing of it is drawn -- the fields a change of
 * chosen records sets, on paper (0176).
 */
export function onlyFields(form: FormSchema, keys: readonly string[]): FormSchema {
  type Node = NonNullable<FormSchema['layouts']>[number]['nodes'][number]
  const narrowed = form.model.fields.reduce((left, field) => (keys.includes(field.key) ? left : withoutField(left, field.key)), form)
  const held = (nodes: readonly Node[]): Node[] =>
    nodes.flatMap((node): Node[] => {
      if (node.kind === 'field') return [node]
      if (!('children' in node)) return []
      const children = held(node.children)
      return children.length === 0 ? [] : [{ ...node, children }]
    })
  if (narrowed.layouts === undefined) return narrowed
  return { ...narrowed, layouts: narrowed.layouts.map((layout) => ({ ...layout, nodes: held(layout.nodes) })) }
}
