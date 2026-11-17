import {
  authorizeOperation,
  copiedFields,
  deleteEffects,
  driftRefusal,
  grantedOperations,
  lookupOpens,
  listable,
  listColumns,
  NOTHING_LEFT,
  offeredFor,
  planRead,
  READ_REFUSED,
  readableFields,
  runtimeOperations,
  startingDefaults,
  stateMoves,
  toFormAnswers,
  todayOf,
  togetherOf,
  versionFields,
  viewsFor,
  writableFields,
} from '@formancy/data-core'
import type {
  DescribedTable,
  DriftChange,
  ListColumns,
  ListView,
  PlanRefusal,
  PolicyContext,
  PolicyOperation,
  PublishedForm,
  RecordFailure,
  RelatedField,
  UnknownOutcome,
} from '@formancy/data-core'
import type { HostIdentity } from '@formancy/data-identity'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PublishedBundle } from '../bundle.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry, OpenConnection } from '../connections.js'
import type { AuditSink, RuntimeAuditEvent, RuntimeOperation } from '../audit.js'
import { auditedForm, auditRequests, recordReference, selectionReferences } from '../audit.js'
import { loadPublished } from '../published.js'
import { formActions, registerActionRoute } from './runtime-actions.js'
import { registerDeleteRoute } from './runtime-deletes.js'
import { NOT_FOUND, planRefusal, recordFailure, unknownOutcome } from './runtime-errors.js'
import { registerExportRoute } from './runtime-exports.js'
import { registerListRoute } from './runtime-lists.js'
import { ownViewsOf, registerOwnViewRoutes } from './runtime-own-views.js'
import { registerLookupRoutes } from './runtime-lookups.js'
import { createOffered, registerMenuRoute, servedForms } from './runtime-menu.js'
import { registerSaveRoute } from './runtime-save.js'
import { registerSupersedeRoute } from './runtime-supersede.js'
import { memberships, readForWrite, registerWriteRoutes, withoutEchoes } from './runtime-writes.js'
import { createWriteOnce } from './write-once.js'
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
  /**
   * How long a lookup statement may run before the server stops it, the
   * membership checks inside a create or an update included (0061).
   */
  lookupDeadlineMs: number
  /** How long a save may wait for a lock, and after which none of its steps starts (0155). */
  saveDeadlineMs: number
  /** How long a run of an action may take before the database stops it (0161). */
  actionDeadlineMs: number
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * `repeated`: answered with an earlier sending's answer, and nothing
     * asked of the database (0031). `rows`: the records an export wrote
     * into its file so far (0079), or the row changes a save carried
     * (0155). `moved`: whether a planned create or update -- or a save's
     * record -- moves its policy's state field (0112). `action`: the name
     * of the action run, once the form binds it (0161). `records`: every
     * record a run over a selection addressed, once the form binds it
     * (0165), whose count is then `rows`.
     */
    auditTrail?: {
      formVersion: number | null
      record?: string
      repeated?: boolean
      rows?: number
      moved?: boolean | null
      action?: string
      records?: string[]
    }
  }
}

/**
 * The audit name of each runtime route, keyed `METHOD url`; a route without
 * one stops the server, or never answers (0033). `admin-audit.test.ts` sends
 * every route the router holds and fails on an entry no route has. Exported
 * from the package: the host page's suite reads the runtime plane's routes
 * here rather than keeping a list of its own (0047).
 */
export const ROUTE_OPERATIONS: Readonly<Record<string, RuntimeOperation>> = {
  'GET /v1/forms': 'form-list',
  'GET /v1/forms/:id': 'form',
  'POST /v1/forms/:id/records/read': 'read',
  'POST /v1/forms/:id/records/list': 'list',
  'POST /v1/forms/:id/records/export': 'export',
  'POST /v1/forms/:id/records/create': 'create',
  'POST /v1/forms/:id/records/update': 'update',
  'POST /v1/forms/:id/records/delete': 'delete',
  'POST /v1/forms/:id/records/supersede': 'supersede',
  'POST /v1/forms/:id/records/save': 'save',
  'POST /v1/forms/:id/actions/:action/run': 'action',
  'POST /v1/forms/:id/lookups/:source/query': 'lookup-query',
  'POST /v1/forms/:id/lookups/:source/resolve': 'lookup-resolve',
  'POST /v1/forms/:id/views/save': 'view-save',
  'POST /v1/forms/:id/views/remove': 'view-remove',
}

