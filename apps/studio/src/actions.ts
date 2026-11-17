import { actionUnoffered, generateForm, routineProblem, sourceProblem } from '@formancy/data-core'
import type { ActionChoice, ActionGround, MetadataSnapshot, ObjectMeta, ParameterSource, RoutineMeta, RoutineParameter, RoutineRef } from '@formancy/data-core'
import type { ProposalRequest } from './api.js'

/*
 * The routines of a connection offered as actions over the open record
 * (0159, 0163), as the Choose step offers them. Nothing is chosen for
 * anybody: no routine ticked, no parameter given a source. What the
 * generator refuses -- of the form, of a routine, of a source, of the
 * action as mapped -- is asked of the functions it runs, in the browser,
 * on the request the step would send, and said in their words before
 * anything is sent.
 */

/** A routine's identity, as one string: PostgreSQL's overloads share a schema and a name. */
export function routineKey(ref: RoutineRef): string {
  return `${ref.schema}\u0000${ref.name}\u0000${ref.signature}`
}

export function sameRoutine(left: RoutineRef, right: RoutineRef): boolean {
  return routineKey(left) === routineKey(right)
}

/** An action's longest name: what a run's URL carries (0159). */
const NAME_LENGTH = 64

/**
 * The name an action starts with: its routine's, in lower-case letters,
 * digits and hyphens as a run's URL carries it, made unique among the
 * names `taken` -- a starting point the administrator may type over, and
 * the generator's to refuse in its words.
 */
export function actionNameFor(routine: RoutineMeta, taken: readonly string[]): string {
  const base =
    routine.ref.name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '') || 'action'
  let name = base.slice(0, NAME_LENGTH)
  for (let count = 2; taken.includes(name); count += 1) name = `${base.slice(0, NAME_LENGTH - String(count).length - 1)}-${String(count)}`
  return name
}

/** The dialog field a parameter asked of the person is: its name without SQL Server's `@`, which the generator labels in words. */
export function inputFor(parameter: RoutineParameter): string {
  return parameter.name.replace(/^@/, '')
}

/** The attribute a parameter given a trusted attribute starts with: the one tenant isolation uses, as a pin starts with. */
export const STARTING_ATTRIBUTE = 'tenant'

/** One source a parameter could be given, as its control offers it: the select's value, its words, and the source the request names. */
export interface SourceOption {
  value: string
  label: string
  from: ParameterSource
}

/** The select's value of a source: one per kind, and for a key or a column, per column. */
export function sourceValue(from: ParameterSource): string {
  if ('key' in from) return `key:${from.key}`
  if ('field' in from) return `field:${from.field}`
  if ('input' in from) return 'input'
  if ('attribute' in from) return 'attribute'
  return 'actor'
}

function sourceLabel(from: ParameterSource): string {
  if ('key' in from) return `Key ${from.key}`
  if ('field' in from) return `Column ${from.field}`
  if ('input' in from) return 'Asked in its dialog'
  if ('attribute' in from) return 'A trusted attribute'
  return 'The person’s id'
}

/**
 * Every source the form could give `parameter`: each column of the
 * record's key, each column a column field is bound to, an answer of the
 * action's dialog, a trusted attribute and the person's id -- in that
 * order, and only those the generator binds, asked of `sourceProblem`, its
 * own rule for one source. A key column is offered as the key alone,
 * which any reader may pass, never again as a column the policy must let
 * them read. `current`, where the choice gives it one the generator now
 * refuses, stays listed, so the refusal said under the action can be
 * answered here.
 */
export function sourceOptions(root: ObjectMeta, ground: ActionGround, parameter: RoutineParameter, current: ParameterSource | undefined): SourceOption[] {
  const key = ground.identity ?? []
  const candidates: ParameterSource[] = [
    ...key.map((column) => ({ key: column })),
    ...ground.fields.flatMap((binding) => (binding.kind === 'column' && !key.includes(binding.column) ? [{ field: binding.column }] : [])),
    { input: inputFor(parameter) },
    { attribute: current !== undefined && 'attribute' in current ? current.attribute : STARTING_ATTRIBUTE },
    { actor: 'id' },
  ]
  return candidates
    .filter((from) => sourceProblem(root, ground, parameter, from) === null || (current !== undefined && sourceValue(current) === sourceValue(from)))
    .map((from) => ({ value: sourceValue(from), label: sourceLabel(from), from }))
}

