import { authorizeBulk, chosenTwice, readBulkBody } from '@formancy/data-core'
import type { ChosenAnswer, ChosenBody, ChosenOutcome, RuntimeRefusal } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { deleteOne } from './runtime-deletes.js'
import type { DeleteRouteSteps } from './runtime-deletes.js'
import { planRefusal } from './runtime-errors.js'
import { INVALID_WRITE_ID, writeId } from './write-once.js'
import type { WriteAnswer } from './write-once.js'

/*
 * `POST /v1/forms/:id/records/delete-chosen` (0173): the chosen records of
 * a page, each `{ record, version }`, deleted each on its own -- one
 * record's delete exactly the one `POST …/records/delete` makes
 * (`deleteOne`), in its own transaction, in the order sent -- and answered
 * with what became of each.
 *
 * In this order, each step answering alone:
 *
 * 1. the body's shape (400), one to a page of records (`readBulkBody`),
 *    before the write id is read; the trail names every record from here;
 * 2. the write id (400 for one that is not one);
 * 3. the published form, which validates (0019), and its connection;
 * 4. who may delete chosen records together (`authorizeBulk`): 403 before
 *    any statement;
 * 5. no record named twice (`chosenTwice`): 400 `duplicate-record`,
 *    naming the token, before any statement;
 * 6. for each record in the order sent, the deadline first -- past it,
 *    that record and every one after it is `{ sent: false }` -- then the
 *    single delete's code, whose status and body are that record's
 *    outcome. A refusal about the record -- stale, not found, referenced,
 *    declined -- and the request goes on; a lost answer or a database out
 *    of reach, and it stops, every record after it `{ sent: false }`,
 *    since the connection is then in doubt. A delete that throws stops it
 *    too, that record answered 500 in the server's own words, which a
 *    client reads as its delete unknown, and the error said in the log.
 *    A first record refused for what the form or its connection is rather
 *    than what the record is -- drift or the table changed (409), a
 *    configuration the server cannot apply (500), a connection the
 *    database will not let delete (403) -- is the request's answer, once:
 *    every other would be refused the same way, and nothing was deleted.
 *
 * 4 to 6 run once per sending of the write id (0031), so a sending that
 * arrives again is answered with the first one's answer -- each record's
 * outcome as it was -- and asks the database nothing. A request goes on
 * after its client leaves, as a write does. 200 with `{ records }` in the
 * order sent. The trail names every record by its keyed hash, their count,
 * and what became of each by its code (`outcomes`); never a value.
 */

/** What the route borrows from the runtime plane: the delete route's steps, and its own deadline. */
export interface BulkRouteSteps extends Omit<DeleteRouteSteps, 'sendOnce'> {
  /** Runs `perform` once per sending of a write id, and answers a later sending with its answer (0031). */
  sendOnce(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: 'delete-chosen',
    id: string | undefined,
    perform: () => Promise<WriteAnswer>,
  ): Promise<WriteAnswer & { repeated?: boolean }>
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
 * the form, and a connection the database will not let delete. Nothing was
 * deleted by any of them.
 */
const ABOUT_THE_FORM: ReadonlySet<string> = new Set(['drift', 'invalid-policy', 'invalid-bindings', 'schema-changed', 'permission-denied'])

/** A record's delete that threw, in the server's own words: never the error's, which are the operator's. Read by a client as that record's delete unknown. */
const THREW = {
  status: 500,
  body: { code: 'internal', message: "This record's delete failed in the server, and it may have been deleted; the operator's log says why." },
} satisfies { status: number; body: RuntimeRefusal }

function codeOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Each record's outcome as the trail names it: `done`, the code it was refused with, or `not-sent`; null where the answer is not one per record. */
function outcomesOf(answer: WriteAnswer): string[] | null {
  if (answer.status !== 200) return null
  return (answer.body as ChosenAnswer).records.map((outcome) =>
    !outcome.sent ? 'not-sent' : outcome.status === 200 ? 'done' : (codeOf(outcome.body) ?? 'refused'),
  )
}

/** Steps 4 to 6, answered rather than sent: the route runs it once per sending of the write id. */
async function deletedEach(
  steps: BulkRouteSteps,
  request: Request,
  bundle: PublishedBundle,
  open: OpenConnection,
  records: ChosenBody['records'],
): Promise<WriteAnswer> {
  const allowed = authorizeBulk(bundle.policy, steps.context(request), bundle.bindings)
  if (!allowed.ok) return planRefusal(allowed.code, allowed.message)
  const twice = chosenTwice(bundle.snapshot, bundle.bindings, records)
  if (twice !== null) {
    const named = twice.records.map((at) => records[at]?.record ?? '')
    return { status: 400, body: { code: twice.code, message: twice.message, records: named } satisfies RuntimeRefusal & { records: string[] } }
  }
  const until = Date.now() + steps.bulkDeadlineMs
  const outcomes: ChosenOutcome[] = []
  let stopped: 'deadline' | 'doubt' | null = null
  for (const [index, { record, version }] of records.entries()) {
    if (stopped === null && Date.now() >= until) stopped = 'deadline'
    if (stopped !== null) {
      outcomes.push({ sent: false })
      continue
    }
    let answer: WriteAnswer
    try {
      answer = await deleteOne(steps, request, bundle, open, record, version)
    } catch (error) {
      // Whatever it had sent, nobody here can say, so nothing more is; the
      // records before it keep their outcomes, in the answer and the trail.
      request.log.error({ form: request.params.id, err: error }, 'a delete of a chosen record failed in the server; the records after it were not sent')
      outcomes.push({ sent: true, ...THREW })
      stopped = 'doubt'
      continue
    }
    const code = codeOf(answer.body)
    if (index === 0 && code !== undefined && ABOUT_THE_FORM.has(code)) return answer
    steps.noted(request, answer)
    outcomes.push({ sent: true, status: answer.status, body: answer.body as Extract<ChosenOutcome, { sent: true }>['body'] })
    if (code !== undefined && STOPS.has(code)) stopped = 'doubt'
  }
  if (stopped === 'deadline') {
    const unsent = outcomes.filter((outcome) => !outcome.sent).length
    request.log.warn(
      { form: request.params.id, sent: outcomes.length - unsent, unsent, deadlineMs: steps.bulkDeadlineMs },
      'a request over chosen records passed its deadline; the records after it were not sent',
    )
  }
  return { status: 200, body: { records: outcomes } satisfies ChosenAnswer }
}

/** Registers the route (0173). */
export function registerBulkRoute(app: FastifyInstance, steps: BulkRouteSteps): void {
  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/delete-chosen', async (request, reply: FastifyReply) => {
    const read = readBulkBody(request.body)
    if (!read.ok) return reply.code(400).send({ code: read.code, message: read.message })
    const { records } = read.body
    const trail = request.auditTrail
    // Every record the request names, by its keyed hash, from before the write id is read: a refused request names them too.
    if (trail !== undefined) {
      trail.records = records.map(({ record }) => record)
      trail.rows = records.length
      trail.outcomes = null
    }
    const id = writeId(request)
    if (id === null) return steps.answered(reply, INVALID_WRITE_ID)
    const bundle = await steps.published(request.params.id, reply)
    if (bundle === undefined) return reply
    const open = await steps.connection(bundle, reply)
    if (open === undefined) return reply
    const answer = await steps.sendOnce(request, 'delete-chosen', id, () => deletedEach(steps, request, bundle, open, records))
    // What became of each record, said by the sending that sent them; one answered again says it was (0031).
    if (trail !== undefined && answer.repeated !== true) trail.outcomes = outcomesOf(answer)
    return steps.answered(reply, answer)
  })
}
