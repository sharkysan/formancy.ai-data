import {
  authorizeOperation,
  buildLookupConfig,
  checkSubmittedFields,
  findObject,
  intendedRecord,
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
import type { FieldError, FormRecord, MembershipCheck, ObjectMeta, PolicyContext, PolicyOperation, PublishedForm, RecordFailure, ResolvedLookup } from '@formancy/data-core'
import { canonicalize } from '@formancy/spec'
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry, OpenConnection } from '../connections.js'
import type { HostIdentity } from '../identity.js'
import type { AuditSink, RuntimeAuditEvent, RuntimeOperation } from '../audit.js'
import { auditedForm, auditRequests, recordReference } from '../audit.js'
import { loadPublished } from '../published.js'
import { planRefusal, recordFailure, unknownOutcome } from './runtime-errors.js'
import { createWriteOnce, INVALID_WRITE_ID, writeId } from './write-once.js'
import type { WriteAnswer } from './write-once.js'

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
    /** `repeated`: answered with an earlier sending's answer, and nothing asked of the database (0031). */
    auditTrail?: { formVersion: number | null; record?: string; repeated?: boolean }
  }
}

/**
 * The audit name of each runtime route, keyed `METHOD url`; a route without
 * one stops the server, or never answers (0033). `admin-audit.test.ts` sends
 * every route the router holds and fails on an entry no route has.
 */
