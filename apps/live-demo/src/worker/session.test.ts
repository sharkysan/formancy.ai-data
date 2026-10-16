import { randomBytes } from 'node:crypto'
import { createIdentityVerifier } from '@formancy/data-server'
import { describe, expect, test } from 'vitest'
import { COOKIE_NAME, instanceCookie } from './cookie.js'
import { IDLE_MINUTES, SIGN_IN_BYTES } from './limits.js'
import { PERSONAS } from '../personas.js'
import { claimsFor, readSignIn, sessionIndex, signInAnswer } from './session.js'
import { AUDIENCE, ISSUER, mintToken, TENANT_CLAIM } from '../token.js'
import { WORKER_HEADERS } from './answers.js'

/**
 * The demo's session (0070): the personas a visitor may sign in as, read
 * from constants, and the one request that starts a visitor's server --
 * a POST from the demo's own page naming one of them. A link a crawler
 * follows, a form on another site and a GET of any path start nothing.
 */
const PAGE = 'https://formancy.ai'
const SESSION = `${PAGE}/data/demo/session`

function signIn(body: string | Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}): Request {
  return new Request(SESSION, { method: 'POST', body, headers: { origin: PAGE, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers } })
}

async function refusal(request: Request): Promise<{ status: number; body: unknown }> {
  const read = await readSignIn(request)
  if (read.ok) throw new Error('signed in')
  for (const [name, value] of Object.entries(WORKER_HEADERS)) expect(read.answer.headers.get(name), name).toBe(value)
  return { status: read.answer.status, body: await read.answer.json() }
}

describe('the session', () => {
  // The page's list of personas comes from the Worker, which knows them
  // from personas.ts: the same sentences the policy is derived beside, and
  // the idle time the Durable Object sets, not a copy of either.
  test("lists the personas and the idle time, from personas.ts and the Worker's limits", () => {
    expect(sessionIndex()).toEqual({
      personas: PERSONAS.map(({ id, name, description }) => ({ id, name, description })),
      idleMinutes: IDLE_MINUTES,
    })
    expect(sessionIndex().personas.map(({ id }) => id)).toEqual(['clara', 'otto', 'vera'])
  })

  test('reads a sign-in naming a known persona, sent from the page', async () => {
    for (const persona of PERSONAS) {
      const read = await readSignIn(signIn(JSON.stringify({ persona: persona.id })))
      expect(read).toEqual({ ok: true, persona })
    }
    // Sec-Fetch-Site is a browser's to send: a browser that sends none is
    // judged by its Origin and type alone, and a charset is still JSON.
    const read = await readSignIn(new Request(SESSION, { method: 'POST', body: '{"persona":"otto"}', headers: { origin: PAGE, 'content-type': 'application/json; charset=utf-8' } }))
    expect(read.ok).toBe(true)
  })

  // Each would let a page on another site, or a plain HTML form, start a
  // container for whoever visits it: a form can post text/plain or a
  // urlencoded body with no preflight, from any origin, and a browser marks
  // what another site sends. Refused before the body is read, and before
  // any Durable Object is reached.
  test.each([
    ['no Origin', { origin: '' }],
    ['another origin', { origin: 'https://evil.example' }],
    ['another scheme of the origin', { origin: 'http://formancy.ai' }],
    ['a subdomain', { origin: 'https://www.formancy.ai' }],
    ['a text/plain body, which a form posts without a preflight', { 'content-type': 'text/plain' }],
    ['a form body', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['no type', { 'content-type': '' }],
    ['a browser that marks it cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['a browser that marks it same-site', { 'sec-fetch-site': 'same-site' }],
    ['a browser that marks it as typed or bookmarked', { 'sec-fetch-site': 'none' }],
  ])('refuses a sign-in with %s', async (_name, headers) => {
    const request = signIn('{"persona":"clara"}', headers)
    for (const [name, value] of Object.entries(headers)) if (value === '') request.headers.delete(name)
    expect(await refusal(request)).toEqual({
      status: 403,
      body: { code: 'cross-origin-refused', message: "A demo server is started only from the demo's own page, and this request did not come from it, so nothing was started." },
    })
  })

  // The body is a few dozen bytes; a longer one is read no further than
  // the limit, so nobody makes the Worker hold a megabyte to refuse it.
  test.each([
    ['not JSON', 'persona=clara'],
    ['JSON that is not an object', '"clara"'],
    ['an object without a persona', '{}'],
    ['a persona that is not a string', '{"persona":1}'],
    ['more than the persona', '{"persona":"clara","roles":["admin"]}'],
    ['a body longer than the limit', JSON.stringify({ persona: 'clara', pad: 'x'.repeat(SIGN_IN_BYTES) })],
    ['a body longer than the limit, ending as a valid one', `${' '.repeat(SIGN_IN_BYTES)}{"persona":"clara"}`],
    ['bytes that are not UTF-8', new Uint8Array([0x7b, 0x22, 0x70, 0xff, 0x22, 0x7d])],
  ])('refuses a sign-in that is %s', async (_name, body) => {
    expect(await refusal(signIn(body))).toEqual({
      status: 400,
      body: { code: 'malformed', message: `A sign-in is a JSON object naming one persona, {"persona": "<id>"}, in at most ${String(SIGN_IN_BYTES)} bytes.` },
    })
  })

  // A POST with no body at all names nobody either.
  test('refuses a sign-in with no body', async () => {
    const request = new Request(SESSION, { method: 'POST', headers: { origin: PAGE, 'content-type': 'application/json' } })
    expect((await refusal(request)).body).toEqual({ code: 'malformed', message: `A sign-in is a JSON object naming one persona, {"persona": "<id>"}, in at most ${String(SIGN_IN_BYTES)} bytes.` })
  })

  // A persona is chosen from the list, never made up: a role or a tenant
  // the page could name would be a token for whatever it named.
  test('refuses a persona the demo does not have', async () => {
    for (const persona of ['admin', 'Clara', '', 'clara ']) {
      expect(await refusal(signIn(JSON.stringify({ persona })))).toEqual({
        status: 400,
        body: { code: 'unknown-persona', message: 'The demo has no such person: sign in as Clara, Otto or Vera.' },
      })
    }
  })

  // A body read in full before the limit is checked would be held however
  // long it is. Read as a stream, the Worker stops at the limit and cancels
  // the rest.
  test('stops reading a body at the limit', async () => {
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(256).fill(0x20))
      },
    })
    const request = new Request(SESSION, { method: 'POST', body: endless, headers: { origin: PAGE, 'content-type': 'application/json' }, duplex: 'half' } as RequestInit)
    expect((await refusal(request)).status).toBe(400)
    expect(pulled).toBeLessThan(SIGN_IN_BYTES / 256 + 4)
  })
})

