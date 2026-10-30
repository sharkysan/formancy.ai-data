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
  name,
  ordinal,
  databaseType: type.kind,
  type,
  nullable: false,
  hasDefault: false,
  defaultExpression: null,
  generated: 'none',
  comment: null,
  access: { select: true, insert: true, update: true },
  ...extra,
})
const ref = (name: string): ObjectRef => ({ schema: 'sales', name })
const object = (
  name: string,
  kind: ObjectMeta['kind'],
  columns: ColumnMeta[],
  keys: Partial<Pick<ObjectMeta, 'primaryKey' | 'uniqueKeys'>> = {},
): ObjectMeta => ({
  ref: ref(name),
  kind,
  comment: null,
  columns,
  primaryKey: null,
  uniqueKeys: [],
  foreignKeys: [],
  checks: [],
  rowSecurity: 'none',
  ...keys,
})

const SNAPSHOT = createSnapshot({
  kind: 'postgres',
  serverVersion: '17.6',
  account: { user: 'owner', login: 'owner' },
  scope: { schemas: ['sales'] },
  gaps: [],
  objects: [
    object(
      'country',
      'table',
      [
        col('id', 1, INT32),
        col('iso_code', 2, NAME),
        col('name', 3, NAME),
        col('flag', 4, BYTES, { nullable: true }),
        col('shape', 5, { kind: 'unsupported' }, { nullable: true }),
      ],
      {
        primaryKey: { name: 'pk_country', columns: ['id'] },
        uniqueKeys: [{ name: 'uq_country_iso_code', columns: ['iso_code'] }],
      },
    ),
    object(
      'customer',
      'table',
      [col('id', 1, INT32, { access: { select: false, insert: false, update: false } }), col('code', 2, NAME), col('note', 3, NAME, { nullable: true })],
      {
        primaryKey: { name: 'pk_customer', columns: ['id'] },
        uniqueKeys: [{ name: 'uq_customer_code', columns: ['code'] }],
      },
    ),
    object('summary', 'view', [col('customer_no', 1, INT32, { nullable: true }), col('name', 2, NAME, { nullable: true }), col('order_count', 3, INT32)]),
    object('blobs', 'table', [col('data', 1, BYTES)]),
    object('secret', 'table', [col('id', 1, INT32, { access: { select: false, insert: true, update: true } })]),
  ],
})

const query = (name: string, extra: Partial<BrowseQuery> = {}): BrowseQuery => ({
  object: ref(name),
  equal: [],
  filter: [],
  search: '',
  sort: [],
  offset: 0,
  limit: LIST_PAGE_SIZE,
  ...extra,
})

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
    expect(plan.request.search).toEqual({
      text: 'Swi',
      columns: [
        { name: 'id', type: INT32 },
        { name: 'iso_code', type: NAME },
        { name: 'name', type: NAME },
      ],
    })
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
      kind: 'postgres',
      serverVersion: '17.6',
      account: { user: 'owner', login: 'owner' },
      scope: { schemas: ['sales'] },
      gaps: [],
      objects: [object('days', 'table', [col('day', 1, { kind: 'date' })])],
    })
    expect(planBrowse(dates, { ...query('days'), search: '2026' })).toMatchObject({ ok: false, code: 'not-searchable' })
  })
})

