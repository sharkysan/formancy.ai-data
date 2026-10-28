import type { FormSchema } from '@formancy/spec'
import type { FormBindings } from '../generate/types.js'
import type { FieldAnchor, PresentationOverrides, PresentedForm, SectionAnchor } from './types.js'
import { fieldAnchor, PRESENTATION_VERSION } from './types.js'
import { copyOf, describeSection, hasKeys, isRecord, isText, readGeneratedLayout, same } from './layout.js'
import { homeOf, placements } from './placement.js'
import { viewShapeProblems } from './views.js'

function isAnchor(value: unknown): value is FieldAnchor {
  if (!isRecord(value)) return false
  if (value['kind'] === 'column') return hasKeys(value, ['kind', 'column']) && typeof value['column'] === 'string'
  if (value['kind'] === 'lookup') return hasKeys(value, ['kind', 'foreignKey']) && typeof value['foreignKey'] === 'string'
  return false
}

function isSectionAnchor(value: unknown): value is SectionAnchor {
  return (
    isRecord(value) &&
    hasKeys(value, ['label', 'occurrence']) &&
    typeof value['label'] === 'string' &&
    Number.isSafeInteger(value['occurrence']) &&
    (value['occurrence'] as number) >= 0
  )
}

const SECTION_ANCHOR = 'must be { label, occurrence } with a whole occurrence of at least 0'

function describeAnchor(anchor: FieldAnchor): string {
  return anchor.kind === 'column' ? `column ${anchor.column}` : `the lookup over ${anchor.foreignKey}`
}

function fieldShapeProblems(entry: unknown, at: string, seen: Set<string>): string[] {
  if (!isRecord(entry)) return [`${at} must be an object`]
  const problems: string[] = []
  for (const key of Object.keys(entry)) {
    if (!['field', 'anchor', 'label', 'span', 'section'].includes(key)) problems.push(`${at}/${key} is not a property of a field presentation`)
  }
  if (typeof entry['field'] !== 'string') problems.push(`${at}/field must be a field key`)
  else if (seen.has(entry['field'])) problems.push(`${at}: ${entry['field']} appears twice`)
  else seen.add(entry['field'])
  if (!isAnchor(entry['anchor'])) problems.push(`${at}/anchor must be { kind: column, column } or { kind: lookup, foreignKey }`)
  if ('label' in entry && !isText(entry['label'])) problems.push(`${at}/label must be text`)
  if ('span' in entry && entry['span'] !== 'all' && entry['span'] !== 'one') problems.push(`${at}/span must be 'all' or 'one'`)
  if ('section' in entry && !isSectionAnchor(entry['section'])) problems.push(`${at}/section ${SECTION_ANCHOR}`)
  return problems
}

function sectionShapeProblems(entry: unknown, at: string, seen: Set<string>): string[] {
  if (!isRecord(entry)) return [`${at} must be an object`]
  const problems: string[] = []
  for (const key of Object.keys(entry)) {
    if (!['anchor', 'label', 'order'].includes(key)) problems.push(`${at}/${key} is not a property of a section presentation`)
  }
  const anchor = entry['anchor']
  if (!isSectionAnchor(anchor)) problems.push(`${at}/anchor ${SECTION_ANCHOR}`)
  else {
    const key = JSON.stringify([anchor.label, anchor.occurrence])
    if (seen.has(key)) problems.push(`${at}: section "${anchor.label}" (${String(anchor.occurrence)}) appears twice`)
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
 * alone: version 1, only the known properties, no field or section named
 * twice, and list views shaped as `viewShapeProblems` reads them (0105).
 * Whether it fits a base is `applyPresentation`'s question, and whether its
 * views fit the bindings `viewProblems`'.
 */
export function presentationShapeProblems(value: unknown): string[] {
  if (!isRecord(value)) return ['a presentation is an object']
  const problems: string[] = []
  for (const key of Object.keys(value)) {
    if (!['version', 'fields', 'sections', 'views'].includes(key)) problems.push(`${key} is not a property of a presentation`)
  }
  if (Object.hasOwn(value, 'views')) problems.push(...viewShapeProblems(value['views']))
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
 * Refuses, rather than skipping, whatever the studio's edits could not have
 * produced from this base: a key it lacks or that has no binding, an anchor
 * other than the key's own, a section it does not have, a move that leaves a
 * section with no field, an order that is not the fields its section holds
 * after the moves, rearranged. And refuses an entry that says what the base
 * already says, or nothing, so a presentation has one spelling and two
 * stored files that mean the same thing are byte-equal.
 *
 * A moved field keeps its node, width included, and lands after its new
 * section's own fields (`placement.ts`); an order then rearranges each
 * section.
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
  /** Each moved key: the section it moved to, and the entry that says so. */
  const moves = new Map<string, { to: number; at: string }>()

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
    if (entry.label === undefined && entry.span === undefined && entry.section === undefined) problems.push(`${at}: says nothing; leave the field out`)
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
    if (entry.section !== undefined) {
      const target = layout.sections.findIndex((section) => same(section.anchor, entry.section))
      if (target < 0) problems.push(`${at}/section: the base has no section labelled "${entry.section.label}" at occurrence ${String(entry.section.occurrence)}`)
      else if (target === homeOf(layout.sections, entry.field)) problems.push(`${at}/section: equals the base's; leave it out`)
      else moves.set(entry.field, { to: target, at })
    }
  }

  // Where every field sits once the moves are made; none may leave a section empty.
  const placed = placements(layout.sections, new Map([...moves].map(([key, move]) => [key, move.to])), order)
  for (const [index, keys] of placed.entries()) {
    const generated = layout.sections[index]
    if (keys.length > 0 || generated === undefined) continue
    const last = [...moves].filter(([key]) => generated.keys.includes(key)).at(-1)
    if (last !== undefined) problems.push(`${last[1].at}/section: moving ${last[0]} leaves section ${describeSection(generated.anchor)} with no field`)
  }
  for (const [index, keys] of placed.entries()) (nodes[index]?.children[0] as { children: Node[] }).children = keys.map((key) => nodeOf.get(key) as Node)

  previous = -1
  for (const [index, entry] of presentation.sections.entries()) {
    const at = `/sections/${String(index)}`
    const position = layout.sections.findIndex((section) => same(section.anchor, entry.anchor))
    const keys = placed[position]
    const node = nodes[position]
    if (keys === undefined || node === undefined) {
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
      const permutation = entry.order.length === keys.length && entry.order.every((key) => keys.includes(key))
      if (!permutation) problems.push(`${at}/order: not an order of that section's fields (${keys.join(', ')})`)
      else if (same(entry.order, keys)) problems.push(`${at}/order: equals the base's; leave it out`)
      else (node.children[0] as { children: Node[] }).children = entry.order.map((key) => nodeOf.get(key) as Node)
    }
  }

  return problems.length === 0 ? { ok: true, form } : { ok: false, problems: [...new Set(problems)] }
}
