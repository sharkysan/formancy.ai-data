import { authorizeBulk, bulkAnswers, bulkOffered, chosenTwice, readBulkBody, readChangeBody } from '@formancy/data-core'
import type {
  ChosenAnswer,
  ChosenBody,
  ChosenChangeBody,
  ChosenOutcome,
  PlanRefusal,
  PolicyContext,
  PolicyOperation,
  PublishedForm,
  RuntimeRefusal,
  UnknownOutcome,
} from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { deleteOne } from './runtime-deletes.js'
import type { DeleteRouteSteps } from './runtime-deletes.js'
import { planRefusal } from './runtime-errors.js'
import { memberships, updateOne, vouchedAs } from './runtime-writes.js'
import type { WriteRouteSteps } from './runtime-writes.js'
import { INVALID_WRITE_ID, writeId } from './write-once.js'
import type { WriteAnswer } from './write-once.js'

/*
 * The chosen records of a page, each `{ record, version }`, written each on
 * its own -- one record's write exactly the one its own route makes, in
 * its own transaction, in the order sent -- and answered with what became
 * of each:
 *
 * - `POST /v1/forms/:id/records/delete-chosen` (0173) with `{ records }`,
 *   each record `deleteOne`, the body of `POST …/records/delete`;
 * - `POST /v1/forms/:id/records/update-chosen` (0175) with
 *   `{ records, answers }`, each record set to the same answers by
 *   `updateOne`, the body of `POST …/records/update`.
 *
 * In this order, each step answering alone:
 *
 * 1. the body's shape (400), one to a page of records (`readBulkBody`,
 *    `readChangeBody`), before the write id is read; the trail names every
 *    record from here;
 * 2. the write id (400 for one that is not one);
 * 3. the published form, which validates (0019), and its connection;
 * 4. who may send one (`authorizeBulk`): 403 before any statement;
 * 5. no record named twice (`chosenTwice`): 400 `duplicate-record`,
 *    naming the token, before any statement;
 * 6. for a change, what is the same for every record, once: the answers
 *    (`bulkAnswers`) -- a field outside the grant 403, a value no codec
 *    takes 422 -- and then each selection's membership check, 422 for one
 *    not among the options, before any record is read;
 * 7. for each record in the order sent, the deadline first -- past it,
 *    that record and every one after it is `{ sent: false }` -- then the
 *    single write's code, whose status and body are that record's outcome.
 *    A refusal about the record -- stale, not found, referenced, declined,
 *    a move its state does not allow -- and the request goes on; a lost
 *    answer or a database out of reach, and it stops, every record after
 *    it `{ sent: false }`, since the connection is then in doubt. A write
 *    that throws stops it too, that record answered 500 in the server's
 *    own words, which a client reads as its write unknown, and the error
 *    said in the log. A first record refused for what the form or its
 *    connection is rather than what the record is -- drift or the table
 *    changed (409), a configuration the server cannot apply (500), a
 *    connection the database will not let write (403) -- is the request's
 *    answer, once: every other would be refused the same way, and nothing
 *    was written.
 *
 * 4 to 7 run once per sending of the write id (0031), so a sending that
 * arrives again is answered with the first one's answer -- each record's
 * outcome as it was -- and asks the database nothing. The deadline is
 * counted from the start of 4, so 6's checks are inside it. A request goes
 * on after its client leaves, as a write does. 200 with `{ records }` in
 * the order sent. The trail names every record by its keyed hash, their
 * count, and what became of each by its code (`outcomes`); never a value.
 */

/** A request over chosen records, by the write id's and the trail's name for it. */
type ChosenOperation = 'delete-chosen' | 'update-chosen'

/** What the routes borrow from the runtime plane: a delete's steps and an update's, and their own deadline. */
export interface BulkRouteSteps extends Omit<DeleteRouteSteps, 'sendOnce' | 'lost' | 'refusal'>, Pick<WriteRouteSteps, 'describedRoot' | 'lookupDeadlineMs'> {
  /** Runs `perform` once per sending of a write id, and answers a later sending with its answer (0031). */
  sendOnce(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: ChosenOperation,
    id: string | undefined,
    perform: () => Promise<WriteAnswer>,
  ): Promise<WriteAnswer & { repeated?: boolean }>
  /** A write sent whose answer was lost: said in the log, answered 502 with what was addressed, never sent again. */
  lost(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: UnknownOutcome['operation'],
    record: string | null,
    version: string | null,
    failure: string,
  ): WriteAnswer
  /** A planner's refusal as the answer, its drift said in the log first. */
  refusal(request: FastifyRequest<{ Params: { id: string } }>, operation: PolicyOperation, plan: PlanRefusal): WriteAnswer
  /** One record's answer said in the log as a single write's is: a declined one by its code and the form, never its words (0156). */
  noted(request: FastifyRequest, answer: WriteAnswer): void
  /** How long a request may go on sending its records (`bulk-deadline.ts`). */
  bulkDeadlineMs: number
}

