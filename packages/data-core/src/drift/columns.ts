import { controlFor } from '../generate/controls.js'
import type { FormBindings } from '../generate/types.js'
import type { ColumnMeta } from '../metadata.js'
import { cite, hiding, unseen } from './access.js'
import { type ColumnChangeKind, classify, sameDefinition } from './compare.js'
import { type Comparison, describe, type Draft, fieldsOver, list, type Operation, writes } from './context.js'
import type { DriftKind } from './types.js'

const BOTH: readonly Operation[] = ['create', 'update']

/** Controls that hold the same values: a longer text becomes a textarea, and both hold any string. */
const STRINGS: ReadonlySet<string> = new Set(['text', 'textarea'])

const CREATE_LOST = 'A create must now give it a value, and no field of this form can, so create is blocked.'

/**
 * A create must give this column a value and no field of the form can: the
 * rule the generator offers create by, applied to the database as it is now.
 */
function blocksCreate(bindings: FormBindings, column: ColumnMeta): boolean {
  return !column.nullable && !column.hasDefault && column.generated === 'none' && !writes(bindings, column.name)
}

/**
 * The published field's control, when it can no longer hold every value the
 * column can; `null` while it still can. Decided by the generator's own
 * `controlFor`, so drift and generation cannot disagree about what fits a
 * field: an integer past 2^53 is no longer a number, and a nullable boolean is
 * no longer a checkbox.
 */
function outgrownControl(bindings: FormBindings, after: ColumnMeta): string | null {
  const binding = bindings.fields.find((candidate) => candidate.kind === 'column' && candidate.column === after.name)
  // A lookup's select holds an encoded key, never the column's value itself.
  if (binding?.kind !== 'column') return null
  const published = controlFor(binding.type, binding.nullable)
  const now = controlFor(after.type, after.nullable)
  return 'field' in published &&
    'field' in now &&
    published.field.type !== now.field.type &&
    !(STRINGS.has(published.field.type) && STRINGS.has(now.field.type))
    ? published.field.type
    : null
}

/**
 * The root's columns, compared by name: one change per column that changed,
 * one per column added, and a hint where a column gone and one added are
 * defined alike. A rename is never inferred.
 */
export function columnChanges(comparison: Comparison): Draft[] {
  const { before, after } = comparison
  const now = new Map(after.columns.map((column) => [column.name, column]))
  const then = new Set(before.columns.map((column) => column.name))
  // Out of sight is not gone, so no rename is suggested for a column the connection may merely not see.
  const hidden = hiding(comparison.current.gaps, before.ref, 'columns').length > 0

  const drafts: Draft[] = []
  const dropped: ColumnMeta[] = []
  for (const was of before.columns) {
    const is = now.get(was.name)
    const draft = is === undefined ? droppedColumn(comparison, was) : changedColumn(comparison, was, is)
    if (draft !== null) drafts.push(draft)
    if (is === undefined && !hidden) dropped.push(was)
  }
  const added = after.columns.filter((column) => !then.has(column.name))
  return [...drafts, ...added.map((column) => addedColumn(comparison, column)), ...renameHints(comparison, dropped, added)]
}

function droppedColumn(comparison: Comparison, was: ColumnMeta): Draft | null {
  const { bindings } = comparison
  const root = comparison.before.ref
  const subject = { kind: 'column', object: root, name: was.name } as const
  const fields = fieldsOver(bindings, [was.name])
  const token = bindings.concurrency?.column === was.name
  const gaps = hiding(comparison.current.gaps, root, 'columns')

  if (fields.length === 0 && !token) {
    // Nothing here binds it. Out of sight, the gap reports itself; gone, it is a note.
    if (gaps.length > 0) return null
    return { kind: 'column-dropped', subject, affects: [], stops: [], breaksReads: false, otherwise: 'info', message: `${was.name} is gone. No field of this form binds it.` }
  }

  const stops: readonly Operation[] = token ? ['update'] : []
  if (gaps.length > 0) {
    return cite(comparison, gaps, { kind: 'access-narrowed', subject, affects: fields, stops, breaksReads: fields.length > 0, otherwise: 'review', message: unseen(`Column ${was.name} of ${describe(root)}`, gaps) })
  }
  if (token) {
    return {
      kind: 'concurrency-changed',
      subject,
      affects: [],
      stops,
      breaksReads: false,
      otherwise: 'info',
      message: `${was.name}, the form's concurrency token, is gone, so a stale update could not be detected. Update is blocked until the form is reviewed.`,
    }
  }
  return {
    kind: 'column-dropped',
    subject,
    affects: fields,
    stops,
    breaksReads: true,
    otherwise: 'review',
    message: `${was.name} is gone, and the form binds it to ${list(fields)}. The form is blocked until it is reviewed.`,
  }
}

interface Effect {
  kind: DriftKind
  stops: readonly Operation[]
  breaksReads: boolean
  otherwise: 'review' | 'info'
  consequence: string
}

