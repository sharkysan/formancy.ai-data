import { buildLookupConfig, encodeKeyToken, generateForm } from '@formancy/data-core'
import type { LookupConfig, LookupResult, RowFilters } from '@formancy/data-core'
import type { SqlServerFixture } from '@formancy/data-fixtures'
import { loadSizedCustomers, sizedLookupPage, sizedResolveKeys, sizedRowsRead, sizedTerms, startSqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import type { ConnectionPool } from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { connectSqlServer, createSqlServerLookups, discoverSqlServer } from './index.js'

/**
 * What a lookup costs SQL Server on the sized `sales.customer` (0034): a
 * million customers, a tenth of them the writer's tenant. Held without a
 * clock, by the actual plan of each statement the adapter ran as the writer,
 * through a pool `connectSqlServer` opened (0025):
 *
 * - rows sent: the top operator returns at most a page and one row;
 * - rows read: with the tenant filter, exactly the tenant's rows, by seeks
 *   only, because no index serves a leading-wildcard LIKE or the order
 *   by name; with none, the whole table, a stated cost; resolve and the
 *   membership check, at most one row per key.
 *
 * Rows read are `ActualRowsRead`, summed over every thread of every operator
 * on `[sales].[customer]`: integers per thread, so the sum of a parallel
 * plan is exact.
 *
 * How the plan is read is P2 of 0034, run on 2026-10-09 on a Docker Sandbox
 * VM (Linux x86_64) on a Windows 11 workstation against SQL Server 2022
 * 16.0.4295.3 (CU27, Developer): `sys.dm_exec_query_plan_stats` with
 * LAST_QUERY_PLAN_STATS on gives `ActualRows` per thread but no
 * `ActualRowsRead`, so the count a residual LIKE hides cannot be read there.
 * An Extended Events session on `query_post_execution_showplan`, for the
 * writer's user only, gives the full actual plan of exactly the statement the
 * adapter sent, `ActualRowsRead` included; that is what this file reads, as
 * `sa`. The design's fallback, `set statistics xml on` over the builder's own
 * text, would not see a limit raised in `lookups.ts`.
 *
 * P1, the same day and machine: the first pages equal `sizedLookupPage`
 * under the database's SQL_Latin1_General_CP1_CI_AS. The plans then: the
 * tenant's searches a parallel Clustered Index Seek on tenant_id (degree 20
 * on 20 vCPUs), the unfiltered ones a Clustered Index Scan; the access is
 * pinned below and the degree printed. In this file's own container.
 */
let fixture: SqlServerFixture
let owner: ConnectionPool
let writer: ConnectionPool
let config: LookupConfig

/** The Extended Events session the plans come from: the writer's statements only. */
const SESSION = 'formancy_sized_plans'

const TENANT_ID = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
/** The order form's lookup filter for the clerk of tenant 1 (test-plane's clerkPolicy). */
const TENANT_1: RowFilters = { kind: 'restricted', equal: [{ column: 'tenant_id', type: TENANT_ID, value: '1' }] }
/** A form published with no tenant row filter: the security policy still shows the writer tenant 1 only. */
const NO_TENANT_FILTER: RowFilters = { kind: 'unrestricted' }

/**
 * What each lookup reads, from `@formancy/data-fixtures`: the expectation the
 * PostgreSQL suite pins too, and the one the performance page prints. Tenant
 * 1's rows, the fixture's 'Muster AG' included, for every tenant-filtered
 * search; the whole table on a form with no tenant filter; at most one row
 * per key.
 */
const { tenant: TENANT_ROWS, table: TABLE_ROWS, perKey: PER_KEY } = sizedRowsRead()

const TERMS = sizedTerms()
const SEARCHES = [
  ['the first page', ''],
  ['a search many customers match', TERMS.common],
  ['a search one customer matches', TERMS.unique],
  ['a search nobody matches', TERMS.absent],
] as const

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  await loadSizedCustomers({ kind: 'sqlserver', admin: fixture.admin })
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  const login = fixture.writer
  writer = await connectSqlServer({
    host: String(login.server),
    port: Number(login.port),
    database: String(login.database),
    user: String(login.user),
    password: String(login.password),
    encrypt: false,
    trustServerCertificate: true,
  })
  // Constants of this file, spliced: the session, the event and the user it watches.
  await owner.request().batch(`create event session ${SESSION} on server
    add event sqlserver.query_post_execution_showplan (where (sqlserver.username = N'formancy_writer'))
    add target package0.ring_buffer (set max_memory = 51200)
    with (max_dispatch_latency = 1 seconds)`)
  // As a deployment builds the order form's customer lookup: discovered,
  // generated with `name` displayed, then derived with no option set.
  const snapshot = await discoverSqlServer(owner, { schemas: ['sales'] })
  const { bindings } = generateForm(snapshot, { connection: 'test', root: { schema: 'sales', name: 'order' }, formId: 'sized', title: 'Sized', lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }] })
  const field = bindings.fields.find((candidate) => candidate.kind === 'lookup')
  if (field === undefined) throw new Error('the generator made no customer lookup')
  config = buildLookupConfig(bindings, field.field, { snapshot })
})

