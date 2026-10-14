import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { LookupConfig, LookupQuery, LookupResult, LookupSignal, ObjectRef, RowFilters } from '@formancy/data-core'
import { buildLookupConfig, encodeKeyToken, generateForm, lookupKeys } from '@formancy/data-core'
import type { BlockedTable, SqlServerFixture, TcpHop } from '@formancy/data-fixtures'
import { answerBytes, blockTable, startSqlServerFixture, startTcpHop } from '@formancy/data-fixtures'
import { createSqlServerLookups, discoverSqlServer } from './index.js'
import { keyGroups, PARAMETER_LIMIT } from './lookups/statements.js'

/**
 * A lookup statement stops when its caller's signal aborts (0061), against
 * REAL SQL Server 2022: the server aborts the signal when the browser
 * abandons a search or the lookup deadline passes, and the adapter answers
 * with `request.cancel()`, a TDS attention on the statement's own
 * connection.
 *
 * "Stopped" is proved in the database, never by the promise alone: every
 * case that cancels holds `sales.customer` behind `blockTable`'s exclusive
 * lock, sees the lookup wait in `sys.dm_exec_requests` (one request blocked
 * by the holder), aborts, and then sees the waiter gone while the lock is
 * still held. A statement that only lost its listener would wait until the
 * release, which is the "the database finishes every scan it started" that
 * docs/performance.md measured. Every wait here is polled, query after
 * query, and bounded by PATIENCE so a missing cancel fails instead of
 * hanging; nothing sleeps.
 *
 * The lookups run as `formancy_writer`, the order form's account, on a pool
 * of one connection through a TCP hop (0031): one connection, so the next
 * lookup after a cancel is on the very connection the attention was sent
 * on; through the hop, so "nothing was sent" is counted on the wire. Every
 * byte is tedious's and the server's.
 */
let fixture: SqlServerFixture
let hop: TcpHop
let pool: mssql.ConnectionPool
let config: LookupConfig
/** The first page of the writer's customers, read with a signal nobody aborts, before any case cancels anything. */
let firstPage: LookupResult

const CUSTOMER: ObjectRef = { schema: 'sales', name: 'customer' }
/** The writer's security policy shows it tenant 1 only, so every row it reads is tenant 1's. */
const EVERY_ROW: RowFilters = { kind: 'unrestricted' }
const FIRST_PAGE: LookupQuery = { search: '', offset: 0, limit: 50 }

/**
 * How long a poll waits for the database to say what a case expects. Below
 * mssql's 15 s default request timeout, so a lookup the adapter failed to
 * cancel is still waiting when the poll gives up, and the case fails on the
 * missing cancel rather than on the driver's own timeout.
 */
const PATIENCE = 10_000

/**
 * A statement's text as tedious sends it, less its last byte. In UTF-16LE an
 * ASCII text ends in a zero byte, and the hop, which lets a SQL Server marker
 * be cut by one 8-byte packet header, also matched the text less that byte,
 * eight bytes on, and a zero: what follows the text of a statement with
 * parameters. Measured here on 2026-10-14, `select @a as [zz_marker]` with
 * one parameter counted 2 sendings in full and 1 without its last byte;
 * without parameters, 1 either way.
 */
const wireText = (text: string): Buffer => answerBytes('sqlserver', text).subarray(0, -1)
/** On the wire, every lookup statement selects the key as `[k0]`; nothing else this suite sends does. */
const LOOKUP_TEXT = wireText('as [k0]')
/** On the wire, only a resolve's or a membership check's statement joins its keys with this. */
const KEYS_TEXT = wireText('exists (select 1 from (values')

