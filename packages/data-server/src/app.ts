import rateLimit from '@fastify/rate-limit'
import Fastify, { LogController } from 'fastify'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { CONFIGURATION_ID_MAX_LENGTH } from './config-store.js'
import type { ConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'
import type { HostIdentity, IdentityVerifier } from './identity.js'
import { adminRoutes } from './routes/admin.js'
import type { AdminOptions } from './routes/admin.js'
import { runtimeRoutes } from './routes/runtime.js'
import type { RuntimeOptions } from './routes/runtime.js'

export interface DataServerOptions {
  verifyIdentity: IdentityVerifier
  /**
   * Fastify's logger: `true` for standard output, or a stream to write its
   * lines to. Off by default in tests; the composition root turns it on.
   */
  logger?: boolean | { stream: { write: (line: string) => void } }
  /**
   * Requests per client address per window, on every route but `/health`.
   *
   * Default 600 a minute. Generous on purpose: a lookup is a request per pause
   * in typing, and a host's reverse proxy can put a whole office behind one
   * address — an operator behind a proxy sets Fastify's `trustProxy` and a
   * limit to match. What it is for is the other case: somebody replaying
   * tokens at the verifier as fast as the network allows.
   */
  rateLimit?: { max: number; timeWindowMs: number }
  /**
   * The administrator's plane: connections, discovery, proposals, publication
   * and drift. Absent, none of those routes exist — a server without a store
   * answers 404 for them rather than pretending. Its audit sink is required:
   * every request that reaches one of its routes is an event (0033).
   */
  admin?: { registry: ConnectionRegistry; store: ConfigurationStore; adminRoles: readonly string[]; audit: AdminOptions['audit'] }
  /**
   * The runtime plane: published forms, their records and their lookups, for
   * the host application's people. Absent, none of those routes exist.
   */
  runtime?: { registry: ConnectionRegistry; store: ConfigurationStore; audit?: NonNullable<RuntimeOptions['audit']> }
}

/**
 * The largest request body accepted. A record is a form's worth of fields; a
 * megabyte is generous for that and small enough that a request cannot be used
 * to make the server buffer something large.
 */
const BODY_LIMIT = 1024 * 1024

declare module 'fastify' {
  interface FastifyRequest {
    identity?: HostIdentity
  }
}

/**
 * A request as the log names it: its method and the route that answered it,
 * never the path, the query or the Host header it was sent with. Those are
 * whatever a caller typed, token or none -- a connection string pasted where
 * a connection's name goes, a password in a query -- and the log is the
 * stream the audit trail is written to, read by whoever runs the collector
 * (0033). Fastify's default writes the URL and the Host as sent.
 */
function requestForLog(request: FastifyRequest) {
  const port = request.socket.remotePort
  return { method: request.method, route: request.routeOptions.url ?? null, remoteAddress: request.ip, ...(port === undefined ? {} : { remotePort: port }) }
}

/** Fastify's request lines, but for its 404 line, which names the path it was sent: here, a 404 is named by its method. */
class RouteOnlyLog extends LogController {
  override routeNotFound(request: FastifyRequest): void {
    if (this.isLogDisabled(request)) return
    request.log.info({ req: request }, 'no route matches')
  }
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization
  if (header === undefined) return undefined
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header)
  return match?.[1]
}

/**
 * The HTTP surface, as far as it exists.
 *
 * The administrator's plane is registered when the server is given a store,
 * a connection registry and the roles that administer. The record and lookup
 * routes arrive with the operations they call: a route that answered before
 * the adapters behind it could would be a documented-but-inert endpoint, which
 * is the failure this repository refuses.
 *
 * `GET /v1/whoami` is for the person wiring a host application in: it returns
 * exactly the identity the server derived from the host's token, so a wrong
 * issuer, audience or claim mapping is visible before any form depends on it.
 */
export async function createDataServer(options: DataServerOptions): Promise<FastifyInstance> {
  const logger = options.logger ?? false
  const app = Fastify({
    logger: logger === false ? false : { serializers: { req: requestForLog }, ...(logger === true ? {} : { stream: logger.stream }) },
    logController: new RouteOnlyLog(),
    bodyLimit: BODY_LIMIT,
    // The longest path parameter is a form id, and the router's default of
    // 100 refused the store's longer ones with 414 before any route ran: a
    // form could be proposed and never published. Lookup sources and
    // connection ids are shorter.
    routerOptions: { maxParamLength: CONFIGURATION_ID_MAX_LENGTH },
  })

  // Global, unlike formancy's server, where the management plane is
  // authenticated by its own sessions: every route here except /health is
  // reachable by anybody holding a browser and does work before refusing.
  const limit = options.rateLimit ?? { max: 600, timeWindowMs: 60_000 }
  await app.register(rateLimit, { global: true, max: limit.max, timeWindow: limit.timeWindowMs })

  const authenticate = async (request: FastifyRequest): Promise<HostIdentity | undefined> => {
    const token = bearer(request)
    if (token === undefined) return undefined
    const outcome = await options.verifyIdentity(token)
    if (!outcome.ok) {
      // Logged without the token: the reason is jose's code or a sentence.
      request.log.info({ reason: outcome.reason }, 'host identity refused')
      return undefined
    }
    return outcome.identity
  }

  // An orchestrator polls this every few seconds; limiting it would mark a
  // healthy server unhealthy exactly when it is busiest.
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }))

  app.get('/v1/whoami', async (request, reply) => {
    const identity = await authenticate(request)
    if (identity === undefined) {
      return reply.code(401).header('www-authenticate', 'Bearer').send({ code: 'unauthenticated', message: 'A valid host token is required.' })
    }
    return identity
  })

  if (options.admin !== undefined) {
    await app.register(adminRoutes, { ...options.admin, authenticate })
  }

  if (options.runtime !== undefined) {
    await app.register(runtimeRoutes, { ...options.runtime, authenticate })
  }

  return app
}
