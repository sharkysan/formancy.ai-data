import type { FormBindings } from '../generate/types.js'
import type { MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { findObject } from '../snapshot.js'
import { absence, gapChanges, unseen } from './access.js'
import { columnChanges } from './columns.js'
import { allFields, byCodepoint, type Comparison, describe, type Draft, foreignKeyIn, identityKeyIn, objectIn, type Operation, refKey, stopped } from './context.js'
import { relationshipChanges } from './relationships.js'
import type { DriftChange, DriftReport, DriftSeverity, DriftSubject } from './types.js'

/**
 * What changed between the snapshot a form was generated from and the
 * database as it is now, classified by what it means for that form.
 *
 * Only what the form touches is compared: its root, and the targets of its
 * lookups. A change elsewhere in scope is not this form's business and is left
 * out, so an empty report means nothing this form rests on changed, not that
 * nothing changed. Equal fingerprints are the fast path: `createSnapshot`
 * promises they describe the same thing, so nothing is walked.
 *
 * Fails closed. A change the form cannot be sure is harmless stops the writes
 * it puts in doubt, and something that vanished behind a gap is an access
 * problem, never a deletion (0004). It throws, rather than guessing, when the
 * bindings were not generated from `base` or the two snapshots are of
 * different engines.
 */
export function diffSnapshots(base: MetadataSnapshot, current: MetadataSnapshot, bindings: FormBindings): DriftReport {
  if (bindings.snapshotFingerprint !== base.fingerprint) {
    throw new Error(`the bindings were generated from snapshot ${bindings.snapshotFingerprint}, not from the base snapshot ${base.fingerprint}`)
  }
  // Checked before the fast path, not after it: a fingerprint match says the
  // database did not change, and nothing about whether these bindings could
  // ever have come from it. Found in review: doctored bindings were accepted
  // whenever the two snapshots happened to be equal.
  const before = assertBindingsMatch(base, bindings)
  const offered = { ...bindings.operations }
  if (current.fingerprint === base.fingerprint) return { changes: [], blocking: false, writable: offered }
  if (current.kind !== base.kind) {
    throw new Error(`a ${base.kind} snapshot cannot be compared with a ${current.kind} one: a form's bindings belong to one engine`)
  }

  const after = findObject(current, bindings.root)
  if (after === undefined) return finish([rootMissing(current, bindings)], offered)

  const comparison: Comparison = { base, current, bindings, before, after, cited: new Set() }
  return finish(
    [
      ...rootKindChanges(comparison),
      ...columnChanges(comparison),
      ...relationshipChanges(comparison),
      // Last: a gap is reported on its own only when no change above gave it as its reason.
      ...gapChanges(comparison),
    ],
    offered,
  )
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

function subjectKey(subject: DriftSubject): string {
  if (subject.kind === 'scope') return ''
  return subject.kind === 'object' ? refKey(subject.object) : `${refKey(subject.object)}\u0000${subject.kind}\u0000${subject.name}`
}

/**
 * Severity, order and what is still writable, decided once for every change.
 *
 * Blocking when the change breaks what the form shows, or stops a write the
 * form offers; otherwise the change's own lesser severity. The same dropped
 * column is blocking for a form that binds it and a note for one that does not.
 */
function finish(drafts: readonly Draft[], offered: { create: boolean; update: boolean }): DriftReport {
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
    writable: { create: offered.create && !stops.has('create'), update: offered.update && !stops.has('update') },
  }
}
