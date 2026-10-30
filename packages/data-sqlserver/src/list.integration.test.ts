import { browsePage, browseRelations, cursorRefusal, driftRefusal, exportColumns, exportHeader, exportRecord, followTerms, generateForm, listCursor, listTerms, planBrowse, planList, planRead, recordPage, toFormAnswers } from '@formancy/data-core'
import type { ApiValue, BrowseFilterTerm, BrowseQuery, BrowseRelation, FormBindings, FormPolicy, FormRecord, ListFilterTerm, ListOutcome, MetadataSnapshot, ObjectRef, PolicyContext, RecordAdapter, RecordList, RecordListQuery } from '@formancy/data-core'
import {
  BROWSE_PARITY,
  browseCase,
  COLUMN_FILTER_PARITY,
  COLUMN_FILTER_ROWS,
  COLUMN_FILTER_TENANT,
  columnFilterCase,
  covers,
  EXPORT_PARITY,
  exportCase,
  FIXTURE_SCOPE,
  LIST_PARITY,
  LIST_ROWS,
  listCase,
  PARITY_SCOPE,
  startSqlServerFixture,
} from '@formancy/data-fixtures'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'
import { listStatement } from './records/list.js'

/*
 * A form's records, a page at a time (0044), against REAL SQL Server loaded
 * with the shared fixture (0005), LIST_ROWS and COLUMN_FILTER_ROWS, written
 * by the owner.
 *
 * Every request is `planList`'s, from bindings generated over what discovery
 * reports and a clerk of tenant 1, so what reaches the adapter is what the
 * server sends; every expectation is LIST_PARITY's, written once for both
 * engines. The PostgreSQL suite runs the same cases, each declared with
 * `covers()` (0035).
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let records: RecordAdapter
let snapshot: MetadataSnapshot
let customers: FormBindings
let lines: FormBindings
let shipments: ReturnType<typeof generateForm>

const TENANT = [{ column: 'tenant_id', attribute: 'tenant' }]
const READ = { read: ['clerk'], write: [] }
const CLERK_RW = { read: ['clerk'], write: ['clerk'] }

/** Tenant 1's customers, every field readable, the tenant pinned. */
const CUSTOMER_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: [] },
  fields: { tenant_id: READ, customer_no: READ, name: READ, country: READ, credit_limit: READ, active: READ, created_at: READ },
  rowFilters: TENANT,
  lookups: { country: [] },
}

/** The lines of the orders this tenant may reference (0043): no row filter of their own, the order lookup's in `through`. */
const LINE_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: ['clerk'], update: ['clerk'] },
  fields: { order: CLERK_RW, line_no: CLERK_RW, quantity: CLERK_RW, unit_price: CLERK_RW, line_total: READ },
  rowFilters: [],
  lookups: { order: TENANT },
  through: ['order'],
}

/** A tenant's shipments, every field the generator makes readable, the tenant pinned. */
const SHIPMENT_POLICY: FormPolicy = {
  version: 1,
  operations: { read: ['clerk'], create: [], update: [] },
  fields: { id: READ, tenant_id: READ, tracking_no: READ, carrier_code: READ, reference: READ, pickup_time: READ, dispatched_at: READ, weight_kg: READ, temperature_c: READ },
  rowFilters: TENANT,
  lookups: {},
}

const CLARA: PolicyContext = { actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: '1' } }
/** The clerk of COLUMN_FILTER_ROWS' shipments' tenant, which no other case lists. */
const SHIPPER: PolicyContext = { actor: { id: 'u-3', roles: ['clerk'] }, attributes: { tenant: COLUMN_FILTER_TENANT } }
const EVERY: RecordListQuery = { search: '', sort: [], parent: null, filter: [], after: null, limit: 50 }

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  for (const [number, name, credit] of LIST_ROWS.customers) {
    await owner
      .request()
      .input('number', mssql.Int, Number(number))
      .input('name', mssql.NVarChar(200), name)
      .input('credit', mssql.NVarChar(20), credit)
      .query('insert into sales.customer (tenant_id, customer_no, name, credit_limit) values (1, @number, @name, convert(decimal(14, 2), @credit))')
  }
  // IDENTITY_INSERT is the session's, so the orders go in one batch; every value is a constant of LIST_ROWS's digits.
  const orders = LIST_ROWS.orders.map(([id, tenant]) => `(${id}, ${tenant}, 1001, '2026-10-09', 1)`).join(', ')
  await owner.request().batch(`set identity_insert sales.[order] on; insert into sales.[order] (id, tenant_id, customer_no, order_date, amount) values ${orders}; set identity_insert sales.[order] off;`)
  for (const [order, line] of LIST_ROWS.lines) {
    await owner.request().input('order', mssql.BigInt, order).input('line', mssql.Int, Number(line)).query('insert into sales.order_line (order_id, line_no, quantity, unit_price) values (@order, @line, 1, 1.00)')
  }
  // Each timestamp as text, converted by the server through an ISO 8601
  // style, never through a JavaScript Date in this machine's zone.
  for (const [number, created, active] of COLUMN_FILTER_ROWS.customers) {
    await owner
      .request()
      .input('number', mssql.Int, Number(number))
      .input('created', mssql.NVarChar(40), created)
      .input('active', mssql.Bit, active)
      .query('update sales.customer set created_at = convert(datetimeoffset, @created, 127), active = @active where tenant_id = 1 and customer_no = @number')
  }
  for (const [reference, tracking, dispatched] of COLUMN_FILTER_ROWS.shipments) {
    await owner
      .request()
      .input('tenant', mssql.Int, Number(COLUMN_FILTER_TENANT))
      .input('tracking', mssql.NVarChar(36), tracking)
      .input('reference', mssql.NVarChar(20), reference)
      .input('dispatched', mssql.NVarChar(40), dispatched)
      .query(`insert into sales.shipment (tenant_id, tracking_no, carrier_code, reference, pickup_time, dispatched_at) values (@tenant, convert(uniqueidentifier, @tracking), 1, @reference, '08:00', convert(datetime2(3), @dispatched, 126))`)
  }
  snapshot = await discoverSqlServer(owner, FIXTURE_SCOPE)
  customers = generateForm(snapshot, {
    connection: 'test',
    root: { schema: 'sales', name: 'customer' },
    formId: 'customers',
    title: 'Customers',
    lookups: [{ foreignKey: 'fk_customer_country', display: ['name'] }],
    pinned: ['tenant_id'],
  }).bindings
  lines = generateForm(snapshot, {
    connection: 'test',
    root: { schema: 'sales', name: 'order_line' },
    formId: 'order-line',
    title: 'Order line',
    lookups: [{ foreignKey: 'fk_order_line_order', display: ['order_date'] }],
  }).bindings
  shipments = generateForm(snapshot, { connection: 'test', root: { schema: 'sales', name: 'shipment' }, formId: 'shipments', title: 'Shipments', lookups: [], pinned: ['tenant_id'] })
  records = createSqlServerRecords(owner)
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

