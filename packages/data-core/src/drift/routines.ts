import { canonicalize } from '@formancy/spec'
import type { ActionBinding } from '../actions/types.js'
import { ambiguousBeside, fitProblem } from '../generate/actions.js'
import { touchColumnProblem } from '../generate/together.js'
import type { FormBindings } from '../generate/types.js'
import type { CoverageGap, MetadataSnapshot, ObjectMeta } from '../metadata.js'
import { describeRoutine, recordsRoutines, type RoutineMeta, type RoutineRef } from '../routines.js'
import { gapCovers } from '../snapshot.js'
import { cite } from './access.js'
import { type Comparison, type Draft, sameRef } from './context.js'
import type { DriftKind } from './types.js'

/*
 * What changed of the routines a form's actions bind, and of the others
 * in scope (0159), classified against the bindings as every change is
 * (0010): a bound routine gone, changed in what a call rests on, no
 * longer executable, or out of sight stops the actions over it, and only
 * them; one that reaches past its caller's grants where it did not, or no
 * longer, is for a person to review. A routine no action binds is said,
 * and stops nothing, between two snapshots that both record routines --
 * one that did not ask never saw a routine (0158).
 *
 * A routine's body is never compared. It is the deployment's logic, which
 * changes as their system does, and on SQL Server reading it needs VIEW
 * DEFINITION, which an account that may execute need not hold. A changed
 * body is not drift.
 */

/** A routine's identity, as one string. */
function routineKey(ref: RoutineRef): string {
  return `${ref.schema}\u0000${ref.name}\u0000${ref.signature}`
}

function findRoutine(snapshot: MetadataSnapshot, ref: RoutineRef): RoutineMeta | undefined {
  return snapshot.routines?.find((routine) => routineKey(routine.ref) === routineKey(ref))
}

/**
 * What a call of a routine rests on, as one string: its kind, what it
 * returns, and each parameter's name, type identity and mode, in order.
 * Not its reach, which is review's, nor whether it may be executed, which
 * the database answers itself (0027), nor its body. A request's
 * description of the routine is compared by the same string (`actions/plan.ts`),
 * so the runtime refuses exactly what review's `routine-changed` stops.
 */
export function callShape(routine: Pick<RoutineMeta, 'kind' | 'returns' | 'result' | 'parameters'>): string {
  return canonicalize({
    kind: routine.kind,
    returns: routine.returns,
    result: routine.result?.typeId ?? null,
    parameters: routine.parameters.map((parameter) => [parameter.name, parameter.typeId, parameter.mode]),
  })
}

/** The actions bound to each routine, by the routine's key, in the bindings' order. */
function boundRoutines(bindings: FormBindings): Map<string, { ref: RoutineRef; actions: string[] }> {
  const bound = new Map<string, { ref: RoutineRef; actions: string[] }>()
  for (const action of bindings.actions ?? []) {
    const key = routineKey(action.routine)
    const entry = bound.get(key)
    if (entry === undefined) bound.set(key, { ref: action.routine, actions: [action.name] })
    else entry.actions.push(action.name)
  }
  return bound
}

function draft(kind: DriftKind, ref: RoutineRef, actions: readonly string[], message: string, otherwise: 'review' | 'info' = 'info'): Draft {
  return { kind, subject: { kind: 'routine', routine: { ...ref } }, affects: [], stops: [], breaksReads: false, otherwise, actions: [...actions], message }
}

const STOPPED = (actions: readonly string[]) => `${actions.join(', ')} ${actions.length === 1 ? 'is' : 'are'} blocked until the form is reviewed.`

/** A bound routine not in the current snapshot: out of scope, out of sight behind a gap, or gone -- the order `absence` keeps for a table. */
function missingRoutine(comparison: Comparison, ref: RoutineRef, actions: readonly string[]): Draft {
  const named = describeRoutine(ref)
  if (!comparison.current.scope.schemas.includes(ref.schema)) {
    return draft(
      'scope-narrowed',
      ref,
      actions,
      `${named} is outside the discovery scope: ${ref.schema} is no longer a schema discovery is approved for. ${STOPPED(actions)}`,
    )
  }
  const gaps: CoverageGap[] = comparison.current.gaps.filter((gap) => gap.aspect === 'routines' && gapCovers(gap, { schema: ref.schema, name: ref.name }))
  if (gaps.length > 0) {
    return cite(
      comparison,
      gaps,
      draft(
        'access-narrowed',
        ref,
        actions,
        `${named} is not visible to this connection: ${gaps.map((gap) => `"${gap.detail}"`).join('; ')}. This is an access problem, not a deletion. ${STOPPED(actions)}`,
      ),
    )
  }
  return draft('routine-dropped', ref, actions, `${named} is gone, and no gap says this connection lost sight of it. ${STOPPED(actions)}`)
}