type Request = FastifyRequest<{ Params: { id: string } }>

/** A record's outcome after which nothing more is sent: its answer lost, or the database out of reach -- the connection is then in doubt. */
const STOPS: ReadonlySet<string> = new Set(['unknown-outcome', 'unavailable'])

/**
 * A refusal of the first record that is about the form or its connection,
 * not the record, so every other would be refused the same way: drift, a
 * configuration the server cannot apply, the table gone or changed under
 * the form, and a connection the database will not let write. Nothing was
 * written by any of them.
 */
const ABOUT_THE_FORM: ReadonlySet<string> = new Set(['drift', 'invalid-policy', 'invalid-bindings', 'schema-changed', 'permission-denied'])

/** How each request's write is said where it threw: the record's answer, in the server's own words and never the error's, and the log's sentence. */
const THROWN: Readonly<Record<ChosenOperation, { answer: { status: number; body: RuntimeRefusal }; said: string }>> = {
  'delete-chosen': {
    answer: {
      status: 500,
      body: { code: 'internal', message: "This record's delete failed in the server, and it may have been deleted; the operator's log says why." },
    },
    said: 'a delete of a chosen record failed in the server; the records after it were not sent',
  },
  'update-chosen': {
    answer: {
      status: 500,
      body: { code: 'internal', message: "This record's change failed in the server, and it may have been changed; the operator's log says why." },
    },
    said: 'a change of a chosen record failed in the server; the records after it were not sent',
  },
}

function codeOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Each record's outcome as the trail names it: `done`, the code it was refused with, or `not-sent`; null where the answer is not one per record. */
function outcomesOf(answer: WriteAnswer): string[] | null {
  if (answer.status !== 200) return null
  return (answer.body as ChosenAnswer<unknown>).records.map((outcome) =>
    !outcome.sent ? 'not-sent' : outcome.status === 200 ? 'done' : (codeOf(outcome.body) ?? 'refused'),
  )
}

/**
 * Step 7, for either operation: each record's write alone (`one`), in the
 * order sent, under the deadline (`until`), the stop rule and the first
 * record's rule above, a throw its record's 500. One loop for both, so a
 * delete and a change of chosen records cannot stop, or answer a first
 * record, apart.
 */
async function eachChosen(
  steps: BulkRouteSteps,
  request: Request,
  operation: ChosenOperation,
  records: ChosenBody['records'],
  until: number,
  one: (record: string, version: string) => Promise<WriteAnswer>,
): Promise<WriteAnswer> {
  const outcomes: Array<ChosenOutcome<unknown>> = []
  let stopped: 'deadline' | 'doubt' | null = null
  for (const [index, { record, version }] of records.entries()) {
    if (stopped === null && Date.now() >= until) stopped = 'deadline'
    if (stopped !== null) {
      outcomes.push({ sent: false })
      continue
    }
    let answer: WriteAnswer
    try {
      answer = await one(record, version)
    } catch (error) {
      // Whatever it had sent, nobody here can say, so nothing more is; the
      // records before it keep their outcomes, in the answer and the trail.
      request.log.error({ form: request.params.id, err: error }, THROWN[operation].said)
      outcomes.push({ sent: true, ...THROWN[operation].answer })
      stopped = 'doubt'
      continue
    }
    const code = codeOf(answer.body)
    if (index === 0 && code !== undefined && ABOUT_THE_FORM.has(code)) return answer
    steps.noted(request, answer)
    outcomes.push({ sent: true, status: answer.status, body: answer.body })
    if (code !== undefined && STOPS.has(code)) stopped = 'doubt'
  }
  if (stopped === 'deadline') {
    const unsent = outcomes.filter((outcome) => !outcome.sent).length
    request.log.warn(
      { form: request.params.id, sent: outcomes.length - unsent, unsent, deadlineMs: steps.bulkDeadlineMs },
      'a request over chosen records passed its deadline; the records after it were not sent',
    )
  }
  return { status: 200, body: { records: outcomes } satisfies ChosenAnswer<unknown> }
}

/** Steps 4 and 5, for either operation: who may send one, and no record named twice; undefined where both hold. */
function refusedAsAWhole(
  steps: BulkRouteSteps,
  request: Request,
  bundle: PublishedBundle,
  operation: 'delete' | 'update',
  records: ChosenBody['records'],
): WriteAnswer | undefined {
  const allowed = authorizeBulk(bundle.policy, steps.context(request), bundle.bindings, operation)
  if (!allowed.ok) return planRefusal(allowed.code, allowed.message)
  const twice = chosenTwice(bundle.snapshot, bundle.bindings, records)
  if (twice === null) return undefined
  const named = twice.records.map((at) => records[at]?.record ?? '')
  return { status: 400, body: { code: twice.code, message: twice.message, records: named } satisfies RuntimeRefusal & { records: string[] } }
}

