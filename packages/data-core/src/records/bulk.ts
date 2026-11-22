import { canonicalize } from '@formancy/spec'
import { DUPLICATE_RECORD } from '../actions/plan.js'
import type { DuplicateRecord } from '../actions/plan.js'
import type { FormBindings } from '../generate/types.js'
import type { MetadataSnapshot } from '../metadata.js'
import { checkSubmittedFields } from '../policy/evaluate.js'
import { byCodepoint, readPolicy } from '../policy/inputs.js'
import type { FormPolicy, PolicyContext } from '../policy/types.js'
import type { RecordDeleted, RuntimeRefusal, UnknownOutcome } from '../runtime.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { decodeAnswers, invalid, membershipChecks } from './plan.js'
import type { FormRecord, InvalidValues, MembershipCheck, PlanRefusal } from './plan-types.js'
import { prepare, refuse } from './prepare.js'
import { filtersFor, throughFields } from './scope.js'
import { stampsOf } from './stamps.js'
import { decodeRecordKey } from './token.js'

/*
 * The chosen records of a page deleted (0173) or changed (0175) together,
 * as the runtime plane carries them: each record a write of its own --
 * `planDelete`, or `planUpdate` over its own read -- planned exactly as one
 * sent alone is, in its own transaction, in the order sent. What is
 * decided once for the request is here: the body's shape, held to a page;
 * that no record is named twice; and for a change, the answers, which are
 * the same for every record. The wire shapes are declared beside it, so
 * the server that answers (`routes/runtime-bulk.ts`) and the client that
 * sends (`chosen.ts`) compile against one shape (0029).
 */

/** `POST /v1/forms/:id/records/delete-chosen` (0173): the chosen records, each by its token and the version its person read, in the page's order. */
export interface ChosenBody {
  records: Array<{ record: string; version: string }>
}

/**
 * `POST /v1/forms/:id/records/update-chosen` (0175): the chosen records, as
 * a delete of them names them, and the answers each is changed to -- one
 * value for every record, in the fields `bulk.update` grants; `null` clears
 * a field, as it does in an update alone.
 */
export interface ChosenChangeBody extends ChosenBody {
  answers: Record<string, unknown>
}

/**
 * What became of one chosen record: what the write of it alone would have
 * answered -- `POST …/records/delete` (0173) or `POST …/records/update`
 * (0175) -- its status and body: 200 with the deleted row's token, or with
 * the record as stored; a refusal; or 502 `unknown-outcome` naming it with
 * its version. Or `sent: false`, a record no statement was sent for,
 * because the deadline passed or a record before it left the connection in
 * doubt.
 */
export type ChosenOutcome<Done = RecordDeleted> = { sent: true; status: number; body: Done | RuntimeRefusal | UnknownOutcome } | { sent: false }

/** 200: each chosen record's outcome, in the order sent -- a delete's by default, a change's with `FormRecord`. */
export interface ChosenAnswer<Done = RecordDeleted> {
  records: Array<ChosenOutcome<Done>>
}

/** 200 to a change of chosen records (0175): each record's outcome as its update alone would be answered. */
export type ChangedAnswer = ChosenAnswer<FormRecord>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The records of a request by their shape alone, one to a page, or the refusal in `shape`'s words. */
function readRecords(sent: unknown, shape: string): { ok: true; records: ChosenBody['records'] } | PlanRefusal {
  if (!Array.isArray(sent)) return refuse('invalid-request', shape)
  if (sent.length < 1 || sent.length > LIST_PAGE_SIZE)
    return refuse('invalid-request', `A request names from 1 to ${String(LIST_PAGE_SIZE)} records: the chosen records of the page a list shows.`)
  const records: ChosenBody['records'] = []
  for (const entry of sent as unknown[]) {
    if (!isRecord(entry) || typeof entry['record'] !== 'string' || typeof entry['version'] !== 'string') return refuse('invalid-request', shape)
    records.push({ record: entry['record'], version: entry['version'] })
  }
  return { ok: true, records }
}

/**
 * A request's chosen records by their shape alone, or `invalid-request`:
 * from one to a page, `LIST_PAGE_SIZE`, each `{ record, version }` -- the
 * rows of the one page a list shows, never a number of its own, as a run
 * over a selection is held (0165). Read by the route before it reads a
 * write id or asks the store, so a body past a page is refused before any
 * statement. Any other property is not read.
 */
export function readBulkBody(body: unknown): { ok: true; body: ChosenBody } | PlanRefusal {
  const shape = 'Expected { records: [{ record, version }] }.'
  if (!isRecord(body)) return refuse('invalid-request', shape)
  const read = readRecords(body['records'], shape)
  return read.ok ? { ok: true, body: { records: read.records } } : read
}

/**
 * A change of chosen records by its shape alone (0175): the records as
 * `readBulkBody` reads them, and `answers` an object of field keys -- what
 * each holds is `bulkAnswers`' to read, once the form is known. Read where
 * a delete's body is, before the write id.
 */
