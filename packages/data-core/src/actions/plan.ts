import { canonicalize } from '@formancy/spec'
import { codecForType } from '../codecs/codec.js'
import { diffRootDefinition } from '../drift/diff.js'
import { callShape } from '../drift/routines.js'
import { bindAction } from '../generate/actions.js'
import type { FormBindings } from '../generate/types.js'
import type { MetadataSnapshot } from '../metadata.js'
import { readContext } from '../policy/inputs.js'
import { authorizeAction } from '../policy/evaluate.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { invalid, versionFits } from '../records/plan.js'
import type { FieldError, InvalidValues, PlanRefusal } from '../records/plan-types.js'
import { type Prepared, prepare, refuse, unaddressable } from '../records/prepare.js'
import { filtersFor, throughFor } from '../records/scope.js'
import { decodeRecordKey } from '../records/token.js'
import type { DescribedTable, RecordConcurrency } from '../records/types.js'
import { describeRoutine } from '../routines.js'
import type { ActionArgument, ActionBinding, ActionChoice, ActionRecord, ActionRequest, BoundSource, DescribedRoutine, ParameterSource } from './types.js'

/*
 * Where a run's request from a browser becomes a request to an adapter
 * (0159), as `records/plan.ts` is for a record's: the policy, the codecs,
 * the tokens and the bindings meet here, so both adapters receive the
 * same typed request for the same answers.
 *
 * Checked in this order: the bindings against their snapshot, and the
 * action against the generator's own rule; the body's shape; who may run
 * it, which fits the policy to the form -- so a role that may not read a
 * field the action passes is refused with the policy -- and scopes it;
 * whether the database as the request described the root and the routine
 * still fits the action (0041); the record tokens, each once, and the
 * versions; then every answer through its parameter's codec, every error
 * collected; then what the context gives. A refusal at any step is the
 * answer. Pure: no I/O and no clock.
 */

/** What a person is told when the database changed under an action: never which column or routine, which is the administrator's to read. */
export const ACTION_REFUSED =
  'The database changed since this form was published, in a way this action cannot run safely. Nothing was done; an administrator must review the form.'

/**
 * A run that names one record twice (0159): two tokens of one key, which
 * would lock one row and call the routine on it twice. A refusal of the
 * action planner's own, beside the record planners' codes, since no other
 * request names more than one record.
 */
export interface DuplicateRecord {
  ok: false
  code: 'duplicate-record'
  message: string
}

export type PlannedAction = { ok: true; request: ActionRequest } | InvalidValues | PlanRefusal | DuplicateRecord

