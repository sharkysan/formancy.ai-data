import { describe, expect, test } from 'vitest'
import { validateListQuery } from '../records/list-query.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { DEFAULT_MAX_PAGE_SIZE } from './config.js'
import { validateLookupQuery } from './query.js'
import { MAX_SEARCH_LENGTH } from './search.js'
import type { LookupConfig } from './types.js'

/*
 * One search, two places it is typed into: a lookup's select and a form's
 * record list (0044). Each case goes through both validators and must come
 * out the same -- the same trimmed text, or the same refusal -- so the same
 * keystrokes never mean one thing in a select and another in a grid.
 */

const NAME = { name: 'name', type: { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false } } as const
const CONFIG: LookupConfig = {
  source: 'erp-sales-order-fk-order-customer',
  foreignKey: 'fk_order_customer',
  target: { schema: 'sales', name: 'customer' },
  targetColumns: [{ name: 'customer_no', type: { kind: 'integer', min: '-2147483648', max: '2147483647' } }],
  display: [NAME],
  search: [NAME],
  sort: [{ column: 'customer_no', direction: 'asc', nulls: 'last' }],
  maxPageSize: DEFAULT_MAX_PAGE_SIZE,
}

/** What each validator made of one search and one page size: the trimmed text, or the code it refused with. A list has no offset (0108); a lookup's is 0. */
function bothSay(search: unknown, limit: unknown = 10): { lookup: string; list: string } {
  const lookup = validateLookupQuery(CONFIG, { search, offset: 0, limit })
  const list = validateListQuery({ search, limit })
  return { lookup: lookup.ok ? `ok:${lookup.query.search}` : lookup.code, list: list.ok ? `ok:${list.query.search}` : list.code }
}

describe('checkSearch and checkPage, through both validators', () => {
  // The cases each validator's own suite pins, each now asked of both: a
  // search formancy treats as none, one at and past the length bound, a
  // control character, a NUL -- an error on PostgreSQL and a character on
  // SQL Server -- an unpaired surrogate, and a search that is not text.
  // Watched failing with the list's search checked only for being text.
  test.each([
    ['  Acme AG ', 'ok:Acme AG'],
    ['', 'ok:'],
    ['\t\n ', 'ok:'],
    ['x'.repeat(MAX_SEARCH_LENGTH), `ok:${'x'.repeat(MAX_SEARCH_LENGTH)}`],
    ['x'.repeat(MAX_SEARCH_LENGTH + 1), 'search-too-long'],
    ['a\u0000b', 'search-control-character'],
    ['a\u001bb', 'search-control-character'],
    ['a\u0085b', 'search-control-character'],
    ['a\tb', 'search-control-character'],
    ['a\ud800', 'ill-formed-text'],
    [7, 'malformed'],
    [null, 'malformed'],
  ])('%j is %s in a lookup and in a list', (search, said) => {
    expect(bothSay(search)).toEqual({ lookup: said, list: said })
  })

  // A page's size is a LIMIT on both engines, in a select and in a grid:
  // one bound, the same refusals. LIST_PAGE_SIZE is a lookup's default page
  // size so that the bound is one number. Where a page starts differs: a
  // lookup's at an offset, a list's after a cursor (0108).
  test.each([
    [1, 'ok:'],
    [LIST_PAGE_SIZE, 'ok:'],
    [0, 'limit-out-of-range'],
    [1.5, 'limit-out-of-range'],
    [LIST_PAGE_SIZE + 1, 'limit-out-of-range'],
    ['10', 'limit-out-of-range'],
  ])('a limit of %j is %s in a lookup and in a list', (limit, said) => {
    expect(LIST_PAGE_SIZE).toBe(CONFIG.maxPageSize)
    expect(bothSay('', limit)).toEqual({ lookup: said, list: said })
  })
})