describe('planBrowse, narrowed to equal values (0103)', () => {
  // A row followed through a foreign key is found by the values of its key's columns: each bound as a list binds a parent's, through the same listTerms check.
  test('narrows to the rows whose columns equal the values given', () => {
    const plan = planned('country', {
      equal: [
        { column: 'iso_code', value: 'CH' },
        { column: 'id', value: '1' },
      ],
    })
    expect(plan.request.equal).toEqual([
      { name: 'iso_code', type: NAME, value: 'CH' },
      { name: 'id', type: INT32, value: '1' },
    ])
    expect(listTerms(plan.request).equal).toEqual(plan.request.equal)
  })

  // A column the page does not show is one the account may not read or the adapter cannot spell: narrowing by it would find rows by what the person is not shown, or throw for the whole page.
  test('refuses to narrow by a column the page does not show', () => {
    expect(planBrowse(SNAPSHOT, query('customer', { equal: [{ column: 'id', value: '1' }] }))).toMatchObject({ ok: false, code: 'not-comparable' })
    expect(planBrowse(SNAPSHOT, query('country', { equal: [{ column: 'flag', value: '00' }] }))).toMatchObject({ ok: false, code: 'not-comparable' })
    expect(planBrowse(SNAPSHOT, query('country', { equal: [{ column: 'nope', value: '1' }] }))).toMatchObject({ ok: false, code: 'not-comparable' })
  })

  // Equality is a key's: a timestamp's instant has more than one spelling, and the engines compare it in different precisions, so a value equal on one could find nothing on the other.
  test('refuses to narrow by a kind no key has', () => {
    const stamps = createSnapshot({
      kind: 'postgres',
      serverVersion: '17.6',
      account: { user: 'owner', login: 'owner' },
      scope: { schemas: ['sales'] },
      gaps: [],
      objects: [object('events', 'table', [col('at', 1, { kind: 'timestamp', withTimeZone: true, precision: 6 })])],
    })
    expect(planBrowse(stamps, { ...query('events'), equal: [{ column: 'at', value: '2026-10-26T12:00:00Z' }] })).toMatchObject({
      ok: false,
      code: 'not-comparable',
    })
  })

  // A value its column cannot hold would make listTerms throw: a 500 for the page, where a refusal that says which column belongs.
  test('refuses a value its column cannot hold, naming the column and never the value', () => {
    const refused = planBrowse(SNAPSHOT, query('country', { equal: [{ column: 'id', value: '1e3' }] }))
    expect(refused).toMatchObject({ ok: false, code: 'not-comparable' })
    expect(JSON.stringify(refused)).not.toContain('1e3')
    expect(planBrowse(SNAPSHOT, query('country', { equal: [{ column: 'name', value: 'x'.repeat(201) }] }))).toMatchObject({ ok: false, code: 'not-comparable' })
  })

  // listTerms throws on a column named twice; the planner is public, so it refuses before anything is built.
  test('refuses a column named twice', () => {
    const twice = [
      { column: 'id', value: '1' },
      { column: 'id', value: '2' },
    ]
    expect(planBrowse(SNAPSHOT, query('country', { equal: twice }))).toMatchObject({ ok: false, code: 'not-comparable' })
  })
})

describe('planBrowse, filtered by a person (0104)', () => {
  // A condition is planned by columnFilter, the form list's own, and reaches the adapter through listTerms beside a follow's equal: both narrow, together.
  test('narrows by each condition on a shown column, beside a follow', () => {
    const plan = planned('summary', {
      equal: [{ column: 'order_count', value: '2' }],
      filter: [
        { column: 'customer_no', op: 'range', from: '1000', to: '1999' },
        { column: 'name', op: 'null' },
      ],
    })
    expect(plan.request.filter).toEqual([
      { op: 'range', column: 'customer_no', type: INT32, from: '1000', to: '1999', before: null },
      { op: 'null', column: 'name' },
    ])
    expect(listTerms(plan.request).filter).toEqual(plan.request.filter)
    expect(plan.request.equal).toEqual([{ name: 'order_count', type: INT32, value: '2' }])
  })

  // A column the page does not show is one the account may not read or the adapter cannot spell: a filter on it would find rows by what the person is not shown.
  test('refuses a condition on a column the page does not show', () => {
    expect(planBrowse(SNAPSHOT, query('customer', { filter: [{ column: 'id', op: 'equals', value: '1' }] }))).toEqual({
      ok: false,
      code: 'not-filterable',
      message: 'id is not a column of sales.customer this page shows.',
    })
    expect(planBrowse(SNAPSHOT, query('country', { filter: [{ column: 'flag', op: 'null' }] }))).toMatchObject({ ok: false, code: 'not-filterable' })
  })

  // An operator the column does not offer, or a value it cannot hold, is refused as a form's list refuses it, naming the column and never the value.
  test('refuses what the column does not offer, or cannot hold', () => {
    expect(planBrowse(SNAPSHOT, query('country', { filter: [{ column: 'id', op: 'contains', text: '1' }] }))).toEqual({
      ok: false,
      code: 'not-filterable',
      message: 'id offers no contains condition.',
    })
    expect(planBrowse(SNAPSHOT, query('country', { filter: [{ column: 'id', op: 'null' }] }))).toEqual({
      ok: false,
      code: 'not-filterable',
      message: 'id offers no null condition.',
    })
    const refused = planBrowse(SNAPSHOT, query('country', { filter: [{ column: 'id', op: 'equals', value: '1e3' }] }))
    expect(refused).toEqual({ ok: false, code: 'not-filterable', message: 'A value given for id is not one it can hold.' })
  })
})

