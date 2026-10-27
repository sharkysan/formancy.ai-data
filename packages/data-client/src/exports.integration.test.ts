import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Outcome, RecordFile } from './client.js'
import type { RecordList } from './index.js'
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

function expectList(outcome: Outcome<RecordList>): RecordList {
  if (!outcome.ok) throw new Error(`expected a page, got ${String(outcome.status)} ${outcome.code}: ${outcome.message}`)
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

  // Exactly the route's four keys travel, in a POST body, so the search
  // and a filter's values are in no URL a proxy logs, and the token is in
  // the header and nowhere else -- whatever else the host's object
  // carries. Watched failing on both with the whole object sent: the
  // server refused it 400 malformed; and with the filter left out of the
  // body.
  test('sends exactly the search, the sort, the parent and the filter, in the body of a POST, the token in the header only', async () => {
    const filter = [{ field: 'notes', op: 'contains' as const, text: 'filter-marker-8e2f' }]
    const query = { search: 'placed', sort: [{ field: 'order_date', direction: 'desc' as const }], parent: null, filter, offset: 50, limit: 10 }
    expectFile(await plane.client().exportRecords(formId, query))
    const [sent] = plane.sent
    expect(sent).toMatchObject({ method: 'POST', url: `${plane.base}/v1/forms/${formId}/records/export` })
    expect(JSON.parse(sent?.body ?? 'null')).toEqual({ search: 'placed', sort: [{ field: 'order_date', direction: 'desc' }], parent: null, filter })
    expect(sent?.url).not.toMatch(/placed|filter-marker/)
    expect(sent?.headers).toEqual({ authorization: `Bearer ${plane.tokens.clerk}`, accept: 'text/csv, application/json', 'content-type': 'application/json' })
    expect(sent?.body).not.toContain(plane.tokens.clerk)
  })

  // A file under a filter holds the records the same filter's list does,
  // and no other (0104): tenant 3's orders whose notes hold `paged 1` in
  // any case, ten of fifty-one, in the list's order. Watched failing with
  // the filter left out of the body the client builds: the file held all
  // fifty-one.
  test("a filtered file holds the filtered list's records, and no other", async () => {
    const third = plane.client(plane.tokens.thirdClerk)
    const filter = [{ field: 'notes', op: 'contains' as const, text: 'Paged 1' }]
    const listed = expectList(await third.list(formId, { filter }))
    const text = Buffer.from(await expectFile(await third.exportRecords(formId, { filter })).file.arrayBuffer()).toString('utf8')
    const noted = text.split('\r\n').flatMap((line) => /\bpaged [0-9]+\b/.exec(line)?.[0] ?? [])
    expect(noted).toEqual(listed.rows.map((row) => String(row.answers['notes'])))
    expect(noted).toEqual(['paged 10', 'paged 11', 'paged 12', 'paged 13', 'paged 14', 'paged 15', 'paged 16', 'paged 17', 'paged 18', 'paged 19'])
  })

  // A refusal comes back as the server's code and sentence, which a page
  // shows as said. The export reads a 200 as bytes; a client that took a
  // refusal down that branch too would answer `unexpected`, and the person
  // would never learn why. A filter a field does not offer is refused as
  // a list refuses it (0104).
  test("a refusal comes back as the server's code and sentence", async () => {
    expect(await plane.client().exportRecords(formId, { sort: [{ field: 'customer', direction: 'asc' }] })).toEqual({
      ok: false,
      status: 400,
      code: 'not-sortable',
      message: 'customer is not a field you may sort this list by.',
    })
    expect(await plane.client().exportRecords(formId, { filter: [{ field: 'order_date', op: 'contains', text: '2026' }] })).toEqual({
      ok: false,
      status: 400,
      code: 'not-filterable',
      message: 'order_date offers no contains condition.',
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
