import type { CoverageAspect, CoverageGap, MetadataSnapshot, ObjectRef } from '../metadata.js'
import { allFields, type Comparison, describe, type Draft, fieldsOver, lookups, type Operation, refKey, sameRef, stopped } from './context.js'
import type { DriftSubject } from './types.js'

/*
 * What a gap means for one form.
 *
 * A gap is the snapshot saying "this connection could not establish X"
 * (0004). Drift review is where that pays off: a permission-filtered catalog
 * looks exactly like a smaller database, and the gap is how a revoked grant is
 * told apart from a dropped table.
 */

/** A gap's identity across two snapshots: what it is about, never how an adapter worded it. */
function gapId(gap: CoverageGap): string {
  return `${refKey(gap.object)}\u0000${gap.aspect}`
}

/** Gaps that could hide `aspect` of `object`: about that object, or about every object in scope. */
export function hiding(gaps: readonly CoverageGap[], object: ObjectRef, aspect: CoverageAspect): CoverageGap[] {
  return gaps.filter((gap) => gap.aspect === aspect && (gap.object === null || sameRef(gap.object, object)))
}

/** Gaps that could hide `object` itself: any gap about it, or one about the scope's objects. */
export function hidingObject(gaps: readonly CoverageGap[], object: ObjectRef): CoverageGap[] {
  return gaps.filter((gap) => (gap.object === null ? gap.aspect === 'objects' : sameRef(gap.object, object)))
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
 */
function doubtOf(comparison: Comparison, gap: CoverageGap): { stops: Operation[]; affects: string[] } | null {
  const { bindings } = comparison
  const onRoot = gap.object === null || sameRef(gap.object, bindings.root)
  const targeted = lookups(bindings).filter((lookup) => gap.object === null || sameRef(gap.object, lookup.target.table))
  if (!onRoot && targeted.length === 0) return null

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
  return gap.object === null ? { kind: 'scope' } : { kind: 'object', object: gap.object }
}

function phrase(gap: CoverageGap): string {
  return `the ${gap.aspect.replace('-', ' ')} of ${gap.object === null ? 'anything in scope' : describe(gap.object)}`
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
      otherwise: doubt.stops.length > 0 ? 'review' : 'info',
      message: `This connection can no longer establish ${phrase(first)}: ${quote(gaps)}. It could when the form was generated, so this is an access problem, not a schema change; ${
        doubt.stops.length > 0 ? 'the writes that rest on it are blocked until access is restored or the form is reviewed' : 'nothing this form does rests on it'
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