/** What changed of one routine an action binds, present in both snapshots. */
function boundChanges(comparison: Comparison, was: RoutineMeta, is: RoutineMeta, actions: readonly string[]): Draft[] {
  const named = describeRoutine(is.ref)
  const drafts: Draft[] = []
  if (callShape(was) !== callShape(is)) {
    drafts.push(
      draft(
        'routine-changed',
        is.ref,
        actions,
        `${named} changed what a call of it rests on: its kind, what it returns, or its parameters. ${STOPPED(actions)}`,
      ),
    )
  }
  const beside = ambiguousBeside(comparison.current.routines ?? [], is)
  if (beside !== undefined && ambiguousBeside(comparison.base.routines ?? [], was) === undefined) {
    // An overload that was there and changed -- a default added, a parameter renamed -- is not a new routine.
    const existed = findRoutine(comparison.base, beside.ref) !== undefined
    const ambiguous = `has a parameter of each of ${named}'s names and types and a default for every other, so every call of ${named} by name is now ambiguous`
    drafts.push(
      draft(
        existed ? 'routine-changed' : 'routine-added',
        beside.ref,
        actions,
        `${describeRoutine(beside.ref)} ${existed ? 'changed, and now' : 'is new, and'} ${ambiguous}. ${STOPPED(actions)}`,
      ),
    )
  }
  if (was.executable && !is.executable) {
    drafts.push(
      draft(
        'privilege-narrowed',
        is.ref,
        actions,
        `This connection's account may no longer execute ${named}. ${STOPPED(actions)} This is a privilege change, not a schema change.`,
      ),
    )
  }
  if (was.reach !== is.reach) {
    drafts.push(
      draft(
        'routine-reach-changed',
        is.ref,
        [],
        is.reach === 'owner'
          ? `${named} now acts as its owner (SECURITY DEFINER), beyond this connection's account's own grants. Nothing is stopped; review whether ${actions.join(', ')} should run it.`
          : `${named} no longer acts as its owner, and now runs within this connection's account's own grants. Nothing is stopped.`,
        'review',
      ),
    )
  }
  if (drafts.length === 0 && canonicalize(was) !== canonicalize(is)) {
    drafts.push(
      draft(
        'routine-changed',
        is.ref,
        [],
        `${named} changed in what a call of it does not rest on: what it may change, or a parameter's default. Nothing is stopped.`,
        'review',
      ),
    )
  }
  return drafts
}

/** What changed of the routines no action binds, as notes: compared only between two snapshots that both record routines (0158). */
function unboundChanges(comparison: Comparison, bound: ReadonlySet<string>, said: ReadonlySet<string>): Draft[] {
  const { base, current } = comparison
  const was = new Map((base.routines ?? []).map((routine) => [routineKey(routine.ref), routine]))
  const is = new Map((current.routines ?? []).map((routine) => [routineKey(routine.ref), routine]))
  const drafts: Draft[] = []
  for (const [key, routine] of is) {
    if (bound.has(key) || said.has(key)) continue
    const before = was.get(key)
    if (before === undefined) drafts.push(draft('routine-added', routine.ref, [], `${describeRoutine(routine.ref)} is new. No action binds it.`))
    else if (canonicalize(before) !== canonicalize(routine))
      drafts.push(draft('routine-changed', routine.ref, [], `${describeRoutine(routine.ref)} changed. No action binds it.`))
  }
  for (const [key, routine] of was) {
    if (bound.has(key) || is.has(key)) continue
    const hidden = current.gaps.some((gap) => gap.aspect === 'routines' && gapCovers(gap, { schema: routine.ref.schema, name: routine.ref.name }))
    // Out of sight is not gone: the gap reports itself.
    if (!hidden) drafts.push(draft('routine-dropped', routine.ref, [], `${describeRoutine(routine.ref)} is gone. No action binds it.`))
  }
  return drafts
}

/**
 * The routines family (0159): every routine an action binds against the
 * current snapshot, and every other between two snapshots that both
 * record routines. Where the current one does not record them, whether a
 * bound routine is still there cannot be said, and each action over one
 * is stopped, as a column out of sight stops what rests on it (0004).
 */
