import type { CoverageAspect, CoverageGap, CoverageSubject, MetadataSnapshot, ObjectRef } from '../metadata.js'
import { gapCovers } from '../snapshot.js'
import { allFields, type Comparison, describe, type Draft, fieldsOver, lookups, type Operation, refKey, stopped } from './context.js'
import type { DriftSubject } from './types.js'

/*
 * What a gap means for one form.
 *
 * A gap is the snapshot saying "this connection could not establish X"
 * (0004). Drift review is where that pays off: a permission-filtered catalog
 * looks exactly like a smaller database, and the gap is how a revoked grant is
 * told apart from a dropped table.
 */

/** What a subject is, as one string: scope, a schema, or an object. */
function subjectId(subject: CoverageSubject): string {
  if (subject.kind === 'scope') return 'scope'
  return subject.kind === 'schema' ? `schema\u0000${subject.schema}` : `object\u0000${refKey(subject.object)}`
}

/** A gap's identity across two snapshots: what it is about, never how an adapter worded it. */
function gapId(gap: CoverageGap): string {
  return `${subjectId(gap.subject)}\u0000${gap.aspect}`
}

/** Gaps that could hide `aspect` of `object`: about that object, its schema, or every object in scope. */
export function hiding(gaps: readonly CoverageGap[], object: ObjectRef, aspect: CoverageAspect): CoverageGap[] {
  return gaps.filter((gap) => gap.aspect === aspect && gapCovers(gap, object))
}

/**
 * Gaps that could hide `object` itself: any gap about it, or one about the
 * objects of its schema or of the whole scope. A gap on another schema hides
 * nothing here, so a root missing behind it is gone, not out of sight.
 */
export function hidingObject(gaps: readonly CoverageGap[], object: ObjectRef): CoverageGap[] {
  return gaps.filter((gap) => gapCovers(gap, object) && (gap.subject.kind === 'object' || gap.aspect === 'objects'))
}

function quote(gaps: readonly CoverageGap[]): string {
  return gaps.map((gap) => `"${gap.detail}"`).join('; ')
}

/**
 * The sentence for something the form depends on that this connection can no
 * longer see, with the gaps that say why. A foreign key reported with no
 * visible target says so by itself, and may come with no gap.
 */
export function unseen(thing: string, gaps: readonly CoverageGap[]): string {
  return `${thing} is not visible to this connection${gaps.length > 0 ? `: ${quote(gaps)}` : ''}. This is an access problem, not a deletion: restore the connection's access, then review; until then, what depends on it is blocked.`
}

/** Why an object is not in the current snapshot. */
export type Absence = { why: 'scope' } | { why: 'access'; gaps: CoverageGap[] } | { why: 'gone' }

/**
 * Three facts look the same from a snapshot that lacks a table: discovery was
 * told not to look, the connection lost sight of it, or it is gone. Checked in
 * that order, and only the last is a deletion. One function for the root and
 * for a lookup's target, so the two cannot disagree about it.
 */
export function absence(current: MetadataSnapshot, ref: ObjectRef): Absence {
  if (!current.scope.schemas.includes(ref.schema)) return { why: 'scope' }
  const gaps = hidingObject(current.gaps, ref)
  return gaps.length > 0 ? { why: 'access', gaps } : { why: 'gone' }
}

const BOTH: readonly Operation[] = ['create', 'update']

/** Aspects of a lookup's target the lookup rests on: the table, the display columns, the key it points at. */
const TARGET_ASPECTS: ReadonlySet<CoverageAspect> = new Set(['objects', 'columns', 'keys'])

/**
 * What a gap puts in doubt for this form, or `null` when it is about a table
 * the form neither binds nor looks up.
 *
 * The root's columns are every field and every create. Its keys are the
 * identity, which only update uses. Its foreign keys are the lookups', and so
 * are their targets' columns and keys. Checks, comments and default
 * expressions are nothing the form relies on: generation reads none of them.
 * Row security that cannot be established on the root or a target is for a
 * person to review and stops nothing (0027): neither adapter reports a write
 * done that the table does not hold.
 */
