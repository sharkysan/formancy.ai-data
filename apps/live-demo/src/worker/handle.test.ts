import { WRITE_ID_HEADER } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { NOT_RUNNING, START_FAILED } from './answers.js'
import { COOKIE_NAME, instanceCookie, newInstanceName } from './cookie.js'
import { handle } from './handle.js'
import type { DemoInstance } from './handle.js'
import { sessionIndex } from './session.js'
import type { SignInResult } from './session.js'

/**
 * The live demo's Worker as a visitor's browser meets it (0070): which
 * requests reach the visitor's own instance -- their Durable Object, and
 * through it their container -- under which name, and what comes back.
 * The instance here records what it is asked and answers as it is told;
 * the Durable Object that answers on Cloudflare is worker.ts, held by
 * review, and the server behind it is the real one in the host page's
 * tests and the image's gate.
 */
const PAGE = 'https://formancy.ai'

interface Asked {
  names: string[]
  signIns: string[]
  forwarded: Request[]
}

function instances(options: { signIn?: () => Promise<SignInResult>; fetch?: (request: Request) => Promise<Response> } = {}) {
  const asked: Asked = { names: [], signIns: [], forwarded: [] }
  const named = (name: string): DemoInstance => {
    asked.names.push(name)
    return {
      signIn: async (persona) => {
        asked.signIns.push(persona)
        return (options.signIn ?? (async () => ({ ok: true, token: `token-of-${persona}`, expiresAt: 42 })))()
      },
      fetch: async (request) => {
        asked.forwarded.push(request)
        return (
          options.fetch ??
          (async () => new Response('{"forms":[]}', { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }))
        )(request)
      },
    }
  }
  return { asked, named }
}