/** A run's body, read: the records it addresses and the answers by field key, own properties only. */
export interface RunBody {
  records: Array<{ record: string; version: string }>
  answers: ReadonlyMap<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A run's body by its shape alone, or `invalid-request`: the planner's own
 * reading, which the route asks first too (0161), so the two cannot read
 * one body two ways -- the route before it reads a write id or asks the
 * store, the planner again over what it plans.
 */
export function readRunBody(body: unknown): { ok: true; body: RunBody } | PlanRefusal {
  const shape = 'A run is { records: [{ record, version }], answers: { field: value } }.'
  if (!isRecord(body) || !Array.isArray(body['records']) || !isRecord(body['answers'])) return refuse('invalid-request', shape)
  const records: RunBody['records'] = []
  for (const entry of body['records'] as unknown[]) {
    if (!isRecord(entry) || typeof entry['record'] !== 'string' || typeof entry['version'] !== 'string') return refuse('invalid-request', shape)
    records.push({ record: entry['record'], version: entry['version'] })
  }
  return { ok: true, body: { records, answers: new Map(Object.entries(body['answers'])) } }
}

/** The request's spelling of a bound source, so a stored binding can be bound again by the generator's rule. */
function sourceOf(from: BoundSource): ParameterSource {
  switch (from.kind) {
    case 'field':
      return { field: from.column }
    case 'key':
      return { key: from.column }
    case 'input':
      return { input: from.input }
    case 'attribute':
      return { attribute: from.attribute }
    case 'actor':
      return { actor: 'id' }
  }
}

/**
 * The request's choice a stored binding was bound from, as the request
 * spells it: its name, routine and scope, and each parameter's source, in
 * the routine's order. What the planner binds again, and what the bundle
 * check compares with the stored request (0161).
 */
export function actionChoiceOf(action: ActionBinding): ActionChoice {
  return {
    name: action.name,
    routine: { ...action.routine },
    scope: action.scope,
    parameters: action.parameters.map((parameter) => ({ parameter: parameter.parameter, from: sourceOf(parameter.from) })),
  }
}

/**
 * Why the stored binding is not what the generator binds from the
 * bindings' own snapshot, or `null` (0159): a hand edit -- another
 * routine's types, a source the policy never saw, a move the token does
 * not give -- is refused, never run. The dialog is not compared: the run
 * reads none of it, and publish compares it with the generator (0030).
 */
function bindingProblem(snapshot: MetadataSnapshot, prepared: Prepared, bindings: FormBindings, action: ActionBinding): string | null {
  const choice = actionChoiceOf(action)
  const bound = bindAction(snapshot, prepared.root, { identity: bindings.identity, concurrency: bindings.concurrency, fields: bindings.fields }, choice)
  if (typeof bound === 'string') return bound
  const { dialog: _dialog, ...stored } = action
  return canonicalize(bound) === canonicalize(stored) ? null : 'it is not what the generator binds from them'
}

/**
 * Whether the database as this request described it still lets the
 * action run (0041): the root by drift review's own root families, and
 * the routine by the call shape review's `routine-changed` compares
 * (`callShape`), so the runtime refuses exactly what review stops of the
 * action. The routine's reach and body are not compared, and EXECUTE is
 * the database's own to refuse.
 */
function driftRefusal(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  policy: FormPolicy,
  action: ActionBinding,
  described: { table: DescribedTable; routine: DescribedRoutine },
): PlanRefusal | undefined {
  const { definition: _definition, ...root } = described.table
  // It throws only for bindings that do not fit their snapshot, which `prepare` and `bindingProblem` refused first.
  const report = diffRootDefinition(snapshot, root, bindings, policy)
  if (report.runtime.actions?.includes(action.name) !== true) {
    return { ...refuse('drift', ACTION_REFUSED), drift: report.changes.filter((change) => change.severity === 'blocking') }
  }
  const bound = snapshot.routines?.find((routine) => canonicalize(routine.ref) === canonicalize(action.routine))
  if (bound !== undefined && canonicalize(described.routine.ref) === canonicalize(action.routine) && callShape(bound) === callShape(described.routine))
    return undefined
  return {
    ...refuse('drift', ACTION_REFUSED),
    drift: [
      {
        kind: 'routine-changed',
        severity: 'blocking',
        subject: { kind: 'routine', routine: { ...action.routine } },
        affects: [],
        message: `${describeRoutine(action.routine)} is not, as this request described it, the routine ${action.name} was bound to.`,
      },
    ],
  }
}

/** Each record the run addresses, by its token, once, at a version its concurrency could have returned. */
function recordsOf(
  prepared: Prepared,
  concurrency: RecordConcurrency,
  records: RunBody['records'],
): { ok: true; records: ActionRecord[] } | PlanRefusal | DuplicateRecord {
  const decoded: ActionRecord[] = []
  const seen = new Set<string>()
  for (const { record, version } of records) {
    const key = decodeRecordKey(prepared.target.identity, record)
    if (!key.ok) return refuse('invalid-record-token', key.message)
    // Two tokens of one key would lock one row and call the routine twice on it.
    const spelled = canonicalize(key.key.map((part) => part.value))
    if (seen.has(spelled)) return { ok: false, code: 'duplicate-record', message: 'The request names one record twice. Nothing was done.' }
    seen.add(spelled)
    if (!versionFits(prepared, concurrency.kind, concurrency.column, version))
      return refuse('invalid-version', `This is not a version a ${concurrency.kind} returns.`)
    decoded.push({ key: key.key, expectedVersion: version })
  }
  // An action over the open record runs over exactly one.
  if (decoded.length !== 1) return refuse('invalid-request', 'An action over the open record names exactly one record.')
  return { ok: true, records: decoded }
}

/**
 * Every argument, in the routine's order: a column of the locked row for
 * a field or a key, which never leaves the database; an answer through
 * its parameter's codec, every error collected by input; the context's
 * attribute or the actor's id, through the same codec. A missing or empty
 * attribute is a refusal, never a NULL.
 */
function argumentsOf(
  action: ActionBinding,
  answers: ReadonlyMap<string, unknown>,
  context: PolicyContext,
): { ok: true; arguments: ActionArgument[] } | InvalidValues | PlanRefusal {
  const inputs = new Set(action.parameters.flatMap((parameter) => (parameter.from.kind === 'input' ? [parameter.from.input] : [])))
  const unasked = [...answers.keys()].filter((key) => !inputs.has(key)).sort()
  if (unasked.length > 0) return refuse('over-posting', `${unasked.join(', ')} ${unasked.length === 1 ? 'is' : 'are'} no field of ${action.name}'s dialog`)
  // authorizeAction read the context before this is asked.
  const trusted = (readContext(context) as Extract<ReturnType<typeof readContext>, { ok: true }>).trusted
  const errors: FieldError[] = []
  const argued: ActionArgument[] = []
  for (const parameter of action.parameters) {
    const { from } = parameter
    const at = { parameter: parameter.parameter, typeId: parameter.typeId, type: parameter.type }
    if (from.kind === 'field' || from.kind === 'key') {
      argued.push({ ...at, from: { kind: 'column', column: from.column } })
      continue
    }
    const codec = codecForType(parameter.type, false)
    if (from.kind === 'input') {
      if (!answers.has(from.input)) {
        errors.push({ field: from.input, code: 'required', message: 'A value is required.' })
        continue
      }
      const parsed = codec.parse(answers.get(from.input))
      if (parsed.ok) argued.push({ ...at, from: { kind: 'value', value: parsed.value } })
      else errors.push({ field: from.input, code: parsed.code, message: parsed.message })
      continue
    }
    const what = from.kind === 'attribute' ? `the context's ${from.attribute}` : "the actor's id"
    // authorizeAction resolved every attribute a row filter or a through
    // compares with, refusing one missing or empty, and the policy's fit
    // refuses an action that passes any other; were one missing anyway,
    // the codec refuses `undefined`, and the run is refused, never given a NULL.
    const given = from.kind === 'attribute' ? trusted.attributes.get(from.attribute) : context.actor.id
    const parsed = codec.parse(given)
    if (!parsed.ok) return refuse('invalid-context', `${action.name} passes ${what} to ${parameter.parameter}, which cannot hold it: ${parsed.message}`)
    argued.push({ ...at, from: { kind: 'value', value: parsed.value } })
  }
  return errors.length > 0 ? invalid(errors) : { ok: true, arguments: argued }
}

/**
 * The run of action `name` over the records `body` names, at the versions
 * their person read, under the person's filters and throughs -- or why
 * not, or which answers are wrong (0159).
 *
 * `described` is the root and the routine as the catalog described them
 * in this request (0041): a run they no longer fit is refused `drift`, and
 * the request carries both definitions, so it runs only while the table
 * and the routine still have them.
 */
export function planAction(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  policy: FormPolicy,
  context: PolicyContext,
  name: string,
  body: unknown,
  described: { table: DescribedTable; routine: DescribedRoutine },
): PlannedAction {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return ready
  const { prepared } = ready
  const action = (bindings.actions ?? []).find((candidate) => candidate.name === name)
  if (action === undefined) return refuse('operation-unavailable', `This form offers no action ${name}.`)
  const problem = bindingProblem(snapshot, prepared, bindings, action)
  if (problem !== null) return refuse('invalid-bindings', `The bindings bind action ${name}, and their snapshot says: ${problem}.`)
  if (!prepared.addressable) return unaddressable(prepared)
  const read = readRunBody(body)
  if (!read.ok) return read
  const allowed = authorizeAction(policy, context, bindings, name)
  if (!allowed.ok) return allowed
  // A run reaches the rows its person may read, as a read does (0043).
  const filters = filtersFor(prepared, policy, context, 'read')
  if (!filters.ok) return filters
  const through = throughFor(snapshot, bindings, prepared, policy, context, 'read')
  if (!through.ok) return through
  // A run moves this column under the filter (0015): pinned by it, the record would leave the rows the filter admits.
  if (filters.filter.some((term) => term.column === action.move.column)) {
    return refuse('invalid-policy', `rowFilters: ${action.move.column} is the column every run of ${name} moves; a row filter cannot pin it.`)
  }
  const drifted = driftRefusal(snapshot, bindings, policy, action, described)
  if (drifted !== undefined) return drifted
  // bindingProblem held the action to a confirmed token (`actionUnoffered`).
  const concurrency = prepared.target.concurrency as RecordConcurrency
  const records = recordsOf(prepared, concurrency, read.body.records)
  if (!records.ok) return records
  const argued = argumentsOf(action, read.body.answers, context)
  if (!argued.ok) return argued
  return {
    ok: true,
    request: {
      action: name,
      target: { ...prepared.target, concurrency },
      records: records.records,
      filters: filters.filters,
      through: through.through,
      ...(bindings.validity === undefined ? {} : { open: bindings.validity.to }),
      move: action.move,
      routine: { ref: { ...action.routine }, kind: action.kind, arguments: argued.arguments },
      definitions: { table: described.table.definition, routine: described.routine.definition },
    },
  }
}