afterAll(async () => {
  await writer?.close()
  await owner?.close()
  await fixture?.stop()
})

function tokenOf(tenantId: number, customerNo: number): string {
  const encoded = encodeKeyToken([String(tenantId), String(customerNo)])
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}

/** One operator of an actual plan: what it is, the object it reads, its depth, and each thread's counters. */
interface Operator {
  physical: string
  depth: number
  object: string | undefined
  threads: Array<Record<string, string>>
}

/**
 * The operators of a showplan, in document order. A tag reader rather than an
 * XML library, for the three elements it needs: `RelOp` nests, its
 * `RunTimeCountersPerThread` are its own, and the first `Object` inside it
 * before any child operator is what it reads. Attribute values are quoted and
 * escaped by the server, so a `>` never ends a tag early.
 */
function operators(xml: string): Operator[] {
  const all: Operator[] = []
  const open: Operator[] = []
  for (const tag of xml.matchAll(/<(\/?)([\w:]+)((?:\s+[\w:]+="[^"]*")*)\s*\/?>/g)) {
    const [, closing, name, attributeText] = tag
    const attributes = Object.fromEntries([...(attributeText ?? '').matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], match[2]])) as Record<string, string>
    const current = open.at(-1)
    if (name === 'RelOp' && closing === '') {
      const operator: Operator = { physical: attributes['PhysicalOp'] ?? '?', depth: open.length, object: undefined, threads: [] }
      open.push(operator)
      all.push(operator)
    } else if (name === 'RelOp') open.pop()
    else if (closing === '' && name === 'RunTimeCountersPerThread' && current !== undefined) current.threads.push(attributes)
    else if (closing === '' && name === 'Object' && current !== undefined && current.object === undefined) current.object = `${attributes['Schema'] ?? ''}.${attributes['Table'] ?? ''}`
  }
  return all
}

const total = (operator: Operator, counter: string): number => operator.threads.reduce((sum, thread) => sum + Number(thread[counter] ?? 0), 0)

/** The actual plans of the writer's statements on `sales.customer` that `run` caused, and what the adapter answered. */
async function plansOf<T>(run: () => Promise<T>): Promise<{ answer: T; plans: string[] }> {
  await owner.request().batch('dbcc freeproccache with no_infomsgs')
  await owner.request().batch(`alter event session ${SESSION} on server state = start`)
  try {
    const answer = await run()
    const read = async (): Promise<string[]> => {
      const result = await owner
        .request()
        .input('session', mssql.NVarChar(128), SESSION)
        .query<{ x: string | null }>(`select cast(t.target_data as nvarchar(max)) as x from sys.dm_xe_session_targets as t
          join sys.dm_xe_sessions as s on s.address = t.event_session_address where s.name = @session and t.target_name = N'ring_buffer'`)
      const ring = result.recordset[0]?.x ?? ''
      return [...ring.matchAll(/<ShowPlanXML[\s\S]*?<\/ShowPlanXML>/g)].map((match) => match[0]).filter((plan) => plan.includes('Schema="[sales]" Table="[customer]"'))
    }
    // Events reach the ring buffer within the session's dispatch latency, a
    // second. Waited for, then read once more a dispatch later, so a second
    // statement would be counted rather than missed.
    const deadline = Date.now() + 15_000
    while ((await read()).length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200))
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    return { answer, plans: await read() }
  } finally {
    await owner.request().batch(`alter event session ${SESSION} on server state = stop`)
  }
}