describe('validateBrowseQuery', () => {
  // Leaving properties out is how a first page is asked for.
  test('fills what is left out', () => {
    expect(validateBrowseQuery({ object: { schema: 'sales', name: 'country' } })).toEqual({ ok: true, query: query('country') })
  })

  // A follow is a browse narrowed by column and value, read as given: which columns may narrow it is the planner's question, asked over the server's own snapshot.
  test('reads an equal as columns and values', () => {
    const equal = [
      { column: 'tenant_id', value: '1' },
      { column: 'customer_no', value: '1001' },
    ]
    expect(validateBrowseQuery({ object: { schema: 'sales', name: 'country' }, equal })).toEqual({ ok: true, query: query('country', { equal }) })
  })

  // A property ignored today is one somebody reads tomorrow, and an object named by anything but its two parts is a name nobody approved.
  test.each([
    ['an unknown property', { object: ref('country'), where: 'x' }],
    ['a filter that is not a list', { object: ref('country'), filter: 'x' }],
    ['a filter condition by field rather than column', { object: ref('country'), filter: [{ field: 'name', op: 'null' }] }],
    ['no object', {}],
    ['an object with a third part', { object: { schema: 'sales', name: 'country', database: 'other' } }],
    ['an empty name', { object: { schema: 'sales', name: '' } }],
    ['a sort term with no direction', { object: ref('country'), sort: [{ column: 'name' }] }],
    [
      'a column sorted twice',
      {
        object: ref('country'),
        sort: [
          { column: 'name', direction: 'asc' },
          { column: 'name', direction: 'desc' },
        ],
      },
    ],
    ['an equal that is not a list', { object: ref('country'), equal: { iso_code: 'CH' } }],
    ['an equal term with more than a column and a value', { object: ref('country'), equal: [{ column: 'iso_code', value: 'CH', op: 'like' }] }],
    ['an equal value that is not text', { object: ref('country'), equal: [{ column: 'id', value: 1 }] }],
    ['an equal value of NULL, which equals nothing', { object: ref('country'), equal: [{ column: 'id', value: null }] }],
    [
      'a column narrowed twice',
      {
        object: ref('country'),
        equal: [
          { column: 'id', value: '1' },
          { column: 'id', value: '2' },
        ],
      },
    ],
  ])('refuses %s as malformed', (_, body) => {
    expect(validateBrowseQuery(body)).toMatchObject({ ok: false, code: 'malformed' })
  })

  // A filter is read by column, by the same reader a form's list reads by field (0104), so the two take the same conditions.
  test('reads a filter as conditions by column', () => {
    const filter = [{ column: 'name', op: 'contains', text: ' land ' }]
    expect(validateBrowseQuery({ object: { schema: 'sales', name: 'country' }, filter })).toEqual({
      ok: true,
      query: query('country', { filter: [{ column: 'name', op: 'contains', text: 'land' }] }),
    })
    expect(validateBrowseQuery({ object: ref('country'), filter: [{ column: 'name', op: 'contains', text: 'x'.repeat(201) }] })).toMatchObject({
      ok: false,
      code: 'not-filterable',
    })
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
