import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { PREFIX, readSignIn, sessionIndex, START_FAILED } from '@formancy/data-live-demo/worker'
import { demoBase, demoSession } from './demo.js'
import { DEMO_ORIGIN, demoDoor } from './test-demo.js'
import type { DemoDoor } from './test-demo.js'

/*
 * The page's half of the live demo's session (0070): where the demo's
 * routes are, read off the page's own address, and its two requests to the
 * Worker -- who may sign in, and a sign-in -- answered by the Worker's own
 * code in front of a stand-in for the visitor's instance (test-demo.ts).
 * Nothing here reaches a server: a session is the Worker's alone, and a
 * request that went further would fail the test.
 */

const nowhere: typeof fetch = async () => {
  throw new Error('a session request reached the server')
}

/** The demo's Worker with nothing behind it: a sign-in mints a token, and nothing is forwarded. */
const door = (): DemoDoor => demoDoor({ fetch: nowhere, demoKey: randomBytes(32).toString('base64url') })

/** One request as `fetch` was handed it, URL and init alike, and a `fetch` that records them before passing them on. */
function recording(fetch: typeof globalThis.fetch): { fetch: typeof globalThis.fetch; inits: Array<RequestInit | undefined> } {
  const inits: Array<RequestInit | undefined> = []
  return {
    inits,
    fetch: (input, init) => {
      inits.push(init)
      return fetch(input, init)
    },
  }
}

describe('where the demo is', () => {
  // The page's files are asked for relative to the page (`--base ./`), so
  // its routes must be beside them: the directory the page was served from,
  // without its last slash, which data-client prefixes to every route. A
  // base of formancy.ai's root would send the token to formancy.ai's own
  // site; one keeping its slash would ask for `/data/demo//session`, which
  // the Worker does not route.
  test('is the directory the page was served from, as its relative files are resolved', () => {
    const pages = [`${PREFIX}/`, `${PREFIX}/index.html`, '/', '/index.html', '/a/b/c/']
    const resolved = (pathname: string): string => new URL('.', `${DEMO_ORIGIN}${pathname}`).pathname.replace(/\/$/, '')
    expect(pages.map(demoBase)).toEqual(pages.map(resolved))
    // At its address on formancy.ai, the base is the Worker's own prefix;
    // under `vite preview`, at the root, it is no base at all.
    expect([demoBase(`${PREFIX}/`), demoBase('/')]).toEqual([PREFIX, ''])
  })
})

describe('the session', () => {
  // The personas and the idle time are the Worker's constants: a page that
  // listed people of its own would offer sign-ins the Worker refuses.
  test("lists the Worker's people, asked once with a GET that carries no token", async () => {
    const worker = door()
    const session = demoSession(worker.fetch, PREFIX)
    expect(await session.personas()).toEqual({ ok: true, value: sessionIndex() })
    // Sign out shows the people again; they are not asked for again, since
    // the Worker answers constants.
    expect(await session.personas()).toEqual({ ok: true, value: sessionIndex() })
    expect(worker.sent.map((sent) => [sent.method, sent.path, sent.headers['authorization'], sent.body])).toEqual([['GET', `${PREFIX}/session`, undefined, undefined]])
  })

  // A sign-in is the one request that starts a visitor's server, so the
  // Worker takes it only as the page sends it: a JSON body naming the
  // persona, and the page's Origin, which a browser sends on a POST of its
  // own origin in fetch's default mode whatever the page's Referrer-Policy.
  // In mode `same-origin`, under the page's `no-referrer`, a browser sends
  // `Origin: null` instead (Fetch, "append a request Origin header"), and
  // every sign-in would be refused in a browser while passing here; with
  // credentials omitted, the cookie naming the visitor's server would not
  // go with it. So the request names neither.
  test("signs in with one POST naming the persona, in fetch's default mode, and answers the Worker's token", async () => {
    const worker = door()
    const spied = recording(worker.fetch)
    const signedIn = await demoSession(spied.fetch, PREFIX).signIn('clara')
    expect(signedIn).toEqual({ ok: true, value: { token: worker.tokens[0], expiresAt: expect.any(Number) as number } })
    expect(worker.sent.map((sent) => ({ method: sent.method, path: sent.path, type: sent.headers['content-type'], authorization: sent.headers['authorization'], body: sent.body }))).toEqual([
      { method: 'POST', path: `${PREFIX}/session`, type: 'application/json', authorization: undefined, body: JSON.stringify({ persona: 'clara' }) },
    ])
    expect(spied.inits.map((init) => [init?.mode, init?.credentials])).toEqual([[undefined, undefined]])
  })

  // A refusal is the Worker's code and sentence, as data-client gives the
  // server's: a page that said "something went wrong" would leave a visitor
  // unable to tell a full house from a page that sent nonsense.
  test("a refusal is the Worker's code and sentence, verbatim", async () => {
    const worker = door()
    const session = demoSession(worker.fetch, PREFIX)
    const unknown = await readSignIn(new Request(`${DEMO_ORIGIN}${PREFIX}/session`, { method: 'POST', headers: { origin: DEMO_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ persona: 'nobody' }) }))
    if (unknown.ok) throw new Error('the Worker took a persona it does not have')
    expect(await session.signIn('nobody')).toEqual({ ok: false, status: 400, ...((await unknown.answer.json()) as object) })
    worker.failNextStart()
    expect(await session.signIn('clara')).toEqual({ ok: false, status: 503, code: 'unavailable', message: START_FAILED })
  })

  // What did not come from the Worker says so in the page's words, and
  // never as a token: a page served without its Worker -- `vite preview`,
  // or a route that lost its Worker -- answers the session with a 404 page.
  test('nothing answering, or an answer that is not the Worker’s, is said as such', async () => {
    const thrown = demoSession(async () => {
      throw new TypeError('Failed to fetch')
    }, PREFIX)
    expect(await thrown.personas()).toEqual({ ok: false, status: 0, code: 'unreachable', message: 'The demo could not be reached.' })
    expect(await thrown.signIn('clara')).toEqual({ ok: false, status: 0, code: 'unreachable', message: 'The demo could not be reached.' })
    const answering = (status: number, body: string): typeof fetch => async () => new Response(body, { status, headers: { 'content-type': 'text/html' } })
    const unexpected = { ok: false, code: 'unexpected', message: 'The demo did not answer in a way this page understands.' }
    expect(await demoSession(answering(404, '<!doctype html><p>Not found'), PREFIX).personas()).toEqual({ ...unexpected, status: 404 })
    expect(await demoSession(answering(200, '{"personas":[{"id":"clara"}],"idleMinutes":10}'), PREFIX).personas()).toEqual({ ...unexpected, status: 200 })
    expect(await demoSession(answering(200, '{"token":"","expiresAt":1}'), PREFIX).signIn('clara')).toEqual({ ...unexpected, status: 200 })
    expect(await demoSession(answering(200, '{"token":"a.b.c"}'), PREFIX).signIn('clara')).toEqual({ ...unexpected, status: 200 })
  })

  // A failed list is asked again: kept, it would leave the visitor with no
  // one to sign in as until they reloaded.
  test('a list that failed is asked for again', async () => {
    const worker = door()
    let fail = true
    const session = demoSession(async (input, init) => {
      if (fail) throw new TypeError('Failed to fetch')
      return worker.fetch(input, init)
    }, PREFIX)
    expect((await session.personas()).ok).toBe(false)
    fail = false
    expect(await session.personas()).toEqual({ ok: true, value: sessionIndex() })
  })
})
