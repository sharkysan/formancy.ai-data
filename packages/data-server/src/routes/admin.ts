import { diffSnapshots, generateForm, serverStanding } from '@formancy/data-core'
import type { MetadataSnapshot, ServerIdentity, ServerStanding } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { auditRequests } from '../audit.js'
import type { AuditSink } from '../audit.js'
import type { PublishedBundle } from '../bundle.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry, OpenConnection } from '../connections.js'
import { readGeneration } from '../generation.js'
import { callerOf, DECIDED_ON_THE_DRAFT, refusalFor } from '../governance.js'
import type { HostIdentity } from '../identity.js'
import { publisherRolesProblem } from '../publisher-roles.js'
import { FORM_ID, loadPublished } from '../published.js'
import { conflictOver, keysRefusal, storable } from '../publishing.js'
import type { Refusal } from '../publishing.js'
import { readKeysConfirmed } from '../reassigned.js'
import { ADMIN_OPERATIONS, adminOperationOf, adminTrail, describeAdmin } from './admin-audit.js'
import { reviewRoutes } from './admin-drafts.js'
import { evolutionRoutes } from './admin-evolution.js'
import { promotionRoutes } from './admin-promotion.js'

export interface AdminOptions {
  registry: ConnectionRegistry
  store: ConfigurationStore
  /** Roles in the host's token that may connect, discover, propose and publish. */
  adminRoles: readonly string[]
  /**
   * Publication under review (0065): the roles whose holders approve a
   * draft another administrator submitted, each one also in `adminRoles`.
   * Absent, there is no review, and every administrator publishes alone.
   * Present, nobody publishes or imports directly, and a publisher
   * restores. An empty list, or a role `adminRoles` lacks, stops the plane.
   */
  publisherRoles?: readonly string[]
  authenticate: (request: FastifyRequest) => Promise<HostIdentity | undefined>
  /**
   * The operational trail (0023, 0033): one event per request, refusals
   * included. Required, unlike the runtime's: a plane that publishes and
   * restores forms does not run without saying who did.
   */
  audit: { sink: AuditSink; now?: () => string }
}

/**
 * What `POST /v1/connections/:id/test` answers: the server as its adapter's
 * ping reports it, and whether this release was tested on it, as data-core
 * decides (0068). Said, never a refusal.
 */
export interface ConnectionTest extends ServerIdentity {
  standing: ServerStanding
}

/** Sends a refusal: a stable code, a sentence, and whatever else the caller can act on. */
export type Refuse = (reply: FastifyReply, status: number, code: string, message: string, extra?: Record<string, unknown>) => FastifyReply

/** Discovers a connection's database as it is now, or sends the refusal and gives `undefined`. */
export type Discover = (connection: string, reply: FastifyReply) => Promise<MetadataSnapshot | undefined>

function refuse(reply: FastifyReply, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return reply.code(status).send({ code, message, ...extra })
}