const signIn = (persona: string, headers: Record<string, string> = {}): Request =>
  new Request(`${PAGE}/data/demo/session`, {
    method: 'POST',
    body: JSON.stringify({ persona }),
    headers: { origin: PAGE, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
  })

const api = (path: string, headers: Record<string, string> = {}, init: RequestInit = {}): Request =>
  new Request(`${PAGE}/data/demo${path}`, { ...init, headers })

describe('the Worker', () => {
  // Listing the personas is a constant: no Durable Object is created and
  // no container started for a page view, a crawler or a prefetch.
  test('answers the session list from constants, reaching no instance', async () => {
    const { asked, named } = instances()
    const answer = await handle(api('/session'), named)
    expect([answer.status, await answer.json()]).toEqual([200, sessionIndex()])
    expect(asked.names).toEqual([])
  })

  // A first sign-in makes the visitor a name, reaches the instance of that
  // name, and sets the cookie that sends their next requests to it.
  test('signs a first visitor in on an instance of a new name, and sets the cookie naming it', async () => {
    const { asked, named } = instances()
    const answer = await handle(signIn('clara'), named)
    expect([answer.status, await answer.json()]).toEqual([200, { token: 'token-of-clara', expiresAt: 42 }])
    expect(asked.signIns).toEqual(['clara'])
    expect(asked.names).toHaveLength(1)
    expect(asked.names[0]).toMatch(/^[0-9a-f]{32}$/)
    expect(answer.headers.get('set-cookie')).toBe(instanceCookie(asked.names[0] ?? ''))
  })

  // A visitor who has a name keeps it: switching persona, or a second tab,
  // signs in on the same instance and the same data, and sets nothing.
  test('signs a returning visitor in on the instance their cookie names, setting nothing', async () => {
    const { asked, named } = instances()
    const name = newInstanceName()
    const answer = await handle(signIn('vera', { cookie: `${COOKIE_NAME}=${name}` }), named)
    expect(answer.status).toBe(200)
    expect(asked.names).toEqual([name])
    expect(answer.headers.get('set-cookie')).toBeNull()
  })

  // A sign-in the session refuses -- from another site, or naming nobody --
  // reaches no instance, so it starts nothing and creates no Durable Object.
  test('reaches no instance for a refused sign-in', async () => {
    const { asked, named } = instances()
    expect((await handle(signIn('clara', { origin: 'https://evil.example' }), named)).status).toBe(403)
    expect((await handle(signIn('admin'), named)).status).toBe(400)
    expect(asked.names).toEqual([])
  })

  // What the page shows when Cloudflare had nothing to give, or the
  // Durable Object itself failed: the start failure, and no cookie naming
  // an instance that holds nothing.
  test('answers a start that failed, or an instance that threw, with the start failure and no cookie', async () => {
    for (const signInOf of [
      async (): Promise<SignInResult> => ({ ok: false }),
      async (): Promise<SignInResult> => Promise.reject(new Error('Durable Object reset')),
    ]) {
      const { named } = instances({ signIn: signInOf })
      const answer = await handle(signIn('otto'), named)
      expect([answer.status, await answer.json()]).toEqual([503, { code: 'unavailable', message: START_FAILED }])
      expect(answer.headers.get('set-cookie')).toBeNull()
    }
  })

  // The runtime plane's request reaches the visitor's own instance, at the
  // server's path, with what the server reads and nothing else; the answer
  // comes back as the server gave it, with the proxy's three headers.
  test("forwards the runtime plane's requests to the instance the cookie names, and its answer back", async () => {
    const { asked, named } = instances()
    const name = newInstanceName()
    const answer = await handle(
      api(
        '/v1/forms/order/records/create',
        {
          cookie: `${COOKIE_NAME}=${name}`,
          authorization: 'Bearer t',
          'content-type': 'application/json',
          [WRITE_ID_HEADER]: 'w-1',
          'x-forwarded-for': '203.0.113.7',
        },
        { method: 'POST', body: '{"values":{}}' },
      ),
      named,
    )
    expect(asked.names).toEqual([name])
    const sent = asked.forwarded[0]
    expect([sent?.method, sent?.url]).toEqual(['POST', 'http://container/v1/forms/order/records/create'])
    expect(Object.fromEntries(sent?.headers ?? [])).toEqual({ authorization: 'Bearer t', 'content-type': 'application/json', [WRITE_ID_HEADER]: 'w-1' })
    expect(await sent?.text()).toBe('{"values":{}}')
    expect([answer.status, await answer.json()]).toEqual([200, { forms: [] }])
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(answer.headers.get('x-frame-options')).toBe('DENY')
  })

  // A visitor with no name has no server: told so without a Durable Object
  // being created for a name nobody was given.
  test('answers a request with no cookie, or one of another shape, as no server running, reaching no instance', async () => {
    const { asked, named } = instances()
    for (const headers of [{}, { cookie: `${COOKIE_NAME}=everyone` }]) {
      const answer = await handle(api('/v1/forms', { authorization: 'Bearer t', ...headers }), named)
      expect([answer.status, await answer.json()]).toEqual([503, { code: 'unavailable', message: NOT_RUNNING }])
    }
    expect(asked.names).toEqual([])
  })

  // A forward that threw may have reached the server: a bare 502, which
  // data-client reads as an unknown outcome, never "nothing was saved".
  test('answers a forward that threw with a bare 502', async () => {
    const { named } = instances({ fetch: async () => Promise.reject(new Error('Network connection lost')) })
    const answer = await handle(api('/v1/forms/order/records/delete', { cookie: `${COOKIE_NAME}=${newInstanceName()}` }, { method: 'POST', body: '{}' }), named)
    expect([answer.status, await answer.text()]).toEqual([502, ''])
  })

  // Everything else that reaches the Worker -- a file the page does not
  // have, the rest of /v1/, a method the plane has not -- is answered
  // without an instance.
  test('answers other paths 404 and other methods 405, reaching no instance', async () => {
    const { asked, named } = instances()
    const cookie = { cookie: `${COOKIE_NAME}=${newInstanceName()}` }
    expect((await handle(api('/nope.js', cookie), named)).status).toBe(404)
    expect((await handle(api('/v1/connections', cookie), named)).status).toBe(404)
    expect((await handle(api('/v1/forms/order', cookie, { method: 'DELETE' }), named)).status).toBe(405)
    expect((await handle(api('/session', cookie, { method: 'PUT' }), named)).status).toBe(405)
    expect(asked.names).toEqual([])
  })
})