/** One page as the server answers it: planned for Clara, or `context`, listed by the adapter, and built by `recordPage`. */
async function listed(bindings: FormBindings, policy: FormPolicy, change: Partial<RecordListQuery>, context = CLARA, adapter = records): Promise<RecordList & { outcome: ListOutcome }> {
  const query = { ...EVERY, ...change }
  const plan = planList(snapshot, bindings, policy, context, query)
  if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
  const outcome = await adapter.list(plan.request)
  if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
  return { ...recordPage(bindings, plan, outcome.rows), outcome }
}

/** The customer numbers of a page, in its order. */
const numbers = (page: RecordList): string[] => page.rows.map((row) => String(row.answers['customer_no']))
/** The line tokens of a page, in its order. */
const tokens = (page: RecordList): Array<string | null> => page.rows.map((row) => row.record)
const lineToken = ([order, line]: readonly [string, string]): string => `k1:${order},${line}`

describe('pages in key order', covers('sqlserver', listCase('pages')), () => {
  // Each page continues after the last row of the one before (0108), says
  // whether more follow from the one extra row it fetched, and gives the
  // cursor the next is asked for after; after the last row there is
  // nothing, and nothing more.
  test("lists tenant 1's customers a page at a time, each after the one before", async () => {
    let after: string | null = null
    for (const [index, page] of LIST_PARITY.pages.pages.entries()) {
      const answer: RecordList = await listed(customers, CUSTOMER_POLICY, { after, limit: LIST_PARITY.pages.size })
      expect({ index, keys: numbers(answer), hasMore: answer.hasMore, next: answer.next !== null }).toEqual({ index, keys: page.keys, hasMore: page.hasMore, next: page.hasMore })
      after = answer.next
    }
    const [tenant, number] = LIST_PARITY.pages.afterLast.key
    const last = await listed(customers, CUSTOMER_POLICY, { after: listCursor(customers.identity as string[], { tenant_id: tenant, customer_no: number }), limit: LIST_PARITY.pages.size })
    expect({ keys: numbers(last), hasMore: last.hasMore, next: last.next, after: last.outcome.ok && last.outcome.after }).toEqual({ keys: LIST_PARITY.pages.afterLast.keys, hasMore: LIST_PARITY.pages.afterLast.hasMore, next: null, after: 'found' })
  })
})

/** Every page of a list, `size` at a time, each asked for after the one before's `next`, as one list of customer numbers. */
async function walked(change: Partial<RecordListQuery>, size: number): Promise<string[]> {
  const keys: string[] = []
  let after: string | null = null
  for (;;) {
    const page: RecordList = await listed(customers, CUSTOMER_POLICY, { ...change, after, limit: size })
    expect(page.next !== null).toBe(page.hasMore)
    keys.push(...numbers(page))
    if (page.next === null) return keys
    // A seek that went nowhere would ask for the same page for ever.
    if (keys.length > LIST_ROWS.customers.length + 10) throw new Error('The walk does not end: a page after a row is not after it.')
    after = page.next
  }
}

