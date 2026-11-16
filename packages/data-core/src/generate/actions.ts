import type { ActionBinding, ActionChoice, ActionMove, ActionParameter, BoundSource, ParameterSource } from '../actions/types.js'
import type { DatabaseKind } from '../adapter.js'
import type { MetadataSnapshot, NormalizedType, ObjectMeta } from '../metadata.js'
import { describeRoutine, recordsRoutines, type RoutineMeta, type RoutineParameter, type RoutineType } from '../routines.js'
import { gapCovers } from '../snapshot.js'
import { dialogFor } from './action-dialog.js'
import { controlFor } from './controls.js'
import { fieldKeyFor } from './names.js'
import { actionMove, actionUnoffered } from './offers.js'
import type { ConcurrencyBinding, FieldBinding, GenerationNote, GenerationRequest } from './types.js'

/*
 * The actions a form offers (0159): each routine the request names, held
 * to the rules a run rests on, bound with where each of its parameters
 * comes from and the dialog a person answers first -- or refused with a
 * `blocked` note that says which rule refused it (0009), and left out.
 *
 * A request that is not one -- a name no URL can carry, two actions of
 * one name, a source of no kind this release reads -- is thrown, as an
 * unknown root is. A routine that cannot be bound is a note, never a
 * throw: a regeneration against a database whose routine changed must
 * still produce the form, without the action, and say why.
 */

/** An action's name: what a run's URL carries, so lower-case letters, digits and hyphens, at most 64. */
const ACTION_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

/** A SQL Server parameter's name as an EXEC can pass it, `@p = @v`, where it cannot be quoted: a regular identifier. */
const SQLSERVER_PARAMETER = /^@[A-Za-z_][A-Za-z0-9_]{0,127}$/

/** The kinds an attribute or the actor's id -- text in the verified context -- can be given as, through the parameter's codec. */
const FROM_CONTEXT: ReadonlySet<NormalizedType['kind']> = new Set(['text', 'integer', 'uuid'])

/**
 * The kinds a parameter can be passed as: those both adapters' routine
 * type tables normalise to (0158), each a built-in type a cast is spelled
 * from. Discovery records every other type `unsupported`; a snapshot that
 * names a binary or a rowversion parameter was not written by it, and no
 * cast could be spelled for one.
 */
const PASSABLE: ReadonlySet<NormalizedType['kind']> = new Set(['text', 'boolean', 'integer', 'decimal', 'float', 'date', 'time', 'timestamp', 'uuid'])

/**
 * SQL Server's temporal types whose precision is the digits they keep, as
 * the adapter spells a column or a parameter of one: time(n), datetime2(n)
 * and datetimeoffset(n). Not datetime and smalldatetime, whose catalog
 * scale of 3 and 0 is not what they keep -- 1/300 s and whole minutes
 * (0007) -- nor an alias type, spelled by its own name, which says
 * neither.
 */
const SCALED_CLOCK = /^(?:time|datetime2|datetimeoffset)\(\d\)$/

