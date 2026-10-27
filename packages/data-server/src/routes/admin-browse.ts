import { browsePage, findObject, planBrowse, validateBrowseQuery } from '@formancy/data-core'
import type { BrowsePage, BrowseRefusalCode, ObjectMeta, ObjectRef, OmittedColumn, RecordColumn, RecordFailure } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { OpenConnection } from '../connections.js'
import { adminTrail } from './admin-audit.js'
import type { Discover, Refuse } from './admin.js'

/** What `POST /v1/connections/:id/browse` answers: one page of an object's rows, and what the page is made of. */
export interface BrowseAnswer extends BrowsePage {
  object: ObjectRef
  kind: ObjectMeta['kind']
  /** The columns each row holds, in the object's order. */
  columns: RecordColumn[]
  /** The columns left out, and why. */
  omitted: OmittedColumn[]
  /** `key` when a key the page shows ends its order; `columns` when every shown column does, and rows equal in all of them may trade places between pages. */
  ordered: 'key' | 'columns'
}

interface BrowseOptions {
  connection: (id: string, reply: FastifyReply) => Promise<OpenConnection | undefined>
  discover: Discover
  refuse: Refuse
}

const STATUS: Readonly<Record<BrowseRefusalCode, number>> = {
  'unknown-object': 404,
  'nothing-readable': 403,
  'not-sortable': 400,
  'not-comparable': 400,
  'not-filterable': 400,
  'not-searchable': 400,
}

/**
 * A database's refusal of a browse, which writes nothing, as an HTTP
 * answer: the account's grants, an object that changed between the
 * discovery and the page, a statement refused, or a database that could
 * not answer now. A read never has an unknown outcome or a constraint's
 * refusal; an adapter that answered one is a bug, and is thrown (0031).
 */
function browseFailure(failure: RecordFailure): { status: number; code: string; message: string } {
  switch (failure.code) {
    case 'permission-denied':
      return { status: 403, code: 'permission-denied', message: "The connection's account may not read this." }
    case 'schema-changed':
      return { status: 409, code: 'schema-changed', message: 'This table or view changed while it was being read. Discover the connection again.' }
    case 'refused':
      return { status: 422, code: 'refused', message: 'The database refused to read this. Asking again will be refused the same way.' }
    case 'unavailable':
      return { status: 503, code: 'unavailable', message: 'The database could not answer now.' }
    default:
      throw new Error(`a browse writes nothing and reads no key, so ${failure.code} is an adapter's bug`)
  }
}

/**
 * `POST /v1/connections/:id/browse` (0099): one page of any table or view
 * the connection's account can see, as that account reads it. Registered
 * by `adminRoutes` after its role check and its governance gate, which
 * refuses the route to anybody without a browse role (governance.ts).
 *
 * A POST, so the search never appears in a URL a proxy logs. The body is
 * checked first; then the connection is discovered, as `GET …/metadata`
 * discovers it, so the object, its columns and its key are names the
 * server read from the catalog a moment ago and never the body's (0011).
 * The page is a list's statement (0044), with no filter but what the
 * account's grants and row security apply, and the equal values a follow
 * of a foreign key narrows it to (0103), each column one the snapshot
 * shows and each value checked against it. The audit names the object
 * once the snapshot holds it, never the search, the sort, a value or a row.
 *
 * Each page costs a discovery and the page's statement: nothing is cached
 * between pages, so a page is never decided over a catalog older than the
 * request.
 */
export function browseRoutes(app: FastifyInstance, options: BrowseOptions): void {
  const { connection, discover, refuse } = options

  app.post<{ Params: { id: string } }>('/v1/connections/:id/browse', async (request, reply) => {
    const query = validateBrowseQuery(request.body === undefined ? {} : request.body)
    if (!query.ok) return refuse(reply, 400, query.code, query.message)
    const snapshot = await discover(request.params.id, reply)
    if (snapshot === undefined) return reply
    const object = findObject(snapshot, query.query.object)
    if (object !== undefined) adminTrail(request).object = `${object.ref.schema}.${object.ref.name}`
    const plan = planBrowse(snapshot, query.query)
    if (!plan.ok) return refuse(reply, STATUS[plan.code], plan.code, plan.message)
    const open = await connection(request.params.id, reply)
    if (open === undefined) return reply
    const outcome = await open.records.list(plan.request)
    if (!outcome.ok) {
      reply.log.warn({ connection: request.params.id, code: outcome.code, message: outcome.message }, 'a browse was refused by the database')
      const failure = browseFailure(outcome)
      return refuse(reply, failure.status, failure.code, failure.message)
    }
    const page = browsePage(outcome.rows, query.query.limit)
    const answer: BrowseAnswer = { object: plan.request.target.table, kind: (object as ObjectMeta).kind, columns: plan.columns, omitted: plan.omitted, ordered: plan.ordered, ...page }
    return answer
  })
}
