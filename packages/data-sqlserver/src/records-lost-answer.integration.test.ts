import { randomUUID } from 'node:crypto'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ApiValue, MetadataSnapshot, ObjectRef, RecordColumn, RecordConcurrency, RecordOutcome, RecordTarget, RecordValue } from '@formancy/data-core'
import { findObject } from '@formancy/data-core'
import type { SqlServerFixture, TcpHop } from '@formancy/data-fixtures'
import { answerBytes, defined, startSqlServerFixture, startTcpHop } from '@formancy/data-fixtures'
import { createSqlServerRecords, discoverSqlServer } from './index.js'

/**
 * A write whose answer is lost, against REAL SQL Server 2022 through a TCP
 * hop that drops the server's answer (0031). Every byte is tedious's and the
 * server's; only the network fails, so this is not a mocked driver (0003).
 *
 * The write batch selects what it wrote after `commit transaction`
 * (records/statements.ts), so the hop arms a text the write carries and the
 * answer echoes, and swallows from the read in which it arrives: the write is
 * committed and the client never hears. Each case still polls the owner's
 * own connection until the write is visible before it cuts, because a
 * matched marker is not, on every engine, proof of a commit (P2b).
 *
 * What the probes measured, and these cases pin (2026-10-09, mssql 12.7.4,
 * tedious 20.3.3, SQL Server 2022): a socket closed under a request is a
 * `RequestError` whose `number` is the STRING `'ECONNRESET'`, because mssql's
 * lib/error/request-error.js copies a driver error's `code` into `number` when
 * it has no `info`; a request whose answer never comes is `'ETIMEOUT'`; and a
 * session whose client went away while its write waited on a lock is ended by
 * the server, which stores nothing — unlike PostgreSQL, where such an orphan
 * commits once the lock is released.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let snapshot: MetadataSnapshot

const ORDER: ObjectRef = { schema: 'sales', name: 'order' }
const COUNTRY: ObjectRef = { schema: 'sales', name: 'country' }

/** How long a match, a visible row or an ended session is waited for before the case fails rather than hangs. */
const PATIENCE = 15_000

/**
 * The client's request timeout in the cases where it is the failure: long
 * enough that the commit's answer is at the hop first by two orders of
 * magnitude (it was 40 ms), and short enough to keep the case near seconds.
 * A chosen margin, not a measured one; an attention that won the race would
 * fail the case saying the marker never appeared, not pass it.
 */
const AFTER_THE_COMMIT = 5_000

/** A pool whose requests time out after the commit, and whose cancel's lost answer is given up on at 1000 ms (P3). */
const timingOut = (): Partial<mssql.config> => ({ requestTimeout: AFTER_THE_COMMIT, options: { ...fixture.admin.options, cancelTimeout: 1000 } })

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  snapshot = await discoverSqlServer(owner, { schemas: ['sales'] })
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

function columnOf(ref: ObjectRef, name: string): RecordColumn {
  const found = findObject(snapshot, ref)?.columns.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`${ref.name} has no column ${name}`)
  return { name, type: found.type }
}

const valueOf = (ref: ObjectRef, name: string, value: ApiValue): RecordValue => ({ ...columnOf(ref, name), value })

function orderTarget(): RecordTarget & { concurrency: RecordConcurrency } {
  return { table: ORDER, identity: [columnOf(ORDER, 'id')], concurrency: { kind: 'rowversion', column: 'row_version' } }
}

function newOrder(notes: string): RecordValue[] {
  const values: Record<string, ApiValue> = { tenant_id: '1', customer_no: '1001', order_date: '2026-10-09', amount: '1.0000', notes }
  return Object.entries(values).map(([name, value]) => valueOf(ORDER, name, value))
}

const orderInsert = (notes: string) => ({ target: orderTarget(), values: newOrder(notes), returning: [columnOf(ORDER, 'id'), columnOf(ORDER, 'notes')] })

/** A text no other case and no fixture row carries, so the hop matches this write's answer and nothing else. */
const markerText = (): string => `lost-answer-${randomUUID()}`

/** A pool of one connection to the fixture's database through a hop of its own: the write and anything before it share that connection. */
async function throughHop(config: Partial<mssql.config> = {}): Promise<{ hop: TcpHop; pool: mssql.ConnectionPool; close: () => Promise<void> }> {
  const hop = await startTcpHop({ host: fixture.admin.server, port: fixture.admin.port ?? 1433 })
  const pool = await new mssql.ConnectionPool({ ...fixture.admin, ...config, server: '127.0.0.1', port: hop.port, pool: { max: 1 } }).connect()
  return {
    hop,
    pool,
    close: async () => {
      await pool.close()
      await hop.close()
    },
  }
}

/** `promise`, or a failure naming what never happened, so a hop that never matches fails the case instead of hanging it. */
async function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what)), PATIENCE)
  })
  try {
    return await Promise.race([promise, late])
  } finally {
    clearTimeout(timer)
  }
}