/** What the step says of the actions, for the choice as it stands. */
export interface ActionReasons {
  /** What an action rests on, as the generator decided it from the rest of the choice; `null` where that request is refused itself, which Generate sends and says. */
  ground: ActionGround | null
  /** Why the form offers no action at all, in the generator's words; `null` where it may. */
  unoffered: string | null
  /** By `routineKey`: why the generator refuses a routine whatever its parameters are given. */
  routines: ReadonlyMap<string, string>
  /** By action name: the generator's note refusing the action as it is mapped. */
  chosen: ReadonlyMap<string, string>
  /** What the generator throws of the actions as a whole -- a name no URL carries, two of one name -- which the server refuses the request for. */
  thrown: string | null
}

const NOTHING: ActionReasons = { ground: null, unoffered: null, routines: new Map(), chosen: new Map(), thrown: null }

/** The generator on `request`, as the server runs it on a proposal: the id and the title set to ones it accepts, since neither decides an action. */
function generated(snapshot: MetadataSnapshot, request: ProposalRequest): ReturnType<typeof generateForm> | { refused: string } {
  try {
    return generateForm(snapshot, { ...request, formId: 'actions', title: 'Actions' })
  } catch (error) {
    return { refused: (error as Error).message }
  }
}

/**
 * Why each part of the actions in `request` would be refused: the form,
 * asked of `actionUnoffered` over what the generator made of the request
 * without its actions; each routine, asked of `routineProblem`; and each
 * action as mapped, the generator's own blocked note on the whole request
 * -- or, where it throws, that sentence, which the server answers 422
 * with. Where the request without actions is refused itself, nothing is
 * said here.
 */
export function actionReasons(snapshot: MetadataSnapshot, root: ObjectMeta, request: ProposalRequest): ActionReasons {
  const { actions = [], ...plain } = request
  const base = generated(snapshot, plain)
  if ('refused' in base) return NOTHING
  const { identity, concurrency, fields } = base.bindings
  const ground: ActionGround = { identity, concurrency, fields }
  const all = snapshot.routines ?? []
  const routines = new Map(
    all.flatMap((routine) => {
      const problem = routineProblem(snapshot.kind, all, routine)
      return problem === null ? [] : [[routineKey(routine.ref), problem] as const]
    }),
  )
  const chosen = new Map<string, string>()
  let thrown: string | null = null
  if (actions.length > 0) {
    const asked = generated(snapshot, request)
    if ('refused' in asked) thrown = asked.refused
    else
      for (const note of asked.notes)
        if (note.kind === 'blocked' && actions.some((action) => action.name === note.subject)) chosen.set(note.subject, note.message)
  }
  return { ground, unoffered: actionUnoffered(snapshot.kind, root, identity, concurrency), routines, chosen, thrown }
}

/** A choice of `routine` as an action, as it is first ticked: named, over the open record, and no parameter given anything. */
export function startingAction(routine: RoutineMeta, taken: readonly string[]): ActionChoice {
  return { name: actionNameFor(routine, taken), routine: { ...routine.ref }, scope: 'record', parameters: [] }
}

/** `action` with `parameter` given `from`, or given nothing for `undefined`, its parameters kept in the routine's order. */
export function withSource(action: ActionChoice, routine: RoutineMeta, parameter: string, from: ParameterSource | undefined): ActionChoice {
  const given = new Map(action.parameters.map((entry) => [entry.parameter, entry.from]))
  if (from === undefined) given.delete(parameter)
  else given.set(parameter, from)
  return {
    ...action,
    parameters: routine.parameters.flatMap((entry) => {
      const source = given.get(entry.name)
      return source === undefined ? [] : [{ parameter: entry.name, from: { ...source } }]
    }),
  }
}

/** What a routine is, in one line: its kind, what it returns and changes, its parameters, and what the engine lets it reach. */
export function routineFacts(routine: RoutineMeta): string {
  const returns =
    routine.returns === 'void' ? 'returns nothing' : routine.returns === 'set' ? 'returns rows' : `returns ${routine.result?.databaseType ?? 'a value'}`
  const parameters =
    routine.parameters.length === 0
      ? 'no parameter'
      : routine.parameters
          .map(
            (parameter) =>
              `${parameter.mode === 'in' ? '' : `${parameter.mode} `}${parameter.name === '' ? '(unnamed)' : parameter.name} ${parameter.databaseType}`,
          )
          .join(', ')
  return [
    routine.kind,
    returns,
    routine.effects === 'reads' ? 'reads only' : 'may write',
    parameters,
    ...(routine.reach === 'owner' ? ['may act beyond this connection’s own grants'] : []),
    ...(routine.executable ? [] : ['this connection may not execute it']),
  ].join(' · ')
}
