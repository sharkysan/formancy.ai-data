import type { FormSchema, Text } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
import type { SectionAnchor } from './types.js'

/*
 * The generated layout's shape, read and nothing else (0030). `generate.ts`'s
 * `layoutFor` always writes the same thing: one layout called `default`, up
 * to two sections — the main one labelled after the root, the system one
 * `Record` — each holding one two-column table of field nodes, with
 * `span: 'all'` for a textarea. Presentation is defined over exactly that,
 * so a base of any other shape is refused rather than read by guesswork.
 */

/** One generated section, as the person's edits address it. */
export interface GeneratedSection {
  anchor: SectionAnchor
  /** The keys its grid places, in the base's order. */
  keys: string[]
  /** Those of them that span the grid's row. */
  wide: Set<string>
}

export type LayoutReading = { ok: true; sections: GeneratedSection[] } | { ok: false; problem: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Text a person reads: a literal, or a reference into the message catalogue. */
export function isText(value: unknown): value is Text {
  return typeof value === 'string' || (isRecord(value) && Object.keys(value).length === 1 && typeof value['$t'] === 'string')
}

/** Canonical equality, as `records/prepare.ts` compares; `undefined` is equal only to itself. */
export function same(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right
  try {
    return canonicalize(left) === canonicalize(right)
  } catch {
    return false
  }
}

/** Whether a record has the required keys and no others but the optional ones. */
export function hasKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value)
  return required.every((key) => key in value) && keys.every((key) => required.includes(key) || optional.includes(key))
}

/** A copy that shares nothing with its source; the lib is ES2023, with no `structuredClone`. */
export function copyOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** How a person reads a section anchor in a message. */
export function describeSection(anchor: SectionAnchor): string {
  return anchor.occurrence === 0 ? `"${anchor.label}"` : `"${anchor.label}" (occurrence ${String(anchor.occurrence)})`
}

/** How a person reads a label in a message. */
export function describeText(text: Text): string {
  return typeof text === 'string' ? `"${text}"` : `message ${text.$t}`
}

/**
 * The sections of a form this release generated, with their anchors, or the
 * JSON path of the first thing that is not the generated shape.
 *
 * Every model field is placed exactly once: the generator places each, and an
 * order or a span over a field placed twice or not at all has no meaning.
 */
export function readGeneratedLayout(form: FormSchema): LayoutReading {
  const refused = (path: string): LayoutReading => ({ ok: false, problem: `a base this release did not generate (${path})` })
  const layouts: unknown = form.layouts
  if (!Array.isArray(layouts) || layouts.length !== 1) return refused('/layouts')
  const layout: unknown = layouts[0]
  if (!isRecord(layout) || !hasKeys(layout, ['name', 'nodes']) || layout['name'] !== 'default' || !Array.isArray(layout['nodes'])) return refused('/layouts/0')

  const sections: GeneratedSection[] = []
  const seen = new Map<string, number>()
  const placed = new Set<string>()
  for (const [index, node] of (layout['nodes'] as unknown[]).entries()) {
    const at = `/layouts/0/nodes/${String(index)}`
    if (!isRecord(node) || !hasKeys(node, ['kind', 'label', 'children']) || node['kind'] !== 'section' || typeof node['label'] !== 'string') return refused(at)
    const children = node['children']
    if (!Array.isArray(children) || children.length !== 1) return refused(`${at}/children`)
    const grid: unknown = children[0]
    if (!isRecord(grid) || !hasKeys(grid, ['kind', 'columns', 'children']) || grid['kind'] !== 'table' || grid['columns'] !== 2 || !Array.isArray(grid['children'])) {
      return refused(`${at}/children/0`)
    }
    const keys: string[] = []
    const wide = new Set<string>()
    for (const [position, child] of (grid['children'] as unknown[]).entries()) {
      const where = `${at}/children/0/children/${String(position)}`
      if (!isRecord(child) || !hasKeys(child, ['kind', 'path'], ['span']) || child['kind'] !== 'field' || typeof child['path'] !== 'string') return refused(where)
      if (child['span'] !== undefined && child['span'] !== 'all') return refused(where)
      if (placed.has(child['path'])) return refused(where)
      placed.add(child['path'])
      keys.push(child['path'])
      if (child['span'] === 'all') wide.add(child['path'])
    }
    const label = node['label']
    const occurrence = seen.get(label) ?? 0
    seen.set(label, occurrence + 1)
    sections.push({ anchor: { label, occurrence }, keys, wide })
  }
  const fields = Array.isArray(form.model?.fields) ? form.model.fields : []
  if (fields.length !== placed.size || fields.some((field) => !placed.has(field.key))) return refused('/layouts/0/nodes')
  return { ok: true, sections }
}
