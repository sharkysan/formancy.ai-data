import { generateForm, planCreate, planRead, planSupersede, planUpdate, recordToken, toFormAnswers } from '@formancy/data-core'
import type { FormBindings, MetadataSnapshot, RecordAdapter } from '@formancy/data-core'
import {
  ALICE,
  AUDITED_POLICY,
  AUDITED_PRICE_POLICY,
  AUDITED_PRICE_STAMPS,
  AUDITED_STAMPS,
  BOB,
  covers,
  PARITY_SCOPE,
  STAMP_PARITY,
  stampCase,
  startSqlServerFixture,
} from '@formancy/data-fixtures'
import type { SqlServerFixture, StampedRow } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createSqlServerRecords, discoverSqlServer } from './index.js'

/*
 * What the server stamps (0153), against REAL SQL Server loaded with the
 * shared fixture's parity schema: parity.audited, one column of each
 * temporal type a stamp takes -- datetimeoffset, datetime2, date and
 * datetime -- and parity.audited_price, a chain of versions with a
 * creator. Each case's answer is written once in `@formancy/data-fixtures`
 * (`STAMP_PARITY`); the PostgreSQL suite runs the same cases, each declared
 * with `covers()` (0035).
 *
 * The requests are the planner's, as the server sends them; what the table
 * holds is read as the owner, in T-SQL, beside the server's own clock,
 * `sysutcdatetime()`, read just before and just after each write and
 * carried as text at its full precision -- the driver's Date would cut it
 * to the millisecond.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let records: RecordAdapter
let parity: MetadataSnapshot
let audited: FormBindings
let priced: FormBindings

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  parity = await discoverSqlServer(owner, PARITY_SCOPE)
  const request = { connection: 'test', lookups: [], pinned: ['tenant_id'], versionColumn: 'version' }
  audited = generateForm(parity, {
    ...request,
    root: { schema: 'parity', name: 'audited' },
    formId: 'audited',
    title: 'Audited',
    stamps: [...AUDITED_STAMPS],
  }).bindings
  priced = generateForm(parity, {
    ...request,
    root: { schema: 'parity', name: 'audited_price' },
    formId: 'audited-price',
    title: 'Audited price',
    validity: { from: 'valid_from', to: 'valid_to' },
    stamps: [...AUDITED_PRICE_STAMPS],
  }).bindings
  records = createSqlServerRecords(owner)
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

async function described(name: string) {
  const found = await records.describe({ schema: 'parity', name })
  if (!found.ok) throw new Error(`expected a description, got ${found.code}`)
  return found.described
}

/** The server's own clock in UTC, as text at datetime2(7). */
async function clock(): Promise<string> {
  const result = await owner.request().query<{ at: string }>('select convert(nvarchar(33), sysutcdatetime(), 126) as at')
  return (result.recordset[0] as { at: string }).at
}

/** Alice's create of a note, sent through the adapter between two readings of the clock: its id and version, and the readings. */
async function created(note: string): Promise<{ id: string; version: string; before: string; after: string }> {
  const plan = planCreate(parity, audited, AUDITED_POLICY, ALICE, { note }, await described('audited'))
  if (!plan.ok) throw new Error(`expected a create, got ${plan.code}: ${plan.message}`)
  const before = await clock()
  const outcome = await records.insert(plan.request)
  const after = await clock()
  if (!outcome.ok) throw new Error(`expected the insert, got ${outcome.code}: ${outcome.message}`)
  return { id: String(outcome.values['id']), version: String(outcome.version), before, after }
}

/**
 * The row as the owner reads it, measured as `StampedRow` says: against
 * created_at in UTC, the instant a create stamps, or -- after an update,
 * which stamps no instant column -- against changed_at, the wall clock it
 * stamps in UTC, at the same precision here.
 */
async function measured(id: string, before: string, after: string, against: 'created' | 'changed'): Promise<StampedRow> {
  const instant = against === 'created' ? `convert(datetime2(7), switchoffset(created_at, '+00:00'))` : 'changed_at'
  const result = await owner
    .request()
    .input('id', mssql.Int, Number(id))
    .input('before', mssql.NVarChar(33), before)
    .input('after', mssql.NVarChar(33), after)
    .query<StampedRow>(
      `select created_by, created_in, changed_by, convert(nvarchar(10), changed_on, 23) as changed_on,
         cast(case when ${instant} >= convert(datetime2(7), @before, 126) and ${instant} <= convert(datetime2(7), @after, 126) then 1 else 0 end as bit) as within,
         case when created_at = noted_at then 'equal' when created_at < noted_at then 'earlier' else 'later' end as toDefault,
         datepart(tzoffset, created_at) as offsetMinutes,
         cast(case when changed_at = ${instant} then 1 else 0 end as bit) as wallInUtc,
         case when changed_on is null then null else cast(case when changed_on = convert(date, changed_at) then 1 else 0 end as bit) end as dayInUtc,
         abs(datediff_big(microsecond, convert(datetime2(7), logged_at), ${instant})) as loggedOffMicroseconds
       from parity.audited where id = @id`,
    )
  const row = result.recordset[0] as StampedRow
  // datediff_big is a bigint, which the driver hands over as text.
  return { ...row, loggedOffMicroseconds: Number(row.loggedOffMicroseconds) }
}

