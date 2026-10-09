import { WRITE_ID_HEADER } from '@formancy/data-core'
import type { FieldError, FormRecord, LookupResult, LookupRow, PublishedForm } from '@formancy/data-core'
import { reconcile } from './reconcile.js'
import type { Reconciliation } from './reconcile.js'
import { isFormRecord, isLookupResult, isPublishedForm, isResolved, refusalOf, UNEXPECTED } from './shapes.js'
import { writeOutcome } from './writes.js'
import type { UnknownWrite, WriteAnswer, WriteIntent, WriteOutcome } from './writes.js'

/*
 * One function per runtime route (0029), and the decisions every host would
 * otherwise make again: where the token goes, how a name becomes a path, what
 * an answer that is not a success says, and what a write's lost answer is.
 *
 * - **The token** is asked of the host once per request and sent in the
 *   Authorization header and nowhere else: never a query string, which is in
 *   every proxy's log, never a body, which is in every request dump.
 * - **A name** -- a form id, a source -- is one encoded path segment. `.` and
 *   `..` survive `encodeURIComponent` and are resolved away by `fetch`, so they
 *   are refused before anything is sent: `form('..')` would be `GET /v1/`.
 * - **A refusal** is the server's code and sentence, verbatim. The client adds
 *   words only when the server said none: nothing answered (`unreachable`), or
 *   what answered was not the data server's shape (`unexpected`).
 * - **A write** is known only when the data server says what happened to it.
 *   Its answer lost -- by the database, said in the server's 502, or between
 *   the page and the server -- it is an `UnknownWrite`, not a refusal, and
 *   `reconcile` reads what it addressed (0031). Each write carries a new
 *   write id, so a copy the browser itself sends again -- Chromium does, on a
 *   reused connection that closed before any answer -- is answered by the
 *   server with the first one's answer instead of being applied twice.
 *
 * Nothing is cached and nothing is retried. The server asks the policy on
 * every request (0022), and a write whose outcome is unknown is the host's to
 * reconcile, never the client's to send again (0015, 0031).
 */

export interface DataClientOptions {
  /** Called once per request. The host's session owns it; it is never stored, and never in a URL or a body. */
  token: () => string | Promise<string>
  /** Prefixed to every route. Default `''`: the page's own origin, which the server requires, having no CORS (0024). */
  base?: string
  /** Default the global `fetch`, bound. */
  fetch?: typeof fetch
}

/**
 * Why a call did not succeed. `status` is the HTTP status, or 0 when nothing
 * answered or nothing was sent. `code` and `message` are the server's when it
 * gave them; `fieldErrors` is present when the refusal concerns fields.
 */
export type Refusal = { ok: false; status: number; code: string; message: string; fieldErrors?: FieldError[] }
export type Outcome<T> = { ok: true; value: T } | Refusal

/** The operation a form is open for, which decides the policy's lookup filter. Never the document's to say. */
export type LookupOperation = 'read' | 'create' | 'update'

const UNREACHABLE = 'The data server could not be reached.'
const INVALID_NAME = 'A form or lookup name that is empty, "." or ".." cannot address a route.'

/**
 * `name` as one path segment, or undefined when it cannot be one. `fetch`
 * resolves `.` and `..` before sending, so they would address a different
 * route; an empty segment would address the route above.
 */
function pathSegment(name: string): string | undefined {
  if (name === '' || name === '.' || name === '..') return undefined
  return encodeURIComponent(name)
}

