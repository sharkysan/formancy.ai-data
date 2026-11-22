import {
  authorizeOperation,
  checkSubmittedFields,
  intendedRecord,
  planCreate,
  planRead,
  planUpdate,
  rejectedSelection,
  toFormAnswers,
} from '@formancy/data-core'
import type { DescribedTable, FieldError, FormRecord, MembershipCheck, PlanRefusal, PolicyContext, RecordFailure } from '@formancy/data-core'
import { canonicalize } from '@formancy/spec'
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { lookupDeadline } from '../lookup-deadline.js'
import { NOT_FOUND, planRefusal, recordFailure } from './runtime-errors.js'
import { requiredOf } from './runtime-menu.js'
import type { ServedForm } from './runtime-menu.js'
import { INVALID_WRITE_ID, writeId } from './write-once.js'
import type { WriteAnswer } from './write-once.js'

/** A plain create of a record a together child requires rows of (0155): it is created with them, in one save. Names no child, which the person may not read. */
export const CREATED_WITH_ROWS = 'A record of this form is created with the rows saved with it, in one save.'

/** The store could not list the forms a plain create must be checked against (0155), so nothing was sent. */
export const FORMS_UNREAD: WriteAnswer = {
  status: 503,
  body: { code: 'unavailable', message: 'The forms this one is saved with cannot be read now. Nothing was saved.' },
}

