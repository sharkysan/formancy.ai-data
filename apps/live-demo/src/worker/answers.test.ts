import { WRITE_ID_HEADER } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { FORWARDED_HEADERS, forwardedRequest, forwardFailed, jsonAnswer, methodNotAllowed, notFound, notRunning, pageSafe, startFailed, streamingOption, WORKER_HEADERS } from './answers.js'
import { IDLE_MINUTES, MAX_INSTANCES } from './limits.js'

/**
 * What the live demo's Worker answers itself, and what it lets through
 * between a visitor's browser and their server (0070). The Worker's own
 * answers are what a page fetch can meet, so each says what it is and is
 * cached and framed by nobody; what it forwards is the runtime plane's
 * request and nothing of the visitor's that the server does not read.
 */
describe("the Worker's own answers", () => {
  // Every answer the Worker makes carries these: _headers is not applied to
  // a response a Worker makes (Cloudflare's static-assets documentation),
  // so without them a refusal would be cached, sniffed or framed.
  test('carry no-store, nosniff, no-referrer and a policy that loads and frames nothing', async () => {
    const answers = [jsonAnswer(200, { a: 1 }), notFound(), methodNotAllowed(['GET', 'POST']), notRunning(), startFailed(), forwardFailed()]
    for (const answer of answers) {
      for (const [name, value] of Object.entries(WORKER_HEADERS)) expect(answer.headers.get(name), `${String(answer.status)} ${name}`).toBe(value)
    }
    expect(WORKER_HEADERS).toEqual({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    })
    expect(jsonAnswer(200, { a: 1 }).headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await jsonAnswer(200, { a: 1 }).json()).toEqual({ a: 1 })
    const missing = notFound()
    expect([missing.status, missing.headers.get('content-type'), await missing.text()]).toEqual([404, 'text/plain; charset=utf-8', 'Not found.\n'])
    const method = methodNotAllowed(['GET', 'POST'])
    expect([method.status, method.headers.get('allow')]).toEqual([405, 'GET, POST'])
    expect(await method.json()).toEqual({ code: 'method-not-allowed', message: 'This address answers GET and POST only.' })
  })

  // data-client reads a write's answer as "nothing was saved" only when it
  // is 4xx with a sentence, or 503 with code `unavailable`
  // (packages/data-client/src/writes.ts); anything else without the
  // server's sentence is an unknown write (0031). A stopped server saved
  // nothing, so it says so; the sentences are derived from the limits, so
  // the page cannot promise ten minutes while the code waits five.
  test("say that a stopped or unstarted server saved nothing, in data-client's words for it", async () => {
    const stopped = notRunning()
    expect(stopped.status).toBe(503)
    expect(await stopped.json()).toEqual({
      code: 'unavailable',
      message: `No demo server is running for you: yours stops ${String(IDLE_MINUTES)} minutes after your last request, and what you changed goes with it. Sign out and choose a person to start a new one.`,
    })
    const failed = startFailed()
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({
      code: 'unavailable',
      message: `No demo server could be started just now. At most ${String(MAX_INSTANCES)} run at once, and Cloudflare may have had none to give; nothing was started for you. Try again in a few minutes.`,
    })
  })

  // A forward that failed may have reached the server and saved: an
  // `unavailable` would tell the page nothing was saved when something may
  // have been. A bare 502, with no sentence, is what data-client reads as
  // an unknown outcome, never sent again.
  test('answer a failed forward with a bare 502, which data-client reads as an unknown outcome', async () => {
    const failed = forwardFailed()
    expect(failed.status).toBe(502)
    expect(await failed.text()).toBe('')
    expect(failed.headers.get('content-type')).toBeNull()
  })
})

describe('what the Worker forwards', () => {
  const browser = (init: RequestInit & { headers: Record<string, string> }): Request => new Request('https://formancy.ai/data/demo/v1/forms/order/records/create', init)

  // An allowlist, so nothing of the visitor's reaches their server but what
  // the runtime plane reads: the token, the body's type, the write id that
  // makes a save sent twice answered once (0031), and what the server's
  // cross-site rule judges (0060). Never the routing cookie, which is the
  // Worker's, and never an address: the container does not learn who is
  // visiting.
  test("sends the runtime plane its headers and nothing else of the browser's", () => {
    const sent = forwardedRequest(
      browser({
        method: 'POST',
        body: '{"values":{}}',
        headers: {
          authorization: 'Bearer t',
          'content-type': 'application/json',
          accept: 'application/json',
          [WRITE_ID_HEADER]: '0b8c4a52-5a07-4f3c-9d9e-6f1d3c2b1a00',
          origin: 'https://formancy.ai',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          cookie: '__Secure-formancy-data-demo=0123456789abcdef0123456789abcdef',
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': '203.0.113.7',
          'x-real-ip': '203.0.113.7',
          'user-agent': 'Mozilla/5.0',
          referer: 'https://formancy.ai/data/demo/',
        },
      }),
      '/v1/forms/order/records/create',
    )
    expect(Object.fromEntries(sent.headers)).toEqual({
      authorization: 'Bearer t',
      'content-type': 'application/json',
      accept: 'application/json',
      [WRITE_ID_HEADER]: '0b8c4a52-5a07-4f3c-9d9e-6f1d3c2b1a00',
      origin: 'https://formancy.ai',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    })
    expect([...FORWARDED_HEADERS]).toEqual(['authorization', 'content-type', 'accept', WRITE_ID_HEADER, 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'])
  })

  // The path routeOf made, on the container's own address; the method and
  // the body as sent; a redirect never followed, as data-client never
  // follows one.
  test('sends the method, the body and the path as given, to the container, following no redirect', async () => {
    const sent = forwardedRequest(browser({ method: 'POST', body: '{"values":{"notes":"Call first"}}', headers: { 'content-type': 'application/json' } }), '/v1/forms/order/records/create?x=1')
    expect([sent.method, sent.url, sent.redirect]).toEqual(['POST', 'http://container/v1/forms/order/records/create?x=1', 'manual'])
    expect(await sent.text()).toBe('{"values":{"notes":"Call first"}}')
    const read = forwardedRequest(new Request('https://formancy.ai/data/demo/v1/forms'), '/v1/forms')
    expect([read.method, read.body]).toEqual(['GET', null])
  })

  // Node refuses a streamed body without `duplex: 'half'`, and workerd's
  // RequestInit has no such member; each platform is given what it has.
  test("streams a body with duplex where the platform's Request has it, and without where it has not", () => {
    expect(streamingOption(Request.prototype)).toEqual({ duplex: 'half' })
    expect(streamingOption({})).toEqual({})
  })
})

describe('what the Worker sends back', () => {
  // The three headers nginx gives /v1/ in the composed stack (0032), over
  // the server's own: an answer the page fetches is still never sniffed,
  // never sends a referrer, and is framed by nobody. The server's status,
  // body and headers -- its no-store among them -- are kept.
  test("keeps the server's answer and adds what the composed stack's proxy adds", async () => {
    const answer = pageSafe(new Response('{"code":"forbidden","message":"No."}', { status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }))
    expect(answer.status).toBe(403)
    expect(await answer.json()).toEqual({ code: 'forbidden', message: 'No.' })
    expect(Object.fromEntries(answer.headers)).toEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    })
    expect(pageSafe(new Response(null, { status: 204 })).status).toBe(204)
  })
})
