import { WRITE_ID_HEADER } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { createDataClient } from './client.js'

/*
 * What `deleteChosen` (0173) and `updateChosen` (0175) make of an answer,
 * and what `reconcileChosen` reads, over a fake `fetch`: the rules are the
 * client's, so a server that answers each case is a stand-in here, and
 * deletes.integration's cases ask the real one on both engines. Each
 * record is read by the rules a delete or an update of it alone is read by
 * (0031); the request as a whole by the same rules, so a lost one is
 * unknown for every record and never a refusal.
 */

const CHOSEN = [
  { record: 'k1:1', version: '7' },
  { record: 'k1:2', version: '8' },
  { record: 'k1:3', version: '9' },
]

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** A client whose every request is answered by `answer`, and the requests it sent. */
function clientAnswering(answer: (seen: Seen) => Response | Promise<Response>): { client: ReturnType<typeof createDataClient>; seen: Seen[] } {
  const seen: Seen[] = []
  const fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request: Seen = {
      url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    seen.push(request)
    return answer(request)
  }
  return { client: createDataClient({ token: () => 'the-token', fetch }), seen }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('deleteChosen', () => {
  // Exactly the route's one key, the records with their versions and
  // nothing else the caller's objects carry, in a POST to the route, with
  // the token in its header and a write id of its own, new for every call:
  // one id on two requests would answer the second with the first's answer.
  test('sends the records with their versions alone, and a new write id each time', async () => {
    const { client, seen } = clientAnswering(() => json(200, { records: CHOSEN.map(() => ({ sent: false })) }))
    await client.deleteChosen('ticket', { records: CHOSEN.map((entry) => ({ ...entry, note: 'not sent' })) })
    await client.deleteChosen('ticket', { records: CHOSEN })
    expect(seen.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: '/v1/forms/ticket/records/delete-chosen', method: 'POST', body: { records: CHOSEN } },
      { url: '/v1/forms/ticket/records/delete-chosen', method: 'POST', body: { records: CHOSEN } },
    ])
    expect(seen.map(({ headers }) => headers['authorization'])).toEqual(['Bearer the-token', 'Bearer the-token'])
    const ids = seen.map(({ headers }) => headers[WRITE_ID_HEADER])
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/)
    expect(ids[1]).not.toBe(ids[0])
  })

  // Each record is what `delete` would resolve to for it alone: the
  // server's deletion, a refusal in its words, the server's lost answer as
  // an unknown write naming the record and version sent; and a record the
  // server sent nothing for is `not-sent`, never deleted and never unknown.
  test('reads each record as a delete of it alone, and one not sent as not sent', async () => {
    const lost = { code: 'unknown-outcome', message: 'It may have been deleted.', operation: 'delete', record: 'k1:2', version: '8' }
    const { client } = clientAnswering(() =>
      json(200, {
        records: [{ sent: true, status: 200, body: { record: 'k1:1', deleted: true } }, { sent: true, status: 502, body: lost }, { sent: false }],
      }),
    )
    expect(await client.deleteChosen('ticket', { records: CHOSEN })).toEqual({
      ok: true,
      value: [
        { ok: true, value: { record: 'k1:1', deleted: true } },
        {
          ok: false,
          status: 502,
          code: 'unknown-outcome',
          message: 'It may have been deleted.',
          operation: 'delete',
          record: 'k1:2',
          version: '8',
          origin: 'database',
        },
        { ok: false, status: 0, code: 'not-sent', message: expect.stringMatching(/not sent, so it was not deleted/), record: 'k1:3', version: '9' },
      ],
    })
    const refused = clientAnswering(() =>
      json(200, {
        records: [
          { sent: true, status: 409, body: { code: 'stale', message: 'Changed.' } },
          { sent: true, status: 422, body: { code: 'referenced', message: 'Referred to.' } },
          { sent: true, status: 404, body: { code: 'not-found', message: 'No such record.' } },
        ],
      }),
    )
    expect(await refused.client.deleteChosen('ticket', { records: CHOSEN })).toEqual({
      ok: true,
      value: [
        { ok: false, status: 409, code: 'stale', message: 'Changed.' },
        { ok: false, status: 422, code: 'referenced', message: 'Referred to.' },
        { ok: false, status: 404, code: 'not-found', message: 'No such record.' },
      ],
    })
  })

  // A refusal of the request is nothing deleted, in the server's words --
  // the policy's 403, a record named twice with the token it names -- and
  // a database out of reach before anything was sent is the server's 503.
  test('reads a refusal of the request as nothing deleted, with the token a duplicate names', async () => {
    const denied = clientAnswering(() => json(403, { code: 'operation-denied', message: 'Not yours.' }))
    expect(await denied.client.deleteChosen('ticket', { records: CHOSEN })).toEqual({ ok: false, status: 403, code: 'operation-denied', message: 'Not yours.' })
    const twice = clientAnswering(() => json(400, { code: 'duplicate-record', message: 'Twice.', records: ['k1:1', 'k1:1', 'k1:elsewhere'] }))
    expect(await twice.client.deleteChosen('ticket', { records: CHOSEN })).toEqual({
      ok: false,
      status: 400,
      code: 'duplicate-record',
      message: 'Twice.',
      records: ['k1:1', 'k1:1'],
    })
    const unreached = clientAnswering(() => json(503, { code: 'unavailable', message: 'Nothing was saved.' }))
    expect(await unreached.client.deleteChosen('ticket', { records: CHOSEN })).toMatchObject({ ok: false, status: 503, code: 'unavailable' })
  })

  // An answer lost on the way -- nothing arrived, a proxy's page, a 2xx
  // that is not one entry per record -- may have deleted any of them: an
  // unknown delete naming every record with the version sent, from the
  // call's own arguments, never a refusal a page would show as "not
  // deleted", and nothing sent again.
  test('reads an answer lost on the way as unknown, naming every record with its version, and sends nothing again', async () => {
    const answers: Array<() => Response | Promise<Response>> = [
      () => Promise.reject(new TypeError('connection reset')),
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
      () => json(200, { records: [{ sent: false }] }),
      () => json(200, { records: [{ sent: true, status: 200 }, { sent: false }, { sent: false }] }),
      () => json(500, { code: 'internal', message: 'Something failed.' }),
    ]
    for (const answer of answers) {
      const { client, seen } = clientAnswering(answer)
      const outcome = await client.deleteChosen('ticket', { records: CHOSEN })
      expect(outcome).toMatchObject({ ok: false, code: 'unknown-outcome', operation: 'delete-chosen', records: CHOSEN, origin: 'transport' })
      expect(seen).toHaveLength(1)
    }
  })
})

