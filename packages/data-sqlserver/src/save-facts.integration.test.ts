import type { SqlServerFixture } from '@formancy/data-fixtures'
import { startSqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * The SQL Server facts a save of a record with its rows, in one transaction,
 * would rest on, measured before anything is designed on them: what a touch
 * of a rowversion table -- a column set to itself -- does to the rowversion
 * and to the table's AFTER UPDATE triggers, whether SET LOCK_TIMEOUT sent
 * inside `sp_executesql` ends with its request, and what two saves of one
 * record's rows do when each moves the record's version first, under
 * locking READ COMMITTED and under READ_COMMITTED_SNAPSHOT. Plain statements
 * through mssql, each `query` sent as `sp_executesql` as the adapter's are
 * (sql/statement.ts), on tables of this file's own; no product code runs.
 *
 * Characterisation, as the spike's file is: each case states what the engine
 * does, and a server release that changes an answer fails here by name. A
 * measured fact has no code to revert, so each case was watched failing with
 * the opposite asserted; its comment quotes what that run said.
 */
let fixture: SqlServerFixture
let owner: mssql.ConnectionPool

/**
 * Sets the touch column to itself where the rowversion is still the one
 * read: the save's record step on a rowversion table with nothing of the
 * record's own to change. Aliased, as the adapter's updates are.
 */
const TOUCH = 'update [r] set [notes] = [r].[notes] from [facts].[order] as [r] where [r].[id] = @id and [r].[row_version] = @version'
const ADD_LINE = 'insert into [facts].[order_line] ([order_id], [line_no]) values (@id, @line)'
const COUNT_LINES = 'select count(*) as [n] from [facts].[order_line] as [r] where [r].[order_id] = @id'

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  await owner.request().batch('create schema facts')
  await owner.request().batch(`
    create table facts.[order] (id int not null primary key, tenant_id int not null default 1, notes nvarchar(100) null, row_version rowversion not null);
    create table facts.order_line (order_id int not null references facts.[order] (id), line_no int not null, primary key (order_id, line_no));
    create table facts.order_updated (order_id int not null, notes_updated bit not null, tenant_updated bit not null);`)
  // One row per row the statement updated, with what UPDATE() said of the
  // column the touch sets and of one it does not.
  await owner.request().batch(`
    create trigger facts.order_after_update on facts.[order] after update as
    begin
      set nocount on;
      insert facts.order_updated (order_id, notes_updated, tenant_updated)
      select i.id, case when update(notes) then 1 else 0 end, case when update(tenant_id) then 1 else 0 end from inserted as i;
    end`)
})

afterAll(async () => {
  await owner?.close()
  await fixture?.stop()
})

/** A pool of one connection, as another person's request would hold: every request on it is on the same session. */
function connection(): Promise<mssql.ConnectionPool> {
  return new mssql.ConnectionPool({ ...fixture.admin, pool: { min: 0, max: 1 } }).connect()
}

/** An order with `lines` lines, its notes as given, inserted and committed as the owner. */
async function order(id: number, lines: number, notes: string | null = null): Promise<void> {
  await owner
    .request()
    .input('id', mssql.Int, id)
    .input('notes', mssql.NVarChar(100), notes)
    .query('insert into facts.[order] (id, notes) values (@id, @notes)')
  for (let line = 1; line <= lines; line += 1) await owner.request().input('id', mssql.Int, id).input('line', mssql.Int, line).query(ADD_LINE)
}

/** What the order's AFTER UPDATE trigger recorded of one updated row. */
interface Updated {
  notes_updated: boolean
  tenant_updated: boolean
}

/** An order as the owner reads it: its notes, its rowversion, its lines, and what its AFTER UPDATE trigger recorded. */
async function stored(id: number): Promise<{ notes: string | null; version: Buffer; lines: number; updated: Updated[] }> {
  const found = await owner.request().input('id', mssql.Int, id).query<{
    notes: string | null
    version: Buffer
    lines: number
  }>('select notes, row_version as version, (select count(*) from facts.order_line where order_id = @id) as lines from facts.[order] where id = @id')
  const row = found.recordset[0]
  if (row === undefined) throw new Error(`order ${String(id)} is missing`)
  const updated = await owner
    .request()
    .input('id', mssql.Int, id)
    .query<Updated>('select notes_updated, tenant_updated from facts.order_updated where order_id = @id')
  return { ...row, updated: [...updated.recordset] }
}

/** The touch, on `via`, as `sp_executesql`: how many rows it moved. */
async function touched(via: mssql.ConnectionPool | mssql.Transaction, id: number, version: Buffer): Promise<number | undefined> {
  const result = await via.request().input('id', mssql.Int, id).input('version', mssql.VarBinary(8), version).query(TOUCH)
  return result.rowsAffected[0]
}

/** The session a one-connection pool runs on. */
async function sessionOf(pool: mssql.ConnectionPool): Promise<number> {
  const result = await pool.request().query<{ spid: number }>('select @@spid as spid')
  const spid = result.recordset[0]?.spid
  if (spid === undefined) throw new Error('SQL Server did not say which session answered')
  return spid
}