describe('a page after a row', covers('sqlserver', listCase('after')), () => {
  const { between } = LIST_PARITY.after
  /** `between` written as the owner, or deleted again. */
  const insertBetween = () =>
    owner.request().input('number', mssql.Int, Number(between.number)).input('name', mssql.NVarChar(200), between.name).query('insert into sales.customer (tenant_id, customer_no, name) values (1, @number, @name)')
  const deleteBetween = () => owner.request().input('number', mssql.Int, Number(between.number)).query('delete from sales.customer where tenant_id = 1 and customer_no = @number')

  // Each page is compared with the row the one before ended with, column
  // against column, in the order's own terms: NULLs last both ways, a
  // descending column beside an ascending one, text under each engine's
  // collation. Walked two at a time, the pages are the one page of every
  // row, row for row. Watched failing with NULLs placed the other way in the
  // seek (the walk never reached the customers with no credit limit), with
  // the direction left ascending (a descending walk turned back after its
  // first page: 2006, 2005, 2006), and with the seek left out (the walk
  // never ended).
  test('walks every order as the one page of every row', async () => {
    for (const sort of LIST_PARITY.after.sorts) {
      const whole = numbers(await listed(customers, CUSTOMER_POLICY, { sort: [...sort] }))
      expect(await walked({ sort: [...sort] }, LIST_PARITY.after.size), JSON.stringify(sort)).toEqual(whole)
    }
  })

  // An offset counts rows; a cursor names one. A row inserted before where
  // the next page starts would show the last row of the page before again,
  // and one deleted there would skip a row; after a row, neither moves the
  // next page. Watched failing with the seek left out: the next page began
  // at the first row again.
  test('starts where the page before ended, whatever was inserted or deleted before it', async () => {
    try {
      const first = await listed(customers, CUSTOMER_POLICY, { limit: 3 })
      expect(numbers(first)).toEqual(LIST_PARITY.after.inserted.first)
      await insertBetween()
      expect(numbers(await listed(customers, CUSTOMER_POLICY, { after: first.next, limit: 3 }))).toEqual(LIST_PARITY.after.inserted.next)

      const again = await listed(customers, CUSTOMER_POLICY, { limit: 3 })
      expect(numbers(again)).toEqual(LIST_PARITY.after.deleted.first)
      await deleteBetween()
      expect(numbers(await listed(customers, CUSTOMER_POLICY, { after: again.next, limit: 3 }))).toEqual(LIST_PARITY.after.deleted.next)
    } finally {
      await deleteBetween()
    }
  })

  // The row is found again in the page's own statement, under the read
  // filter: deleted, it is not there; another tenant's, it is not one the
  // person may read, and its place in the order is not told. Either way the
  // page has nowhere to start, holds no rows and is refused. Watched failing
  // with the row looked for without the read filter: tenant 2's customer
  // 1001 was found, and the page after it held tenant 1's customers past
  // 1001; and with the row said found whatever the statement found.
  test("is refused after a row that is gone, or that is another tenant's", async () => {
    try {
      await insertBetween()
      const first = await listed(customers, CUSTOMER_POLICY, { limit: 2 })
      expect(numbers(first)).toEqual(LIST_PARITY.after.gone.first)
      await deleteBetween()
      const gone = await listed(customers, CUSTOMER_POLICY, { after: first.next, limit: 2 })
      if (!gone.outcome.ok) throw new Error('expected an answer')
      expect({ after: gone.outcome.after, rows: gone.outcome.rows.length, refused: cursorRefusal(gone.outcome)?.code }).toEqual({ after: 'gone', rows: 0, refused: LIST_PARITY.after.gone.refused })
    } finally {
      await deleteBetween()
    }
    const [tenant, number] = LIST_PARITY.after.theirs.key
    const theirs = await listed(customers, CUSTOMER_POLICY, { after: listCursor(customers.identity as string[], { tenant_id: tenant, customer_no: number }), limit: 2 })
    if (!theirs.outcome.ok) throw new Error('expected an answer')
    expect({ after: theirs.outcome.after, rows: theirs.outcome.rows.length, refused: cursorRefusal(theirs.outcome)?.code }).toEqual({ after: 'gone', rows: 0, refused: LIST_PARITY.after.theirs.refused })
  })
})

describe('a varchar under the database collation', covers('sqlserver', listCase('collated')), () => {
  // The question 0044 left open: SQL Server orders a varchar under a SQL_
  // collation by that collation's own rules, and an nvarchar by Unicode's,
  // which weigh a hyphen and an apostrophe otherwise -- here `co-op` before
  // `coo` as a varchar and after it as an nvarchar. A page compares the
  // column against the row it continues after, a varchar against a varchar
  // under one collation, so the order decides both. Walked a label at a
  // time, the pages are the one page of every label. Watched failing with
  // the comparison made as nvarchar, as a value bound the way the adapter
  // binds text would be: the walk went from `co-op` to `cop`.
  test('walks a label at a time as the one page of every label, though nvarchar would order them otherwise', async () => {
    await owner.request().batch('create table sales.list_word (code int not null primary key, label varchar(20) not null)')
    try {
      for (const [code, label] of LIST_PARITY.collated.rows) {
        await owner.request().input('code', mssql.Int, Number(code)).input('label', mssql.VarChar(20), label).query('insert into sales.list_word (code, label) values (@code, @label)')
      }
      const worded = await discoverSqlServer(owner, FIXTURE_SCOPE)
      const bindings = generateForm(worded, { connection: 'test', root: { schema: 'sales', name: 'list_word' }, formId: 'list-word', title: 'Words', lookups: [] }).bindings
      const policy: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: { code: READ, label: READ }, rowFilters: [], lookups: {} }
      const codes = (page: RecordList): string[] => page.rows.map((row) => String(row.answers['code']))
      const page = async (change: Partial<RecordListQuery>): Promise<RecordList> => {
        const plan = planList(worded, bindings, policy, CLARA, { ...EVERY, ...change })
        if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
        const outcome = await records.list(plan.request)
        if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
        return recordPage(bindings, plan, outcome.rows)
      }
      for (const direction of ['asc', 'desc'] as const) {
        const sort = [{ field: 'label', direction }]
        const whole = codes(await page({ sort }))
        const walk: string[] = []
        let after: string | null = null
        do {
          const one: RecordList = await page({ sort, after, limit: 1 })
          walk.push(...codes(one))
          after = one.next
          if (walk.length > LIST_PARITY.collated.rows.length) throw new Error('The walk does not end: a page after a label is not after it.')
        } while (after !== null)
        expect(walk, direction).toEqual(whole)
      }
      const asUnicode = await owner.request().query<{ code: number }>('select code from sales.list_word order by convert(nvarchar(20), label), code')
      expect(asUnicode.recordset.map((row) => String(row.code))).not.toEqual(codes(await page({ sort: [{ field: 'label', direction: 'asc' }] })))
    } finally {
      await owner.request().batch('drop table sales.list_word')
    }
  })
})

describe('a search', covers('sqlserver', listCase('search')), () => {
  // `%` and `_` are LIKE's own wildcards, and SQL Server's LIKE reads `[x]`
  // as a character class: unescaped, it would find "x Labs". A search is
  // what the person typed, never a pattern.
  test('matches %, _ and [ as themselves', async () => {
    for (const entry of LIST_PARITY.search) {
      expect(numbers(await listed(customers, CUSTOMER_POLICY, { search: entry.text })), entry.text).toEqual(entry.keys)
    }
  })
})

