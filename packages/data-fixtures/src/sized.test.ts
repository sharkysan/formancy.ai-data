import { describe, expect, test } from 'vitest'
import {
  FIXTURE_CUSTOMERS,
  SIZED_CUSTOMERS,
  sizedChunk,
  sizedCustomer,
  sizedCustomerRows,
  sizedDigest,
  sizedLookupPage,
  sizedReadBack,
  sizedResolveKeys,
  sizedRowsRead,
  sizedTableRows,
  sizedTerms,
} from './sized.js'
import type { SizedRow } from './sized.js'

/*
 * The sized `sales.customer` (0034) as a pure function: one generator both
 * engines are loaded from and every expectation is computed from. Nothing
 * here touches a database; the integration suites hold the engines to it.
 */

/** Every row of one tenant the sized table holds, the fixture's included, in key order. */
function tenantRows(tenant: number): SizedRow[] {
  return [...sizedTableRows()].filter((row) => row.tenantId === tenant)
}

const key = (row: SizedRow): string => `(${String(row.tenantId)},${String(row.customerNo)})`

describe('the generated customers', () => {
  // The loader and every expectation each call the generator; a generator
  // that depended on anything but its index (a clock, a random number, a
  // cache warmed by an earlier call) would load one table and expect another.
  test('are the same rows every time', () => {
    expect(sizedDigest(sizedCustomerRows())).toBe(sizedDigest(sizedCustomerRows()))
    expect(sizedCustomer(123_456)).toEqual(sizedCustomer(123_456))
  })

  // The sizes 0034 states: a tenth of the table in the measured clerk's
  // tenant and the rest in the other, each numbered from 1,000,001 in key
  // order, so the fixture's own customer 1001 sorts before them.
  test('are 1,000,000 rows, 100,000 in tenant 1 and 900,000 in tenant 2, in key order', () => {
    const counts = new Map<number, number>()
    let previous: SizedRow | undefined
    for (const row of sizedCustomerRows()) {
      counts.set(row.tenantId, (counts.get(row.tenantId) ?? 0) + 1)
      if (previous !== undefined) {
        const ascending = row.tenantId > previous.tenantId || (row.tenantId === previous.tenantId && row.customerNo > previous.customerNo)
        if (!ascending) throw new Error(`${key(row)} follows ${key(previous)}`)
      }
      previous = row
    }
    expect(Object.fromEntries(counts)).toEqual({ 1: 100_000, 2: 900_000 })
    expect(SIZED_CUSTOMERS.rows).toBe(1_000_000)
    expect(sizedCustomer(0)).toMatchObject({ tenantId: 1, customerNo: 1_000_001 })
    expect(sizedCustomer(99_999)).toMatchObject({ tenantId: 1, customerNo: 1_100_000 })
    expect(sizedCustomer(100_000)).toMatchObject({ tenantId: 2, customerNo: 1_000_001 })
    expect(sizedCustomer(999_999)).toMatchObject({ tenantId: 2, customerNo: 1_900_000 })
    expect(() => sizedCustomer(1_000_000)).toThrow(/0 to 999999/)
  })

  // The table the suites load is the generated rows and the fixture's two
  // customers, merged by key; the read-back and its digest are of exactly that.
  test('merge with the fixture customers in key order', () => {
    const table = [...sizedTableRows()]
    expect(table).toHaveLength(1_000_002)
    expect(table.slice(0, 2).map(key)).toEqual(['(1,1001)', '(1,1000001)'])
    expect(table.slice(100_000, 100_003).map(key)).toEqual(['(1,1100000)', '(2,1001)', '(2,1000001)'])
    expect(FIXTURE_CUSTOMERS.map(key)).toEqual(['(1,1001)', '(2,1001)'])
  })

  // A contains-search for a full name must find exactly one row, and the
  // test that pins it relies on names being unique. Case-insensitively,
  // because SQL Server's collation compares that way: two names that differ
  // only in case would be one key's worth of ambiguity on one engine only.
  // Uniqueness rests on the multiplier being coprime to 10^6.
  test('have names unique case-insensitively across the table', () => {
    const seen = new Set<string>()
    for (const row of sizedTableRows()) {
      const folded = row.name.toLowerCase()
      if (seen.has(folded)) throw new Error(`${row.name} ${key(row)} repeats a name`)
      seen.add(folded)
    }
    expect(seen.size).toBe(1_000_002)
  })

  // Words are ASCII letters, single spaces between them: no hyphen a Windows
  // collation ignores, no digit, no accent either engine folds its own way.
  test('spell every name in ASCII letters and single spaces', () => {
    for (const row of sizedCustomerRows()) {
      if (!/^[A-Za-z]+( [A-Za-z]+){3}$/.test(row.name)) throw new Error(`${row.name} ${key(row)} is not four ASCII words`)
    }
  })

  // PostgreSQL on musl orders text by code point; SQL Server's CI collation
  // orders it case-insensitively. Both first pages equal one expectation only
  // if the two orders agree on every pair of names a tenant-1 lookup can
  // compare, 'Muster AG' included. A word starting in lower case, or a legal
  // form that shares a first letter with another, breaks it.
  test("tenant 1's names sort the same by code point and case-insensitively", () => {
    const names = tenantRows(1).map((row) => row.name)
    const byCodePoint = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const folded = (name: string): string => name.toLowerCase()
    const byFolded = [...names].sort((a, b) => (folded(a) < folded(b) ? -1 : folded(a) > folded(b) ? 1 : 0))
    expect(names).toContain('Muster AG')
    const firstDifference = byCodePoint.findIndex((name, index) => name !== byFolded[index])
    expect(firstDifference, `first disagreement: ${String(byCodePoint[firstDifference])} against ${String(byFolded[firstDifference])}`).toBe(-1)
  })
})