/** The one plan `run` caused on `sales.customer`: its rows returned, rows read on customer, the operators reading it, and its parallelism. */
async function costOf<T>(run: () => Promise<T>): Promise<{ answer: T; returned: number; read: number; access: string[]; dop: string }> {
  const { answer, plans } = await plansOf(run)
  expect(plans, 'one statement on sales.customer').toHaveLength(1)
  const plan = plans[0] as string
  const all = operators(plan)
  const onCustomer = all.filter((operator) => operator.object === '[sales].[customer]')
  const root = all.find((operator) => operator.depth === 0)
  return {
    answer,
    returned: root === undefined ? Number.NaN : total(root, 'ActualRows'),
    read: onCustomer.reduce((sum, operator) => sum + total(operator, 'ActualRowsRead'), 0),
    access: [...new Set(onCustomer.map((operator) => operator.physical))],
    dop: /DegreeOfParallelism="(\d+)"/.exec(plan)?.[1] ?? '?',
  }
}

/** What the adapter must answer: `sizedLookupPage` as tokens and labels. */
function expectedPage(search: string): LookupResult {
  const page = sizedLookupPage(1, search, 50)
  return { rows: page.rows.map((row) => ({ token: tokenOf(row.tenantId, row.customerNo), label: row.name })), hasMore: page.hasMore, omitted: 0 }
}

describe.each([
  ['the order form, filtered to the tenant', TENANT_1, TENANT_ROWS, ['Clustered Index Seek']],
  ['a form with no tenant row filter', NO_TENANT_FILTER, TABLE_ROWS, ['Clustered Index Scan']],
] as const)('lookups over the sized customers on %s', (form, filters, pinned, access) => {
  // P1 and the counts at once. The page must be the generator's, row for row,
  // in SQL_Latin1_General_CP1_CI_AS order: a name list whose case-insensitive
  // order differed from its code-point order would answer differently here
  // than on PostgreSQL. Then the cost: a dropped tenant filter is a Clustered
  // Index Scan of 1,000,002; a dropped OFFSET … FETCH, or a limit raised in
  // lookups.ts, returns thousands where 51 is the most. Seeks only, for the
  // tenant: a scan that a residual predicate trims to the same rows would
  // still read the table.
  test.each(SEARCHES)('%s answers the generator\'s page, returns at most 51 and reads exactly the rows the filter admits', async (name, search) => {
    const cost = await costOf(() => createSqlServerLookups(writer).search(config, { search, offset: 0, limit: 50 }, filters))
    console.log(`${form}, ${name}: DOP ${cost.dop}, ${cost.access.join(', ')}, read ${String(cost.read)}, returned ${String(cost.returned)}`)
    expect(cost.answer).toEqual(expectedPage(search))
    expect(cost.returned).toBeLessThanOrEqual(51)
    expect(cost.read).toBe(pinned)
    expect(cost.access).toEqual(access)
  })
})

describe('resolving and checking keys on the sized customers', () => {
  // The most one request may ask (100 tokens) costs one seek per key, and one
  // stored value -- what a form shows for a saved order -- one seek. A key
  // compared in a shape no index serves -- `customer_no + 0` -- reads the
  // tenant's 100,001 rows to find a hundred, or one.
  test.each([100, 1])('resolving %i keys reads at most one row per key, by seeks', async (n) => {
    const keys = sizedResolveKeys(n)
    const cost = await costOf(() => createSqlServerLookups(writer).resolve(config, keys.map((key) => tokenOf(key.tenantId, key.customerNo)), TENANT_1))
    expect(cost.answer).toHaveLength(n)
    expect(cost.read).toBeGreaterThan(0)
    expect(cost.read).toBeLessThanOrEqual(n * PER_KEY)
    expect(cost.access).toEqual(['Clustered Index Seek'])
  })

  // The membership check a create makes for its one customer.
  test('checking one key reads at most one row', async () => {
    const [key] = sizedResolveKeys(1)
    if (key === undefined) throw new Error('no key')
    const cost = await costOf(() => createSqlServerLookups(writer).rejects(config, [tokenOf(key.tenantId, key.customerNo)], TENANT_1))
    expect(cost.answer).toEqual([])
    expect(cost.read).toBe(PER_KEY)
  })
})
