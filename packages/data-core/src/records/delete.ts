import { deleteUnoffered, offers } from '../generate/offers.js'
import type { FormBindings } from '../generate/types.js'
import type { MetadataSnapshot } from '../metadata.js'
import { deleteProblems, deleteReach } from '../policy/cascades.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { driftRefusal } from './drift.js'
import { versionFits } from './plan.js'
import type { PlannedDelete } from './plan-types.js'
import { prepare, refuse, unaddressable } from './prepare.js'
import { filtersFor, throughFor } from './scope.js'
import { decodeRecordKey } from './token.js'
import type { DescribedTable } from './types.js'

/**
 * The delete of the record `recordToken` names, at the version its person
 * read, under the actor's filters and every through -- or why not (0050).
 *
 * Checks, in this order: the bindings against their snapshot; the root's
 * filter and every through, which authorise the delete and scope it as an
 * update is scoped -- and fit the policy to the form, which refuses a
 * delete granted to a role that may not read and one on a form whose rows
 * nothing scopes while a lookup's options are filtered; that the form
 * offers delete, with a confirmed token, as its own snapshot says it can;
 * a key a token can carry; what the delete also does, by the publish
 * check's own `deleteProblems`; the database as this request described it
 * (0041); and then the token and the version. The policy comes first, so a
 * person it refuses is told only that (0044).
 *
 * No field is asked: a delete writes none, and a key field the actor may
 * not read is no reason to refuse -- a delete hands out nothing but the
 * token it was sent, as a read does, where a list hands out one per row.
 *
 * Pure and isomorphic, as the other planners are.
 */
export function planDelete(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  policy: FormPolicy,
  context: PolicyContext,
  recordToken: string,
  expectedVersion: string,
  described: DescribedTable,
): PlannedDelete {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return ready
  const { prepared } = ready
  const filters = filtersFor(prepared, policy, context, 'delete')
  if (!filters.ok) return filters
  const through = throughFor(snapshot, bindings, prepared, policy, context, 'delete')
  if (!through.ok) return through
  const concurrency = prepared.target.concurrency
  if (!offers(bindings, 'delete') || concurrency === null) return refuse('operation-unavailable', 'This form does not offer delete.')
  // The generator's own rule, asked of the bindings' own snapshot: a hand
  // edit that offers what it would not is refused, never planned (0050).
  const unoffered = deleteUnoffered(prepared.root, prepared.target.identity.map((column) => column.name), concurrency)
  if (unoffered !== null) return refuse('invalid-bindings', `The bindings offer delete, and their snapshot says: ${unoffered}`)
  if (!prepared.addressable) return unaddressable(prepared)
  const problems = deleteProblems(snapshot, bindings, policy)
  if (problems.length > 0) return refuse('invalid-policy', problems.join('; '))
  const drifted = driftRefusal(snapshot, bindings, policy, described, 'delete')
  if (drifted !== undefined) return drifted
  const key = decodeRecordKey(prepared.target.identity, recordToken)
  if (!key.ok) return refuse('invalid-record-token', key.message)
  if (!versionFits(prepared, concurrency.kind, concurrency.column, expectedVersion)) {
    return refuse('invalid-version', `This is not a version a ${concurrency.kind} returns.`)
  }
  return {
    ok: true,
    request: {
      target: { ...prepared.target, concurrency },
      key: key.key,
      expectedVersion,
      filters: filters.filters,
      through: through.through,
      reach: deleteReach(snapshot, bindings.root).reach,
      definition: described.definition,
    },
  }
}
