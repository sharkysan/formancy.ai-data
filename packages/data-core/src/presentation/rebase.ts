import type { FormSchema, Text } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
import type { FormBindings } from '../generate/types.js'
import type { FormPolicy } from '../policy/types.js'
import { applyPresentation } from './apply.js'
import type { GeneratedSection } from './layout.js'
import { describeSection, describeText, readGeneratedLayout, same } from './layout.js'
import type { FieldAnchor, FieldPresentation, PresentationConflict, PresentationOverrides, ReassignedKey, RebasedPresentation, SectionAnchor, SectionPresentation } from './types.js'
import { fieldAnchor, PRESENTATION_VERSION } from './types.js'

interface Published {
  base: FormSchema
  presentation: PresentationOverrides
  bindings: FormBindings
}

interface Regenerated {
  base: FormSchema
  bindings: FormBindings
}

/**
 * Where a conflict sorts within its subject: what the field now is first,
 * then label, span and order, as the presentation's own properties run.
 */
const RANK: Record<PresentationConflict['kind'], number> = { 'field-rekeyed': 0, 'both-changed': 1, 'field-gone': 1, 'moved-section': 3, 'section-gone': 1 }

/** A conflict with where it sorts: field subjects in old-base field order, then sections in old-base order. */
interface Ranked {
  subject: number
  rank: number
  conflict: PresentationConflict
}

function describeAnchor(anchor: FieldAnchor): string {
  return anchor.kind === 'column' ? `column ${anchor.column}` : `the lookup over ${anchor.foreignKey}`
}

/** The field each anchor names, in one set of bindings. */
function keysByAnchor(bindings: FormBindings): Map<string, string> {
  return new Map(bindings.fields.map((binding) => [canonicalize(fieldAnchor(binding)), binding.field]))
}

function sectionOf(sections: readonly GeneratedSection[], key: string): GeneratedSection | undefined {
  return sections.find((section) => section.keys.includes(key))
}

/**
 * Labels whose sections the two bases cannot be matched by. Occurrence tells
 * same-labelled sections apart only while their number holds: a root whose
 * own label is `Record` has a main and a system section both labelled
 * Record, and when either comes or goes the occurrences shift, so the one
 * left could be either. Neither the form nor the bindings record which
 * section a field's column put it in, so the rebase does not guess.
 */
function ambiguousLabels(before: readonly GeneratedSection[], after: readonly GeneratedSection[]): Set<string> {
  const count = (sections: readonly GeneratedSection[], label: string) => sections.filter((section) => section.anchor.label === label).length
  const labels = new Set(before.map((section) => section.anchor.label))
  return new Set([...labels].filter((label) => {
    const was = count(before, label)
    const now = count(after, label)
    return was !== now && Math.min(was, now) > 0 && Math.max(was, now) > 1
  }))
}

/**
 * The person's order carried to a new section: their keys that are still
 * there, in their order; then each key new to the section, in the new base's
 * order, after its nearest preceding key in the new base that is already
 * placed, or first when none is.
 */
function carryOrder(mine: readonly string[], section: GeneratedSection): string[] {
  const placed = mine.filter((key) => section.keys.includes(key))
  for (const [index, key] of section.keys.entries()) {
    if (placed.includes(key)) continue
    const before = section.keys.slice(0, index).reverse().find((candidate) => placed.includes(candidate))
    placed.splice(before === undefined ? 0 : placed.indexOf(before) + 1, 0, key)
  }
  return placed
}

/**
 * A presentation chosen over one generated base, carried to the next, with
 * every place it could not be carried as it was (0030).
 *
 * Fields are followed by what they stand for — a column, or a lookup's
 * foreign key — never by key, because keys renumber when a colliding column
 * comes or goes. Sections are followed by the label the generator wrote and
 * which of the sections with that label they are. The rules:
 *
 * - a field whose anchor is gone takes its label and span with it
 *   (`field-gone`); in an order it is simply left out, because drift already
 *   reports the drop;
 * - a field under another key keeps its overrides under the new one
 *   (`field-rekeyed`), when the presentation names it;
 * - a label the generator also changed keeps the person's (`both-changed`);
 *   one the generator now writes itself is no longer an override, and goes;
 * - a span is re-expressed against the new base, and goes when it agrees;
 * - an order keeps the person's sequence, sends a field now in another
 *   section where the generator put it (`moved-section`), and places each
 *   new field after its generated predecessor;
 * - a section the new base does not have takes its overrides with it
 *   (`section-gone`), and so does one of two sections sharing a label when
 *   their number changed, because occurrence no longer says which is which;
 *   no field is said to move between sections that cannot be told apart.
 *
 * Pure and deterministic. It throws when the published presentation does
 * not apply to its own base, or the merged one to the new base: both are
 * impossible for what the server stored and generated.
 */
