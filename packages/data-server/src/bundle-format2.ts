import { actionChoiceOf, applyPresentation, findObject, generateForm, presentationShapeProblems, presentedActions } from '@formancy/data-core'
import type { ActionChoice, FormBindings, GenerationRequest, MetadataSnapshot, ObjectRef, PresentationOverrides, StampChoice } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { canonicalize } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import type { BundleV2 } from './bundle.js'
import { readGeneration } from './generation.js'
import { servedSchema } from './served-schema.js'

/*
 * What a format-2 bundle carries beyond format 1 (0030), and what holds it:
 * the generation request, the generated base and the presentation chosen
 * over it. `validateBundle` asks `format2Problems` on every read. Every
 * write that is not a restore asks both it and `generatedProblems`, the one
 * check that runs this release's generator, through `storable`
 * (`publishing.ts`): a publish (`routes/admin.ts`), and through `gate`
 * (`routes/admin-gate.ts`) an import and, under review, a draft's submit
 * and its approval (`routes/admin-drafts.ts`). A restore asks only
 * `format2Problems`, through the read that loads it (`published.ts`), and
 * never `generatedProblems`: it writes again, as it was read and validated,
 * a version this deployment stored.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What format 2 adds (0030): a generation request in the form the proposal
 * route reads one, for this bundle's connection and form; a base formancy
 * accepts, in the generator's spec version (`servedSchema`); and a
 * presentation that applies to that base and gives exactly the stored form.
 * Not whether the generator would write that base — that is
 * `generatedProblems`, at every write but a restore, and never on read.
 */
export function format2Problems(document: Record<string, unknown>, form: FormSchema, bindings: FormBindings, snapshot: MetadataSnapshot | null): string[] {
  const problems: string[] = []
  const read = readGeneration(document['generation'])
  const base = servedSchema('base', document['base'])
  if (!read.ok) problems.push(...read.problems.map((problem) => `generation: ${problem}`))
  else if (canonicalize(read.generation) !== canonicalize(document['generation'])) {
    problems.push('generation: is not in its normalised form (lookups and pinned as lists, versionColumn only when given, nothing else)')
  } else {
    if (read.generation.connection !== document['connection'])
      problems.push(`generation: names connection ${read.generation.connection}, and the bundle is bound to ${String(document['connection'])}`)
    if (base.valid && read.generation.formId !== base.schema.id)
      problems.push(`generation: names form ${read.generation.formId}, and the base is ${base.schema.id}`)
    if (base.valid) problems.push(...requestProblems(read.generation, base.schema, bindings, snapshot))
  }
  if (!base.valid) problems.push(...base.problems)

  const shape = presentationShapeProblems(document['presentation'])
  if (shape.length > 0) return [...problems, ...shape.map((problem) => `presentation: ${problem}`)]
  if (!base.valid) return problems
  const presentation = document['presentation'] as PresentationOverrides
  const applied = applyPresentation(base.schema, presentation, bindings)
  if (!applied.ok) return [...problems, ...applied.problems.map((problem) => `presentation: ${problem}`)]
  if (canonicalize(applied.form) !== canonicalize(form)) {
    problems.push('form: is not the base with its presentation applied; the form, the base or the presentation was edited')
  }
  return [...problems, ...dialogProblems(bindings, presentation)]
}

/**
 * Each action's dialog as a page is served it, the presentation's words
 * applied (`presentedActions`, 0159), against formancy's own validator
 * (0163): a word it refuses -- help text past the length it holds -- makes
 * a dialog no renderer draws, refused here for every client, as a form it
 * refuses is, in the sentence the studio says before it sends one. Asked
 * of words `applyPresentation` fitted to the bindings. The first error of
 * each, which names what to change: the rest are the alternatives the
 * schema tried after it.
 */
function dialogProblems(bindings: FormBindings, presentation: PresentationOverrides): string[] {
  return presentedActions(bindings, presentation.actions).flatMap((action) => {
    if (action.dialog === null) return []
    const checked = validateSchema(action.dialog)
    const [first] = checked.valid ? [] : checked.errors
    return first === undefined ? [] : [`presentation: the dialog of ${action.name}, at ${first.path}: ${first.message}`]
  })
}