/** What the generator already decided of the form, which an action rests on. */
export interface ActionGround {
  identity: readonly string[] | null
  concurrency: ConcurrencyBinding | null
  fields: readonly FieldBinding[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is a parameter's source as a request spells one: exactly one of the five, with a name, or the actor's `id`. */
export function isParameterSource(value: unknown): value is ParameterSource {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1) return false
  const [kind] = keys as [string]
  const named = value[kind]
  if (kind === 'actor') return named === 'id'
  return ['field', 'key', 'input', 'attribute'].includes(kind) && typeof named === 'string' && named !== ''
}

/** What no request could mean, thrown naming it: before any action is bound, so a form never carries half of what was asked. */
function assertChoices(choices: readonly ActionChoice[]): void {
  const names = new Set<string>()
  for (const choice of choices as readonly unknown[]) {
    if (!isRecord(choice)) throw new Error('an action is { name, routine, scope, parameters }')
    const { name, routine, scope, parameters } = choice
    if (typeof name !== 'string' || !ACTION_NAME.test(name))
      throw new Error(`action name ${JSON.stringify(name)} is not lower-case letters, digits and hyphens, starting with a letter or a digit, at most 64`)
    if (names.has(name)) throw new Error(`two actions are named ${name}`)
    names.add(name)
    if (!isRecord(routine) || typeof routine['schema'] !== 'string' || typeof routine['name'] !== 'string' || typeof routine['signature'] !== 'string')
      throw new Error(`action ${name} names no routine as { schema, name, signature }`)
    if (scope !== 'record') throw new Error(`action ${name} has scope ${JSON.stringify(scope)}; this release runs an action over the open record alone`)
    if (!Array.isArray(parameters)) throw new Error(`action ${name}'s parameters are not a list`)
    for (const entry of parameters as unknown[]) {
      if (!isRecord(entry) || typeof entry['parameter'] !== 'string' || !isParameterSource(entry['from']))
        throw new Error(`action ${name}: each parameter is { parameter, from: { field } | { key } | { input } | { attribute } | { actor: 'id' } }`)
      const from = entry['from']
      if ('input' in from && fieldKeyFor(from.input) !== from.input)
        throw new Error(`action ${name}: input ${JSON.stringify(from.input)} is not a field key formancy accepts`)
    }
  }
}

/** The routine a choice names, by schema, name and signature. */
function routineOf(snapshot: MetadataSnapshot, choice: ActionChoice): RoutineMeta | undefined {
  const { schema, name, signature } = choice.routine
  return snapshot.routines?.find((routine) => routine.ref.schema === schema && routine.ref.name === name && routine.ref.signature === signature)
}

/** The parameters a call passes, in order: PostgreSQL's in, inout and variadic arguments, which are what its signature names. */
function passed(routine: RoutineMeta): RoutineParameter[] {
  return routine.parameters.filter((parameter) => parameter.mode === 'in' || parameter.mode === 'inout' || parameter.mode === 'variadic')
}

/**
 * The overload beside which every run of `routine` is ambiguous on
 * PostgreSQL (0158, R7), or `undefined`. A run calls by named notation,
 * each argument cast to its parameter's type, so PostgreSQL weighs every
 * function of the schema and name with a parameter of each name the call
 * passes and a default for every other, and prefers the one whose types
 * match exactly. One with a parameter of each of this one's names and
 * types, in any order, and a default for every other parameter, matches as
 * exactly: the call is 42725 every time. One that lacks a name, types one
 * otherwise or has another parameter without a default is no candidate or
 * the poorer match. Always `undefined` on SQL Server, which has no
 * overloads.
 */
export function ambiguousBeside(routines: readonly RoutineMeta[], routine: RoutineMeta): RoutineMeta | undefined {
  const mine = passed(routine)
  return routines.find((other) => {
    if (other.ref.schema !== routine.ref.schema || other.ref.name !== routine.ref.name || other.ref.signature === routine.ref.signature) return false
    const theirs = passed(other)
    return (
      mine.every((parameter) => theirs.some((candidate) => candidate.name === parameter.name && candidate.typeId === parameter.typeId)) &&
      theirs.every((candidate) => candidate.hasDefault === true || mine.some((parameter) => parameter.name === candidate.name))
    )
  })
}

/** Why a routine no run could call, or `null`: the shape each engine's run rests on (0159). */
export function routineProblem(kind: DatabaseKind, routines: readonly RoutineMeta[], routine: RoutineMeta): string | null {
  const named = describeRoutine(routine.ref)
  if (!routine.executable) return `this connection's account may not execute ${named}`
  if (kind === 'postgres') {
    if (routine.kind === 'procedure')
      return `${named} is a procedure, which may COMMIT inside itself; a run calls a function, in the statement that names each record`
    if (routine.returns !== 'void')
      return `${named} returns ${routine.returns === 'set' ? 'rows' : 'a value'}, which a run would throw away: a function a run calls returns void, so it has nothing to report failure by but an error`
  } else if (routine.kind === 'function') {
    return `${named} is a function, which SQL Server forbids to write; a run calls a procedure`
  }
  for (const parameter of routine.parameters) {
    if (parameter.mode !== 'in')
      return `${named} has ${parameter.mode} parameter ${parameter.name === '' ? 'without a name' : parameter.name}, and a run passes in parameters alone`
    if (parameter.name === '') return `${named} has a parameter without a name, and a run passes every parameter by its name`
    if (kind === 'sqlserver' && !SQLSERVER_PARAMETER.test(parameter.name))
      return `${named}'s parameter ${parameter.name} is not a regular identifier, which an EXEC passes by name without quoting`
    if (!PASSABLE.has(parameter.type.kind)) return `${named}'s parameter ${parameter.name} is ${parameter.databaseType}, which no codec this release has speaks`
  }
  const beside = kind === 'postgres' ? ambiguousBeside(routines, routine) : undefined
  if (beside !== undefined)
    return `beside ${describeRoutine(beside.ref)}, which has a parameter of each of its names and types and a default for every other, every call of ${named} by name is ambiguous`
  return null
}

/** A column or a parameter as `fitProblem` compares it: what it holds, and how the database spells it. */
export type Fitted = Pick<RoutineType, 'databaseType' | 'type'>

/**
 * Why column `held` cannot be passed to `parameter`, or `null`: the kinds
 * are one, and every value the column holds is one the parameter holds --
 * its range, its precision and scale, its length in the same unit, its
 * characters, its zone. A PostgreSQL parameter keeps no length, precision
 * or scale (0158), so there it is unbounded and only the kind, the range
 * and the zone are compared: where the engines differ, it is the catalog
 * that says less, never this rule.
 */
export function fitProblem(held: Fitted, parameter: Fitted): string | null {
  const [column, taken] = [held.type, parameter.type]
  if (column.kind !== taken.kind) return `it holds ${column.kind}, and the parameter takes ${taken.kind}`
  const wider = 'it holds values the parameter cannot'
  switch (taken.kind) {
    case 'text': {
      const text = column as Extract<NormalizedType, { kind: 'text' }>
      // A text of a code page holds no character outside it, and SQL Server
      // writes one as `?` without an error (0026): only a text of a code page
      // passes to one, however long.
      if (taken.lengthUnit === 'code-page-bytes' && text.lengthUnit !== 'code-page-bytes')
        return 'it holds characters the parameter’s code page may lack, which SQL Server would replace without an error'
      if (taken.maxLength === null) return null
      if (text.maxLength === null || text.lengthUnit !== taken.lengthUnit || text.maxLength > taken.maxLength) return wider
      return null
    }
    case 'integer': {
      const integer = column as Extract<NormalizedType, { kind: 'integer' }>
      return BigInt(integer.min) >= BigInt(taken.min) && BigInt(integer.max) <= BigInt(taken.max) ? null : wider
    }
    case 'decimal': {
      const decimal = column as Extract<NormalizedType, { kind: 'decimal' }>
      if (taken.precision === null) return null
      if (decimal.precision === null) return wider
      const [scale, given] = [taken.scale ?? 0, decimal.scale ?? 0]
      return decimal.precision - given <= taken.precision - scale && given <= scale ? null : wider
    }
    case 'float':
      return (column as Extract<NormalizedType, { kind: 'float' }>).bits <= taken.bits ? null : wider
    case 'time':
    case 'timestamp': {
      const clock = column as Extract<NormalizedType, { kind: 'time' | 'timestamp' }>
      if (taken.kind === 'timestamp' && (clock as Extract<NormalizedType, { kind: 'timestamp' }>).withTimeZone !== taken.withTimeZone)
        return 'its time zone is not the parameter’s'
      // PostgreSQL keeps none for a parameter (0158), which holds microseconds, as many as any column.
      if (taken.precision === null) return null
      if (!SCALED_CLOCK.test(held.databaseType) || !SCALED_CLOCK.test(parameter.databaseType)) {
        if (held.databaseType === parameter.databaseType) return null
        return `it is ${held.databaseType} and the parameter ${parameter.databaseType}, and SQL Server's datetime and smalldatetime keep 1/300 s and whole minutes whatever their scale says, so each fits its own type alone`
      }
      return clock.precision !== null && clock.precision <= taken.precision ? null : wider
    }
    default:
      return null
  }
}

/**
 * Why a dialog cannot ask for a parameter of this type, or `null`: the
 * field the generator's own `controlFor` makes of it, and one that writes.
 * Every type such a field writes has a codec that parses its answer
 * (`codecForType`), which the planner asks; were one to have none, every
 * answer would be refused, never passed unchecked.
 */
export function inputProblem(parameter: RoutineParameter): string | null {
  const control = controlFor(parameter.type, false)
  if ('exclude' in control) return `${parameter.databaseType}: ${control.exclude}`
  return control.readOnly === undefined ? null : `${parameter.databaseType}: ${control.readOnly}`
}

/** One parameter's source, bound against the form -- or why it cannot be. */
function boundSource(root: ObjectMeta, ground: ActionGround, parameter: RoutineParameter, from: ParameterSource): BoundSource | string {
  const at = `parameter ${parameter.name}`
  if ('field' in from) {
    const binding = ground.fields.find((candidate) => candidate.kind === 'column' && candidate.column === from.field)
    if (binding?.kind !== 'column') return `${at} is given ${from.field}, which no column field of this form is bound to`
    // A column field is bound to a column of the root, as the snapshot holds it (`generateForm`, `prepare`).
    const column = root.columns.find((candidate) => candidate.name === from.field) as ObjectMeta['columns'][number]
    const problem = fitProblem(column, parameter)
    return problem === null ? { kind: 'field', field: binding.field, column: from.field } : `${at} is given ${from.field}, and ${problem}`
  }
  if ('key' in from) {
    if (!(ground.identity ?? []).includes(from.key)) return `${at} is given ${from.key}, which is no column of the record's key`
    // The identity is a key of the root's own (`identityFor`), so its every column is one of the root's.
    const column = root.columns.find((candidate) => candidate.name === from.key) as ObjectMeta['columns'][number]
    const problem = fitProblem(column, parameter)
    return problem === null ? { kind: 'key', column: from.key } : `${at} is given ${from.key}, and ${problem}`
  }
  if ('input' in from) {
    const problem = inputProblem(parameter)
    return problem === null ? { kind: 'input', input: from.input } : `${at} is asked of the person, and ${problem}`
  }
  if (!FROM_CONTEXT.has(parameter.type.kind))
    return `${at} takes ${parameter.type.kind}, and the verified context's ${'attribute' in from ? `attribute ${from.attribute}` : 'actor id'} is text, given as text, a whole number or a UUID only`
  return 'attribute' in from ? { kind: 'attribute', attribute: from.attribute } : { kind: 'actor' }
}

/** Every parameter mapped exactly once, and each mapped to a source the form can give it -- or the first reason not. */
function parametersFor(root: ObjectMeta, ground: ActionGround, routine: RoutineMeta, choice: ActionChoice): ActionParameter[] | string {
  const given = new Map<string, ParameterSource>()
  const inputs = new Set<string>()
  for (const { parameter, from } of choice.parameters) {
    if (!routine.parameters.some((candidate) => candidate.name === parameter)) return `${describeRoutine(routine.ref)} has no parameter ${parameter}`
    if (given.has(parameter)) return `parameter ${parameter} is given twice`
    if ('input' in from) {
      if (inputs.has(from.input)) return `input ${from.input} is given to two parameters, and a dialog field is typed by one`
      inputs.add(from.input)
    }
    given.set(parameter, from)
  }
  const bound: ActionParameter[] = []
  for (const parameter of routine.parameters) {
    const from = given.get(parameter.name)
    // SQL Server's catalog keeps no T-SQL default (0158), so none is left to one on either engine.
    if (from === undefined) return `parameter ${parameter.name} is given nothing, and a run leaves no parameter to its default`
    const source = boundSource(root, ground, parameter, from)
    if (typeof source === 'string') return source
    bound.push({ parameter: parameter.name, typeId: parameter.typeId, databaseType: parameter.databaseType, type: parameter.type, from: source })
  }
  return bound
}

/** Why the routine a choice names cannot be found to bind, or `null` when it is in the snapshot. */
function missing(snapshot: MetadataSnapshot, choice: ActionChoice): string | null {
  if (!recordsRoutines(snapshot)) return 'this snapshot was discovered without routines; discover again with them'
  if (routineOf(snapshot, choice) !== undefined) return null
  const named = describeRoutine(choice.routine)
  const ref = { schema: choice.routine.schema, name: choice.routine.name }
  const hidden = snapshot.gaps.filter((gap) => gap.aspect === 'routines' && gapCovers(gap, ref))
  if (hidden.length > 0) return `${named} is not visible to this connection: ${hidden.map((gap) => `"${gap.detail}"`).join('; ')}`
  return `${named} is not in the snapshot`
}

/** What the generator says of an action it binds: what it runs, how the version moves, and what nothing here binds (0159). */
function boundNote(binding: BoundAction, routine: RoutineMeta): GenerationNote {
  const move = binding.move
  const moved = move.kind === 'increment' ? `incrementing ${move.column}` : `setting ${move.column} to itself, which moves the rowversion`
  const reach =
    routine.reach === 'owner'
      ? " It may act beyond this connection's account's own grants: SECURITY DEFINER, or on SQL Server every procedure, by ownership chaining."
      : ''
  return {
    subject: binding.name,
    kind: 'inferred',
    message: `Runs ${describeRoutine(routine.ref)} over the open record after ${moved}, in one transaction. What it does is the deployment's: field grants, state moves and the policy's cascades do not bind it, and a routine that writes other rows of this table must move their version itself.${reach}`,
  }
}

/** An action bound, but for its dialog: what a planner holds a stored binding to, and what the generator adds a dialog to. */
export type BoundAction = Omit<ActionBinding, 'dialog'>

/**
 * One action, bound against the form -- or why it cannot be, as the end of
 * a blocked note (0159). The generator's rules, in one place, which the
 * planner asks again of a stored binding (`actions/plan.ts`), so a hand
 * edit that binds what the generator would not is refused, never run.
 */
export function bindAction(snapshot: MetadataSnapshot, root: ObjectMeta, ground: ActionGround, choice: ActionChoice): BoundAction | string {
  const unoffered = actionUnoffered(snapshot.kind, root, ground.identity, ground.concurrency)
  if (unoffered !== null) return unoffered
  const absent = missing(snapshot, choice)
  if (absent !== null) return absent
  const routine = routineOf(snapshot, choice) as RoutineMeta
  const problem = routineProblem(snapshot.kind, snapshot.routines ?? [], routine)
  if (problem !== null) return problem
  const parameters = parametersFor(root, ground, routine, choice)
  if (typeof parameters === 'string') return parameters
  // actionUnoffered said a move exists, and asked actionMove for it.
  const move = actionMove(root, ground.identity ?? [], ground.concurrency as ConcurrencyBinding) as ActionMove
  return { name: choice.name, routine: { ...routine.ref }, kind: routine.kind, scope: 'record', parameters, move }
}

/**
 * The actions of the form, in the request's order: each bound, or refused
 * with a blocked note naming the rule (0159). Called once the form's
 * identity, concurrency and fields are decided, which every action rests
 * on.
 */
export function actionsFor(
  snapshot: MetadataSnapshot,
  root: ObjectMeta,
  request: GenerationRequest,
  ground: ActionGround,
  notes: GenerationNote[],
): ActionBinding[] {
  const choices = request.actions ?? []
  assertChoices(choices)
  const bound: ActionBinding[] = []
  for (const choice of choices) {
    const found = bindAction(snapshot, root, ground, choice)
    if (typeof found === 'string') {
      notes.push({ subject: choice.name, kind: 'blocked', message: `Action ${choice.name} is not offered: ${found}.` })
      continue
    }
    const routine = routineOf(snapshot, choice) as RoutineMeta
    notes.push(boundNote(found, routine))
    bound.push({ ...found, dialog: dialogFor(request.formId, choice.name, found.parameters, routine, notes) })
  }
  return bound
}
