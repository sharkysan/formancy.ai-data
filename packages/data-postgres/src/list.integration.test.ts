import { browsePage, browseRelations, driftRefusal, exportColumns, exportHeader, exportRecord, followTerms, generateForm, listTerms, planBrowse, planList, planRead, recordPage, toFormAnswers } from '@formancy/data-core'
import type { ApiValue, BrowseQuery, BrowseRelation, FormBindings, FormPolicy, FormRecord, ListOutcome, MetadataSnapshot, ObjectRef, PolicyContext, RecordAdapter, RecordList, RecordListQuery } from '@formancy/data-core'
import { BROWSE_PARITY, browseCase, covers, EXPORT_PARITY, exportCase, FIXTURE_SCOPE, LIST_PARITY, LIST_ROWS, listCase, startPostgresFixture } from '@formancy/data-fixtures'
import type { PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'
import { listStatement } from './records/list.js'

/*
 * A form's records, a page at a time (0044), against REAL PostgreSQL loaded
 * with the shared fixture (0005) and LIST_ROWS, inserted by the owner.
 *
 * Every request is `planList`'s, from bindings generated over what discovery
 * reports and a clerk of tenant 1, so what reaches the adapter is what the
 * server sends; every expectation is LIST_PARITY's, written once for both
 * engines. The SQL Server suite runs the same cases, each declared with
 * `covers()` (0035).
 */

let fixture: PostgresFixture
let owner: Sql
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
const EVERY: RecordListQuery = { search: '', sort: [], parent: null, filter: [], offset: 0, limit: 50 }

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  for (const [number, name, credit] of LIST_ROWS.customers) {
    await owner.unsafe('insert into sales.customer (tenant_id, customer_no, name, credit_limit) values (1, $1::int, $2, $3::numeric)', [number, name, credit])
  }
  for (const [id, tenant] of LIST_ROWS.orders) {
    await owner.unsafe(`insert into sales."order" (id, tenant_id, customer_no, order_date, amount) overriding system value values ($1::bigint, $2::int, 1001, '2026-10-09', 1)`, [id, tenant])
  }
  for (const [order, line] of LIST_ROWS.lines) {
    await owner.unsafe('insert into sales.order_line (order_id, line_no, quantity, unit_price) values ($1::bigint, $2::int, 1, 1.00)', [order, line])
  }
  snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
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
    versionColumn: 'row_version',
  }).bindings
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
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

