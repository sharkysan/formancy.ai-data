import {
  authorizeOperation,
  buildLookupConfig,
  checkSubmittedFields,
  findObject,
  lookupRowFilter,
  planCreate,
  planRead,
  planUpdate,
  readableFields,
  rejectedSelection,
  scopeRowFilters,
  toFormAnswers,
  validateLookupQuery,
} from '@formancy/data-core'
import type { FieldError, MembershipCheck, ObjectMeta, PolicyContext, PolicyOperation } from '@formancy/data-core'
import { canonicalize } from '@formancy/spec'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry, OpenConnection } from '../connections.js'
import type { HostIdentity } from '../identity.js'
import type { AuditEvent, AuditSink } from '../audit.js'
import { recordReference } from '../audit.js'
import { loadPublished } from '../published.js'
import { planRefusal, recordFailure } from './runtime-errors.js'

export interface RuntimeOptions {
  registry: ConnectionRegistry
  store: ConfigurationStore
  authenticate: (request: FastifyRequest) => Promise<HostIdentity | undefined>
  /**
   * The operational trail (0023): one event per request, outcomes included.
   * `key` names records by a keyed hash; without it, no record is named.
   */
  audit?: { sink: AuditSink; key?: string; now?: () => string }
}

declare module 'fastify' {
  interface FastifyRequest {
    auditTrail?: { formVersion: number | null; record?: string; outcome?: string }
  }
}

/** The audit name of each runtime route, by its pattern. */
const ROUTE_OPERATIONS: Readonly<Record<string, AuditEvent['operation']>> = {
  '/v1/forms/:id': 'form',
  '/v1/forms/:id/records/read': 'read',
  '/v1/forms/:id/records/create': 'create',
  '/v1/forms/:id/records/update': 'update',
  '/v1/forms/:id/lookups/:source/query': 'lookup-query',
  '/v1/forms/:id/lookups/:source/resolve': 'lookup-resolve',
}

/** At most this many tokens are resolved in one request: a form holds one per lookup field, not thousands. */
const MAX_RESOLVE = 100