/** What the create and update routes borrow from the runtime plane, so they decide each step as the read route and the delete route do. */
export interface WriteRouteSteps {
  /** The published bundle, or a reply already sent. */
  published(id: string, reply: FastifyReply): Promise<PublishedBundle | undefined>
  /** The form's connection, or a reply already sent. */
  connection(bundle: PublishedBundle, reply: FastifyReply): Promise<OpenConnection | undefined>
  context(request: FastifyRequest): PolicyContext
  /** Runs `perform` once per sending of a write id, and answers a later sending with its answer (0031). */
  sendOnce(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: 'create' | 'update',
    id: string | undefined,
    perform: () => Promise<WriteAnswer>,
  ): Promise<WriteAnswer & { repeated?: boolean }>
  /** A write sent whose answer was lost: said in the log, answered 502 with what was addressed, never sent again. */
  lost(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: 'create' | 'update',
    record: string | null,
    version: string | null,
    failure: string,
  ): WriteAnswer
  /** A planner's refusal as the answer, its drift said in the log first. */
  refusal(request: FastifyRequest<{ Params: { id: string } }>, operation: 'create' | 'update', plan: PlanRefusal): WriteAnswer
  /** The root as the catalog describes it now, or the answer when it cannot be described. */
  describedRoot(bundle: PublishedBundle, open: OpenConnection): Promise<{ ok: true; described: DescribedTable } | { ok: false; answer: WriteAnswer }>
  /** A write's answer, sent, with what the audit names: its record, and whether it was a repeat. */
  answered(reply: FastifyReply, answer: WriteAnswer & { repeated?: boolean }): Promise<FastifyReply>
  /** How long each membership check may run before the server stops it (0061). */
  lookupDeadlineMs: number
  /** Every published form as served, with this person's menu entry, or `null` when the store cannot list them (`servedForms`). */
  served(request: FastifyRequest): Promise<ServedForm[] | null>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The answers a renderer submits, minus the fields it echoed back that this
 * actor may not write.
 *
 * A formancy renderer submits every field, disabled ones included, and the
 * policy calls a submitted field the actor may not write over-posting (0011).
 * Whether the actor may write a field is the policy's decision, so it is asked
 * — one key at a time, through `checkSubmittedFields` — rather than restated
 * here: a defaulted column the generator left writable can still be one the
 * policy grants nobody. The echo is removed on create when it is empty, and on
 * update when it equals what the record holds. Anything else in such a field
 * still reaches the planner and is refused: a changed value there is
 * tampering, and is not saved (0022). Unless the record has moved on since
 * the version the person sent (`behind`): then the echo is what they read
 * before another write moved the field -- a computed total, a stamp a trigger
 * sets -- so it is removed too, and the guarded statement answers the save as
 * the stale one it is (0098). An unedited instant or time the actor may write
 * is the planner's to remove, against the same read (0040).
 */
export function withoutEchoes(
  bundle: Pick<PublishedBundle, 'bindings' | 'policy'>,
  actor: PolicyContext,
  operation: 'create' | 'update',
  answers: unknown,
  current?: Readonly<Record<string, unknown>>,
  behind = false,
): unknown {
  if (!isRecord(answers)) return answers
  const kept: Record<string, unknown> = { ...answers }
  for (const binding of bundle.bindings.fields) {
    if (!Object.hasOwn(kept, binding.field)) continue
    if (checkSubmittedFields(bundle.policy, actor, bundle.bindings, operation, [binding.field]).ok) continue
    const value = kept[binding.field]
    const echo =
      behind ||
      (current === undefined
        ? value === null || value === undefined || value === ''
        : Object.hasOwn(current, binding.field) && canonicalize(value ?? null) === canonicalize(current[binding.field] ?? null))
    if (echo) delete kept[binding.field]
  }
  return kept
}

/**
 * Runs every membership check: undefined when every selection is a member,
 * otherwise the refusal to answer. Answered rather than sent, so an
 * update's checks run inside the sending they belong to (0031).
 *
 * Each check has a lookup deadline of its own, counted from when the
 * adapter is asked for it, and nothing else (0061): a write goes on after
 * its client leaves (0031), so no abandonment stops it. A check
 * past its deadline keeps the answer every failed check has, nothing
 * saved, and the log says the deadline passed.
 */
export async function memberships(
  open: OpenConnection,
  checks: readonly MembershipCheck[],
  log: FastifyBaseLogger,
  lookupDeadlineMs: number,
): Promise<WriteAnswer | undefined> {
  const errors: FieldError[] = []
  for (const check of checks) {
    const deadline = lookupDeadline(lookupDeadlineMs)
    try {
      const rejected = await open.lookups.rejects(check.config, check.tokens, check.filters, deadline.signal)
      if (rejected.length > 0) errors.push(rejectedSelection(check.field))
    } catch (error) {
      // Fails closed, as formancy's own membership port does (formancy.ai 0077).
      if (deadline.signal.aborted && error === deadline.signal.reason)
        log.warn(
          { field: check.field, deadlineMs: lookupDeadlineMs },
          'a lookup could not vouch for a selection: it passed its deadline, and the database was told to stop it',
        )
      else log.warn({ field: check.field, error: (error as Error).message }, 'a lookup could not vouch for a selection')
      return { status: 503, body: { code: 'unavailable', message: 'A selection could not be checked. Nothing was saved.' } }
    } finally {
      deadline.clear()
    }
  }
  return errors.length === 0
    ? undefined
    : { status: 422, body: { code: 'invalid-values', message: 'A selection is not one of the options.', fieldErrors: errors } }
}

/**
 * One create, from the description it is decided over to the insert,
 * answered rather than sent: the create route runs it once per sending, so
 * a write id that arrives again is answered with this answer and asks the
 * database nothing (0031). The mirror of `updated`.
 *
 * The policy is asked before any statement, so an actor it refuses reaches
 * none (0041). A record a together child requires rows of -- found among
 * every served form, whoever asks, since a bound applies to everyone -- is
 * refused next, before any statement: it is created with its rows, in one
 * save (0155), and a store that cannot list the forms refuses too, since
 * nothing can tell. Then the root is described, the one statement before
 * the planner: a create the description stops is refused there, with no
 * membership check and no insert sent, and the insert carries the
 * definition it was decided over.
 */
async function created(
  steps: WriteRouteSteps,
  request: FastifyRequest<{ Params: { id: string } }>,
  bundle: PublishedBundle,
  open: OpenConnection,
  answers: Record<string, unknown>,
): Promise<WriteAnswer> {
  const actor = steps.context(request)
  const authorized = authorizeOperation(bundle.policy, actor, 'create')
  if (!authorized.ok) return planRefusal(authorized.code, authorized.message)
  const required = requiredOf(bundle, await steps.served(request))
  if (required === null) return FORMS_UNREAD
  if (required.length > 0) return planRefusal('operation-unavailable', CREATED_WITH_ROWS)
  const root = await steps.describedRoot(bundle, open)
  if (!root.ok) return root.answer
  const plan = planCreate(bundle.snapshot, bundle.bindings, bundle.policy, actor, withoutEchoes(bundle, actor, 'create', answers), root.described)
  if (!plan.ok) {
    if (plan.code === 'invalid-values') return { status: 422, body: { code: plan.code, message: plan.message, fieldErrors: plan.fieldErrors } }
    return steps.refusal(request, 'create', plan)
  }
  if (request.auditTrail !== undefined) request.auditTrail.moved = plan.moved
  const refused = await memberships(open, plan.memberships, request.log, steps.lookupDeadlineMs)
  if (refused !== undefined) return refused
  const outcome = await open.records.insert(plan.request)
  if (!outcome.ok && outcome.code === 'unknown-outcome') return steps.lost(request, 'create', intendedRecord(plan.request), null, outcome.message)
  if (!outcome.ok) return recordFailure(bundle.bindings, outcome)
  const done = toFormAnswers(bundle.bindings, plan.fields, outcome)
  return { status: 201, body: done, record: done.record ?? undefined }
}

/** What one update asks of the runtime plane: who is asking, how a lost answer and a planner's refusal are said, the root's description, and the lookups' deadline. */
export type UpdateSteps = Pick<WriteRouteSteps, 'context' | 'lost' | 'refusal' | 'describedRoot' | 'lookupDeadlineMs'>

/** A membership check as one of a request's, by what it asks: its field, its tokens and the filter they are checked under. */
export function vouchedAs(check: MembershipCheck): string {
  return canonicalize([check.field, check.tokens, check.filters])
}

/**
 * One update, from the read that tells an echo from a change to the write,
 * answered rather than sent: the update route runs it once per sending, so
 * a write id that arrives again is answered with this answer and asks the
 * database nothing, its read included (0031). Each chosen record of a
 * request that changes several (0175, `runtime-bulk.ts`) is this, called
 * once for it, so one record of such a request is a single update and the
 * two cannot answer it apart. `moved` is whether the update, as planned,
 * moves the policy's state field (0112), which the update route's trail
 * names; `null` for one refused before it was planned.
 *
 * The policy is asked first, before any statement (0041). The record as it
 * stands is read next, and the read carries the table's description, which
 * the update is decided over. Against the record 0022 removes an unchanged
 * echo of a field the actor may not write, and the planner one of an
 * instant or a time they may (0040). An actor who may update and not read
 * gets no echo removed, and the planner needs no read for them: the table
 * is described for them in a statement of its own, as it is after a read
 * that failed. When the planner cannot tell an echo from a change because
 * the read failed, whatever the failure, that failure is the answer: sent
 * anyway, a read that failed and a write that did not would store the cut
 * value.
 *
 * Every selection is checked before the update is sent -- but one in
 * `vouched` (`vouchedAs`), which the request it belongs to has checked
 * already, under the same filter, and which a request over chosen records
 * checks once for all of them.
 */
export async function updateOne(
  steps: UpdateSteps,
  request: FastifyRequest<{ Params: { id: string } }>,
  bundle: PublishedBundle,
  open: OpenConnection,
  change: { record: string; version: string; answers: Record<string, unknown> },
  vouched: ReadonlySet<string> = new Set(),
): Promise<{ answer: WriteAnswer; moved: boolean | null }> {
  const { record, version, answers } = change
  const actor = steps.context(request)
  const authorized = authorizeOperation(bundle.policy, actor, 'update')
  if (!authorized.ok) return { answer: planRefusal(authorized.code, authorized.message), moved: null }
  const read = await readForWrite(steps, bundle, open, actor, record)
  if (!read.ok) return { answer: read.answer, moved: null }
  const { current, unread, described } = read
  // The record as read now is newer than the one the person saved over: the
  // database will answer stale, and an echo the change moved is not theirs.
  const behind = current !== undefined && current.version !== null && current.version !== version
  const plan = planUpdate(
    bundle.snapshot,
    bundle.bindings,
    bundle.policy,
    actor,
    record,
    version,
    withoutEchoes(bundle, actor, 'update', answers, current?.answers, behind),
    current,
    described,
  )
  if (!plan.ok) {
    if (plan.code === 'invalid-values')
      return { answer: { status: 422, body: { code: plan.code, message: plan.message, fieldErrors: plan.fieldErrors } }, moved: null }
    if (plan.code === 'record-not-read' && unread !== undefined) return { answer: recordFailure(bundle.bindings, unread), moved: null }
    return { answer: steps.refusal(request, 'update', plan), moved: null }
  }
  const unchecked = plan.memberships.filter((check) => !vouched.has(vouchedAs(check)))
  const refused = await memberships(open, unchecked, request.log, steps.lookupDeadlineMs)
  if (refused !== undefined) return { answer: refused, moved: plan.moved }
  const outcome = await open.records.update(plan.request)
  if (!outcome.ok && outcome.code === 'unknown-outcome') return { answer: steps.lost(request, 'update', record, version, outcome.message), moved: plan.moved }
  if (!outcome.ok) return { answer: recordFailure(bundle.bindings, outcome), moved: plan.moved }
  return { answer: { status: 200, body: toFormAnswers(bundle.bindings, plan.fields, outcome) }, moved: plan.moved }
}

/**
 * The record a write decides over, as this actor reads it, and the root's
 * description that read carried -- or, for an actor who may not read, or
 * after a read that failed, the root described in a statement of its own.
 * `unread` is the read's failure, which the caller answers where only the
 * read could tell an echo from a change (0040). An update's, and a change
 * from a date's (0113).
 */
export async function readForWrite(
  steps: Pick<WriteRouteSteps, 'describedRoot'>,
  bundle: PublishedBundle,
  open: OpenConnection,
  actor: PolicyContext,
  record: string,
): Promise<{ ok: true; current: FormRecord | undefined; unread: RecordFailure | undefined; described: DescribedTable } | { ok: false; answer: WriteAnswer }> {
  let current: FormRecord | undefined
  let unread: RecordFailure | undefined
  let described: DescribedTable | undefined
  const reading = planRead(bundle.snapshot, bundle.bindings, bundle.policy, actor, record)
  if (reading.ok) {
    const stored = await open.records.read(reading.request)
    if (!stored.ok) unread = stored
    else {
      described = stored.described
      if (stored.record === null) unread = NOT_FOUND
      else current = toFormAnswers(bundle.bindings, reading.fields, { ok: true, ...stored.record })
    }
  }
  if (described === undefined) {
    const root = await steps.describedRoot(bundle, open)
    if (!root.ok) return { ok: false, answer: root.answer }
    described = root.described
  }
  return { ok: true, current, unread, described }
}

/**
 * `POST /v1/forms/:id/records/create` and `POST /v1/forms/:id/records/update`:
 * a record's answers written under the form's policy, each once per sending
 * of its write id (0031). The body is checked first, and an update's audit
 * trail names its record; then the write id, the published form and its
 * connection, and the write itself, `created` or `updated`.
 */
export function registerWriteRoutes(app: FastifyInstance, steps: WriteRouteSteps): void {
  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/create', async (request, reply) => {
    const body = request.body
    if (!isRecord(body) || !isRecord(body['answers'])) return reply.code(400).send({ code: 'invalid-request', message: 'Expected { answers }.' })
    const id = writeId(request)
    if (id === null) return steps.answered(reply, INVALID_WRITE_ID)
    const bundle = await steps.published(request.params.id, reply)
    if (bundle === undefined) return reply
    const open = await steps.connection(bundle, reply)
    if (open === undefined) return reply
    const answers = body['answers']
    return steps.answered(reply, await steps.sendOnce(request, 'create', id, () => created(steps, request, bundle, open, answers)))
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/update', async (request, reply) => {
    const body = request.body
    if (!isRecord(body) || typeof body['record'] !== 'string' || typeof body['version'] !== 'string' || !isRecord(body['answers'])) {
      return reply.code(400).send({ code: 'invalid-request', message: 'Expected { record, version, answers }.' })
    }
    if (request.auditTrail !== undefined) request.auditTrail.record = body['record']
    const id = writeId(request)
    if (id === null) return steps.answered(reply, INVALID_WRITE_ID)
    const bundle = await steps.published(request.params.id, reply)
    if (bundle === undefined) return reply
    const open = await steps.connection(bundle, reply)
    if (open === undefined) return reply
    const { record, version, answers } = body
    const updated = async (): Promise<WriteAnswer> => {
      const { answer, moved } = await updateOne(steps, request, bundle, open, { record, version, answers })
      // Whether the update, as planned, moves the state field (0112); a write refused before it was planned names none.
      if (request.auditTrail !== undefined && moved !== null) request.auditTrail.moved = moved
      return answer
    }
    return steps.answered(reply, await steps.sendOnce(request, 'update', id, updated))
  })
}
