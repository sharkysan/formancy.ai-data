import { buildLookupConfig, encodeKeyToken, generateForm } from '@formancy/data-core'
import type { LookupConfig, LookupResult, RowFilters } from '@formancy/data-core'
import type { PostgresFixture } from '@formancy/data-fixtures'
import { loadSizedCustomers, sizedLookupPage, sizedResolveKeys, sizedRowsRead, sizedTerms, startPostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresLookups, discoverPostgres } from './index.js'

/**
 * What a lookup costs PostgreSQL on the sized `sales.customer` (0034): a
 * million customers, a tenth of them the writer's tenant. Held without a
 * clock, by what the plan of each statement the adapter actually sent says:
 *
 * - rows sent: the top node returns at most a page and one row;
 * - rows read: with the tenant filter, exactly the tenant's rows for every
 *   search and the first page, because no index serves a leading-wildcard
 *   contains or the order by name; with none, the whole table, a stated cost;
 *   resolve and the membership check, at most one row per key.
 *
 * Each statement is captured through postgres.js's `debug` hook while
 * `createPostgresLookups` runs, and its exact text and parameters are
 * replayed under EXPLAIN (ANALYZE) as the writer. A test that explained text
 * it built itself would never see a limit raised in `lookups.ts`.
 *
 * Rows read are summed over the scans on `customer` as (Actual Rows + Rows
 * Removed by Filter + Rows Removed by Index Recheck) × Actual Loops.
 * PostgreSQL 17 prints those as per-loop averages rounded to whole rows, so
 * the exact count comes from a session with max_parallel_workers_per_gather
 * = 0, where each search's scan runs once; the default, parallel, plan --
 * what the server runs -- is held to its node family and to the count within
 * the rounding: half a row per loop for each summed term.
 *
 * Probes P3 and P9 of 0034, run on 2026-10-09 on a Docker Sandbox VM (Linux
 * x86_64) on a Windows 11 workstation against PostgreSQL 17.11 on musl:
 * under both settings the tenant's searches are a Bitmap Heap Scan over a
 * Bitmap Index Scan of pk_customer on tenant_id, parallel (two workers)
 * under the defaults; the unfiltered ones a Seq Scan; JIT never fired, every
 * plan costing less than jit_above_cost. The family is pinned below; JIT and
 * the workers are printed. In this file's own container, so no other suite
 * sees the load.
 */
let fixture: PostgresFixture
let owner: Sql
let writer: Sql
let explainer: Sql
let config: LookupConfig

/** What the writer's client sent, in order: text, parameters and the types postgres.js chose for them. */
const sent: Array<{ text: string; parameters: unknown[]; types: number[] }> = []

const TENANT_ID = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
/** The order form's lookup filter for the clerk of tenant 1 (test-plane's clerkPolicy). */
const TENANT_1: RowFilters = { kind: 'restricted', equal: [{ column: 'tenant_id', type: TENANT_ID, value: '1' }] }
/** A form published with no tenant row filter: row security still shows the writer tenant 1 only. */
const NO_TENANT_FILTER: RowFilters = { kind: 'unrestricted' }

/**
 * What each lookup reads, from `@formancy/data-fixtures`: the expectation the
 * SQL Server suite pins too, and the one the performance page prints. Tenant
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
  fixture = await startPostgresFixture()
  await loadSizedCustomers({ kind: 'postgres', admin: fixture.admin })
  owner = postgres(fixture.admin, { onnotice: () => {} })
  writer = postgres(fixture.writer, {
    onnotice: () => {},
    debug: (_connection: number, text: string, parameters: unknown[], types: number[]) => sent.push({ text, parameters, types }),
  })
  explainer = postgres(fixture.writer, { onnotice: () => {}, max: 1 })
  // As a deployment builds the order form's customer lookup: discovered,
  // generated with `name` displayed, then derived with no option set.
  const sales = await discoverPostgres(owner, { schemas: ['sales'] })
  const { bindings } = generateForm(sales, { connection: 'test', root: { schema: 'sales', name: 'order' }, formId: 'sized', title: 'Sized', lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }] })
  const field = bindings.fields.find((candidate) => candidate.kind === 'lookup')
  if (field === undefined) throw new Error('the generator made no customer lookup')
  config = buildLookupConfig(bindings, field.field, { snapshot: sales })
})

afterAll(async () => {
  await Promise.all([owner?.end(), writer?.end(), explainer?.end()])
  await fixture?.stop()
})

function tokenOf(tenantId: number, customerNo: number): string {
  const encoded = encodeKeyToken([String(tenantId), String(customerNo)])
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}

/** The one statement on `sales.customer` that `run` made the adapter send, and what the adapter answered. */
async function capture<T>(run: () => Promise<T>): Promise<{ answer: T; statement: (typeof sent)[number] }> {
  sent.length = 0
  const answer = await run()
  const statements = sent.filter((entry) => entry.text.includes('from "sales"."customer"'))
  expect(statements, 'one statement on sales.customer').toHaveLength(1)
  return { answer, statement: statements[0] as (typeof sent)[number] }
}

