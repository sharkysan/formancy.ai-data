import type { PostgresFixture } from '@formancy/data-fixtures'
import { startPostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * The PostgreSQL facts a save of a record with its rows, in one transaction,
 * would rest on, measured before anything is designed on them: what
 * REPEATABLE READ's snapshot follows, what grant the locked path's LOCK asks,
 * what a row lock that only locked leaves a waiter, and what two saves of one
 * record's rows do when each moves the record's version first. Plain
 * statements through postgres.js, as the adapter sends them (`sql.unsafe`
 * with its parameters, `sql.begin` for a transaction), on tables of this
 * file's own; no product code runs.
 *
 * Characterisation, as the spike's file is: each case states what the engine
 * does, and a server release that changes an answer fails here by name. A
 * measured fact has no code to revert, so each case was watched failing with
 * the opposite asserted; its comment quotes what that run said.
 */
let fixture: PostgresFixture
let owner: Sql

/** The account that may touch an order -- move its version -- and nothing else. */
const TOUCHER = { user: 'facts_toucher', password: 'toucher-fixture-password' } as const

/** Moves an order's version where it is still the one read: the save's record step with nothing to change but the version. */
const TOUCH = 'update "facts"."order" as "r" set "version" = "r"."version" + 1 where "r"."id" = $1 and "r"."version" = $2'
const ADD_LINE = 'insert into "facts"."order_line" ("order_id", "line_no") values ($1, $2)'
const COUNT_LINES = 'select count(*)::int as "n" from "facts"."order_line" as "r" where "r"."order_id" = $1'
const LOCK_ROW = 'select from "facts"."order" as "p" where "p"."id" = $1 for no key update of "p"'

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  await owner.unsafe(`
    create schema facts;
    create table facts."order" (id integer primary key, version bigint not null default 1);
    create table facts.order_line (order_id integer not null references facts."order" (id), line_no integer not null, primary key (order_id, line_no));
    create role ${TOUCHER.user} login password '${TOUCHER.password}';
    grant usage on schema facts to ${TOUCHER.user};
    grant select on facts."order" to ${TOUCHER.user};
    grant update (version) on facts."order" to ${TOUCHER.user};`)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

/** A driver of its own on one backend, as another person's request would be: it sees none of another's uncommitted work. */
function connection(uri: string = fixture.admin): Sql {
  return postgres(uri, { max: 1, onnotice: () => {} })
}

/** The URI of the fixture's database as `user`. */
function as(user: string, password: string): string {
  const url = new URL(fixture.admin)
  url.username = user
  url.password = password
  return url.toString()
}

/** The backend a one-connection driver runs on, asked before its transaction so the question takes no snapshot inside it. */
async function backendOf(sql: Sql): Promise<number> {
  const [row] = await sql<{ pid: number }[]>`select pg_backend_pid() as pid`
  if (row === undefined) throw new Error('PostgreSQL did not say which backend answered')
  return row.pid
}

/** Waits until PostgreSQL names a backend blocking `pid`: polled, never a fixed delay. */
async function waitsBehindAnother(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const [state] = await owner<{ blocked: boolean }[]>`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`
    if (state?.blocked === true) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`backend ${String(pid)} never waited on another`)
}

/** An order with `lines` lines, inserted and committed as the owner. */
async function order(id: number, lines: number): Promise<void> {
  await owner.unsafe('insert into "facts"."order" ("id") values ($1)', [id])
  for (let line = 1; line <= lines; line += 1) await owner.unsafe(ADD_LINE, [id, line])
}

/** An order's committed lines and version, as the owner reads them after the transactions under test have ended. */
async function stored(id: number): Promise<{ lines: number; version: string }> {
  const [row] = await owner.unsafe<{ lines: number; version: string }[]>(
    'select (select count(*)::int from "facts"."order_line" where "order_id" = $1) as "lines", "version"::text as "version" from "facts"."order" where "id" = $1',
    [id],
  )
  if (row === undefined) throw new Error(`order ${String(id)} is missing`)
  return row
}

