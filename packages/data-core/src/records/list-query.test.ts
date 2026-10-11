import { describe, expect, test } from 'vitest'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { validateListQuery } from './list-query.js'

/*
 * A list request's body at the boundary (0044). What the text and the page
 * may be is a lookup's, and search.test.ts holds the two to each other; this
 * holds what is a list's own -- the defaults, the order and the parent -- and
 * that nothing else a body carries gets through.
 */
describe('validateListQuery', () => {
  // A grid opening sends almost nothing; what it leaves out is the first
  // page in key order, of the largest page the server serves.
  test('fills what a body leaves out, and returns a fresh query', () => {
    expect(validateListQuery({})).toEqual({ ok: true, query: { search: '', sort: [], parent: null, offset: 0, limit: LIST_PAGE_SIZE } })
    const body = { search: ' Muster ', sort: [{ field: 'name', direction: 'desc' }], parent: { field: 'order', record: 'k1:7' }, offset: 50, limit: 25 }
    const checked = validateListQuery(body)
    expect(checked).toEqual({ ok: true, query: { search: 'Muster', sort: [{ field: 'name', direction: 'desc' }], parent: { field: 'order', record: 'k1:7' }, offset: 50, limit: 25 } })
    if (checked.ok) {
      expect(checked.query.sort[0]).not.toBe(body.sort[0])
      expect(checked.query.parent).not.toBe(body.parent)
    }
    expect(validateListQuery({ parent: null })).toMatchObject({ ok: true, query: { parent: null } })
  })

  // A property ignored today is one somebody reads tomorrow: a `filters` or
  // a `columns` in a body must not reach a planner that may one day look.
  test('refuses anything but an object of the five properties', () => {
    for (const body of [null, 'x', [], { filters: [] }, { search: '', columns: ['tenant_id'] }]) {
      expect(validateListQuery(body), JSON.stringify(body)).toMatchObject({ ok: false, code: 'malformed' })
    }
  })

  // The order is spliced into SQL as ASC or DESC by each adapter, so only
  // those two pass; a field named twice would sort by its first mention and
  // ignore the second, which a grid's header would show as the opposite.
  test('refuses an order that is not a list of distinct fields, each asc or desc', () => {
    const sorts: unknown[] = [
      'name',
      { field: 'name', direction: 'asc' },
      [{ field: 'name' }],
      [{ field: 'name', direction: 'ASC' }],
      [{ field: 'name', direction: 'asc; drop table x' }],
      [{ field: '', direction: 'asc' }],
      [{ field: 7, direction: 'asc' }],
      [{ field: 'name', direction: 'asc', nulls: 'first' }],
      [{ field: 'name', direction: 'asc' }, { field: 'name', direction: 'desc' }],
      null,
    ]
    for (const sort of sorts) expect(validateListQuery({ sort }), JSON.stringify(sort)).toMatchObject({ ok: false, code: 'malformed' })
  })

  // The parent is a field key and a token, both text, and nothing else: a
  // parent carrying columns or values of its own would be SQL's to read.
  test('refuses a parent that is not exactly a field and a record token', () => {
    for (const parent of ['k1:7', { field: 'order' }, { field: 'order', record: 7 }, { field: '', record: 'k1:7' }, { field: 'order', record: 'k1:7', column: 'order_id' }, []]) {
      expect(validateListQuery({ parent }), JSON.stringify(parent)).toMatchObject({ ok: false, code: 'malformed' })
    }
  })
})
