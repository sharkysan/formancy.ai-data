import type { FormBindings } from '../generate/types.js'
import { checkTransition, stateField } from '../policy/evaluate.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import type { FormRecord, PlanRefusal } from './plan-types.js'
import { refuse } from './prepare.js'
import type { RecordValue } from './types.js'

/*
 * The move a create or an update makes of a policy's state field (0112),
 * decided from what the planner is about to write: the field's column
 * among the values, against the record as its person read it -- the
 * version they name guards that read, so the state the move starts from is
 * the state the write finds, or the write is stale.
 */

/** Whether a planned write moves the state field: `null` when its policy names no moves. */
export type PlannedMove = { ok: true; moved: boolean | null } | PlanRefusal

/**
 * The move writing `values` makes of the state field, or why it is no
 * move this actor may make. No move without a rule (`moved: null`), with
 * the field not written, or written with the value the record already
 * holds (`false`). No move ends at NULL, so emptying the field is refused;
 * a create that writes NULL starts nowhere, as one that leaves the field
 * to its default starts where the schema puts it. `asRead` is the record
 * as read before an update, `undefined` when it could not be, and `null`
 * on create, whose move starts from nothing; a stored NULL starts from
 * nothing too. An update whose record could not be read cannot say where
 * the field moves from, and is refused, as the move could not be checked.
 * `expectedVersion` is the version the update names, `null` on create.
 */
export function planMove(
  policy: FormPolicy,
  context: PolicyContext,
  bindings: FormBindings,
  values: readonly RecordValue[],
  asRead: FormRecord | null | undefined,
  expectedVersion: string | null = null,
): PlannedMove {
  const field = stateField(policy)
  if (field === null) return { ok: true, moved: null }
  const binding = bindings.fields.find((candidate) => candidate.field === field)
  if (binding === undefined || binding.kind !== 'column') return { ok: true, moved: null }
  const written = values.find((value) => value.name === binding.column)
  if (written === undefined) return { ok: true, moved: false }
  if (asRead === undefined) return refuse('transition-denied', `${field} moves only from where the record is, and this record could not be read to say.`)
  const held = asRead === null ? null : asRead.answers[field]
  const from = held === null || held === undefined ? null : String(held)
  const to = written.value === null ? null : String(written.value)
  if (from === to) return { ok: true, moved: false }
  // Read at another version than the update names: the person moves from a
  // state they never read, and the version guard refuses the write as stale
  // whatever it moves, which is the answer they need -- not a refusal of a
  // move from where the record went since (0040's echo is decided alike).
  if (asRead !== null && expectedVersion !== null && asRead.version !== expectedVersion) return { ok: true, moved: true }
  if (to === null) return refuse('transition-denied', `${field} may not move from where it is to no value: every move ends at one.`)
  const decision = checkTransition(policy, context, bindings, from, to)
  return decision.ok ? { ok: true, moved: true } : refuse(decision.code, decision.message)
}
