import { createHash } from 'node:crypto'
import { ownViewsProblems, readOwnView, removedOwnView, savedOwnView } from '@formancy/data-core'
import type { ListColumns, ListView, OwnViews, PolicyContext, RelatedField } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { ConfigurationStore } from '../config-store.js'
import type { WriteAnswer } from './write-once.js'

/*
 * A person's own list views (0126): saved and removed by them, kept by the
 * server in the store's `.people`, one file per person and form, and
 * offered back in `GET /v1/forms/:id`'s `list.own`. What a view may be is
 * data-core's (`records/own-views.ts`); here is where it is kept, and the
 * read, the change and the compare-and-swap around it.
 */

/** How often a save or a remove reads again after another page of the same person saved first: a few, since each is that person's own pages. */
const TRIES = 3

/**
 * The name a person's views are kept under: a hash of who their token says
 * they are, so no subject spells a path. Not a secret: anyone who knows the
 * subject can compute it.
 */
export function personOf(context: PolicyContext): string {
  return createHash('sha256').update(context.actor.id, 'utf8').digest('hex')
}

/**
 * A person's views of `form` as stored, and the version they were read at,
 * `null` for none saved. A version replaced between the two reads is read
 * again; one that does not read as the server writes it throws, so nothing
 * is offered from a damaged file and nothing is written over it.
 */
export async function ownViewsOf(store: ConfigurationStore, context: PolicyContext, form: string): Promise<{ base: number | null; views: ListView[] }> {
  const people = store.people(personOf(context))
  for (let tries = 0; tries < TRIES; tries += 1) {
    const base = await people.latest(form)
    if (base === null) return { base, views: [] }
    const stored = await people.read(form, base)
    if (stored === undefined) continue
    const problems = ownViewsProblems(stored)
    if (problems.length > 0) throw new Error(`one person's views of ${form} do not read as the server writes them: ${problems.join('; ')}`)
    return { base, views: (stored as { views: ListView[] }).views }
  }
  throw new Error(`one person's views of ${form} were replaced on every read`)
}

/** What the routes borrow from the runtime plane. */
export interface OwnViewRouteSteps {
  store: ConfigurationStore
  /** The published bundle, or a reply already sent. */
  published(id: string, reply: FastifyReply): Promise<PublishedBundle | undefined>
  context(request: FastifyRequest): PolicyContext
  /** What this person's list of `bundle` offers them, `own` fitted, and the fields through its lookups it offers them (0139) -- or the refusal a list would be answered with. */
  columns(
    bundle: PublishedBundle,
    context: PolicyContext,
    own: readonly ListView[],
  ): { ok: true; columns: ListColumns; related: RelatedField[] } | { ok: false; answer: WriteAnswer }
  /** A refusal, sent, with what the audit names. */
  answered(reply: FastifyReply, answer: WriteAnswer): Promise<FastifyReply>
}

type Change = (
  own: ListView[],
  columns: ListColumns,
  bundle: PublishedBundle,
  related: readonly RelatedField[],
) => { ok: true; views: ListView[] } | { ok: false; message: string }

/**
 * `POST /v1/forms/:id/views/save` and `POST /v1/forms/:id/views/remove`
 * (0126). A save carries `{ name, filter, sort }` and a remove `{ name }`;
 * each answers the person's views as the form now offers them, `{ own }`,
 * or refuses `invalid-view` with a sentence for the person. A person who
 * may not list the form is refused as a list would be. Each reads the
 * person's views, changes them, and writes them only if no other page of
 * theirs wrote first, else reads again; a remove of a view that is not
 * theirs writes nothing and answers alike. The audit names `view-save` or
 * `view-remove` and never the view.
 */
export function registerOwnViewRoutes(app: FastifyInstance, steps: OwnViewRouteSteps): void {
  async function edit(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, change: Change): Promise<OwnViews | FastifyReply> {
    const form = request.params.id
    const bundle = await steps.published(form, reply)
    if (bundle === undefined) return reply
    const context = steps.context(request)
    const people = steps.store.people(personOf(context))
    for (let tries = 0; tries < TRIES; tries += 1) {
      const { base, views } = await ownViewsOf(steps.store, context, form)
      const listed = steps.columns(bundle, context, views)
      if (!listed.ok) return steps.answered(reply, listed.answer)
      const changed = change(views, listed.columns, bundle, listed.related)
      if (!changed.ok) return reply.code(400).send({ code: 'invalid-view', message: changed.message })
      if (JSON.stringify(changed.views) === JSON.stringify(views)) return { own: listed.columns.own }
      const outcome = await people.publish(form, base, { views: changed.views })
      if (!outcome.ok) continue
      const after = steps.columns(bundle, context, changed.views)
      return after.ok ? { own: after.columns.own } : steps.answered(reply, after.answer)
    }
    return reply
      .code(409)
      .send({ code: 'conflict', message: 'Your views of this form changed in another page while this one saved. Nothing was saved; try again.' })
  }

  app.post<{ Params: { id: string } }>('/v1/forms/:id/views/save', async (request, reply) => {
    const read = readOwnView(request.body)
    if (!read.ok) return reply.code(400).send({ code: 'invalid-view', message: read.message })
    return edit(request, reply, (own, columns, bundle, related) => savedOwnView(own, read.view, bundle.bindings, columns, related))
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/views/remove', async (request, reply) => {
    const body = request.body
    const name =
      typeof body === 'object' && body !== null && !Array.isArray(body) && Object.keys(body).length === 1 ? (body as { name?: unknown }).name : undefined
    if (typeof name !== 'string') return reply.code(400).send({ code: 'invalid-view', message: 'Expected { name }.' })
    return edit(request, reply, (own) => ({ ok: true, views: removedOwnView(own, name) }))
  })
}
