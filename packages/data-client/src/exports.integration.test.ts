import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Outcome, RecordFile } from './client.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * A form's records as one CSV file through the client (0079), on both
 * engines, across real HTTP into the real server and its drivers. What the
 * file holds is the server's suites' business; what the client adds is
 * the route, the body, the bytes kept as they came, the name, and the
 * refusal's words, which are asked of the wire.
 */

let plane: Plane

beforeAll(async () => {
  plane = await startPlane()
})

afterAll(async () => {
  await plane?.close()
})

beforeEach(() => {
  plane.sent.length = 0
})

function expectFile(outcome: Outcome<RecordFile>): RecordFile {
  if (!outcome.ok) throw new Error(`expected a file, got ${String(outcome.status)} ${outcome.code}: ${outcome.message}`)
  return outcome.value
}

/** Tenant 1's seeded order, 2^53 + 1, as its Id cell. */
const TENANT_ONES_ORDER = '9007199254740993'

describe.each(ENGINES)('exports on $engine', ({ connection }) => {
  const formId = `${connection}-order`

  // The file is exactly the bytes the server answered -- the byte-order
  // mark, the CRLFs, the digits of 2^53 + 1 -- saved under the form's id,
  // and holds the tenant's own orders and none of another's.
  test("is the server's bytes, under the form's file name, of the tenant's own records", async () => {
    const mine = expectFile(await plane.client().exportRecords(formId))
    expect(mine.name).toBe(`${formId}.csv`)
    const bytes = Buffer.from(await mine.file.arrayBuffer())
    const direct = await fetch(`${plane.base}/v1/forms/${formId}/records/export`, { method: 'POST', headers: { authorization: `Bearer ${plane.tokens.clerk}`, 'content-type': 'application/json' }, body: '{}' })
    expect(bytes.equals(Buffer.from(await direct.arrayBuffer()))).toBe(true)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.toString('utf8')).toMatch(new RegExp(`\r\n${TENANT_ONES_ORDER},`))
    const theirs = expectFile(await plane.client(plane.tokens.otherClerk).exportRecords(formId))
    expect(Buffer.from(await theirs.file.arrayBuffer()).toString('utf8')).not.toContain(TENANT_ONES_ORDER)
  })

  // Exactly the route's three keys travel, in a POST body, so the search
  // is in no URL a proxy logs, and the token is in the header and nowhere
  // else -- whatever else the host's object carries. Watched failing on
  // both with the whole object sent: the server refused it 400 malformed.
  test('sends exactly the search, the sort and the parent, in the body of a POST, the token in the header only', async () => {
    const query = { search: 'placed', sort: [{ field: 'order_date', direction: 'desc' as const }], parent: null, offset: 50, limit: 10 }
    expectFile(await plane.client().exportRecords(formId, query))
    const [sent] = plane.sent
    expect(sent).toMatchObject({ method: 'POST', url: `${plane.base}/v1/forms/${formId}/records/export` })
    expect(JSON.parse(sent?.body ?? 'null')).toEqual({ search: 'placed', sort: [{ field: 'order_date', direction: 'desc' }], parent: null })
    expect(sent?.url).not.toContain('placed')
    expect(sent?.headers).toEqual({ authorization: `Bearer ${plane.tokens.clerk}`, accept: 'text/csv, application/json', 'content-type': 'application/json' })
    expect(sent?.body).not.toContain(plane.tokens.clerk)
  })

  // The server's refusal, passed through in its own words.
  test("a refusal comes back as the server's code and sentence", async () => {
    expect(await plane.client().exportRecords(formId, { sort: [{ field: 'customer', direction: 'asc' }] })).toEqual({
      ok: false,
      status: 400,
      code: 'not-sortable',
      message: 'customer is not a field you may sort this list by.',
    })
  })

  // Leaving the page aborts the download; the abort reaches the page as
  // the AbortError it raised, never as a refusal it would show.
  test('an abort rejects with the AbortError', async () => {
    const controller = new AbortController()
    const pending = plane.client().exportRecords(formId, {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
