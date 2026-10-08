import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { HostIdentity, IdentityVerifier } from './identity.js'

export interface DataServerOptions {
  verifyIdentity: IdentityVerifier
  /** Fastify's logger. Off by default in tests; the composition root turns it on. */
  logger?: boolean
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

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization
  if (header === undefined) return undefined
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header)
  return match?.[1]
}

/**
 * The HTTP surface, as far as it exists.
 *
 * Two routes today, and on purpose no more: a route that answered before the
 * adapters behind it could would be a documented-but-inert endpoint, which is
 * the failure this repository refuses. The record, lookup and publication
 * routes arrive with the operations they call.
 *
 * `GET /v1/whoami` is for the person wiring a host application in: it returns
 * exactly the identity the server derived from the host's token, so a wrong
 * issuer, audience or claim mapping is visible before any form depends on it.
 */
export async function createDataServer(options: DataServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: BODY_LIMIT })

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

  return app
}