describe('reconcileChosen', () => {
  // Each record read once, one after another, in the order sent: at the
  // version sent, it was not deleted; moved on, somebody changed it and it
  // was not deleted; gone, it was deleted, by this request or another. A
  // read refused is that record's refusal, and says nothing of the delete.
  test('reads each record once, in the order sent, and says what each shows', async () => {
    const reads: Record<string, Response> = {
      'k1:1': json(200, { record: 'k1:1', version: '7', answers: {} }),
      'k1:2': json(200, { record: 'k1:2', version: '10', answers: {} }),
      'k1:3': json(404, { code: 'not-found', message: 'No such record.' }),
    }
    const { client, seen } = clientAnswering(({ body }) => reads[(body as { record: string }).record] ?? json(500, {}))
    const unknown = {
      ok: false,
      status: 0,
      code: 'unknown-outcome',
      message: 'lost',
      operation: 'delete-chosen',
      records: CHOSEN,
      origin: 'transport',
    } as const
    expect(await client.reconcileChosen('ticket', unknown)).toEqual([
      { record: 'k1:1', reconciliation: { ok: true, state: 'unchanged', current: { record: 'k1:1', version: '7', answers: {} } } },
      { record: 'k1:2', reconciliation: { ok: true, state: 'changed', current: { record: 'k1:2', version: '10', answers: {} } } },
      { record: 'k1:3', reconciliation: { ok: true, state: 'absent' } },
    ])
    expect(seen.map(({ url, body }) => [url, body])).toEqual(CHOSEN.map(({ record }) => ['/v1/forms/ticket/records/read', { record }]))
  })
})

