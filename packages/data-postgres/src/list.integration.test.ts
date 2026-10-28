import { browsePage, browseRelations, driftRefusal, exportColumns, exportHeader, exportRecord, followTerms, generateForm, listTerms, planBrowse, planList, planRead, recordPage, toFormAnswers } from '@formancy/data-core'
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
  startPostgresFixture,
} from '@formancy/data-fixtures'
import type { PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'
import { listStatement } from './records/list.js'

/*
 * A form's records, a page at a time (0044), against REAL PostgreSQL loaded
 * with the shared fixture (0005), LIST_ROWS and COLUMN_FILTER_ROWS, written
 * by the owner.
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
  // Each value through text: postgres.js would send a parameter the server
  // calls a timestamp through JavaScript's Date, in this machine's zone, and
  // the text 'true' to a boolean as false (sql/statement.ts).
  for (const [number, created, active] of COLUMN_FILTER_ROWS.customers) {
    await owner.unsafe('update sales.customer set created_at = $2::text::timestamptz, active = $3::text::boolean where tenant_id = 1 and customer_no = $1::int', [number, created, String(active)])
  }
  for (const [reference, tracking, dispatched] of COLUMN_FILTER_ROWS.shipments) {
    await owner.unsafe(
      `insert into sales.shipment (tenant_id, tracking_no, carrier_code, reference, pickup_time, dispatched_at) values ($1::int, $2::text::uuid, 1, $3, '08:00', $4::text::timestamp)`,
      [COLUMN_FILTER_TENANT, tracking, reference, dispatched],
    )
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
  shipments = generateForm(snapshot, { connection: 'test', root: { schema: 'sales', name: 'shipment' }, formId: 'shipments', title: 'Shipments', lookups: [], pinned: ['tenant_id'] })
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

/** One page as the server answers it: planned for Clara, or `context`, listed by the adapter, and built by `recordPage`. */
async function listed(bindings: FormBindings, policy: FormPolicy, change: Partial<RecordListQuery>, context = CLARA, adapter = records): Promise<RecordList & { outcome: ListOutcome }> {
  const query = { ...EVERY, ...change }
  const plan = planList(snapshot, bindings, policy, context, query)
  if (!plan.ok) throw new Error(`expected a list, got ${plan.code}: ${plan.message}`)
  const outcome = await adapter.list(plan.request)
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
    const plan = planList(snapshot, shipments.bindings, SHIPMENT_POLICY, CLARA, EVERY)
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
async function browsed(query: Partial<BrowseQuery> & Pick<BrowseQuery, 'object'>, adapter = records, over = snapshot) {
  const plan = planBrowse(over, { equal: [], filter: [], search: '', sort: [], offset: 0, limit: 50, ...query })
  if (!plan.ok) throw new Error(`expected a browse, got ${plan.code}: ${plan.message}`)
  const outcome = await adapter.list(plan.request)
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

describe('a filter that a text equals', covers('postgres', columnFilterCase('text')), () => {
  // PostgreSQL's `=` under the fixture's deterministic collation already
  // counts case and a trailing space, so this case passes here with the
  // column's own equality alone -- watched -- and fails SQL Server's. Under
  // a nondeterministic collation it would not: the row filter's spelling,
  // `"C"` beside the column's own equality, holds either way (0028), and
  // `column filter: collation` below is where that half is held.
  test('finds the reference exactly as given: case and a trailing space count', async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.text
    for (const entry of entries) expect(references(await shipmentsWhere([{ field, op: 'equals', value: entry.value }])), JSON.stringify(entry.value)).toEqual(entry.references)
  })
})

describe('a filter on an integer', covers('postgres', columnFilterCase('integer')), () => {
  // Tenant 2 has a customer 1001 too: a filter that admitted rows of its own
  // would list it. A bound compared strictly would lose the row on it.
  test("equals tenant 1's 1001 alone, and a range holds the rows on both its ends", async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.integer
    for (const entry of entries) expect(numbers(await customersWhere([{ field, ...entry.condition }])), entry.condition.op).toEqual(entry.keys)
  })
})

describe('a filter on a decimal', covers('postgres', columnFilterCase('decimal')), () => {
  // `50` reaches the adapter as `50.00`, the column's own spelling, cast to
  // numeric; a range from `-1` holds the customer at -1.00.
  test('equals 50 as 50.00, and a range holds the rows on both its ends', async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.decimal
    for (const entry of entries) expect(numbers(await customersWhere([{ field, ...entry.condition }])), entry.condition.op).toEqual(entry.keys)
  })
})

describe('a filter on a boolean', covers('postgres', columnFilterCase('boolean')), () => {
  // postgres.js sends the text 'true' to a parameter it is told is a boolean
  // as false (sql/statement.ts): the value is text, cast to bool where it
  // stands, or `true` would find the inactive customers.
  test('finds the inactive customers, and the active ones', async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.boolean
    for (const entry of entries) expect(numbers(await customersWhere([{ field, ...entry.condition }])), entry.condition.value).toEqual(entry.keys)
  })
})

describe('a filter on a uuid', covers('postgres', columnFilterCase('uuid')), () => {
  // Typed in upper case, the value is spelled in lower by the planner and
  // cast to uuid; compared as text with the upper case it would find nothing.
  test('finds the shipment whose tracking number it names, in either case', async () => {
    const { field, value, references: expected } = COLUMN_FILTER_PARITY.uuid
    expect(references(await shipmentsWhere([{ field, op: 'equals', value }]))).toEqual(expected)
  })
})