describe('a nullable sort', covers('sqlserver', listCase('nulls')), () => {
  // SQL Server puts NULLs first ascending and last descending; PostgreSQL
  // the other way round. The lookups' rule is last both ways, spelled for a
  // nullable column by a CASE before it, so both engines give one order.
  // Watched failing with the placement left unspelled: ascending began with
  // the NULLs.
  test('puts NULLs last in both directions, ties broken by the key', async () => {
    expect(numbers(await listed(customers, CUSTOMER_POLICY, { sort: [{ field: 'credit_limit', direction: 'asc' }] }))).toEqual(LIST_PARITY.nulls.asc)
    expect(numbers(await listed(customers, CUSTOMER_POLICY, { sort: [{ field: 'credit_limit', direction: 'desc' }] }))).toEqual(LIST_PARITY.nulls.desc)
  })
})

describe('a NOT NULL sort', covers('sqlserver', listCase('order')), () => {
  // A NOT NULL column holds no NULL to place: its order is spelled bare,
  // with no CASE before it, so an index on it can serve it, and the order is
  // the same. The description's CASE, on `[page]`, is not the order's.
  test('gives one order, from a statement that spells no NULL placement', async () => {
    const query = { ...EVERY, sort: [{ field: 'customer_no', direction: 'desc' as const }] }
    expect(numbers(await listed(customers, CUSTOMER_POLICY, query))).toEqual(LIST_PARITY.order.desc)
    const plan = planList(snapshot, customers, CUSTOMER_POLICY, CLARA, query)
    if (!plan.ok) throw new Error(plan.message)
    expect(listStatement(plan.request, listTerms(plan.request)).sql).not.toMatch(/case when \[r\]/)
    const nullable = planList(snapshot, customers, CUSTOMER_POLICY, CLARA, { ...EVERY, sort: [{ field: 'credit_limit', direction: 'desc' }] })
    if (!nullable.ok) throw new Error(nullable.message)
    expect(listStatement(nullable.request, listTerms(nullable.request)).sql).toMatch(/case when \[r\]\.\[credit_limit\] is null then 1 else 0 end, \[r\]\.\[credit_limit\] desc/)
  })
})

describe('a parent', covers('sqlserver', listCase('parent')), () => {
  // A child grid shows one parent's rows. The parent narrows; it never
  // admits: tenant 2's order, named by tenant 1's clerk, lists nothing.
  test("narrows a line list to one order's lines, and to none of another tenant's", async () => {
    const ours = LIST_PARITY.parent.ours
    expect(tokens(await listed(lines, LINE_POLICY, { parent: { field: 'order', record: `k1:${ours.order}` } }))).toEqual(ours.lines.map(lineToken))
    const theirs = LIST_PARITY.parent.theirs
    expect(tokens(await listed(lines, LINE_POLICY, { parent: { field: 'order', record: `k1:${theirs.order}` } }))).toEqual([])
  })
})

describe('lines listed through their order', covers('sqlserver', listCase('through')), () => {
  // order_line has no tenant column (0043). Without the through in the
  // list's own statement, tenant 2's line would be listed for tenant 1.
  test("lists the lines of tenant 1's orders and none of tenant 2's", async () => {
    expect(tokens(await listed(lines, LINE_POLICY, {}))).toEqual(LIST_PARITY.through.lines.map(lineToken))
  })
})

describe('every listed row is its read', covers('sqlserver', listCase('read')), () => {
  // A list is a read of many records: each row must be exactly what a read
  // of its token returns -- the same fields, values and version -- or a grid
  // and the form beside it would show one record two ways. And the page
  // carries the description of the table its own statement read, which the
  // runtime decides drift over as it does a read's (0041).
  test('equals what a read by its token returns, and carries the table as describe reads it', async () => {
    const pages: Array<[FormBindings, FormPolicy, RecordList & { outcome: ListOutcome }, string[]]> = [
      [customers, CUSTOMER_POLICY, await listed(customers, CUSTOMER_POLICY, {}), [...LIST_PARITY.read.customers]],
      [lines, LINE_POLICY, await listed(lines, LINE_POLICY, {}), LIST_PARITY.read.lines.map(lineToken)],
    ]
    for (const [bindings, policy, page, expected] of pages) {
      const keys = bindings === customers ? numbers(page) : tokens(page)
      expect(keys).toEqual(expected)
      for (const row of page.rows) {
        const plan = planRead(snapshot, bindings, policy, CLARA, row.record as string)
        if (!plan.ok) throw new Error(plan.message)
        const read = await records.read(plan.request)
        if (!read.ok || read.record === null) throw new Error(`${String(row.record)} was listed and not read`)
        expect(toFormAnswers(bindings, plan.fields, { ok: true, ...read.record }) satisfies FormRecord).toEqual(row)
      }
      const described = await records.describe(bindings.root)
      if (!described.ok || !page.outcome.ok) throw new Error('expected both to describe the table')
      expect(page.outcome.described).toEqual(described.described)
    }
  })
})

describe('a parent over a text foreign key', covers('sqlserver', listCase('text-parent')), () => {
  // The parent's value is bound in the foreign key's type and compared with
  // the database's equality, as the foreign key compares it -- here under
  // the column's case-insensitive collation, the fixture's, so `ch` names CH
  // as the foreign key itself would, where PostgreSQL's default collation
  // compares exactly. It narrows within tenant 1's customers either way.
  test("narrows a customer list to a country, as the database's equality compares char(2)", async () => {
    const entry = LIST_PARITY['text-parent']
    expect(numbers(await listed(customers, CUSTOMER_POLICY, { parent: { field: entry.field, record: entry.exact.record } }))).toEqual(entry.exact.keys)
    expect(numbers(await listed(customers, CUSTOMER_POLICY, { parent: { field: entry.field, record: entry.folded.record } }))).toEqual(entry.folded.keys.sqlserver)
  })
})

