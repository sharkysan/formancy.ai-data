import type { FormSchema, Text } from '@formancy/spec'
import type { FormBindings } from '../generate/types.js'
import { applyPresentation } from './apply.js'
import type { GeneratedSection } from './layout.js'
import { copyOf, hasKeys, isRecord, isText, readGeneratedLayout, same } from './layout.js'
import { placements } from './placement.js'
import type { FieldPresentation, PresentationCheck, PresentationOverrides, SectionPresentation } from './types.js'
import { fieldAnchor, PRESENTATION_VERSION } from './types.js'

/** What the edited form changed that is presentation, gathered before it is anchored. */
interface Edits {
  labels: Map<string, Text>
  spans: Map<string, 'all' | 'one'>
  sections: Map<number, { label?: Text; order?: string[] }>
  /** Each key the edited form places in another generated section than its own: the index of that section. */
  moves: Map<string, number>
}

/** Where the edited grids put the base's fields, as they are read. */
interface Reading {
  /** Each generated section's own index, for every key the base places. */
  home: ReadonlyMap<string, number>
  /** The keys placed so far, in any section. */
  seen: Set<string>
}

const NOT_PRESENTATION = "changed, and only labels, order, a field's section and full width are presentation"

/** Every top-level property but the model and the layouts: the document's, never the presentation's. */
function documentProblems(base: Record<string, unknown>, edited: Record<string, unknown>, problems: string[]): void {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(edited)])].filter((key) => key !== 'model' && key !== 'layouts')
  for (const key of keys) if (!same(base[key], edited[key])) problems.push(`/${key}: ${NOT_PRESENTATION}`)
}

/** The same fields, in the same model order, each changed in its label at most. */
function fieldProblems(base: FormSchema, edited: Record<string, unknown>, edits: Edits, problems: string[]): void {
  const model = edited['model']
  if (!isRecord(model) || !Array.isArray(model['fields'])) {
    problems.push('/model: the edited form has no fields')
    return
  }
  for (const key of new Set([...Object.keys(base.model), ...Object.keys(model)])) {
    if (key !== 'fields' && !same((base.model as unknown as Record<string, unknown>)[key], model[key])) problems.push(`/model/${key}: ${NOT_PRESENTATION}`)
  }
  const fields = model['fields'] as unknown[]
  const before = base.model.fields.map((field) => field.key)
  const after = fields.map((field) => (isRecord(field) ? field['key'] : undefined))
  if (!same(before, after)) {
    const known = problems.length
    for (const key of before) if (!after.includes(key)) problems.push(`/model/fields: ${key} was removed`)
    for (const [index, key] of after.entries()) if (!before.includes(key as string)) problems.push(`/model/fields/${String(index)}: ${String(key)} is not a field of the base`)
    if (problems.length === known) problems.push('/model/fields: the fields are in another order, and the model order is not presentation')
    return
  }
  for (const [index, original] of base.model.fields.entries()) {
    const at = `/model/fields/${String(index)}`
    const field = fields[index] as Record<string, unknown>
    const was = original as unknown as Record<string, unknown>
    const properties = [...new Set([...Object.keys(was), ...Object.keys(field)])].filter((key) => key !== 'label').sort()
    for (const key of properties) if (!same(was[key], field[key])) problems.push(`${at}/${key}: changed, and only a field's label is presentation`)
    if (field['label'] === undefined) {
      if (was['label'] !== undefined) problems.push(`${at}/label: a label may change, not be removed`)
    } else if (!isText(field['label'])) problems.push(`${at}/label: not text`)
    else if (!same(was['label'], field['label'])) edits.labels.set(original.key, field['label'])
  }
}

/**
 * One edited section against its generated self: its label, and the keys its
 * grid places in the edited order, each a base field placed nowhere else, or
 * `undefined` when the section is not one this release reads. A key from
 * another section is a move (0075), recorded by the caller once every
 * section is read; a span is compared with the key's own generated width.
 */
function sectionKeys(sections: readonly GeneratedSection[], node: unknown, at: string, index: number, reading: Reading, edits: Edits, problems: string[]): string[] | undefined {
  const generated = sections[index] as GeneratedSection
  if (!isRecord(node) || node['kind'] !== 'section' || !hasKeys(node, ['kind', 'label', 'children'])) {
    problems.push(`${at}: a section may change its label, and is otherwise the generated one`)
    return undefined
  }
  if (!isText(node['label'])) problems.push(`${at}/label: not text`)
  else if (!same(node['label'], generated.anchor.label)) edits.sections.set(index, { label: node['label'] })
  const children = node['children']
  const grid: unknown = Array.isArray(children) && children.length === 1 ? children[0] : undefined
  if (!isRecord(grid) || grid['kind'] !== 'table' || !hasKeys(grid, ['kind', 'columns', 'children']) || !Array.isArray(grid['children'])) {
    problems.push(`${at}/children: a section holds the one grid it was generated with`)
    return undefined
  }
  if (grid['columns'] !== 2) problems.push(`${at}/children/0/columns: ${NOT_PRESENTATION}`)
  const keys: string[] = []
  for (const [position, child] of (grid['children'] as unknown[]).entries()) {
    const where = `${at}/children/0/children/${String(position)}`
    if (!isRecord(child) || child['kind'] !== 'field' || !hasKeys(child, ['kind', 'path'], ['span']) || typeof child['path'] !== 'string') {
      problems.push(`${where}: a grid holds the fields it was generated with, and nothing else`)
      continue
    }
    const key = child['path']
    if (typeof child['span'] === 'number') problems.push(`${where}/span: a numeric span is not presentation; full width is 'all'`)
    else if (child['span'] !== undefined && child['span'] !== 'all') problems.push(`${where}/span: full width is 'all'`)
    const home = reading.home.get(key)
    if (reading.seen.has(key)) problems.push(`${where}/path: ${key} is placed twice`)
    else if (home === undefined) problems.push(`${where}/path: ${key} is not a field of the base`)
    else {
      reading.seen.add(key)
      keys.push(key)
      const wide = child['span'] === 'all'
      if (wide !== (sections[home] as GeneratedSection).wide.has(key)) edits.spans.set(key, wide ? 'all' : 'one')
    }
  }
  return keys
}