/** Polls the owner's own connection, never the hop's, until `check` holds. */
async function until(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + PATIENCE
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(what)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function ordersWith(notes: string): Promise<number> {
  const found = await owner.request().input('notes', mssql.NVarChar(mssql.MAX), notes).query<{ n: number }>('select count(*) as n from sales.[order] where notes = @notes')
  return found.recordset[0]?.n ?? -1
}

async function countriesNamed(name: string): Promise<number> {
  const found = await owner.request().input('name', mssql.NVarChar(mssql.MAX), name).query<{ n: number }>('select count(*) as n from sales.country where name = @name')
  return found.recordset[0]?.n ?? -1
}

/** Holds sales.country exclusively on a connection of its own until released, so a write to it waits inside the server. */
async function holdCountry(): Promise<{ release: () => Promise<void>; waiting: (session: number) => Promise<void> }> {
  const holder = await new mssql.ConnectionPool({ ...fixture.admin, pool: { max: 1 } }).connect()
  const transaction = new mssql.Transaction(holder)
  await transaction.begin()
  await new mssql.Request(transaction).query('select count(*) as n from sales.country with (tablockx, holdlock)')
  return {
    release: async () => {
      await transaction.rollback()
      await holder.close()
    },
    waiting: (session) =>
      until(async () => {
        const found = await owner
          .request()
          .input('session', mssql.Int, session)
          .query<{ blocked: number }>('select blocking_session_id as blocked from sys.dm_exec_requests where session_id = @session')
        return (found.recordset[0]?.blocked ?? 0) > 0
      }, 'the write never waited on the held table'),
  }
}

/** What a raw request rejected with, the fields serverError reads and nothing else. */
async function rejection(pending: Promise<unknown>): Promise<{ name: string; number: unknown; code: unknown; class: unknown }> {
  try {
    await pending
  } catch (error) {
    const { name, number, code, class: severity } = error as Error & { number?: unknown; code?: unknown; class?: unknown }
    return { name, number, code, class: severity }
  }
  throw new Error('the request was answered, so nothing was lost')
}

describe('an answer lost after the write committed', () => {
  // The case 0031 exists for: the batch committed, then the connection died
  // before its answer arrived. A code that claimed nothing was written
  // (`refused`, `unavailable`) would invite a person to enter the order again;
  // one sent marker and one stored row are the proof that the adapter sent it
  // once and did not resend it on a new connection.
  test('an insert is unknown-outcome, sent once, and stored once', async () => {
    const { hop, pool, close } = await throughHop()
    try {
      const notes = markerText()
      const bytes = answerBytes('sqlserver', notes)
      const sent = hop.countSent(bytes)
      const lost = hop.swallowAnswersFrom(bytes)
      const pending = defined(createSqlServerRecords(pool)).insert(orderInsert(notes))
      await within(lost.matched, 'the marker never appeared in an answer')
      await until(async () => (await ordersWith(notes)) === 1, 'the insert never became visible')
      lost.cut()
      expect(await pending).toMatchObject({ ok: false, code: 'unknown-outcome' })
      expect(sent()).toBe(1)
      expect(await ordersWith(notes)).toBe(1)
    } finally {
      await close()
    }
  })

  // An update's answer carries the new rowversion; lost, the person holds
  // only the version they sent. The change is stored and the rowversion has
  // moved past what was sent, which is why saving again with that version is
  // stale rather than a second write (0015, 0031).
  test('an update is unknown-outcome, its change stored and its rowversion moved past the one sent', async () => {
    const records = defined(createSqlServerRecords(owner))
    const created = (await records.insert(orderInsert(markerText()))) as RecordOutcome & { ok: true }
    expect(created.ok).toBe(true)
    const id = created.values.id as string
    const sentVersion = created.version as string
    const { hop, pool, close } = await throughHop()
    try {
      const notes = markerText()
      const bytes = answerBytes('sqlserver', notes)
      const sent = hop.countSent(bytes)
      const lost = hop.swallowAnswersFrom(bytes)
      const pending = defined(createSqlServerRecords(pool)).update({
        target: orderTarget(),
        key: [valueOf(ORDER, 'id', id)],
        set: [valueOf(ORDER, 'notes', notes)],
        expectedVersion: sentVersion,
        filters: { kind: 'unrestricted' }, through: [],
        returning: [columnOf(ORDER, 'notes')],
      })
      await within(lost.matched, 'the marker never appeared in an answer')
      await until(async () => (await ordersWith(notes)) === 1, 'the update never became visible')
      lost.cut()
      expect(await pending).toMatchObject({ ok: false, code: 'unknown-outcome' })
      expect(sent()).toBe(1)
      const stored = await records.read({ target: orderTarget(), key: [valueOf(ORDER, 'id', id)], columns: [columnOf(ORDER, 'notes')], filters: { kind: 'unrestricted' }, through: [] })
      expect(stored).toMatchObject({ ok: true, values: { notes } })
      expect((stored as RecordOutcome & { ok: true }).version).not.toBe(sentVersion)
    } finally {
      await close()
    }
  })

  // A client-side timeout that fires after the commit: tedious gives up at
  // requestTimeout, sends an attention the server's answer to which is lost
  // too, and gives up on that at cancelTimeout. The row is stored. Were a
  // timeout `unavailable`, as PostgreSQL's server-side 57014 rightly is, a
  // person would be told nothing was written over a stored row.
  //
  // The timer races the commit: an attention that reached the server first
  // would cancel the batch, and the marker would never appear. So it is
  // AFTER_THE_COMMIT, not P3's 1000 ms, against a commit whose answer was
  // measured at the hop 40 ms after the send (2026-10-09, this suite, once).
  test('a request timeout after the commit is unknown-outcome, and the row is stored', async () => {
    const { hop, pool, close } = await throughHop(timingOut())
    try {
      const notes = markerText()
      const bytes = answerBytes('sqlserver', notes)
      const sent = hop.countSent(bytes)
      const lost = hop.swallowAnswersFrom(bytes)
      const pending = defined(createSqlServerRecords(pool)).insert(orderInsert(notes))
      await within(lost.matched, 'the marker never appeared in an answer')
      await until(async () => (await ordersWith(notes)) === 1, 'the insert never became visible')
      expect(await within(pending, 'the request never timed out')).toMatchObject({ ok: false, code: 'unknown-outcome' })
      lost.cut()
      expect(sent()).toBe(1)
      expect(await ordersWith(notes)).toBe(1)
    } finally {
      await close()
    }
  })
})

describe('a socket cut while the write waits', () => {
  // Not a KILL (records-failures covers that): the network drops while the
  // write waits on a table lock. The adapter cannot know the server will end
  // the session, so it says unknown-outcome, which over-reports here (0031's
  // costs). What SQL Server does is measured, not assumed: the session is
  // gone — polled, never slept — and once the lock is released nothing was
  // stored. Were the session left to run, as PostgreSQL leaves its orphan,
  // the row would appear after the release and this would fail.
  test('is unknown-outcome; the server ends the session, and nothing is stored', async () => {
    const { hop, pool, close } = await throughHop()
    const held = await holdCountry()
    const name = markerText()
    try {
      const session = await pool
        .request()
        .query<{ id: number; login: string }>('select @@spid as id, convert(nvarchar(30), login_time, 126) as login from sys.dm_exec_sessions where session_id = @@spid')
      const { id, login } = session.recordset[0] ?? { id: 0, login: '' }
      const sent = hop.countSent(answerBytes('sqlserver', name))
      const pending = defined(createSqlServerRecords(pool)).insert({
        target: { table: COUNTRY, identity: [columnOf(COUNTRY, 'id')], concurrency: null },
        values: [valueOf(COUNTRY, 'iso_code', 'QX'), valueOf(COUNTRY, 'name', name)],
        returning: [],
      })
      await held.waiting(id)
      hop.cut()
      expect(await pending).toMatchObject({ ok: false, code: 'unknown-outcome' })
      expect(sent()).toBe(1)
      // The session id alone may be reused by a later connection; with its login time it is this one.
      await until(async () => {
        const found = await owner
          .request()
          .input('id', mssql.Int, id)
          .input('login', mssql.NVarChar(30), login)
          .query<{ n: number }>('select count(*) as n from sys.dm_exec_sessions where session_id = @id and convert(nvarchar(30), login_time, 126) = @login')
        return found.recordset[0]?.n === 0
      }, 'the server kept the session whose client went away')
    } finally {
      await held.release()
      await close()
    }
    expect(await countriesNamed(name)).toBe(0)
  })
})

describe('what the driver rejects a lost answer with', () => {
  // 0017 said, from mssql's source, that every failure after a connection is
  // handed out is a RequestError; this pins it for a lost socket and a
  // timeout, through a raw request and no adapter. It also pins why
  // serverError tests `typeof number === 'number'`: the number of a lost
  // socket is a string. Checked `number !== undefined`, a lost answer is read
  // as the server's refusal — `refused`, a claim nothing was written — and the
  // cases above fail.
  test('a socket cut is RequestError ECONNRESET, and a timeout ETIMEOUT, each a string number with no class', async () => {
    const cutHop = await throughHop()
    try {
      const marker = markerText()
      const lost = cutHop.hop.swallowAnswersFrom(answerBytes('sqlserver', marker))
      const pending = rejection(cutHop.pool.request().input('m', mssql.NVarChar(mssql.MAX), marker).query('select @m as m'))
      await within(lost.matched, 'the marker never appeared in an answer')
      lost.cut()
      expect(await pending).toEqual({ name: 'RequestError', number: 'ECONNRESET', code: 'ECONNRESET', class: undefined })
    } finally {
      await cutHop.close()
    }

    const slowHop = await throughHop(timingOut())
    try {
      const marker = markerText()
      const lost = slowHop.hop.swallowAnswersFrom(answerBytes('sqlserver', marker))
      const pending = rejection(slowHop.pool.request().input('m', mssql.NVarChar(mssql.MAX), marker).query('select @m as m'))
      await within(lost.matched, 'the marker never appeared in an answer')
      expect(await within(pending, 'the request never timed out')).toEqual({ name: 'RequestError', number: 'ETIMEOUT', code: 'ETIMEOUT', class: undefined })
      lost.cut()
    } finally {
      await slowHop.close()
    }
  })
})
