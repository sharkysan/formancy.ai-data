import { createHmac } from 'node:crypto'
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { CONFIGURATION_ID as FORM_ID } from './config-store.js'

/** What every event says, on either plane. */
interface AuditEventBase {
  at: string
  /**
   * The verified host actor, or `null` for a request refused before its token
   * was read: no token or a token refused, over the rate limit, or a body
   * Fastify refused (400, 413, 415, a client gone mid-body), whatever token it
   * carried, since each plane authenticates after the body is read (0033).
   */
  actor: string | null
  status: number
  /** `ok` below 400; otherwise the stable code the response carried, or `http-NNN` when it carried none. */
  outcome: string
}

export type RuntimeOperation = 'form' | 'read' | 'create' | 'update' | 'lookup-query' | 'lookup-resolve'

export type AdminOperation =
  | 'connection-list'
  | 'connection-test'
  | 'discovery'
  | 'proposal'
  | 'publish'
  | 'version-list'
  | 'version-latest'
  | 'version-read'
  | 'drift'
  | 'regeneration'
  | 'restore'

/**
 * One operational audit event of the runtime plane: who asked for what,
 * against which published version, and how it ended (plan section 12, 0023).
 *
 * Never a value. Not an answer, not a field, not a record: an audit log that
 * copied business data would be a second copy of the customer's database with
 * none of its permissions. The record is named by a keyed hash, or not at all.
 */
export interface RuntimeAuditEvent extends AuditEventBase {
  plane: 'runtime'
  operation: RuntimeOperation
  /** The form addressed, when it has a form id's shape (`auditedForm`); otherwise `null`. */
  form: string | null
  /** The published version the request was served from, when it got that far. */
  formVersion: number | null
  /**
   * A keyed hash of the record token, or `null`. Keyed, because a record token
   * spells its key and a key is often small — customer 7 — so a plain hash
   * could be reversed by trying every number. Without an audit key the server
   * cannot make one that resists that, so it records nothing rather than a
   * reference that only looks redacted.
   */
  record: string | null
}

/**
 * One operational audit event of the administrator's plane (0033): who
 * connected, discovered, proposed, published, read, compared, regenerated or
 * restored, against which connection and which version, and how it ended.
 *
 * Names and numbers only. Never the bundle, the policy or a role it names,
 * a snapshot, a generation request, a drift report or any message.
 */
export interface AdminAuditEvent extends AuditEventBase {
  plane: 'admin'
  operation: AdminOperation
  /** An allowlisted connection's name, never an address (0019): one the allowlist does not know is `null`. */
  connection: string | null
  /** The form addressed, when it has a form id's shape (`auditedForm`); otherwise `null`. */
  form: string | null
  /** The version read, compared, regenerated from, or written. */
  formVersion: number | null
  /** Publish and restore: the base the administrator said they edited. */
  expectedBase: number | null
  /** Restore only: the version the new one copies, which nothing on disk records. */
  restoredFrom: number | null
}

/** Both planes, told apart by `plane`. A typed sink narrows on it before reading a plane's own fields. */
export type AuditEvent = RuntimeAuditEvent | AdminAuditEvent

/**
 * Where events go. A port: the default writes a structured log line; a
 * deployment that needs a durable trail supplies its own.
 *
 * A sink that throws does not fail the request — by the time the event exists,
 * the write it describes has committed or not, and refusing to answer would
 * only hide which. The failure is logged instead. That is the limitation 0023
 * writes down: this is an operational trail, not evidence.
 */
export type AuditSink = (event: AuditEvent) => void | Promise<void>

/** Events as structured log lines, one per request. */
export function logAuditSink(log: FastifyBaseLogger): AuditSink {
  return (event) => {
    log.info({ audit: event }, 'audit')
  }
}

/**
 * A form id as the trail records it, on either plane: the text addressed when
 * it has the store's shape for a form id, otherwise `null`. A path parameter
 * is anything a caller types, token or no token, up to the router's limit; a
 * form id's shape holds no `:`, `;`, `@`, `=` or `/`, so no connection
 * string, and names something the store could hold (0033). It does hold an
 * IP address, a host name, or a lower-case word that is somebody's password:
 * those are form ids, and are recorded as typed.
 */
export function auditedForm(id: unknown): string | null {
  return typeof id === 'string' && FORM_ID.test(id) ? id : null
}

/** The keyed hash a record is named by: the first 32 hex characters of HMAC-SHA-256. */
export function recordReference(key: string | undefined, token: string | undefined): string | null {
  if (key === undefined || token === undefined || token === '') return null
  return createHmac('sha256', key).update(token, 'utf8').digest('hex').slice(0, 32)
}

/** What the shared hooks establish for every event, before a plane adds its own fields. */
export interface AuditBase<Operation extends string> extends AuditEventBase {
  operation: Operation
}

export interface AuditRequestsOptions<Operation extends string> {
  /** The audit name of every route the plane registers, keyed `METHOD url`, HEAD as the GET it answers for. */
  names: Readonly<Record<string, Operation>>
  /** Absent, nothing is emitted; a route without a name is refused all the same. */
  sink?: AuditSink | undefined
  now?: (() => string) | undefined
  /** The plane's event: the base, and the fields only that plane has. */
  describe: (request: FastifyRequest, base: AuditBase<Operation>) => AuditEvent
}

