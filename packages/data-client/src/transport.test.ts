import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { WRITE_ID_HEADER } from '@formancy/data-core'
import { createDataClient } from './client.js'
import { isUnknownWrite } from './writes.js'

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
  // On a read only: on a write it is an unknown outcome (0031), below.
  test('a non-JSON 502 on a read is unexpected, with the client’s own sentence', async () => {
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

/** The body of a request, read to the end: a server that answers before reading it would race the client's send. */
function drained(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/** A JSON answer, after the request's body has arrived. */
function json(status: number, body: unknown): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void drained(request).then(() => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)))
  }
}

/** A text answer, after the request's body has arrived: what a proxy sends. */
function page(status: number, html: string): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void drained(request).then(() => response.writeHead(status, { 'content-type': 'text/html' }).end(html))
  }
}

const CHANGE = { record: 'k1:7', version: '00000000000007d1', answers: { notes: 'x' } }
const TRANSPORT = 'The answer to this save was lost between this page and the data server. It may have been saved.'

describe('a write whose answer is not known (0031)', () => {
  // The server's 502 says the database lost the answer, and names what was
  // addressed. The client passes it on as an unknown write -- not a refusal,
  // which a host would show as "Not saved" -- from exactly one request: a
  // client that tried again would make the duplicate the 502 warns about.
  test("the server's 502 unknown-outcome is an unknown write from the database, sent once", async () => {
    const message = 'The connection to the database failed after the record was sent. It may have been saved: read it before entering it again.'
    const { base, asked } = await serve(json(502, { code: 'unknown-outcome', message, operation: 'create', record: 'k1:1,8', version: null }))
    const outcome = await createDataClient({ token: () => 't', base }).create('pg-customer', { customer_no: 8 })
    expect(outcome).toEqual({ ok: false, status: 502, code: 'unknown-outcome', message, operation: 'create', record: 'k1:1,8', version: null, origin: 'database' })
    expect(asked).toEqual(['POST /v1/forms/pg-customer/records/create Bearer t'])
  })

  // A 502 body that names nothing usable -- a field of the wrong type --
  // still is the server's unknown outcome; what was addressed is then the
  // call's own, which the client knows.
  test("a 502 unknown-outcome without a usable record or version takes the call's", async () => {
    const { base } = await serve(json(502, { code: 'unknown-outcome', message: 'It may have been saved.', record: 7 }))
    const outcome = await createDataClient({ token: () => 't', base }).update('pg-order', CHANGE)
    expect(outcome).toMatchObject({ code: 'unknown-outcome', operation: 'update', record: CHANGE.record, version: CHANGE.version, origin: 'database' })
  })

  // P5, measured with Node's fetch: a socket destroyed after the request
  // arrived rejects the fetch, and a 201 whose body is cut resolves and then
  // fails to read. Either way the server had the write -- it saw exactly one
  // POST -- so neither is "unreachable", which a host would read as nothing
  // sent. The record and version are the update's own; a create has none.
  test('a connection lost after the request arrived, or a 201 cut short, is an unknown write from the transport, sent once', async () => {
    const lost = await serve((request) => {
      void drained(request).then(() => request.socket.destroy())
    })
    expect(await createDataClient({ token: () => 't', base: lost.base }).update('pg-order', CHANGE)).toEqual({
      ok: false,
      status: 0,
      code: 'unknown-outcome',
      message: TRANSPORT,
      operation: 'update',
      record: CHANGE.record,
      version: CHANGE.version,
      origin: 'transport',
    })
    expect(lost.asked).toHaveLength(1)

    const cut = await serve((request, response) => {
      void drained(request).then(() => {
        response.writeHead(201, { 'content-type': 'application/json', 'content-length': '100' })
        response.write('{"record":"k1:9"')
        setTimeout(() => response.destroy(), 20)
      })
    })
    expect(await createDataClient({ token: () => 't', base: cut.base }).create('pg-order', {})).toEqual({
      ok: false,
      status: 201,
      code: 'unknown-outcome',
      message: TRANSPORT,
      operation: 'create',
      record: null,
      version: null,
      origin: 'transport',
    })
    expect(cut.asked).toHaveLength(1)
  })

  // What answered a write was not the data server saying what happened: a
  // proxy's page at 502 or 504, a JSON 502 with another code, a 500, a 2xx
  // that is not a record, a 4xx with no sentence. The request may have
  // reached the server and the database, so the client cannot say it was
  // not saved -- which is what `unexpected`, a refusal, would have the host
  // say.
  test('a proxy page, another 502, a 500, a 2xx without a record or a 4xx without a sentence is an unknown write', async () => {
    const answers = [
      page(502, '<html>Bad Gateway</html>'),
      page(504, '<html>Gateway Timeout</html>'),
      json(502, { code: 'bad-gateway', message: 'upstream closed' }),
      json(500, { code: 'internal', message: 'boom' }),
      json(200, { hello: 'portal' }),
      json(422, { code: 'refused' }),
    ]
    for (const answer of answers) {
      const { base } = await serve(answer)
      const outcome = await createDataClient({ token: () => 't', base }).create('pg-order', {})
      expect(outcome).toMatchObject({ ok: false, code: 'unknown-outcome', origin: 'transport', record: null, message: TRANSPORT })
    }
  })

  // The answers that say nothing was written stay refusals: the database's
  // refusal (422), a stale version (409), the database out of reach before
  // anything was sent (503 unavailable), a policy refusal (403), and a 4xx
  // with a sentence and no code, which the data server's rate limit sends.
  // Reported as unknown, each would hold a form the server had said was not
  // saved.
  test('a JSON refusal is known: 422, 409, 503 unavailable, 403, and a 4xx with a sentence', async () => {
    const refusals: Array<[number, Record<string, string>, string]> = [
      [422, { code: 'refused', message: 'The database refused this request, and nothing was saved.' }, 'refused'],
      [409, { code: 'stale', message: 'The record changed since it was read.' }, 'stale'],
      [503, { code: 'unavailable', message: 'The database could not complete this now. Nothing was saved.' }, 'unavailable'],
      [403, { code: 'over-posting', message: 'tenant_id may not be written.' }, 'over-posting'],
      [429, { message: 'Rate limit exceeded, retry in 1 minute' }, 'http-429'],
    ]
    for (const [status, body, code] of refusals) {
      const { base } = await serve(json(status, body))
      const outcome = await createDataClient({ token: () => 't', base }).update('pg-order', CHANGE)
      expect(outcome, String(status)).toEqual({ ok: false, status, code, message: body['message'] })
      expect(isUnknownWrite(outcome), String(status)).toBe(false)
    }
  })

  // A host that checks only `ok` treats an unknown write as not done, which
  // fails closed; one that asks isUnknownWrite gets the reconcilable shape,
  // and a refusal that merely carries the code is not mistaken for one.
  test('isUnknownWrite tells an unknown write from a refusal and a success', async () => {
    const { base } = await serve(json(502, { code: 'unknown-outcome', message: 'It may have been saved.', operation: 'update', record: 'k1:7', version: 'v' }))
    const unknown = await createDataClient({ token: () => 't', base }).update('pg-order', CHANGE)
    expect(unknown.ok).toBe(false)
    expect(isUnknownWrite(unknown)).toBe(true)
    expect(isUnknownWrite({ ok: false, status: 502, code: 'unknown-outcome', message: 'built by hand' } as { ok: boolean })).toBe(false)
    expect(isUnknownWrite({ ok: true })).toBe(false)
  })
})

describe('a write id on every write (0031)', () => {
  // Chromium resends a write whose reused connection closed before any
  // answer; the server answers a resend with the first sending's answer only
  // when the two carry the same id (write-once.ts). So every create and
  // update carries one, new for each call -- the same id on two saves the
  // person made would answer the second with the first's -- and a read,
  // which changes nothing, carries none.
  test('every create and update carries a write id of its own, and a read none', async () => {
    const ids: Array<string | undefined> = []
    const { base } = await serve((request, response) => {
      const id = request.headers[WRITE_ID_HEADER]
      ids.push(typeof id === 'string' ? id : undefined)
      void drained(request).then(() => response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'not-found', message: 'No such record.' })))
    })
    const client = createDataClient({ token: () => 't', base })
    await client.create('pg-order', { notes: 'a' })
    await client.create('pg-order', { notes: 'a' })
    await client.update('pg-order', CHANGE)
    await client.read('pg-order', 'k1:7')
    expect(ids.slice(0, 3).every((id) => id !== undefined && /^[0-9a-f]{32}$/.test(id))).toBe(true)
    expect(new Set(ids.slice(0, 3)).size).toBe(3)
    expect(ids[3]).toBeUndefined()
  })
})