describe('a create of a form that stamps', () => {
  // Who is Alice's id and site, from the context; the instant is the
  // server's, read between its own clock before and after, stored at
  // +00:00 whatever the server's own zone; the wall clock is that instant
  // in UTC; nothing an update stamps is there yet. To be watched failing in
  // CI with the clock columns left out of the insert -- 515, created_at may
  // not be NULL -- and with `sysdatetimeoffset()` stamped as it is, at the
  // server's own offset, on a server whose zone is not UTC.
  test('stores who from the context and the time from the database', covers('sqlserver', stampCase('created'), stampCase('utc')), async () => {
    const { id, before, after } = await created('first')
    const row = await measured(id, before, after, 'created')
    expect(row).toMatchObject(STAMP_PARITY.created)
    expect({ offsetMinutes: row.offsetMinutes, wallInUtc: row.wallInUtc }).toEqual({
      offsetMinutes: STAMP_PARITY.utc.offsetMinutes.sqlserver,
      wallInUtc: STAMP_PARITY.utc.wallInUtc,
    })
  })

  // The batch reads the clock once, before the insert; a
  // `sysdatetimeoffset()` default reads its own as the insert runs, so the
  // stamp is not later than it. datetime keeps 1/300 s, and rounds the
  // instant to it. To be watched failing in CI with the default's own
  // function stamped in the insert's VALUES: one reading each, in no order
  // the engine promises.
  test("is not later than the clock's default, and rounded to its column", covers('sqlserver', stampCase('clock'), stampCase('rounded')), async () => {
    const { id, before, after } = await created('clocked')
    const row = await measured(id, before, after, 'created')
    expect(STAMP_PARITY.clock.sqlserver).toContain(row.toDefault)
    expect(row.loggedOffMicroseconds).toBeLessThanOrEqual(STAMP_PARITY.rounded.sqlserver)
  })
})

describe('an update of a form that stamps', () => {
  // Bob's update of Alice's row: who changed it last is Bob, when is the
  // server's, and the day its UTC day; who created it, where and when are
  // untouched. To be watched failing in CI with the update's clock left out
  // of the SET: changed_at keeps the create's instant, outside the update's
  // window.
  test('restamps who changed it and when, and keeps who created it', covers('sqlserver', stampCase('updated')), async () => {
    const { id, version } = await created('to change')
    const createdAt = async () =>
      (
        await owner
          .request()
          .input('id', mssql.Int, Number(id))
          .query<{ at: string }>('select convert(nvarchar(40), created_at, 127) as at from parity.audited where id = @id')
      ).recordset[0]?.at
    const was = await createdAt()
    const token = recordToken(['id'], { id })
    if (!token.ok) throw new Error(token.message)
    const plan = planUpdate(parity, audited, AUDITED_POLICY, BOB, token.token, version, { note: 'changed' }, undefined, await described('audited'))
    if (!plan.ok) throw new Error(`expected an update, got ${plan.code}: ${plan.message}`)
    const before = await clock()
    const outcome = await records.update(plan.request)
    const after = await clock()
    expect(outcome.ok).toBe(true)
    const row = await measured(id, before, after, 'changed')
    const { createdKept: _kept, ...stored } = STAMP_PARITY.updated
    expect(row).toMatchObject(stored)
    expect(row.dayInUtc).toBe(STAMP_PARITY.utc.dayInUtc)
    expect((await createdAt()) === was).toBe(STAMP_PARITY.updated.createdKept)
  })
})

describe('a change from a date of a form that stamps', () => {
  // The next version is a create, stamped as Bob's; the version ended is
  // not stamped again, and keeps Alice's and when. To be watched failing in
  // CI with the clock left out of the next version: 515, created_at may not
  // be NULL, and the batch rolls back what it ended.
  test('stamps the next version as a create', covers('sqlserver', stampCase('superseded')), async () => {
    await owner
      .request()
      .query(
        "insert into parity.audited_price (tenant_id, product_no, valid_from, amount, created_by, created_at) values (1, 7, '2026-01-01', 9.5, N'alice', '2026-01-01T00:00:00+00:00')",
      )
    const token = recordToken(['tenant_id', 'product_no', 'valid_from'], { tenant_id: '1', product_no: '7', valid_from: '2026-01-01' })
    if (!token.ok) throw new Error(token.message)
    const reading = planRead(parity, priced, AUDITED_PRICE_POLICY, BOB, token.token)
    if (!reading.ok) throw new Error(`expected a read, got ${reading.code}`)
    const read = await records.read(reading.request)
    if (!read.ok || read.record === null) throw new Error('expected the open version')
    const asRead = toFormAnswers(priced, reading.fields, { ok: true, ...read.record })
    const plan = planSupersede(
      parity,
      priced,
      AUDITED_PRICE_POLICY,
      BOB,
      token.token,
      String(read.record.version),
      { valid_from: '2026-07-01', amount: '10.0000' },
      asRead,
      await described('audited_price'),
    )
    if (!plan.ok) throw new Error(`expected a change, got ${plan.code}: ${plan.message}`)
    const outcome = await records.supersede(plan.request)
    expect(outcome.ok).toBe(true)
    const versions = await owner
      .request()
      .query<{ by: string; at: string }>(
        "select created_by as by, convert(nvarchar(19), switchoffset(created_at, '+00:00'), 126) + 'Z' as at from parity.audited_price where tenant_id = 1 and product_no = 7 order by valid_from",
      )
    expect(versions.recordset.map((entry) => entry.by)).toEqual([STAMP_PARITY.superseded.ended, STAMP_PARITY.superseded.next])
    expect(versions.recordset[0]?.at).toBe(STAMP_PARITY.superseded.endedAt)
    expect(versions.recordset[1]?.at).not.toBe(STAMP_PARITY.superseded.endedAt)
  })
})