export { MAX_RESOLVE } from './runtime-lookups.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contextOf(identity: HostIdentity): PolicyContext {
  return { actor: { id: identity.actor.id, roles: [...identity.actor.roles] }, attributes: { ...identity.attributes } }
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
        rows: base.operation === 'export' || base.operation === 'save' || trail.records !== undefined ? (trail.rows ?? 0) : null,
        moved: trail.repeated === true ? null : (trail.moved ?? null),
        ...(trail.action === undefined ? {} : { action: trail.action }),
        ...(trail.records === undefined ? {} : { records: selectionReferences(key, trail.records) }),
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
  function lost(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: UnknownOutcome['operation'],
    record: string | null,
    version: string | null,
    failure: string,
  ): WriteAnswer {
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
    operation: UnknownOutcome['operation'] | `action:${string}`,
    id: string | undefined,
    perform: () => Promise<WriteAnswer>,
  ): Promise<WriteAnswer & { repeated?: boolean }> {
    const actor = request.identity?.actor.id
    if (id === undefined || actor === undefined) return perform()
    return writes.once({ actor, form: request.params.id, operation, id, body: request.body }, perform)
  }

  /**
   * The answer an earlier sending of this write id and body was given, or
   * undefined: asked by a route that refuses before `sendOnce` by what the
   * form says now (0161), so a sending already acted on is answered as it
   * was.
   */
  async function sentBefore(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: `action:${string}`,
    id: string | undefined,
  ): Promise<(WriteAnswer & { repeated: true }) | undefined> {
    const actor = request.identity?.actor.id
    if (id === undefined || actor === undefined) return undefined
    return writes.kept({ actor, form: request.params.id, operation, id, body: request.body })
  }

  /**
   * A drift refusal of the database as it is now (0041), said once in the
   * log with what blocks, by kind and the fields it affects -- never a value,
   * and never the change's message, which names columns and types the person
   * is not told -- and answered with the planner's sentence.
   */
  function driftAnswer(
    request: FastifyRequest<{ Params: { id: string } }>,
    operation: PolicyOperation | 'list' | 'form' | 'action',
    changes: readonly DriftChange[] | undefined,
    message: string,
  ): WriteAnswer {
    request.log.warn(
      {
        form: request.params.id,
        version: request.auditTrail?.formVersion ?? null,
        operation,
        changes: (changes ?? []).map((change) => ({ kind: change.kind, affects: change.affects })),
      },
      'refused: the database no longer fits this form as published',
    )
    return planRefusal('drift', message)
  }

  /** A planner's refusal as the answer, its drift said in the log first, under the operation the audit names. */
  function refusal(request: FastifyRequest<{ Params: { id: string } }>, operation: PolicyOperation | 'list' | 'action', plan: PlanRefusal): WriteAnswer {
    return plan.code === 'drift' && plan.drift !== undefined ? driftAnswer(request, operation, plan.drift, plan.message) : planRefusal(plan.code, plan.message)
  }

  /** The root as the catalog describes it now, or the answer when it cannot be described: 503 when the database cannot say, 409 when the table is not one it describes. */
  async function describedRoot(
    bundle: PublishedBundle,
    open: OpenConnection,
  ): Promise<{ ok: true; described: DescribedTable } | { ok: false; answer: WriteAnswer }> {
    const found = await open.records.describe(bundle.bindings.root)
    return found.ok ? { ok: true, described: found.described } : { ok: false, answer: recordFailure(bundle.bindings, found) }
  }

  /**
   * A write's answer, sent, with what the audit names: its record, and
   * whether it was a repeat. A write the deployment declined (0156) is said
   * once in the log by its code and the form, and never with its reason,
   * which goes to the person alone: the deployment may have written a value
   * into it. The audit names it by the same code, from the body, and holds
   * no message of any answer.
   */
  async function answered(reply: FastifyReply, answer: WriteAnswer & { repeated?: boolean }): Promise<FastifyReply> {
    const trail = reply.request.auditTrail
    if (trail !== undefined && answer.record !== undefined) trail.record = answer.record
    if (trail !== undefined && answer.repeated === true) trail.repeated = true
    if (isRecord(answer.body) && answer.body['code'] === 'declined' && answer.repeated !== true) {
      reply.log.info(
        { form: (reply.request.params as { id?: unknown }).id, code: 'declined' },
        'refused: the deployment declined a write, in words that go to the person and to no log',
      )
    }
    return reply.code(answer.status).send(answer.body)
  }

  /**
   * A read the database refused, a record's or a page's: one that names a
   * column that is gone -- `schema-changed` -- returned no description, so
   * the table is described once more and the read decided over that, and a
   * form drift stops is answered as drift whichever statement found it out
   * (0041). Any other failure is the database's. A page is decided as a
   * list (0044), and said in the log as one.
   */
  async function unread(
    request: FastifyRequest<{ Params: { id: string } }>,
    bundle: PublishedBundle,
    open: OpenConnection,
    failure: RecordFailure,
    operation: 'read' | 'list',
  ): Promise<WriteAnswer> {
    const root = failure.code === 'schema-changed' ? await describedRoot(bundle, open) : undefined
    const refused = root?.ok === true ? driftRefusal(bundle.snapshot, bundle.bindings, bundle.policy, root.described, operation) : undefined
    return refused === undefined ? recordFailure(bundle.bindings, failure) : refusal(request, operation, refused)
  }

  /**
   * A read decided over the description its own statement carried (0041):
   * the refusal when drift stops reading this form -- or, for a page, when
   * the table no longer holds its key to a total order (0044) -- or
   * `undefined`.
   */
  function undecided(
    request: FastifyRequest<{ Params: { id: string } }>,
    bundle: PublishedBundle,
    described: DescribedTable,
    operation: 'read' | 'list',
  ): WriteAnswer | undefined {
    const refused = driftRefusal(bundle.snapshot, bundle.bindings, bundle.policy, described, operation)
    return refused === undefined ? undefined : refusal(request, operation, refused)
  }

  /**
   * What this person's list of `bundle` offers them, or the refusal a list
   * would be answered with: the views for their roles (0124), resolved for
   * them today (0125), that they could have built (0105), the fields the
   * Filter panel leaves out (0123) -- a version published before 0030 has
   * neither -- and their own views that still fit (0126).
   */
  function personColumns(
    bundle: PublishedBundle,
    actor: PolicyContext,
    own: readonly ListView[],
  ): { ok: true; columns: ListColumns; related: RelatedField[] } | { ok: false; answer: WriteAnswer } {
    const listed = listable(bundle.snapshot, bundle.bindings, bundle.policy, actor)
    if (!listed.ok) return { ok: false, answer: planRefusal(listed.code, listed.message) }
    const presentation = bundle.format === 2 ? bundle.presentation : { views: [], unfiltered: [] }
    const views = viewsFor(presentation.views ?? [], actor, todayOf(Date.now()))
    return {
      ok: true,
      columns: listColumns(bundle.bindings, listed.fields, views, {
        unfiltered: presentation.unfiltered ?? [],
        own,
        labelled: [...listed.labels.keys()],
        related: listed.related,
      }),
      related: listed.related,
    }
  }

  // The forms this person may read (0045): from the published bundles and the policy, asking no database.
  const menu = { store, connections: () => registry.ids(), context }
  registerMenuRoute(app, menu)

  /**
   * The form, what this person may do with it now, and which fields they may
   * see. The policy first, before any statement; then the root is described,
   * and only what the database as it is now still allows is offered (0041):
   * a form whose records it can no longer show faithfully is refused, and so
   * is one that leaves this person nothing. Opening a form therefore asks the
   * database, and one that cannot be reached is 503. The form is served with
   * the defaults this person's create would take, and no other (0149), and
   * with the lookup its rows are saved with their record through, if any
   * (0155).
   */
  app.get<{ Params: { id: string } }>('/v1/forms/:id', async (request, reply) => {
    const bundle = await published(request.params.id, reply)
    if (bundle === undefined) return reply
    const actor = context(request)
    // Every bundle as the menu reads them: for the create a together child narrows, and for the forms each lookup's record opens in (0140, 0155).
    const served = await servedForms(menu, request)
    // What the policy grants of what the form offers, as the menu says it (0045), create as the menu narrows it (0155); then what the database allows now.
    const granted = grantedOperations(bundle.bindings, bundle.policy, actor)
    const allowed = createOffered(request.params.id, bundle, served) ? granted : granted.filter((operation) => operation !== 'create')
    if (allowed.length === 0) return reply.code(403).send({ code: 'operation-denied', message: 'This form is not available to you.' })
    const open = await connection(bundle, reply)
    if (open === undefined) return reply
    const root = await describedRoot(bundle, open)
    if (!root.ok) return answered(reply, root.answer)
    const decided = runtimeOperations(bundle.snapshot, bundle.bindings, bundle.policy, root.described)
    if (!decided.ok) return answered(reply, planRefusal(decided.code, decided.message))
    const { verdict } = decided
    if (!verdict.readable) return answered(reply, driftAnswer(request, 'form', decided.drift, READ_REFUSED))
    const operations = allowed.filter((operation) => operation === 'read' || verdict.writable[operation])
    if (operations.length === 0) return answered(reply, driftAnswer(request, 'form', decided.drift, NOTHING_LEFT))
    const readable = readableFields(bundle.policy, actor, bundle.bindings)
    // What `planList` will accept, from the function it asks, and what a page
    // over this description would be decided as, so the page never offers a
    // grid it would be refused (0044).
    const listed = personColumns(bundle, actor, (await ownViewsOf(store, actor, request.params.id)).views)
    const list = listed.ok && driftRefusal(bundle.snapshot, bundle.bindings, bundle.policy, root.described, 'list') === undefined ? listed.columns : null
    // What a delete also does, for a page to word its confirmation by: only where one is offered (0050).
    const deleting = operations.includes('delete') ? deleteEffects(bundle.snapshot, bundle.bindings.root, bundle.policy) : null
    // What a copy of a record carries into a new one: only where a create is offered (0107).
    const copied = operations.includes('create') ? copiedFields(bundle.snapshot, bundle.bindings, bundle.policy, actor) : null
    // Where a version may be changed from a date: it ends one and creates the next (0113).
    const versions = operations.includes('create') && operations.includes('update') ? versionFields(bundle.bindings) : null
    // The lookup this form's rows are saved with their record through (0155); a malformed one, which the bundle check refuses, says none.
    const saved = togetherOf(bundle.bindings)
    const together = saved === null || saved === 'malformed' ? null : { field: saved.binding.field, min: saved.min, max: saved.max }
    // A together child's rows are created in a save of their record alone, which this person may make where the policy grants
    // the create and the database still allows it: what that create takes is what a page draws a new row with (0155).
    const createsInSave =
      together !== null &&
      verdict.writable.create &&
      offeredFor(bundle.bindings, 'create', { save: together.field }) &&
      authorizeOperation(bundle.policy, actor, 'create').ok
    // What each write offered accepts from this person, by the check that refuses the rest (0117).
    const writable = {
      create: operations.includes('create') || createsInSave ? writableFields(bundle.policy, actor, bundle.bindings, 'create') : null,
      update: operations.includes('update') ? writableFields(bundle.policy, actor, bundle.bindings, 'update') : null,
    }
    // The moves this person may make of the state field, where they may write at all (0127), with their states' labels (0129).
    const labels = bundle.format === 2 ? (bundle.presentation.states ?? []) : []
    const moves = writable.create !== null || writable.update !== null ? stateMoves(bundle.policy, actor, bundle.bindings, labels) : null
    // The forms each lookup's record opens in, from every bundle as the menu reads them; none when the store cannot list them (0140).
    const opens =
      served === null
        ? []
        : lookupOpens(
            {
              id: request.params.id,
              title: bundle.form.title,
              connection: bundle.connection,
              snapshot: bundle.snapshot,
              bindings: bundle.bindings,
              policy: bundle.policy,
            },
            actor,
            served.map((entry) => entry.form),
          )
    return {
      // The defaults this person's create would take, and no other (0149): a page draws and submits what it is served.
      form: startingDefaults(bundle.form, writable.create, moves),
      operations,
      readable: readable.ok ? readable.fields : [],
      list,
      deleting,
      copied,
      versions,
      writable,
      moves,
      opens,
      together,
      // The actions this person may run, as the root as described now leaves them runnable (0161).
      actions: formActions(bundle, actor, verdict),
    } satisfies PublishedForm
  })

  /**
   * One record. The policy and the token are decided before any statement;
   * the read statement returns the table's description beside the record,
   * and the read is decided over it after it ran (0041): refused, its values
   * are discarded and never reach the body. A read the database refused as
   * `schema-changed` -- it names a column that is gone -- returned no
   * description, so the table is described once more and the read decided
   * over that: a form drift stops is answered as drift, whichever statement
   * found it out.
   */
  app.post<{ Params: { id: string } }>('/v1/forms/:id/records/read', async (request, reply) => {
    const body = request.body
    if (!isRecord(body) || typeof body['record'] !== 'string') return reply.code(400).send({ code: 'invalid-request', message: 'Expected { record }.' })
    if (request.auditTrail !== undefined) request.auditTrail.record = body['record']
    const bundle = await published(request.params.id, reply)
    if (bundle === undefined) return reply
    const plan = planRead(bundle.snapshot, bundle.bindings, bundle.policy, context(request), body['record'])
    if (!plan.ok) return answered(reply, planRefusal(plan.code, plan.message))
    const open = await connection(bundle, reply)
    if (open === undefined) return reply
    const outcome = await open.records.read(plan.request)
    if (!outcome.ok) return answered(reply, await unread(request, bundle, open, outcome, 'read'))
    const drifted = undecided(request, bundle, outcome.described, 'read')
    if (drifted !== undefined) return answered(reply, drifted)
    if (outcome.record === null) return answered(reply, recordFailure(bundle.bindings, NOT_FOUND))
    return toFormAnswers(bundle.bindings, plan.fields, { ok: true, ...outcome.record })
  })

  // A page of records is a read of many (0044): its steps are the read's, and so is every decision between them.
  registerListRoute(app, { published, connection, context, unread, undecided, answered })
  registerOwnViewRoutes(app, { store, published, context, columns: personColumns, answered })

  // A file of every page a list would show (0079): the list's steps, page after page, and a lookup's for the labels.
  registerExportRoute(app, { published, connection, context, unread, undecided, answered, lookupDeadlineMs: options.lookupDeadlineMs })

  // A record's answers written once per sending of a write id (0031): its echoes removed and its selections checked first.
  const served = (request: FastifyRequest) => servedForms(menu, request)
  const { lookupDeadlineMs, saveDeadlineMs, actionDeadlineMs } = options
  registerWriteRoutes(app, { published, connection, context, sendOnce, lost, refusal, describedRoot, answered, lookupDeadlineMs, served })

  // A record and its together children's rows, in one transaction (0155): every part's steps the write routes', in one request.
  registerSaveRoute(app, {
    published,
    connection,
    context,
    served,
    sendOnce,
    lost,
    refusal,
    describedRoot,
    readForWrite: (bundle, open, actor, record) => readForWrite({ describedRoot }, bundle, open, actor, record),
    answered,
    lookupDeadlineMs,
    saveDeadlineMs,
  })

  // One record, by its token and the version read (0050): the update's steps, a delete's answers.
  registerDeleteRoute(app, { published, connection, context, sendOnce, lost, refusal, answered })

  // A change from a date (0113): the update's read and steps, a create's answer.
  registerSupersedeRoute(app, {
    published,
    connection,
    context,
    sendOnce,
    lost,
    refusal,
    answered,
    readForWrite: (bundle, open, actor, record) => readForWrite({ describedRoot }, bundle, open, actor, record),
    withoutEchoes,
    memberships: (open, checks, log) => memberships(open, checks, log, options.lookupDeadlineMs),
  })

  // An action over the open record, run once per sending in one transaction on a pool of its own (0161).
  registerActionRoute(app, { published, connection, context, sendOnce, sentBefore, refusal, answered, actionDeadlineMs })

  // A lookup's options and labels, each one statement that stops when its request is abandoned or its deadline passes (0061).
  registerLookupRoutes(app, { published, connection, context, lookupDeadlineMs: options.lookupDeadlineMs })
}
