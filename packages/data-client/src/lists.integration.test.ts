import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Refusal } from './client.js'
import { LIST_PAGE_SIZE } from './index.js'
import type { FormRecord, RecordList, RecordListQuery } from './index.js'
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

  // Exactly the route's keys travel, in a POST body, so the search and a
  // filter's values are in no URL a proxy logs, and nothing else a host's
  // object carries rides along. Watched failing with the filter left out
  // of the body the client builds.
  test('sends exactly the query, in the body of a POST, the token in the header only', async () => {
    const filter = [{ field: 'notes', op: 'contains' as const, text: 'filter-marker-1d3c' }]
    const query = { search: 'placed', sort: [{ field: 'order_date', direction: 'desc' as const }], parent: null, filter, after: null, limit: 10, columns: ['tenant_id'], offset: 50 }
    expectOk(await plane.client().list(formId, query))
    const [sent] = plane.sent
    expect(sent).toMatchObject({ method: 'POST', url: `${plane.base}/v1/forms/${formId}/records/list` })
    expect(JSON.parse(sent?.body ?? 'null')).toEqual({ search: 'placed', sort: [{ field: 'order_date', direction: 'desc' }], parent: null, filter, after: null, limit: 10 })
    expect(sent?.url).not.toMatch(/placed|filter-marker/)
    expect(sent?.headers['authorization']).toBe(`Bearer ${plane.tokens.clerk}`)
    expect(sent?.body).not.toContain(plane.tokens.clerk)
  })

  // A person's filter (0104) is the server's to apply, in the database:
  // tenant 3's orders, noted `paged 01` onward in the order their keys
  // run, narrowed by notes a contains finds in another case and by a range
  // of keys, hold exactly the orders both conditions hold for -- read here
  // from the unfiltered pages through the same client, so the expectation
  // is the database's own rows. The form offers both conditions, in the
  // planner's words. Watched failing with the filter left out of the body
  // the client builds: the list held all 51 orders.
  test('a filtered list holds only the records every condition holds for', async () => {
    const third = plane.client(plane.tokens.thirdClerk)
    expect(expectOk(await third.form(formId)).list?.filterable).toEqual(
      expect.arrayContaining([
        { field: 'id', operators: ['equals', 'range'], input: 'integer', days: null },
        { field: 'notes', operators: ['equals', 'contains', 'null', 'not-null'], input: 'text', days: null },
      ]),
    )
    const pages = async (query: Partial<RecordListQuery>): Promise<FormRecord[]> => {
      const rows: FormRecord[] = []
      let after: string | null = null
      for (;;) {
        const page: RecordList = expectOk(await third.list(formId, { ...query, after }))
        rows.push(...page.rows)
        if (page.next === null) return rows
        after = page.next
      }
    }
    const notes = (rows: readonly FormRecord[]) => rows.map((row) => String(row.answers['notes']))
    const every = await pages({})
    const from = every.find((row) => row.answers['notes'] === 'paged 15')
    if (from === undefined) throw new Error('tenant 3 has an order noted paged 15')
    const first = BigInt(String(from.answers['id']))
    const kept = await pages({ filter: [{ field: 'notes', op: 'contains', text: ' PAGED 1 ' }, { field: 'id', op: 'range', from: String(first), to: null }] })
    expect(notes(kept)).toEqual(notes(every.filter((row) => String(row.answers['notes']).includes('paged 1') && BigInt(String(row.answers['id'])) >= first)))
    expect(notes(kept)).toEqual(['paged 15', 'paged 16', 'paged 17', 'paged 18', 'paged 19'])
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
  // than the bound, a sort by a field the list cannot be sorted by, and a
  // filter a field does not offer (0104) -- a lookup, and a value its
  // column cannot hold, said without the value.
  test("a refusal comes back as the server's code and sentence", async () => {
    expect(await plane.client().list(formId, { filter: [{ field: 'customer', op: 'equals', value: 'k1:1,1001' }] })).toEqual({
      ok: false,
      status: 400,
      code: 'not-filterable',
      message: 'customer is not a field you may filter this list by.',
    })
    expect(await plane.client().list(formId, { filter: [{ field: 'amount', op: 'equals', value: '1.23456' }] })).toEqual({
      ok: false,
      status: 400,
      code: 'not-filterable',
      message: 'A value given for amount is not one it can hold.',
    })
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