interface PlanNode {
  'Node Type': string
  'Relation Name'?: string
  'Index Name'?: string
  'Index Cond'?: string
  'Recheck Cond'?: string
  'Actual Rows': number
  'Actual Loops': number
  'Rows Removed by Filter'?: number
  'Rows Removed by Index Recheck'?: number
  'Workers Launched'?: number
  'Parallel Aware'?: boolean
  Plans?: PlanNode[]
}
interface Explained {
  Plan: PlanNode
  JIT?: unknown
}

/** The captured statement, replayed exactly as the writer under EXPLAIN (ANALYZE), serially or under the defaults. */
async function explain(statement: (typeof sent)[number], session: 'serial' | 'defaults'): Promise<Explained> {
  return explainer.begin(async (tx) => {
    if (session === 'serial') await tx.unsafe('set local max_parallel_workers_per_gather = 0')
    const parameters = statement.parameters.map((value, index) => tx.typed(value as string, statement.types[index] as number))
    const [row] = await tx.unsafe<Array<{ 'QUERY PLAN': Explained[] }>>(`explain (analyze, format json) ${statement.text}`, parameters)
    return row?.['QUERY PLAN'][0] as Explained
  }) as Promise<Explained>
}

function nodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(nodes)]
}

/** The plan nodes that read `customer`'s heap; a Bitmap Index Scan feeds one and names no relation. */
const customerScans = (plan: Explained): PlanNode[] => nodes(plan.Plan).filter((node) => node['Relation Name'] === 'customer')

const TERMS_READ = ['Actual Rows', 'Rows Removed by Filter', 'Rows Removed by Index Recheck'] as const

/** Rows the scans on `customer` examined, and how far PostgreSQL's per-loop rounding can put that from the truth. */
function rowsRead(plan: Explained): { read: number; bound: number } {
  let read = 0
  let bound = 0
  for (const node of customerScans(plan)) {
    for (const term of TERMS_READ) {
      const value = node[term]
      if (value === undefined) continue
      read += value * node['Actual Loops']
      bound += node['Actual Loops'] / 2
    }
  }
  return { read, bound }
}

/** "Bitmap Heap Scan on customer ← Bitmap Index Scan using pk_customer (cond)", the shape P3 found, as one line. */
function shape(plan: Explained): string[] {
  return customerScans(plan).map((node) => {
    const index = (node.Plans ?? []).find((child) => child['Node Type'] === 'Bitmap Index Scan')
    return index === undefined ? node['Node Type'] : `${node['Node Type']} <- ${index['Node Type']} using ${String(index['Index Name'])} ${String(index['Index Cond'])}`
  })
}

/** What the adapter must answer: `sizedLookupPage` as tokens and labels. */
function expectedPage(search: string): LookupResult {
  const page = sizedLookupPage(1, search, 50)
  return { rows: page.rows.map((row) => ({ token: tokenOf(row.tenantId, row.customerNo), label: row.name })), hasMore: page.hasMore, omitted: 0 }
}