/**
 * What the stored request alone decides, against the base and bindings it is
 * said to have produced (0030): the title, the root, a confirmed version
 * column and touch column (0155), the pins, the lookups with their
 * sections and whether each is saved with its record (0155), a chain of
 * versions, the stamps (0153) and the actions (0161). A regeneration generates from this
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
  // A rowversion's touch column (0155) is in the bindings exactly as the request confirms it.
  const touch = concurrency !== null && typeof concurrency['touch'] === 'string' ? concurrency['touch'] : undefined
  if (generation.touchColumn !== touch) {
    problems.push(`generation: confirms touch column ${generation.touchColumn ?? 'none'}, and the bindings touch ${touch ?? 'none'}`)
  }

  // A chain of versions (0113) is in the bindings exactly as the request names it.
  const chain = isRecord(bindings.validity) ? bindings.validity : undefined
  const span = (named: { from: string; to: string } | undefined) => (named === undefined ? 'none' : `from ${named.from} to ${named.to}`)
  if (span(generation.validity) !== span(chain)) problems.push(`generation: names versions ${span(generation.validity)}, and the bindings ${span(chain)}`)

  // The stamps (0153) are in the bindings exactly as the request names them,
  // whatever order it gives them in: column, what fills it and when.
  const stampsOf = (stamps: readonly StampChoice[] | undefined) =>
    canonicalize([...(stamps ?? [])].map(({ column, value, on }) => ({ column, value, on })).sort((left, right) => (left.column < right.column ? -1 : 1)))
  const stamped = Array.isArray(bindings.stamps) ? bindings.stamps : []
  if (stampsOf(generation.stamps) !== stampsOf(stamped)) problems.push('generation: names stamps the bindings do not have as it names them')

  for (const column of generation.pinned ?? []) {
    const field = bindings.fields.find((binding) => binding.kind === 'column' && binding.column === column)
    if (field !== undefined && (field.writes.create || field.writes.update))
      problems.push(`generation: pins ${column}, and its field ${field.field} is written by the form`)
  }

  // Compared as foreign key, display columns, section (0109) and together (0155), the whole of a lookup choice.
  type Choice = {
    foreignKey: string
    display: readonly string[]
    section?: { when: { column: string; value: string } | null } | undefined
    together?: { min: unknown; max: unknown } | undefined
  }
  const sectionOf = (lookup: Choice) =>
    lookup.section === undefined
      ? null
      : { when: lookup.section.when === null ? null : { column: lookup.section.when.column, value: lookup.section.when.value } }
  const togetherOf = (lookup: Choice) => (isRecord(lookup.together) ? { min: lookup.together.min, max: lookup.together.max } : null)
  const same = (left: Choice) => (right: Choice) =>
    left.foreignKey === right.foreignKey &&
    canonicalize(left.display) === canonicalize(right.display) &&
    canonicalize(sectionOf(left)) === canonicalize(sectionOf(right)) &&
    canonicalize(togetherOf(left)) === canonicalize(togetherOf(right))
  const saved = (lookup: Choice) => {
    const together = togetherOf(lookup)
    return together === null ? '' : ` saved with its record, ${String(together.min)} to ${String(together.max)}`
  }
  const shown = (lookup: Choice) =>
    `${lookup.foreignKey} showing ${lookup.display.join(', ')}${lookup.section === undefined ? '' : ' as a section'}${saved(lookup)}`
  const bound = bindings.fields.flatMap((binding) => (binding.kind === 'lookup' ? [binding] : []))
  for (const lookup of generation.lookups)
    if (!bound.some(same(lookup))) problems.push(`generation: chooses a lookup over ${shown(lookup)}, which the bindings do not have`)
  for (const lookup of bound)
    if (!generation.lookups.some(same(lookup))) problems.push(`generation: the bindings have a lookup over ${shown(lookup)}, which it does not choose`)
  problems.push(...actionProblems(generation, bindings))
  return problems
}

/** A choice as one string, its parameters in their names' order: a request may list them in any order, and the bindings keep the routine's. */
function choiceKey(choice: ActionChoice): string {
  const parameters = [...choice.parameters].sort((left, right) => (left.parameter < right.parameter ? -1 : left.parameter > right.parameter ? 1 : 0))
  return canonicalize({ ...choice, parameters })
}

/**
 * Every action the bindings bind is one the request names, as it names it
 * (0161): its routine, its scope and each parameter's source. Not the
 * other way: the generator leaves out an action it refuses, with a note,
 * and the form is still generated (0159), so a request may name more than
 * the bindings bind.
 */
function actionProblems(generation: GenerationRequest, bindings: FormBindings): string[] {
  const named = new Map((generation.actions ?? []).map((choice) => [choice.name, choiceKey(choice)]))
  const bound = Array.isArray(bindings.actions) ? bindings.actions : []
  return bound
    .filter((action) => named.get(action.name) !== choiceKey(actionChoiceOf(action)))
    .map((action) => `generation: the bindings bind action ${action.name}, which it does not name as they bind it`)
}

/** Whether the snapshot's root has a rowversion column; false for a snapshot no catalog could produce. */
function hasRowversion(snapshot: MetadataSnapshot | null, root: ObjectRef): boolean {
  if (snapshot === null || !isRecord(root)) return false
  return findObject(snapshot, root)?.columns.some((column) => column.type.kind === 'rowversion') ?? false
}

/**
 * Whether this server's generator writes the bundle's base and bindings from
 * its snapshot and generation request (0030). Asked at every write but a
 * restore (this file's header names them), so a base somebody edited — a
 * relaxed maxLength, a dropped `required` — is never stored as if the
 * database had said so. Not asked on read: a later release
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
  if (canonicalize(generated.form) !== canonicalize(bundle.base))
    problems.push('base: is not what this server generates from the stored snapshot and generation request')
  if (canonicalize(generated.bindings) !== canonicalize(bundle.bindings))
    problems.push('bindings: are not what this server generates from the stored snapshot and generation request')
  return problems
}
