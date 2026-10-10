import type { FormBindings } from '../generate/types.js'
import { bindingsVersionProblem } from '../generate/version.js'
import type { ColumnAccess, MetadataSnapshot, ObjectMeta, ObjectRef } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import type { DescribedTable } from '../records/types.js'
import { findObject } from '../snapshot.js'
import { absence, gapChanges, unseen } from './access.js'
import { columnChanges } from './columns.js'
import { allFields, byCodepoint, type Comparison, describe, type Draft, foreignKeyIn, identityKeyIn, objectIn, type Operation, refKey, stopped } from './context.js'
import { accountChanges, privilegeChanges } from './privileges.js'
import { checkChanges, lookupTargetChanges, rootRelationshipChanges } from './relationships.js'
import type { DriftChange, DriftReport, DriftSeverity, DriftSubject, DriftVerdict } from './types.js'

/** The root as a request describes it, before an adapter's definition is attached (0041). */
export type DescribedRoot = Omit<DescribedTable, 'definition'>

/**
 * The families that compare the root's own definition -- its kind, its
 * columns, its keys and foreign keys -- and nothing else: what a request's
 * description of the root holds, and so all the runtime compares (0041).
 * `diffSnapshots` runs them first and `diffRootDefinition` runs only them, so
 * a rule added to one of them reaches review and the runtime alike.
 */
export const ROOT_DEFINITION: ReadonlyArray<(comparison: Comparison) => Draft[]> = [rootKindChanges, columnChanges, rootRelationshipChanges]

/** What the form offered, and its root in `base`: the checks every comparison makes on entry. */
function entered(base: MetadataSnapshot, bindings: FormBindings): { before: ObjectMeta; offered: { create: boolean; update: boolean } } {
  // First: a version-1 file says one write flag for both operations, and
  // every verdict below about which writes a change stops would be a guess.
  const version = bindingsVersionProblem(bindings.version)
  if (version !== null) throw new Error(version)
  if (bindings.snapshotFingerprint !== base.fingerprint) {
    throw new Error(`the bindings were generated from snapshot ${bindings.snapshotFingerprint}, not from the base snapshot ${base.fingerprint}`)
  }
  // Checked before the fast path, not after it: a fingerprint match says the
  // database did not change, and nothing about whether these bindings could
  // ever have come from it. Found in review: doctored bindings were accepted
  // whenever the two snapshots happened to be equal.
  return { before: assertBindingsMatch(base, bindings), offered: { ...bindings.operations } }
}

/** What a missing root leaves the runtime: nothing, because a request finds no table to describe and is refused. */
const NOTHING_LEFT: DriftVerdict = { readable: false, writable: { create: false, update: false } }

/**
 * What changed between the snapshot a form was generated from and the
 * database as it is now, classified by what it means for that form.
 *
 * Only what the form touches is compared: its root, and the targets of its
 * lookups — on a target, what the lookup reads, including the columns the
 * policy's lookup filters compare (0028), which is why the policy is given. A change elsewhere in scope is not this form's business and is left
 * out, so an empty report means nothing this form rests on changed, not that
 * nothing changed. Equal fingerprints are the fast path: `createSnapshot`
 * promises they describe the same thing, so nothing is walked.
 *
 * Fails closed. A change the form cannot be sure is harmless stops the writes
 * it puts in doubt, and something that vanished behind a gap is an access
 * problem, never a deletion (0004). It throws, rather than guessing, when the
 * bindings were not generated from `base` or the two snapshots are of
 * different engines.
 *
 * `runtime` is what a request decides against this database (0041): the
 * root-definition families over the root as `current` describes it, which is
 * never stricter than review and looser by what only review compares.
 */
