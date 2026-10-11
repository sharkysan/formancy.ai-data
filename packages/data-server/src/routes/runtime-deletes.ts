import { authorizeOperation, planDelete, recordToken } from '@formancy/data-core'
import type { PlanRefusal, PolicyContext, RecordDeleted } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { deleteFailure, planRefusal } from './runtime-errors.js'
import { INVALID_WRITE_ID, writeId } from './write-once.js'
import type { WriteAnswer } from './write-once.js'

/** What the delete route borrows from the runtime plane, so it decides each step as the update route does. */
export interface DeleteRouteSteps {
  /** The published bundle, or a reply already sent. */
  published(id: string, reply: FastifyReply): Promise<PublishedBundle | undefined>
  /** The form's connection, or a reply already sent. */
  connection(bundle: PublishedBundle, reply: FastifyReply): Promise<OpenConnection | undefined>
  context(request: FastifyRequest): PolicyContext
  /** Runs `perform` once per sending of a write id, and answers a later sending with its answer (0031). */
  sendOnce(request: FastifyRequest<{ Params: { id: string } }>, operation: 'delete', id: string | undefined, perform: () => Promise<WriteAnswer>): Promise<WriteAnswer & { repeated?: boolean }>
  /** A write sent whose answer was lost: said in the log, answered 502 with what was addressed, never sent again. */
  lost(request: FastifyRequest<{ Params: { id: string } }>, operation: 'delete', record: string, version: string, failure: string): WriteAnswer
  /** A planner's refusal as the answer, its drift said in the log first. */
  refusal(request: FastifyRequest<{ Params: { id: string } }>, operation: 'delete', plan: PlanRefusal): WriteAnswer
  /** A refusal, sent, with what the audit names. */
  answered(reply: FastifyReply, answer: WriteAnswer & { repeated?: boolean }): Promise<FastifyReply>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * One delete, from the description it is decided over to the statement,
 * answered rather than sent: the route runs it once per sending, so a write
 * id that arrives again is answered with this answer and asks the database
 * nothing (0031).
 *
 * The policy is asked first, before any statement (0041); then the root is
 * described, and the delete is planned over that description and sent with
 * its definition. The answer names the row the statement deleted, by the
 * token its key makes as the database held it -- which under a
 * case-insensitive key may be spelled otherwise than the token sent (0028)
 * -- and holds no value of it, so a resend's kept answer holds none either.
 */
async function deleted(steps: DeleteRouteSteps, request: FastifyRequest<{ Params: { id: string } }>, bundle: PublishedBundle, open: OpenConnection, record: string, version: string): Promise<WriteAnswer> {
  const actor = steps.context(request)
  const authorized = authorizeOperation(bundle.policy, actor, 'delete')
  if (!authorized.ok) return planRefusal(authorized.code, authorized.message)
  const root = await open.records.describe(bundle.bindings.root)
  if (!root.ok) return deleteFailure(root)
  const plan = planDelete(bundle.snapshot, bundle.bindings, bundle.policy, actor, record, version, root.described)
  if (!plan.ok) return steps.refusal(request, 'delete', plan)
  const outcome = await open.records.delete(plan.request)
  if (!outcome.ok && outcome.code === 'unknown-outcome') return steps.lost(request, 'delete', record, version, outcome.message)
  if (!outcome.ok && outcome.code === 'foreign-key-violation') {
    // The person is told only that something refers to the record; the
    // operator, which key. Its name alone: the adapter's sentence can carry
    // the key's values.
    request.log.info({ form: request.params.id, constraint: outcome.constraint ?? null }, 'a delete was refused: other records still refer to this one')
  }
  if (!outcome.ok) return deleteFailure(outcome)
  const token = recordToken(plan.request.target.identity.map((column) => column.name), outcome.deleted.values)
  // A key the planner decoded from a token makes one again; the token sent is the fallback, never a guess.
  const removed = token.ok ? token.token : record
  return { status: 200, body: { record: removed, deleted: true } satisfies RecordDeleted, record: removed }
}

/**
 * `POST /v1/forms/:id/records/delete` (0050): one record, by its token and
 * the version its person read, under the form's policy. A POST with a
 * body, as every runtime write is: a token in a DELETE's URL would land in
 * every proxy's log (0044), and RFC 9110 gives a DELETE's body no meaning.
 *
 * The body is checked first and the audit trail names the record; then the
 * write id, as an update's (0031). A 200 with `{ record, deleted: true }`,
 * never a 204: a client counts a write done only when the answer says what
 * happened to it. Every refusal is a delete's (`deleteFailure`), and none
 * carries a field error. The audit names the operation `delete` and the
 * record by its keyed hash, the only trace of which record went (0023).
 */
export function registerDeleteRoute(app: FastifyInstance, steps: DeleteRouteSteps): void {
  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/delete', async (request, reply) => {
    const body = request.body
    if (!isRecord(body) || typeof body['record'] !== 'string' || typeof body['version'] !== 'string') {
      return reply.code(400).send({ code: 'invalid-request', message: 'Expected { record, version }.' })
    }
    if (request.auditTrail !== undefined) request.auditTrail.record = body['record']
    const id = writeId(request)
    if (id === null) return steps.answered(reply, INVALID_WRITE_ID)
    const bundle = await steps.published(request.params.id, reply)
    if (bundle === undefined) return reply
    const open = await steps.connection(bundle, reply)
    if (open === undefined) return reply
    const { record, version } = body
    return steps.answered(reply, await steps.sendOnce(request, 'delete', id, () => deleted(steps, request, bundle, open, record, version)))
  })
}
