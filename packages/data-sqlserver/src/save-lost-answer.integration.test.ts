import type { RecordAdapter, SaveBody, SaveOutcome } from '@formancy/data-core'
import {
  answerBytes,
  covers,
  PARITY_SCOPE,
  plannedSave,
  saveAnswer,
  saveCase,
  savedForms,
  savedToken,
  saveExpected,
  startSqlServerFixture,
  startTcpHop,
} from '@formancy/data-fixtures'
import type { SavedForms, SqlServerFixture, TcpHop } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'

/*
 * A save of a record with its rows whose answer is lost after SQL Server
 * committed it (0155, 0031), against REAL SQL Server loaded with the parity
 * schema, through the TCP hop from `@formancy/data-fixtures`: every byte
 * that crosses it is tedious's and the server's own, and only the network
 * fails (0003).
 *
 * The save is one batch that commits before it selects what it stored, so
 * the hop watches the batch's answer for the order's note, which the
 * record read back after COMMIT echoes, and drops everything from there on.
 * The save is then stored, and its answer lost: `unknown-outcome`, sent
 * once, never again -- and sent again by a person, `stale`, because the
 * first moved the order's version.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let records: RecordAdapter
let forms: SavedForms
let hop: TcpHop
let viaHop: mssql.ConnectionPool

/** How long a marker may take to appear in an answer, and a commit to be seen. Generous: a loaded CI runner, not a measurement. */
const PATIENCE_MS = 15_000
const DEADLINE = 10_000

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  forms = savedForms(await discoverSqlServer(owner, PARITY_SCOPE))
  records = createSqlServerRecords(owner)
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

beforeEach(async () => {
  hop = await startTcpHop({ kind: 'sqlserver', host: fixture.admin.server, port: fixture.admin.port ?? 1433 })
  // One connection, so the save and anything after it share the one the hop watches.
  viaHop = await new mssql.ConnectionPool({ ...fixture.admin, server: '127.0.0.1', port: hop.port, pool: { max: 1 } }).connect()
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

/** Polls `read` on the owner's own connection until it returns `expected`: the commit is the server's, on its schedule. */
async function until<T>(read: () => Promise<T>, expected: T): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  for (;;) {
    const seen = await read()
    if (JSON.stringify(seen) === JSON.stringify(expected)) return
    if (Date.now() > deadline) throw new Error(`still ${JSON.stringify(seen)}, never ${JSON.stringify(expected)}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** An order of tenant 1 with one line, as the owner inserts it; its id. */
async function order(): Promise<number> {
  const result = await owner.request().query<{ id: number }>('insert into parity.saved_order (tenant_id) output inserted.id values (1)')
  const id = (result.recordset[0] as { id: number }).id
  await owner.request().input('id', mssql.Int, id).query('insert into parity.saved_line (order_id, line_no, quantity) values (@id, 1, 1)')
  return id
}

/** An order's note and how many lines it holds, as the owner reads them. */
async function stored(id: number): Promise<{ note: string | null; lines: number }> {
  const result = await owner
    .request()
    .input('id', mssql.Int, id)
    .query<{ note: string | null; lines: number }>(
      'select note, (select count(*) from parity.saved_line where order_id = @id) as lines from parity.saved_order where id = @id',
    )
  return { ...(result.recordset[0] as { note: string | null; lines: number }) }
}

/** A save of `id` that notes the order `note` and creates its line 2. */
async function body(id: number, note: string): Promise<SaveBody> {
  const result = await owner
    .request()
    .input('id', mssql.Int, id)
    .query<{ version: string }>('select convert(nvarchar(20), version) as version from parity.saved_order where id = @id')
  return {
    record: { update: { record: savedToken(['id'], { id }), version: (result.recordset[0] as { version: string }).version, answers: { note } } },
    rows: [{ form: 'saved-line', field: 'saved_order', changes: [{ create: { ref: 'n', answers: { line_no: 2, quantity: 1 } } }] }],
  }
}

/** The save of `id` noted `note`, sent through the hop, its answer dropped from the read-back on and the connection cut: what the adapter answered, and how often the note was sent. */
async function lost(id: number, note: string): Promise<{ outcome: SaveOutcome; sent: number; plan: Awaited<ReturnType<typeof plannedSave>> }> {
  const plan = await plannedSave(records, forms.orders, [forms.lines], await body(id, note), DEADLINE)
  const bytes = answerBytes('sqlserver', note)
  const sent = hop.countSent(bytes)
  const swallowed = hop.swallowAnswersFrom(bytes)
  const pending = createSqlServerRecords(viaHop).save(plan.request)
  await within(swallowed.matched, 'the batch never answered with the order read back')
  await until(() => stored(id), { note, lines: 2 })
  swallowed.cut()
  return { outcome: await within(pending, 'the save never answered'), sent: sent(), plan }
}

describe('a save whose answer is lost after it committed', () => {
  // The batch committed and selected the order it stored; that answer never
  // arrived. `unknown-outcome`, the batch sent once, and the save stored once
  // -- never `unavailable`, which would invite the person to save again over
  // what is there. Watched failing on
  // mcr.microsoft.com/mssql/server:2022-latest with the adapter sending the
  // save again on a lost connection: "expected 'record: stale' to be 'save:
  // unknown-outcome'".
  test('is unknown-outcome, sent once, and stored', covers('sqlserver', saveCase('lost-answer')), async () => {
    const id = await order()
    const note = `lost ${randomUUID().slice(0, 8)}`
    const { outcome, sent } = await lost(id, note)
    expect(saveAnswer(outcome)).toBe(saveExpected('lost-answer', 'sqlserver'))
    expect(sent).toBe(1)
    expect(await stored(id)).toEqual({ note, lines: 2 })
  })

  // The same save sent again with the version its order was read at -- the
  // browser's resend, or a person's second press: the first moved the order's
  // version, so the second is `stale`, and its line is there once. Watched
  // failing on mcr.microsoft.com/mssql/server:2022-latest with the record's
  // version guard taken out: "expected 'child 0 create 0: unique-violation'
  // to be 'record: stale'".
  test('is stale when it is sent again', covers('sqlserver', saveCase('resend')), async () => {
    const id = await order()
    const note = `resent ${randomUUID().slice(0, 8)}`
    const { plan } = await lost(id, note)
    expect(saveAnswer(await records.save(plan.request))).toBe(saveExpected('resend', 'sqlserver'))
    expect(await stored(id)).toEqual({ note, lines: 2 })
  })
})