describe('a key the table no longer holds', covers('sqlserver', listCase('key')), () => {
  // A page continues after a row by its key, which needs the order total:
  // the key unique and NOT NULL. The snapshot says it is; a page decided
  // over its own statement's description asks again (0044). SQL Server's
  // UNIQUE admits one NULL, which has no token; with its key dropped, a
  // value twice makes one record appear twice on a page. Review calls the
  // first a note and the second a stop of update, and a read allows both, so
  // a list decided as a read listed them -- the second as a page that cannot
  // be built. Watched failing with the page decided as a read.
  test('refuses a page once its own description says the key can be NULL, or is not unique', async () => {
    await owner.request().batch('create table sales.list_key (code int not null constraint uq_list_key unique, label nvarchar(20) not null)')
    for (const [code, label] of LIST_PARITY.key.rows) {
      await owner.request().input('code', mssql.Int, Number(code)).input('label', mssql.NVarChar(20), label).query('insert into sales.list_key (code, label) values (@code, @label)')
    }
    const keyed = await discoverSqlServer(owner, FIXTURE_SCOPE)
    const bindings = generateForm(keyed, { connection: 'test', root: { schema: 'sales', name: 'list_key' }, formId: 'list-key', title: 'Key', lookups: [] }).bindings
    expect(bindings.identity).toEqual(['code'])
    const policy: FormPolicy = { version: 1, operations: { read: ['clerk'], create: [], update: [] }, fields: { code: READ, label: READ }, rowFilters: [], lookups: {} }
    const page = async () => {
      const plan = planList(keyed, bindings, policy, CLARA, EVERY)
      if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
      const outcome = await records.list(plan.request)
      if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
      return { plan, outcome, list: driftRefusal(keyed, bindings, policy, outcome.described, 'list'), read: driftRefusal(keyed, bindings, policy, outcome.described, 'read') }
    }
    const held = await page()
    expect(held.list).toBeUndefined()
    expect(recordPage(bindings, held.plan, held.outcome.rows).rows.map((row) => String(row.answers['code']))).toEqual(LIST_PARITY.key.listed)

    // SQL Server alters no column a constraint covers, so the key is dropped and added again around it.
    await owner.request().batch('alter table sales.list_key drop constraint uq_list_key; alter table sales.list_key alter column code int null; alter table sales.list_key add constraint uq_list_key unique (code)')
    await owner.request().batch(`insert into sales.list_key (code, label) values (null, N'none')`)
    const loosened = await page()
    expect({ list: loosened.list?.code, read: loosened.read }).toEqual({ list: LIST_PARITY.key.refused, read: undefined })

    await owner.request().batch('alter table sales.list_key drop constraint uq_list_key')
    await owner.request().batch(`insert into sales.list_key (code, label) values (1, N'again')`)
    const dropped = await page()
    expect({ list: dropped.list?.code, read: dropped.read }).toEqual({ list: LIST_PARITY.key.refused, read: undefined })
    expect(() => recordPage(bindings, dropped.plan, dropped.outcome.rows)).toThrow('A record appears twice in one page')
  })
})

describe('a file of shipments', covers('sqlserver', exportCase('shipments')), () => {
  // A file is text, so where the engines spell a value their own way -- a
  // double, a real, a zoneless timestamp's fraction (0026) -- a file from
  // one would differ from the other's though their lists read alike. Built
  // as the server builds one (0079), from the list and data-core's export,
  // the bytes are EXPORT_PARITY's here and in the PostgreSQL suite.
  // Watched failing with the timestamp written through displayText, which
  // cuts its half second.
  test("is the shipments' values as read, the same text on both engines", async () => {
    const plan = planList(snapshot, shipments.bindings, SHIPMENT_POLICY, CLARA, EVERY)
    if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
    const outcome = await records.list(plan.request)
    if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
    const page = recordPage(shipments.bindings, plan, outcome.rows)
    expect(page.hasMore).toBe(false)
    const columns = exportColumns(shipments.form, shipments.bindings, plan.fields)
    const lines = [exportHeader(columns), ...page.rows.map((row) => exportRecord(columns, row, new Map()))]
    const file = lines.map((line) => (line.ok ? line.text : line.message)).join('')
    expect(file).toBe(EXPORT_PARITY.shipments)
    expect(Buffer.from(file, 'utf8').equals(Buffer.from(EXPORT_PARITY.shipments, 'utf8'))).toBe(true)
  })
})

/*
 * A table or view browsed (0099): a page `planBrowse` plans over the owner's
 * snapshot, run by this adapter's own `list` and read by `browsePage`, as
 * the server's browse route runs it. Every expectation is BROWSE_PARITY's,
 * written once for both engines.
 */
async function browsed(query: Partial<BrowseQuery> & Pick<BrowseQuery, 'object'>, adapter = records, over = snapshot) {
  const plan = planBrowse(over, { equal: [], filter: [], search: '', sort: [], offset: 0, limit: 50, ...query })
  if (!plan.ok) throw new Error(`expected a browse, got ${plan.code}: ${plan.message}`)
  const outcome = await adapter.list(plan.request)
  if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
  return { plan, page: browsePage(outcome.rows, plan.request.limit) }
}

/** A page's rows as their values in the given columns' order, so a row is compared whole. */
const valuesIn = (columns: readonly string[], rows: ReadonlyArray<Record<string, unknown>>) => rows.map((row) => columns.map((column) => row[column]))

describe('a view browsed', covers('sqlserver', browseCase('view'), browseCase('sort'), browseCase('search')), () => {
  // A view has no key. Refused, no view could be browsed; ordered by
  // nothing, offset paging would take whatever order the engine chose for
  // each statement, and a row could be on two pages or none.
  test('pages in the order of every column it shows', async () => {
    const { object, columns, size, pages } = BROWSE_PARITY.view
    for (const expected of pages) {
      const { plan, page } = await browsed({ object, offset: expected.offset, limit: size })
      expect(plan.ordered).toBe('columns')
      expect(plan.columns.map((column) => column.name)).toEqual(columns)
      expect({ offset: expected.offset, rows: valuesIn(columns, page.rows), hasMore: page.hasMore }).toEqual({ offset: expected.offset, rows: expected.rows, hasMore: expected.hasMore })
    }
  })

  // A requested order is followed by every column, so the rows it ties
  // keep one order between pages rather than the engine's.
  test('sorted by a column, ties keep the order of every column', async () => {
    const { object, sort, rows } = BROWSE_PARITY.sort
    const { page } = await browsed({ object, sort: [...sort] })
    expect(valuesIn(BROWSE_PARITY.view.columns, page.rows)).toEqual(rows)
  })

  // A browse's search is a list's own, over the text and number columns.
  test('a search finds the row whose text holds it', async () => {
    const { object, text, rows } = BROWSE_PARITY.search
    const { page } = await browsed({ object, search: text })
    expect(valuesIn(BROWSE_PARITY.view.columns, page.rows)).toEqual(rows)
  })
})