describe('updateChosen', () => {
  // Exactly the route's two keys: the records with their versions, and
  // the answers as given -- `null` clearing a field -- nothing else the
  // caller's objects carry, in a POST to the route, with a write id of its
  // own, new for every call. Watched failing with the answers left out of
  // the body: the route was sent a delete's body.
  test('sends the records with their versions and the answers, and a new write id each time', async () => {
    const { client, seen } = clientAnswering(() => json(200, { records: CHOSEN.map(() => ({ sent: false })) }))
    const answers = { note: 'swept', assignee: null }
    await client.updateChosen('ticket', { records: CHOSEN.map((entry) => ({ ...entry, title: 'not sent' })), answers })
    await client.updateChosen('ticket', { records: CHOSEN, answers })
    expect(seen.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: '/v1/forms/ticket/records/update-chosen', method: 'POST', body: { records: CHOSEN, answers } },
      { url: '/v1/forms/ticket/records/update-chosen', method: 'POST', body: { records: CHOSEN, answers } },
    ])
    const ids = seen.map(({ headers }) => headers[WRITE_ID_HEADER])
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/)
    expect(ids[1]).not.toBe(ids[0])
  })

  // Each record is what `update` would resolve to for it alone: the record
  // as stored, a refusal in its words -- a move its state does not allow
  // among them -- the server's lost answer as an unknown update naming the
  // record and version sent; and one not sent is `not-sent`, in a change's
  // words. A 200 that is not a record is no update the client can say was
  // stored, as for an update alone. Watched failing with each record read
  // as a delete: the record as stored was taken for no deletion and made
  // unknown.
  test('reads each record as an update of it alone, and one not sent as not sent', async () => {
    const stored = { record: 'k1:1', version: '8', answers: { note: 'swept' } }
    const lost = { code: 'unknown-outcome', message: 'It may have been saved.', operation: 'update', record: 'k1:2', version: '8' }
    const { client } = clientAnswering(() =>
      json(200, {
        records: [{ sent: true, status: 200, body: stored }, { sent: true, status: 502, body: lost }, { sent: false }],
      }),
    )
    expect(await client.updateChosen('ticket', { records: CHOSEN, answers: { note: 'swept' } })).toEqual({
      ok: true,
      value: [
        { ok: true, value: stored },
        {
          ok: false,
          status: 502,
          code: 'unknown-outcome',
          message: 'It may have been saved.',
          operation: 'update',
          record: 'k1:2',
          version: '8',
          origin: 'database',
        },
        { ok: false, status: 0, code: 'not-sent', message: expect.stringMatching(/not sent, so it was not changed/), record: 'k1:3', version: '9' },
      ],
    })
    const refused = clientAnswering(() =>
      json(200, {
        records: [
          { sent: true, status: 403, body: { code: 'transition-denied', message: 'status may not move from where it is.' } },
          { sent: true, status: 422, body: { code: 'declined', message: 'Closed tickets keep their note.' } },
          { sent: true, status: 200, body: { record: 'k1:3', deleted: true } },
        ],
      }),
    )
    expect(await refused.client.updateChosen('ticket', { records: CHOSEN, answers: { status: 'closed' } })).toEqual({
      ok: true,
      value: [
        { ok: false, status: 403, code: 'transition-denied', message: 'status may not move from where it is.' },
        { ok: false, status: 422, code: 'declined', message: 'Closed tickets keep their note.' },
        expect.objectContaining({ ok: false, code: 'unknown-outcome', operation: 'update', record: 'k1:3', version: '9', origin: 'transport' }),
      ],
    })
  })

  // A refusal of the request is nothing changed, in the server's words --
  // answers no codec takes, with their field errors -- and an answer lost
  // on the way an unknown change of every record, never a refusal, nothing
  // sent again. Watched failing with the delete's operation named on a
  // lost change: the unknown said `delete-chosen`, which `reconcileChosen`
  // reads as a deletion of every record.
  test('reads a refusal of the request as nothing changed, and an answer lost on the way as an unknown change of every record', async () => {
    const invalid = clientAnswering(() =>
      json(422, { code: 'invalid-values', message: 'note cannot be written', fieldErrors: [{ field: 'note', code: 'type', message: 'Expected text.' }] }),
    )
    expect(await invalid.client.updateChosen('ticket', { records: CHOSEN, answers: { note: 5 } })).toEqual({
      ok: false,
      status: 422,
      code: 'invalid-values',
      message: 'note cannot be written',
      fieldErrors: [{ field: 'note', code: 'type', message: 'Expected text.' }],
    })
    const { client, seen } = clientAnswering(() => Promise.reject(new TypeError('connection reset')))
    expect(await client.updateChosen('ticket', { records: CHOSEN, answers: { note: 'x' } })).toEqual({
      ok: false,
      status: 0,
      code: 'unknown-outcome',
      message: 'The answer to this change of chosen records was lost between this page and the data server. Any of them may have been changed.',
      operation: 'update-chosen',
      records: CHOSEN,
      origin: 'transport',
    })
    expect(seen).toHaveLength(1)
  })
})

describe('reconcileChosen after a change', () => {
  // A change whose answer was lost is reconciled as an update of each
  // record alone whose answer was lost (0031): at the version sent, not
  // changed; moved on, changed -- by this request or by somebody; and a
  // record gone is the read's own `not-found`, as a single update's
  // reconciliation answers it, since a change deletes nothing. Watched
  // failing with every record read as a deletion: the record gone was
  // called absent, deleted by this request.
  test('reads each record as an update whose answer was lost', async () => {
    const reads: Record<string, Response> = {
      'k1:1': json(200, { record: 'k1:1', version: '7', answers: {} }),
      'k1:2': json(200, { record: 'k1:2', version: '10', answers: {} }),
      'k1:3': json(404, { code: 'not-found', message: 'No such record.' }),
    }
    const { client } = clientAnswering(({ body }) => reads[(body as { record: string }).record] ?? json(500, {}))
    const unknown = {
      ok: false,
      status: 0,
      code: 'unknown-outcome',
      message: 'lost',
      operation: 'update-chosen',
      records: CHOSEN,
      origin: 'transport',
    } as const
    expect(await client.reconcileChosen('ticket', unknown)).toEqual([
      { record: 'k1:1', reconciliation: { ok: true, state: 'unchanged', current: { record: 'k1:1', version: '7', answers: {} } } },
      { record: 'k1:2', reconciliation: { ok: true, state: 'changed', current: { record: 'k1:2', version: '10', answers: {} } } },
      { record: 'k1:3', reconciliation: { ok: false, status: 404, code: 'not-found', message: 'No such record.' } },
    ])
  })
})
