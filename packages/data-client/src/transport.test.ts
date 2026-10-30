import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { CROSS_ORIGIN_REQUEST_HEADERS, WRITE_ID_HEADER } from '@formancy/data-core'
import { createDataClient } from './client.js'
import { isUnknownWrite } from './writes.js'
import type { UnknownWrite } from './writes.js'

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

  // A page's `next` is the cursor the next page is asked for after (0108):
  // text when more follow, `null` when none do. A page without one -- a
  // server that paged by offset -- or with one that disagrees with
  // `hasMore` is not this server's page: a grid would offer Next rows and
  // have nothing to ask for. Watched failing with `next` left unchecked.
  test("a page without the server's cursor, or with one that disagrees with hasMore, is unexpected", async () => {
    let body: unknown
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    })
    const client = createDataClient({ token: () => 't', base })
    for (const page of [
      { rows: [], hasMore: true },
      { rows: [], hasMore: false },
      { rows: [], hasMore: true, next: null },
      { rows: [], hasMore: true, next: '' },
      { rows: [], hasMore: false, next: 'c1:7' },
      { rows: [], hasMore: true, next: 7 },
    ]) {
      body = page
      expect(await client.list('pg-order'), JSON.stringify(page)).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
    }
    for (const page of [
      { rows: [], hasMore: true, next: 'c1:7' },
      { rows: [], hasMore: false, next: null },
    ]) {
      body = page
      expect(await client.list('pg-order'), JSON.stringify(page)).toEqual({ ok: true, value: page })
    }
  })

  // A form's `list` says whether a grid may be offered (0044). A reply
  // without one -- a server older than lists -- is not this server's form:
  // taken for one, `list !== null` would hold for `undefined`, and a host
  // would offer a grid the server cannot serve. `null` and the columns are
  // both the server's. Watched failing with `list` left unchecked.
  //
  // Its `filterable` says which conditions a page may offer on which field
  // (0104). A list without one -- a server older than filters -- or with
  // an offer a panel could not draw -- no operator, one data-core does not
  // name, a value's type it does not name, a type where only `null` and
  // `not-null` are offered or none where a value is, a clock for days it
  // does not name, or on anything but a date -- is not this server's
  // either: a page would offer conditions the server refuses, or say a
  // timestamp's days are on a clock they are not.
  // Watched failing with `filterable` left unchecked: every one of those
  // lists was taken for the server's. So is one without `views`, a server
  // older than views (0105), or with a view a picker could not send as a
  // list request: no name, a condition with no field or an operator
  // data-core does not name, a direction but ascending or descending, a
  // default but `true`. Watched failing with `views` left unchecked.
  test("a form without the server's list is unexpected, and a list of null or columns is the server's", async () => {
    const FORM = { form: { model: {} }, operations: ['read'], readable: ['id'], deleting: null, copied: null, versions: null }
    let body: unknown = FORM
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    })
    const client = createDataClient({ token: () => 't', base })
    const columns = { searchable: [], sortable: ['id'], views: [] }
    const VIEW = { name: 'Newest', filter: [{ field: 'id', op: 'range', from: '10', to: null }], sort: [{ field: 'id', direction: 'desc' }] }
    const viewed = (view: Record<string, unknown>) => ({ ...columns, filterable: [], views: [{ ...VIEW, ...view }] })
    const offer = (operators: unknown, input: unknown, days: unknown = null) => ({ ...columns, filterable: [{ field: 'id', operators, input, days }] })
    for (const list of [
      undefined,
      'yes',
      { searchable: ['id'] },
      { searchable: 'id', sortable: [], filterable: [] },
      { searchable: [], sortable: [1], filterable: [] },
      columns,
      { ...columns, filterable: {} },
      { ...columns, filterable: [{ operators: ['equals'], input: 'integer', days: null }] },
      { ...columns, filterable: [{ field: 'id', operators: ['equals'], input: 'integer' }] },
      offer([], null),
      offer(['like'], 'text'),
      offer(['equals'], 'money'),
      offer(['equals'], null),
      offer(['null', 'not-null'], 'text'),
      offer(['range'], 'date', 'local'),
      offer(['equals', 'range'], 'integer', 'utc'),
      { searchable: [], sortable: ['id'], filterable: [] },
      { ...columns, filterable: [], views: {} },
      viewed({ name: 7 }),
      viewed({ filter: [{ op: 'null' }] }),
      viewed({ filter: [{ field: 'id', op: 'like', text: '1' }] }),
      viewed({ sort: [{ field: 'id', direction: 'up' }] }),
      viewed({ sort: {} }),
      viewed({ default: false }),
    ]) {
      body = { ...FORM, list }
      expect(await client.form('pg-order'), JSON.stringify(list)).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
    }
    for (const list of [
      null,
      { ...columns, filterable: [] },
      offer(['equals', 'range'], 'integer'),
      offer(['null', 'not-null'], null),
      offer(['equals', 'contains', 'null', 'not-null'], 'text'),
      offer(['range'], 'date', 'utc'),
      offer(['range', 'null', 'not-null'], 'date', 'wall'),
      viewed({}),
      viewed({ default: true }),
    ]) {
      body = { ...FORM, list }
      expect(await client.form('pg-order'), JSON.stringify(list)).toEqual({ ok: true, value: body })
    }
  })

  // The menu (0045) is `GET /v1/forms`, with no name in its path and the
  // token in the header. Its answer is taken only in the server's shape: a
  // page draws a link per entry and a grid per child, and an entry without
  // `children` -- a proxy's, or a server's that has no menu -- would be
  // drawn as a form with none. Watched failing with only `forms` checked
  // for being a list: the entries below were taken for the server's. A
  // child without `one` -- a server older than sections (0109) -- or a
  // section whose condition a page could not compare is not this server's
  // either: a page would draw a section as a grid, or show it never.
  // Watched failing with `one` unchecked.
  test("a menu is GET /v1/forms, taken only in the server's shape", async () => {
    const ENTRY = { id: 'pg-order', title: 'Order', operations: ['read'], children: [{ form: 'pg-order-line', field: 'order', one: false, when: null }] }
    let body: unknown = { forms: [ENTRY] }
    const { base, asked } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    })
    const client = createDataClient({ token: () => 't', base })
    expect(await client.forms()).toEqual({ ok: true, value: body })
    expect(asked).toEqual(['GET /v1/forms Bearer t'])
    const { children: _children, ...childless } = ENTRY
    const child = { form: 'pg-order-line', field: 'order', one: false, when: null }
    const sections = [
      { ...child, one: true, when: null },
      { ...child, one: true, when: { field: 'kind', equals: 'company' } },
      { ...child, one: true, when: { field: 'customer_no', equals: 1001 } },
      { ...child, one: true, when: { field: 'is_company', equals: true } },
    ]
    for (const section of sections) {
      body = { forms: [{ ...ENTRY, children: [section] }] }
      expect(await client.forms(), JSON.stringify(section)).toMatchObject({ ok: true })
    }
    const unread = [
      { form: 'pg-order-line' },
      { form: 1, field: 'order', one: false, when: null },
      { form: 'pg-order-line', field: 'order' },
      { ...child, one: 'yes' },
      { ...child, when: { field: 'kind', equals: 'company' } },
      { ...child, one: true, when: { field: 'kind' } },
      { ...child, one: true, when: { field: 'kind', equals: null } },
      { ...child, one: true, when: { equals: 'company' } },
    ]
    for (const forms of [
      undefined,
      {},
      [childless],
      [{ ...ENTRY, id: 7 }],
      [{ ...ENTRY, title: null }],
      [{ ...ENTRY, operations: 'read' }],
      ...unread.map((entry) => [{ ...ENTRY, children: [entry] }]),
    ]) {
      body = { forms }
      expect(await client.forms(), JSON.stringify(forms)).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
    }
    body = { forms: [] }
    expect(await client.forms()).toEqual({ ok: true, value: { forms: [] } })
  })

  // A refusal without a code still carries its sentence, under `http-<status>`,
  // so a host can show what was said without the client pretending to know why.
  test('a refusal with a sentence and no code is http-<status>', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'Rate limit exceeded, retry in 1 minute' }))
    })
    expect(await createDataClient({ token: () => 't', base }).form('pg-order')).toEqual({
      ok: false,
      status: 429,
      code: 'http-429',
      message: 'Rate limit exceeded, retry in 1 minute',
    })
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
      await client.exportRecords('..'),
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
      seen.push(input instanceof Request ? input.url : String(input))
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
    const outcome = await createDataClient({ token: () => 't', base: `${base}///` }).resolve('pg-order', 'order.customer', {
      operation: 'read',
      tokens: ['k1:1'],
    })
    expect(outcome).toEqual({ ok: true, value: [] })
    expect(asked).toEqual(['POST /v1/forms/pg-order/lookups/order.customer/resolve Bearer t'])
  })
})