export function rebasePresentation(published: Published, regenerated: Regenerated): RebasedPresentation {
  const check = applyPresentation(published.base, published.presentation, published.bindings)
  if (!check.ok) throw new Error(`the published presentation does not apply to its base: ${check.problems.join('; ')}`)
  const before = readGeneratedLayout(published.base)
  const after = readGeneratedLayout(regenerated.base)
  if (!before.ok || !after.ok) throw new Error(`a base this release did not generate: ${before.ok ? '' : before.problem}${after.ok ? '' : after.problem}`)
  const unmatched = ambiguousLabels(before.sections, after.sections)
  const told = (anchor: SectionAnchor) => !unmatched.has(anchor.label)

  const anchorOf = new Map(published.bindings.fields.map((binding) => [binding.field, fieldAnchor(binding)]))
  const newKeys = keysByAnchor(regenerated.bindings)
  const follow = (key: string): string | undefined => newKeys.get(canonicalize(anchorOf.get(key)))
  const oldFields = published.base.model.fields
  const newFields = regenerated.base.model.fields
  const subjectOf = (key: string) => oldFields.findIndex((field) => field.key === key)
  const conflicts: Ranked[] = []
  const add = (subject: number, conflict: PresentationConflict) => conflicts.push({ subject, rank: RANK[conflict.kind], conflict })

  const mine = new Map(published.presentation.fields.map((entry) => [entry.field, entry]))
  const ordered = new Map<string, SectionPresentation>()
  for (const entry of published.presentation.sections) ordered.set(canonicalize(entry.anchor), entry)
  const hasOrder = (section: GeneratedSection | undefined) => section !== undefined && ordered.get(canonicalize(section.anchor))?.order !== undefined

  // What each field the presentation names now is: under another key, or in another section.
  for (const [subject, field] of oldFields.entries()) {
    const now = follow(field.key)
    const from = sectionOf(before.sections, field.key)
    const named = mine.has(field.key) || hasOrder(from)
    if (now === undefined || !named) continue
    const anchor = anchorOf.get(field.key) as FieldAnchor
    if (now !== field.key) {
      add(subject, { kind: 'field-rekeyed', field: now, from: field.key, anchor, resolution: 'followed', message: `${field.key} is now ${now}: it stands for ${describeAnchor(anchor)}, and what you chose for it followed.` })
    }
    const to = sectionOf(after.sections, now)
    if (from !== undefined && to !== undefined && told(from.anchor) && told(to.anchor) && !same(from.anchor, to.anchor)) {
      add(subject, { kind: 'moved-section', field: now, from: from.anchor, to: to.anchor, resolution: 'followed', message: `${now} moved from section ${describeSection(from.anchor)} to ${describeSection(to.anchor)}, where the generator put it.` })
    }
  }

  // Labels and spans, by anchor.
  const carried = new Map<string, { label?: Text; span?: 'all' | 'one' }>()
  for (const entry of published.presentation.fields) {
    const subject = subjectOf(entry.field)
    const now = follow(entry.field)
    if (now === undefined) {
      for (const property of ['label', 'span'] as const) {
        const yours = entry[property]
        if (yours === undefined) continue
        const shown = property === 'label' ? describeText(yours as Text) : `'${String(yours)}'`
        add(subject, { kind: 'field-gone', field: entry.field, anchor: entry.anchor, property, yours, resolution: 'dropped', message: `The ${property} ${shown} you chose for ${entry.field} was dropped: ${describeAnchor(entry.anchor)} is not in the regenerated form.` })
      }
      continue
    }
    const kept: { label?: Text; span?: 'all' | 'one' } = {}
    const generator = newFields.find((field) => field.key === now)?.label
    if (entry.label !== undefined && !same(entry.label, generator)) {
      kept.label = entry.label
      const was = oldFields.find((field) => field.key === entry.field)?.label
      if (!same(was, generator) && generator !== undefined) {
        add(subject, { kind: 'both-changed', field: now, property: 'label', yours: entry.label, generator, resolution: 'kept-yours', message: `You labelled ${now} ${describeText(entry.label)}, and the generator now labels it ${describeText(generator)}; yours is kept.` })
      }
    }
    if (entry.span !== undefined && (entry.span === 'all') !== (sectionOf(after.sections, now)?.wide.has(now) ?? false)) kept.span = entry.span
    if (kept.label !== undefined || kept.span !== undefined) carried.set(now, kept)
  }

  // Sections, by anchor, and the orders they hold.
  const sections: SectionPresentation[] = []
  for (const section of after.sections) {
    const entry = ordered.get(canonicalize(section.anchor))
    if (entry === undefined || !told(section.anchor)) continue
    const merged: { label?: Text; order?: string[] } = entry.label === undefined ? {} : { label: entry.label }
    if (entry.order !== undefined) {
      const order = carryOrder(entry.order.flatMap((key) => follow(key) ?? []), section)
      if (!same(order, section.keys)) merged.order = order
    }
    if (merged.label !== undefined || merged.order !== undefined) sections.push({ anchor: { ...section.anchor }, ...merged })
  }
  for (const [index, section] of before.sections.entries()) {
    const entry = ordered.get(canonicalize(section.anchor))
    if (entry === undefined || (told(section.anchor) && after.sections.some((candidate) => same(candidate.anchor, section.anchor)))) continue
    const subject = oldFields.length + index
    const why = told(section.anchor)
      ? 'is not in the regenerated form'
      : `cannot be told apart in the regenerated form, where the number of sections labelled "${section.anchor.label}" changed`
    const gone = (property: 'label' | 'order', yours: Text | string[]) =>
      add(subject, { kind: 'section-gone', section: section.anchor, property, yours, resolution: 'dropped', message: `Section ${describeSection(section.anchor)} ${why}, so the ${property} you chose for it was dropped.` })
    if (entry.label !== undefined) gone('label', entry.label)
    if (entry.order !== undefined) gone('order', entry.order)
  }

  const fields: FieldPresentation[] = []
  for (const binding of regenerated.bindings.fields) {
    const entry = carried.get(binding.field)
    if (entry !== undefined) fields.push({ field: binding.field, anchor: fieldAnchor(binding), ...entry })
  }
  const position = (key: string) => newFields.findIndex((field) => field.key === key)
  fields.sort((left, right) => position(left.field) - position(right.field))
  const presentation: PresentationOverrides = { version: PRESENTATION_VERSION, fields, sections }

  const applied = applyPresentation(regenerated.base, presentation, regenerated.bindings)
  if (!applied.ok) throw new Error(`the carried presentation does not apply to the regenerated base: ${applied.problems.join('; ')}`)
  conflicts.sort((left, right) => left.subject - right.subject || left.rank - right.rank)
  return { presentation, form: applied.form, conflicts: conflicts.map((entry) => entry.conflict) }
}