describe.each([
  ['the order form, filtered to the tenant', TENANT_1, TENANT_ROWS, 'Bitmap Heap Scan <- Bitmap Index Scan using pk_customer (tenant_id = 1)'],
  ['a form with no tenant row filter', NO_TENANT_FILTER, TABLE_ROWS, 'Seq Scan'],
] as const)('lookups over the sized customers on %s', (_form, filters, pinned, family) => {
  // The answer both engines must give, row for row, in code-point order on
  // musl: a lookup whose page drifted from the generator's would make every
  // count below a count of the wrong statement. Row security still shows
  // the writer tenant 1 only, so the unfiltered form answers the same.
  test.each(SEARCHES)('%s answers the page the generator expects', async (_name, search) => {
    const { answer } = await capture(() => createPostgresLookups(writer).search(config, { search, offset: 0, limit: 50 }, filters))
    expect(answer).toEqual(expectedPage(search))
  })

  // The exact count. A dropped tenant filter reads the table (1,000,002); a
  // limit removed, or raised in lookups.ts and trimmed in JavaScript, sends
  // the server thousands of rows where 51 is the most; a scan that ran in
  // several loops could not be summed exactly, so Actual Loops 1 is asserted
  // first and the session is what makes it so.
  test.each(SEARCHES)('%s reads exactly the rows the filter admits and returns at most 51, serially', async (_name, search) => {
    const { statement } = await capture(() => createPostgresLookups(writer).search(config, { search, offset: 0, limit: 50 }, filters))
    const plan = await explain(statement, 'serial')
    for (const scan of customerScans(plan)) expect(scan['Actual Loops'], 'a scan on customer ran more than once').toBe(1)
    expect(plan.Plan['Actual Rows']).toBeLessThanOrEqual(51)
    expect(rowsRead(plan).read).toBe(pinned)
    expect(shape(plan)).toEqual([family])
  })

  // What the server runs: the default plan, parallel on this image. Its
  // counts are rounded per loop, so the count is held within that rounding,
  // and its node family is pinned: a tenant's lookup turning into a Seq Scan
  // or Parallel Seq Scan of the million rows fails here by name. JIT and
  // parallelism are printed, for 0034's record (P9).
  test.each(SEARCHES)('%s under the default plan scans the same way and reads the same rows, within its rounding', async (name, search) => {
    const { statement } = await capture(() => createPostgresLookups(writer).search(config, { search, offset: 0, limit: 50 }, filters))
    const plan = await explain(statement, 'defaults')
    const { read, bound } = rowsRead(plan)
    console.log(`${_form}, ${name}: workers launched ${JSON.stringify(nodes(plan.Plan).map((node) => node['Workers Launched']).filter((n) => n !== undefined))}, JIT ${JSON.stringify(plan.JIT ?? null)}, read ${String(read)} ± ${String(bound)}`)
    expect(plan.Plan['Actual Rows']).toBeLessThanOrEqual(51)
    expect(Math.abs(read - pinned), `read ${String(read)}, pinned ${String(pinned)}, rounding bound ${String(bound)}`).toBeLessThanOrEqual(bound)
    expect(shape(plan)).toEqual([family])
  })
})

describe('resolving and checking keys on the sized customers', () => {
  // The most one request may ask (100 tokens) costs one index probe per key,
  // and one stored value -- what a form shows for a saved order -- one probe.
  // A key compared in a shape no index serves -- `customer_no + 0` -- reads
  // the tenant's 100,001 rows to find a hundred, or one.
  test.each([
    [100, 'serial'],
    [100, 'defaults'],
    [1, 'serial'],
    [1, 'defaults'],
  ] as const)('resolving %i keys reads at most one row per key (%s)', async (n, session) => {
    const keys = sizedResolveKeys(n)
    const { answer, statement } = await capture(() => createPostgresLookups(writer).resolve(config, keys.map((key) => tokenOf(key.tenantId, key.customerNo)), TENANT_1))
    expect(answer).toHaveLength(n)
    const plan = await explain(statement, session)
    expect(rowsRead(plan).read).toBeGreaterThan(0)
    expect(rowsRead(plan).read).toBeLessThanOrEqual(n * PER_KEY)
  })

  // The membership check a create makes for its one customer.
  test.each(['serial', 'defaults'] as const)('checking one key reads at most one row (%s)', async (session) => {
    const [key] = sizedResolveKeys(1)
    if (key === undefined) throw new Error('no key')
    const { answer, statement } = await capture(() => createPostgresLookups(writer).rejects(config, [tokenOf(key.tenantId, key.customerNo)], TENANT_1))
    expect(answer).toEqual([])
    const plan = await explain(statement, session)
    expect(rowsRead(plan).read).toBe(PER_KEY)
  })
})
