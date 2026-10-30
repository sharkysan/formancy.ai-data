import { buildLookupConfig, findObject, lookupRowFilter, scopeRowFilters, validateLookupQuery } from '@formancy/data-core'
import type { LookupConfig, ObjectMeta, PolicyContext, PolicyOperation, ResolvedLookup, RowFilters, RuntimeRefusal } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { OpenConnection } from '../connections.js'
import { lookupDeadline } from '../lookup-deadline.js'
import { abandonment } from './abandoned.js'
import { planRefusal } from './runtime-errors.js'
import type { HttpRefusal } from './runtime-errors.js'

/**
 * At most this many tokens are resolved in one request: a form holds one per
 * lookup field, not thousands. A list page's tokens for one lookup field fit
 * one resolve: `LIST_PAGE_SIZE` is at most this, which a test holds (0044).
 */
export const MAX_RESOLVE = 100

const OPERATIONS = new Set<PolicyOperation>(['read', 'create', 'update'])

/** What the lookup routes borrow from the runtime plane, so they decide each step as the record routes do. */
export interface LookupRouteSteps {
  /** The published bundle, or a reply already sent. */
  published(id: string, reply: FastifyReply): Promise<PublishedBundle | undefined>
  /** The form's connection, or a reply already sent. */
  connection(bundle: PublishedBundle, reply: FastifyReply): Promise<OpenConnection | undefined>
  context(request: FastifyRequest): PolicyContext
  /** How long a lookup statement may run, from the moment the adapter is asked for it (0061). */
  lookupDeadlineMs: number
}

type LookupRequest = FastifyRequest<{ Params: { id: string; source: string } }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A lookup field's configuration and this person's filter for its rows, or the refusal to answer. */
export type LookupScope = { ok: true; config: LookupConfig; filters: RowFilters } | { ok: false; refusal: HttpRefusal }

/**
 * The configuration of the lookup `field` and the actor's filter for its
 * rows under `operation` (0012), or the policy's refusal. Asks no database:
 * the lookup routes and an export's labels (0079) both decide here, before
 * any statement, so one lookup is never scoped two ways.
 *
 * Scoped as a record request's filter is (0028): a trusted value the column
 * does not hold in that spelling is refused here, never left to the engine
 * to convert.
 */
export function lookupScope(bundle: PublishedBundle, context: PolicyContext, operation: PolicyOperation, field: string): LookupScope {
  const filter = lookupRowFilter(bundle.policy, context, bundle.bindings, operation, field)
  if (!filter.ok) return { ok: false, refusal: planRefusal(filter.code, filter.message) }
  const config = buildLookupConfig(bundle.bindings, field, { snapshot: bundle.snapshot })
  // buildLookupConfig found the target in this snapshot, or it would have thrown.
  const scoped = scopeRowFilters(findObject(bundle.snapshot, config.target) as ObjectMeta, filter.filter, `lookups.${field}`)
  if (!scoped.ok) return { ok: false, refusal: planRefusal(scoped.code, scoped.message) }
  return { ok: true, config, filters: scoped.filters }
}

/** The lookup field a source name stands for, its config and the actor's filter for it — or a reply already sent. */
async function lookupFor(
  steps: LookupRouteSteps,
  request: LookupRequest,
  reply: FastifyReply,
  operation: unknown,
): Promise<{ open: OpenConnection; config: LookupConfig; filters: RowFilters } | undefined> {
  if (typeof operation !== 'string' || !OPERATIONS.has(operation as PolicyOperation)) {
    await reply.code(400).send({ code: 'invalid-request', message: 'Say which operation the form is open for: read, create or update.' })
    return undefined
  }
  const bundle = await steps.published(request.params.id, reply)
  if (bundle === undefined) return undefined
  const binding = bundle.bindings.fields.find((entry) => entry.kind === 'lookup' && entry.source === request.params.source)
  if (binding === undefined) {
    await reply.code(404).send({ code: 'unknown-lookup', message: `This form has no lookup called ${request.params.source}.` })
    return undefined
  }
  // Decided before a connection is opened.
  const scope = lookupScope(bundle, steps.context(request), operation as PolicyOperation, binding.field)
  if (!scope.ok) {
    await reply.code(scope.refusal.status).send(scope.refusal.body)
    return undefined
  }
  const open = await steps.connection(bundle, reply)
  if (open === undefined) return undefined
  return { open, config: scope.config, filters: scope.filters }
}

/** What each lookup says when it fails, or its resolve passes its deadline: `unavailable`, which invites another try. */
const UNAVAILABLE: Record<'search' | 'resolve', string> = {
  search: 'The options could not be loaded.',
  resolve: 'The selected options could not be loaded.',
}