describe('pages in key order', covers('postgres', listCase('pages')), () => {
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

describe('a search', covers('postgres', listCase('search')), () => {
  // `%` and `_` are LIKE's own wildcards. A search for `100%` that found
  // "100 Percent", or `A_B` that found "AxB", would be a pattern the person
  // never typed; `[x]` means nothing to PostgreSQL's LIKE.
  test('matches %, _ and [ as themselves', async () => {
    for (const entry of LIST_PARITY.search) {
      expect(numbers(await listed(customers, CUSTOMER_POLICY, { search: entry.text })), entry.text).toEqual(entry.keys)
    }
  })
})

describe('a nullable sort', covers('postgres', listCase('nulls')), () => {
  // PostgreSQL puts NULLs last ascending and first descending; SQL Server
  // the other way round. The lookups' rule is last both ways, spelled for a
  // nullable column, so both engines give one order. Watched failing with
  // the placement left unspelled: descending began with the NULLs.
  test('puts NULLs last in both directions, ties broken by the key', async () => {
    expect(numbers(await listed(customers, CUSTOMER_POLICY, { sort: [{ field: 'credit_limit', direction: 'asc' }] }))).toEqual(LIST_PARITY.nulls.asc)
    expect(numbers(await listed(customers, CUSTOMER_POLICY, { sort: [{ field: 'credit_limit', direction: 'desc' }] }))).toEqual(LIST_PARITY.nulls.desc)
  })
})

describe('a NOT NULL sort', covers('postgres', listCase('order')), () => {
  // A NOT NULL column holds no NULL to place: its order is spelled bare, so
  // an index on it can serve it, and the order is the same.
  test('gives one order, from a statement that spells no NULL placement', async () => {
    const query = { ...EVERY, sort: [{ field: 'customer_no', direction: 'desc' as const }] }
    expect(numbers(await listed(customers, CUSTOMER_POLICY, query))).toEqual(LIST_PARITY.order.desc)
    const plan = planList(snapshot, customers, CUSTOMER_POLICY, CLARA, query)
    if (!plan.ok) throw new Error(plan.message)
    const { text } = listStatement(plan.request, listTerms(plan.request))
    expect(text).not.toMatch(/nulls (first|last)/)
    const nullable = planList(snapshot, customers, CUSTOMER_POLICY, CLARA, { ...EVERY, sort: [{ field: 'credit_limit', direction: 'desc' }] })
    if (!nullable.ok) throw new Error(nullable.message)
    expect(listStatement(nullable.request, listTerms(nullable.request)).text).toMatch(/"credit_limit" desc nulls last/)
  })
})

describe('a parent', covers('postgres', listCase('parent')), () => {
  // A child grid shows one parent's rows. The parent narrows; it never
  // admits: tenant 2's order, named by tenant 1's clerk, lists nothing.
  test("narrows a line list to one order's lines, and to none of another tenant's", async () => {
    const ours = LIST_PARITY.parent.ours
    expect(tokens(await listed(lines, LINE_POLICY, { parent: { field: 'order', record: `k1:${ours.order}` } }))).toEqual(ours.lines.map(lineToken))
    const theirs = LIST_PARITY.parent.theirs
    expect(tokens(await listed(lines, LINE_POLICY, { parent: { field: 'order', record: `k1:${theirs.order}` } }))).toEqual([])
  })
})

describe('lines listed through their order', covers('postgres', listCase('through')), () => {
  // order_line has no tenant column (0043). Without the through in the
  // list's own statement, tenant 2's line would be listed for tenant 1.
  test("lists the lines of tenant 1's orders and none of tenant 2's", async () => {
    expect(tokens(await listed(lines, LINE_POLICY, {}))).toEqual(LIST_PARITY.through.lines.map(lineToken))
  })
})

describe('every listed row is its read', covers('postgres', listCase('read')), () => {
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

describe('a parent over a text foreign key', covers('postgres', listCase('text-parent')), () => {
  // The parent's value is bound in the foreign key's type and compared with
  // the database's equality, as the foreign key compares it. Under the
  // fixture's deterministic default collation that equality is exact, so
  // `ch` names no country of tenant 1's customers here, where on SQL Server
  // it names CH.
  test("narrows a customer list to a country, as the database's equality compares char(2)", async () => {
    const entry = LIST_PARITY['text-parent']
    expect(numbers(await listed(customers, CUSTOMER_POLICY, { parent: { field: entry.field, record: entry.exact.record } }))).toEqual(entry.exact.keys)
    expect(numbers(await listed(customers, CUSTOMER_POLICY, { parent: { field: entry.field, record: entry.folded.record } }))).toEqual(entry.folded.keys.postgres)
  })
})

describe('a key the table no longer holds', covers('postgres', listCase('key')), () => {
  // A page pages by the key, and offset paging needs the order to be total:
  // the key unique and NOT NULL. The snapshot says it is; a page decided
  // over its own statement's description asks again (0044). Made nullable,
  // PostgreSQL's UNIQUE lets the column hold many NULLs, which have no token
  // and no order; with its key dropped, a value twice makes one record
  // appear twice on a page. Review calls the first a note and the second a
  // stop of update, and a read allows both, so a list decided as a read
  // listed them -- the second as a page that cannot be built. Watched
  // failing with the page decided as a read.
  test('refuses a page once its own description says the key can be NULL, or is not unique', async () => {
    await owner.unsafe('create table sales.list_key (code integer not null constraint uq_list_key unique, label varchar(20) not null)')
    for (const [code, label] of LIST_PARITY.key.rows) await owner.unsafe('insert into sales.list_key (code, label) values ($1::int, $2)', [code, label])
    const keyed = await discoverPostgres(owner, FIXTURE_SCOPE)
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

    await owner.unsafe('alter table sales.list_key alter column code drop not null')
    await owner.unsafe(`insert into sales.list_key (code, label) values (null, 'none'), (null, 'nothing')`)
    const loosened = await page()
    expect({ list: loosened.list?.code, read: loosened.read }).toEqual({ list: LIST_PARITY.key.refused, read: undefined })

    await owner.unsafe('alter table sales.list_key drop constraint uq_list_key')
    await owner.unsafe(`insert into sales.list_key (code, label) values (1, 'again')`)
    const dropped = await page()
    expect({ list: dropped.list?.code, read: dropped.read }).toEqual({ list: LIST_PARITY.key.refused, read: undefined })
    expect(() => recordPage(bindings, dropped.fields, dropped.outcome.rows, EVERY.limit)).toThrow('A record appears twice in one page')
  })
})

describe('a file of shipments', covers('postgres', exportCase('shipments')), () => {
  // A file is text, so where the engines spell a value their own way -- a
  // double, a real, a zoneless timestamp's fraction (0026) -- a file from
  // one would differ from the other's though their lists read alike. Built
  // as the server builds one (0079), from the list and data-core's export,
  // the bytes are EXPORT_PARITY's here and in the SQL Server suite.
  // Watched failing with the timestamp written through displayText, which
  // cuts its half second.
  test("is the shipments' values as read, the same text on both engines", async () => {
    const shipments = generateForm(snapshot, { connection: 'test', root: { schema: 'sales', name: 'shipment' }, formId: 'shipments', title: 'Shipments', lookups: [], pinned: ['tenant_id'] })
    const policy: FormPolicy = {
      version: 1,
      operations: { read: ['clerk'], create: [], update: [] },
      fields: { id: READ, tenant_id: READ, tracking_no: READ, carrier_code: READ, reference: READ, pickup_time: READ, dispatched_at: READ, weight_kg: READ, temperature_c: READ },
      rowFilters: TENANT,
      lookups: {},
    }
    const plan = planList(snapshot, shipments.bindings, policy, CLARA, EVERY)
    if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
    const outcome = await records.list(plan.request)
    if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
    const page = recordPage(shipments.bindings, plan.fields, outcome.rows, EVERY.limit)
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
async function browsed(query: Partial<BrowseQuery> & Pick<BrowseQuery, 'object'>) {
  const plan = planBrowse(snapshot, { equal: [], filter: [], search: '', sort: [], offset: 0, limit: 50, ...query })
  if (!plan.ok) throw new Error(`expected a browse, got ${plan.code}: ${plan.message}`)
  const outcome = await records.list(plan.request)
  if (!outcome.ok) throw new Error(`expected a page, got ${outcome.code}: ${outcome.message}`)
  return { plan, page: browsePage(outcome.rows, plan.request.limit) }
}

/** A page's rows as their values in the given columns' order, so a row is compared whole. */
const valuesIn = (columns: readonly string[], rows: ReadonlyArray<Record<string, unknown>>) => rows.map((row) => columns.map((column) => row[column]))

describe('a view browsed', covers('postgres', browseCase('view'), browseCase('sort'), browseCase('search')), () => {
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

describe('a table with columns that have no text', covers('postgres', browseCase('columns')), () => {
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
 * and the terms `followTerms` pairs from the row, browsed. Neither is
 * written here, so the key's columns are paired as this engine's catalog
 * reports them.
 */
async function followed(from: ObjectRef, direction: BrowseRelation['direction'], key: string, row: Readonly<Record<string, ApiValue>>) {
  const relation = browseRelations(snapshot, from).relations.find((entry) => entry.direction === direction && entry.key === key)
  if (relation === undefined) throw new Error(`${key} cannot be followed ${direction} from ${from.schema}.${from.name}`)
  const equal = followTerms(relation, row)
  if (equal === null) throw new Error(`${key} holds a NULL in the row followed from ${from.schema}.${from.name}`)
  return { relation, ...(await browsed({ object: relation.to.object, equal })) }
}

describe('a row followed through a foreign key', covers('postgres', browseCase('follows')), () => {
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
