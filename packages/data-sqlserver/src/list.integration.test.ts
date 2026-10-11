import { driftRefusal, generateForm, listTerms, planList, planRead, recordPage, toFormAnswers } from '@formancy/data-core'
import type { FormBindings, FormPolicy, FormRecord, ListOutcome, MetadataSnapshot, PolicyContext, RecordAdapter, RecordList, RecordListQuery } from '@formancy/data-core'
import { covers, FIXTURE_SCOPE, LIST_PARITY, LIST_ROWS, listCase, startSqlServerFixture } from '@formancy/data-fixtures'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'
import { listStatement } from './records/list.js'

/*
 * A form's records, a page at a time (0044), against REAL SQL Server loaded
 * with the shared fixture (0005) and LIST_ROWS, inserted by the owner.
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

const CLARA: PolicyContext = { actor: { id: 'u-1', roles: ['clerk'] }, attributes: { tenant: '1' } }
const EVERY: RecordListQuery = { search: '', sort: [], parent: null, offset: 0, limit: 50 }

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
  records = createSqlServerRecords(owner)
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

/** One page as the server answers it: planned for Clara, listed by the adapter, and built by `recordPage`. */
async function listed(bindings: FormBindings, policy: FormPolicy, change: Partial<RecordListQuery>): Promise<RecordList & { outcome: ListOutcome }> {
  const query = { ...EVERY, ...change }
  const plan = planList(snapshot, bindings, policy, CLARA, query)
  if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
  const outcome = await records.list(plan.request)
  if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
  return { ...recordPage(bindings, plan.fields, outcome.rows, query.limit), outcome }
}

/** The customer numbers of a page, in its order. */
const numbers = (page: RecordList): string[] => page.rows.map((row) => String(row.answers['customer_no']))
/** The line tokens of a page, in its order. */
const tokens = (page: RecordList): Array<string | null> => page.rows.map((row) => row.record)
const lineToken = ([order, line]: readonly [string, string]): string => `k1:${order},${line}`

describe('pages in key order', covers('sqlserver', listCase('pages')), () => {
  // Offset paging over a total order: each page starts where the last one
  // ended, says whether more follow from the one extra row it fetched, and
  // one past the end is empty with nothing more.
  test("lists tenant 1's customers a page at a time, saying whether more follow", async () => {
    for (const page of LIST_PARITY.pages.pages) {
      const answer = await listed(customers, CUSTOMER_POLICY, { offset: page.offset, limit: LIST_PARITY.pages.size })
      expect({ offset: page.offset, keys: numbers(answer), hasMore: answer.hasMore }).toEqual({ offset: page.offset, keys: page.keys, hasMore: page.hasMore })
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
  // A page pages by the key, and offset paging needs the order to be total:
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
      return { fields: plan.fields, outcome, list: driftRefusal(keyed, bindings, policy, outcome.described, 'list'), read: driftRefusal(keyed, bindings, policy, outcome.described, 'read') }
    }
    const held = await page()
    expect(held.list).toBeUndefined()
    expect(recordPage(bindings, held.fields, held.outcome.rows, EVERY.limit).rows.map((row) => String(row.answers['code']))).toEqual(LIST_PARITY.key.listed)

    // SQL Server alters no column a constraint covers, so the key is dropped and added again around it.
    await owner.request().batch('alter table sales.list_key drop constraint uq_list_key; alter table sales.list_key alter column code int null; alter table sales.list_key add constraint uq_list_key unique (code)')
    await owner.request().batch(`insert into sales.list_key (code, label) values (null, N'none')`)
    const loosened = await page()
    expect({ list: loosened.list?.code, read: loosened.read }).toEqual({ list: LIST_PARITY.key.refused, read: undefined })

    await owner.request().batch('alter table sales.list_key drop constraint uq_list_key')
    await owner.request().batch(`insert into sales.list_key (code, label) values (1, N'again')`)
    const dropped = await page()
    expect({ list: dropped.list?.code, read: dropped.read }).toEqual({ list: LIST_PARITY.key.refused, read: undefined })
    expect(() => recordPage(bindings, dropped.fields, dropped.outcome.rows, EVERY.limit)).toThrow('A record appears twice in one page')
  })
})
