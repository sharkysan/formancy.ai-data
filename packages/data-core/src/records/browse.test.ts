import { describe, expect, test } from 'vitest'
import type { ColumnMeta, NormalizedType, ObjectMeta, ObjectRef } from '../metadata.js'
import { LIST_PAGE_SIZE } from '../runtime.js'
import { createSnapshot } from '../snapshot.js'
import { browsePage, planBrowse, validateBrowseQuery } from './browse.js'
import type { BrowseQuery } from './browse.js'
import { listTerms } from './list-terms.js'

const INT32: NormalizedType = { kind: 'integer', min: '-2147483648', max: '2147483647' }
const NAME: NormalizedType = { kind: 'text', maxLength: 200, lengthUnit: 'utf16-code-units', fixedLength: false }
const BYTES: NormalizedType = { kind: 'binary', maxLength: null, fixedLength: false }
const col = (name: string, ordinal: number, type: NormalizedType, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name, ordinal, databaseType: type.kind, type, nullable: false, hasDefault: false, defaultExpression: null, generated: 'none', comment: null, access: { select: true, insert: true, update: true }, ...extra,
})
const ref = (name: string): ObjectRef => ({ schema: 'sales', name })
const object = (name: string, kind: ObjectMeta['kind'], columns: ColumnMeta[], keys: Partial<Pick<ObjectMeta, 'primaryKey' | 'uniqueKeys'>> = {}): ObjectMeta => ({
  ref: ref(name), kind, comment: null, columns, primaryKey: null, uniqueKeys: [], foreignKeys: [], checks: [], rowSecurity: 'none', ...keys,
})

const SNAPSHOT = createSnapshot({
  kind: 'postgres', serverVersion: '17.6', account: { user: 'owner', login: 'owner' }, scope: { schemas: ['sales'] }, gaps: [],
  objects: [
    object('country', 'table', [col('id', 1, INT32), col('iso_code', 2, NAME), col('name', 3, NAME), col('flag', 4, BYTES, { nullable: true }), col('shape', 5, { kind: 'unsupported' }, { nullable: true })], {
      primaryKey: { name: 'pk_country', columns: ['id'] },
      uniqueKeys: [{ name: 'uq_country_iso_code', columns: ['iso_code'] }],
    }),
    object('customer', 'table', [col('id', 1, INT32, { access: { select: false, insert: false, update: false } }), col('code', 2, NAME), col('note', 3, NAME, { nullable: true })], {
      primaryKey: { name: 'pk_customer', columns: ['id'] },
      uniqueKeys: [{ name: 'uq_customer_code', columns: ['code'] }],
    }),
    object('summary', 'view', [col('customer_no', 1, INT32, { nullable: true }), col('name', 2, NAME, { nullable: true }), col('order_count', 3, INT32)]),
    object('blobs', 'table', [col('data', 1, BYTES)]),
    object('secret', 'table', [col('id', 1, INT32, { access: { select: false, insert: true, update: true } })]),
  ],
})

const query = (name: string, extra: Partial<BrowseQuery> = {}): BrowseQuery => ({ object: ref(name), search: '', sort: [], offset: 0, limit: LIST_PAGE_SIZE, ...extra })

function planned(name: string, extra: Partial<BrowseQuery> = {}) {
  const plan = planBrowse(SNAPSHOT, query(name, extra))
  if (!plan.ok) throw new Error(`refused: ${plan.message}`)
  return plan
}