/** A signal no case aborts: a lookup that completes answers exactly what it answered before the port carried a signal. */
const NOT_ABORTED = new AbortController().signal

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  hop = await startTcpHop({ kind: 'sqlserver', host: String(fixture.writer.server), port: fixture.writer.port ?? 1433 })
  // Idle connections are kept for the whole file: the pool's default 30 s
  // reaping would replace the one session the cases compare, and a new
  // login would count as turns on the hop.
  pool = await new mssql.ConnectionPool({ ...fixture.writer, server: '127.0.0.1', port: hop.port, pool: { min: 0, max: 1, idleTimeoutMillis: 3_600_000 } }).connect()
  // Derived as a deployment derives the order form's customer lookup.
  const owner = await new mssql.ConnectionPool(fixture.admin).connect()
  try {
    const snapshot = await discoverSqlServer(owner, { schemas: ['sales'] })
    const { bindings } = generateForm(snapshot, { connection: 'erp', root: { schema: 'sales', name: 'order' }, formId: 'form', title: 'Form', lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }] })
    const field = bindings.fields.find((binding) => binding.kind === 'lookup')
    if (field === undefined) throw new Error('the order form has no customer lookup')
    config = buildLookupConfig(bindings, field.field, { snapshot })
  } finally {
    await owner.close()
  }
  firstPage = await createSqlServerLookups(pool).search(config, FIRST_PAGE, EVERY_ROW, NOT_ABORTED)
})

afterAll(async () => {
  await pool?.close()
  await hop?.close()
  await fixture?.stop()
})

/** Asks `check` again, query after query, until it holds; fails naming `what` after PATIENCE. */
async function until(check: () => Promise<boolean>, what: string): Promise<void> {
  const giveUp = performance.now() + PATIENCE
  while (!(await check())) {
    if (performance.now() > giveUp) throw new Error(`after ${String(PATIENCE)} ms: ${what}`)
  }
}

/** Runs `body` with `sales.customer` locked, releasing the lock however it ends; `body` may release it early. */
async function whileBlocked(body: (blocked: BlockedTable) => Promise<void>): Promise<void> {
  const held = await blockTable({ kind: 'sqlserver', admin: fixture.admin }, CUSTOMER)
  let released: Promise<void> | undefined
  const blocked: BlockedTable = { waiting: () => held.waiting(), release: () => (released ??= held.release()) }
  try {
    await body(blocked)
  } finally {
    await blocked.release()
  }
}

/** A lookup that is meant to be stopped: its rejection, and whether it has settled yet. */
interface Stopping {
  readonly rejection: Promise<unknown>
  settled(): boolean
}

function stopping(lookup: Promise<unknown>): Stopping {
  let settled = false
  const rejection = lookup.then(
    () => {
      settled = true
      throw new Error('the lookup answered; it was meant to be stopped')
    },
    (error: unknown) => {
      settled = true
      return error
    },
  )
  // A case that fails before it awaits the rejection reports that failure, not an unhandled one.
  rejection.catch(() => undefined)
  return { rejection, settled: () => settled }
}

/**
 * Whether `lookup` settled before the event loop turned once after its
 * abort: the contract's "at once, without waiting for the database". Every
 * answer from the server -- the attention's acknowledgement included --
 * arrives in a later turn, as a socket read.
 */
async function settledAtOnce(lookup: Stopping): Promise<boolean> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  return lookup.settled()
}

/** The session state a lookup could leave behind on its connection, read on the pool's one connection. */
async function sessionState(): Promise<{ spid: number; trancount: number; options: number; lockTimeout: number }> {
  const result = await pool.request().query<{ spid: number; trancount: number; options: number; lockTimeout: number }>(
    'select @@spid as spid, @@trancount as trancount, @@options as options, @@lock_timeout as lockTimeout',
  )
  const state = result.recordset[0]
  if (state === undefined) throw new Error('the session state came back empty')
  return state
}

function tokenOf(customerNo: number): string {
  const encoded = encodeKeyToken(['1', String(customerNo)])
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}

const operations = {
  search: (signal: LookupSignal) => createSqlServerLookups(pool).search(config, FIRST_PAGE, EVERY_ROW, signal),
  resolve: (signal: LookupSignal) => createSqlServerLookups(pool).resolve(config, [tokenOf(1001)], EVERY_ROW, signal),
  rejects: (signal: LookupSignal) => createSqlServerLookups(pool).rejects(config, [tokenOf(1001)], EVERY_ROW, signal),
} as const
const OPERATIONS = Object.keys(operations) as (keyof typeof operations)[]