export function routineChanges(comparison: Comparison): Draft[] {
  const { base, current, bindings } = comparison
  const bound = boundRoutines(bindings)
  if (!recordsRoutines(current)) {
    return [...bound.values()].map(({ ref, actions }) =>
      draft(
        'access-narrowed',
        ref,
        actions,
        `This snapshot was discovered without routines, so whether ${describeRoutine(ref)} is still there, and still the same, cannot be said. ${STOPPED(actions)} Discover with routines to review it.`,
      ),
    )
  }
  const drafts: Draft[] = []
  for (const [key, { ref, actions }] of bound) {
    // `entered` refused bindings whose routine the base snapshot lacks.
    const was = findRoutine(base, ref) as RoutineMeta
    const is = current.routines?.find((routine) => routineKey(routine.ref) === key)
    drafts.push(...(is === undefined ? [missingRoutine(comparison, ref, actions)] : boundChanges(comparison, was, is, actions)))
  }
  if (!recordsRoutines(base)) return drafts
  const said = new Set(
    drafts.filter((entry) => entry.subject.kind === 'routine').map((entry) => routineKey((entry.subject as { routine: RoutineRef }).routine)),
  )
  return [...drafts, ...unboundChanges(comparison, new Set(bound.keys()), said)]
}

/**
 * The actions a request may still run against the routines as `current`
 * records them (0159): those whose routine is there with the call shape it
 * was bound with. What a request compares of a routine, beside the root;
 * where `current` does not record routines, each request describes its
 * routine itself, and nothing is taken away here.
 */
export function runtimeRoutineStops(base: MetadataSnapshot, current: MetadataSnapshot, bindings: FormBindings): Set<string> {
  const stopped = new Set<string>()
  if (!recordsRoutines(current)) return stopped
  for (const action of bindings.actions ?? []) {
    const was = findRoutine(base, action.routine)
    const is = findRoutine(current, action.routine)
    if (was === undefined || is === undefined || callShape(was) !== callShape(is)) stopped.add(action.name)
  }
  return stopped
}

/** Kinds whose stop of delete alone is about what a delete does -- its grant, what refers to the root -- and never about the record's address. */
const DELETE_ALONE: ReadonlySet<DriftKind> = new Set(['referrer-added', 'referrer-changed', 'privilege-narrowed', 'access-narrowed'])

/**
 * Whether `column` of the root, as it is now, still serves `action` where
 * the action rests on it: as its move, a column the account may read and
 * UPDATE, or a touch column (0155); as a column it passes, one the account
 * may read and whose values its parameter holds. Gone, it serves nothing.
 */
function stillServes(
  action: ActionBinding,
  name: string,
  column: ObjectMeta['columns'][number] | undefined,
  root: ObjectMeta | undefined,
  bindings: FormBindings,
): boolean {
  if (column === undefined) return false
  if (action.move.column === name) {
    const moves =
      action.move.kind === 'increment'
        ? column.access.select && column.access.update
        : root !== undefined && touchColumnProblem(root, bindings.identity ?? [], name) === null
    if (!moves) return false
  }
  return action.parameters
    .filter((parameter) => (parameter.from.kind === 'field' || parameter.from.kind === 'key') && parameter.from.column === name)
    .every((parameter) => column.access.select && fitProblem(column, parameter) === null)
}

/**
 * The actions a change of the root stops (0159), decided once for review
 * and for the runtime:
 *
 * - every one, where the change breaks what the form reads, or stops update
 *   and delete together -- the key and the token a run locates and guards
 *   its record by, or a table become a view;
 * - every one, where it stops delete for another reason than what a delete
 *   alone does: a version that no longer proves the record, the rule a run
 *   keeps with delete (`actionUnoffered`);
 * - each one that rests on the column the change is about, where the
 *   column as it is now no longer serves it: its move column no longer one
 *   the account may read and UPDATE, or no longer a touch column (0155);
 *   a column it passes no longer readable, or holding values its
 *   parameter cannot (`fitProblem`, the generator's own rule).
 */
export function rootActionStops(bindings: FormBindings, after: ObjectMeta | undefined, change: Draft): string[] {
  const actions = bindings.actions ?? []
  if (change.actions !== undefined) return [...change.actions]
  if (actions.length === 0) return []
  const all = actions.map((action) => action.name)
  if (change.breaksReads) return all
  if (change.stops.includes('update') && change.stops.includes('delete')) return all
  if (change.stops.includes('delete') && !DELETE_ALONE.has(change.kind)) return all
  if (change.subject.kind !== 'column' || !sameRef(change.subject.object, bindings.root)) return []
  const name = change.subject.name
  const column = after?.columns.find((candidate) => candidate.name === name)
  const rests = (action: ActionBinding) =>
    action.move.column === name ||
    action.parameters.some((parameter) => (parameter.from.kind === 'field' || parameter.from.kind === 'key') && parameter.from.column === name)
  return actions.filter((action) => rests(action) && !stillServes(action, name, column, after, bindings)).map((action) => action.name)
}
