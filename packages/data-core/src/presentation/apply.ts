import type { FormSchema } from '@formancy/spec'
import type { FormBindings } from '../generate/types.js'
import type { FieldAnchor, PresentationOverrides, PresentedForm } from './types.js'
import { fieldAnchor, PRESENTATION_VERSION } from './types.js'
import { copyOf, hasKeys, isRecord, isText, readGeneratedLayout, same } from './layout.js'

function isAnchor(value: unknown): value is FieldAnchor {
  if (!isRecord(value)) return false
  if (value['kind'] === 'column') return hasKeys(value, ['kind', 'column']) && typeof value['column'] === 'string'
  if (value['kind'] === 'lookup') return hasKeys(value, ['kind', 'foreignKey']) && typeof value['foreignKey'] === 'string'
  return false
}

function describeAnchor(anchor: FieldAnchor): string {
  return anchor.kind === 'column' ? `column ${anchor.column}` : `the lookup over ${anchor.foreignKey}`
}

function fieldShapeProblems(entry: unknown, at: string, seen: Set<string>): string[] {
  if (!isRecord(entry)) return [`${at} must be an object`]
  const problems: string[] = []
  for (const key of Object.keys(entry)) {
    if (!['field', 'anchor', 'label', 'span'].includes(key)) problems.push(`${at}/${key} is not a property of a field presentation`)
  }
  if (typeof entry['field'] !== 'string') problems.push(`${at}/field must be a field key`)
  else if (seen.has(entry['field'])) problems.push(`${at}: ${entry['field']} appears twice`)
  else seen.add(entry['field'])
  if (!isAnchor(entry['anchor'])) problems.push(`${at}/anchor must be { kind: column, column } or { kind: lookup, foreignKey }`)
  if ('label' in entry && !isText(entry['label'])) problems.push(`${at}/label must be text`)
  if ('span' in entry && entry['span'] !== 'all' && entry['span'] !== 'one') problems.push(`${at}/span must be 'all' or 'one'`)
  return problems
}

function sectionShapeProblems(entry: unknown, at: string, seen: Set<string>): string[] {
  if (!isRecord(entry)) return [`${at} must be an object`]
  const problems: string[] = []
  for (const key of Object.keys(entry)) {
    if (!['anchor', 'label', 'order'].includes(key)) problems.push(`${at}/${key} is not a property of a section presentation`)
  }
  const anchor = entry['anchor']
  if (
    !isRecord(anchor) ||
    !hasKeys(anchor, ['label', 'occurrence']) ||
    typeof anchor['label'] !== 'string' ||
    !Number.isSafeInteger(anchor['occurrence']) ||
    (anchor['occurrence'] as number) < 0
  ) {
    problems.push(`${at}/anchor must be { label, occurrence } with a whole occurrence of at least 0`)
  } else {
    const key = JSON.stringify([anchor['label'], anchor['occurrence']])
    if (seen.has(key)) problems.push(`${at}: section "${anchor['label']}" (${String(anchor['occurrence'])}) appears twice`)
    seen.add(key)
  }
  if ('label' in entry && !isText(entry['label'])) problems.push(`${at}/label must be text`)
  if ('order' in entry) {
    const order = entry['order']
    if (!Array.isArray(order) || !order.every((key) => typeof key === 'string')) problems.push(`${at}/order must be field keys`)
    else {
      const keys = new Set<string>()
      for (const key of order as string[]) {
        if (keys.has(key)) problems.push(`${at}/order: ${key} appears twice`)
        keys.add(key)
      }
    }
  }
  return problems
}

/**
 * Every reason a value is not a presentation this release reads, by shape
 * alone: version 1, only the known properties, and no field or section named
 * twice. Whether it fits a base is `applyPresentation`'s question.
 */
export function presentationShapeProblems(value: unknown): string[] {
  if (!isRecord(value)) return ['a presentation is an object']
  const problems: string[] = []
  for (const key of Object.keys(value)) {
    if (!['version', 'fields', 'sections'].includes(key)) problems.push(`${key} is not a property of a presentation`)
  }
  if (value['version'] !== PRESENTATION_VERSION) problems.push(`version must be ${String(PRESENTATION_VERSION)}`)
  const fields = value['fields']
  const sections = value['sections']
  if (!Array.isArray(fields)) problems.push('fields must be a list')
  else {
    const seen = new Set<string>()
    for (const [index, entry] of fields.entries()) problems.push(...fieldShapeProblems(entry, `/fields/${String(index)}`, seen))
  }
  if (!Array.isArray(sections)) problems.push('sections must be a list')
  else {
    const seen = new Set<string>()
    for (const [index, entry] of sections.entries()) problems.push(...sectionShapeProblems(entry, `/sections/${String(index)}`, seen))
  }
  return problems
}