describe('a sign-in answer', () => {
  const KEY = randomBytes(32).toString('base64url')

  // What the Durable Object signs for a persona is what the server reads
  // as that persona: their id, their roles, their tenant.
  test("signs each persona's token as the server reads that persona", async () => {
    const verify = await createIdentityVerifier({ key: { kind: 'secret', secret: KEY }, issuer: ISSUER, audience: AUDIENCE, attributes: { tenant: TENANT_CLAIM } })
    for (const persona of PERSONAS) {
      const { token } = await mintToken(KEY, claimsFor(persona))
      expect(await verify(token)).toEqual({ ok: true, identity: { actor: { id: persona.id, roles: [...persona.roles] }, attributes: { tenant: String(persona.tenant) } } })
    }
  })

  // The token goes to the page's memory and nowhere else (0029); the cookie
  // is set only when the Worker made a name, so a second tab keeps the
  // first one's instance.
  test('is the token and its expiry, with the cookie only when a name was made', async () => {
    const made = signInAnswer({ ok: true, token: 't', expiresAt: 1 }, '0123456789abcdef0123456789abcdef')
    expect([made.status, await made.json()]).toEqual([200, { token: 't', expiresAt: 1 }])
    expect(made.headers.get('set-cookie')).toBe(instanceCookie('0123456789abcdef0123456789abcdef'))
    expect(made.headers.get('cache-control')).toBe('no-store')
    const kept = signInAnswer({ ok: true, token: 't', expiresAt: 1 })
    expect(kept.status).toBe(200)
    expect(kept.headers.get('set-cookie')).toBeNull()
    expect(made.headers.get('set-cookie')).toContain(COOKIE_NAME)
  })

  // A start that failed leaves nothing for the visitor to come back to, so
  // no cookie names it: the next try makes a new name.
  test('is the start failure, with no cookie, when nothing started', async () => {
    const failed = signInAnswer({ ok: false }, '0123456789abcdef0123456789abcdef')
    expect(failed.status).toBe(503)
    expect(((await failed.json()) as { code: string }).code).toBe('unavailable')
    expect(failed.headers.get('set-cookie')).toBeNull()
  })
})