export const ROUTE_OPERATIONS: Readonly<Record<string, RuntimeOperation>> = {
  'GET /v1/forms/:id': 'form',
  'POST /v1/forms/:id/records/read': 'read',
  'POST /v1/forms/:id/records/create': 'create',
  'POST /v1/forms/:id/records/update': 'update',
  'POST /v1/forms/:id/lookups/:source/query': 'lookup-query',
  'POST /v1/forms/:id/lookups/:source/resolve': 'lookup-resolve',
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
 * or a stale client, and either way is not saved (0022). An unedited instant
 * or time the actor may write is the planner's to remove, against the same
 * read (0040).
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
  const writes = createWriteOnce()

  app.addHook('onRequest', async (request) => {
    request.auditTrail = { formVersion: null }
  })

  // Before any route, so a route without an audit name stops the server,
  // with a sink or without one (0033).
  const key = options.audit?.key
  auditRequests(app, {
    names: ROUTE_OPERATIONS,
    sink: options.audit?.sink,
    now: options.audit?.now,
    describe: (request, base): RuntimeAuditEvent => {
      const trail = request.auditTrail ?? { formVersion: null }
      return {
        at: base.at,
        plane: 'runtime',
        actor: base.actor,
        operation: base.operation,
        form: auditedForm((request.params as { id?: unknown }).id),
        formVersion: trail.formVersion,
        status: base.status,
        outcome: trail.repeated === true ? 'repeated' : base.outcome,
        record: recordReference(key, trail.record),
      }
    },
  })

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

  /**
   * A write that was sent and whose answer was lost (0031): said once in the
   * log, with the adapter's sentence, which names no value; answered with what
   * was addressed; and never sent again -- each route asks the adapter once.
   */
  function lost(request: FastifyRequest<{ Params: { id: string } }>, operation: 'create' | 'update', record: string | null, version: string | null, failure: string): WriteAnswer {
    request.log.warn({ form: request.params.id, operation, failure }, 'a write was sent and its answer lost; it is not retried')
    return { ...unknownOutcome(operation, record, version), record: record ?? undefined }
  }

  /**
   * Sends a write to the database once per sending (write-once.ts): `perform`
   * runs the first time its write id arrives, and a later arrival is answered
   * with that answer. A request without an id is performed every time.
   */
  async function sendOnce(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: 'create' | 'update',
    id: string | undefined,
    perform: () => Promise<WriteAnswer>,
  ): Promise<WriteAnswer & { repeated?: boolean }> {
    const actor = request.identity?.actor.id
    if (id === undefined || actor === undefined) return perform()
    return writes.once({ actor, form: request.params.id, operation, id, body: request.body }, perform)
  }

  /** A write's answer, sent, with what the audit names: its record, and whether it was a repeat. */
  async function answered(reply: FastifyReply, answer: WriteAnswer & { repeated?: boolean }): Promise<FastifyReply> {
    const trail = reply.request.auditTrail
    if (trail !== undefined && answer.record !== undefined) trail.record = answer.record
    if (trail !== undefined && answer.repeated === true) trail.repeated = true
    return reply.code(answer.status).send(answer.body)
  }

  /**
   * Runs every membership check: undefined when every selection is a member,
   * otherwise the refusal to answer. Answered rather than sent, so an
   * update's checks run inside the sending they belong to (0031).
   */
  async function memberships(open: OpenConnection, checks: readonly MembershipCheck[], log: FastifyBaseLogger): Promise<WriteAnswer | undefined> {
    const errors: FieldError[] = []
    for (const check of checks) {
      try {
        const rejected = await open.lookups.rejects(check.config, check.tokens, check.filters)
        if (rejected.length > 0) errors.push(rejectedSelection(check.field))
      } catch (error) {
        // Fails closed, as formancy's own membership port does (formancy.ai 0077).
        log.warn({ field: check.field, error: (error as Error).message }, 'a lookup could not vouch for a selection')
        return { status: 503, body: { code: 'unavailable', message: 'A selection could not be checked. Nothing was saved.' } }
      }
    }
    return errors.length === 0 ? undefined : { status: 422, body: { code: 'invalid-values', message: 'A selection is not one of the options.', fieldErrors: errors } }
  }

  /**
   * One update, from the read that tells an echo from a change to the write,
   * answered rather than sent: the update route runs it once per sending, so
   * a write id that arrives again is answered with this answer and asks the
   * database nothing, its read included (0031).
   *
   * The record as it stands is read first. Against it 0022 removes an
   * unchanged echo of a field the actor may not write, and the planner one of
   * an instant or a time they may (0040). An actor who may update and not
   * read gets no echo removed, and the planner needs no read for them. When
   * the planner cannot tell an echo from a change because the read failed,
   * whatever the failure, that failure is the answer: sent anyway, a read
   * that failed and a write that did not would store the cut value.
   */
  async function updated(request: FastifyRequest<{ Params: { id: string } }>, bundle: PublishedBundle, open: OpenConnection, record: string, version: string, answers: Record<string, unknown>): Promise<WriteAnswer> {
    const actor = context(request)
    let current: FormRecord | undefined
    let unread: RecordFailure | undefined
    const reading = planRead(bundle.snapshot, bundle.bindings, bundle.policy, actor, record)
    if (reading.ok) {
      const stored = await open.records.read(reading.request)
      if (stored.ok) current = toFormAnswers(bundle.bindings, reading.fields, stored)
      else unread = stored
    }
    const plan = planUpdate(bundle.snapshot, bundle.bindings, bundle.policy, actor, record, version, withoutEchoes(bundle, actor, 'update', answers, current?.answers), current)
    if (!plan.ok) {
      if (plan.code === 'invalid-values') return { status: 422, body: { code: plan.code, message: plan.message, fieldErrors: plan.fieldErrors } }
      if (plan.code === 'record-not-read' && unread !== undefined) return recordFailure(bundle.bindings, unread)
      return planRefusal(plan.code, plan.message)
    }
    const refused = await memberships(open, plan.memberships, request.log)
    if (refused !== undefined) return refused
    const outcome = await open.records.update(plan.request)
    if (!outcome.ok && outcome.code === 'unknown-outcome') return lost(request, 'update', record, version, outcome.message)
    if (!outcome.ok) return recordFailure(bundle.bindings, outcome)
    return { status: 200, body: toFormAnswers(bundle.bindings, plan.fields, outcome) }
  }

  app.get<{ Params: { id: string } }>('/v1/forms/:id', async (request, reply) => {
    const bundle = await published(request.params.id, reply)
    if (bundle === undefined) return reply
    const actor = context(request)
    const allowed = (['read', 'create', 'update'] as const).filter((operation) => bundle.bindings.operations[operation as 'create' | 'update'] !== false && authorizeOperation(bundle.policy, actor, operation).ok)
    if (allowed.length === 0) return reply.code(403).send({ code: 'operation-denied', message: 'This form is not available to you.' })
    const readable = readableFields(bundle.policy, actor, bundle.bindings)
    return { form: bundle.form, operations: allowed, readable: readable.ok ? readable.fields : [] } satisfies PublishedForm
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
    const id = writeId(request)
    if (id === null) return answered(reply, INVALID_WRITE_ID)
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
    const refused = await memberships(open, plan.memberships, request.log)
    if (refused !== undefined) return reply.code(refused.status).send(refused.body)
    const answer = await sendOnce(request, 'create', id, async () => {
      const outcome = await open.records.insert(plan.request)
      if (!outcome.ok && outcome.code === 'unknown-outcome') return lost(request, 'create', intendedRecord(plan.request), null, outcome.message)
      if (!outcome.ok) return recordFailure(bundle.bindings, outcome)
      const created = toFormAnswers(bundle.bindings, plan.fields, outcome)
      return { status: 201, body: created, record: created.record ?? undefined }
    })
    return answered(reply, answer)
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/update', async (request, reply) => {
    const body = request.body
    if (!isRecord(body) || typeof body['record'] !== 'string' || typeof body['version'] !== 'string' || !isRecord(body['answers'])) {
      return reply.code(400).send({ code: 'invalid-request', message: 'Expected { record, version, answers }.' })
    }
    if (request.auditTrail !== undefined) request.auditTrail.record = body['record']
    const id = writeId(request)
    if (id === null) return answered(reply, INVALID_WRITE_ID)
    const bundle = await published(request.params.id, reply)
    if (bundle === undefined) return reply
    const open = await connection(bundle, reply)
    if (open === undefined) return reply
    const { record, version, answers } = body
    return answered(reply, await sendOnce(request, 'update', id, () => updated(request, bundle, open, record, version, answers)))
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
      return { rows: await found.open.lookups.resolve(found.config, tokens as string[], found.filters) } satisfies ResolvedLookup
    } catch (error) {
      reply.log.warn({ error: (error as Error).message }, 'a lookup resolve failed')
      return reply.code(503).send({ code: 'unavailable', message: 'The selected options could not be loaded.' })
    }
  })
}