export function diffSnapshots(base: MetadataSnapshot, current: MetadataSnapshot, bindings: FormBindings, policy: Pick<FormPolicy, 'lookups'>): DriftReport {
  const { before, offered } = entered(base, bindings)
  // The runtime takes the same shortcut, before anything is described: equal
  // fingerprints are one database, whatever the objects passed in say.
  if (current.fingerprint === base.fingerprint) return { changes: [], blocking: false, readable: true, writable: offered, runtime: { readable: true, writable: { ...offered } } }
  if (current.kind !== base.kind) {
    throw new Error(`a ${base.kind} snapshot cannot be compared with a ${current.kind} one: a form's bindings belong to one engine`)
  }

  const after = findObject(current, bindings.root)
  // The account is said beside a missing root: under another principal it may be missing for that principal only.
  if (after === undefined) return { ...finish([rootMissing(current, bindings), ...accountChanges(base, current, bindings)], offered), runtime: NOTHING_LEFT }

  const comparison: Comparison = { base, current, bindings, policy, before, after, cited: new Set() }
  const report = finish(
    [
      ...ROOT_DEFINITION.flatMap((family) => family(comparison)),
      ...lookupTargetChanges(comparison),
      ...checkChanges(comparison),
      ...privilegeChanges(comparison),
      // Last: a gap is reported on its own only when no change above gave it as its reason.
      ...gapChanges(comparison),
    ],
    offered,
  )
  return { ...report, runtime: verdictOf(rootDefinition(base, before, describedOf(current, bindings.root) as DescribedRoot, bindings, policy, offered)) }
}

/**
 * The root as `snapshot` describes it, as a request's `describe` would: its
 * kind, its columns without access or comment, its keys and foreign keys.
 * `undefined` when the snapshot does not have it.
 */
export function describedOf(snapshot: MetadataSnapshot, ref: ObjectRef): DescribedRoot | undefined {
  const found = findObject(snapshot, ref)
  if (found === undefined) return undefined
  return {
    kind: found.kind,
    columns: found.columns.map(({ access: _access, comment: _comment, ...column }) => column),
    primaryKey: found.primaryKey,
    uniqueKeys: found.uniqueKeys,
    foreignKeys: found.foreignKeys,
  }
}

/**
 * The report a request decides by (0041): the form's root as `described`, a
 * description read from the catalog in that request, against `base`, by the
 * root-definition families alone -- the ones `diffSnapshots` runs first --
 * and the same `finish`. Its `runtime` is its own verdict.
 *
 * Everything else is the base's: the gaps, so a column vanished behind a gap
 * the base had is out of sight here as in review; lookup targets, which are
 * not described, so nothing about them is compared; checks, row security, the
 * object's comment. A column the base has keeps its access and comment by
 * name; one it lacks is given nothing permitted and no comment, because
 * nothing is assumed of a column discovery never saw. No snapshot is made
 * (0004): nothing is hashed and nothing runs `assertConsistent`.
 */
export function diffRootDefinition(base: MetadataSnapshot, described: DescribedRoot, bindings: FormBindings, policy: Pick<FormPolicy, 'lookups'>): DriftReport {
  const { before, offered } = entered(base, bindings)
  const report = rootDefinition(base, before, described, bindings, policy, offered)
  return { ...report, runtime: verdictOf(report) }
}

const NOTHING_PERMITTED: ColumnAccess = { select: false, insert: false, update: false }

function rootDefinition(
  base: MetadataSnapshot,
  before: ObjectMeta,
  described: DescribedRoot,
  bindings: FormBindings,
  policy: Pick<FormPolicy, 'lookups'>,
  offered: { create: boolean; update: boolean },
): Omit<DriftReport, 'runtime'> {
  const known = new Map(before.columns.map((column) => [column.name, column]))
  const after: ObjectMeta = {
    ...before,
    kind: described.kind,
    columns: described.columns.map((column) => ({ ...column, comment: known.get(column.name)?.comment ?? null, access: { ...(known.get(column.name)?.access ?? NOTHING_PERMITTED) } })),
    primaryKey: described.primaryKey,
    uniqueKeys: described.uniqueKeys,
    foreignKeys: described.foreignKeys,
  }
  const comparison: Comparison = { base, current: base, bindings, policy, before, after, cited: new Set() }
  return finish(ROOT_DEFINITION.flatMap((family) => family(comparison)), offered)
}

function verdictOf(report: DriftVerdict): DriftVerdict {
  return { readable: report.readable, writable: { ...report.writable } }
}

/**
 * The root in `base`, after checking that everything the bindings name is
 * there. Bindings edited by hand to name a column the base never had would
 * otherwise be compared with nothing, and a change to it never reported.
 */
