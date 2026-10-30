import type { ApiValue } from '../codecs/codec.js'
import { offers } from '../generate/offers.js'
import type { FormBindings } from '../generate/types.js'
import type { ColumnMeta, MetadataSnapshot } from '../metadata.js'
import { authorizeOperation, checkSubmittedFields } from '../policy/evaluate.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import { driftRefusal } from './drift.js'
import { decodeAnswers, inCatalogValues, invalid, membershipChecks, pinnedValues, readAnswers, readBack, versionFits } from './plan.js'
import type { FormRecord, PlannedSupersede, PlanRefusal } from './plan-types.js'
import { columnsOf, prepare, refuse, unaddressable } from './prepare.js'
import { filtersFor, throughFields, throughFor } from './scope.js'
import { decodeRecordKey } from './token.js'
import { planMove } from './transition.js'
import type { DescribedTable, RecordColumn } from './types.js'

/*
 * A change from a date (0113): the open version of a chain ends where the
 * person says the next one starts, and the next one is inserted -- an update
 * of one row and a create of another, planned as each is and sent as one
 * request the adapter runs as one write.
 */

/** The field that stands for a column, if the form has one. */
function fieldOf(bindings: FormBindings, column: string): string | undefined {
  return bindings.fields.find((binding) => columnsOf(binding).includes(column))?.field
}

/**
 * The change for a person's answers -- the next version's, its start in
 * `from`'s field -- to the open version `recordToken` names at
 * `expectedVersion`, or why not, or which fields are wrong.
 *
 * Both update and create are asked of the policy: one version ends and
 * another starts. The open version is located as an update locates its
 * record, under the update's filters and throughs; the next version's
 * values are decoded as a create's, its pinned columns from the context,
 * less the chain's key, which is copied from the row ended, so the next
 * version is of the same thing whatever was sent. An answer for the key or
 * for the end is over-posting.
 *
 * `asRead` is the open version as read for this actor just before: its
 * start and whether it is open decide the change, so without it, or without
 * either answer in it, nothing is planned. Read at the version named, an
 * ended version is refused and a start not after the open one's is a field
 * error; read at another version, the person's read is older than the row,
 * and the guarded write answers it stale instead.
 */
export function planSupersede(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  policy: FormPolicy,
  context: PolicyContext,
  recordToken: string,
  expectedVersion: string,
  answers: unknown,
  asRead: FormRecord | undefined,
  described: DescribedTable,
): PlannedSupersede {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return ready
  const { prepared } = ready
  const validity = bindings.validity
  const concurrency = prepared.target.concurrency
  if (validity === undefined || concurrency === null || !offers(bindings, 'supersede')) return refuse('operation-unavailable', 'This form does not offer a change from a date.')
  if (!prepared.addressable) return unaddressable(prepared)
  for (const operation of ['update', 'create'] as const) {
    const authorized = authorizeOperation(policy, context, operation)
    if (!authorized.ok) return authorized
  }
  const submitted = readAnswers(answers)
  if (!submitted.ok) return submitted
  const fromField = fieldOf(bindings, validity.from)
  const toField = fieldOf(bindings, validity.to)
  if (fromField === undefined || toField === undefined) return refuse('invalid-bindings', `A chain's ${validity.from} and ${validity.to} are fields of its form.`)
  for (const column of [...validity.key, validity.to]) {
    const field = fieldOf(bindings, column)
    if (field !== undefined && submitted.answers.has(field)) {
      return refuse('over-posting', `${field} is the server's in a change from a date: the next version's ${column === validity.to ? 'end is open' : 'chain is the one it follows'}.`)
    }
  }
  const filters = filtersFor(prepared, policy, context, 'update')
  if (!filters.ok) return filters
  const through = throughFor(snapshot, bindings, prepared, policy, context, 'update')
  if (!through.ok) return through
  const pinned = pinnedValues(prepared, policy, context)
  if (!pinned.ok) return pinned
  const allowed = checkSubmittedFields(policy, context, bindings, 'create', [...submitted.answers.keys()])
  if (!allowed.ok) return allowed
  for (const operation of ['update', 'create'] as const) {
    const drifted = driftRefusal(snapshot, bindings, policy, described, operation)
    if (drifted !== undefined) return drifted
  }
  const key = decodeRecordKey(prepared.target.identity, recordToken)
  if (!key.ok) return refuse('invalid-record-token', key.message)
  if (!versionFits(prepared, concurrency.kind, concurrency.column, expectedVersion)) return refuse('invalid-version', `This is not a version a ${concurrency.kind} returns.`)
  const read = openAsRead(asRead, recordToken, fromField, toField)
  if (!read.ok) return read

  const chain = new Set(validity.key)
  const fixed = new Map<string, ApiValue>(pinned.values.filter((entry) => !chain.has(entry.name)).map((entry) => [entry.name, entry.value]))
  const scoping = throughFields(bindings, policy, context, 'create')
  if (!scoping.ok) return scoping
  const decoded = decodeAnswers(prepared, bindings, submitted.answers, fixed, 'create', scoping.fields, chain)
  if (decoded.errors.length > 0) return invalid(decoded.errors)
  const start = decoded.values.find((value) => value.name === validity.from)
  if (start === undefined || typeof start.value !== 'string') return invalid([{ field: fromField, code: 'required', message: 'A value is required.' }])
  // Read at the version named: the start as stored, cut to a whole second
  // at most, and both spelled as one shape, so their text orders them.
  if (asRead?.version === expectedVersion) {
    if (asRead.answers[toField] !== null) return refuse('version-ended', 'This version has ended; only the open version of a chain changes from a date.')
    if (start.value <= String(asRead.answers[fromField])) return invalid([{ field: fromField, code: 'not-after', message: 'The next version must start after the open one starts.' }])
  }
  const memberships = membershipChecks(snapshot, bindings, policy, context, 'create', decoded.selections)
  if (!memberships.ok) return memberships
  const move = planMove(policy, context, bindings, decoded.values, null)
  if (!move.ok) return move

  const { fields, returning } = readBack(prepared, bindings, policy, context)
  const values = [...pinned.values.filter((entry) => !chain.has(entry.name)), ...decoded.values.filter((value) => value.name !== validity.from)]
  return {
    ok: true,
    request: {
      target: { ...prepared.target, concurrency },
      key: key.key,
      expectedVersion,
      filters: filters.filters,
      through: through.through,
      ends: validity.to,
      start,
      chain: validity.key.map((name): RecordColumn => ({ name, type: (prepared.columns.get(name) as ColumnMeta).type })),
      values: inCatalogValues(prepared.root, values),
      returning,
      definition: described.definition,
    },
    fields,
    memberships: memberships.checks,
    moved: move.moved,
  }
}

/** The open version as read, holding its start and its end for this actor, or why a change cannot be planned without them. */
function openAsRead(asRead: FormRecord | undefined, recordToken: string, fromField: string, toField: string): { ok: true } | PlanRefusal {
  if (asRead === undefined) return refuse('record-not-read', 'A change from a date is planned with the version as read: where it starts, and whether it is open.')
  if (asRead.record !== recordToken) return refuse('record-not-read', 'The version as read is not the one this change addresses.')
  if (!Object.hasOwn(asRead.answers, fromField) || !Object.hasOwn(asRead.answers, toField)) {
    return refuse('field-denied', `A change from a date needs ${fromField} and ${toField} read, and this actor may not read both.`)
  }
  return { ok: true }
}
