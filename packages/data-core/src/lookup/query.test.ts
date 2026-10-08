import { narrowOptionsByLabel } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { MAX_SEARCH_LENGTH, validateLookupQuery } from './query.js'
import type { LookupConfig } from './types.js'

const CONFIG: LookupConfig = {
  source: 'erp-sales-order-fk-order-customer',
  foreignKey: 'fk_order_customer',
  target: { schema: 'sales', name: 'customer' },
  targetColumns: [
    { name: 'tenant_id', type: { kind: 'integer', min: '-2147483648', max: '2147483647' } },
    { name: 'customer_no', type: { kind: 'integer', min: '-2147483648', max: '2147483647' } },
  ],
  display: ['name'],
  search: ['name'],
  sort: [
    { column: 'name', direction: 'asc', nulls: 'last' },
    { column: 'tenant_id', direction: 'asc', nulls: 'last' },
    { column: 'customer_no', direction: 'asc', nulls: 'last' },
  ],
  maxPageSize: 50,
}

describe('validateLookupQuery', () => {
  // The adapter binds what this returns and nothing else. A query that passed
  // with its whitespace would search for the spaces somebody fumbled.
  test('accepts a bounded query and returns it trimmed', () => {
    expect(validateLookupQuery(CONFIG, { search: '  Acme AG ', offset: 0, limit: 50 })).toEqual({
      ok: true,
      query: { search: 'Acme AG', offset: 0, limit: 50 },
    })
    expect(validateLookupQuery(CONFIG, { search: '', offset: 100, limit: 1 })).toMatchObject({ ok: true })
  })

  // formancy's own narrowing treats an empty or whitespace query as no filter.
  // A database source that searched for the whitespace would make one control
  // behave two ways depending on where its list came from.
  test('a query formancy treats as no filter is no filter here', () => {
    const options = [{ value: 'a', label: 'Acme' }, { value: 'b', label: 'Beta' }]
    for (const search of ['', ' ', '\t\n ']) {
      expect(narrowOptionsByLabel(options, search)).toEqual(options)
      expect(validateLookupQuery(CONFIG, { search, offset: 0, limit: 10 })).toEqual({ ok: true, query: { search: '', offset: 0, limit: 10 } })
    }
  })

  // An unbounded page is the full-table load the lookup exists to avoid, and a
  // limit of zero or a fraction is a request no adapter can honour the same way.
  test('refuses a limit outside one to the configured page size', () => {
    for (const limit of [0, -1, 1.5, 51, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateLookupQuery(CONFIG, { search: '', offset: 0, limit }), String(limit)).toMatchObject({ ok: false, code: 'limit-out-of-range' })
    }
    expect(validateLookupQuery(CONFIG, { search: '', offset: 0, limit: '10' })).toMatchObject({ ok: false, code: 'limit-out-of-range' })
  })

  // A negative or fractional offset means something different to each engine's
  // OFFSET, or is an error in one and not the other.
  test('refuses an offset that is not a non-negative safe integer', () => {
    for (const offset of [-1, 0.5, Number.NaN, 2 ** 53, '0']) {
      expect(validateLookupQuery(CONFIG, { search: '', offset, limit: 10 }), String(offset)).toMatchObject({ ok: false, code: 'offset-out-of-range' })
    }
  })

  // A search string is bound into a LIKE pattern on a production database. Its
  // length is bounded before anything else reads it.
  test('refuses a search longer than the cap, and accepts one at it', () => {
    expect(validateLookupQuery(CONFIG, { search: 'x'.repeat(MAX_SEARCH_LENGTH), offset: 0, limit: 10 })).toMatchObject({ ok: true })
    expect(validateLookupQuery(CONFIG, { search: 'x'.repeat(MAX_SEARCH_LENGTH + 1), offset: 0, limit: 10 })).toMatchObject({
      ok: false,
      code: 'search-too-long',
    })
  })

  // A NUL is an error in PostgreSQL and an ordinary character in SQL Server:
  // the same search would fail on one engine and run on the other. Nobody
  // types a control character into a search box, so it is refused on both.
  test('refuses a control character or an unpaired surrogate inside the search', () => {
    for (const search of ['a\u0000b', 'a\u001bb', 'a\u007fb', 'a\u0085b', 'a\tb']) {
      expect(validateLookupQuery(CONFIG, { search, offset: 0, limit: 10 }), JSON.stringify(search)).toMatchObject({
        ok: false,
        code: 'search-control-character',
      })
    }
    expect(validateLookupQuery(CONFIG, { search: 'a\ud800', offset: 0, limit: 10 })).toMatchObject({ ok: false, code: 'ill-formed-text' })
  })

  // A lookup with no searchable column cannot honour a search. Answering with
  // the unfiltered first page would look like a search that matched everything.
  test('refuses a search on a lookup that has no searchable column', () => {
    const listOnly = { ...CONFIG, search: [] }
    expect(validateLookupQuery(listOnly, { search: 'Acme', offset: 0, limit: 10 })).toMatchObject({ ok: false, code: 'not-searchable' })
    expect(validateLookupQuery(listOnly, { search: '  ', offset: 0, limit: 10 })).toMatchObject({ ok: true })
  })

  // The query arrives from an HTTP body. Anything but exactly these three
  // properties is refused rather than ignored: a `filters` property that
  // was ignored today is one somebody reads tomorrow.
  test('refuses anything that is not exactly a search, an offset and a limit', () => {
    for (const query of [null, 'Acme', [], { search: 'a', offset: 0 }, { search: 1, offset: 0, limit: 10 }, { search: 'a', offset: 0, limit: 10, filters: [] }]) {
      expect(validateLookupQuery(CONFIG, query), JSON.stringify(query)).toMatchObject({ ok: false, code: 'malformed' })
    }
  })
})