const OPERATIONS = new Set<PolicyOperation>(['read', 'create', 'update'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contextOf(identity: HostIdentity): PolicyContext {
  return { actor: { id: identity.actor.id, roles: [...identity.actor.roles] }, attributes: { ...identity.attributes } }
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
 * still reaches the planner and is refused: a changed value there is tampering
 * or a stale client, and either way is not saved.
 */
function withoutEchoes(
  bundle: PublishedBundle,
  actor: PolicyContext,
  operation: 'create' | 'update',
  answers: unknown,
  current?: Readonly<Record<string, unknown>>,
): unknown {
  if (!isRecord(answers)) return answers
  const kept: Record<string, unknown> = { ...answers }
  for (const binding of bundle.bindings.fields) {
    if (!Object.hasOwn(kept, binding.field)) continue
    if (checkSubmittedFields(bundle.policy, actor, bundle.bindings, operation, [binding.field]).ok) continue
    const value = kept[binding.field]
    const echo = current === undefined
      ? value === null || value === undefined || value === ''
      : Object.hasOwn(current, binding.field) && canonicalize(value ?? null) === canonicalize(current[binding.field] ?? null)
    if (echo) delete kept[binding.field]
  }
  return kept
}

/**
 * The runtime plane: a published form, its records and its lookups, for the
 * host application's people (plan section 13). Every route needs a verified
 * host token; every decision about what that person may do is the published
 * policy's, through the planner (0018), and every database answer is the
 * adapter's, through the ports (0015).
 */
export async function runtimeRoutes(app: FastifyInstance, options: RuntimeOptions): Promise<void> {
  const { registry, store } = options

  app.addHook('onRequest', async (request) => {
    request.auditTrail = { formVersion: null }
  })

  if (options.audit !== undefined) {
    const { sink, key } = options.audit
    const now = options.audit.now ?? (() => new Date().toISOString())

    // The stable code of a refusal, read from the response itself, so every
    // way a request can end is audited without each branch remembering to say so.
    app.addHook('onSend', async (request, reply, payload) => {
      if (reply.statusCode >= 400 && typeof payload === 'string' && request.auditTrail !== undefined) {
        try {
          const code = (JSON.parse(payload) as { code?: unknown }).code
          if (typeof code === 'string') request.auditTrail.outcome = code
        } catch {
          // A body that is not JSON carries no code; the status says enough.
        }
      }
      return payload
    })

    app.addHook('onResponse', async (request, reply) => {
      const operation = ROUTE_OPERATIONS[request.routeOptions.url ?? '']
      if (operation === undefined) return
      const trail = request.auditTrail ?? { formVersion: null }
      const event: AuditEvent = {
        at: now(),
        actor: request.identity?.actor.id ?? null,
        operation,
        form: (request.params as { id?: string }).id ?? '',
        formVersion: trail.formVersion,
        status: reply.statusCode,
        outcome: reply.statusCode < 400 ? 'ok' : (trail.outcome ?? `http-${String(reply.statusCode)}`),
        record: recordReference(key, trail.record),
      }
      try {
        await sink(event)
      } catch (error) {
        request.log.error({ error: (error as Error).message }, 'an audit event could not be written')
      }
    })
  }

  app.addHook('preHandler', async (request, reply) => {
    const identity = await options.authenticate(request)
    if (identity === undefined) {
      return reply.code(401).header('www-authenticate', 'Bearer').send({ code: 'unauthenticated', message: 'A valid host token is required.' })
    }
    request.identity = identity
    return undefined
  })

  const context = (request: FastifyRequest): PolicyContext => {
    if (request.identity === undefined) throw new Error('the preHandler sets the identity before any route runs')
    return contextOf(request.identity)
  }

  async function published(id: string, reply: FastifyReply): Promise<PublishedBundle | undefined> {
    const loaded = await loadPublished(store, id, reply.log)
    if (loaded.ok) {
      if (reply.request.auditTrail !== undefined) reply.request.auditTrail.formVersion = loaded.version
      return loaded.bundle
    }
    await reply.code(loaded.status).send({ code: loaded.code, message: loaded.message })
    return undefined
  }

  async function connection(bundle: PublishedBundle, reply: FastifyReply): Promise<OpenConnection | undefined> {
    try {
      const open = await registry.open(bundle.connection)
      if (open !== undefined) return open
      reply.log.error({ connection: bundle.connection }, 'a published form names a connection the allowlist does not have')
      await reply.code(500).send({ code: 'unknown-connection', message: 'This form is published against a connection this server does not have.' })
    } catch (error) {
      reply.log.warn({ connection: bundle.connection, error: (error as Error).message }, 'connection could not be opened')
      await reply.code(503).send({ code: 'unavailable', message: 'The database cannot be reached. Nothing was saved.' })
    }
    return undefined
  }

  /** Runs every membership check; returns field errors for rejected tokens, or a reply already sent. */
  async function memberships(open: OpenConnection, checks: readonly MembershipCheck[], reply: FastifyReply): Promise<FieldError[] | undefined> {
    const errors: FieldError[] = []
    for (const check of checks) {
      try {
        const rejected = await open.lookups.rejects(check.config, check.tokens, check.filters)
        if (rejected.length > 0) errors.push(rejectedSelection(check.field))
      } catch (error) {
        // Fails closed, as formancy's own membership port does (formancy.ai 0077).
        reply.log.warn({ field: check.field, error: (error as Error).message }, 'a lookup could not vouch for a selection')
        await reply.code(503).send({ code: 'unavailable', message: 'A selection could not be checked. Nothing was saved.' })
        return undefined
      }
    }
    return errors
  }

  app.get<{ Params: { id: string } }>('/v1/forms/:id', async (request, reply) => {
    const bundle = await published(request.params.id, reply)
    if (bundle === undefined) return reply
    const actor = context(request)
    const allowed = (['read', 'create', 'update'] as const).filter((operation) => bundle.bindings.operations[operation as 'create' | 'update'] !== false && authorizeOperation(bundle.policy, actor, operation).ok)
    if (allowed.length === 0) return reply.code(403).send({ code: 'operation-denied', message: 'This form is not available to you.' })
    const readable = readableFields(bundle.policy, actor, bundle.bindings)
    return { form: bundle.form, operations: allowed, readable: readable.ok ? readable.fields : [] }
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/read', async (request, reply) => {
    const body = request.body
    if (!isRecord(body) || typeof body['record'] !== 'string') return reply.code(400).send({ code: 'invalid-request', message: 'Expected { record }.' })
    if (request.auditTrail !== undefined) request.auditTrail.record = body['record']
    const bundle = await published(request.params.id, reply)
    if (bundle === undefined) return reply
    const plan = planRead(bundle.snapshot, bundle.bindings, bundle.policy, context(request), body['record'])
    if (!plan.ok) {
      const refusal = planRefusal(plan.code, plan.message)
      return reply.code(refusal.status).send(refusal.body)
    }
    const open = await connection(bundle, reply)
    if (open === undefined) return reply
    const outcome = await open.records.read(plan.request)
    if (!outcome.ok) {
      const failure = recordFailure(bundle.bindings, outcome)
      return reply.code(failure.status).send(failure.body)
    }
    return toFormAnswers(bundle.bindings, plan.fields, outcome)
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/create', async (request, reply) => {
    const body = request.body
    if (!isRecord(body) || !isRecord(body['answers'])) return reply.code(400).send({ code: 'invalid-request', message: 'Expected { answers }.' })
    const bundle = await published(request.params.id, reply)
    if (bundle === undefined) return reply
    const plan = planCreate(bundle.snapshot, bundle.bindings, bundle.policy, context(request), withoutEchoes(bundle, context(request), 'create', body['answers']))
    if (!plan.ok) {
      if (plan.code === 'invalid-values') return reply.code(422).send({ code: plan.code, message: plan.message, fieldErrors: plan.fieldErrors })
      const refusal = planRefusal(plan.code, plan.message)
      return reply.code(refusal.status).send(refusal.body)
    }
    const open = await connection(bundle, reply)
    if (open === undefined) return reply
    const rejected = await memberships(open, plan.memberships, reply)
    if (rejected === undefined) return reply
    if (rejected.length > 0) return reply.code(422).send({ code: 'invalid-values', message: 'A selection is not one of the options.', fieldErrors: rejected })
    const outcome = await open.records.insert(plan.request)
    if (!outcome.ok) {
      const failure = recordFailure(bundle.bindings, outcome)
      return reply.code(failure.status).send(failure.body)
    }
    const created = toFormAnswers(bundle.bindings, plan.fields, outcome)
    if (request.auditTrail !== undefined && created.record !== null) request.auditTrail.record = created.record
    return reply.code(201).send(created)
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/update', async (request, reply) => {
    const body = request.body
    if (!isRecord(body) || typeof body['record'] !== 'string' || typeof body['version'] !== 'string' || !isRecord(body['answers'])) {
      return reply.code(400).send({ code: 'invalid-request', message: 'Expected { record, version, answers }.' })
    }
    if (request.auditTrail !== undefined) request.auditTrail.record = body['record']
    const bundle = await published(request.params.id, reply)
    if (bundle === undefined) return reply
    const actor = context(request)
    const open = await connection(bundle, reply)
    if (open === undefined) return reply

    // The record as it stands, to tell an echoed read-only field from a changed
    // one. An actor who may update and not read gets no echo removed, and the
    // planner refuses whatever read-only field they sent.
    let current: Record<string, unknown> | undefined
    const reading = planRead(bundle.snapshot, bundle.bindings, bundle.policy, actor, body['record'])
    if (reading.ok) {
      const stored = await open.records.read(reading.request)
      if (stored.ok) current = toFormAnswers(bundle.bindings, reading.fields, stored).answers
    }

    const plan = planUpdate(bundle.snapshot, bundle.bindings, bundle.policy, actor, body['record'], body['version'], withoutEchoes(bundle, actor, 'update', body['answers'], current))
    if (!plan.ok) {
      if (plan.code === 'invalid-values') return reply.code(422).send({ code: plan.code, message: plan.message, fieldErrors: plan.fieldErrors })
      const refusal = planRefusal(plan.code, plan.message)
      return reply.code(refusal.status).send(refusal.body)
    }
    const rejected = await memberships(open, plan.memberships, reply)
    if (rejected === undefined) return reply
    if (rejected.length > 0) return reply.code(422).send({ code: 'invalid-values', message: 'A selection is not one of the options.', fieldErrors: rejected })
    const outcome = await open.records.update(plan.request)
    if (!outcome.ok) {
      const failure = recordFailure(bundle.bindings, outcome)
      return reply.code(failure.status).send(failure.body)
    }
    return toFormAnswers(bundle.bindings, plan.fields, outcome)
  })

  /** The lookup field a source name stands for, its config and the actor's filter for it — or a reply already sent. */
  async function lookupFor(request: FastifyRequest<{ Params: { id: string; source: string } }>, reply: FastifyReply, operation: unknown) {
    if (typeof operation !== 'string' || !OPERATIONS.has(operation as PolicyOperation)) {
      await reply.code(400).send({ code: 'invalid-request', message: 'Say which operation the form is open for: read, create or update.' })
      return undefined
    }
    const bundle = await published(request.params.id, reply)
    if (bundle === undefined) return undefined
    const binding = bundle.bindings.fields.find((entry) => entry.kind === 'lookup' && entry.source === request.params.source)
    if (binding === undefined) {
      await reply.code(404).send({ code: 'unknown-lookup', message: `This form has no lookup called ${request.params.source}.` })
      return undefined
    }
    const filter = lookupRowFilter(bundle.policy, context(request), bundle.bindings, operation as PolicyOperation, binding.field)
    if (!filter.ok) {
      const refusal = planRefusal(filter.code, filter.message)
      await reply.code(refusal.status).send(refusal.body)
      return undefined
    }
    // Scoped as a record request's filter is (0028), before a connection is
    // opened: a trusted value the column does not hold in that spelling is
    // refused here, never left to the engine to convert.
    const config = buildLookupConfig(bundle.bindings, binding.field, { snapshot: bundle.snapshot })
    // buildLookupConfig found the target in this snapshot, or it would have thrown.
    const scoped = scopeRowFilters(findObject(bundle.snapshot, config.target) as ObjectMeta, filter.filter, `lookups.${binding.field}`)
    if (!scoped.ok) {
      const refusal = planRefusal(scoped.code, scoped.message)
      await reply.code(refusal.status).send(refusal.body)
      return undefined
    }
    const open = await connection(bundle, reply)
    if (open === undefined) return undefined
    return { bundle, open, config, filters: scoped.filters }
  }

  app.post<{ Params: { id: string; source: string } }>('/v1/forms/:id/lookups/:source/query', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const found = await lookupFor(request, reply, body['operation'])
    if (found === undefined) return reply
    const query = validateLookupQuery(found.config, { search: body['search'] ?? '', offset: body['offset'] ?? 0, limit: body['limit'] ?? found.config.maxPageSize })
    if (!query.ok) return reply.code(400).send({ code: query.code, message: query.message })
    try {
      return await found.open.lookups.search(found.config, query.query, found.filters)
    } catch (error) {
      reply.log.warn({ error: (error as Error).message }, 'a lookup search failed')
      return reply.code(503).send({ code: 'unavailable', message: 'The options could not be loaded.' })
    }
  })

  app.post<{ Params: { id: string; source: string } }>('/v1/forms/:id/lookups/:source/resolve', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const tokens = body['tokens']
    if (!Array.isArray(tokens) || tokens.length > MAX_RESOLVE || !tokens.every((token) => typeof token === 'string')) {
      return reply.code(400).send({ code: 'invalid-request', message: `Expected { operation, tokens } with at most ${String(MAX_RESOLVE)} tokens.` })
    }
    const found = await lookupFor(request, reply, body['operation'])
    if (found === undefined) return reply
    try {
      return { rows: await found.open.lookups.resolve(found.config, tokens as string[], found.filters) }
    } catch (error) {
      reply.log.warn({ error: (error as Error).message }, 'a lookup resolve failed')
      return reply.code(503).send({ code: 'unavailable', message: 'The selected options could not be loaded.' })
    }
  })
}