/**
 * The same layout, its sections the generated ones in the generated order,
 * every base field placed once and every section holding one at least. What
 * moved, and each section's order against where the moves leave its fields
 * (`placement.ts`), is recorded once every section is read.
 */
function layoutProblems(base: FormSchema, sections: readonly GeneratedSection[], edited: Record<string, unknown>, edits: Edits, problems: string[]): void {
  const layouts = edited['layouts']
  if (!Array.isArray(layouts) || layouts.length !== 1 || !isRecord(layouts[0])) {
    problems.push('/layouts: the form keeps the one layout it was generated with')
    return
  }
  const layout = layouts[0]
  if (!hasKeys(layout, ['name', 'nodes'])) problems.push(`/layouts/0: ${NOT_PRESENTATION}`)
  if (!same(layout['name'], base.layouts?.[0]?.name)) problems.push(`/layouts/0/name: ${NOT_PRESENTATION}`)
  const nodes = layout['nodes']
  if (!Array.isArray(nodes) || nodes.length !== sections.length) {
    problems.push('/layouts/0/nodes: a section was added or removed')
    return
  }
  const known = problems.length
  const home = new Map(sections.flatMap((section, index) => section.keys.map((key) => [key, index] as const)))
  const reading: Reading = { home, seen: new Set() }
  const grid = (index: number) => `/layouts/0/nodes/${String(index)}/children/0/children`
  const placed = sections.map((_, index) => sectionKeys(sections, nodes[index], `/layouts/0/nodes/${String(index)}`, index, reading, edits, problems))
  for (const [key, index] of home) if (placed[index] !== undefined && !reading.seen.has(key)) problems.push(`${grid(index)}: ${key} is missing`)
  for (const [index, keys] of placed.entries()) if (keys?.length === 0) problems.push(`${grid(index)}: a section keeps at least one field`)
  if (problems.length > known) return

  for (const [index, keys] of placed.entries()) for (const key of keys ?? []) if (home.get(key) !== index) edits.moves.set(key, index)
  const expected = placements(sections, edits.moves, base.model.fields.map((field) => field.key))
  for (const [index, keys] of placed.entries()) {
    if (keys === undefined || same(keys, expected[index])) continue
    edits.sections.set(index, { ...edits.sections.get(index), order: keys })
  }
}

/**
 * The presentation an edited form holds over its generated base, or every
 * difference that is not presentation, each named by its JSON path.
 *
 * Presentation is exactly the studio's edits: a field's label, a section's
 * label, a field's place within its section's grid and full width (0030),
 * and the generated section a field is placed in (0075). Everything else is
 * refused, including what builder-core accepts -- a numeric span, a section
 * added or emptied, help text, translations, `required`, a title -- because
 * a regeneration could not carry it, or would carry a database fact a person
 * overrode.
 *
 * Ends by applying what it derived and comparing the result with the edited
 * form, so a derive that lost something fails here and not on the next read.
 */
export function presentationOf(base: FormSchema, edited: FormSchema, bindings: FormBindings): PresentationCheck {
  const layout = readGeneratedLayout(base)
  if (!layout.ok) return { ok: false, problems: [layout.problem] }
  // Plain data, as it would be stored: an `undefined` property is no property.
  const document: unknown = copyOf(edited)
  if (!isRecord(document)) return { ok: false, problems: ['/: the edited form is not an object'] }

  const problems: string[] = []
  const edits: Edits = { labels: new Map(), spans: new Map(), sections: new Map(), moves: new Map() }
  documentProblems(base as unknown as Record<string, unknown>, document, problems)
  fieldProblems(base, document, edits, problems)
  layoutProblems(base, layout.sections, document, edits, problems)
  if (problems.length > 0) return { ok: false, problems }

  const binding = new Map(bindings.fields.map((entry) => [entry.field, entry]))
  const fields: FieldPresentation[] = []
  for (const [index, field] of base.model.fields.entries()) {
    const label = edits.labels.get(field.key)
    const span = edits.spans.get(field.key)
    const moved = edits.moves.get(field.key)
    const section = moved === undefined ? undefined : layout.sections[moved]?.anchor
    if (label === undefined && span === undefined && section === undefined) continue
    const bound = binding.get(field.key)
    if (bound === undefined) {
      problems.push(`/model/fields/${String(index)}: ${field.key} has no binding, so nothing anchors its presentation`)
      continue
    }
    fields.push({
      field: field.key,
      anchor: fieldAnchor(bound),
      ...(label === undefined ? {} : { label }),
      ...(span === undefined ? {} : { span }),
      ...(section === undefined ? {} : { section: { ...section } }),
    })
  }
  const sections: SectionPresentation[] = []
  for (const [index, generated] of layout.sections.entries()) {
    const entry = edits.sections.get(index)
    if (entry !== undefined) sections.push({ anchor: { ...generated.anchor }, ...entry })
  }
  if (problems.length > 0) return { ok: false, problems }

  const presentation: PresentationOverrides = { version: PRESENTATION_VERSION, fields, sections }
  const applied = applyPresentation(base, presentation, bindings)
  if (!applied.ok) return applied
  if (!same(applied.form, document)) return { ok: false, problems: ['the edited form differs from the base in a way its presentation does not record'] }
  return { ok: true, presentation }
}
