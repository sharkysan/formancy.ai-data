import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Refusal } from './client.js'
import { LIST_PAGE_SIZE } from './index.js'
import { ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * A form's records a page at a time through the client (0044), on both
 * engines, across real HTTP into the real server and its drivers. Whose rows
 * a page holds is a database answer under the policy, so it is asked of the
 * databases; what the client adds is the route, the body and the refusal's
 * words, which are asked of the wire.
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

function expectOk<T>(outcome: { ok: true; value: T } | Refusal): T {
  if (!outcome.ok) throw new Error(`expected success, got ${String(outcome.status)} ${outcome.code}: ${outcome.message}`)
  return outcome.value
}

/** Tenant 1's seeded order, 2^53 + 1. */
const TENANT_ONES_ORDER = 'k1:9007199254740993'

describe.each(ENGINES)('lists on $engine', ({ connection }) => {
  const formId = `${connection}-order`

  // A tenant's clerk is listed their tenant's orders, and the other tenant's
  // clerk none of them: the same route, the same body, two answers the
  // database decides under each one's filter. And the form says what the
  // list may be searched and sorted by.
  test("lists a tenant's own records, and none of another tenant's", async () => {
    expect(expectOk(await plane.client().form(formId)).list).toMatchObject({ sortable: expect.arrayContaining(['id', 'order_date', 'amount']) })
    const mine = expectOk(await plane.client().list(formId))
    expect(mine.rows.map((row) => row.record)).toContain(TENANT_ONES_ORDER)
    const theirs = expectOk(await plane.client(plane.tokens.otherClerk).list(formId))
    expect(theirs.rows.map((row) => row.record)).not.toContain(TENANT_ONES_ORDER)
    // Each row is what a read of its token returns.
    const first = mine.rows[0]
    if (first === undefined || first.record === null) throw new Error('tenant 1 has an order')
    expect(expectOk(await plane.client().read(formId, first.record))).toEqual(first)
  })

  // Exactly the route's keys travel, in a POST body, so the search is in no
  // URL a proxy logs, and nothing else a host's object carries rides along.
  test('sends exactly the query, in the body of a POST, the token in the header only', async () => {
    const query = { search: 'placed', sort: [{ field: 'order_date', direction: 'desc' as const }], parent: null, offset: 0, limit: 10, columns: ['tenant_id'] }
    expectOk(await plane.client().list(formId, query))
    const [sent] = plane.sent
    expect(sent).toMatchObject({ method: 'POST', url: `${plane.base}/v1/forms/${formId}/records/list` })
    expect(JSON.parse(sent?.body ?? 'null')).toEqual({ search: 'placed', sort: [{ field: 'order_date', direction: 'desc' }], parent: null, offset: 0, limit: 10 })
    expect(sent?.url).not.toContain('placed')
    expect(sent?.headers['authorization']).toBe(`Bearer ${plane.tokens.clerk}`)
    expect(sent?.body).not.toContain(plane.tokens.clerk)
  })

  // A grid's next page aborts the one it no longer shows; the abort reaches
  // the page as the AbortError it raised, never as a refusal it would show.
  test('an abort rejects with the AbortError', async () => {
    const controller = new AbortController()
    const pending = plane.client().list(formId, {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  // The server's refusal, passed through in its own words: a page larger
  // than the bound, and a sort by a field the list cannot be sorted by.
  test("a refusal comes back as the server's code and sentence", async () => {
    expect(await plane.client().list(formId, { limit: LIST_PAGE_SIZE + 1 })).toEqual({
      ok: false,
      status: 400,
      code: 'limit-out-of-range',
      message: `The limit is a whole number from 1 to ${String(LIST_PAGE_SIZE)}.`,
    })
    expect(await plane.client().list(formId, { sort: [{ field: 'customer', direction: 'asc' }] })).toEqual({
      ok: false,
      status: 400,
      code: 'not-sortable',
      message: 'customer is not a field you may sort this list by.',
    })
  })
})
