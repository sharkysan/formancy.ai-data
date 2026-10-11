import { planList, recordPage, validateListQuery } from '@formancy/data-core'
import type { DescribedTable, PolicyContext, RecordFailure, RecordList } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { planRefusal } from './runtime-errors.js'
import type { WriteAnswer } from './write-once.js'

/** What the list route borrows from the runtime plane, so it decides each step as the read route does. */
export interface ListRouteSteps {
  /** The published bundle, or a reply already sent. */
  published(id: string, reply: FastifyReply): Promise<PublishedBundle | undefined>
  /** The form's connection, or a reply already sent. */
  connection(bundle: PublishedBundle, reply: FastifyReply): Promise<OpenConnection | undefined>
  context(request: FastifyRequest): PolicyContext
  /** A read the database refused, as the read route answers it: a table that moved is decided as drift, over a description asked once more -- for a page, as a list. */
  unread(request: FastifyRequest<{ Params: { id: string } }>, bundle: PublishedBundle, open: OpenConnection, failure: RecordFailure, operation: 'list'): Promise<WriteAnswer>
  /** A read decided over the description its own statement carried, as the read route decides one -- for a page, as a list: a refusal when drift stops reading the form, or the table no longer holds its key to a total order. */
  undecided(request: FastifyRequest<{ Params: { id: string } }>, bundle: PublishedBundle, described: DescribedTable, operation: 'list'): WriteAnswer | undefined
  /** A refusal, sent, with what the audit names. */
  answered(reply: FastifyReply, answer: WriteAnswer): Promise<FastifyReply>
}

/**
 * `POST /v1/forms/:id/records/list` (0044): one page of the records this
 * person may read, each exactly what `records/read` returns for its token,
 * in a total order, with whether more follow and no total.
 *
 * A POST, so the search never appears in a URL a proxy logs. The body is
 * checked first, as the read route checks its token; then the planner asks
 * the policy -- a list is a read, under the read filter and every through,
 * with no grant of its own -- before any statement. The page and the table
 * it was read from come from one statement, and the page is decided over
 * that description after it ran, as a read is (0041), and also refused
 * when the table no longer holds the key to a total order: refused, its
 * rows are discarded and never reach the body, and the log says `list`, as
 * the audit does. The audit names the operation `list` and no record, never
 * the search, the sort or the parent (0023).
 *
 * An adapter that answered `unknown-outcome` for a list -- which writes
 * nothing -- is a bug, and is answered 500, as for a read (0031).
 */
export function registerListRoute(app: FastifyInstance, steps: ListRouteSteps): void {
  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/list', async (request, reply) => {
    const query = validateListQuery(request.body === undefined ? {} : request.body)
    if (!query.ok) return reply.code(400).send({ code: query.code, message: query.message })
    const bundle = await steps.published(request.params.id, reply)
    if (bundle === undefined) return reply
    const plan = planList(bundle.snapshot, bundle.bindings, bundle.policy, steps.context(request), query.query)
    if (!plan.ok) return steps.answered(reply, planRefusal(plan.code, plan.message))
    const open = await steps.connection(bundle, reply)
    if (open === undefined) return reply
    const outcome = await open.records.list(plan.request)
    if (!outcome.ok) return steps.answered(reply, await steps.unread(request, bundle, open, outcome, 'list'))
    const drifted = steps.undecided(request, bundle, outcome.described, 'list')
    if (drifted !== undefined) return steps.answered(reply, drifted)
    return recordPage(bundle.bindings, plan.fields, outcome.rows, query.query.limit) satisfies RecordList
  })
}