/**
 * Keys present in both bindings that name another column or lookup than
 * before, in the new bindings' order. A policy grants by key, so grants
 * written for one of these now apply to something else, and somebody has
 * to say whether they should.
 */
export function reassignedKeys(before: FormBindings, after: FormBindings): ReassignedKey[] {
  const was = new Map(before.fields.map((binding) => [binding.field, fieldAnchor(binding)]))
  const reassigned: ReassignedKey[] = []
  for (const binding of after.fields) {
    const previous = was.get(binding.field)
    const now = fieldAnchor(binding)
    if (previous !== undefined && !same(previous, now)) reassigned.push({ field: binding.field, was: previous, now })
  }
  return reassigned
}

/**
 * Whether a policy grants anything on a key: a read or write role on its
 * field. A lookup's filter is not a grant by itself -- every lookup field
 * must have one, `[]` for every row (`validatePolicy`), and an actor who may
 * neither read nor write the field is refused its options
 * (`lookupRowFilter`'s `field-denied`) -- so a key whose roles are gone
 * reaches nothing, which is what removing its grants leaves. The server's
 * refusal of an unconfirmed key and the studio's question about one are
 * this function (0039).
 */
export function grantsOnKey(policy: FormPolicy, key: string): boolean {
  const entry = Object.hasOwn(policy.fields, key) ? policy.fields[key] : undefined
  return entry !== undefined && (entry.read.length > 0 || entry.write.length > 0)
}

/** A reassigned key in one sentence, the one the server refuses it in and the studio lists it in (0039). */
export function describeReassigned(key: ReassignedKey): string {
  return `Grants for ${key.field} were written for ${describeAnchor(key.was)}; it now stands for ${describeAnchor(key.now)}.`
}

