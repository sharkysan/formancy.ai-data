import { diffSnapshots, generateForm } from '@formancy/data-core'
import type { LookupChoice } from '@formancy/data-core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { validateBundle } from '../bundle.js'
import type { PublishedBundle } from '../bundle.js'
import type { ConfigurationStore } from '../config-store.js'
import type { ConnectionRegistry, OpenConnection } from '../connections.js'
import type { HostIdentity } from '../identity.js'

export interface AdminOptions {
  registry: ConnectionRegistry
  store: ConfigurationStore
  /** Roles in the host's token that may connect, discover, propose and publish. */
  adminRoles: readonly string[]
  authenticate: (request: FastifyRequest) => Promise<HostIdentity | undefined>
}

/** A form id is a configuration id: lower case, so it means one thing on every filesystem (0013). */
const FORM_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/

function refuse(reply: FastifyReply, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return reply.code(status).send({ code, message, ...extra })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function lookupChoices(value: unknown): LookupChoice[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const choices: LookupChoice[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry['foreignKey'] !== 'string') return undefined
    const display = entry['display']
    if (!Array.isArray(display) || !display.every((column) => typeof column === 'string')) return undefined
    choices.push({ foreignKey: entry['foreignKey'], display: display as string[] })
  }
  return choices
}

/**
 * The administrator's plane: connections, discovery, proposals, publication
 * and drift (plan section 13). Every route requires a host identity holding
 * one of `adminRoles` — publishing a form and writing a business record are
 * different permissions, and nothing here touches a record.
 *
 * A database that cannot be reached is 503 with no detail: a driver's message
 * names hosts and ports, which is the operator's business and not the caller's.
 */
export async function adminRoutes(app: FastifyInstance, options: AdminOptions): Promise<void> {
  const { registry, store } = options
  const admins = new Set(options.adminRoles)

  app.addHook('preHandler', async (request, reply) => {
    const identity = await options.authenticate(request)
    if (identity === undefined) {
      return reply.code(401).header('www-authenticate', 'Bearer').send({ code: 'unauthenticated', message: 'A valid host token is required.' })
    }
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

  async function discover(id: string, reply: FastifyReply) {
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
    const { connection: id, root, formId, title, versionColumn, pinned } = body
    const lookups = lookupChoices(body['lookups'])
    const pinnedColumns = pinned === undefined ? [] : Array.isArray(pinned) && pinned.every((name) => typeof name === 'string') ? (pinned as string[]) : undefined
    if (
      typeof id !== 'string' ||
      !isRecord(root) ||
      typeof root['schema'] !== 'string' ||
      typeof root['name'] !== 'string' ||
      typeof formId !== 'string' ||
      !FORM_ID.test(formId) ||
      typeof title !== 'string' ||
      lookups === undefined ||
      pinnedColumns === undefined ||
      (versionColumn !== undefined && typeof versionColumn !== 'string')
    ) {
      return refuse(reply, 400, 'invalid-request', 'Expected connection, root { schema, name }, a lower-case formId, title, and optional lookups, versionColumn and pinned columns.')
    }
    const snapshot = await discover(id, reply)
    if (snapshot === undefined) return reply
    try {
      const generated = generateForm(snapshot, {
        connection: id,
        root: { schema: root['schema'], name: root['name'] },
        formId,
        title,
        lookups,
        pinned: pinnedColumns,
        ...(typeof versionColumn === 'string' ? { versionColumn } : {}),
      })
      return { ...generated, snapshot }
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
    const checked = validateBundle(body['bundle'])
    if (!checked.ok) return refuse(reply, 422, 'invalid-bundle', 'The bundle cannot be published.', { problems: checked.problems })
    const bundle = checked.bundle
    if (bundle.form.id !== id) return refuse(reply, 422, 'invalid-bundle', `The form's id is ${bundle.form.id}, not ${id}.`)
    if (registry.scope(bundle.connection) === undefined) {
      return refuse(reply, 422, 'invalid-bundle', `No connection is called ${bundle.connection}.`)
    }
    const outcome = await store.publish(id, body['expectedBase'] as number | null, bundle)
    if (!outcome.ok) return refuse(reply, 409, 'conflict', 'Somebody published first. Rebase on the current version and try again.', { current: outcome.current })
    return reply.code(201).send({ version: outcome.version })
  })

  /** The newest published bundle, re-validated, or a reply already sent. */
  async function latest(id: string, reply: FastifyReply): Promise<{ version: number; bundle: PublishedBundle } | undefined> {
    if (!FORM_ID.test(id)) {
      await refuse(reply, 404, 'unknown-form', `No form is called ${id}.`)
      return undefined
    }
    const version = await store.latest(id)
    if (version === null) {
      await refuse(reply, 404, 'unknown-form', `No form is called ${id}.`)
      return undefined
    }
    const checked = validateBundle(await store.read(id, version))
    if (!checked.ok) {
      reply.log.error({ form: id, version, problems: checked.problems }, 'a published bundle failed validation')
      await refuse(reply, 500, 'corrupt-bundle', `Version ${String(version)} of ${id} no longer validates and is not served.`)
      return undefined
    }
    return { version, bundle: checked.bundle }
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
}
