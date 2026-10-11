import { describeReassigned, diffSnapshots, generateForm } from '@formancy/data-core'
import type { FormBindings, FormPolicy, MetadataSnapshot, ReassignedKey } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { auditRequests } from '../audit.js'
import type { AuditSink } from '../audit.js'
import { generatedProblems } from '../bundle-format2.js'
import { validateBundle } from '../bundle.js'
import type { PublishedBundle } from '../bundle.js'
import { UnparsableVersionError } from '../config-store.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry, OpenConnection } from '../connections.js'
import { readGeneration } from '../generation.js'
import type { HostIdentity } from '../identity.js'
import { FORM_ID, loadPublished, loadVersion } from '../published.js'
import { readKeysConfirmed, unconfirmedKeys } from '../reassigned.js'
import { ADMIN_OPERATIONS, adminTrail, describeAdmin } from './admin-audit.js'
import { evolutionRoutes } from './admin-evolution.js'

export interface AdminOptions {
  registry: ConnectionRegistry
  store: ConfigurationStore
  /** Roles in the host's token that may connect, discover, propose and publish. */
  adminRoles: readonly string[]
  authenticate: (request: FastifyRequest) => Promise<HostIdentity | undefined>
  /**
   * The operational trail (0023, 0033): one event per request, refusals
   * included. Required, unlike the runtime's: a plane that publishes and
   * restores forms does not run without saying who did.
   */
  audit: { sink: AuditSink; now?: () => string }
}

/** Sends a refusal: a stable code, a sentence, and whatever else the caller can act on. */
export type Refuse = (reply: FastifyReply, status: number, code: string, message: string, extra?: Record<string, unknown>) => FastifyReply

/** Discovers a connection's database as it is now, or sends the refusal and gives `undefined`. */
export type Discover = (connection: string, reply: FastifyReply) => Promise<MetadataSnapshot | undefined>

function refuse(reply: FastifyReply, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return reply.code(status).send({ code, message, ...extra })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The administrator's plane: connections, discovery, proposals, publication,
 * drift, and since 0030 versions, regeneration and restore (plan section 13).
 * Every route requires a host identity holding one of `adminRoles` —
 * publishing a form and writing a business record are
 * different permissions, and nothing here touches a record.
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
    try {
      return await open.adapter.ping()
    } catch {
      return refuse(reply, 503, 'unavailable', `Connection ${request.params.id} did not answer.`)
    }
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
    const checked = validateBundle(body['bundle'])
    if (!checked.ok) return refuse(reply, 422, 'invalid-bundle', 'The bundle cannot be published.', { problems: checked.problems })
    const bundle = checked.bundle
    trail.connection = bundle.connection
    if (bundle.format === 1) {
      return refuse(reply, 422, 'invalid-bundle', 'The bundle cannot be published.', { problems: ['publish format 2: since 0030 a version keeps its generation request, generated base and presentation'] })
    }
    if (bundle.form.id !== id) return refuse(reply, 422, 'invalid-bundle', `The form's id is ${bundle.form.id}, not ${id}.`)
    if (registry.scope(bundle.connection) === undefined) {
      return refuse(reply, 422, 'invalid-bundle', `No connection is called ${bundle.connection}.`)
    }
    // At publish only: on read, a later generator must not make a stored version corrupt (0030).
    const generated = generatedProblems(bundle)
    if (generated.length > 0) return refuse(reply, 422, 'invalid-bundle', 'The bundle cannot be published.', { problems: generated })
    const conflict = (current: number | null) => refuse(reply, 409, 'conflict', 'Somebody published first. Rebase on the current version and try again.', { current })
    const keys = await unconfirmedAgainst(id, expectedBase, bundle, confirmed, reply)
    if (keys.length > 0) {
      // Compared with a version somebody has replaced, the keys may say something else: the conflict is the answer.
      const current = await store.latest(id)
      if (current !== expectedBase) return conflict(current)
      return refuse(reply, 422, 'keys-reassigned', `Version ${String(expectedBase)} bound ${keys.map((key) => key.field).join(', ')} to other columns or lookups: confirm the grants on each for what it stands for now, or remove them. A grant is a role on the key's field, or a through that scopes this form's rows by it.`, {
        keys,
        problems: keys.map(describeReassigned),
      })
    }
    const outcome = await store.publish(id, expectedBase, bundle)
    if (!outcome.ok) return conflict(outcome.current)
    trail.formVersion = outcome.version
    return reply.code(201).send({ version: outcome.version })
  })

  /**
   * The keys a publish over `expectedBase` grants on that the version it
   * replaces bound to something else, and that it does not confirm (0039).
   * Nothing to compare for a first version, or for a base that is not there
   * -- below 1, or past the newest -- which the store's compare-and-swap
   * refuses; nor for a version that does not validate, or whose file does
   * not parse, which is not served (0019), so none of its grants is in
   * effect -- and publishing over it is how it is replaced. Any other
   * failure to read the base throws: a check that cannot answer refuses.
   */
  async function unconfirmedAgainst(id: string, expectedBase: number | null, bundle: { bindings: FormBindings; policy: FormPolicy }, confirmed: readonly ReassignedKey[], reply: FastifyReply): Promise<ReassignedKey[]> {
    if (expectedBase === null || expectedBase < 1) return []
    let replaced: Awaited<ReturnType<typeof loadVersion>>
    try {
      replaced = await loadVersion(store, id, expectedBase, reply.log)
    } catch (error) {
      if (!(error instanceof UnparsableVersionError)) throw error
      reply.log.error({ form: id, version: expectedBase }, 'a published version does not parse, and is not compared')
      return []
    }
    return replaced.ok ? unconfirmedKeys(replaced.bundle.bindings, bundle, confirmed) : []
  }

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

  // After the role check above, which covers every route registered on this instance.
  evolutionRoutes(app, { store, discover, refuse })
}
