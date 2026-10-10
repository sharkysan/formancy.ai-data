import { diffRootDefinition } from '../drift/diff.js'
import type { DriftReport, DriftVerdict } from '../drift/types.js'
import type { FormBindings } from '../generate/types.js'
import type { MetadataSnapshot } from '../metadata.js'
import type { FormPolicy } from '../policy/types.js'
import type { PlanRefusal } from './plan-types.js'
import { refuse } from './prepare.js'
import type { DescribedTable } from './types.js'

/*
 * What a request decides about drift (0041): the published form against its
 * root as the catalog described it in that request, by drift review's own
 * root-definition families (`diffRootDefinition`), per operation as 0010
 * decides it. One decision, so the runtime refuses what review's root
 * families stop and nothing else.
 *
 * The sentences are what a person is shown. They never name a column or a
 * type: which changed is the administrator's to read in drift review, and the
 * refusal's `drift` list is for the server's log.
 */

export const READ_REFUSED = 'The database changed since this form was published, and the form can no longer show its records faithfully. An administrator must review it.'
export const WRITE_REFUSED = 'The database changed since this form was published, in a way this form cannot save safely. Nothing was saved; an administrator must review the form.'
export const NOTHING_LEFT = 'The database changed since this form was published, and nothing this form offers you can be done safely until an administrator reviews it.'

/** The report a request decides by, or `invalid-bindings` when the bindings cannot be compared with their own snapshot. */
function reportOf(snapshot: MetadataSnapshot, bindings: FormBindings, policy: Pick<FormPolicy, 'lookups'>, described: DescribedTable): { ok: true; report: DriftReport } | PlanRefusal {
  const { definition: _definition, ...root } = described
  try {
    return { ok: true, report: diffRootDefinition(snapshot, root, bindings, policy) }
  } catch (error) {
    // diffRootDefinition throws an Error naming what does not fit, and only for
    // bindings the planner and the bundle's check refuse before this is asked.
    return refuse('invalid-bindings', `The bindings cannot be compared with the database: ${(error as Error).message}.`)
  }
}

/** A drift refusal, with what the log names: each change that blocks, by kind and the fields it affects. */
function refused(message: string, report: DriftReport): PlanRefusal {
  return { ...refuse('drift', message), drift: report.changes.filter((change) => change.severity === 'blocking') }
}

/**
 * The refusal of `operation` on the form as the database is described now,
 * or `undefined` when the description allows it: a read when a change breaks
 * what the form shows, a create or an update when a change stops it.
 */
export function driftRefusal(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  policy: Pick<FormPolicy, 'lookups'>,
  described: DescribedTable,
  operation: 'read' | 'create' | 'update',
): PlanRefusal | undefined {
  const found = reportOf(snapshot, bindings, policy, described)
  if (!found.ok) return found
  const { report } = found
  if (operation === 'read') return report.readable ? undefined : refused(READ_REFUSED, report)
  return report.writable[operation] ? undefined : refused(WRITE_REFUSED, report)
}

/**
 * What opening the form may offer, by the description: the verdict, with the
 * blocking changes for the log when it refuses something. `GET` lists the
 * operations the policy grants that it allows, and is refused when it allows
 * none of them.
 */
export function runtimeOperations(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  policy: Pick<FormPolicy, 'lookups'>,
  described: DescribedTable,
): { ok: true; verdict: DriftVerdict; drift: DriftReport['changes'] } | PlanRefusal {
  const found = reportOf(snapshot, bindings, policy, described)
  if (!found.ok) return found
  return { ok: true, verdict: found.report.runtime, drift: found.report.changes.filter((change) => change.severity === 'blocking') }
}