/**
 * The Fetch standard's *CORS-safelisted request-header*, transcribed for the
 * one name this client sends that it can hold (whatwg/fetch `fetch.bs` on
 * main, read 2026-10-13: the rule at lines 1013-1040, the bytes at
 * 1100-1108): `accept`, with a value of at most 128 bytes holding no
 * CORS-unsafe request-header byte. Any other header makes a browser ask the
 * server first, and is one the server must grant.
 */
const UNSAFE_BYTES = new Set([0x22, 0x28, 0x29, 0x3a, 0x3c, 0x3e, 0x3f, 0x40, 0x5b, 0x5c, 0x5d, 0x7b, 0x7d, 0x7f])
function safelisted(name: string, value: string): boolean {
  if (name !== 'accept') return false
  const bytes = new TextEncoder().encode(value)
  return bytes.length <= 128 && bytes.every((byte) => !((byte < 0x20 && byte !== 0x09) || UNSAFE_BYTES.has(byte)))
}

describe('across origins (0060)', () => {
  // A page on another origin reaches the runtime plane only through a
  // preflight the server grants, and the server grants exactly
  // CROSS_ORIGIN_REQUEST_HEADERS: a header the client sent beyond them -- an
  // `x-requested-with`, an `accept` the safelist does not cover -- would make
  // every call from a listed origin a refused preflight, which the page sees
  // as "could not be reached". And no call asks for credentials: the server
  // never allows them, and a cookie sent across origins is the ambient
  // credential the bearer header exists to avoid. Every function the client
  // returns is called, so one added later without a case here fails.
  test('every request carries only headers the safelist covers or the server grants, and no credentials', async () => {
    const sent: Array<{ call: string; init: RequestInit }> = []
    let call = ''
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ call, init: init ?? {} })
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const client = createDataClient({ token: () => 't', base: 'https://data.example', fetch })
    const lost: UnknownWrite = {
      ok: false,
      status: 0,
      code: 'unknown-outcome',
      message: TRANSPORT,
      operation: 'update',
      record: 'k1:7',
      version: '00000000000007d1',
      origin: 'transport',
    }
    const calls: Record<keyof typeof client, () => Promise<unknown>> = {
      forms: () => client.forms(),
      form: () => client.form('pg-order'),
      read: () => client.read('pg-order', 'k1:7'),
      list: () => client.list('pg-order', { search: 'a' }),
      exportRecords: () => client.exportRecords('pg-order', { search: 'a' }),
      create: () => client.create('pg-order', { notes: 'a' }),
      update: () => client.update('pg-order', CHANGE),
      supersede: () => client.supersede('pg-order', CHANGE),
      delete: () => client.delete('pg-order', { record: 'k1:7', version: '00000000000007d1' }),
      reconcile: () => client.reconcile('pg-order', lost),
      query: () => client.query('pg-order', 'order.customer', { operation: 'read', search: 'a' }),
      resolve: () => client.resolve('pg-order', 'order.customer', { operation: 'read', tokens: ['k1:1'] }),
    }
    for (const [name, run] of Object.entries(calls)) {
      call = name
      await run()
    }
    expect([...new Set(sent.map((entry) => entry.call))].sort()).toEqual(Object.keys(client).sort())
    // Read as fetch reads them, whatever shape the client builds them in --
    // `Object.entries` of a Headers is empty -- and every call shown to carry
    // its token, so a check that saw no header at all cannot pass. Watched
    // passing vacuously, before, with the client sending a Headers holding
    // `x-requested-with`; and failing, now, on the same client.
    const sentHeaders = sent.map(({ call: name, init }) => ({ name, headers: [...new Headers(init.headers).entries()] }))
    expect(sentHeaders.filter(({ headers }) => !headers.some(([header]) => header === 'authorization')).map(({ name }) => name)).toEqual([])
    const granted = new Set<string>(CROSS_ORIGIN_REQUEST_HEADERS)
    const ungranted = sentHeaders.flatMap(({ name, headers }) =>
      headers.filter(([header, value]) => !safelisted(header, value) && !granted.has(header)).map(([header, value]) => `${name} sends ${header}: ${value}`),
    )
    expect(ungranted).toEqual([])
    expect(sent.filter(({ init }) => 'credentials' in init).map(({ call: name }) => name)).toEqual([])
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
    expect(outcome).toEqual({
      ok: false,
      status: 502,
      code: 'unknown-outcome',
      message,
      operation: 'create',
      record: 'k1:1,8',
      version: null,
      origin: 'database',
    })
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
      void drained(request).then(() =>
        response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'not-found', message: 'No such record.' })),
      )
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