export function readChangeBody(body: unknown): { ok: true; body: ChosenChangeBody } | PlanRefusal {
  const shape = 'Expected { records: [{ record, version }], answers }.'
  if (!isRecord(body) || !isRecord(body['answers'])) return refuse('invalid-request', shape)
  const read = readRecords(body['records'], shape)
  return read.ok ? { ok: true, body: { records: read.records, answers: body['answers'] } } : read
}

/**
 * The first two positions whose tokens name one key of this form, or
 * `null`: refused 400 `duplicate-record` in a selection's words (0165)
 * before anything is sent, since the second write of one row is no write
 * of the record its person chose -- a second delete is not found, a second
 * change stale. A key compared as a run's are, by its decoded parts. A
 * token that names no key of this form, and bindings that cannot be
 * planned from, are no duplicate: each record's own plan refuses them. Two
 * keys only the database's equality makes one -- `a` and `A` under a
 * case-insensitive collation -- are two requests' worth of one row, the
 * second answered `not-found` or `stale`, which changes nothing.
 */
export function chosenTwice(snapshot: MetadataSnapshot, bindings: FormBindings, records: ChosenBody['records']): DuplicateRecord | null {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return null
  const seen = new Map<string, number>()
  for (const [index, { record }] of records.entries()) {
    const key = decodeRecordKey(ready.prepared.target.identity, record)
    if (!key.ok) continue
    const spelled = canonicalize(key.key.map((part) => part.value))
    const earlier = seen.get(spelled)
    if (earlier !== undefined) return { ok: false, code: 'duplicate-record', message: DUPLICATE_RECORD, records: [earlier, index] }
    seen.set(spelled, index)
  }
  return null
}

/**
 * What a change of chosen records sets, decided once for the request
 * (0175), since it is the same for every record: the selections it makes,
 * each a membership check the caller runs once, before any record is read
 * -- or why nothing is sent.
 *
 * In this order: no field sent is `nothing-to-update`, as an update alone
 * that changes no column is; a field `bulk.update.fields` does not list is
 * `over-posting`, as is one this actor may not write on update
 * (`checkSubmittedFields`); then every answer through its column's codec,
 * by the same `decodeAnswers` `planUpdate` runs, against the same columns
 * the context pins, collecting every error -- 422 `invalid-values` for the
 * request, never fifty of them; then what the change stamps (0153), the
 * signed-in person's whichever record it is -- `unstampable` or
 * `missing-attribute` for the request, where `planUpdate` would refuse
 * every record so. The key is not among the columns held fixed, as
 * `planUpdate` holds it, because no field of the key may be granted. `null` clears a field where its column may be NULL, and is
 * refused `required` where it may not; an empty text is text.
 *
 * What depends on the record is not here: each record's echoes, its
 * version, its state's move (0127) and its drift are `planUpdate`'s, over
 * its own read, which decodes these same answers again and finds them the
 * same.
 */
export function bulkAnswers(
  snapshot: MetadataSnapshot,
  bindings: FormBindings,
  policy: FormPolicy,
  context: PolicyContext,
  answers: Readonly<Record<string, unknown>>,
): { ok: true; memberships: MembershipCheck[] } | PlanRefusal | InvalidValues {
  const ready = prepare(snapshot, bindings)
  if (!ready.ok) return ready
  const { prepared } = ready
  const sent = Object.keys(answers)
  if (sent.length === 0) return refuse('nothing-to-update', 'These answers change no field: a change of chosen records names at least one.')
  const granted = readPolicy(policy).parsed?.bulk?.update?.fields ?? []
  const outside = sent.filter((field) => !granted.includes(field)).sort(byCodepoint)
  if (outside.length > 0)
    return refuse('over-posting', `${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not changed in chosen records together with this form`)
  const allowed = checkSubmittedFields(policy, context, bindings, 'update', sent)
  if (!allowed.ok) return allowed
  const filters = filtersFor(prepared, policy, context, 'update')
  if (!filters.ok) return filters
  const scoping = throughFields(bindings, policy, context, 'update')
  if (!scoping.ok) return scoping
  const fixed = new Map(filters.filter.map((term) => [term.column, term.value]))
  const decoded = decodeAnswers(prepared, bindings, new Map(Object.entries(answers)), fixed, 'update', scoping.fields)
  if (decoded.errors.length > 0) return invalid(decoded.errors)
  // Who a change stamps is the signed-in person's, as each record's plan finds it again: one that cannot be stamped is the request's refusal.
  const stamps = stampsOf(prepared, bindings, context, 'update')
  if (!stamps.ok) return stamps
  const memberships = membershipChecks(snapshot, bindings, policy, context, 'update', decoded.selections)
  return memberships.ok ? { ok: true, memberships: memberships.checks } : memberships
}