/** What one classified column change means for this form. */
function effectOf(bindings: FormBindings, kind: ColumnChangeKind, is: ColumnMeta): Effect {
  const fields = fieldsOver(bindings, [is.name])
  const writable = writes(bindings, is.name)
  const unbound = fields.length > 0 ? 'The form only shows it.' : 'No field of this form binds it.'
  const note = (consequence: string): Effect => ({ kind, stops: [], breaksReads: false, otherwise: 'info', consequence })

  if (bindings.concurrency?.column === is.name) {
    return { kind: 'concurrency-changed', stops: ['update'], breaksReads: false, otherwise: 'info', consequence: "It is the form's concurrency token, so update is blocked until the form is reviewed." }
  }
  switch (kind) {
    case 'column-type-changed':
      if (fields.length > 0) {
        return { kind, stops: [], breaksReads: true, otherwise: 'review', consequence: `The form binds it to ${list(fields)} and reads it with the codec it was published with, so the form is blocked until it is reviewed.` }
      }
      // A key column the form cannot show still addresses the record an update changes.
      if (bindings.identity?.includes(is.name) === true) {
        return { kind, stops: ['update'], breaksReads: false, otherwise: 'info', consequence: 'It identifies a record, so update is blocked until the form is reviewed.' }
      }
      return note(unbound)
    case 'column-generation-changed':
      if (writable && is.generated !== 'none') {
        return { kind, stops: BOTH, breaksReads: false, otherwise: 'review', consequence: 'The form writes it, and the database refuses a value for a column it generates, so writes are blocked until the form is reviewed.' }
      }
      return { ...note(unbound), otherwise: fields.length > 0 ? 'review' : 'info' }
    case 'column-tightened':
      if (writable) {
        return { kind, stops: BOTH, breaksReads: false, otherwise: 'info', consequence: `The form would accept values the database now refuses, so writes of ${list(fields)} are blocked until its validation is reviewed.` }
      }
      return note(fields.length > 0 ? 'The form only shows it, and every value it shows still fits.' : unbound)
    case 'column-loosened': {
      const control = outgrownControl(bindings, is)
      if (control === null) return note('Every value the form accepts is still accepted.')
      if (writable) {
        return {
          kind: 'column-outgrew-field',
          stops: BOTH,
          breaksReads: false,
          otherwise: 'review',
          consequence: `The published ${control} field cannot hold every value it now can, and a save would write back what the field made of it, so writes of ${list(fields)} are blocked until the form is reviewed.`,
        }
      }
      return { kind: 'column-outgrew-field', stops: [], breaksReads: false, otherwise: 'review', consequence: `The published ${control} field cannot show every value it now can; it never writes one back.` }
    }
    case 'column-default-changed':
      return note('What a create that leaves it out stores is different; nothing is refused.')
  }
}

function changedColumn(comparison: Comparison, was: ColumnMeta, is: ColumnMeta): Draft | null {
  const found = classify(was, is)
  if (found === null) return null
  const { bindings } = comparison
  const effect = effectOf(bindings, found.kind, is)
  // The generator's create rule, now: a change that leaves this column needing a value nobody gives stops create.
  const createLost = blocksCreate(bindings, is) && !blocksCreate(bindings, was)
  return {
    kind: effect.kind,
    subject: { kind: 'column', object: comparison.after.ref, name: is.name },
    affects: fieldsOver(bindings, [is.name]),
    stops: createLost ? [...effect.stops, 'create'] : effect.stops,
    breaksReads: effect.breaksReads,
    otherwise: effect.otherwise,
    message: `${is.name}: ${found.reasons.join('; ')}. ${effect.consequence}${createLost ? ` ${CREATE_LOST}` : ''}`,
  }
}

function addedColumn(comparison: Comparison, is: ColumnMeta): Draft {
  const subject = { kind: 'column', object: comparison.after.ref, name: is.name } as const
  if (blocksCreate(comparison.bindings, is)) {
    return { kind: 'column-added', subject, affects: [], stops: ['create'], breaksReads: false, otherwise: 'review', message: `${is.name} is new (${is.databaseType}), NOT NULL, with no default and no generator. ${CREATE_LOST}` }
  }
  const traits = [is.databaseType, ...(is.nullable ? ['nullable'] : []), ...(is.hasDefault ? ['with a default'] : []), ...(is.generated === 'none' ? [] : [`generated (${is.generated})`])]
  return { kind: 'column-added', subject, affects: [], stops: [], breaksReads: false, otherwise: 'review', message: `${is.name} is new (${list(traits)}). It can be added to the form; the published form is unchanged.` }
}

/**
 * Plan section 14: an apparent rename requests confirmation and is never
 * inferred from names. The evidence is a definition, not a name, and the hint
 * changes nothing: the dropped column and the new one are reported as what
 * they are, and stop what they stop.
 */
function renameHints(comparison: Comparison, dropped: readonly ColumnMeta[], added: readonly ColumnMeta[]): Draft[] {
  return dropped.flatMap((gone): Draft[] => {
    const candidates = added.filter((fresh) => sameDefinition(gone, fresh)).map((fresh) => fresh.name)
    if (candidates.length === 0) return []
    const fields = fieldsOver(comparison.bindings, [gone.name])
    const one = candidates.length === 1
    return [
      {
        kind: 'possible-rename',
        subject: { kind: 'column', object: comparison.before.ref, name: gone.name },
        affects: fields,
        stops: [],
        breaksReads: false,
        otherwise: fields.length > 0 ? 'review' : 'info',
        message: `${gone.name} is gone and ${list(candidates)} ${one ? 'is' : 'are'} new with the same definition (${gone.databaseType}). If ${one ? 'it is' : 'one of them is'} ${gone.name} renamed, confirm it: nothing is inferred, and until then they are reported as a dropped column and a new one.`,
      },
    ]
  })
}