describe('a table with columns that have no text', covers('sqlserver', browseCase('columns')), () => {
  // A binary or unsupported column has no canonical text this adapter
  // reads back: asked for, the statement would throw for the whole page.
  // Left out and named, the rest of the table is still browsed.
  test('shows the rest in key order, and names what it left out', async () => {
    const { object, columns, omitted, rows } = BROWSE_PARITY.columns
    const { plan, page } = await browsed({ object })
    expect(plan.ordered).toBe('key')
    expect(plan.columns.map((column) => column.name)).toEqual(columns)
    expect(plan.omitted).toEqual(omitted)
    expect(page).toEqual({ rows, hasMore: false })
  })
})

/**
 * A row followed through `key`, that way, as the studio offers it (0103):
 * the relation `browseRelations` derives from this suite's own discovery,
 * and the terms `followTerms` pairs from the row, browsed, narrowed by
 * `filter` too. Neither is written here, so the key's columns are paired as
 * this engine's catalog reports them.
 */
async function followed(from: ObjectRef, direction: BrowseRelation['direction'], key: string, row: Readonly<Record<string, ApiValue>>, filter: BrowseFilterTerm[] = []) {
  const relation = browseRelations(snapshot, from).relations.find((entry) => entry.direction === direction && entry.key === key)
  if (relation === undefined) throw new Error(`${key} cannot be followed ${direction} from ${from.schema}.${from.name}`)
  const equal = followTerms(relation, row)
  if (equal === null) throw new Error(`${key} holds a NULL in the row followed from ${from.schema}.${from.name}`)
  return { relation, ...(await browsed({ object: relation.to.object, equal, filter })) }
}

describe('a row followed through a foreign key', covers('sqlserver', browseCase('follows')), () => {
  // A follow is a browse of the other end narrowed by the key's columns,
  // paired by position. Narrowed by the customer number alone, or not at
  // all, tenant 2's order of its own customer 1001 would be followed to, and
  // tenant 2's customer followed back to; paired crosswise, nothing would.
  test("finds a customer's orders and no other tenant's, and from each order that customer alone", async () => {
    const { object, equal, key, orders, names } = BROWSE_PARITY.follows
    const start = await browsed({ object, equal: [...equal] })
    expect(start.page.rows.map((row) => row['name'])).toEqual(names)
    const [customer] = start.page.rows
    if (customer === undefined) throw new Error('the customer followed from was not browsed')
    const referred = await followed(object, 'referred-by', key, customer)
    expect(referred.relation.to.object).toEqual(orders.object)
    expect(referred.page.rows.map((row) => row['id'])).toEqual(orders.ids)
    for (const order of referred.page.rows) {
      const back = await followed(orders.object, 'refers-to', key, order)
      expect(back.relation.to.object).toEqual(object)
      expect(back.page.rows.map((row) => row['name'])).toEqual(names)
    }
  })
})

/*
 * A person's own conditions on a list's columns (0104), each case
 * COLUMN_FILTER_PARITY's, written once for both engines: planned by
 * `planList` or `planBrowse` and compared by this adapter's `list`, over
 * the rows COLUMN_FILTER_ROWS gave known values. Watched failing, every
 * case, with the filter left out of the list statement.
 */

/** Tenant 1's customers narrowed by `filter`, beside whatever else `change` asks. */
const customersWhere = (filter: ListFilterTerm[], change: Partial<RecordListQuery> = {}, adapter = records) => listed(customers, CUSTOMER_POLICY, { ...change, filter }, CLARA, adapter)
/** Tenant 3's shipments narrowed by `filter`, listed by its clerk. */
const shipmentsWhere = (filter: ListFilterTerm[], adapter = records) => listed(shipments.bindings, SHIPMENT_POLICY, { filter }, SHIPPER, adapter)
/** The references of a page of shipments, in its order. */
const references = (page: RecordList): string[] => page.rows.map((row) => String(row.answers['reference']))

describe('a filter that a text equals', covers('sqlserver', columnFilterCase('text')), () => {
  // The reference's collation is case-insensitive, and SQL Server's `=`
  // ignores trailing spaces under every collation: by `=` alone `AG`, `ag`
  // and `AG ` are one value, and `Ag` finds all three. The row filter's
  // predicate, BIN2 and the byte lengths beside the column's own `=`,
  // counts both (0028). Watched failing with `=` alone.
  test('finds the reference exactly as given: case and a trailing space count', async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.text
    for (const entry of entries) expect(references(await shipmentsWhere([{ field, op: 'equals', value: entry.value }])), JSON.stringify(entry.value)).toEqual(entry.references)
  })
})

describe('a filter on an integer', covers('sqlserver', columnFilterCase('integer')), () => {
  // Tenant 2 has a customer 1001 too: a filter that admitted rows of its own
  // would list it. A bound compared strictly would lose the row on it.
  test("equals tenant 1's 1001 alone, and a range holds the rows on both its ends", async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.integer
    for (const entry of entries) expect(numbers(await customersWhere([{ field, ...entry.condition }])), entry.condition.op).toEqual(entry.keys)
  })
})

describe('a filter on a decimal', covers('sqlserver', columnFilterCase('decimal')), () => {
  // `50` reaches the adapter as `50.00`, the column's own spelling, and is
  // converted by the server to decimal(14, 2), never carried as a JavaScript
  // number; a range from `-1` holds the customer at -1.00.
  test('equals 50 as 50.00, and a range holds the rows on both its ends', async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.decimal
    for (const entry of entries) expect(numbers(await customersWhere([{ field, ...entry.condition }])), entry.condition.op).toEqual(entry.keys)
  })
})