/** The body as JSON, or undefined when it is not JSON or could not be read. An abort while reading rethrows. */
async function bodyOf(response: Response, signal: AbortSignal | undefined): Promise<unknown> {
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    if (signal?.aborted === true) throw error
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

interface Request {
  method: 'GET' | 'POST'
  /** The names that become one segment each; the route is built only when every one can. */
  names: readonly string[]
  /** The route, from the names as segments, in order. */
  route: (segments: readonly string[]) => string
  body?: Record<string, unknown>
  signal?: AbortSignal | undefined
  /** Sent beside the token and the content type: a write's id. */
  headers?: Record<string, string>
}

/**
 * The base without the slashes it ends in, by walking back from the end.
 * `/\/+$/` did the same and CodeQL flagged it (js/polynomial-redos): on a
 * base of many slashes not at the end, the anchored pattern backtracks.
 */
function withoutTrailingSlashes(base: string): string {
  let end = base.length
  while (end > 0 && base[end - 1] === '/') end -= 1
  return base.slice(0, end)
}

/**
 * A new write id: 128 random bits as hex, from `crypto.getRandomValues`,
 * which a page served over plain HTTP has too, unlike `randomUUID`.
 */
function newWriteId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** What one request came to: a name that is no segment (nothing sent), nothing answered, or a status and its JSON body. */
type Exchange = { sent: false } | WriteAnswer

/**
 * A client of one data server's runtime plane. Every function resolves to an
 * outcome and never rejects for an answer -- only for an abort the caller
 * asked for, which reaches it as the AbortError it raised.
 */
export function createDataClient(options: DataClientOptions) {
  const base = withoutTrailingSlashes(options.base ?? '')
  const send = options.fetch ?? globalThis.fetch.bind(globalThis)

  /** The transport: the request sent once, and what came back. Classifying it is the caller's. */
  async function exchange(request: Request): Promise<Exchange> {
    const segments = request.names.map(pathSegment)
    if (segments.some((segment) => segment === undefined)) return { sent: false }
    const headers: Record<string, string> = { ...request.headers, authorization: `Bearer ${await options.token()}`, accept: 'application/json' }
    if (request.body !== undefined) headers['content-type'] = 'application/json'
    let response: Response
    try {
      response = await send(`${base}${request.route(segments as string[])}`, {
        method: request.method,
        headers,
        // The runtime plane never redirects; following one would carry the token to another route, or another host.
        redirect: 'manual',
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      if (request.signal?.aborted === true) throw error
      return { answered: false }
    }
    return { answered: true, status: response.status, body: await bodyOf(response, request.signal) }
  }

  const invalidName: Refusal = { ok: false, status: 0, code: 'invalid-name', message: INVALID_NAME }

  /** A read: changes nothing, so an answer that went wrong is a refusal, and asking again is safe (0029). */
  async function call<T>(request: Request & { read: (body: unknown) => T | undefined }): Promise<Outcome<T>> {
    const answer = await exchange(request)
    if ('sent' in answer) return invalidName
    if (!answer.answered) return { ok: false, status: 0, code: 'unreachable', message: UNREACHABLE }
    if (answer.status < 200 || answer.status > 299) return refusalOf(answer.status, answer.body)
    const value = request.read(answer.body)
    return value === undefined ? { ok: false, status: answer.status, code: 'unexpected', message: UNEXPECTED } : { ok: true, value }
  }

  /** A write: known only when the data server says what happened; otherwise unknown, and never sent again (0031). */
  async function write(formId: string, intent: WriteIntent, body: Record<string, unknown>): Promise<WriteOutcome> {
    const answer = await exchange({
      method: 'POST',
      names: [formId],
      route: ([form]) => `/v1/forms/${String(form)}/records/${intent.operation}`,
      body,
      // New for every call: one id on two saves would answer the second with the first's answer.
      headers: { [WRITE_ID_HEADER]: newWriteId() },
    })
    // Nothing was sent: a refusal like any other.
    if ('sent' in answer) return invalidName
    return writeOutcome(answer, intent)
  }

  const read = (formId: string, record: string): Promise<Outcome<FormRecord>> =>
    call({ method: 'POST', names: [formId], route: ([form]) => `/v1/forms/${String(form)}/records/read`, body: { record }, read: (body) => (isFormRecord(body) ? body : undefined) })
  const lookups = <T>(formId: string, source: string, action: 'query' | 'resolve', body: Record<string, unknown>, read: (body: unknown) => T | undefined, signal?: AbortSignal) =>
    call({ method: 'POST', names: [formId, source], route: ([form, name]) => `/v1/forms/${String(form)}/lookups/${String(name)}/${action}`, body, read, signal })

  return {
    /** `GET /v1/forms/:id`: the published document, the operations this person may use, and the fields they may read. */
    form: (formId: string): Promise<Outcome<PublishedForm>> =>
      call({ method: 'GET', names: [formId], route: ([form]) => `/v1/forms/${String(form)}`, read: (body) => (isPublishedForm(body) ? body : undefined) }),

    /** `POST …/records/read`: one record by its token, with the version an update sends back. */
    read,

    /**
     * `POST …/records/create`: a new record from the answers; the reply is what
     * was stored, in the stored spelling -- or an `UnknownWrite` when nobody
     * can say whether it was stored.
     */
    create: (formId: string, answers: Readonly<Record<string, unknown>>): Promise<WriteOutcome> =>
      write(formId, { operation: 'create', record: null, version: null }, { answers }),

    /**
     * `POST …/records/update`: saved only if the record is still at `version`,
     * otherwise 409 `stale`; an `UnknownWrite` when nobody can say whether it
     * was saved. Exactly the route's keys are sent, whatever else the object
     * passed carries.
     */
    update: (formId: string, change: { record: string; version: string; answers: Readonly<Record<string, unknown>> }): Promise<WriteOutcome> =>
      write(formId, { operation: 'update', record: change.record, version: change.version }, { record: change.record, version: change.version, answers: change.answers }),

    /** Reads what an unknown write addressed and says what that shows; never sends the write again (0031). */
    reconcile: (formId: string, unknown: UnknownWrite): Promise<Reconciliation> => reconcile(read, formId, unknown),

    /** `POST …/lookups/:source/query`: one page of the options this person may pick for this operation. */
    query: (
      formId: string,
      source: string,
      q: { operation: LookupOperation; search: string; offset?: number; limit?: number },
      signal?: AbortSignal,
    ): Promise<Outcome<LookupResult>> =>
      lookups(formId, source, 'query', { operation: q.operation, search: q.search, offset: q.offset, limit: q.limit }, (body) => (isLookupResult(body) ? body : undefined), signal),

    /** `POST …/lookups/:source/resolve`: the labels of the tokens this person may see; any other is absent, not an error. */
    resolve: (formId: string, source: string, r: { operation: LookupOperation; tokens: readonly string[] }, signal?: AbortSignal): Promise<Outcome<LookupRow[]>> =>
      lookups(formId, source, 'resolve', { operation: r.operation, tokens: r.tokens }, (body) => (isResolved(body) ? body.rows : undefined), signal),
  }
}

/** A client of one data server's runtime plane: what `createDataClient` returns. */
export type DataClient = ReturnType<typeof createDataClient>
