/*
 * What the live demo's Worker answers itself, and what it lets through
 * between a visitor's browser and their server (0070).
 *
 * The Worker's own answers carry headers of their own, because the
 * `_headers` file is not applied to a response a Worker makes (Cloudflare's
 * static-assets documentation). A "not running" answer is the server's own
 * shape for "nothing was saved", `503 unavailable` with a sentence, which
 * data-client reads as a refusal (packages/data-client/src/writes.ts); a
 * forward that failed is a bare 502, which it reads as an unknown outcome
 * and never sends again (0031), since the request may have reached the
 * server.
 */
import { WRITE_ID_HEADER } from '@formancy/data-core'
import { IDLE_MINUTES, MAX_INSTANCES } from './limits.js'

/** On every answer the Worker makes: never cached, never sniffed, no referrer, and nothing loaded or framed. */
export const WORKER_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
})

/** `body` as JSON, with the Worker's headers and `headers` besides. */
export function jsonAnswer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...WORKER_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers } })
}

/** A path under the demo that is neither a file of the page nor one of the Worker's. */
export function notFound(): Response {
  return new Response('Not found.\n', { status: 404, headers: { ...WORKER_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
}

export function methodNotAllowed(allow: readonly string[]): Response {
  return jsonAnswer(405, { code: 'method-not-allowed', message: `This address answers ${allow.join(' and ')} only.` }, { Allow: allow.join(', ') })
}

/** Why a request reached no server: none runs for this visitor, either never started or stopped after its idle time. */
export const NOT_RUNNING = `No demo server is running for you: yours stops ${String(IDLE_MINUTES)} minutes after your last request, and what you changed goes with it. Sign out and choose a person to start a new one.`

/**
 * Why a sign-in started nothing. Every failed start reads the same, because
 * what Cloudflare answers when max_instances is reached is not documented
 * beyond "will error" and could not be measured locally: start() threw, or
 * the server did not answer /health within START_DEADLINE_MS.
 */
export const START_FAILED = `No demo server could be started just now. At most ${String(MAX_INSTANCES)} run at once, and Cloudflare may have had none to give; nothing was started for you. Try again in a few minutes.`

export function notRunning(): Response {
  return jsonAnswer(503, { code: 'unavailable', message: NOT_RUNNING })
}

export function startFailed(): Response {
  return jsonAnswer(503, { code: 'unavailable', message: START_FAILED })
}

/** A forward that threw: it may have reached the server, so it says nothing data-client could read as "nothing was saved". */
export function forwardFailed(): Response {
  return new Response(null, { status: 502, headers: WORKER_HEADERS })
}

/**
 * The request headers a visitor's server is sent, and no other: the token,
 * the body's type and what is asked back, the write id that answers a save
 * sent twice once (0031), and what the server's cross-site rule judges
 * (0060). Never the cookie, which routes to the instance and is the
 * Worker's, and never cf-* or x-forwarded-*: the container never learns a
 * visitor's address.
 */
export const FORWARDED_HEADERS = ['authorization', 'content-type', 'accept', WRITE_ID_HEADER, 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'] as const

/**
 * What a request whose body is a stream is built with, on a platform whose
 * Request has `prototype`: `duplex: 'half'` where the platform implements
 * the option -- Node's fetch refuses the body without it -- and nothing
 * where it does not, as workerd's RequestInit has no such member. Asked of
 * the platform, not assumed.
 */
export function streamingOption(prototype: object): { duplex?: 'half' } {
  return 'duplex' in prototype ? { duplex: 'half' } : {}
}

const STREAMED = streamingOption(Request.prototype)

/**
 * The browser's request as the visitor's server is sent it: at `path` on
 * the container's address, with its method and body, the allowlisted
 * headers and no redirect followed. The body streams through unread;
 * nothing is buffered and nothing retried (0015, 0031).
 */
export function forwardedRequest(request: Request, path: string): Request {
  const headers = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, redirect: 'manual' }
  if (request.body !== null) Object.assign(init, { body: request.body }, STREAMED)
  return new Request(`http://container${path}`, init)
}

/** What nginx adds to /v1/ in the composed stack (0032), added to every forwarded answer here for the same reasons. */
export const PAGE_SAFE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
})

/** The server's answer as it came -- status, body, its own headers, its no-store among them -- with PAGE_SAFE_HEADERS set over it. */
export function pageSafe(response: Response): Response {
  const answer = new Response(response.body, response)
  for (const [name, value] of Object.entries(PAGE_SAFE_HEADERS)) answer.headers.set(name, value)
  return answer
}
