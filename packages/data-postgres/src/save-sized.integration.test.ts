import { DEFAULT_SAVE_DEADLINE_MS, SAVE_MAX_ROWS, TOGETHER_MAX_ROWS } from '@formancy/data-core'
import type { RecordAdapter, SaveRequest } from '@formancy/data-core'
import {
  FIXTURE_SCOPE,
  percentiles,
  plannedSave,
  SAVE_SIZES,
  saveAnswer,
  savedToken,
  sizedSaveForms,
  startPostgresFixture,
  startTcpHop,
  withLines,
} from '@formancy/data-fixtures'
import type { PostgresFixture, SavedForms, TcpHop } from '@formancy/data-fixtures'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * What a save of a record with its rows costs PostgreSQL (0155), on the
 * fixture's sales.order_line: an order's lines created in one save, at each
 * of SAVE_SIZES, past what a together child may hold (`withLines`). Held
 * without a clock where a fact has none to read -- the round trips a save
 * makes, counted by the TCP hop as turns, and that every save is stored --
 * and timed, and reported, where it has: the save from its first statement
 * to its answer, which on PostgreSQL is the transaction, BEGIN to COMMIT,
 * since nothing is sent before it; and the answer's bytes, as JSON.
 *
 * The timings are what SAVE_MAX_ROWS and DEFAULT_SAVE_DEADLINE_MS were set
 * from (data-core's save-limits.ts says on what and when). The one clock
 * this suite holds is that a save of SAVE_MAX_ROWS lines, planned with the
 * default deadline, is stored within it: a runner on which it is not has
 * outgrown the measurement, and the deadline is measured again there. In
 * this file's own container, so no other suite's load is timed.
 */

let fixture: PostgresFixture
let owner: Sql
let records: RecordAdapter
let forms: { orders: SavedForms['orders']; lines: SavedForms['lines'] }
let hop: TcpHop
let viaHop: Sql

/** Runs per size: the timings reported are each size's over these. */
const RUNS = 20
/** Long enough for the largest size on a loaded runner: a measurement is never cut by the deadline it sets. */
const MEASURING = 60_000

/**
 * The turns a save of `n` creates makes besides two per create, counted
 * through the hop on postgres:17-alpine: postgres.js sends each statement
 * with parameters as two -- Parse and Describe, then Bind and Execute -- and
 * BEGIN and COMMIT as one each; so BEGIN, the two SETs, the order's touch,
 * the count, the read-back and COMMIT, 1 + 4 + 2 + 2 + 2 + 1. The locked
 * path's LOCK is not taken under READ COMMITTED.
 */
const TURNS_BESIDE_CREATES = 12

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  forms = sizedSaveForms(await discoverPostgres(owner, FIXTURE_SCOPE), TOGETHER_MAX_ROWS)
  records = createPostgresRecords(owner)
  const target = new URL(fixture.admin)
  hop = await startTcpHop({ kind: 'postgres', host: target.hostname, port: Number(target.port) })
  viaHop = postgres({
    host: '127.0.0.1',
    port: hop.port,
    username: decodeURIComponent(target.username),
    password: decodeURIComponent(target.password),
    database: target.pathname.slice(1),
    max: 1,
    onnotice: () => {},
  })
  // Connected before anything is counted: the start-up and authentication are no save's turns.
  await viaHop`select 1`
})

afterAll(async () => {
  await viaHop?.end({ timeout: 1 })
  await hop?.close()
  await owner?.end()
  await fixture?.stop()
})

/** A new order of tenant 1, with no lines, as the owner inserts it; its id. */
async function freshOrder(): Promise<number> {
  const [row] = await owner<
    { id: number }[]
  >`insert into sales."order" (tenant_id, customer_no, order_date, amount) values (1, 1001, '2026-11-15', 1) returning id::int as id`
  return (row as { id: number }).id
}

/** A save of `n` new lines of a new order, planned as the route plans one with one line through `via`, then given `n`. */
async function sized(n: number, deadlineMs: number = MEASURING, via: RecordAdapter = records): Promise<SaveRequest> {
  const id = await freshOrder()
  const [row] = await owner<{ version: string }[]>`select row_version::text as version from sales."order" where id = ${id}`
  const plan = await plannedSave(
    via,
    forms.orders,
    [forms.lines],
    {
      record: { update: { record: savedToken(['id'], { id }), version: (row as { version: string }).version, answers: {} } },
      rows: [{ form: 'sales-order-line', field: 'order', changes: [{ create: { ref: 'a', answers: { line_no: 1, quantity: 2, unit_price: '1.50' } } }] }],
    },
    deadlineMs,
    { actor: { id: 'clara', roles: ['clerk'] }, attributes: { tenant: '1' } },
  )
  return withLines(plan.request, n)
}

describe('a save of an order and its lines on sales.order_line (0155)', () => {
  const report: Array<Record<string, number>> = []

  afterAll(() => {
    // The measurement, beside the run's results: what save-limits.ts records.
    mkdirSync('test-results', { recursive: true })
    writeFileSync(join('test-results', 'save-sized-postgres.json'), JSON.stringify(report, null, 2))
  })

  // A save's round trips grow by one statement per line and by nothing
  // else: BEGIN, the timeouts, the touch, the count, the read-back and
  // COMMIT, whatever the size, and before the transaction the order's table
  // described and its lines listed, a statement each. A save that read each
  // row back, or counted per row, would show here as more. Watched failing
  // on postgres:17-alpine with each line read back after its insert, at
  // every size: "expected 15 to be 14" for one line, "expected 1512 to be
  // 1012" for 500.
  test.each(SAVE_SIZES)('of %i lines is stored, in one statement per line and a fixed few', async (n) => {
    const adapter = createPostgresRecords(viaHop)
    const planning = hop.countRoundTrips()
    const request = await sized(n, MEASURING, adapter)
    const before = planning()
    const turns = hop.countRoundTrips()
    const sending = performance.now()
    expect(saveAnswer(await adapter.save(request))).toBe('saved')
    const first = performance.now() - sending
    expect(turns()).toBe(2 * n + TURNS_BESIDE_CREATES)
    expect(before).toBe(4)

    const times: number[] = []
    let bytes = 0
    for (let run = 0; run < RUNS; run += 1) {
      const timed = await sized(n)
      const start = performance.now()
      const outcome = await records.save(timed)
      times.push(performance.now() - start)
      expect(saveAnswer(outcome)).toBe('saved')
      bytes = Buffer.byteLength(JSON.stringify(outcome))
    }
    const { p50, p95, p99, max } = percentiles(times)
    report.push({
      lines: n,
      first: Math.round(first),
      runs: RUNS,
      p50: Math.round(p50),
      p95: Math.round(p95),
      p99: Math.round(p99),
      max: Math.round(max),
      turns: 2 * n + TURNS_BESIDE_CREATES,
      bytes,
    })
  })

  // The default deadline admits a save at the cap it was measured with:
  // planned with DEFAULT_SAVE_DEADLINE_MS, SAVE_MAX_ROWS lines are stored.
  // A runner on which they are not is one the deadline is to be measured
  // on again. Watched failing on postgres:17-alpine with a deadline of 1
  // ms: "expected 'save: unavailable' to be 'saved'".
  test('at SAVE_MAX_ROWS lines, is stored within the default deadline', async () => {
    expect(saveAnswer(await records.save(await sized(SAVE_MAX_ROWS, DEFAULT_SAVE_DEADLINE_MS)))).toBe('saved')
  })
})