describe('a filter on a boolean', covers('sqlserver', columnFilterCase('boolean')), () => {
  // The planner's `true` or `false` is a bit parameter of its own. A flag
  // compared with nothing lists every customer, inactive or not, and an
  // inverted one the other half: either fails one of the two.
  test('finds the inactive customers, and the active ones', async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.boolean
    for (const entry of entries) expect(numbers(await customersWhere([{ field, ...entry.condition }])), entry.condition.value).toEqual(entry.keys)
  })
})

describe('a filter on a uuid', covers('sqlserver', columnFilterCase('uuid')), () => {
  // Typed in upper case, the value is spelled in lower by the planner and
  // converted to uniqueidentifier, which compares the value, not its text.
  test('finds the shipment whose tracking number it names, in either case', async () => {
    const { field, value, references: expected } = COLUMN_FILTER_PARITY.uuid
    expect(references(await shipmentsWhere([{ field, op: 'equals', value }]))).toEqual(expected)
  })
})

describe('a filter that a text contains', covers('sqlserver', columnFilterCase('contains')), () => {
  // `%` and `_` are LIKE's wildcards, and SQL Server's LIKE reads `[x]` as a
  // character class: unescaped, it would find "x Labs". The column's
  // case-insensitive collation folds `LABS`, as the list's search does.
  test('matches %, _ and [x] as themselves, case folded', async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.contains
    for (const entry of entries) expect(numbers(await customersWhere([{ field, op: 'contains', text: entry.text }])), entry.text).toEqual(entry.keys)
  })
})

describe('a filter on NULL', covers('sqlserver', columnFilterCase('nulls')), () => {
  // A NULL is in no range and equals nothing: only `null` finds it, and
  // `not-null` everything else.
  test('finds the customers with no credit limit, and those with one', async () => {
    const { field } = COLUMN_FILTER_PARITY.nulls
    expect(numbers(await customersWhere([{ field, op: 'null' }]))).toEqual(COLUMN_FILTER_PARITY.nulls.null)
    expect(numbers(await customersWhere([{ field, op: 'not-null' }]))).toEqual(COLUMN_FILTER_PARITY.nulls['not-null'])
  })
})

describe('several filters', covers('sqlserver', columnFilterCase('together')), () => {
  // Joined by OR, or one replacing another, two conditions would find what
  // either finds; every condition holds.
  test('find the rows every condition holds for', async () => {
    for (const entry of COLUMN_FILTER_PARITY.together) expect(numbers(await customersWhere([...entry.filter]))).toEqual(entry.keys)
  })
})

describe('a filter beside a search', covers('sqlserver', columnFilterCase('search')), () => {
  // The search and the filter are both predicates of the one statement:
  // either alone would find more.
  test('finds the rows both hold for', async () => {
    for (const entry of COLUMN_FILTER_PARITY.search) expect(numbers(await customersWhere([...entry.filter], { search: entry.search })), entry.search).toEqual(entry.keys)
  })
})

describe('a filter beside a parent', covers('sqlserver', columnFilterCase('parent')), () => {
  // order_line has no tenant: a line number alone would find tenant 2's
  // first line too, and a filter beside tenant 2's order would find it.
  // The filter narrows within the parent and the throughs, never past them.
  test("narrows a parent's lines, and never past the throughs", async () => {
    for (const entry of COLUMN_FILTER_PARITY.parent) {
      const parent = entry.order === null ? null : { field: 'order', record: `k1:${entry.order}` }
      expect(tokens(await listed(lines, LINE_POLICY, { parent, filter: [...entry.filter] })), String(entry.order)).toEqual(entry.lines.map(lineToken))
    }
  })
})

describe('a filter beside a follow', covers('sqlserver', columnFilterCase('follow')), () => {
  // A follow's equal and a filter are both narrowings of one browse: the
  // customer's orders, of the one date.
  test("narrows a customer's orders, followed, to those of one date", async () => {
    const { object, equal, key, entries } = COLUMN_FILTER_PARITY.follow
    const [customer] = (await browsed({ object, equal: [...equal] })).page.rows
    if (customer === undefined) throw new Error('the customer followed from was not browsed')
    for (const entry of entries) expect((await followed(object, 'referred-by', key, customer, [...entry.filter])).page.rows.map((row) => row['id'])).toEqual(entry.ids)
  })
})

describe('a filter on a column under a case-insensitive collation', covers('sqlserver', columnFilterCase('collation')), () => {
  // tenant_code is nvarchar under the database's case-insensitive
  // collation, and fixed_code a char(3): by `=` alone `acme`, `ACME` and
  // `acme ` are one value, and `ab` is `AB`, watched failing so. BIN2 and
  // the byte lengths beside it find the one row (0028). A contains folds
  // case as the column's collation does, the search's own way.
  test('equals exactly what the row filter admits, and contains case folded', async () => {
    const parity = await discoverSqlServer(owner, PARITY_SCOPE)
    const { object, sort, equals, contains } = COLUMN_FILTER_PARITY.collation
    const keysOf = (rows: ReadonlyArray<Record<string, ApiValue>>) => rows.map((row) => [row['tenant_code'], row['item_no']])
    for (const entry of equals) {
      const { page } = await browsed({ object, sort: [...sort], filter: [{ column: entry.column, op: 'equals', value: entry.value }] }, records, parity)
      expect(keysOf(page.rows), `${entry.column} = ${JSON.stringify(entry.value)}`).toEqual(entry.keys)
    }
    const { page } = await browsed({ object, sort: [...sort], filter: [{ column: contains.column, op: 'contains', text: contains.text }] }, records, parity)
    expect(keysOf(page.rows)).toEqual(contains.keys)
  })
})