describe("REPEATABLE READ's snapshot", () => {
  // A save sets its lock and statement timeouts, and on the locked path
  // takes its LOCK, before the record's step, and rests on that step taking
  // the transaction's snapshot. Were the snapshot taken by SET LOCAL or by
  // the LOCK, a save under REPEATABLE READ would count its rows as they were
  // before the lock was held, and a row another writer committed in between
  // would be missed by the count: a bound held only by that count could be
  // passed. A line committed after the SETs and another after the LOCK are
  // both counted, so neither took it; and the settings are the
  // transaction's. Watched failing with 1 line asserted, as though the LOCK
  // had taken it: "expected { lines: 2, lock: '5s', …(1) } to deeply equal
  // { lines: 1, lock: '5s', …(1) }".
  test('is not taken by SET LOCAL or by LOCK TABLE, but by the first statement that reads', async () => {
    await order(1, 0)
    const sql = connection()
    try {
      const seen = await sql.begin('isolation level repeatable read', async (tx) => {
        await tx.unsafe('set local lock_timeout = 5000')
        await tx.unsafe('set local statement_timeout = 5000')
        await owner.unsafe(ADD_LINE, [1, 1])
        await tx.unsafe('lock table only "facts"."order_line" in row exclusive mode')
        await owner.unsafe(ADD_LINE, [1, 2])
        const [counted] = await tx.unsafe<{ n: number }[]>(COUNT_LINES, [1])
        const [settings] = await tx.unsafe<{ lock: string; statement: string }[]>(
          "select current_setting('lock_timeout') as lock, current_setting('statement_timeout') as statement",
        )
        return { lines: counted?.n, lock: settings?.lock, statement: settings?.statement }
      })
      expect(seen).toEqual({ lines: 2, lock: '5s', statement: '5s' })
    } finally {
      await sql.end()
    }
  })

  // Why a save SETs its timeouts, splicing the configuration's integer,
  // rather than binding it to set_config: a SELECT reads, and under
  // REPEATABLE READ its snapshot is the transaction's from then on, before
  // the LOCK. A save that set its timeouts this way would count as of then,
  // and miss what the case above counts. Also the control on that case: the
  // way it counts sees a snapshot taken early when one is. Watched failing
  // with 2 asserted, as though set_config took none: "expected +0 to be 2".
  test('is taken by a SELECT of set_config, before the LOCK that follows it', async () => {
    await order(2, 0)
    const sql = connection()
    try {
      const lines = await sql.begin('isolation level repeatable read', async (tx) => {
        await tx.unsafe("select set_config('lock_timeout', $1, true)", ['5000'])
        await owner.unsafe(ADD_LINE, [2, 1])
        await tx.unsafe('lock table only "facts"."order_line" in row exclusive mode')
        await owner.unsafe(ADD_LINE, [2, 2])
        const [counted] = await tx.unsafe<{ n: number }[]>(COUNT_LINES, [2])
        return counted?.n
      })
      expect(lines).toBe(0)
      expect((await stored(2)).lines).toBe(2)
    } finally {
      await sql.end()
    }
  })
})

describe("the locked path's LOCK and the grants it asks", () => {
  // A save over an existing record whose own fields did not change moves
  // the record's version and nothing else, so the grant it asks of the
  // record's table is UPDATE on the version column. Under any isolation but
  // READ COMMITTED the save takes LOCK ... IN ROW EXCLUSIVE MODE on every
  // table it writes first, the record's included. Were that grant enough
  // for the lock, an account granted only it could save rows under
  // REPEATABLE READ; it is not: the LOCK asks a table-level grant, so a save
  // designed on the column grant alone would be refused 42501 before its
  // first step on the locked path, though the touch itself is allowed. The
  // touch is allowed under READ COMMITTED, where no LOCK is taken; and the
  // same account, granted UPDATE on the table, takes the lock, so the
  // refusal is the grant's, not the schema's or the statement's. Watched
  // failing with the lock asserted taken: "promise rejected "PostgresError:
  // permission denied for tabl… { …(9) }" instead of resolving", 42501.
  test('is refused to an account granted UPDATE on the version column only, which may make the touch itself', async () => {
    await order(3, 0)
    const toucher = connection(as(TOUCHER.user, TOUCHER.password))
    try {
      expect((await toucher.unsafe(TOUCH, [3, '1'])).count).toBe(1)
      const lock = () => toucher.begin('isolation level repeatable read', (tx) => tx.unsafe('lock table only "facts"."order" in row exclusive mode'))
      await expect(lock()).rejects.toMatchObject({ code: '42501', message: 'permission denied for table order' })
      await owner.unsafe(`grant update on facts."order" to ${TOUCHER.user}`)
      await expect(lock()).resolves.toBeDefined()
      expect(await stored(3)).toEqual({ lines: 0, version: '2' })
    } finally {
      await toucher.end()
    }
  })
})

