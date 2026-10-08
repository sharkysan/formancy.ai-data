import { acceptRemoteOptions } from '@formancy/spec'
import { describe, expect, test } from 'vitest'
import { lookupKeys, lookupPage, rejectedTokens, resolvedRows } from './rows.js'
import type { FoundRow } from './rows.js'
import { encodeKeyToken } from './token.js'
import type { LookupConfig } from './types.js'

const CUSTOMER: LookupConfig = {
  source: 'erp-sales-order-fk-order-customer',
  foreignKey: 'fk_order_customer',
  target: { schema: 'sales', name: 'customer' },
  targetColumns: ['tenant_id', 'customer_no'],
  display: ['name'],
  search: ['name'],
  sort: [
    { column: 'name', direction: 'asc' },
    { column: 'tenant_id', direction: 'asc' },
    { column: 'customer_no', direction: 'asc' },
  ],
  maxPageSize: 50,
}

function tokenOf(key: readonly string[]): string {
  const encoded = encodeKeyToken(key)
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}

function row(tenant: string, number: string, name: string | null): FoundRow {
  return { key: [tenant, number], display: [name] }
}

/** A key no token can hold: two hundred characters of it, before the prefix. */
const UNREPRESENTABLE = ['7', 'x'.repeat(200)]

describe('lookupKeys', () => {
  // The adapter binds these into an IN clause. A token that does not decode,
  // or decodes to the wrong number of columns, cannot name a row of this
  // lookup, and binding it anyway would be an error on one engine and a quiet
  // non-match on the other.
  test('decodes the tokens that can name a row of this lookup, each once, in the order they came', () => {
    const tokens = [tokenOf(['7', '1001']), 'garbage', tokenOf(['7']), tokenOf(['7', '1002']), tokenOf(['7', '1001']), 'k1:7,1001,9']
    expect(lookupKeys(CUSTOMER, tokens)).toEqual([
      ['7', '1001'],
      ['7', '1002'],
    ])
  })

  // `IN ()` is a syntax error in both engines. An empty list is the adapter's
  // cue to ask the database nothing.
  test('is empty when nothing can be asked', () => {
    expect(lookupKeys(CUSTOMER, [])).toEqual([])
    expect(lookupKeys(CUSTOMER, ['k1:', 'x'])).toEqual([])
  })
})

describe('lookupPage', () => {
  // A COUNT over a large lookup table costs a scan, every keystroke. Fetching
  // one row more than the page tells whether there is more for the price of a row.
  test('reads one row past the page as "there is more", and does not show it', () => {
    const fetched = [row('7', '1', 'Acme'), row('7', '2', 'Beta'), row('7', '3', 'Gamma')]
    expect(lookupPage(fetched, 2)).toEqual({
      rows: [
        { token: 'k1:7,1', label: 'Acme' },
        { token: 'k1:7,2', label: 'Beta' },
      ],
      hasMore: true,
      omitted: 0,
    })
    expect(lookupPage(fetched, 3)).toMatchObject({ hasMore: false })
    expect(lookupPage([], 10)).toEqual({ rows: [], hasMore: false, omitted: 0 })
  })

  // A row whose key does not fit a token cannot be chosen. Dropping it silently
  // would look exactly like a table that does not have it, so it is counted.
  test('counts a row it cannot offer instead of dropping it silently', () => {
    const page = lookupPage([row('7', '1', 'Acme'), { key: UNREPRESENTABLE, display: ['Too long'] }], 5)
    expect(page.rows.map((entry) => entry.label)).toEqual(['Acme'])
    expect(page.omitted).toBe(1)
  })

  // formancy refuses a whole list when one value repeats. A page with one key
  // twice is an adapter that joined wrongly, and it is refused here, where the
  // message can name it, rather than as an empty control in the browser.
  test('refuses a page that holds one key twice', () => {
    expect(() => lookupPage([row('7', '1', 'Acme'), row('7', '1', 'Acme again')], 5)).toThrow(/k1:7,1 appears twice/)
  })

  // What the browser receives has to pass formancy's own check, or the whole
  // list is refused there: NULL names, blank names and awkward keys included.
  test('every page passes formancy\'s check on a remote list', () => {
    const fetched = [row('7', '1', 'Acme'), row('7', '2', null), row('7', '3', '   '), row('', 'a,b', 'Comma'), row('7', 'Zürich', 'Ü')]
    const page = lookupPage(fetched, 10)
    expect(acceptRemoteOptions(page.rows.map((entry) => ({ value: entry.token, label: entry.label })))).toHaveLength(fetched.length)
  })
})

describe('rejectedTokens', () => {
  // The adapter's query carries the actor's filters, so another tenant's row
  // is not among what it found — though the row exists, and its key is easy
  // to guess. Membership is "found under this actor's filters", nothing wider.
  test('rejects every token no found row encodes to, including an existing row outside the filters', () => {
    const own = tokenOf(['7', '1001'])
    const otherTenant = tokenOf(['8', '1001'])
    const invented = tokenOf(['7', '9999'])
    expect(rejectedTokens([own, otherTenant, invented, 'garbage'], [['7', '1001']])).toEqual([otherTenant, invented, 'garbage'])
  })

  // Under a case-insensitive collation `IN ('acme')` finds the row stored as
  // 'ACME', and SQL Server's `=` ignores trailing spaces. The token the person
  // submitted is then not the token the lookup offered, so it is not accepted
  // on the database's say-so: tokens are compared exactly, after re-encoding
  // what the row actually holds.
  test('rejects a token the database matched under a different spelling', () => {
    expect(rejectedTokens([tokenOf(['acme']), tokenOf(['ACME'])], [['ACME']])).toEqual([tokenOf(['acme'])])
    expect(rejectedTokens([tokenOf(['a ']), tokenOf(['a'])], [['a']])).toEqual([tokenOf(['a '])])
  })

  // formancy marks a field once per rejected value; a duplicate would mark it twice.
  test('names each rejected token once, in the order it was submitted', () => {
    expect(rejectedTokens(['b', 'a', 'b'], [])).toEqual(['b', 'a'])
    expect(rejectedTokens([], [['7', '1']])).toEqual([])
  })

  // A found key no token can hold is not a member of anything: no submission
  // can have named it, and it must not crash the answer for the others.
  test('ignores a found key that no token can hold', () => {
    expect(rejectedTokens([tokenOf(['7', '1'])], [UNREPRESENTABLE, ['7', '1']])).toEqual([])
  })
})

describe('resolvedRows', () => {
  // A resumed form holds tokens the first page may not show. Each one that
  // still names a row this actor may see gets its label; the rest are left
  // out, and formancy shows the stored value — never another row's name.
  test('labels the tokens a found row encodes to exactly, each once, in the order they came', () => {
    const found = [row('7', '2', 'Beta'), row('7', '1', 'Acme'), row('7', '3', null), { key: UNREPRESENTABLE, display: ['Too long'] }]
    const tokens = [tokenOf(['7', '1']), tokenOf(['7', '9']), tokenOf(['7', '2']), tokenOf(['7', '1']), tokenOf(['7', '3'])]
    expect(resolvedRows(tokens, found)).toEqual([
      { token: 'k1:7,1', label: 'Acme' },
      { token: 'k1:7,2', label: 'Beta' },
      { token: 'k1:7,3', label: '7 · 3' },
    ])
    expect(resolvedRows([tokenOf(['acme'])], [{ key: ['ACME'], display: ['Acme'] }])).toEqual([])
  })
})
