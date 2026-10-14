import rateLimit from '@fastify/rate-limit'
import Fastify, { LogController } from 'fastify'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { CONFIGURATION_ID_MAX_LENGTH } from './config-store.js'
import type { ConfigurationStore } from './config-store.js'
import type { ConnectionRegistry } from './connections.js'
import { crossOrigin, originsProblem } from './cors.js'
import type { HostIdentity, IdentityVerifier } from './identity.js'
import { PATH_NOT_PLAIN, plainPath } from './paths.js'
import { DEFAULT_RATE_LIMIT } from './rate-limit.js'
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
   * Default 600 a minute (`DEFAULT_RATE_LIMIT`). Generous on purpose: a lookup
   * is a request per pause in typing. What it is for is the other case:
   * somebody replaying tokens at the verifier as fast as the network allows.
   * The runnable server reads `FORMANCY_DATA_RATE_LIMIT` for it (main.ts).
   * Fastify's `trustProxy` is not offered, so behind a reverse proxy every
   * client shares the proxy's address and one bucket: the setting raises that
   * bucket, it does not split it.
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
   *
   * `origins`: the origins a page may call these routes from, each exactly
   * as a browser sends `Origin` -- `https://app.example`, or plain HTTP on
   * localhost, 127.0.0.1 or [::1] -- checked as `FORMANCY_DATA_CORS_ORIGINS`
   * is, so a wildcard, a pattern or `null` stops the server here (0060).
   * Empty or absent, nothing is offered across origins. The administrator's
   * plane has no such list: it answers no other origin.
   */
  runtime?: { registry: ConnectionRegistry; store: ConfigurationStore; audit?: NonNullable<RuntimeOptions['audit']>; origins?: readonly string[] }
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
  // Checked before anything is built, as main.ts checks the setting: a list
  // nobody could have meant does not start a server that grants it. A copy
  // is checked and granted, since building awaits before the grants are
  // made, and an embedder's array changed meanwhile would be granted
  // unchecked.
  const given = options.runtime?.origins ?? []
  const origins = Array.isArray(given) ? Object.freeze([...given]) : given
  const refused = originsProblem(origins)
  if (refused !== undefined) throw new Error(refused)

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

  // Nothing this server answers may be kept by a cache (0037). A form id may
  // end in `.js` or `.css`, which a CDN caches by extension, and a cache that
  // does not treat Authorization as private would hand one person's form or
  // record to the next. Set on every answer that runs the hooks, refusals
  // and errors included, and over anything a route set: a route that wanted
  // to be cached would be a decision, not a header. What is written before
  // any hook -- the router's 400 for an escape that does not decode and its
  // 414, the 503 while closing, what Node's parser refuses -- carries none,
  // and holds no form or record.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store')
    return payload
  })

  // Global, unlike formancy's server, where the management plane is
  // authenticated by its own sessions: every route here except /health is
  // reachable by anybody holding a browser and does work before refusing.
  const limit = options.rateLimit ?? DEFAULT_RATE_LIMIT
  await app.register(rateLimit, { global: true, max: limit.max, timeWindow: limit.timeWindowMs })

  // A path a proxy could read differently from the router is answered here,
  // before any route's work (paths.ts, 0037): before a plane's hooks, before
  // the token is read, before the audit's own onRequest. A route that
  // matched still writes its plane's one event, by this status, since the
  // plane's onSend and onResponse run for any answer its route gives (0033).
  // The limiter puts its hook on each route, and a route's own hooks run
  // after every hook added here, so it would never see this refusal: it is
  // asked here instead, and a request it has counted is not counted again.
  // `request.url` is the target as sent: Fastify reads it from the raw
  // request, and nothing here rewrites URLs.
  const counted = app.rateLimit()
  app.addHook('onRequest', async (request, reply) => {
    if (plainPath(request.url)) return undefined
    await counted.call(app, request, reply)
    return reply.code(400).send(PATH_NOT_PLAIN)
  })

  // Across origins (cors.ts, 0060): before every route, so its hooks cover
  // /health, /v1/whoami and both planes. With no origin listed it adds no
  // route and no header, and still refuses a token-bearing request a
  // browser marks cross-site, which only a grant cached under an earlier
  // list, or added by some other component, would let a browser send.
  crossOrigin(app, { origins })

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
    const { origins: _offered, ...runtime } = options.runtime
    await app.register(runtimeRoutes, { ...runtime, authenticate })
  }

  return app
}
