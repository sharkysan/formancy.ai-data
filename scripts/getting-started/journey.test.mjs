import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { checkedRecord } from '../release-report/collect.mjs'
import { composedServer, writeServerRecord } from './journey.mjs'

/**
 * The getting-started journey's record of each composed database (0035),
 * held to the shape collect.mjs reads from data-fixtures. The server is a
 * loopback HTTP server answering the administrator plane's connection test
 * as the data server does, `{ kind, version }`: what is checked here is the
 * record the journey makes of that answer, not the database.
 */
let server
let base
const asked = []

beforeAll(async () => {
  server = createServer((request, response) => {
    asked.push({ method: request.method, url: request.url, authorization: request.headers.authorization })
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ kind: 'sqlserver', version: '16.0.4295.3' }))
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