type Node = { kind: 'field'; path: string; span?: 'all' }
type Section = { label: unknown; children: Array<{ children: Node[] }> }

/**
 * The base with a presentation applied, or every reason it does not apply.
 *
 * Refuses, rather than skipping, whatever the four edits could not have
 * produced from this base: a key it lacks or that has no binding, an anchor
 * other than the key's own, a section it does not have, an order that is not
 * that section's fields rearranged. And refuses an entry that says what the
 * base already says, or nothing, so a presentation has one spelling and two
 * stored files that mean the same thing are byte-equal.
 */
export function applyPresentation(base: FormSchema, presentation: PresentationOverrides, bindings: FormBindings): PresentedForm {
  const shape = presentationShapeProblems(presentation)
  if (shape.length > 0) return { ok: false, problems: shape }
  const layout = readGeneratedLayout(base)
  if (!layout.ok) return { ok: false, problems: [layout.problem] }

  const problems: string[] = []
  const form = copyOf(base)
  const nodes = (form.layouts?.[0]?.nodes ?? []) as unknown as Section[]
  const nodeOf = new Map<string, Node>()
  for (const section of nodes) for (const node of section.children[0]?.children ?? []) nodeOf.set(node.path, node)
  const order = form.model.fields.map((field) => field.key)
  const binding = new Map(bindings.fields.map((entry) => [entry.field, entry]))

  let previous = -1
  for (const [index, entry] of presentation.fields.entries()) {
    const at = `/fields/${String(index)}`
    const position = order.indexOf(entry.field)
    const field = form.model.fields[position]
    const bound = binding.get(entry.field)
    if (field === undefined) {
      problems.push(`${at}/field: the base has no field ${entry.field}`)
      continue
    }
    if (position < previous) problems.push("/fields: not in the base's field order")
    previous = position
    if (bound === undefined) {
      problems.push(`${at}/field: ${entry.field} has no binding`)
      continue
    }
    const own = fieldAnchor(bound)
    if (!same(entry.anchor, own)) problems.push(`${at}/anchor: ${entry.field} stands for ${describeAnchor(own)}, not ${describeAnchor(entry.anchor)}`)
    if (entry.label === undefined && entry.span === undefined) problems.push(`${at}: says nothing; leave the field out`)
    if (entry.label !== undefined) {
      if (same(entry.label, field.label)) problems.push(`${at}/label: equals the base's; leave it out`)
      else field.label = entry.label
    }
    if (entry.span !== undefined) {
      const node = nodeOf.get(entry.field) as Node
      if ((entry.span === 'all') === (node.span === 'all')) problems.push(`${at}/span: equals the base's; leave it out`)
      else if (entry.span === 'all') node.span = 'all'
      else delete node.span
    }
  }

  previous = -1
  for (const [index, entry] of presentation.sections.entries()) {
    const at = `/sections/${String(index)}`
    const position = layout.sections.findIndex((section) => same(section.anchor, entry.anchor))
    const generated = layout.sections[position]
    const node = nodes[position]
    if (generated === undefined || node === undefined) {
      problems.push(`${at}/anchor: the base has no section labelled "${entry.anchor.label}" at occurrence ${String(entry.anchor.occurrence)}`)
      continue
    }
    if (position < previous) problems.push("/sections: not in the base's section order")
    previous = position
    if (entry.label === undefined && entry.order === undefined) problems.push(`${at}: says nothing; leave the section out`)
    if (entry.label !== undefined) {
      if (same(entry.label, node.label)) problems.push(`${at}/label: equals the base's; leave it out`)
      else node.label = entry.label
    }
    if (entry.order !== undefined) {
      const permutation = entry.order.length === generated.keys.length && entry.order.every((key) => generated.keys.includes(key))
      if (!permutation) problems.push(`${at}/order: not an order of that section's fields (${generated.keys.join(', ')})`)
      else if (same(entry.order, generated.keys)) problems.push(`${at}/order: equals the base's; leave it out`)
      else (node.children[0] as { children: Node[] }).children = entry.order.map((key) => nodeOf.get(key) as Node)
    }
  }

  return problems.length === 0 ? { ok: true, form } : { ok: false, problems: [...new Set(problems)] }
}
