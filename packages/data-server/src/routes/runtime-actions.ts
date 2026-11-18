import { authorizeAction, DUPLICATE_RECORD, planAction, presentedActions, readRunBody, recordToken, runFailure, runnableActions } from '@formancy/data-core'
import type {
  ActionBinding,
  ActionDone,
  ActionFailure,
  ActionRecordsRefusal,
  ActionUnknownOutcome,
  DriftVerdict,
  FormAction,
  PlanRefusal,
  PolicyContext,
  RunBody,
} from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { planRefusal } from './runtime-errors.js'
import { INVALID_WRITE_ID, writeId } from './write-once.js'
import type { WriteAnswer } from './write-once.js'

/*
 * `POST /v1/forms/:id/actions/:action/run` (0161): an action a form binds
 * (0159), run over the open record, or over a selection of up to a page of
 * records (0165), by the adapter's one transaction (0160), sent once per
 * write id and never again.
 *
 * In this order, each step answering alone:
 *
 * 1. the body's shape (400), before the write id is read, the planner's own
 *    reading (`readRunBody`), which holds it to a page of records;
 * 2. the write id (400 for one that is not one);
 * 3. the published form, which validates (0019), and an action of that
 *    name it binds (403 `operation-unavailable`);
 * 4. who may run it (`authorizeAction`): 403 before any statement, and
 *    before the connection is opened;
 * 5. a connection of the actions' pool free for it: a run that would wait
 *    in the pool's queue, its deadline running, is 503 `unavailable`, and
 *    nothing is sent;
 * 6. the root and the routine described in one statement (0041);
 * 7. the plan (`planAction`): 409 where drift stops the action, 400 for a
 *    record named twice, 422 for each answer its parameter refuses;
 * 8. the run, once, under the server's deadline, answered in the codes of
 *    0160's table.
 *
 * Steps 5 to 8 run once per sending of the write id (0031): a sending that
 * arrives again is answered with the first one's answer and asks the
 * database nothing -- before 3's binding and 4's policy are asked, so a
 * form published again between two sendings never refuses a run that was
 * sent -- and the same id with another body is refused. A run goes on
 * after its client leaves, as a write does, and a lost answer is 502,
 * naming the action and the records with the versions sent, never sent
 * again. Nothing of an answer, an input or a field's value reaches the log
 * or the audit.
 */

export interface ActionRouteSteps {
  /** The published bundle, or a reply already sent. */
  published(id: string, reply: FastifyReply): Promise<PublishedBundle | undefined>
  /** The form's connection, or a reply already sent. */
  connection(bundle: PublishedBundle, reply: FastifyReply): Promise<OpenConnection | undefined>
  context(request: FastifyRequest): PolicyContext
  /** Runs `perform` once per sending of a write id, and answers a later sending with its answer (0031). */
  sendOnce(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: `action:${string}`,
    id: string | undefined,
    perform: () => Promise<WriteAnswer>,
  ): Promise<WriteAnswer & { repeated?: boolean }>
  /** The answer an earlier sending of this write id with this body was given, or undefined; nothing is claimed. */
  sentBefore(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: `action:${string}`,
    id: string | undefined,
  ): Promise<(WriteAnswer & { repeated: true }) | undefined>
  /** A planner's refusal as the answer, its drift said in the log first. */
  refusal(request: FastifyRequest<{ Params: { id: string } }>, operation: 'action', plan: PlanRefusal): WriteAnswer
  /** An answer, sent, with what the audit names. */
  answered(reply: FastifyReply, answer: WriteAnswer & { repeated?: boolean }): Promise<FastifyReply>
  /** How long a run may take before the database stops it (`action-deadline.ts`). */
  actionDeadlineMs: number
}

type Request = FastifyRequest<{ Params: { id: string; action: string } }>

/** What a person is told when every connection of the actions' pool is running an action: nothing was sent, so nothing was done. */
const POOL_FULL: WriteAnswer = {
  status: 503,
  body: { code: 'unavailable', message: 'The database could not complete this now: every connection for actions is in use. Nothing was done.' },
}

/** What a lost run's answer says: it may have run, and running it again from the versions read is refused as changed if it did (0031, 0160). */
const MAY_HAVE_RUN =
  'The connection to the database failed after the action was sent. It may have run. Running it again from what you read is safe: if it ran, it is refused as changed since it was read.'

/**
 * The records an answer is about, by the tokens sent (0165): the positions
 * an adapter or the planner named, each one the body addressed, in order.
 */
function named(positions: readonly number[] | undefined, sent: RunBody['records']): string[] {
  return (positions ?? []).flatMap((position) => {
    const record = sent[position]?.record
    return record === undefined ? [] : [record]
  })
}

