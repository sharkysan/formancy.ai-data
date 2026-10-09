import type { DriftReport, FormPolicy, GeneratedForm, LookupChoice, MetadataSnapshot, ObjectRef, ServerIdentity } from '@formancy/data-core'
import type { HostIdentity, PublishedBundle } from '@formancy/data-server'
import type { FormSchema } from '@formancy/spec'

/**
 * The studio's whole vocabulary: the data server's administrator plane, and
 * `/v1/whoami` to show who a token says somebody is (0024).
 *
 * One function per route, and no route that is not one of these. The runtime
 * plane -- records and lookups -- is for the host application's people and is
 * not called from here, so publishing a form and writing a business record stay
 * different permissions all the way out to the screen (0020).
 *
 * The response types are the server's own exports and data-core's, never
 * restated: a shape the server changes is a type error here before it is a
 * blank pane.
 */

/** Why the server, or the network, said no. `problems` and `current` are carried when the server sends them. */
export interface Failure {
  ok: false
  /** The HTTP status, or 0 when nothing answered. */
  status: number
  /** The server's stable code (`forbidden`, `conflict`, `invalid-bundle`...), or the studio's own for a transport failure. */
  code: string
  /** A sentence, from the server when it sent one. */
  message: string
  /** Every reason a bundle cannot be published (422 `invalid-bundle`). */
  problems?: string[]
  /** The version somebody else published first (409 `conflict`). */
  current?: number | null
}

export type Outcome<T> = { ok: true; value: T } | Failure

/** What the studio asks the generator for: the body of `POST /v1/form-proposals`. */
export interface ProposalRequest {
  connection: string
  root: ObjectRef
  formId: string
  title: string
  lookups: LookupChoice[]
  pinned: string[]
  versionColumn?: string
}

/** A proposal: the generator's form, bindings and notes, and the snapshot to publish them with. */
export type Proposal = GeneratedForm & { snapshot: MetadataSnapshot }

/** A drift report, and the published version it was computed for. */
export type Drift = DriftReport & { version: number }

export interface Published {
  version: number
  bundle: PublishedBundle
}

export interface AdminClient {
  whoami(): Promise<Outcome<HostIdentity>>
  connections(): Promise<Outcome<string[]>>
  test(connection: string): Promise<Outcome<ServerIdentity>>
  metadata(connection: string): Promise<Outcome<MetadataSnapshot>>
  propose(request: ProposalRequest): Promise<Outcome<Proposal>>
  publish(formId: string, expectedBase: number | null, bundle: Bundle): Promise<Outcome<{ version: number }>>
  latest(formId: string): Promise<Outcome<Published>>
  drift(formId: string): Promise<Outcome<Drift>>
}

/** What the studio publishes: the four concerns of plan section 9, as the server's bundle. */
export interface Bundle {
  format: 1
  connection: string
  form: FormSchema
  bindings: Proposal['bindings']
  policy: FormPolicy
  snapshot: MetadataSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The server's refusal body, read for what it says and nothing assumed. */
function failure(status: number, body: unknown): Failure {
  if (!isRecord(body) || typeof body['message'] !== 'string') {
    return { ok: false, status, code: 'unexpected', message: `The server answered ${String(status)} with something that is not the data server's answer.` }
  }
  const problems = body['problems']
  const current = body['current']
  return {
    ok: false,
    status,
    code: typeof body['code'] === 'string' ? body['code'] : `http-${String(status)}`,
    message: body['message'],
    ...(Array.isArray(problems) ? { problems: problems.map(String) } : {}),
    ...(current === null || typeof current === 'number' ? { current } : {}),
  }
}

/** A path segment from a name the server gave or the person typed: encoded, so it is one segment. */
const segment = encodeURIComponent

/**
 * A client for one signed-in operator.
 *
 * The token is a closure variable and nothing else: not written to storage, a
 * cookie or the address, so it lives exactly as long as this tab's page does.
 * `fetch` is the browser's in the studio and the real server's, behind a fake,
 * in the suite.
 */
export function createAdminClient({ token, fetch, base = '' }: { token: string; fetch: typeof globalThis.fetch; base?: string }): AdminClient {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Outcome<T>> {
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      return { ok: false, status: 0, code: 'network', message: 'The data server could not be reached from this page.' }
    }
    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      parsed = undefined
    }
    if (!response.ok) return failure(response.status, parsed)
    if (parsed === undefined) return failure(response.status, undefined)
    return { ok: true, value: parsed as T }
  }

  return {
    whoami: () => call('GET', '/v1/whoami'),
    connections: async () => {
      const listed = await call<{ connections: string[] }>('GET', '/v1/connections')
      return listed.ok ? { ok: true, value: listed.value.connections } : listed
    },
    test: (connection) => call('POST', `/v1/connections/${segment(connection)}/test`),
    metadata: (connection) => call('GET', `/v1/connections/${segment(connection)}/metadata`),
    propose: (request) => call('POST', '/v1/form-proposals', request),
    publish: (formId, expectedBase, bundle) => call('POST', `/v1/forms/${segment(formId)}/versions`, { expectedBase, bundle }),
    latest: (formId) => call('GET', `/v1/forms/${segment(formId)}/versions/latest`),
    drift: (formId) => call('POST', `/v1/forms/${segment(formId)}/drift`),
  }
}
