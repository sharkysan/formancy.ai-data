import { authorizeOperation, planSupersede, toFormAnswers } from '@formancy/data-core'
import type { DescribedTable, FormRecord, MembershipCheck, PlanRefusal, PolicyContext, RecordFailure, UnknownOutcome } from '@formancy/data-core'
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { planRefusal, recordFailure } from './runtime-errors.js'
import { INVALID_WRITE_ID, writeId } from './write-once.js'
import type { WriteAnswer } from './write-once.js'

type RuntimeRequest = FastifyRequest<{ Params: { id: string } }>

/** What the change route borrows from the runtime plane, so it reads, plans and answers each step as the update and the create do. */
export interface SupersedeRouteSteps {
  /** The published bundle, or a reply already sent. */
  published(id: string, reply: FastifyReply): Promise<PublishedBundle | undefined>
  /** The form's connection, or a reply already sent. */
  connection(bundle: PublishedBundle, reply: FastifyReply): Promise<OpenConnection | undefined>
  context(request: FastifyRequest): PolicyContext
  /** Runs `perform` once per sending of a write id, and answers a later sending with its answer (0031). */
  sendOnce(
    request: RuntimeRequest,
    operation: UnknownOutcome['operation'],
    id: string | undefined,
    perform: () => Promise<WriteAnswer>,
  ): Promise<WriteAnswer & { repeated?: boolean }>
  /** A write sent whose answer was lost: said in the log, answered 502 with what was addressed, never sent again. */
  lost(request: RuntimeRequest, operation: UnknownOutcome['operation'], record: string | null, version: string | null, failure: string): WriteAnswer
  /** A planner's refusal as the answer, its drift said in the log first. */
  refusal(request: RuntimeRequest, operation: 'update', plan: PlanRefusal): WriteAnswer
  /** An answer, sent, with what the audit names. */
  answered(reply: FastifyReply, answer: WriteAnswer & { repeated?: boolean }): Promise<FastifyReply>
  /** The record as this actor reads it, and the description a write is decided over. */
  readForWrite(
    bundle: PublishedBundle,
    open: OpenConnection,
    actor: PolicyContext,
    record: string,
  ): Promise<{ ok: true; current: FormRecord | undefined; unread: RecordFailure | undefined; described: DescribedTable } | { ok: false; answer: WriteAnswer }>
  /** The answers less the echoes of fields this actor may not write on `operation` (0022, 0098). */
  withoutEchoes(
    bundle: PublishedBundle,
    actor: PolicyContext,
    operation: 'create' | 'update',
    answers: unknown,
    current?: Readonly<Record<string, unknown>>,
    behind?: boolean,
  ): unknown
  /** Every membership check run, or the refusal to answer (0031, 0061). */
  memberships(open: OpenConnection, checks: readonly MembershipCheck[], log: FastifyBaseLogger): Promise<WriteAnswer | undefined>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * One change from a date (0113), from the read it is decided over to the
 * write, answered rather than sent: the route runs it once per sending
 * (0031).
 *
 * The policy is asked for update and create before any statement (0041).
 * The open version is read next, as an update reads its record, and the
 * change is decided over that read: a renderer submits the copy of the
 * version it showed, so the echo of a field this actor may not write on
 * create is removed where it equals the version as read, and the planner
 * drops the chain's own. Then every selection is rechecked, and the adapter
 * ends the open version and inserts the next in one write. A read that
 * failed is its own answer where the change needed it. The answer is the
 * next version, 201, as a create's is; the audit names the version ended,
 * the record the request addressed.
 */
async function superseded(
  steps: SupersedeRouteSteps,
  request: RuntimeRequest,
  bundle: PublishedBundle,
  open: OpenConnection,
  record: string,
  version: string,
  answers: Record<string, unknown>,
): Promise<WriteAnswer> {
  const actor = steps.context(request)
  for (const operation of ['update', 'create'] as const) {
    const authorized = authorizeOperation(bundle.policy, actor, operation)
    if (!authorized.ok) return planRefusal(authorized.code, authorized.message)
  }
  const read = await steps.readForWrite(bundle, open, actor, record)
  if (!read.ok) return read.answer
  const { current, unread, described } = read
  // Read at a newer version than the one sent: the change will be stale, and an echo the record moved is not the person's (0098).
  const behind = current !== undefined && current.version !== null && current.version !== version
  const submitted = steps.withoutEchoes(bundle, actor, 'create', answers, current?.answers, behind)
  const plan = planSupersede(bundle.snapshot, bundle.bindings, bundle.policy, actor, record, version, submitted, current, described)
  if (!plan.ok) {
    if (plan.code === 'invalid-values') return { status: 422, body: { code: plan.code, message: plan.message, fieldErrors: plan.fieldErrors } }
    if (plan.code === 'record-not-read' && unread !== undefined) return recordFailure(bundle.bindings, unread)
    return steps.refusal(request, 'update', plan)
  }
  if (request.auditTrail !== undefined) request.auditTrail.moved = plan.moved
  const refused = await steps.memberships(open, plan.memberships, request.log)
  if (refused !== undefined) return refused
  const outcome = await open.records.supersede(plan.request)
  if (!outcome.ok && outcome.code === 'unknown-outcome') return steps.lost(request, 'supersede', record, version, outcome.message)
  if (!outcome.ok) return recordFailure(bundle.bindings, outcome)
  return { status: 201, body: toFormAnswers(bundle.bindings, plan.fields, outcome) }
}

/**
 * `POST /v1/forms/:id/records/supersede` (0113): the open version of a
 * chain, by its token and the version its person read, changed from the
 * date its answers start the next one at. A POST with a body, as every
 * runtime write is; the body is checked first and the audit trail names the
 * version addressed, then the write id, as an update's (0031). A 201 with
 * the next version, which has its own token and version; every refusal is
 * an update's or a create's, and an ended version is 409 `version-ended`.
 */
export function registerSupersedeRoute(app: FastifyInstance, steps: SupersedeRouteSteps): void {
  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/supersede', async (request, reply) => {
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
    const { record, version } = body
    const answers = body['answers']
    return steps.answered(reply, await steps.sendOnce(request, 'supersede', id, () => superseded(steps, request, bundle, open, record, version, answers)))
  })
}