describe('the search terms', () => {
  // An absent term must miss every row, or the "nothing found" measurement
  // answers a page and measures something else.
  test('absent matches no name', () => {
    const { absent } = sizedTerms()
    for (const row of sizedTableRows()) if (row.name.toLowerCase().includes(absent)) throw new Error(`${row.name} contains ${absent}`)
    expect(sizedLookupPage(1, absent, 50)).toEqual({ rows: [], hasMore: false, matched: 0 })
  })

  // A unique term matches one row in the whole table, both tenants: a
  // stem that ends in another stem would make a full name a substring of a
  // second one, and the one-row answer would be two.
  test('unique matches exactly one name in the table, tenant 1 row 50,000', () => {
    const { unique } = sizedTerms()
    const needle = unique.toLowerCase()
    const matches = [...sizedTableRows()].filter((row) => row.name.toLowerCase().includes(needle))
    expect(matches).toEqual([sizedCustomer(50_000)])
    expect(matches[0]).toMatchObject({ tenantId: 1, customerNo: 1_050_001 })
  })

  // A common term must fill the page and still have more, or "a search that
  // matches many" measures a short page.
  test('common matches at least 51 names in tenant 1', () => {
    const { common } = sizedTerms()
    const page = sizedLookupPage(1, common, 50)
    expect(page.matched).toBeGreaterThanOrEqual(51)
    expect(page.rows).toHaveLength(50)
    expect(page.hasMore).toBe(true)
  })
})

describe('sizedLookupPage', () => {
  // The expectation both engines' first pages are held to: lower-cased name
  // in code-point order, then the key. A page that ordered by raw code point
  // would put every 'Z…' before 'a…' if a lower-case initial ever appeared.
  test('orders by lower-cased name, then by key, and says when there is more', () => {
    const page = sizedLookupPage(1, '', 50)
    expect(page.rows).toHaveLength(50)
    expect(page.hasMore).toBe(true)
    expect(page.matched).toBe(100_001)
    const all = tenantRows(1)
      .map((row) => ({ ...row, folded: row.name.toLowerCase() }))
      .sort((a, b) => (a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : a.customerNo - b.customerNo))
      .slice(0, 50)
      .map(({ folded: _, ...row }) => row)
    expect(page.rows).toEqual(all)
    for (let index = 1; index < page.rows.length; index += 1) {
      const [before, after] = [page.rows[index - 1] as SizedRow, page.rows[index] as SizedRow]
      expect(before.name.toLowerCase() <= after.name.toLowerCase(), `${before.name} before ${after.name}`).toBe(true)
    }
  })

  // Matching is case-insensitive, as ILIKE and a CI collation's LIKE are; a
  // search typed in capitals finds what the lower-case one finds.
  test('matches case-insensitively and only within the tenant', () => {
    expect(sizedLookupPage(1, 'BAU', 50)).toEqual(sizedLookupPage(1, 'bau', 50))
    expect(sizedLookupPage(1, 'Muster AG', 50).rows).toEqual([FIXTURE_CUSTOMERS[0]])
    expect(sizedLookupPage(1, 'Other Tenant', 50).rows).toEqual([])
    expect(sizedLookupPage(2, 'Other Tenant', 50).rows).toEqual([FIXTURE_CUSTOMERS[1]])
  })

  // A page exactly full has no more: the adapters fetch limit + 1 to tell,
  // and an expectation that said "more" for an exact fit would fail an
  // engine that answered correctly.
  test('a page exactly full has no more', () => {
    expect(sizedLookupPage(1, 'Muster AG', 1)).toEqual({ rows: [FIXTURE_CUSTOMERS[0]], hasMore: false, matched: 1 })
    expect(sizedLookupPage(1, 'bau', 50).rows.map((row) => row.customerNo)).toEqual(sizedLookupPage(1, 'bau', 51).rows.slice(0, 50).map((row) => row.customerNo))
  })
})