describe('an abort while the statement runs', () => {
  // The defect this closes: an abort that only rejected the promise would
  // leave the statement waiting in the database until the lock went, and a
  // search would scan on for nobody. The waiter has to be gone while the lock
  // is still held, which only the attention reaching the server does. The
  // rejection comes at once, and is the reason itself, so the server tells
  // its own abort from a database failure by identity.
  test.each(OPERATIONS)('a %s stops in the database, and rejects at once with exactly the reason', async (name) => {
    await whileBlocked(async (blocked) => {
      const controller = new AbortController()
      const running = stopping(operations[name](controller.signal))
      await until(async () => (await blocked.waiting()) === 1, `the ${name} never waited on the lock`)
      controller.abort(new Error(`the ${name}'s caller went away`))
      expect(await settledAtOnce(running)).toBe(true)
      expect(await running.rejection).toBe(controller.signal.reason)
      await until(async () => (await blocked.waiting()) === 0, `the ${name} still waits in the database after its abort`)
    })
  })

  // The deadline the server composes is AbortSignal.timeout: its reason is a
  // TimeoutError. Translated or wrapped, the server could not tell a passed
  // deadline from a failure, and would answer `unavailable` -- which invites
  // the retry that reads the same rows again -- instead of `lookup-timeout`.
  test('a deadline stops the statement, and rejects with the TimeoutError itself', async () => {
    await whileBlocked(async (blocked) => {
      const signal = AbortSignal.timeout(1_000)
      const running = stopping(operations.search(signal))
      await until(async () => (await blocked.waiting()) === 1, 'the search never waited on the lock')
      const error = await running.rejection
      expect(error).toBe(signal.reason)
      expect(error).toMatchObject({ name: 'TimeoutError' })
      await until(async () => (await blocked.waiting()) === 0, 'the search still waits in the database after its deadline')
    })
  })
})

describe('an abort before anything is sent', () => {
  // A request already gone when its lookup is asked for is the work being
  // removed: sending its statement, or even the pool's `SELECT 1` check of a
  // connection, would be a round trip for nobody. The next lookup on the
  // one connection ends this case's traffic: anything the aborted one had
  // sent went ahead of it, and the next costs its own two turns, the check
  // and the statement.
  test.each(OPERATIONS)('an already aborted %s rejects with the reason and crosses the wire not once', async (name) => {
    const controller = new AbortController()
    controller.abort(new Error('gone before it was asked'))
    const turns = hop.countRoundTrips()
    expect(await stopping(operations[name](controller.signal)).rejection).toBe(controller.signal.reason)
    expect(await operations.search(NOT_ABORTED)).toEqual(firstPage)
    expect(turns()).toBe(2)
  })

  // A resolve or a membership check with no token worth looking up sends
  // nothing anyway; it still owes a caller already gone the reason, not an
  // answer, or the server would read an empty list as what the database said.
  test('an already aborted resolve or rejects with nothing to look up still rejects with the reason', async () => {
    const controller = new AbortController()
    controller.abort(new Error('gone before it was asked'))
    const lookups = createSqlServerLookups(pool)
    expect(await stopping(lookups.resolve(config, ['not a token'], EVERY_ROW, controller.signal)).rejection).toBe(controller.signal.reason)
    expect(await stopping(lookups.rejects(config, ['not a token'], EVERY_ROW, controller.signal)).rejection).toBe(controller.signal.reason)
  })

  // An abort in the same tick as the call lands while mssql is still
  // borrowing the connection: the request is marked cancelled, and mssql
  // checks that mark once it holds the connection and gives it straight
  // back. Had the statement gone out, the attention would have raced it.
  test('an abort in the same tick as the call sends no statement, and the next lookup answers', async () => {
    const sent = hop.countSent(LOOKUP_TEXT)
    const controller = new AbortController()
    const running = stopping(operations.search(controller.signal))
    controller.abort(new Error('superseded at once'))
    expect(await settledAtOnce(running)).toBe(true)
    expect(await running.rejection).toBe(controller.signal.reason)
    expect(await operations.search(NOT_ABORTED)).toEqual(firstPage)
    expect(sent()).toBe(1)
  })
})