describe('a filter that a text contains', covers('postgres', columnFilterCase('contains')), () => {
  // `%` and `_` are LIKE's wildcards, and `[x]` SQL Server's character
  // class: matched as patterns, each would find a name the person never
  // typed. ILIKE folds case, as the list's search does.
  test('matches %, _ and [x] as themselves, case folded', async () => {
    const { field, entries } = COLUMN_FILTER_PARITY.contains
    for (const entry of entries) expect(numbers(await customersWhere([{ field, op: 'contains', text: entry.text }])), entry.text).toEqual(entry.keys)
  })
})

describe('a filter on NULL', covers('postgres', columnFilterCase('nulls')), () => {
  // A NULL is in no range and equals nothing: only `null` finds it, and
  // `not-null` everything else.
  test('finds the customers with no credit limit, and those with one', async () => {
    const { field } = COLUMN_FILTER_PARITY.nulls
    expect(numbers(await customersWhere([{ field, op: 'null' }]))).toEqual(COLUMN_FILTER_PARITY.nulls.null)
    expect(numbers(await customersWhere([{ field, op: 'not-null' }]))).toEqual(COLUMN_FILTER_PARITY.nulls['not-null'])
  })
})

describe('several filters', covers('postgres', columnFilterCase('together')), () => {
  // Joined by OR, or one replacing another, two conditions would find what
  // either finds; every condition holds.
  test('find the rows every condition holds for', async () => {
    for (const entry of COLUMN_FILTER_PARITY.together) expect(numbers(await customersWhere([...entry.filter]))).toEqual(entry.keys)
  })
})

describe('a filter beside a search', covers('postgres', columnFilterCase('search')), () => {
  // The search and the filter are both conditions of the one statement:
  // either alone would find more.
  test('finds the rows both hold for', async () => {
    for (const entry of COLUMN_FILTER_PARITY.search) expect(numbers(await customersWhere([...entry.filter], { search: entry.search })), entry.search).toEqual(entry.keys)
  })
})

describe('a filter beside a parent', covers('postgres', columnFilterCase('parent')), () => {
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

describe('a filter beside a follow', covers('postgres', columnFilterCase('follow')), () => {
  // A follow's equal and a filter are both narrowings of one browse: the
  // customer's orders, of the one date.
  test("narrows a customer's orders, followed, to those of one date", async () => {
    const { object, equal, key, entries } = COLUMN_FILTER_PARITY.follow
    const [customer] = (await browsed({ object, equal: [...equal] })).page.rows
    if (customer === undefined) throw new Error('the customer followed from was not browsed')
    for (const entry of entries) expect((await followed(object, 'referred-by', key, customer, [...entry.filter])).page.rows.map((row) => row['id'])).toEqual(entry.ids)
  })
})

describe('a filter on a column under a case-insensitive collation', covers('postgres', columnFilterCase('collation')), () => {
  // tenant_code's collation is a nondeterministic ICU one that folds case,
  // under which `=` calls `acme` and `ACME` equal: the column's own equality
  // alone found both, watched failing so. The row filter's spelling, the
  // same again under "C", finds the one. And PostgreSQL refuses LIKE under
  // that collation outright (0A000): the search's spelling, collated to the
  // database's default, is what lets a contains run on it at all.
  test('equals exactly what the row filter admits, and contains case folded', async () => {
    const parity = await discoverPostgres(owner, PARITY_SCOPE)
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

describe('a timestamp or a date, in the session the composition root chose', () => {
  let zonedSql: Sql
  let zoned: RecordAdapter

  // The composition root may set TimeZone and DateStyle. Pacific/Chatham is
  // +13:45 in March, so an instant's bound read on the session's clock lands
  // in another day: watched failing here alone, the default session
  // passing, with an instant's bound cast to a zoneless timestamp. `SQL,
  // DMY` reads `03/01/2026` as the third of January, where the default
  // reads it as the first of March: watched failing here alone with every
  // bound written month first. Year first, as the planner writes them,
  // neither setting moves a day.
  beforeAll(async () => {
    zonedSql = postgres(fixture.admin, { onnotice: () => {}, connection: { TimeZone: 'Pacific/Chatham', DateStyle: 'SQL, DMY' } })
    const [settings] = await zonedSql<{ zone: string; style: string }[]>`select current_setting('TimeZone') as zone, current_setting('DateStyle') as style`
    expect(settings).toEqual({ zone: 'Pacific/Chatham', style: 'SQL, DMY' })
    zoned = createPostgresRecords(zonedSql)
  })

  afterAll(async () => {
    await zonedSql?.end()
  })

  const sessions = (): Array<[string, RecordAdapter]> => [
    ['the default session', records],
    ['Pacific/Chatham, SQL, DMY', zoned],
  ]

  describe('a day range on an instant', covers('postgres', columnFilterCase('instant')), () => {
    // The instants were written in three offsets. Compared in UTC, from the
    // first midnight to below the next after the last day, the one at the
    // last millisecond is inside and the next midnight outside, whatever
    // day each one's own clock showed.
    test('holds the instants in its days in UTC, in any session', async () => {
      const { field, entries } = COLUMN_FILTER_PARITY.instant
      for (const [session, adapter] of sessions()) {
        for (const { from, to, keys } of entries) {
          expect(numbers(await customersWhere([{ field, op: 'range', from, to }], {}, adapter)), `${session}: ${String(from)}..${String(to)}`).toEqual(keys)
        }
      }
    })
  })

  describe('a day range on a timestamp in no zone', covers('postgres', columnFilterCase('zoneless')), () => {
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

  describe('a filter on a date, browsed', covers('postgres', columnFilterCase('date')), () => {
    // A browse's filter names a column. A date is bound as a date: one day's
    // range holds the order on both its ends, a from alone what follows.
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