describe("a row lock that only locked, and REPEATABLE READ's waiter", () => {
  // The cost of serialising saves of one record's rows by locking the
  // record's row and keeping its version. A save under REPEATABLE READ that
  // waited on another holding the lock is not rolled back when that one
  // commits, because the row was locked and not changed -- and its snapshot
  // was taken when its FOR NO KEY UPDATE started, before the other
  // committed, so its count misses the other's rows. A save designed on the
  // lock alone would pass a bound the two saves together exceed. The holder's
  // line is committed, so the count missed a committed row. Watched failing
  // with the holder's line asserted counted: "expected 1 to be 2".
  test('lets the waiter through when the holder commits, and its count misses the holder’s rows', async () => {
    await order(4, 1)
    const holder = connection()
    const waiter = connection()
    try {
      const waiterBackend = await backendOf(waiter)
      let waited: Promise<number | undefined> | undefined
      await holder.begin(async (tx) => {
        await tx.unsafe(LOCK_ROW, [4])
        await tx.unsafe(ADD_LINE, [4, 2])
        waited = waiter.begin('isolation level repeatable read', async (wx) => {
          await wx.unsafe(LOCK_ROW, [4])
          const [counted] = await wx.unsafe<{ n: number }[]>(COUNT_LINES, [4])
          return counted?.n
        })
        // Settled here too, so a waiter refused before it blocks is the case's to assert and never unhandled.
        void waited.catch(() => undefined)
        await waitsBehindAnother(waiterBackend)
      })
      expect(await waited).toBe(1)
      expect(await stored(4)).toEqual({ lines: 2, version: '1' })
    } finally {
      await Promise.all([holder.end(), waiter.end()])
    }
  })
})

describe("two saves of one record's rows, each moving the record's version first", () => {
  /**
   * Two saves of order `id`, each holding version 1 and adding a line: the
   * first moves the version and adds line `next` and, while it is still
   * inside its transaction, the second, under `isolation`, sends the same
   * touch on a backend of its own. The first counts and commits only once
   * PostgreSQL shows the second waiting on it. The second adds its line and
   * counts only where its touch moved a row; it answers how many it moved.
   */
  async function raced(
    id: number,
    next: number,
    isolation: 'read committed' | 'repeatable read',
  ): Promise<{ first: number | undefined; second: Promise<unknown> }> {
    const first = connection()
    const second = connection()
    try {
      const secondBackend = await backendOf(second)
      let pending: Promise<unknown> | undefined
      const counted = await first.begin(async (tx) => {
        expect((await tx.unsafe(TOUCH, [id, '1'])).count).toBe(1)
        await tx.unsafe(ADD_LINE, [id, next])
        pending = second.begin(`isolation level ${isolation}`, async (sx) => {
          const moved = (await sx.unsafe(TOUCH, [id, '1'])).count
          if (moved === 0) return { moved }
          await sx.unsafe(ADD_LINE, [id, next + 1])
          const [lines] = await sx.unsafe<{ n: number }[]>(COUNT_LINES, [id])
          return { moved, lines: lines?.n }
        })
        // Settled here too, so a rejection is the case's to assert and never unhandled.
        void pending.catch(() => undefined)
        await waitsBehindAnother(secondBackend)
        const [lines] = await tx.unsafe<{ n: number }[]>(COUNT_LINES, [id])
        return lines?.n
      })
      const settled = pending ?? Promise.reject(new Error('the second save never started'))
      await settled.then(
        () => undefined,
        () => undefined,
      )
      return { first: counted, second: settled }
    } finally {
      await Promise.all([first.end(), second.end()])
    }
  }

  // The race the version move exists for. Two saves each adding the last
  // line a bound allows: were the second, once the first committed, to find
  // the version it held and move it again, both would add their line and
  // each count would pass alone -- the bound passed by one, and a resend of
  // a lost save stored twice. Under READ COMMITTED the second waits on the
  // record's row, then reads it again as committed, finds the version moved
  // and changes nothing, so it never adds or counts. Watched failing with
  // the second asserted to move the row and count three lines: "expected {
  // moved: +0 } to deeply equal { moved: 1, lines: 3 }".
  test('under READ COMMITTED: the second waits, then finds no row to move', async () => {
    await order(5, 1)
    const { first, second } = await raced(5, 2, 'read committed')
    expect(first).toBe(2)
    await expect(second).resolves.toEqual({ moved: 0 })
    expect(await stored(5)).toEqual({ lines: 2, version: '2' })
  })

  // The same race under REPEATABLE READ, which the locked path runs: the
  // second's touch took its snapshot before the first committed, and the
  // row it waited on was changed, not only locked, so PostgreSQL refuses it
  // with 40001 rather than answering 0 rows. A save that read only "no row"
  // as stale would report a lost race as a server failure. Watched failing
  // with the second asserted to resolve as no row moved: "promise rejected
  // "PostgresError: could not serialize access… { …(9) }" instead of
  // resolving", 40001.
  test('under REPEATABLE READ: the second waits, then is refused 40001', async () => {
    await order(6, 1)
    const { first, second } = await raced(6, 2, 'repeatable read')
    expect(first).toBe(2)
    await expect(second).rejects.toMatchObject({ code: '40001', message: 'could not serialize access due to concurrent update' })
    expect(await stored(6)).toEqual({ lines: 2, version: '2' })
  })
})
