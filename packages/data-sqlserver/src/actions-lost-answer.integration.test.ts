import {
  ACTION_SCOPE,
  actionAnswer,
  actionCase,
  actionExpected,
  actionForms,
  actionToken,
  answerBytes,
  covers,
  plannedAction,
  startSqlServerFixture,
  startTcpHop,
} from '@formancy/data-fixtures'
import type { ActionForms, SqlServerFixture, TcpHop } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createSqlServerActions, discoverSqlServer } from './index.js'

/*
 * An action's run whose answer is lost after SQL Server committed it
 * (0160, 0031), against REAL SQL Server loaded with the actions schema,
 * through the TCP hop from `@formancy/data-fixtures`: every byte that
 * crosses it is tedious's and the server's own, and only the network fails
 * (0003).
 *
 * The run is one batch. The procedure returns a result set echoing the
 * person's answer, which the batch reads and drops, and which reaches the
 * client in the batch's answer, after COMMIT; the hop drops everything
 * from it on. The run is then stored and its answer lost:
 * `unknown-outcome`, sent once and never again.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let forms: ActionForms
let hop: TcpHop
let viaHop: mssql.ConnectionPool

/** How long a marker may take to appear in an answer, and a commit to be seen. Generous: a loaded CI runner, not a measurement. */
const PATIENCE_MS = 15_000
const DEADLINE = 10_000

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  const writer = await new mssql.ConnectionPool(fixture.writer).connect()
  try {
    forms = actionForms(await discoverSqlServer(writer, ACTION_SCOPE))
  } finally {
    await writer.close()
  }
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

beforeEach(async () => {
  hop = await startTcpHop({ kind: 'sqlserver', host: fixture.writer.server, port: fixture.writer.port ?? 1433 })
  // One connection, so the run and anything after it share the one the hop watches.
  viaHop = await new mssql.ConnectionPool({ ...fixture.writer, server: '127.0.0.1', port: hop.port, pool: { max: 1 } }).connect()
})

afterEach(async () => {
  await viaHop.close()
  await hop.close()
})

/** `promise`, or a rejection saying `what` never happened. */
async function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(what)), PATIENCE_MS)))
  try {
    return await Promise.race([promise, late])
  } finally {
    clearTimeout(timer)
  }
}

/** An order of tenant 1, as the owner inserts it; its id. */
async function order(): Promise<number> {
  const customer = await owner.request().query<{ id: string }>("insert into actions.customer (tenant_id, name) output inserted.id values (1, N'Customer')")
  const result = await owner
    .request()
    .input('customer', mssql.BigInt, (customer.recordset[0] as { id: string }).id)
    .query<{ id: string }>('insert into actions.[order] (customer_id, amount) output inserted.id values (@customer, 12.50)')
  return Number((result.recordset[0] as { id: string }).id)
}

/** An order's status and version, and the calls recorded for it, as the owner reads them. */
async function stored(id: number): Promise<{ status: string; version: number; calls: number }> {
  const result = await owner
    .request()
    .input('id', mssql.BigInt, id)
    .query<{ status: string; version: number; calls: number }>(
      "select status, version, (select count(*) from actions.call where record_id = @id and routine = N'close_order') as calls from actions.[order] where id = @id",
    )
  return { ...(result.recordset[0] as { status: string; version: number; calls: number }) }
}

describe('a run whose answer is lost', () => {
  // The batch committed and its answer -- the procedure's echo, then what
  // the batch selects -- never arrived: unknown to the adapter, sent once
  // and never again, and stored. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest on 2026-11-16 with a lost
  // connection read as one before anything was sent: "expected
  // 'unavailable' to be 'unknown-outcome'".
  test('is unknown-outcome once the batch was sent, sent once, and stored', covers('sqlserver', actionCase('lost-answer')), async () => {
    const id = await order()
    const note = `lost ${randomUUID().slice(0, 8)}`
    const actions = createSqlServerActions(viaHop)
    const request = await plannedAction(actions, forms.orders, 'close', { record: actionToken(id), version: '1', answers: { note } })
    const bytes = answerBytes('sqlserver', note)
    const sent = hop.countSent(bytes)
    const lost = hop.swallowAnswersFrom(bytes)
    const pending = actions.run(request, DEADLINE)
    await within(lost.matched, 'the procedure never echoed the note')
    // The commit is the server's, on its schedule: seen on the owner's own connection before the cut.
    const deadline = Date.now() + PATIENCE_MS
    while ((await stored(id)).version !== 2) {
      if (Date.now() > deadline) throw new Error('the run never committed')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    lost.cut()
    const outcome = await within(pending, 'the run never answered')
    expect(actionAnswer(outcome)).toBe(actionExpected('lost-answer', 'sqlserver'))
    expect(sent()).toBe(1)
    expect(await stored(id)).toEqual({ status: 'closed', version: 2, calls: 1 })
  })
})