/**
 * A run that did not commit as the person is told it (0160's codes, 0161):
 * in the server's words, never the database's, but for `declined`, whose
 * sentence is the deployment's own (0156), about the run as a whole -- an
 * action's person answers its dialog, not the form, so no field error is
 * placed. Every one says nothing was done; `unknown-outcome` is the route's
 * own, which names what was addressed. A refusal about some of the records
 * -- gone, changed, ended, or two the database makes one row -- names them
 * by the tokens `sent` (0165), so a page knows which to read again.
 */
export function actionFailure(failure: ActionFailure, sent: RunBody['records']): WriteAnswer {
  const answer = (status: number, code: string, message: string): WriteAnswer => ({ status, body: { code, message } })
  const about = (status: number, code: ActionRecordsRefusal['code'], message: string): WriteAnswer => ({
    status,
    body: { code, message, records: named(failure.records, sent) } satisfies ActionRecordsRefusal,
  })
  switch (failure.code) {
    case 'not-found':
      return about(404, 'not-found', 'No such record. Nothing was done.')
    case 'stale':
      return about(409, 'stale', 'The record changed since it was read. Reload it and review the changes before running this again. Nothing was done.')
    case 'version-ended':
      return about(409, 'version-ended', 'This version has ended, and an action runs over the open version alone. Nothing was done.')
    case 'duplicate-record':
      return about(400, 'duplicate-record', DUPLICATE_RECORD)
    case 'schema-changed':
      return answer(409, 'schema-changed', 'The database changed since this form was published. Nothing was done.')
    case 'permission-denied':
      return answer(403, 'permission-denied', 'The database connection is not allowed to do this. Nothing was done.')
    case 'declined':
      // A declined run with no reason is an adapter's bug, answered as refused rather than with words nobody wrote.
      if (failure.reason !== undefined) return answer(422, 'declined', failure.reason)
      return answer(422, 'refused', 'The database refused this action, and nothing was done. Running it again will be refused the same way.')
    case 'refused':
      return answer(422, 'refused', 'The database refused this action, and nothing was done. Running it again will be refused the same way.')
    case 'unavailable':
      return answer(503, 'unavailable', 'The database could not complete this now. Nothing was done.')
    case 'action-timeout':
      return answer(503, 'action-timeout', 'It took longer than this server allows, and the database stopped it. Nothing was done.')
    case 'unknown-outcome':
      throw new Error('a run whose answer was lost is the route’s to answer, naming what it addressed')
  }
}

/**
 * The actions this person may run over the open record, as `GET
 * /v1/forms/:id` offers them (0161): every action the bindings bind, worded
 * as the presentation words it, that the policy lets them run and the
 * root as described now leaves runnable (`verdict.actions`, 0041). A
 * format-1 bundle keeps no generation request, and so binds none.
 */
export function formActions(bundle: PublishedBundle, actor: PolicyContext, verdict: DriftVerdict): FormAction[] {
  const runnable = new Set(runnableActions(bundle.policy, actor, bundle.bindings))
  const unstopped = new Set(verdict.actions ?? [])
  const words = bundle.format === 2 ? bundle.presentation.actions : undefined
  return presentedActions(bundle.bindings, words).filter((action) => runnable.has(action.name) && unstopped.has(action.name))
}

/** A run's body back as the planner reads one: what was checked by shape at step 1 is what is planned. */
function bodyOf(body: RunBody): { records: RunBody['records']; answers: Record<string, unknown> } {
  return { records: body.records, answers: Object.fromEntries(body.answers) }
}

/**
 * Steps 6 to 8, answered rather than sent, with a connection of the
 * actions' pool already held: the root and the routine described, the run
 * planned over them, and sent once.
 */