/** Waits until the server shows `session` waiting on another's lock: polled, never a fixed delay. */
async function blocked(session: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const found = await owner
      .request()
      .input('session', mssql.Int, session)
      .query<{ blocker: number }>('select blocking_session_id as blocker from sys.dm_exec_requests where session_id = @session')
    if ((found.recordset[0]?.blocker ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`session ${String(session)} never waited on another`)
}

describe('a touch of a rowversion table, a column set to itself', () => {
  // A rowversion cannot be set, so a save that changes none of the record's
  // own fields moves its version by setting a column to itself. Were the
  // rowversion left as it was by a statement that changed no value, a
  // second save holding the same version would pass its guard after the
  // first committed, and both saves' rows would be stored: the bound passed,
  // and a lost save resent stored twice. Moved for a value and for NULL,
  // which the column may hold, and the value kept. Watched failing with the
  // rowversion asserted unchanged: "expected false to be true".
  test('moves the rowversion, whether the column holds a value or NULL, and keeps the value', async () => {
    await order(1, 0, 'kept')
    await order(2, 0, null)
    for (const [id, notes] of [
      [1, 'kept'],
      [2, null],
    ] as const) {
      const before = await stored(id)
      expect(await touched(owner, id, before.version)).toBe(1)
      const after = await stored(id)
      expect(after.notes).toBe(notes)
      expect(after.version.equals(before.version)).toBe(false)
    }
  })

  // A record's UPDATE triggers firing on a save of its rows alone is a cost
  // of moving its version on every save; were the touch to fire none, that
  // cost would be stated wrongly, and a trigger that keeps the record's own
  // bookkeeping -- a total of its lines, an audit row -- would miss every
  // save that changed only rows. It fires once, for the touched row.
  // Watched failing with no trigger row asserted: "expected [ {
  // notes_updated: true, …(1) } ] to have a length of +0 but got 1".
  test('fires the table’s AFTER UPDATE trigger, once, for the touched row', async () => {
    await order(3, 0, 'kept')
    expect(await touched(owner, 3, (await stored(3)).version)).toBe(1)
    expect((await stored(3)).updated).toHaveLength(1)
  })

  // Why the touch column may be no key, foreign key, pinned or filtered
  // column: inside the trigger UPDATE() is true for the column the touch
  // sets, value changed or not, so a trigger that refuses a change of tenant
  // with `if update(tenant_id)` would refuse every save of rows were the
  // tenant the touch column. False for a column the touch does not set, so
  // UPDATE() answers for the SET list and not for every column. Watched
  // failing with UPDATE(notes) asserted false: "expected [ { notes_updated:
  // true, …(1) } ] to deeply equal [ { notes_updated: false, …(1) } ]".
  test('makes UPDATE() true in the trigger for the column set, and false for one it does not set', async () => {
    await order(4, 0, 'kept')
    expect(await touched(owner, 4, (await stored(4)).version)).toBe(1)
    expect((await stored(4)).updated).toEqual([{ notes_updated: true, tenant_updated: false }])
  })
})

describe('SET LOCK_TIMEOUT sent inside sp_executesql', () => {
  /** The session's lock timeout and the session, as one request on `pool` sees them after `before`. */
  async function timeoutSeen(pool: mssql.ConnectionPool, before = ''): Promise<{ timeout: number; spid: number } | undefined> {
    const seen = await pool.request().query<{ timeout: number; spid: number }>(`${before}select @@lock_timeout as timeout, @@spid as spid`)
    return seen.recordset[0]
  }

  // A save sets its lock timeout at the head of its one batch and rests on
  // it bounding every lock wait after it there, 1222, answered unavailable.
  // Were it to take effect only from the next request, a save would wait on
  // a held row for as long as the driver's request timeout lets it, holding
  // its own locks meanwhile. Watched failing with the request asserted to
  // resolve: "promise rejected "RequestError: Lock request time out perio…
  // { …(7) }" instead of resolving", 1222.
  test('bounds the lock wait of a statement after it in the same request', async () => {
    await order(5, 0, 'held')
    const holder = await connection()
    const pooled = await connection()
    const holding = new mssql.Transaction(holder)
    try {
      await holding.begin()
      await new mssql.Request(holding).query("update facts.[order] set notes = N'held' where id = 5")
      const waited = pooled.request().query('set lock_timeout 200; update [r] set [notes] = [r].[notes] from [facts].[order] as [r] where [r].[id] = 5')
      await expect(waited).rejects.toMatchObject({ number: 1222 })
    } finally {
      await holding.rollback()
      await Promise.all([holder.close(), pooled.close()])
    }
  })

  // A save leaves its connection to the pool after its batch. Were the
  // setting the session's, the next request on that pooled connection --
  // another person's read, a single write -- would wait for a lock only as
  // long as a save may, and fail 1222 where it would have waited. Set inside
  // the request, it is the default, -1, in the next request on the same
  // session. A SET sent as a batch of its own, the control, outlives its
  // request on that session, so the pool keeps a session's settings and it
  // was sp_executesql's scope that ended the first. Watched failing with the
  // setting asserted to outlive the request: "expected { timeout: -1, spid:
  // 57 } to deeply equal { timeout: 200, spid: 57 }".
  test('ends with the request, where a SET sent as a batch outlives it on the session', async () => {
    const pooled = await connection()
    try {
      const inside = await timeoutSeen(pooled, 'set lock_timeout 200; ')
      expect(inside?.timeout).toBe(200)
      const session = inside?.spid
      expect(await timeoutSeen(pooled)).toEqual({ timeout: -1, spid: session })
      await pooled.request().batch('set lock_timeout 200')
      expect(await timeoutSeen(pooled)).toEqual({ timeout: 200, spid: session })
    } finally {
      await pooled.close()
    }
  })
})

describe("two saves of one record's rows, each moving the record's version first", () => {
  /**
   * Two saves of order `id`, each holding the rowversion read before either
   * began and adding a line: the first touches the order and adds line
   * `next`, and while it is still inside its transaction the second, on a
   * session of its own, sends the same touch. The first counts and commits
   * only once the server shows the second waiting on it. The second adds its
   * line and counts only where its touch moved a row; it answers how many it
   * moved, and is rolled back.
   */
  async function raced(id: number, next: number): Promise<{ first: number | undefined; second: { moved: number | undefined; lines?: number | undefined } }> {
    const version = (await stored(id)).version
    const firstPool = await connection()
    const secondPool = await connection()
    const first = new mssql.Transaction(firstPool)
    const second = new mssql.Transaction(secondPool)
    try {
      const secondSession = await sessionOf(secondPool)
      await first.begin()
      expect(await touched(first, id, version)).toBe(1)
      await new mssql.Request(first).input('id', mssql.Int, id).input('line', mssql.Int, next).query(ADD_LINE)
      await second.begin()
      const pending = (async () => {
        const moved = await touched(second, id, version)
        if (moved === 0) return { moved }
        await new mssql.Request(second)
          .input('id', mssql.Int, id)
          .input('line', mssql.Int, next + 1)
          .query(ADD_LINE)
        const lines = await new mssql.Request(second).input('id', mssql.Int, id).query<{ n: number }>(COUNT_LINES)
        return { moved, lines: lines.recordset[0]?.n }
      })()
      // Settled here too, so a rejection is the case's to see and never unhandled.
      void pending.catch(() => undefined)
      await blocked(secondSession)
      const counted = await new mssql.Request(first).input('id', mssql.Int, id).query<{ n: number }>(COUNT_LINES)
      await first.commit()
      const answered = await pending
      await second.rollback()
      return { first: counted.recordset[0]?.n, second: answered }
    } finally {
      await Promise.all([firstPool.close(), secondPool.close()])
    }
  }

  /** Whether the fixture's database reads committed data from row versions. */
  async function snapshotReads(): Promise<boolean> {
    const result = await owner.request().query<{ on: boolean }>('select is_read_committed_snapshot_on as [on] from sys.databases where database_id = db_id()')
    return result.recordset[0]?.on === true
  }

  // The race the version move exists for. Two saves each adding the last
  // line a bound allows: were the second, once the first committed, to find
  // the rowversion it held and move it again, both would add their line and
  // each count would pass alone -- the bound passed by one, and a resend of
  // a lost save stored twice. Under locking READ COMMITTED the second waits
  // on the record's row, then finds the rowversion moved and changes
  // nothing, so it never adds or counts. Watched failing with the second
  // asserted to move the row and count three lines: "expected { moved: +0 }
  // to deeply equal { moved: 1, lines: 3 }".
  test('under locking READ COMMITTED: the second waits, then finds no row to move', async () => {
    expect(await snapshotReads()).toBe(false)
    await order(6, 1)
    const before = await stored(6)
    const { first, second } = await raced(6, 2)
    expect(first).toBe(2)
    expect(second).toEqual({ moved: 0 })
    const after = await stored(6)
    expect(after.lines).toBe(2)
    expect(after.version.equals(before.version)).toBe(false)
  })

  // Under READ_COMMITTED_SNAPSHOT, which a database may have on, a read
  // takes no shared lock and reads the last committed version. Were the
  // touch's search for its row such a read, the second would find the row
  // as it was before the first committed, its version still the one it
  // held, and move it: both saves stored. The UPDATE waits for the row
  // instead, and reads it as the first committed it, so it finds the
  // rowversion moved, as under locking READ COMMITTED. Watched failing with
  // the second asserted to move the row and count three lines: "expected {
  // moved: +0 } to deeply equal { moved: 1, lines: 3 }".
  test('under READ_COMMITTED_SNAPSHOT: the second waits, then finds no row to move', async () => {
    await order(7, 1)
    const before = await stored(7)
    await owner.request().batch('alter database current set read_committed_snapshot on with rollback immediate')
    try {
      expect(await snapshotReads()).toBe(true)
      const { first, second } = await raced(7, 2)
      expect(first).toBe(2)
      expect(second).toEqual({ moved: 0 })
    } finally {
      await owner.request().batch('alter database current set read_committed_snapshot off with rollback immediate')
    }
    const after = await stored(7)
    expect(after.lines).toBe(2)
    expect(after.version.equals(before.version)).toBe(false)
  })
})
