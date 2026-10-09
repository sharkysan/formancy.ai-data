import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { createDataClient } from './client.js'
import type { UnknownWrite } from './writes.js'

/*
 * What reconciling an unknown write concludes from the read it makes, and
 * when it makes none. The read's answers are played by a tiny `node:http`
 * server, over real HTTP through Node's fetch: what is under test is the
 * client's reasoning about an answer, not the database's, which
 * lost-answer.integration proves on both engines.
 */

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    }),
  )
})

/** A server answering every read with `status` and `body`, recording what it was asked. */
async function reading(status: number, body: unknown): Promise<{ base: string; asked: string[] }> {
  const asked: string[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      asked.push(`${request.method ?? ''} ${request.url ?? ''} ${Buffer.concat(chunks).toString('utf8')}`)
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, asked }
}

const unknown = (change: Partial<UnknownWrite>): UnknownWrite => ({
  ok: false,
  status: 502,
  code: 'unknown-outcome',
  message: 'It may have been saved.',
  operation: 'update',
  record: 'k1:7',
  version: 'v1',
  origin: 'database',
  ...change,
})

const stored = (version: string) => ({ record: 'k1:7', version, answers: { notes: 'as stored' } })

describe('reconcile', () => {
  // The record is still at the version the update sent: the change is not
  // visible -- it may never have arrived, or (PostgreSQL) may still commit
  // after a cut. Saving again with that same version is safe, because the
  // database stores it at most once; anything that called this "changed"
  // would send the person to a record their change is not in.
  test('an update whose record is still at the version sent is unchanged, from one read of that record', async () => {
    const { base, asked } = await reading(200, stored('v1'))
    expect(await createDataClient({ token: () => 't', base }).reconcile('pg-order', unknown({}))).toEqual({ ok: true, state: 'unchanged', current: stored('v1') })
    expect(asked).toEqual(['POST /v1/forms/pg-order/records/read {"record":"k1:7"}'])
  })

  // Moved: this save or somebody else's. Either way the draft is not what is
  // stored, and the host offers the stored record rather than a resend --
  // which would be stale anyway.
  test('an update whose record has moved on is changed', async () => {
    const { base } = await reading(200, stored('v2'))
    expect(await createDataClient({ token: () => 't', base }).reconcile('pg-order', unknown({}))).toEqual({ ok: true, state: 'changed', current: stored('v2') })
  })

  // A create whose key the insert named is found by the token the server
  // promised: there, and the host opens it; not there -- the read's 404 --
  // and creating again is safe, because the key stops a second row whichever
  // write lands first.
  test('a create with a known token is present when the read finds it, and absent on its 404', async () => {
    const created = unknown({ operation: 'create', record: 'k1:1,8', version: null })
    const found = await reading(200, { record: 'k1:1,8', version: null, answers: { name: 'Neu GmbH' } })
    expect(await createDataClient({ token: () => 't', base: found.base }).reconcile('pg-customer', created)).toEqual({
      ok: true,
      state: 'present',
      current: { record: 'k1:1,8', version: null, answers: { name: 'Neu GmbH' } },
    })
    const missing = await reading(404, { code: 'not-found', message: 'No such record.' })
    expect(await createDataClient({ token: () => 't', base: missing.base }).reconcile('pg-customer', created)).toEqual({ ok: true, state: 'absent' })
  })

  // A key the database numbers, or a create lost between the page and the
  // server, names no record: nothing here can find it, and a read of
  // nothing would only be refused in words about a request the person never
  // made. No request, and a state that says so.
  test('a create with no token is unverifiable, and nothing is asked', async () => {
    const { base, asked } = await reading(500, {})
    const client = createDataClient({ token: () => 't', base })
    expect(await client.reconcile('pg-order', unknown({ operation: 'create', record: null, version: null }))).toEqual({ ok: true, state: 'unverifiable' })
    expect(await client.reconcile('pg-order', unknown({ operation: 'create', record: null, version: null, origin: 'transport', status: 0 }))).toEqual({ ok: true, state: 'unverifiable' })
    expect(asked).toEqual([])
  })

  // A read that is refused says nothing about the write: a person who may
  // create and not read, a database out of reach. Calling that "absent"
  // would invite the duplicate; it is the read's own refusal, for the host
  // to say.
  test("a refused read is the read's refusal, never absent", async () => {
    const denied = await reading(403, { code: 'operation-denied', message: 'This form is not available to you.' })
    const created = unknown({ operation: 'create', record: 'k1:1,8', version: null })
    expect(await createDataClient({ token: () => 't', base: denied.base }).reconcile('pg-customer', created)).toEqual({
      ok: false,
      status: 403,
      code: 'operation-denied',
      message: 'This form is not available to you.',
    })
    const down = await reading(503, { code: 'unavailable', message: 'The database cannot be reached. Nothing was saved.' })
    expect(await createDataClient({ token: () => 't', base: down.base }).reconcile('pg-order', unknown({}))).toMatchObject({ ok: false, status: 503, code: 'unavailable' })
  })
})