describe('a delete (0050)', () => {
  const DELETION = 'The answer to this deletion was lost between this page and the data server. It may have been deleted.'
  const GONE = { record: 'k1:7', version: '00000000000007d1' }

  // A delete is a POST with exactly the route's keys and a write id of its
  // own, and is done only when the server says `{ record, deleted: true }`:
  // the token of the row it deleted, which may be spelled otherwise than the
  // one sent (0028).
  test('posts the record and the version with a write id, and is done on the server’s deletion answer', async () => {
    const seen: Array<{ url: string; id: unknown; body: string }> = []
    const { base } = await serve((request, response) => {
      void drained(request).then((body) => {
        seen.push({ url: request.url ?? '', id: request.headers[WRITE_ID_HEADER], body })
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ record: 'k1:07', deleted: true }))
      })
    })
    const client = createDataClient({ token: () => 't', base })
    expect(await client.delete('pg-ticket', { ...GONE, answers: { notes: 'never sent' } } as typeof GONE)).toEqual({
      ok: true,
      value: { record: 'k1:07', deleted: true },
    })
    expect(seen).toEqual([{ url: '/v1/forms/pg-ticket/records/delete', id: expect.stringMatching(/^[0-9a-f]{32}$/), body: JSON.stringify(GONE) }])
  })

  // A 2xx that is not a deletion answer -- a record, a body without its
  // token, a `deleted` that is not `true` -- is not the server saying it
  // deleted it, and may have been: an unknown write from the transport, in
  // a deletion's words (watched failing with writeOutcome requiring a
  // FormRecord: the deletion answer itself was unknown).
  test('any other 2xx is an unknown deletion from the transport', async () => {
    for (const body of [
      { record: 'k1:7', version: 'v', answers: {} },
      { deleted: true },
      { record: 'k1:7', deleted: 'yes' },
      { record: null, deleted: true },
    ]) {
      const { base } = await serve(json(200, body))
      expect(await createDataClient({ token: () => 't', base }).delete('pg-ticket', GONE), JSON.stringify(body)).toEqual({
        ok: false,
        status: 200,
        code: 'unknown-outcome',
        message: DELETION,
        operation: 'delete',
        ...GONE,
        origin: 'transport',
      })
    }
  })

  // The server's 502: the database lost the answer to a deletion, which
  // may have been made; the server names the record and version sent.
  test("the server's 502 is an unknown deletion from the database, sent once", async () => {
    const message = 'The connection to the database failed after the deletion was sent. It may have been deleted.'
    const { base, asked } = await serve(json(502, { code: 'unknown-outcome', message, operation: 'delete', ...GONE }))
    expect(await createDataClient({ token: () => 't', base }).delete('pg-ticket', GONE)).toEqual({
      ok: false,
      status: 502,
      code: 'unknown-outcome',
      message,
      operation: 'delete',
      ...GONE,
      origin: 'database',
    })
    expect(asked).toHaveLength(1)
  })

  // A record not found, stale, or kept by the database for what refers to
  // it: each is the server saying nothing was deleted -- a refusal, never
  // unknown.
  test('a 404, a 409 and a 422 are refusals', async () => {
    for (const [status, code] of [
      [404, 'not-found'],
      [409, 'stale'],
      [422, 'referenced'],
    ] as const) {
      const { base } = await serve(json(status, { code, message: 'Nothing was deleted.' }))
      expect(await createDataClient({ token: () => 't', base }).delete('pg-ticket', GONE)).toEqual({ ok: false, status, code, message: 'Nothing was deleted.' })
    }
  })

  // `deleting` is the server's exactly when `operations` holds delete, and
  // null exactly when it does not (0050): a reply that says delete without
  // what it also does, or what it also does without delete, or nothing at
  // all, is no form this server sent, as a form without `list` is not
  // (watched failing with `deleting` left unchecked).
  test("a form's deleting is null exactly when it offers no delete", async () => {
    const FORM = { form: { model: {} }, readable: ['id'], list: null, copied: null, versions: null }
    const DELETING = { cascades: false, clears: false, restricted: true }
    let body: unknown = FORM
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    })
    const client = createDataClient({ token: () => 't', base })
    for (const [operations, deleting] of [
      [['read'], undefined],
      [['read', 'delete'], null],
      [['read'], DELETING],
      [['read', 'delete'], { ...DELETING, restricted: 'yes' }],
      [['read', 'delete'], { cascades: false, clears: false }],
    ] as const) {
      body = { ...FORM, operations, deleting }
      expect(await client.form('pg-ticket'), JSON.stringify(body)).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
    }
    for (const [operations, deleting] of [
      [['read'], null],
      [['read', 'delete'], DELETING],
    ] as const) {
      body = { ...FORM, operations, deleting }
      expect(await client.form('pg-ticket')).toEqual({ ok: true, value: body })
    }
  })

  // `copied` is the server's list exactly when `operations` holds create,
  // and null exactly when it does not (0107): a reply that offers create
  // without it, a list without create, or a list that is not field keys is
  // no form this server sent, and a page that copied from it would offer a
  // copy nobody decided -- as one from a server older than 0107, which
  // sends nothing, would.
  test("a form's copied is null exactly when it offers no create, and field keys when it does", async () => {
    const FORM = { form: { model: {} }, readable: ['id', 'note'], list: null, deleting: null, versions: null }
    let body: unknown = FORM
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    })
    const client = createDataClient({ token: () => 't', base })
    for (const [operations, copied] of [
      [['read', 'create'], undefined],
      [['read', 'create'], null],
      [['read'], ['note']],
      [['read'], []],
      [['read', 'create'], 'note'],
      [
        ['read', 'create'],
        ['note', 7],
      ],
    ] as const) {
      body = { ...FORM, operations, copied }
      expect(await client.form('pg-ticket'), JSON.stringify(body)).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
    }
    for (const [operations, copied] of [
      [['read'], null],
      [['read', 'create'], ['note']],
      [['read', 'create'], []],
    ] as const) {
      body = { ...FORM, operations, copied }
      expect(await client.form('pg-ticket')).toEqual({ ok: true, value: body })
    }
  })

  // `versions` names where a version starts and ends only on a form that
  // offers both create and update, and is null otherwise (0113): a reply
  // naming them without both, naming something else, or saying nothing --
  // a server older than 0113 -- is no form this server sent, and a page
  // that offered a change from it would offer one nobody decided.
  test("a form's versions are null, or the start and end where it offers create and update", async () => {
    const FORM = { form: { model: {} }, readable: ['id', 'valid_from', 'valid_to'], list: null, deleting: null, copied: [] }
    const VERSIONS = { from: 'valid_from', to: 'valid_to' }
    let body: unknown = FORM
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    })
    const client = createDataClient({ token: () => 't', base })
    for (const [operations, versions] of [
      [['read', 'create', 'update'], undefined],
      [['read', 'create'], VERSIONS],
      [['read', 'create', 'update'], { from: 'valid_from' }],
      [['read', 'create', 'update'], 'valid_from'],
    ] as const) {
      body = { ...FORM, operations, versions }
      expect(await client.form('pg-price'), JSON.stringify(body)).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
    }
    for (const [operations, versions] of [
      [['read', 'create'], null],
      [['read', 'create', 'update'], VERSIONS],
      [['read', 'create', 'update'], null],
    ] as const) {
      body = { ...FORM, operations, versions }
      expect(await client.form('pg-price')).toEqual({ ok: true, value: body })
    }
  })

  // A server older than 0050 sends no `deleting` at all, and this client
  // answers its form `unexpected`, as one since 0044 answers a reply
  // without `list`: a host upgrades its server before its client, which
  // the CHANGELOG and the limitations say.
  test('a form reply from a server older than 0050, which has no deleting, is unexpected', async () => {
    const { base } = await serve((_request, response) => {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ form: { model: {} }, operations: ['read', 'update'], readable: ['id'], list: null }))
    })
    expect(await createDataClient({ token: () => 't', base }).form('pg-ticket')).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
  })
})

