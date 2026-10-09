import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { createDataClient } from './client.js'

/*
 * What the client says when the data server is not the one answering: nothing
 * listening, a proxy's HTML error page, a redirect, a name that is not a path
 * segment. None of these is a database answer, so this file needs no database:
 * a tiny `node:http` server plays the thing in front of the data server, over
 * real HTTP, through Node's real fetch.
 */

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      // A case that leaves a response open would otherwise hold close() forever.
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    }),
  )
})

/** A server answering every request with `answer`, and recording what it was asked. */
async function serve(answer: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ base: string; asked: string[] }> {
  const asked: string[] = []
  const server = createServer((request, response) => {
    asked.push(`${request.method ?? ''} ${request.url ?? ''} ${request.headers.authorization ?? '-'}`)
    answer(request, response)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, asked }
}

describe('when the data server is not what answers', () => {
  // (h) A connection refused is status 0 and `unreachable`, a value the host
  // can show, not a rejected promise it has to remember to catch.
  test('nothing listening is status 0, unreachable', async () => {
    const { base } = await serve(() => undefined)
    await new Promise((resolve) => servers.pop()?.close(resolve))
    const outcome = await createDataClient({ token: () => 't', base }).form('pg-order')
    expect(outcome).toMatchObject({ ok: false, status: 0, code: 'unreachable' })
  })

  // (h) A proxy's HTML 502 has no sentence the client could pass on. Showing
  // the body would put markup in front of a person; inventing a server code
  // would claim the data server said something. `unexpected` says neither.
  test('a non-JSON 502 is unexpected, with the client’s own sentence', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(502, { 'content-type': 'text/html' }).end('<html><body>Bad Gateway</body></html>')
    })
    const outcome = await createDataClient({ token: () => 't', base }).read('pg-order', 'k1:1')
    expect(outcome).toMatchObject({ ok: false, status: 502, code: 'unexpected' })
    expect(outcome.ok ? '' : outcome.message).not.toContain('html')
  })

  // A 200 that is not the route's shape is not a success: a host would render
  // `undefined` fields from a captive portal's page as an empty form.
  test('a 200 that is not the documented shape is unexpected', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ hello: 'portal' }))
    })
    expect(await createDataClient({ token: () => 't', base }).form('pg-order')).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
  })

  // A refusal without a code still carries its sentence, under `http-<status>`,
  // so a host can show what was said without the client pretending to know why.
  test('a refusal with a sentence and no code is http-<status>', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'Rate limit exceeded, retry in 1 minute' }))
    })
    expect(await createDataClient({ token: () => 't', base }).form('pg-order')).toEqual({ ok: false, status: 429, code: 'http-429', message: 'Rate limit exceeded, retry in 1 minute' })
  })

  // A connection that drops after the status and before the body ends is not
  // a success, whatever the status said: a host would render a record from
  // half an answer. Nor is it the server's refusal, which would need a body.
  test('a body cut off after a 200 is unexpected', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' })
      response.write('{"record":')
      setTimeout(() => response.destroy(), 20)
    })
    expect(await createDataClient({ token: () => 't', base }).read('pg-order', 'k1:1')).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
  })

  // A search aborted while its answer is still arriving -- the next keystroke
  // came after the headers -- rejects with the AbortError, as one aborted
  // before them does. Reported as `unexpected`, it would show "could not be
  // loaded" over the newer search's answer.
  test('an abort while the body is arriving rejects with the AbortError', async () => {
    const controller = new AbortController()
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"rows":')
      setTimeout(() => controller.abort(), 20)
    })
    const pending = createDataClient({ token: () => 't', base }).query('pg-order', 'order.customer', { operation: 'create', search: 'M' }, controller.signal)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  // The runtime plane never redirects. A redirect followed with the bearer
  // token would hand the token to a path -- or a host -- that is not a runtime
  // route; it is not followed, and is reported as not the server's answer.
  test('a redirect is not followed', async () => {
    const { base, asked } = await serve((request, response) => {
      if (request.url === '/elsewhere') response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      else response.writeHead(302, { location: '/elsewhere' }).end()
    })
    const outcome = await createDataClient({ token: () => 't', base }).form('pg-order')
    expect(outcome).toMatchObject({ ok: false, code: 'unexpected' })
    expect(asked).toEqual(['GET /v1/forms/pg-order Bearer t'])
  })

  // `fetch` resolves `.` and `..` segments before sending: `form('..')` would
  // be `GET /v1/`, and `read('..', …)` would be `POST /v1/records/read`. A
  // name that cannot be one segment is refused before a request -- or a
  // token -- is made.
  test('a form id that is not a path segment is refused without a request', async () => {
    const { base, asked } = await serve((_request, response) => response.writeHead(500).end())
    let tokens = 0
    const client = createDataClient({
      token: () => {
        tokens += 1
        return 't'
      },
      base,
    })
    const refusals = [
      await client.form('..'),
      await client.read('.', 'k1:1'),
      await client.create('', {}),
      await client.update('..', { record: 'k1:1', version: '1', answers: {} }),
      await client.query('..', 'customer', { operation: 'create', search: '' }),
      await client.resolve('pg-order', '..', { operation: 'create', tokens: ['k1:1'] }),
    ]
    for (const refusal of refusals) expect(refusal).toMatchObject({ ok: false, status: 0, code: 'invalid-name' })
    expect(asked).toEqual([])
    expect(tokens).toBe(0)
  })

  // Same origin is the default (0024): a host that passes no base calls the
  // page's own origin, through the global fetch it did not have to pass.
  test('without a base or a fetch, the global fetch is called with a path on the same origin', async () => {
    const seen: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = async (input) => {
      seen.push(String(input))
      return new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    try {
      const outcome = await createDataClient({ token: () => 't' }).resolve('pg-order', 'order.customer', { operation: 'read', tokens: ['k1:1'] })
      expect(outcome).toEqual({ ok: true, value: [] })
      expect(seen).toEqual(['/v1/forms/pg-order/lookups/order.customer/resolve'])
    } finally {
      globalThis.fetch = original
    }
  })

  // A base written with a trailing slash, or several, still names the same
  // server: the path is joined once, never as `//v1`, which a proxy may route
  // elsewhere or refuse. The trim is a loop, not `/\/+$/`, which CodeQL
  // flagged as polynomial on a base of many slashes (js/polynomial-redos).
  test('a base ending in slashes joins the path once', async () => {
    const { base, asked } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ rows: [] }))
    })
    const outcome = await createDataClient({ token: () => 't', base: `${base}///` }).resolve('pg-order', 'order.customer', { operation: 'read', tokens: ['k1:1'] })
    expect(outcome).toEqual({ ok: true, value: [] })
    expect(asked).toEqual(['POST /v1/forms/pg-order/lookups/order.customer/resolve Bearer t'])
  })
})
