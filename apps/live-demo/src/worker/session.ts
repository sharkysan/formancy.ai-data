/*
 * The live demo's session (0070): the personas a visitor may sign in as,
 * and the one request that starts a visitor's server -- a POST from the
 * demo's own page naming one of them. What a Durable Object answers a
 * sign-in with is said here too, so the Worker and anything that stands in
 * for its Durable Object answer the page alike.
 */
import { PERSONAS } from '../personas.js'
import type { Persona } from '../personas.js'
import type { TokenClaims } from '../token.js'
import { jsonAnswer, startFailed } from './answers.js'
import { instanceCookie } from './cookie.js'
import { IDLE_MINUTES, SIGN_IN_BYTES } from './limits.js'

/** What the page lists: each persona with the sentence that says what their role grants. */
export interface PersonaCard {
  id: string
  name: string
  description: string
}

/** `GET /data/demo/session`: who a visitor may be, and how long their server outlives their last request. */
export interface SessionIndex {
  personas: PersonaCard[]
  idleMinutes: number
}

/** What a Durable Object answers a sign-in with: a token for the persona, or that nothing could be started. */
export type SignInResult = { ok: true; token: string; expiresAt: number } | { ok: false }

export type SignInRequest = { ok: true; persona: Persona } | { ok: false; answer: Response }

export function sessionIndex(): SessionIndex {
  return { personas: PERSONAS.map(({ id, name, description }) => ({ id, name, description })), idleMinutes: IDLE_MINUTES }
}

/** What a persona's token says: their id as its subject, their roles and their tenant, which the server reads and nothing else. */
export function claimsFor(persona: Persona): TokenClaims {
  return { subject: persona.id, roles: persona.roles, tenant: persona.tenant }
}

export function personaById(id: string): Persona | undefined {
  return PERSONAS.find((persona) => persona.id === id)
}

const CROSS_ORIGIN = {
  code: 'cross-origin-refused',
  message: "A demo server is started only from the demo's own page, and this request did not come from it, so nothing was started.",
}
const MALFORMED = {
  code: 'malformed',
  message: `A sign-in is a JSON object naming one persona, {"persona": "<id>"}, in at most ${String(SIGN_IN_BYTES)} bytes.`,
}
const UNKNOWN = {
  code: 'unknown-persona',
  // "Clara, Otto or Vera": British English lists a choice without a comma before "or", as the rest of the page does.
  message: `The demo has no such person: sign in as ${new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(PERSONAS.map((persona) => persona.name))}.`,
}

/**
 * Whether `request` comes from the demo's own page: its Origin is the
 * request's own, its body is declared JSON -- which a form on another site
 * cannot send without a preflight this Worker never grants -- and a browser
 * that marks where a request came from marks it same-origin.
 */
function fromThePage(request: Request): boolean {
  const declared = request.headers.get('content-type') ?? ''
  const at = declared.indexOf(';')
  const type = (at === -1 ? declared : declared.slice(0, at)).trim().toLowerCase()
  const site = request.headers.get('sec-fetch-site')
  return request.headers.get('origin') === new URL(request.url).origin && type === 'application/json' && (site === null || site === 'same-origin')
}

/** The body as UTF-8 text, or undefined past `limit` bytes or for bytes that are not UTF-8: read no further than the limit, and the rest cancelled. */
async function bodyText(request: Request, limit: number): Promise<string | undefined> {
  if (request.body === null) return ''
  // The Workers types read a body as `any` chunks; a request body's are bytes.
  const reader = request.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > limit) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return undefined
  }
}

/** The one key of a sign-in's body, or undefined for anything else. */
function personaNamed(text: string): string | undefined {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const keys = Object.keys(body)
  const persona = (body as Record<string, unknown>)['persona']
  return keys.length === 1 && typeof persona === 'string' ? persona : undefined
}

/**
 * A sign-in, judged before anything is started: from the page, then a body
 * of at most SIGN_IN_BYTES that is `{ "persona": <id> }`, then a persona
 * the demo has. Each refusal is the Worker's own answer.
 */
export async function readSignIn(request: Request): Promise<SignInRequest> {
  if (!fromThePage(request)) return { ok: false, answer: jsonAnswer(403, CROSS_ORIGIN) }
  const text = await bodyText(request, SIGN_IN_BYTES)
  const id = text === undefined ? undefined : personaNamed(text)
  if (id === undefined) return { ok: false, answer: jsonAnswer(400, MALFORMED) }
  const persona = personaById(id)
  return persona === undefined ? { ok: false, answer: jsonAnswer(400, UNKNOWN) } : { ok: true, persona }
}

/**
 * The page's answer to a sign-in: the token and when it expires, with the
 * instance cookie when the Worker `made` the name for this request; or,
 * when nothing started, the start failure and no cookie, since there is
 * nothing to come back to.
 */
export function signInAnswer(result: SignInResult, made?: string): Response {
  if (!result.ok) return startFailed()
  return jsonAnswer(200, { token: result.token, expiresAt: result.expiresAt }, made === undefined ? {} : { 'Set-Cookie': instanceCookie(made) })
}