function assertBindingsMatch(base: MetadataSnapshot, bindings: FormBindings): ObjectMeta {
  const root = objectIn(base, bindings.root)
  const column = (name: string) => {
    if (!root.columns.some((candidate) => candidate.name === name)) {
      throw new Error(`the bindings name column ${name} of ${describe(root.ref)}, which the base snapshot does not have`)
    }
  }

  for (const binding of bindings.fields) {
    if (binding.kind === 'column') {
      column(binding.column)
    } else {
      foreignKeyIn(root, binding.foreignKey)
      objectIn(base, binding.target.table)
    }
  }
  if (bindings.concurrency !== null) column(bindings.concurrency.column)
  if (bindings.identity !== null) identityKeyIn(root, bindings.identity)
  return root
}

/** The root is not in the current snapshot: blocked whatever the reason, and the reason named. */
function rootMissing(current: MetadataSnapshot, bindings: FormBindings): Draft {
  const ref = bindings.root
  const missing = { subject: { kind: 'object', object: ref } as const, affects: allFields(bindings), stops: [], breaksReads: true, otherwise: 'review' as const }
  const absent = absence(current, ref)
  if (absent.why === 'scope') {
    return {
      ...missing,
      kind: 'scope-narrowed',
      message: `${describe(ref)} is outside the discovery scope: ${ref.schema} is no longer a schema discovery is approved for, so this snapshot cannot say whether the table still exists. The form is blocked until the scope is restored or the form is reviewed.`,
    }
  }
  if (absent.why === 'access') return { ...missing, kind: 'access-narrowed', message: unseen(describe(ref), absent.gaps) }
  return {
    ...missing,
    kind: 'root-dropped',
    message: `${describe(ref)} is gone: the database no longer has it, and no gap says this connection lost sight of it. Nothing this form does can work until it is reviewed.`,
  }
}

/** A view has no write path in this release (0009), so a table that became one stops every write. */
function rootKindChanges({ before, after, bindings }: Comparison): Draft[] {
  if (before.kind === after.kind) return []
  const toView = after.kind === 'view'
  return [
    {
      kind: 'root-kind-changed',
      subject: { kind: 'object', object: after.ref },
      affects: allFields(bindings),
      stops: toView ? ['create', 'update'] : [],
      breaksReads: false,
      otherwise: 'review',
      message: toView
        ? `${describe(after.ref)} is a view where it was a table. A view is read-only in this release, so writes are blocked until the form is reviewed.`
        : `${describe(after.ref)} is a table where it was a view. Regenerating could offer writes; the published form stays read-only.`,
    },
  ]
}

const RANK: Record<DriftSeverity, number> = { blocking: 0, review: 1, info: 2 }

/** The scope first; a schema just before its own objects; then objects and what is in them. */
function subjectKey(subject: DriftSubject): string {
  if (subject.kind === 'scope') return ''
  if (subject.kind === 'schema') return subject.schema
  return subject.kind === 'object' ? refKey(subject.object) : `${refKey(subject.object)}\u0000${subject.kind}\u0000${subject.name}`
}

/**
 * Severity, order and what is still writable, decided once for every change.
 *
 * Blocking when the change breaks what the form shows, or stops a write the
 * form offers; otherwise the change's own lesser severity. The same dropped
 * column is blocking for a form that binds it and a note for one that does not.
 */
function finish(drafts: readonly Draft[], offered: { create: boolean; update: boolean }): Omit<DriftReport, 'runtime'> {
  const stops = new Set<Operation>(drafts.flatMap(stopped))
  const changes: DriftChange[] = drafts.map((draft) => ({
    kind: draft.kind,
    severity: draft.breaksReads || draft.stops.some((operation) => offered[operation]) ? 'blocking' : draft.otherwise,
    subject: draft.subject,
    affects: draft.affects,
    message: draft.message,
  }))
  changes.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      byCodepoint(subjectKey(a.subject), subjectKey(b.subject)) ||
      byCodepoint(a.kind, b.kind) ||
      byCodepoint(a.message, b.message),
  )
  return {
    changes,
    blocking: changes.some((change) => change.severity === 'blocking'),
    readable: !drafts.some((draft) => draft.breaksReads),
    writable: { create: offered.create && !stops.has('create'), update: offered.update && !stops.has('update') },
  }
}