describe('a timestamp or a date, in the language the composition root chose', () => {
  let german: mssql.ConnectionPool
  let zoned: RecordAdapter

  // A session's language sets its DATEFORMAT, and German's is dmy, under
  // which a datetime read from `2026-03-01 00:00:00` is the third of
  // January. tedious sends `set dateformat` at login after the language,
  // `mdy` unless told another, so the session is German and dmy only when
  // told both: with the format left out, it was German and mdy. Every bound
  // here is read through an ISO 8601 style, which neither changes: watched
  // failing here alone, the default session passing, with a zoneless bound
  // read as datetime without its `T`.
  beforeAll(async () => {
    german = await new mssql.ConnectionPool({ ...fixture.admin, options: { ...fixture.admin.options, language: 'Deutsch', dateFormat: 'dmy' } }).connect()
    const settings = await german.request().query<{ language: string; format: string }>('select @@language as language, (select date_format from sys.dm_exec_sessions where session_id = @@spid) as format')
    expect(settings.recordset[0]).toEqual({ language: 'Deutsch', format: 'dmy' })
    zoned = createSqlServerRecords(german)
  })

  afterAll(async () => {
    await german?.close()
  })

  const sessions = (): Array<[string, RecordAdapter]> => [
    ['the default session', records],
    ['Deutsch, dmy', zoned],
  ]

  describe('a day range on an instant', covers('sqlserver', columnFilterCase('instant')), () => {
    // datetimeoffset keeps the offset each instant was written in, and
    // compares instants, as PostgreSQL's timestamptz does: 2005, written at
    // 01:30 on the third at +02:00, is inside a range ending on the second.
    // Watched failing with the column compared on its own clock, as a
    // datetime2.
    test('holds the instants in its days in UTC, in any session', async () => {
      const { field, entries } = COLUMN_FILTER_PARITY.instant
      for (const [session, adapter] of sessions()) {
        for (const { from, to, keys } of entries) {
          expect(numbers(await customersWhere([{ field, op: 'range', from, to }], {}, adapter)), `${session}: ${String(from)}..${String(to)}`).toEqual(keys)
        }
      }
    })
  })

  describe('a day range on a timestamp in no zone', covers('sqlserver', columnFilterCase('zoneless')), () => {
    // Compared on the column's own clock: 23:59:59.999 of the last day is
    // inside and the next midnight outside, and a NULL is in no range.
    test('holds the timestamps in its days on their own clock, in any session', async () => {
      const { field, entries } = COLUMN_FILTER_PARITY.zoneless
      for (const [session, adapter] of sessions()) {
        for (const { from, to, references: expected } of entries) {
          expect(references(await shipmentsWhere([{ field, op: 'range', from, to }], adapter)), `${session}: ${String(from)}..${String(to)}`).toEqual(expected)
        }
      }
    })
  })

  describe('a filter on a date, browsed', covers('sqlserver', columnFilterCase('date')), () => {
    // A browse's filter names a column. A date is bound as a date, through
    // style 23: one day's range holds the order on both its ends, a from
    // alone what follows.
    test('finds the orders of a day, and of a range, in any session', async () => {
      const { object, column, entries } = COLUMN_FILTER_PARITY.date
      for (const [session, adapter] of sessions()) {
        for (const entry of entries) {
          const { page } = await browsed({ object, filter: [{ column, ...entry.condition }] }, adapter)
          expect(page.rows.map((row) => row['id']), `${session}: ${JSON.stringify(entry.condition)}`).toEqual(entry.ids)
        }
      }
    })
  })
})

describe("a day range on each of SQL Server's zoneless clocks", () => {
  // SQL Server's alone: PostgreSQL has one zoneless timestamp, of any
  // precision. The snapshot calls a datetime a datetime2(3) and a
  // smalldatetime a datetime2(0), so a bound is a datetime2 of that scale,
  // and each column is compared with it exactly at midnight: the last tick
  // of the last day each type keeps -- 23:59:59.997, 23:59, 23:59:59.9999999
  // and 23:59:59 -- is inside, the next midnight outside. And a range wider
  // than smalldatetime's 1900 to 2079, or datetime's from 1753, is a range,
  // where a bound converted to the column's own type would fail the
  // statement: watched failing with the bound read as datetime.
  test('holds the days of a datetime, a smalldatetime and a datetime2 of either scale, at midnight exactly', async () => {
    const object = { schema: 'sales', name: 'filter_clock' }
    await owner.request().batch('create table sales.filter_clock (id int not null constraint pk_filter_clock primary key, legacy datetime null, minute smalldatetime null, precise datetime2(7) null, whole datetime2(0) null)')
    await owner.request().batch(`insert into sales.filter_clock (id, legacy, minute, precise, whole) values
      (1, '2026-02-28T23:59:59.997', '2026-02-28T23:59:00', '2026-02-28T23:59:59.9999999', '2026-02-28T23:59:59'),
      (2, '2026-03-01T00:00:00', '2026-03-01T00:00:00', '2026-03-01T00:00:00', '2026-03-01T00:00:00'),
      (3, '2026-03-02T23:59:59.997', '2026-03-02T23:59:00', '2026-03-02T23:59:59.9999999', '2026-03-02T23:59:59'),
      (4, '2026-03-03T00:00:00', '2026-03-03T00:00:00', '2026-03-03T00:00:00', '2026-03-03T00:00:00'),
      (5, null, null, null, null)`)
    const clocked = await discoverSqlServer(owner, FIXTURE_SCOPE)
    for (const column of ['legacy', 'minute', 'precise', 'whole']) {
      const days = await browsed({ object, filter: [{ column, op: 'range', from: '2026-03-01', to: '2026-03-02' }] }, records, clocked)
      expect(days.page.rows.map((row) => row['id']), column).toEqual(['2', '3'])
      const wide = await browsed({ object, filter: [{ column, op: 'range', from: '0001-01-01', to: '9999-12-30' }] }, records, clocked)
      expect(wide.page.rows.map((row) => row['id']), column).toEqual(['1', '2', '3', '4'])
    }
  })
})