/** `METHOD url`, with HEAD as the GET it answers for. */
function routeKey(method: string, url: string): string {
  const verb = method.toUpperCase()
  return `${verb === 'HEAD' ? 'GET' : verb} ${url}`
}

/**
 * One event per request, for every route of the plane it is called on, from
 * one set of hooks both planes share — so the two cannot disagree on what an
 * outcome is, or on whether a refusal is audited (0023, 0033).
 *
 * Called before the plane registers a route: from then on a route in that
 * context with no audit name stops the registration, whether or not a sink is
 * configured. `onRoute` sees only the routes registered after it, so a route
 * registered in the context before this call is refused on every request
 * instead, before its handler runs, and the log names it: either way a route
 * without a name never answers unaudited.
 *
 * The event is built once the reply is decided, from the response itself:
 * every ending — success, refusal, a database out of reach — without each
 * branch remembering to say so.
 *
 * Exactly once for a request that reaches a route, whichever way it ends,
 * measured against Fastify 5.12.5 on Node 22. `onResponse` runs only when the
 * response finishes. One whose client left while the route still ran never
 * finishes: the handler completes and its write commits, `onSend` runs with
 * the response already destroyed, and neither `onResponse` nor
 * `onRequestAbort` runs, the latter because the body had been read. One
 * pipelined behind another answer on its connection has no socket of its own
 * until that answer is written; if the connection goes first it emits
 * neither `finish` nor `close`, and is never destroyed. So the event is also
 * written from `onSend` when the response or its connection is already gone,
 * and otherwise from the connection's `close` if it comes before the event
 * is written: a response whose socket goes after `onSend` goes with its
 * connection, and a pipelined one has nothing else to say so. Whichever
 * comes first writes it, and the others find it written. A connection holds
 * one listener while any answer waits on it, however many requests a client
 * pipelined, and none once the last is written.
 */
export function auditRequests<Operation extends string>(app: FastifyInstance, options: AuditRequestsOptions<Operation>): void {
  const { names, sink, describe } = options

  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      const key = routeKey(method, route.url)
      if (!Object.hasOwn(names, key)) throw new Error(`${key} has no audit name (0023, 0033)`)
    }
  })

  // A route `onRoute` never saw: registered in this context before the call.
  app.addHook('onRequest', async (request, reply) => {
    const key = routeKey(request.method, request.routeOptions.url ?? '')
    if (Object.hasOwn(names, key)) return undefined
    request.log.error(`${key} has no audit name (0023, 0033)`)
    return reply.code(500).send({ code: 'unaudited-route', message: 'This route has no audit name, and does not answer.' })
  })

  if (sink === undefined) return
  const now = options.now ?? (() => new Date().toISOString())
  const codes = new WeakMap<FastifyRequest, string>()
  const written = new WeakSet<FastifyRequest>()
  /** Per connection, the requests whose answers wait on it, and its one `close` listener for all of them. */
  const waiting = new WeakMap<object, { requests: Map<FastifyRequest, FastifyReply>; close: () => void }>()

  /** Until its event is written, a request's connection going writes it. */
  const wait = (request: FastifyRequest, reply: FastifyReply): void => {
    const connection = request.raw.socket
    let entry = waiting.get(connection)
    if (entry === undefined) {
      const requests = new Map<FastifyRequest, FastifyReply>()
      entry = {
        requests,
        close: () => {
          for (const [each, answer] of requests) void emit(each, answer)
        },
      }
      waiting.set(connection, entry)
      connection.once('close', entry.close)
    }
    entry.requests.set(request, reply)
  }

  /** Written: the connection need not say so, and holds no listener once nothing on it waits. */
  const settle = (request: FastifyRequest): void => {
    const connection = request.raw.socket
    const entry = waiting.get(connection)
    if (entry === undefined || !entry.requests.delete(request) || entry.requests.size > 0) return
    connection.off('close', entry.close)
    waiting.delete(connection)
  }

  const emit = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (written.has(request)) return
    written.add(request)
    settle(request)
    // A route without a name was refused in onRequest, and the log says so; there is no event to name it by.
    const operation = names[routeKey(request.method, request.routeOptions.url ?? '')]
    if (operation === undefined) return
    const status = reply.statusCode
    try {
      const base = { at: now(), actor: request.identity?.actor.id ?? null, operation, status, outcome: status < 400 ? 'ok' : (codes.get(request) ?? `http-${String(status)}`) }
      await sink(describe(request, base))
    } catch (error) {
      request.log.error({ error: (error as Error).message }, 'an audit event could not be written')
    }
  }

  app.addHook('onSend', async (request, reply, payload) => {
    // The stable code of a refusal, read from the response itself.
    if (reply.statusCode >= 400 && typeof payload === 'string') {
      try {
        const code = (JSON.parse(payload) as { code?: unknown }).code
        if (typeof code === 'string') codes.set(request, code)
      } catch {
        // A body that is not JSON carries no code; the status says enough.
      }
    }
    if (reply.raw.destroyed || request.raw.socket.destroyed) {
      await emit(request, reply)
      return payload
    }
    wait(request, reply)
    return payload
  })

  app.addHook('onResponse', async (request, reply) => {
    await emit(request, reply)
  })
}