describe('planBrowse', () => {
  // A browser that showed a binary or unsupported column would ask the adapter for canonical text it has none of, and the statement would throw for the whole page.
  test('shows every column the account may select that has a text form, and names the rest', () => {
    const plan = planned('country')
    expect(plan.columns.map((column) => column.name)).toEqual(['id', 'iso_code', 'name'])
    expect(plan.omitted).toEqual([
      { column: 'flag', reason: 'no-text' },
      { column: 'shape', reason: 'no-text' },
    ])
    expect(plan.request.columns.map((column) => column.name)).toEqual(['id', 'iso_code', 'name'])
  })

  // An order that stopped at the requested column would let a page boundary fall between two rows that sort alike, and offset paging would show one twice and never the other.
  test('ends the order with the primary key, so paging is total', () => {
    const plan = planned('country', { sort: [{ column: 'name', direction: 'desc' }] })
    expect(plan.ordered).toBe('key')
    expect(plan.request.sort).toEqual([
      { column: 'name', direction: 'desc', nulls: null },
      { column: 'id', direction: 'asc', nulls: null },
    ])
    expect(plan.request.target).toEqual({ table: ref('country'), identity: [{ name: 'id', type: INT32 }], concurrency: null })
  })

  // A primary key the account may not read cannot order anything it is shown; a unique NOT NULL key it may read orders the rows just as totally.
  test('falls back to a unique key the account may read when it may not read the primary key', () => {
    const plan = planned('customer')
    expect(plan.ordered).toBe('key')
    expect(plan.request.target.identity.map((column) => column.name)).toEqual(['code'])
    expect(plan.omitted).toEqual([{ column: 'id', reason: 'not-readable' }])
  })

  // A view has no key; refusing it would hide every view, and ordering by nothing would page in whatever order the engine chose that time.
  test('orders a keyless object by every column it shows, and says the order is not a key', () => {
    const plan = planned('summary')
    expect(plan.ordered).toBe('columns')
    expect(plan.request.sort).toEqual([
      { column: 'customer_no', direction: 'asc', nulls: 'last' },
      { column: 'name', direction: 'asc', nulls: 'last' },
      { column: 'order_count', direction: 'asc', nulls: null },
    ])
    // The adapters' own check of a list holds this request to a total order over what it calls the identity.
    expect(() => listTerms(plan.request)).not.toThrow()
  })

  // Every request reaches the adapter through listTerms, which throws on what a planner would not produce; a browse request it refused would be a 500, not a page.
  test('makes a request the adapters accept, with no filter, through or parent', () => {
    const plan = planned('country', { search: 'Swi', offset: 50 })
    expect(plan.request.filters).toEqual({ kind: 'unrestricted' })
    expect(plan.request.through).toEqual([])
    expect(plan.request.equal).toEqual([])
    expect(plan.request.search).toEqual({ text: 'Swi', columns: [{ name: 'id', type: INT32 }, { name: 'iso_code', type: NAME }, { name: 'name', type: NAME }] })
    expect(plan.request.offset).toBe(50)
    expect(() => listTerms(plan.request)).not.toThrow()
  })

  // The object is a name from the browser: only one the server's own snapshot holds may reach SQL, so a table outside the approved schemas is never read.
  test('refuses an object the snapshot does not hold', () => {
    expect(planBrowse(SNAPSHOT, { ...query('country'), object: { schema: 'hr', name: 'salary' } })).toMatchObject({ ok: false, code: 'unknown-object' })
  })

  // An object whose every column is hidden or has no text form would page rows with nothing in them.
  test('refuses an object with no column it can show', () => {
    expect(planBrowse(SNAPSHOT, query('blobs'))).toMatchObject({ ok: false, code: 'nothing-readable' })
    expect(planBrowse(SNAPSHOT, query('secret'))).toMatchObject({ ok: false, code: 'nothing-readable' })
  })

  // A sort by a column that is not shown would order by what the account may not read, or by a column the adapter cannot spell.
  test('refuses a sort by a column it does not show', () => {
    expect(planBrowse(SNAPSHOT, query('country', { sort: [{ column: 'flag', direction: 'asc' }] }))).toMatchObject({ ok: false, code: 'not-sortable' })
    expect(planBrowse(SNAPSHOT, query('customer', { sort: [{ column: 'id', direction: 'asc' }] }))).toMatchObject({ ok: false, code: 'not-sortable' })
  })

  // A search over an object with no text or integer column would match nothing and look like an empty table.
  test('refuses a search where no shown column can be searched', () => {
    const dates = createSnapshot({
      kind: 'postgres', serverVersion: '17.6', account: { user: 'owner', login: 'owner' }, scope: { schemas: ['sales'] }, gaps: [],
      objects: [object('days', 'table', [col('day', 1, { kind: 'date' })])],
    })
    expect(planBrowse(dates, { ...query('days'), search: '2026' })).toMatchObject({ ok: false, code: 'not-searchable' })
  })
})

describe('validateBrowseQuery', () => {
  // Leaving properties out is how a first page is asked for.
  test('fills what is left out', () => {
    expect(validateBrowseQuery({ object: { schema: 'sales', name: 'country' } })).toEqual({ ok: true, query: query('country') })
  })

  // A property ignored today is one somebody reads tomorrow, and an object named by anything but its two parts is a name nobody approved.
  test.each([
    ['an unknown property', { object: ref('country'), filter: 'x' }],
    ['no object', {}],
    ['an object with a third part', { object: { schema: 'sales', name: 'country', database: 'other' } }],
    ['an empty name', { object: { schema: 'sales', name: '' } }],
    ['a sort term with no direction', { object: ref('country'), sort: [{ column: 'name' }] }],
    ['a column sorted twice', { object: ref('country'), sort: [{ column: 'name', direction: 'asc' }, { column: 'name', direction: 'desc' }] }],
  ])('refuses %s as malformed', (_, body) => {
    expect(validateBrowseQuery(body)).toMatchObject({ ok: false, code: 'malformed' })
  })

  // The page and the search are a list's own checks, so a browse can never ask for more rows at once than a list.
  test('refuses a page larger than a list may be', () => {
    expect(validateBrowseQuery({ object: ref('country'), limit: LIST_PAGE_SIZE + 1 })).toMatchObject({ ok: false, code: 'limit-out-of-range' })
  })
})

describe('browsePage', () => {
  // The extra row the adapter fetches says more follow; shown, a page would hold one row more than asked and the next would repeat it.
  test('keeps the page and says whether more follow', () => {
    const rows = [1, 2, 3].map((id) => ({ values: { id: String(id) }, version: null }))
    expect(browsePage(rows, 2)).toEqual({ rows: [{ id: '1' }, { id: '2' }], hasMore: true })
    expect(browsePage(rows.slice(0, 2), 2)).toEqual({ rows: [{ id: '1' }, { id: '2' }], hasMore: false })
  })
})