/**
 * One lookup statement under the request's signal, answered (0061).
 *
 * The signal aborts when the client leaves before the answer, or when the
 * deadline passes. The deadline starts when the adapter is asked, so a wait
 * for a pooled connection, inside the driver, counts, and reading the form
 * and opening its connection do not: a deadline that passed there would be
 * answered as a statement stopped when none was sent. The adapter stops the
 * statement and rejects with the signal's reason, untranslated; anything
 * else it throws is the database's.
 *
 * A search past the deadline is `503 lookup-timeout`, not `unavailable`,
 * because 0028 says a refusal says whether trying again helps, and a
 * contains search that timed out reads the same rows again. A resolve reads
 * by key, at most a row a token, so one past the deadline waited rather
 * than read too much, and trying again helps: it is `unavailable`, and the
 * log names the deadline. A client that left is answered `499 abandoned`:
 * nobody reads it, and it exists so the audit trail's event for the request
 * says what happened (0023, 0033). The person reads the renderer's own
 * sentence, "could not be loaded"; at formancy 0.7.0, as at 0.5.0 and 0.6.0, a
 * source's message has nowhere else to go: the renderers drop a rejection's
 * reason, and a page that carried one would be refused whole.
 */
async function answer<T>(
  steps: LookupRouteSteps,
  request: LookupRequest,
  reply: FastifyReply,
  kind: 'search' | 'resolve',
  run: (open: OpenConnection, config: LookupConfig, filters: RowFilters, signal: AbortSignal) => Promise<T>,
  operation: unknown,
): Promise<T | FastifyReply> {
  const abandoned = abandonment(request, reply)
  try {
    const found = await lookupFor(steps, request, reply, operation)
    if (found === undefined) return reply
    const deadline = lookupDeadline(steps.lookupDeadlineMs, abandoned.signal)
    const { signal } = deadline
    try {
      return await run(found.open, found.config, found.filters, signal)
    } catch (error) {
      if (signal.aborted && error === signal.reason) return stopped(steps, request, reply, kind, signal.reason === abandoned.signal.reason)
      request.log.warn({ error: (error as Error).message }, kind === 'search' ? 'a lookup search failed' : 'a lookup resolve failed')
      return reply.code(503).send({ code: 'unavailable', message: UNAVAILABLE[kind] } satisfies RuntimeRefusal)
    } finally {
      deadline.clear()
    }
  } finally {
    abandoned.settle()
  }
}

/** A lookup the adapter stopped at the signal: its client left, or its deadline passed. */
function stopped(steps: LookupRouteSteps, request: LookupRequest, reply: FastifyReply, kind: 'search' | 'resolve', left: boolean): FastifyReply {
  if (left) {
    request.log.info({ lookup: kind }, 'a lookup was abandoned by its client; the database was told to stop it')
    return reply.code(499).send({
      code: 'abandoned',
      message: 'The client closed the connection before the answer; the database was told to stop the statement.',
    } satisfies RuntimeRefusal)
  }
  const ms = steps.lookupDeadlineMs
  request.log.warn({ lookup: kind, deadlineMs: ms }, 'a lookup passed its deadline; the database was told to stop it')
  if (kind === 'resolve') return reply.code(503).send({ code: 'unavailable', message: UNAVAILABLE.resolve } satisfies RuntimeRefusal)
  return reply.code(503).send({
    code: 'lookup-timeout',
    message: `The search took longer than this server allows (${String(ms)} ms), and the database was told to stop it. The same search will take as long again.`,
  } satisfies RuntimeRefusal)
}

/**
 * `POST /v1/forms/:id/lookups/:source/query` and `…/resolve`: one page of a
 * lookup's options, or the labels of tokens a form holds, for the operation
 * the form is open for and under the actor's filter for that lookup (0012).
 * Each runs one statement that stops when its request is abandoned or its
 * deadline passes (0061); one that completes is answered exactly as before.
 */
export function registerLookupRoutes(app: FastifyInstance, steps: LookupRouteSteps): void {
  app.post<{ Params: { id: string; source: string } }>('/v1/forms/:id/lookups/:source/query', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    return answer(
      steps,
      request,
      reply,
      'search',
      async (open, config, filters, signal) => {
        const query = validateLookupQuery(config, { search: body['search'] ?? '', offset: body['offset'] ?? 0, limit: body['limit'] ?? config.maxPageSize })
        if (!query.ok) return reply.code(400).send({ code: query.code, message: query.message })
        return open.lookups.search(config, query.query, filters, signal)
      },
      body['operation'],
    )
  })

  app.post<{ Params: { id: string; source: string } }>('/v1/forms/:id/lookups/:source/resolve', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const tokens = body['tokens']
    if (!Array.isArray(tokens) || tokens.length > MAX_RESOLVE || !tokens.every((token) => typeof token === 'string')) {
      return reply.code(400).send({ code: 'invalid-request', message: `Expected { operation, tokens } with at most ${String(MAX_RESOLVE)} tokens.` })
    }
    return answer(
      steps,
      request,
      reply,
      'resolve',
      async (open, config, filters, signal) => ({ rows: await open.lookups.resolve(config, tokens as string[], filters, signal) }) satisfies ResolvedLookup,
      body['operation'],
    )
  })
}
