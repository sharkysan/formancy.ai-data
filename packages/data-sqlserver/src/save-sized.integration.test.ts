import { DEFAULT_SAVE_DEADLINE_MS, encodeRowversion, menuSaves, menuTogether, SAVE_MAX_ROWS, TOGETHER_MAX_ROWS } from '@formancy/data-core'
import type { RecordAdapter, SaveRequest } from '@formancy/data-core'
import {
  FIXTURE_SCOPE,
  percentiles,
  plannedSave,
  SAVE_SIZES,
  saveAnswer,
  savedToken,
  sizedSaveForms,
  startSqlServerFixture,
  startTcpHop,
  withLines,
} from '@formancy/data-fixtures'
import type { SavedForms, SqlServerFixture, TcpHop } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'
import { saveBatchOf } from './records/save.js'

/*
 * What a save of a record with its rows costs SQL Server (0155), on the
 * fixture's sales.order_line: an order's lines created in one save, at each
 * of SAVE_SIZES, past what a together child may hold (`withLines`). Held
 * without a clock where a fact has none to read -- the round trips a save
 * makes, counted by the TCP hop as turns; what its one batch binds, against
 * `saveParameters`' prediction and the 2,100 one request takes; and that
 * every save that fits is stored -- and timed, and reported, where it has:
 * the batch from its sending to its answer, which is the transaction, its
 * round trip and, the first time SQL Server sees a batch of that size, its
 * compile; and the answer's bytes, as JSON.
 *
 * The timings are what SAVE_MAX_ROWS and DEFAULT_SAVE_DEADLINE_MS were set
 * from (data-core's save-limits.ts says on what and when). The one clock
 * this suite holds is that a save of SAVE_MAX_ROWS lines, planned with the
 * default deadline, is stored within it. In this file's own container.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let records: RecordAdapter
let forms: { orders: SavedForms['orders']; lines: SavedForms['lines'] }
let hop: TcpHop
let viaHop: mssql.ConnectionPool

/** Runs per size: the timings reported are each size's over these. */
const RUNS = 20
/**
 * Long enough for the largest size on a loaded runner: a measurement is
 * never cut by the deadline it sets, nor by mssql's request timeout of 15 s,
 * which the first save of 200 lines took a third of on the workstation and
 * an image never measured might take more of.
 */
const MEASURING = 60_000
const CLERK = { actor: { id: 'clara', roles: ['clerk'] }, attributes: { tenant: '1' } }

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool({ ...fixture.admin, requestTimeout: MEASURING }).connect()
  forms = sizedSaveForms(await discoverSqlServer(owner, FIXTURE_SCOPE), TOGETHER_MAX_ROWS)
  records = createSqlServerRecords(owner)
  hop = await startTcpHop({ kind: 'sqlserver', host: fixture.admin.server, port: fixture.admin.port ?? 1433 })
  viaHop = await new mssql.ConnectionPool({ ...fixture.admin, server: '127.0.0.1', port: hop.port, requestTimeout: MEASURING, pool: { max: 1 } }).connect()
  // Connected before anything is counted: the login is no save's turns.
  await viaHop.request().query('select 1')
})

afterAll(async () => {
  await viaHop?.close()
  await hop?.close()
  await owner?.close()
  await fixture?.stop()
})

/** A save of `n` new lines of a new order, planned as the route plans one with one line through `via`, then given `n`. */
async function sized(n: number, deadlineMs: number = MEASURING, via: RecordAdapter = records): Promise<SaveRequest> {
  const result = await owner
    .request()
    .query<{ id: number; version: Buffer }>(
      "insert into sales.[order] (tenant_id, customer_no, order_date, amount) output inserted.id, inserted.row_version as version values (1, 1001, '2026-11-15', 1)",
    )
  const { id, version } = result.recordset[0] as { id: number; version: Buffer }
  const plan = await plannedSave(
    via,
    forms.orders,
    [forms.lines],
    {
      record: { update: { record: savedToken(['id'], { id }), version: encodeRowversion(version), answers: {} } },
      rows: [{ form: 'sales-order-line', field: 'order', changes: [{ create: { ref: 'a', answers: { line_no: 1, quantity: 2, unit_price: '1.50' } } }] }],
    },
    deadlineMs,
    CLERK,
  )
  return withLines(plan.request, n)
}

/**
 * The sizes saved here: each of SAVE_SIZES but 500, whose batch was
 * measured past mssql's request timeout of 15 s before it answered --
 * compiling, since a batch of a plan SQL Server holds answered within a
 * second at 200 -- on mcr.microsoft.com/mssql/server:2022-latest on
 * 2026-11-16: `unknown-outcome`, which is why SAVE_MAX_ROWS is below it.
 */
const SIZES = SAVE_SIZES.filter((n) => n <= 200)

describe('a save of an order and its lines on sales.order_line (0155)', () => {
  const report: Array<Record<string, number | string>> = []

  afterAll(() => {
    // The measurement, beside the run's results: what save-limits.ts records.
    mkdirSync('test-results', { recursive: true })
    writeFileSync(join('test-results', 'save-sized-sqlserver.json'), JSON.stringify(report, null, 2))
  })

  // A save that fits one request is one round trip whatever its size -- its
  // one batch -- and before it the order's table described and its lines
  // listed, a statement each; it binds at most what saveParameters predicts.
  // A batch past 2,100 parameters is the refusal's own case
  // (save.integration.test.ts). The first save of a size is SQL Server's
  // first sight of its batch, compiled before it runs, and is reported as
  // `first`, apart from the runs that reuse its plan. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with a statement sent before
  // the batch: "expected 4 to be 2".
  test.each(SIZES)('of %i lines is one batch, within its prediction', async (n) => {
    const adapter = createSqlServerRecords(viaHop)
    const planning = hop.countRoundTrips()
    const request = await sized(n, MEASURING, adapter)
    const before = planning()
    const bound = saveBatchOf(request).statement.parameters.length
    const saves = menuSaves({ ...forms.orders, title: 'Order' })
    const lines = menuTogether({ ...forms.lines, title: 'Order line' }, CLERK)
    if (saves === null || lines === null) throw new Error('the order form carries no save of its lines')
    expect(bound).toBeLessThanOrEqual(saves.parameters + n * lines.parameters.row + lines.parameters.child)
    const turns = hop.countRoundTrips()
    const sending = performance.now()
    expect(saveAnswer(await adapter.save(request))).toBe('saved')
    const first = performance.now() - sending
    // The pool's check of the connection, and the batch; before it, the same for the description and for the list.
    expect(turns()).toBe(2)
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
      parameters: bound,
      bytes,
    })
  })

  // The default deadline admits a save at the cap it was measured with:
  // planned with DEFAULT_SAVE_DEADLINE_MS, SAVE_MAX_ROWS lines are stored. A
  // runner on which they are not is one the deadline is to be measured on
  // again. Watched failing on mcr.microsoft.com/mssql/server:2022-latest with
  // a deadline of 1 ms: "expected 'save: unavailable' to be 'saved'".
  test('at SAVE_MAX_ROWS lines, is stored within the default deadline', async () => {
    expect(saveAnswer(await records.save(await sized(SAVE_MAX_ROWS, DEFAULT_SAVE_DEADLINE_MS)))).toBe('saved')
  })
})