describe('a file of records (0079)', () => {
  const FILE = '﻿Id,Name\r\n7,Muster AG\r\n'

  // The file is the server's bytes, byte-order mark included, under the
  // name the form's id gives it -- never one read from a header, which a
  // page on another origin cannot read (0060). Exactly the search, the
  // sort and the parent travel, in a POST body, with the token in the
  // header, and the answer is asked for as CSV or a JSON refusal.
  test('is the server’s bytes under the form’s file name, asked for with exactly the query', async () => {
    const seen: Array<{ accept: string | undefined; body: string }> = []
    const { base, asked } = await serve((request, response) => {
      void drained(request).then((body) => {
        seen.push({ accept: request.headers.accept, body })
        response
          .writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="other.csv"' })
          .end(Buffer.from(FILE, 'utf8'))
      })
    })
    const query = { search: 'Muster', sort: [{ field: 'name', direction: 'asc' as const }], parent: null, offset: 50, limit: 10 }
    const outcome = await createDataClient({ token: () => 't', base }).exportRecords('pg-order', query)
    if (!outcome.ok) throw new Error(`expected a file, got ${outcome.code}`)
    expect(outcome.value.name).toBe('pg-order.csv')
    expect(Buffer.from(await outcome.value.file.arrayBuffer())).toEqual(Buffer.from(FILE, 'utf8'))
    expect(asked).toEqual(['POST /v1/forms/pg-order/records/export Bearer t'])
    expect(seen).toEqual([
      { accept: 'text/csv, application/json', body: JSON.stringify({ search: 'Muster', sort: [{ field: 'name', direction: 'asc' }], parent: null }) },
    ])
  })

  // A 200 that is not a CSV file -- a captive portal's page, a proxy's
  // JSON, a server older than exports that answers something else -- is
  // not the file. Saved, it would be a page of markup under a .csv name.
  // Watched failing with the content type unchecked: a file of `{}`.
  test('a 200 that is not text/csv is unexpected', async () => {
    for (const [type, body] of [
      ['application/json', '{}'],
      ['text/html', '<html></html>'],
      ['text/csvx', 'a,b\r\n'],
    ]) {
      const { base } = await serve((_request, response) => {
        response.writeHead(200, { 'content-type': type as string }).end(body)
      })
      expect(await createDataClient({ token: () => 't', base }).exportRecords('pg-order'), type).toMatchObject({ ok: false, status: 200, code: 'unexpected' })
    }
  })

  // A file is whole only when its body arrived whole: a connection cut
  // before the length the server announced is not a shorter file, which a
  // person would open and take for every record. Watched failing with the
  // body read as JSON reads it, a failed read taken for an empty body:
  // a file of nothing.
  test('a body cut off after a 200 is incomplete, never a file', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-length': '1000' })
      response.write(FILE)
      setTimeout(() => response.destroy(), 20)
    })
    expect(await createDataClient({ token: () => 't', base }).exportRecords('pg-order')).toEqual({
      ok: false,
      status: 200,
      code: 'incomplete',
      message: 'The file did not arrive whole, so it was not kept. Try again.',
    })
  })

  // A refusal is read as every read's is: the server's code and sentence,
  // or `unexpected` for what is not the server's; and leaving the page
  // while the file arrives rejects with the AbortError, never a refusal a
  // page would show.
  test('a refusal is the server’s, and an abort while the file arrives rejects with the AbortError', async () => {
    const { base } = await serve((_request, response) => {
      response
        .writeHead(422, { 'content-type': 'application/json' })
        .end(JSON.stringify({ code: 'export-too-large', message: 'The file would be larger than 16 MB.' }))
    })
    expect(await createDataClient({ token: () => 't', base }).exportRecords('pg-order')).toEqual({
      ok: false,
      status: 422,
      code: 'export-too-large',
      message: 'The file would be larger than 16 MB.',
    })
    const controller = new AbortController()
    const { base: slow } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' })
      response.write(FILE)
      setTimeout(() => controller.abort(), 20)
    })
    await expect(createDataClient({ token: () => 't', base: slow }).exportRecords('pg-order', {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
