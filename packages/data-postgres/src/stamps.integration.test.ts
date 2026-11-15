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
  startPostgresFixture,
} from '@formancy/data-fixtures'
import type { PostgresFixture, StampedRow } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * What the server stamps (0153), against REAL PostgreSQL loaded with the
 * shared fixture's parity schema: parity.audited, one column of each
 * temporal type a stamp takes, and parity.audited_price, a chain of
 * versions with a creator. Each case's answer is written once in
 * `@formancy/data-fixtures` (`STAMP_PARITY`); the SQL Server suite runs the
 * same cases, each declared with `covers()` (0035).
 *
 * The requests are the planner's, as the server sends them; what the table
 * holds is read as the owner, in PostgreSQL's own SQL, beside the server's
 * own clock read just before and just after each write -- `clock_timestamp()`,
 * which moves within a transaction, so a stamp is held to the clock of the
 * database and never to this process's.
 */

let fixture: PostgresFixture
let owner: Sql
let records: RecordAdapter
let parity: MetadataSnapshot
let audited: FormBindings
let priced: FormBindings

beforeAll(async () => {
  fixture = await startPostgresFixture()
  // A session zone far from UTC, so a wall clock stamped in the session's zone is seen to be wrong.
  owner = postgres(fixture.admin, { onnotice: () => {}, connection: { TimeZone: 'Pacific/Chatham' } })
  parity = await discoverPostgres(owner, PARITY_SCOPE)
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
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

async function described(name: string) {
  const found = await records.describe({ schema: 'parity', name })
  if (!found.ok) throw new Error(`expected a description, got ${found.code}`)
  return found.described
}

/** The database's own clock, as text it reads back exactly. */
async function clock(): Promise<string> {
  const [row] = await owner.unsafe<Array<{ at: string }>>('select clock_timestamp()::text as at')
  return (row as { at: string }).at
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
 * created_at, the instant a create stamps, or -- after an update, which
 * stamps no instant column -- against changed_at in UTC, the wall clock
 * it stamps, at the same precision here.
 */
async function measured(id: string, before: string, after: string, against: 'created' | 'changed'): Promise<StampedRow> {
  const instant = against === 'created' ? 'created_at' : `(changed_at at time zone 'UTC')`
  const [row] = await owner.unsafe<StampedRow[]>(
    `select created_by, created_in, changed_by, changed_on::text as changed_on,
       (${instant} >= $2::timestamptz and ${instant} <= $3::timestamptz) as within,
       case when created_at = noted_at then 'equal' when created_at < noted_at then 'earlier' else 'later' end as "toDefault",
       null::int as "offsetMinutes",
       (changed_at = (${instant} at time zone 'UTC')) as "wallInUtc",
       case when changed_on is null then null else changed_on = (changed_at)::date end as "dayInUtc",
       (abs(extract(epoch from (logged_at - (${instant} at time zone 'UTC')))) * 1000000)::float8 as "loggedOffMicroseconds"
     from parity.audited where id = $1`,
    [Number(id), before, after],
  )
  return row as StampedRow
}

describe('a create of a form that stamps', () => {
  // Who is Alice's id and site, from the context; the instant is the
  // database's, read between its own clock before and after; nothing an
  // update stamps is there yet. To be watched failing in CI with the clock
  // columns left out of the insert -- 23502, created_at may not be NULL --
  // and with `clockSql` reading the session's zone for a wall clock: the
  // owner's session is in Pacific/Chatham, hours from UTC.
  test('stores who from the context and the time from the database', covers('postgres', stampCase('created'), stampCase('utc')), async () => {
    const { id, before, after } = await created('first')
    const row = await measured(id, before, after, 'created')
    expect(row).toMatchObject(STAMP_PARITY.created)
    expect({ offsetMinutes: row.offsetMinutes, wallInUtc: row.wallInUtc }).toEqual({
      offsetMinutes: STAMP_PARITY.utc.offsetMinutes.postgres,
      wallInUtc: STAMP_PARITY.utc.wallInUtc,
    })
  })

  // `current_timestamp` is the transaction's start, and so is the `now()`
  // default of noted_at in the same insert: one instant. A column of less
  // precision rounds it. To be watched failing in CI with
  // `clock_timestamp()` in place of `current_timestamp`: the default and
  // the stamp were two readings.
  test("is one instant with the clock's default, and rounded to its column", covers('postgres', stampCase('clock'), stampCase('rounded')), async () => {
    const { id, before, after } = await created('clocked')
    const row = await measured(id, before, after, 'created')
    expect(STAMP_PARITY.clock.postgres).toContain(row.toDefault)
    expect(row.loggedOffMicroseconds).toBeLessThanOrEqual(STAMP_PARITY.rounded.postgres)
  })
})

describe('an update of a form that stamps', () => {
  // Bob's update of Alice's row: who changed it last is Bob, when is the
  // database's, and the day its UTC day; who created it, where and when
  // are untouched. To be watched failing in CI with the update's clock left
  // out of the SET: changed_at keeps the create's instant, outside the
  // update's window.
  test('restamps who changed it and when, and keeps who created it', covers('postgres', stampCase('updated')), async () => {
    const { id, version } = await created('to change')
    const [createdAt] = await owner.unsafe<Array<{ at: string }>>('select created_at::text as at from parity.audited where id = $1', [Number(id)])
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
    const [now] = await owner.unsafe<Array<{ at: string }>>('select created_at::text as at from parity.audited where id = $1', [Number(id)])
    expect(now?.at === createdAt?.at).toBe(STAMP_PARITY.updated.createdKept)
  })
})

describe('a change from a date of a form that stamps', () => {
  // The next version is a create, stamped as Bob's; the version ended is
  // not stamped again, and keeps Alice's and when. To be watched failing in
  // CI with the clock left out of the next version: 23502, created_at may
  // not be NULL, and nothing ended.
  test('stamps the next version as a create', covers('postgres', stampCase('superseded')), async () => {
    await owner.unsafe(
      "insert into parity.audited_price (tenant_id, product_no, valid_from, amount, created_by, created_at) values (1, 7, '2026-01-01', 9.5, 'alice', '2026-01-01T00:00:00Z')",
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
    const versions = await owner.unsafe<Array<{ from: string; by: string; at: string }>>(
      `select valid_from::text as "from", created_by as by, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
       from parity.audited_price where tenant_id = 1 and product_no = 7 order by valid_from`,
    )
    expect(versions.map((entry) => entry.by)).toEqual([STAMP_PARITY.superseded.ended, STAMP_PARITY.superseded.next])
    expect(versions[0]?.at).toBe(STAMP_PARITY.superseded.endedAt)
    expect(versions[1]?.at).not.toBe(STAMP_PARITY.superseded.endedAt)
  })
})