describe('the connection after a cancel', () => {
  // A connection given back mid-attention -- tedious's SENT_ATTENTION state --
  // would fail the next person's request on it, or hand them a session with
  // something left over. The pool has one connection, so the state read
  // straight after the cancel, and the next search, are on the very session
  // the attention went to: the same spid, no open transaction, the same SET
  // options and lock timeout as before, and the page it answered before.
  test('the one pooled connection answers the next lookup, with nothing left over', async () => {
    const before = await sessionState()
    await whileBlocked(async (blocked) => {
      const controller = new AbortController()
      const running = stopping(operations.search(controller.signal))
      await until(async () => (await blocked.waiting()) === 1, 'the search never waited on the lock')
      controller.abort(new Error('the typist typed on'))
      expect(await running.rejection).toBe(controller.signal.reason)
      // Queued behind the cancelled statement on the one connection; it reads no locked table.
      expect(await sessionState()).toEqual(before)
      const next = operations.search(NOT_ABORTED)
      await until(async () => (await blocked.waiting()) === 1, 'the next search never reached the database')
      await blocked.release()
      expect(await next).toEqual(firstPage)
    })
  })
})

describe('a resolve in several groups', () => {
  /** One more key than one statement can bind: a long list of tokens, read in two groups. */
  const tokens = Array.from({ length: Math.floor(PARAMETER_LIMIT / 2) + 1 }, (_, index) => tokenOf(index + 1))

  // The two cases below count one statement sent where two were due; were
  // the tokens one group, they would prove nothing.
  test('the tokens need exactly two statements', () => {
    expect(keyGroups(config, lookupKeys(config, tokens), 0)).toHaveLength(2)
  })

  // A long resolve must not go on group after group for nobody: aborted
  // while its first group waits, that group is stopped and no second one
  // is sent.
  test('aborted during the first group, it sends no second', async () => {
    const sent = hop.countSent(KEYS_TEXT)
    await whileBlocked(async (blocked) => {
      const controller = new AbortController()
      const running = stopping(createSqlServerLookups(pool).resolve(config, tokens, EVERY_ROW, controller.signal))
      await until(async () => (await blocked.waiting()) === 1, 'the first group never waited on the lock')
      controller.abort(new Error('the form closed'))
      expect(await settledAtOnce(running)).toBe(true)
      expect(await running.rejection).toBe(controller.signal.reason)
      await until(async () => (await blocked.waiting()) === 0, 'the first group still waits in the database after its abort')
    })
    // After the release, a second group still due would go ahead of this on the one connection.
    expect(await operations.search(NOT_ABORTED)).toEqual(firstPage)
    expect(sent()).toBe(1)
  })

  // The window between two groups: the first group's answer is read, its
  // listener removed, and the abort comes before the second is built. A
  // listener added to a signal that has already aborted is never called, so
  // without the check before each statement the second group would run to
  // the end and the resolve would answer. The abort is made at exactly that
  // moment, by a signal that aborts itself when its first listener comes off.
  test('aborted between groups, it sends no second', async () => {
    const controller = new AbortController()
    let removed = 0
    const signal: LookupSignal = {
      get aborted() {
        return controller.signal.aborted
      },
      get reason(): unknown {
        return controller.signal.reason
      },
      addEventListener: (type, listener, options) => controller.signal.addEventListener(type, listener, options),
      removeEventListener: (type, listener) => {
        controller.signal.removeEventListener(type, listener)
        removed += 1
        if (removed === 1) controller.abort(new Error('closed between two groups'))
      },
    }
    const sent = hop.countSent(KEYS_TEXT)
    expect(await stopping(createSqlServerLookups(pool).resolve(config, tokens, EVERY_ROW, signal)).rejection).toBe(controller.signal.reason)
    expect(await operations.search(NOT_ABORTED)).toEqual(firstPage)
    expect(sent()).toBe(1)
  })
})