async function ran(
  steps: ActionRouteSteps,
  request: Request,
  bundle: PublishedBundle,
  open: OpenConnection,
  action: ActionBinding,
  body: RunBody,
): Promise<WriteAnswer> {
  const described = await open.actions.describe(bundle.bindings.root, action.routine)
  if (!described.ok) {
    // A description reads; a lost answer to one changed nothing, and an adapter that said otherwise is wrong.
    if (described.code === 'unknown-outcome') throw new Error('a description is a read, which has no unknown outcome')
    return actionFailure(runFailure(described), body.records)
  }
  const plan = planAction(bundle.snapshot, bundle.bindings, bundle.policy, steps.context(request), action.name, bodyOf(body), {
    table: described.table,
    routine: described.routine,
  })
  if (!plan.ok) {
    if (plan.code === 'invalid-values') return { status: 422, body: { code: plan.code, message: plan.message, fieldErrors: plan.fieldErrors } }
    if (plan.code === 'duplicate-record') return actionFailure({ ok: false, code: plan.code, message: plan.message, records: plan.records }, body.records)
    return steps.refusal(request, 'action', plan)
  }
  const outcome = await open.actions.run(plan.request, steps.actionDeadlineMs)
  if (!outcome.ok && outcome.code === 'unknown-outcome') {
    // Said once, with the adapter's sentence, which names no value; never sent again.
    request.log.warn(
      { form: request.params.id, operation: 'action', action: action.name, failure: outcome.message },
      'an action was sent and its answer lost; it is not run again',
    )
    const records = body.records.map(({ record, version }) => ({ record, version }))
    const lost: ActionUnknownOutcome = { code: 'unknown-outcome', message: MAY_HAVE_RUN, operation: 'action', action: action.name, records }
    return { status: 502, body: lost, ...trailed(action, records[0]?.record) }
  }
  if (!outcome.ok) return actionFailure(outcome, body.records)
  const identity = plan.request.target.identity.map((column) => column.name)
  // Each record as the statement that moved it read its key, so a token answered is the row's own (0028); the token sent where none can be made.
  const tokens = outcome.records.map((values, index) => {
    const token = recordToken(identity, values)
    return token.ok ? token.token : (body.records[index]?.record ?? '')
  })
  return { status: 200, body: { records: tokens } satisfies ActionDone, ...trailed(action, tokens[0]) }
}

/** The record an answer names in the trail: the open record's, as its token stands; a selection's are named before it ran (`registerActionRoute`). */
function trailed(action: ActionBinding, record: string | undefined): { record?: string } {
  return action.scope === 'record' && record !== undefined ? { record } : {}
}

/**
 * Registers the route. The runs in flight on each connection's actions'
 * pool are counted here, against the bound the connection reports
 * (`OpenConnection.actionPool`), from before the description to the run's
 * answer: a run never waits for a connection with its deadline running,
 * and a full pool refuses the next before anything is sent.
 */
export function registerActionRoute(app: FastifyInstance, steps: ActionRouteSteps): void {
  const inFlight = new WeakMap<OpenConnection, number>()

  app.post<{ Params: { id: string; action: string } }>('/v1/forms/:id/actions/:action/run', async (request, reply) => {
    const read = readRunBody(request.body)
    if (!read.ok) return reply.code(400).send({ code: read.code, message: read.message })
    const trail = request.auditTrail
    // The record addressed, by its keyed hash: an action over the open record names one.
    const first = read.body.records[0]
    if (trail !== undefined && first !== undefined) trail.record = first.record
    const id = writeId(request)
    if (id === null) return steps.answered(reply, INVALID_WRITE_ID)
    const bundle = await steps.published(request.params.id, reply)
    if (bundle === undefined) return reply
    const action = (bundle.bindings.actions ?? []).find((candidate) => candidate.name === request.params.action)
    // Named once the form binds it: a name only the URL said is never written to the trail.
    if (trail !== undefined && action !== undefined) trail.action = action.name
    // A selection is named in the trail by every record it addressed, and their count (0165).
    if (trail !== undefined && action?.scope === 'selection') {
      delete trail.record
      trail.records = read.body.records.map(({ record }) => record)
      trail.rows = read.body.records.length
    }
    // Each action an operation of its own, by the URL's name: the bound one's wherever a run was sent.
    const operation = `action:${request.params.action}` as const
    // A sending acted on already is answered as it was, whatever the form published now binds or allows.
    const earlier = await steps.sentBefore(request, operation, id)
    if (earlier !== undefined) return steps.answered(reply, earlier)
    if (action === undefined) return steps.answered(reply, planRefusal('operation-unavailable', 'This form offers no such action.'))
    const allowed = authorizeAction(bundle.policy, steps.context(request), bundle.bindings, action.name)
    if (!allowed.ok) return steps.answered(reply, planRefusal(allowed.code, allowed.message))
    const open = await steps.connection(bundle, reply)
    if (open === undefined) return reply
    const answer = await steps.sendOnce(request, operation, id, async () => {
      const running = inFlight.get(open) ?? 0
      if (running >= open.actionPool) {
        request.log.warn({ form: request.params.id, action: action.name, running }, 'refused: every connection for actions is running one; nothing was sent')
        return POOL_FULL
      }
      inFlight.set(open, running + 1)
      try {
        return await ran(steps, request, bundle, open, action, read.body)
      } finally {
        inFlight.set(open, (inFlight.get(open) ?? 1) - 1)
      }
    })
    return steps.answered(reply, answer)
  })
}