describe('sizedRowsRead', () => {
  // Both adapters' sized suites pin these and the performance page prints
  // them. Counted here over the rows the table holds, not restated: a count
  // typed into sizedRowsRead that drifted from the generator would hold both
  // engines, and the page, to a table nobody loads.
  test("counts tenant 1's rows and the table's, the fixture's own included", () => {
    expect(sizedRowsRead()).toEqual({ tenant: tenantRows(1).length, table: [...sizedTableRows()].length, perKey: 1 })
  })
})

describe('sizedResolveKeys', () => {
  // Spread across tenant 1's range so a resolve of many keys does not read
  // one page of the index; at most 100, the route's own limit per request.
  test('spreads n tenant-1 keys 1,000 apart, at most 100', () => {
    expect(sizedResolveKeys(3)).toEqual([
      { tenantId: 1, customerNo: 1_000_001 },
      { tenantId: 1, customerNo: 1_001_001 },
      { tenantId: 1, customerNo: 1_002_001 },
    ])
    expect(sizedResolveKeys(100).at(-1)).toEqual({ tenantId: 1, customerNo: 1_099_001 })
    expect(() => sizedResolveKeys(101)).toThrow(/1 to 100/)
    expect(() => sizedResolveKeys(0)).toThrow(/1 to 100/)
  })
})

describe('sizedChunk', () => {
  // Both loaders insert from this one text. A chunk that skipped or repeated
  // its boundary row, or spelled country by tenant instead of by row, would
  // load a table the read-back refuses only after minutes of loading; here it
  // fails at once.
  test('is rows from to to as {t, n, m, c}, country alternating by row index', () => {
    expect(JSON.parse(sizedChunk(99_999, 100_001))).toEqual([
      { t: 1, n: 1_100_000, m: sizedCustomer(99_999).name, c: 'DE' },
      { t: 2, n: 1_000_001, m: sizedCustomer(100_000).name, c: 'CH' },
    ])
    expect(JSON.parse(sizedChunk(0, 0))).toEqual([])
  })
})

describe('sizedDigest', () => {
  // The read-back compares row by row; the digest is what a result records.
  // It must change with any one name, or two different tables record alike.
  test('changes when one name changes', () => {
    const rows = [...FIXTURE_CUSTOMERS]
    const changed = rows.map((row, index) => (index === 1 ? { ...row, name: `${row.name}x` } : row))
    expect(sizedDigest(rows)).not.toBe(sizedDigest(changed))
    expect(sizedDigest(rows)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('sizedReadBack', () => {
  // The whole table, read back as the generator says, passes and reports what
  // a load returns: the counts 0034 states and the digest of every row.
  test('accepts the table the generator describes', () => {
    const readBack = sizedReadBack()
    for (const row of sizedTableRows()) readBack.take(row)
    expect(readBack.finish()).toEqual({ rows: 1_000_002, perTenant: { 1: 100_001, 2: 900_001 }, digest: sizedDigest(sizedTableRows()) })
  })

  // Each way a loaded table can be wrong is refused at the row where it
  // first is, naming the key, so a failed load says which chunk to look at:
  // a row out of place or missing, a name changed, rows that never came, and
  // a row the generator never made.
  test('refuses the first row that differs, naming its key', () => {
    const misplaced = sizedReadBack()
    misplaced.take({ tenantId: 1, customerNo: 1001, name: 'Muster AG' })
    expect(() => misplaced.take({ tenantId: 1, customerNo: 1_000_002, name: sizedCustomer(1).name })).toThrow('sales.customer holds (1, 1000002) where the generator expects (1, 1000001)')

    const renamed = sizedReadBack()
    expect(() => renamed.take({ tenantId: 1, customerNo: 1001, name: 'Muster GmbH' })).toThrow('sales.customer (1, 1001) is named "Muster GmbH", the generator expects "Muster AG"')

    const short = sizedReadBack()
    short.take({ tenantId: 1, customerNo: 1001, name: 'Muster AG' })
    expect(() => short.finish()).toThrow('sales.customer ends before (1, 1000001), which the generator expects')
  })

  test('refuses a row after the last one the generator expects', () => {
    const extra = sizedReadBack()
    for (const row of sizedTableRows()) extra.take(row)
    expect(() => extra.take({ tenantId: 3, customerNo: 1, name: 'Extra AG' })).toThrow('sales.customer holds (3, 1) after the last row the generator expects')
  })
})