/** Steps 4 to 7 of a delete, answered rather than sent: the route runs it once per sending of the write id. */
async function deletedEach(steps: BulkRouteSteps, request: Request, bundle: PublishedBundle, open: OpenConnection, body: ChosenBody): Promise<WriteAnswer> {
  const until = Date.now() + steps.bulkDeadlineMs
  const refused = refusedAsAWhole(steps, request, bundle, 'delete', body.records)
  if (refused !== undefined) return refused
  return eachChosen(steps, request, 'delete-chosen', body.records, until, (record, version) => deleteOne(steps, request, bundle, open, record, version))
}

/**
 * Steps 4 to 7 of a change, answered rather than sent. The answers are
 * read once (`bulkAnswers`) and each selection checked once, before any
 * record is read; each record's update then asks no check the request has
 * vouched for (`vouchedAs`), and runs any other, which these answers and
 * this person's filters do not make.
 */
async function changedEach(
  steps: BulkRouteSteps,
  request: Request,
  bundle: PublishedBundle,
  open: OpenConnection,
  body: ChosenChangeBody,
): Promise<WriteAnswer> {
  const until = Date.now() + steps.bulkDeadlineMs
  const refused = refusedAsAWhole(steps, request, bundle, 'update', body.records)
  if (refused !== undefined) return refused
  const decided = bulkAnswers(bundle.snapshot, bundle.bindings, bundle.policy, steps.context(request), body.answers)
  if (!decided.ok) {
    if (decided.code === 'invalid-values') return { status: 422, body: { code: decided.code, message: decided.message, fieldErrors: decided.fieldErrors } }
    return steps.refusal(request, 'update', decided)
  }
  // A selection no record could take refuses the request, as an update alone of any of them would be refused.
  const unoffered = await memberships(open, decided.memberships, request.log, steps.lookupDeadlineMs)
  if (unoffered !== undefined) return unoffered
  const vouched = new Set(decided.memberships.map(vouchedAs))
  return eachChosen(steps, request, 'update-chosen', body.records, until, async (record, version) => {
    const { answer } = await updateOne(steps, request, bundle, open, { record, version, answers: body.answers }, vouched)
    return answer
  })
}

/**
 * What this person may do to a page's chosen records together, as
 * `GET /v1/forms/:id` says it (0173, 0175): `bulkOffered`'s answer, where
 * the operations the database still allows hold the write.
 */
export function chosenOffered(bundle: PublishedBundle, actor: PolicyContext, operations: readonly PolicyOperation[]): PublishedForm['bulk'] {
  const offered = bulkOffered(bundle.policy, actor, bundle.bindings)
  return { delete: operations.includes('delete') && offered.delete, update: operations.includes('update') ? offered.update : null }
}

/** Registers both routes (0173, 0175). */
export function registerBulkRoute(app: FastifyInstance, steps: BulkRouteSteps): void {
  const route = <T extends ChosenBody>(
    operation: ChosenOperation,
    read: (body: unknown) => { ok: true; body: T } | PlanRefusal,
    perform: (request: Request, bundle: PublishedBundle, open: OpenConnection, body: T) => Promise<WriteAnswer>,
  ) =>
    app.post<{ Params: { id: string } }>(`/v1/forms/:id/records/${operation}`, async (request, reply: FastifyReply) => {
      const shaped = read(request.body)
      if (!shaped.ok) return reply.code(400).send({ code: shaped.code, message: shaped.message })
      const trail = request.auditTrail
      // Every record the request names, by its keyed hash, from before the write id is read: a refused request names them too.
      if (trail !== undefined) {
        trail.records = shaped.body.records.map(({ record }) => record)
        trail.rows = shaped.body.records.length
        trail.outcomes = null
      }
      const id = writeId(request)
      if (id === null) return steps.answered(reply, INVALID_WRITE_ID)
      const bundle = await steps.published(request.params.id, reply)
      if (bundle === undefined) return reply
      const open = await steps.connection(bundle, reply)
      if (open === undefined) return reply
      const answer = await steps.sendOnce(request, operation, id, () => perform(request, bundle, open, shaped.body))
      // What became of each record, said by the sending that sent them; one answered again says it was (0031).
      if (trail !== undefined && answer.repeated !== true) trail.outcomes = outcomesOf(answer)
      return steps.answered(reply, answer)
    })
  route('delete-chosen', readBulkBody, (request, bundle, open, body) => deletedEach(steps, request, bundle, open, body))
  route('update-chosen', readChangeBody, (request, bundle, open, body) => changedEach(steps, request, bundle, open, body))
}