function doubtOf(comparison: Comparison, gap: CoverageGap): { stops: Operation[]; affects: string[]; otherwise?: 'review' } | null {
  const { bindings } = comparison
  const onRoot = gapCovers(gap, bindings.root)
  const targeted = lookups(bindings).filter((lookup) => gapCovers(gap, lookup.target.table))
  if (!onRoot && targeted.length === 0) return null
  if (gap.aspect === 'row-security') {
    return { stops: [], affects: allFields(bindings).filter((field) => onRoot || targeted.some((lookup) => lookup.field === field)), otherwise: 'review' }
  }

  const affected = new Set<string>()
  const stops = new Set<Operation>()
  const block = (fields: readonly string[], operations: readonly Operation[]) => {
    for (const field of fields) affected.add(field)
    for (const operation of operations) stops.add(operation)
  }

  if (onRoot && (gap.aspect === 'objects' || gap.aspect === 'columns')) block(allFields(bindings), BOTH)
  if (onRoot && gap.aspect === 'keys' && bindings.identity !== null) block(fieldsOver(bindings, bindings.identity), ['update'])
  const lookupsInDoubt = [...(onRoot && gap.aspect === 'foreign-keys' ? lookups(bindings) : []), ...(TARGET_ASPECTS.has(gap.aspect) ? targeted : [])]
  if (lookupsInDoubt.length > 0) block(lookupsInDoubt.map((lookup) => lookup.field), BOTH)

  return { stops: [...stops], affects: allFields(bindings).filter((field) => affected.has(field)) }
}

/**
 * Give gaps as the reason `draft` reports something missing, and return the
 * draft. A gap given this way is not reported again on its own, but only when
 * the draft already stops every write the gap puts in doubt. The concurrency
 * token or the identity's key out of sight stops update, and the gap behind it
 * can stop create as well; that gap is still reported for what it alone puts
 * in doubt, or more drift would leave a form more writable than the gap does
 * by itself.
 */
export function cite<T extends Draft>(comparison: Comparison, gaps: readonly CoverageGap[], draft: T): T {
  const stops = stopped(draft)
  for (const gap of gaps) {
    // A cited gap hides the root or a lookup's target, so it always concerns this form and its doubt is never `null`.
    if (doubtOf(comparison, gap)?.stops.every((operation) => stops.includes(operation))) comparison.cited.add(gapId(gap))
  }
  return draft
}

function subjectOf(gap: CoverageGap): DriftSubject {
  const subject = gap.subject
  if (subject.kind === 'object') return { kind: 'object', object: subject.object }
  return subject.kind === 'schema' ? { kind: 'schema', schema: subject.schema } : { kind: 'scope' }
}

function phrase(gap: CoverageGap): string {
  const subject = gap.subject
  const where = subject.kind === 'scope' ? 'anything in scope' : subject.kind === 'schema' ? `anything in schema ${subject.schema}` : describe(subject.object)
  return `the ${gap.aspect.replace('-', ' ')} of ${where}`
}

type Group = [CoverageGap, ...CoverageGap[]]

/** Gaps grouped by what they are about, in the snapshot's order. Two details about one aspect are one doubt. */
function grouped(gaps: readonly CoverageGap[]): Map<string, Group> {
  const groups = new Map<string, Group>()
  for (const gap of gaps) {
    const group = groups.get(gapId(gap))
    if (group === undefined) groups.set(gapId(gap), [gap])
    else group.push(gap)
  }
  return groups
}

/**
 * Gaps that appeared, and gaps that went away, about what this form uses.
 *
 * Called last: a gap already given as the reason a column or a key is missing
 * has been said, and is not said again. A gap whose wording changed is the same
 * gap. Gaps about tables this form does not touch are not its business, and
 * are left out.
 */
export function gapChanges(comparison: Comparison): Draft[] {
  const before = grouped(comparison.base.gaps)
  const after = grouped(comparison.current.gaps)
  const drafts: Draft[] = []

  for (const [id, gaps] of after) {
    const [first] = gaps
    if (before.has(id) || comparison.cited.has(id)) continue
    const doubt = doubtOf(comparison, first)
    if (doubt === null) continue
    drafts.push({
      kind: 'access-narrowed',
      subject: subjectOf(first),
      affects: doubt.affects,
      stops: doubt.stops,
      breaksReads: false,
      otherwise: doubt.otherwise ?? (doubt.stops.length > 0 ? 'review' : 'info'),
      message: `This connection can no longer establish ${phrase(first)}: ${quote(gaps)}. It could when the form was generated, so this is an access problem, not a schema change; ${
        doubt.stops.length > 0
          ? 'the writes that rest on it are blocked until access is restored or the form is reviewed'
          : doubt.otherwise === 'review'
            ? 'which rows this form shows may differ from what was reviewed, and nothing is stopped'
            : 'nothing this form does rests on it'
      }.`,
    })
  }

  for (const [id, gaps] of before) {
    const [first] = gaps
    if (after.has(id) || doubtOf(comparison, first) === null) continue
    drafts.push({
      kind: 'access-widened',
      subject: subjectOf(first),
      affects: [],
      stops: [],
      breaksReads: false,
      otherwise: 'info',
      message: `This connection can now establish ${phrase(first)}, which it could not when the form was generated. Regenerating may offer more; the published form is unchanged.`,
    })
  }
  return drafts
}
