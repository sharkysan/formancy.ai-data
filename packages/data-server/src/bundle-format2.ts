import { applyPresentation, findObject, generateForm, presentationShapeProblems } from '@formancy/data-core'
import type { FormBindings, GenerationRequest, MetadataSnapshot, ObjectRef, PresentationOverrides } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import type { BundleV2 } from './bundle.js'
import { readGeneration } from './generation.js'

/*
 * What a format-2 bundle carries beyond format 1 (0030), and what holds it:
 * the generation request, the generated base and the presentation chosen
 * over it. `validateBundle` asks `format2Problems` on publish and on every
 * read; the publish route alone asks `generatedProblems`, the one check that
 * runs this release's generator.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What format 2 adds (0030): a generation request in the form the proposal
 * route reads one, for this bundle's connection and form; a base formancy
 * accepts; and a presentation that applies to that base and gives exactly
 * the stored form. Not whether the generator would write that base — that
 * is `generatedProblems`, at publish only.
 */
export function format2Problems(document: Record<string, unknown>, form: FormSchema, bindings: FormBindings, snapshot: MetadataSnapshot | null): string[] {
  const problems: string[] = []
  const read = readGeneration(document['generation'])
  const base = validateSchema(document['base'])
  if (!read.ok) problems.push(...read.problems.map((problem) => `generation: ${problem}`))
  else if (canonicalize(read.generation) !== canonicalize(document['generation'])) {
    problems.push('generation: is not in its normalised form (lookups and pinned as lists, versionColumn only when given, nothing else)')
  } else {
    if (read.generation.connection !== document['connection']) problems.push(`generation: names connection ${read.generation.connection}, and the bundle is bound to ${String(document['connection'])}`)
    if (base.valid && read.generation.formId !== base.schema.id) problems.push(`generation: names form ${read.generation.formId}, and the base is ${base.schema.id}`)
    if (base.valid) problems.push(...requestProblems(read.generation, base.schema, bindings, snapshot))
  }
  if (!base.valid) problems.push(...base.errors.map((error) => `base: ${error.message}`))

  const shape = presentationShapeProblems(document['presentation'])
  if (shape.length > 0) return [...problems, ...shape.map((problem) => `presentation: ${problem}`)]
  if (!base.valid) return problems
  const applied = applyPresentation(base.schema, document['presentation'] as PresentationOverrides, bindings)
  if (!applied.ok) problems.push(...applied.problems.map((problem) => `presentation: ${problem}`))
  else if (canonicalize(applied.form) !== canonicalize(form)) {
    problems.push('form: is not the base with its presentation applied; the form, the base or the presentation was edited')
  }
  return problems
}

/**
 * What the stored request alone decides, against the base and bindings it is
 * said to have produced (0030): the title, the root, a confirmed version
 * column, the pins and the lookups. A regeneration generates from this
 * request and its draft is checked at publish against the same request, so
 * an edit to it alone would reach the next version unannounced. None of
 * these asks the generator, so a later release cannot fail a stored version
 * on them.
 *
 * Not caught: a pin taken out by hand. A field written by no operation could
 * be pinned, generated, unwritable by the account or from a view, and only
 * the generator tells them apart. The policy still decides what is written
 * and which rows are reached; what such an edit changes is the next draft's
 * form.
 */
function requestProblems(generation: GenerationRequest, base: FormSchema, bindings: FormBindings, snapshot: MetadataSnapshot | null): string[] {
  const problems: string[] = []
  const tableOf = (ref: ObjectRef) => `${ref.schema}.${ref.name}`
  if (generation.title !== base.title) problems.push(`generation: is titled ${JSON.stringify(generation.title)}, and the base ${JSON.stringify(base.title)}`)
  if (!isRecord(bindings.root) || generation.root.schema !== bindings.root.schema || generation.root.name !== bindings.root.name) {
    problems.push(`generation: names root ${tableOf(generation.root)}, and the bindings ${isRecord(bindings.root) ? tableOf(bindings.root) : 'none'}`)
  }

  // A table's rowversion is its strategy whatever the request confirms, and
  // one the account may not read leaves it none (0027); otherwise a confirmed
  // version column is in the bindings exactly when the request gives it.
  const concurrency = isRecord(bindings.concurrency) ? bindings.concurrency : null
  const confirmed = concurrency?.kind === 'version-column' && concurrency.confirmed === true ? concurrency.column : undefined
  const rowversion = concurrency?.kind === 'rowversion' || hasRowversion(snapshot, bindings.root)
  if (generation.versionColumn !== undefined && !rowversion && generation.versionColumn !== confirmed) {
    problems.push(`generation: confirms version column ${generation.versionColumn}, and the bindings use ${confirmed ?? 'none'}`)
  }
  if (generation.versionColumn === undefined && confirmed !== undefined) {
    problems.push(`generation: confirms no version column, and the bindings use ${confirmed} as a confirmed one`)
  }

  for (const column of generation.pinned ?? []) {
    const field = bindings.fields.find((binding) => binding.kind === 'column' && binding.column === column)
    if (field !== undefined && (field.writes.create || field.writes.update)) problems.push(`generation: pins ${column}, and its field ${field.field} is written by the form`)
  }

  // Compared as foreign key and display columns, the whole of a lookup choice.
  type Choice = { foreignKey: string; display: readonly string[] }
  const same = (left: Choice) => (right: Choice) => left.foreignKey === right.foreignKey && canonicalize(left.display) === canonicalize(right.display)
  const shown = (lookup: Choice) => `${lookup.foreignKey} showing ${lookup.display.join(', ')}`
  const bound = bindings.fields.flatMap((binding) => (binding.kind === 'lookup' ? [binding] : []))
  for (const lookup of generation.lookups) if (!bound.some(same(lookup))) problems.push(`generation: chooses a lookup over ${shown(lookup)}, which the bindings do not have`)
  for (const lookup of bound) if (!generation.lookups.some(same(lookup))) problems.push(`generation: the bindings have a lookup over ${shown(lookup)}, which it does not choose`)
  return problems
}

/** Whether the snapshot's root has a rowversion column; false for a snapshot no catalog could produce. */
function hasRowversion(snapshot: MetadataSnapshot | null, root: ObjectRef): boolean {
  if (snapshot === null || !isRecord(root)) return false
  return findObject(snapshot, root)?.columns.some((column) => column.type.kind === 'rowversion') ?? false
}

/**
 * Whether this server's generator writes the bundle's base and bindings from
 * its snapshot and generation request (0030). Asked at publish, so a base
 * somebody edited — a relaxed maxLength, a dropped `required` — is never
 * stored as if the database had said so. Not asked on read: a later release
 * whose generator writes something else must not make every version stored
 * before it "corrupt".
 */
export function generatedProblems(bundle: BundleV2): string[] {
  let generated
  try {
    generated = generateForm(bundle.snapshot, bundle.generation)
  } catch (error) {
    return [`generation: ${(error as Error).message}`]
  }
  const problems: string[] = []
  if (canonicalize(generated.form) !== canonicalize(bundle.base)) problems.push('base: is not what this server generates from the stored snapshot and generation request')
  if (canonicalize(generated.bindings) !== canonicalize(bundle.bindings)) problems.push('bindings: are not what this server generates from the stored snapshot and generation request')
  return problems
}
