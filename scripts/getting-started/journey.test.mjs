import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { checkedRecord } from '../release-report/collect.mjs'
import { composedServer, deleteOrder, proxyProblems, writeServerRecord } from './journey.mjs'

/**
 * The getting-started journey's record of each composed database (0035),
 * held to the shape collect.mjs reads from data-fixtures. The server is a
 * loopback HTTP server answering the administrator plane's connection test
 * as the data server does, the server's identity and its standing (0068):
 * what is checked here is the record the journey makes of that answer, not
 * the database.
 */
let server
let base
const asked = []

beforeAll(async () => {
  server = createServer((request, response) => {
    asked.push({ method: request.method, url: request.url, authorization: request.headers.authorization })
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ kind: 'sqlserver', version: '16.0.4295.3', product: 'sqlserver', major: 16, compatibility: 160, standing: { tested: true, says: 'This release of Formancy Data was tested on SQL Server 2022 (16), and the database’s compatibility level, 160, is not below the lowest it was tested at, 150.' } }))
  })
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
  base = `http://127.0.0.1:${String(server.address().port)}/`
})
afterAll(() => new Promise((done) => server.close(done)))

describe('a composed database’s record', () => {
  // Two writers make server records, and collect.mjs refuses one of any other
  // shape -- in the getting-started job, after the whole journey ran. The
  // shape is checked here, where a difference costs a second.
  test('is the server’s own answer, in the shape collect.mjs reads, with the image compose resolved', async () => {
    const config = { services: { sqlserver: { image: 'mcr.microsoft.com/mssql/server:2022-latest' } } }
    const record = await composedServer(base, 'admin-token', { connection: 'ms' }, config)
    expect(asked).toEqual([{ method: 'POST', url: '/v1/connections/ms/test', authorization: 'Bearer admin-token' }])
    expect(checkedRecord(record, 'the journey’s record')).toMatchObject({
      engine: 'sqlserver',
      image: 'mcr.microsoft.com/mssql/server:2022-latest',
      version: '16.0.4295.3',
      // The level of the database the connection reached, as the connection test answers it (0068).
      compatibility: 160,
      caller: 'scripts/getting-started.mjs',
      script: 'getting-started',
    })
    const dir = mkdtempSync(join(tmpdir(), 'formancy-data-journey-'))
    try {
      writeServerRecord(record, dir)
      writeServerRecord(record, dir)
      const files = readdirSync(join(dir, 'test-results', 'servers'))
      expect(files).toHaveLength(2)
      for (const file of files) expect(JSON.parse(readFileSync(join(dir, 'test-results', 'servers', file), 'utf8'))).toEqual(record)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // A connection whose database compose does not name would be recorded on
  // no image, and the report could not say what the guide ran.
  test('refuses a connection whose service compose names no image for', async () => {
    await expect(composedServer(base, 'admin-token', { connection: 'ms' }, { services: {} })).rejects.toThrow(/names no image for the service sqlserver/)
  })
})

describe('what a proxy in front of the stack sees', () => {
  // The two things the Cloudflare guide rests on (0037), asked of a
  // loopback server standing in for the stack's web port: an answer
  // without no-store, and a path that is not plain answered by anything
  // but the server's refusal, are each a sentence; and the path is sent
  // exactly as written, since fetch would keep `..%2F` but a client that
  // normalised it would test nothing.
  async function standIn(answer) {
    const seen = []
    const stand = createServer((request, response) => {
      seen.push(request.url)
      const { status, headers, body } = answer(request.url)
      response.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body))
    })
    await new Promise((ready) => stand.listen(0, '127.0.0.1', ready))
    return { seen, url: `http://127.0.0.1:${String(stand.address().port)}/`, close: () => new Promise((done) => stand.close(done)) }
  }
  const server = (url) => (url.includes('%2F') ? { status: 400, headers: { 'cache-control': 'no-store' }, body: { code: 'path-not-plain', message: 'x' } } : { status: 200, headers: { 'cache-control': 'no-store' }, body: {} })

  test('is nothing wrong when every answer says no-store and the path is refused', async () => {
    const stand = await standIn(server)
    try {
      expect(await proxyProblems(stand.url, 'clerk-token', 'pg-order')).toEqual([])
      expect(stand.seen).toEqual(['/v1/forms/pg-order', '/v1/whoami', '/v1/forms/a/versions/..%2F..%2Fb'])
    } finally {
      await stand.close()
    }
  })

  test('names an answer without no-store, and a path that reached a route', async () => {
    const stand = await standIn((url) => (url.includes('%2F') ? { status: 404, headers: {}, body: { code: 'unknown-form' } } : { status: 200, headers: { 'cache-control': 'no-cache' }, body: {} }))
    try {
      expect(await proxyProblems(stand.url, 'clerk-token', 'pg-order')).toEqual([
        'GET /v1/forms/pg-order answered 200 with Cache-Control no-cache, not no-store',
        'GET /v1/whoami without a token answered 200 with Cache-Control no-cache, not no-store',
        'GET /v1/forms/a/versions/..%2F..%2Fb, sent as written, answered 404 unknown-form, not 400 path-not-plain: nginx did not forward it as sent, or the server routed it',
      ])
    } finally {
      await stand.close()
    }
  })
})

describe('deleting an order over HTTP', () => {
  // The journey's delete (0051), asked of a loopback server standing in for
  // the stack's web port that scopes one order to tenant 1 as the server
  // does: tenant 2's delete is not found, tenant 1's deletes it at the
  // version read, and it is then not found -- every request with the token
  // and the write id it should carry (watched failing with tenant 2's token
  // sent for tenant 1's delete: "records/delete of tenant 1's order answered
  // 404, not 200").
  async function plane() {
    const seen = []
    let present = true
    const tenants = { 'clerk-1': '1', 'clerk-2': '2' }
    const stand = createServer((request, response) => {
      let text = ''
      request.on('data', (chunk) => (text += chunk))
      request.on('end', () => {
        const tenant = tenants[(request.headers.authorization ?? '').replace('Bearer ', '')]
        const body = text === '' ? undefined : JSON.parse(text)
        seen.push({ url: request.url, tenant, body, writeId: request.headers['formancy-write-id'] !== undefined })
        const answer = (status, json) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
        const visible = present && tenant === '1' && body?.record === 'k1:7'
        if (request.url.endsWith('/records/read')) return visible ? answer(200, { record: 'k1:7', version: '3', answers: {} }) : answer(404, { code: 'not-found', message: 'No such record.' })
        if (!visible || body?.version !== '3') return answer(404, { code: 'not-found', message: 'No such record.' })
        present = false
        return answer(200, { record: 'k1:7', deleted: true })
      })
    })
    await new Promise((ready) => stand.listen(0, '127.0.0.1', ready))
    return { seen, url: `http://127.0.0.1:${String(stand.address().port)}/`, close: () => new Promise((done) => stand.close(done)) }
  }

  test("tenant 2 is told not found, tenant 1 deletes the order, and it is then not found", async () => {
    const stand = await plane()
    try {
      await deleteOrder(stand.url, { clerk1: 'clerk-1', clerk2: 'clerk-2' }, 'pg-order-delete', 'k1:7', 'pg:')
      expect(stand.seen.map(({ url, tenant, body, writeId }) => [url, tenant, body?.version, writeId])).toEqual([
        ['/v1/forms/pg-order-delete/records/read', '1', undefined, false],
        ['/v1/forms/pg-order-delete/records/delete', '2', '3', true],
        ['/v1/forms/pg-order-delete/records/delete', '1', '3', true],
        ['/v1/forms/pg-order-delete/records/read', '1', undefined, false],
      ])
    } finally {
      await stand.close()
    }
  })

  // A delete another tenant could make, or one answered without the token,
  // is a sentence naming the request.
  test('names a delete another tenant made', async () => {
    const stand = await plane()
    try {
      await expect(deleteOrder(stand.url, { clerk1: 'clerk-1', clerk2: 'clerk-1' }, 'pg-order-delete', 'k1:7', 'pg:')).rejects.toThrow(/tenant 2 deleting tenant 1's order answered 200, not 404/)
    } finally {
      await stand.close()
    }
  })
})
