import type { FieldError, FormRecord, LookupResult, LookupRow, PublishedForm } from '@formancy/data-core'

/*
 * One function per runtime route (0029), and the three decisions every host
 * would otherwise make again: where the token goes, how a name becomes a path,
 * and what an answer that is not a success says.
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
 *
 * Nothing is cached and nothing is retried. The server asks the policy on
 * every request (0022), and a write whose outcome is unknown is the host's to
 * reconcile, never the client's to send again (0015).
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
const UNEXPECTED = 'The data server did not answer in a way this client understands.'
const INVALID_NAME = 'A form or lookup name that is empty, "." or ".." cannot address a route.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/**
 * `name` as one path segment, or undefined when it cannot be one. `fetch`
 * resolves `.` and `..` before sending, so they would address a different
 * route; an empty segment would address the route above.
 */
function pathSegment(name: string): string | undefined {
  if (name === '' || name === '.' || name === '..') return undefined
  return encodeURIComponent(name)
}

function isFieldError(value: unknown): value is FieldError {
  return isRecord(value) && typeof value['field'] === 'string' && typeof value['code'] === 'string' && typeof value['message'] === 'string'
}

function isRows(value: unknown): value is LookupRow[] {
  return Array.isArray(value) && value.every((row) => isRecord(row) && typeof row['token'] === 'string' && typeof row['label'] === 'string')
}

/*
 * The shape each route answers with. Shallow on purpose: enough that a
 * captive portal's `{}` or a proxy's page is `unexpected` rather than an
 * empty form, without restating the server's validation of a document.
 */

function isPublishedForm(body: unknown): body is PublishedForm {
  return isRecord(body) && isRecord(body['form']) && isRecord(body['form']['model']) && Array.isArray(body['operations']) && Array.isArray(body['readable'])
}

function isFormRecord(body: unknown): body is FormRecord {
  return isRecord(body) && isNullableString(body['record']) && isNullableString(body['version']) && isRecord(body['answers'])
}

function isLookupResult(body: unknown): body is LookupResult {
  return isRecord(body) && isRows(body['rows']) && typeof body['hasMore'] === 'boolean' && typeof body['omitted'] === 'number'
}

function isResolved(body: unknown): body is { rows: LookupRow[] } {
  return isRecord(body) && isRows(body['rows'])
}

/** A non-2xx answer: the server's refusal when it carries a sentence, otherwise not the server's to have said. */
function refusalOf(status: number, body: unknown): Refusal {
  if (!isRecord(body) || typeof body['message'] !== 'string') return { ok: false, status, code: 'unexpected', message: UNEXPECTED }
  const code = typeof body['code'] === 'string' ? body['code'] : `http-${String(status)}`
  const refusal: Refusal = { ok: false, status, code, message: body['message'] }
  if (Array.isArray(body['fieldErrors'])) refusal.fieldErrors = body['fieldErrors'].filter(isFieldError)
  return refusal
}

/** The body as JSON, or undefined when it is not JSON. An abort while reading rethrows. */
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

interface Call<T> {
  method: 'GET' | 'POST'
  /** The names that become one segment each; the route is built only when every one can. */
  names: readonly string[]
  /** The route, from the names as segments, in order. */
  route: (segments: readonly string[]) => string
  body?: Record<string, unknown>
  /** The route's answer, read from what arrived; undefined when it is not that shape. */
  read: (body: unknown) => T | undefined
  signal?: AbortSignal | undefined
}

/**
 * A client of one data server's runtime plane. Every function resolves to an
 * Outcome and never rejects for an answer -- only for an abort the caller
 * asked for, which reaches it as the AbortError it raised.
 */
export function createDataClient(options: DataClientOptions) {
  const base = (options.base ?? '').replace(/\/+$/, '')
  const send = options.fetch ?? globalThis.fetch.bind(globalThis)

  async function call<T>(request: Call<T>): Promise<Outcome<T>> {
    const segments = request.names.map(pathSegment)
    if (segments.some((segment) => segment === undefined)) return { ok: false, status: 0, code: 'invalid-name', message: INVALID_NAME }
    const headers: Record<string, string> = { authorization: `Bearer ${await options.token()}`, accept: 'application/json' }
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
      return { ok: false, status: 0, code: 'unreachable', message: UNREACHABLE }
    }
    const body = await bodyOf(response, request.signal)
    if (response.status < 200 || response.status > 299) return refusalOf(response.status, body)
    const value = request.read(body)
    return value === undefined ? { ok: false, status: response.status, code: 'unexpected', message: UNEXPECTED } : { ok: true, value }
  }

  const asRecord = (body: unknown): FormRecord | undefined => (isFormRecord(body) ? body : undefined)
  const records = (formId: string, action: 'read' | 'create' | 'update', body: Record<string, unknown>): Promise<Outcome<FormRecord>> =>
    call({ method: 'POST', names: [formId], route: ([form]) => `/v1/forms/${String(form)}/records/${action}`, body, read: asRecord })
  const lookups = <T>(formId: string, source: string, action: 'query' | 'resolve', body: Record<string, unknown>, read: (body: unknown) => T | undefined, signal?: AbortSignal) =>
    call({ method: 'POST', names: [formId, source], route: ([form, name]) => `/v1/forms/${String(form)}/lookups/${String(name)}/${action}`, body, read, signal })

  return {
    /** `GET /v1/forms/:id`: the published document, the operations this person may use, and the fields they may read. */
    form: (formId: string): Promise<Outcome<PublishedForm>> =>
      call({ method: 'GET', names: [formId], route: ([form]) => `/v1/forms/${String(form)}`, read: (body) => (isPublishedForm(body) ? body : undefined) }),

    /** `POST …/records/read`: one record by its token, with the version an update sends back. */
    read: (formId: string, record: string): Promise<Outcome<FormRecord>> => records(formId, 'read', { record }),

    /** `POST …/records/create`: a new record from the answers; the reply is what was stored, in the stored spelling. */
    create: (formId: string, answers: Readonly<Record<string, unknown>>): Promise<Outcome<FormRecord>> => records(formId, 'create', { answers }),

    /**
     * `POST …/records/update`: saved only if the record is still at `version`,
     * otherwise 409 `stale`. Exactly the route's keys are sent, whatever else
     * the object passed carries.
     */
    update: (formId: string, change: { record: string; version: string; answers: Readonly<Record<string, unknown>> }): Promise<Outcome<FormRecord>> =>
      records(formId, 'update', { record: change.record, version: change.version, answers: change.answers }),

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
