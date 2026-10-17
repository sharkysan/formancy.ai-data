import type { Outcome, Refusal } from '@formancy/data-client'
import type { PersonaCard, SessionIndex } from '@formancy/data-live-demo/worker'

/*
 * The live demo's side of the host page (0070), for its build alone:
 * `main.tsx` takes it when Vite builds in the `demo` mode (`build:demo`),
 * and nothing else does.
 *
 * At formancy.ai/data/demo/ the page has no host behind it to supply a
 * token. The demo's Worker answers two requests beside the runtime plane:
 * who a visitor may sign in as, and a sign-in, which starts the visitor's
 * own server when none runs and answers a token for that person, signed
 * with the key the server was started with. The token then goes where a
 * host's would, into the one client's closure (0029). The shapes are the
 * Worker's own (`@formancy/data-live-demo/worker`, types only: nothing of
 * the Worker is bundled into the page), and each answer is checked against
 * them before it is believed, as data-client checks the server's.
 */

export type { PersonaCard, SessionIndex }

/** What a sign-in answers: the person's token, and when the server stops accepting it. */
export interface DemoToken {
  token: string
  /** Milliseconds since the epoch. */
  expiresAt: number
}

/** The demo's session, as the page asks its Worker for it. Never rejects: every answer is an outcome. */
export interface DemoSession {
  /** `GET {base}/session`: who a visitor may sign in as, and how long their server outlives their last request. */
  personas(): Promise<Outcome<SessionIndex>>
  /** `POST {base}/session` `{ persona }`: the visitor's own server started when none runs, and a token for that person. */
  signIn(persona: string): Promise<Outcome<DemoToken>>
}

const UNREACHABLE = 'The demo could not be reached.'
const UNEXPECTED = 'The demo did not answer in a way this page understands.'

/**
 * Where the demo's routes are, from the path the page was served at: the
 * directory it is in, without its last slash -- `/data/demo/` gives
 * `/data/demo`, the root of `vite preview` gives `''`. That directory is
 * what the page's own files are resolved against (`--base ./`), so one
 * build finds its routes beside its files wherever it is served, as the
 * examples page's relative build does (0069).
 */
export function demoBase(pathname: string): string {
  return pathname.slice(0, pathname.lastIndexOf('/'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPersonaCard(value: unknown): value is PersonaCard {
  return isRecord(value) && typeof value['id'] === 'string' && typeof value['name'] === 'string' && typeof value['description'] === 'string'
}

function isSessionIndex(value: unknown): value is SessionIndex {
  return isRecord(value) && Array.isArray(value['personas']) && value['personas'].every(isPersonaCard) && Number.isInteger(value['idleMinutes'])
}

function isDemoToken(value: unknown): value is DemoToken {
  return isRecord(value) && typeof value['token'] === 'string' && value['token'] !== '' && Number.isFinite(value['expiresAt'])
}

/** A refusal: the Worker's code and sentence when it gave them, and the page's words when what answered was not the Worker. */
function refusal(status: number, body: unknown): Refusal {
  if (isRecord(body) && typeof body['code'] === 'string' && typeof body['message'] === 'string') return { ok: false, status, code: body['code'], message: body['message'] }
  return { ok: false, status, code: 'unexpected', message: UNEXPECTED }
}

/**
 * The demo's session at `base`, through `fetch`. Each request is left in
 * fetch's default mode and credentials: a browser then sends the page's
 * Origin on the sign-in whatever the page's Referrer-Policy, which the
 * Worker requires, and the cookie naming the visitor's server, which it
 * routes by. The list of people is kept once it has answered -- they are
 * the Worker's constants -- and asked again after a failure.
 */
export function demoSession(fetch: typeof globalThis.fetch, base: string): DemoSession {
  async function ask<T>(init: RequestInit, read: (body: unknown) => body is T): Promise<Outcome<T>> {
    let response: Response
    try {
      response = await fetch(`${base}/session`, { ...init, redirect: 'manual' })
    } catch {
      return { ok: false, status: 0, code: 'unreachable', message: UNREACHABLE }
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    return response.ok && read(body) ? { ok: true, value: body } : refusal(response.status, response.ok ? undefined : body)
  }

  let people: SessionIndex | undefined
  return {
    personas: async () => {
      if (people !== undefined) return { ok: true, value: people }
      const answer = await ask({ method: 'GET', headers: { accept: 'application/json' } }, isSessionIndex)
      if (answer.ok) people = answer.value
      return answer
    },
    signIn: (persona) =>
      ask({ method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ persona }) }, isDemoToken),
  }
}