/** Sends a refusal `publishing.ts` decided. */
function send(reply: FastifyReply, refusal: Refusal): FastifyReply {
  return refuse(reply, refusal.status, refusal.code, refusal.message, refusal.extra)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The administrator's plane: connections, discovery, proposals, publication,
 * drift, and since 0030 versions, regeneration and restore (plan section 13).
 * Every route requires a host identity holding one of `adminRoles` —
 * publishing a form and writing a business record are
 * different permissions, and nothing here touches a record. With
 * `publisherRoles`, publication is reviewed (0065, governance.ts): the
 * same preHandler refuses what the caller's grant alone does not allow.
 *
 * A database that cannot be reached is 503 with no detail: a driver's message
 * names hosts and ports, which is the operator's business and not the caller's.
 *
 * Every request is audited, one event each (0033), by hooks installed before
 * any route, so a route added here without an audit name stops the server.
 */
export async function adminRoutes(app: FastifyInstance, options: AdminOptions): Promise<void> {
  const { registry, store } = options
  const admins = new Set(options.adminRoles)

  // The type requires it; this is for a caller the type does not reach.
  if (typeof (options.audit as Partial<AdminOptions['audit']> | undefined)?.sink !== 'function') {
    throw new Error("The administrator's plane needs an audit sink: audit: { sink } (0033).")
  }
  // The setting's rule, for an embedder no environment variable reads: a
  // review nobody can approve, or approved by a role the plane refuses at
  // its door, is not started. Copied, as the administrator roles are.
  const given = options.publisherRoles
  const refused = given === undefined ? undefined : publisherRolesProblem(given, options.adminRoles)
  if (refused !== undefined) throw new Error(refused)
  const publishers = given === undefined ? undefined : new Set(given)
  const review = publishers !== undefined
  auditRequests(app, { names: ADMIN_OPERATIONS, sink: options.audit.sink, now: options.audit.now, describe: describeAdmin((id) => registry.scope(id) !== undefined) })

  app.addHook('preHandler', async (request, reply) => {
    const identity = await options.authenticate(request)
    if (identity === undefined) {
      return reply.code(401).header('www-authenticate', 'Bearer').send({ code: 'unauthenticated', message: 'A valid host token is required.' })
    }
    // Before the role check, so a refused attempt names who made it.
    request.identity = identity
    if (!identity.actor.roles.some((role) => admins.has(role))) {
      return refuse(reply, 403, 'forbidden', 'This action needs an administrator role.')
    }
    // Governance (0065), before the route reads its body: what the grant
    // alone refuses this caller. A draft's approval and rejection depend on
    // the draft, and their routes ask once it is read.
    const operation = adminOperationOf(request)
    if (operation !== undefined && !DECIDED_ON_THE_DRAFT.has(operation)) {
      const refusal = refusalFor(operation, callerOf(identity, publishers), review)
      if (refusal !== undefined) return refuse(reply, refusal.status, refusal.code, refusal.message)
    }
    return undefined
  })

  /** The connection's ports, or a reply already sent. */
  async function connection(id: string, reply: FastifyReply): Promise<OpenConnection | undefined> {
    let open: OpenConnection | undefined
    try {
      open = await registry.open(id)
    } catch (error) {
      reply.log.warn({ connection: id, error: (error as Error).message }, 'connection could not be opened')
      await refuse(reply, 503, 'unavailable', `Connection ${id} cannot be reached.`)
      return undefined
    }
    if (open === undefined) await refuse(reply, 404, 'unknown-connection', `No connection is called ${id}.`)
    return open
  }

  async function discover(id: string, reply: FastifyReply): Promise<MetadataSnapshot | undefined> {
    const scope = registry.scope(id)
    const open = await connection(id, reply)
    if (open === undefined || scope === undefined) return undefined
    try {
      return await open.adapter.discover(scope)
    } catch (error) {
      reply.log.warn({ connection: id, error: (error as Error).message }, 'discovery failed')
      await refuse(reply, 503, 'unavailable', `Connection ${id} could not be read.`)
      return undefined
    }
  }

  app.get('/v1/connections', async () => ({ connections: registry.ids() }))

  app.post<{ Params: { id: string } }>('/v1/connections/:id/test', async (request, reply) => {
    const open = await connection(request.params.id, reply)
    if (open === undefined) return reply
    let identity: ServerIdentity
    try {
      identity = await open.adapter.ping()
    } catch {
      return refuse(reply, 503, 'unavailable', `Connection ${request.params.id} did not answer.`)
    }
    // A server this release was not tested on is answered as any other (0068): the standing says it.
    const tested: ConnectionTest = { ...identity, standing: serverStanding(identity.kind, identity) }
    return tested
  })

  app.get<{ Params: { id: string } }>('/v1/connections/:id/metadata', async (request, reply) => {
    const snapshot = await discover(request.params.id, reply)
    return snapshot ?? reply
  })

  app.post('/v1/form-proposals', async (request, reply) => {
    const body = request.body
    if (!isRecord(body)) return refuse(reply, 400, 'invalid-request', 'Expected a JSON object.')
    const read = readGeneration(body)
    if (!read.ok) {
      return refuse(reply, 400, 'invalid-request', 'Expected connection, root { schema, name }, a lower-case formId, title, and optional lookups, versionColumn and pinned columns.')
    }
    const trail = adminTrail(request)
    trail.form = read.generation.formId
    trail.connection = read.generation.connection
    const snapshot = await discover(read.generation.connection, reply)
    if (snapshot === undefined) return reply
    try {
      // The request as it was read is what a format-2 bundle keeps (0030), so a regeneration asks for the same form.
      return { ...generateForm(snapshot, read.generation), snapshot, generation: read.generation }
    } catch (error) {
      // generateForm's messages name only approved metadata and the request's own words.
      return refuse(reply, 422, 'cannot-generate', (error as Error).message)
    }
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/versions', async (request, reply) => {
    const id = request.params.id
    const body = request.body
    if (!FORM_ID.test(id)) return refuse(reply, 400, 'invalid-request', 'A form id is lower-case letters, digits, dot, hyphen or underscore.')
    if (!isRecord(body) || !('expectedBase' in body) || !(body['expectedBase'] === null || Number.isSafeInteger(body['expectedBase']))) {
      return refuse(reply, 400, 'invalid-request', 'Expected { expectedBase: the version you edited, or null for the first, bundle }.')
    }
    const expectedBase = body['expectedBase'] as number | null
    const trail = adminTrail(request)
    trail.expectedBase = expectedBase
    const confirmed = readKeysConfirmed(body['keysConfirmed'])
    if (confirmed === undefined) {
      return refuse(reply, 400, 'invalid-request', 'Expected keysConfirmed, when sent, to list { field, was, now } as a regeneration reports them in keysReassigned.')
    }
    const checked = storable(body['bundle'], id, (name) => registry.scope(name) !== undefined)
    if (!checked.ok) {
      if (checked.connection !== undefined) trail.connection = checked.connection
      return send(reply, checked.refusal)
    }
    const bundle = checked.bundle
    trail.connection = bundle.connection
    const keys = await keysRefusal(store, id, expectedBase, bundle, confirmed, reply.log)
    if (keys !== undefined) return send(reply, keys)
    const outcome = await store.publish(id, expectedBase, bundle)
    if (!outcome.ok) return send(reply, conflictOver(outcome.current))
    trail.formVersion = outcome.version
    return reply.code(201).send({ version: outcome.version })
  })

  /** The newest published bundle, re-validated, or a reply already sent. */
  async function latest(id: string, reply: FastifyReply): Promise<{ version: number; bundle: PublishedBundle } | undefined> {
    const loaded = await loadPublished(store, id, reply.log)
    if (loaded.ok) {
      const trail = adminTrail(reply.request)
      trail.formVersion = loaded.version
      trail.connection = loaded.bundle.connection
      return { version: loaded.version, bundle: loaded.bundle }
    }
    await refuse(reply, loaded.status, loaded.code, loaded.message)
    return undefined
  }

  app.get<{ Params: { id: string } }>('/v1/forms/:id/versions/latest', async (request, reply) => {
    return (await latest(request.params.id, reply)) ?? reply
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/drift', async (request, reply) => {
    const published = await latest(request.params.id, reply)
    if (published === undefined) return reply
    const current = await discover(published.bundle.connection, reply)
    if (current === undefined) return reply
    return { version: published.version, ...diffSnapshots(published.bundle.snapshot, current, published.bundle.bindings, published.bundle.policy) }
  })

  // After the role check and the governance gate above, which cover every route registered on this instance.
  const allowlisted = (name: string) => registry.scope(name) !== undefined
  evolutionRoutes(app, { store, discover, refuse })
  promotionRoutes(app, { store, allowlisted, discover, refuse })
  reviewRoutes(app, { store, publisherRoles: publishers, allowlisted, discover, refuse })
}
