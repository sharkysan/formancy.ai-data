import { buildLookupConfig, encodeKeyToken, generateForm } from '@formancy/data-core'
import type { LookupConfig, LookupQuery, LookupSignal, RowFilters } from '@formancy/data-core'
import type { BlockedTable, PostgresFixture, TcpHop } from '@formancy/data-fixtures'
import { blockTable, startPostgresFixture, startTcpHop } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { connectPostgres, createPostgresLookups, discoverPostgres } from './index.js'
import { runLookup } from './lookups/cancel.js'

/**
 * A lookup statement stops when its caller's signal aborts (0061), against
 * REAL PostgreSQL 17 behind the fixtures' TCP hop, which only forwards bytes
 * (0003).
 *
 * "Stopped" is read from the database, never from the promise: a statement
 * waits behind a lock `blockTable` holds, and is gone when pg_locks stops
 * counting it while the lock is still held. A rejected promise alone proves
 * only that the caller stopped listening; the database would finish every
 * scan it started.
 *
 * Every lookup client here is a pool of one, so the connection a cancel
 * touched is the one the next lookup gets, and a connection the driver lost
 * track of would hang the next lookup -- bounded by a deadline of its own, so
 * the case fails rather than the suite.
 */
let fixture: PostgresFixture
let owner: Sql
let hop: TcpHop
let config: LookupConfig
const clients: Sql[] = []
const blocks: BlockedTable[] = []
/** Held or refused new connections, released after a case that failed while holding them, so the next case's connections flow. */
const gates: Array<{ release(): void }> = []

const TENANT_ID = { kind: 'integer', min: '-2147483648', max: '2147483647' } as const
const TENANT_1: RowFilters = { kind: 'restricted', equal: [{ column: 'tenant_id', type: TENANT_ID, value: '1' }] }
const FIRST_PAGE: LookupQuery = { search: '', offset: 0, limit: 50 }
/**
 * What only a search's statement says, in the Parse message that carries its
 * text: once per run. The search's own value is bound later, in a message
 * PostgreSQL reads only after the statement has been parsed -- which is where
 * a lookup waits for a lock, so the value would count nothing here.
 */
const SEARCHES = 'pg_catalog.like_escape('
const CUSTOMER = { schema: 'sales', name: 'customer' } as const

/** Nobody aborts this signal: the lookups that must complete, and answer as they did before the port carried one. */
const NEVER = new AbortController().signal
/** How long a lookup that should answer may take before the case fails instead of hanging: far past a loopback answer. */
const ANSWERS_WITHIN = 10_000

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  const target = new URL(fixture.admin)
  hop = await startTcpHop({ kind: 'postgres', host: target.hostname, port: Number(target.port) })
  const sales = await discoverPostgres(owner, { schemas: ['sales'] })
  const { bindings } = generateForm(sales, { connection: 'test', root: { schema: 'sales', name: 'order' }, formId: 'limits', title: 'Limits', lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }] })
  const field = bindings.fields.find((candidate) => candidate.kind === 'lookup')
  if (field === undefined) throw new Error('the generator made no customer lookup')
  config = buildLookupConfig(bindings, field.field, { snapshot: sales })
})

afterEach(async () => {
  hop.delayAnswers(0)
  for (const gate of gates.splice(0)) gate.release()
  await Promise.all(blocks.splice(0).map((blocked) => blocked.release()))
  // Bounded, as records-lost-answer's are: postgres.js 3.4.9's end() with no
  // timeout waits forever for a statement it lost track of.
  await Promise.all(clients.splice(0).map((client) => client.end({ timeout: 1 })))
  // A sleep a failed case never stopped would sleep on after its client
  // went: PostgreSQL notices a gone client only when it next sends.
  await owner`select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name like 'limits-%'`
})

afterAll(async () => {
  await owner?.end()
  await hop?.close()
  await fixture?.stop()
})

const parts = () => {
  const url = new URL(fixture.admin)
  return { database: url.pathname.slice(1), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
}

/** A lookups client of one connection through the hop, named so pg_stat_activity finds its backend. */
function lookupClient(application: string): Sql {
  const { database, user, password } = parts()
  const client = postgres({ host: '127.0.0.1', port: hop.port, database, username: user, password, max: 1, onnotice: () => {}, connection: { application_name: application } })
  clients.push(client)
  return client
}

function hold(): { release(): void } {
  const gate = hop.holdNewConnections()
  gates.push(gate)
  return gate
}

async function block(): Promise<BlockedTable> {
  const blocked = await blockTable({ kind: 'postgres', admin: fixture.admin }, CUSTOMER)
  blocks.push(blocked)
  return blocked
}

async function release(blocked: BlockedTable): Promise<void> {
  blocks.splice(blocks.indexOf(blocked), 1)
  await blocked.release()
}

/** Polls until `condition` holds, or fails naming what never happened. */
async function until(condition: () => Promise<boolean>, what: string, ms = ANSWERS_WITHIN): Promise<void> {
  const deadline = Date.now() + ms
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function tokenOf(...key: string[]): string {
  const encoded = encodeKeyToken(key)
  if (!encoded.ok) throw new Error(encoded.message)
  return encoded.token
}

/** What a rejected promise rejected with. */
const failure = (pending: Promise<unknown>): Promise<unknown> => pending.then(
  () => {
    throw new Error('the lookup answered')
  },
  (error: unknown) => error,
)

/** The backend `application` holds, as pg_stat_activity sees it from another connection. */
async function backendOf(application: string): Promise<{ pid: number; state: string } | undefined> {
  const [row] = await owner<Array<{ pid: number; state: string }>>`select pid, state from pg_catalog.pg_stat_activity where application_name = ${application}`
  return row
}

/**
 * A statement that runs long in its execute, not in its parse: a sleep, with
 * a parameter so postgres.js has PostgreSQL describe it first, as it does
 * every lookup. Named by its column, so pg_stat_activity tells it apart.
 */
const sleeping = (name: string) => ({ text: `select pg_catalog.pg_sleep($1::pg_catalog.text::pg_catalog.float8) as ${name}`, params: ['30'] })

/**
 * A statement that sends tenant 2's customers, key and name as a search
 * reads them, and then sleeps in its execute: a lookup stopped part-way
 * through its answer. Appended after the rows, so PostgreSQL has put them in
 * its answer before it sleeps; a cancel then ends the statement with an
 * error after them. Named by its column, so pg_stat_activity tells it apart.
 */
const PART_WAY = {
  text: `select r.tenant_id::pg_catalog.text, r.customer_no::pg_catalog.text, r.name::pg_catalog.text as limits_part_way
    from sales.customer as r where r.tenant_id = $1::pg_catalog.text::pg_catalog.int4
    union all select null, null, pg_catalog.pg_sleep(30)::pg_catalog.text`,
  params: ['2'],
}

/** Whether the backend `application` holds is inside a pg_sleep: past its parse, its describe and the start of its execute. */
async function asleep(application: string): Promise<boolean> {
  const [row] = await owner<Array<{ wait_event: string | null }>>`select wait_event from pg_catalog.pg_stat_activity where application_name = ${application}`
  return row?.wait_event === 'PgSleep'
}

/**
 * Whether the backend `application` holds has finished the sleep named
 * `name`: idle, with that statement as its last. Before the sleep is parsed
 * the last statement is another; while it sleeps it is active; and from its
 * parse until its execute arrives it is active too, since PostgreSQL reports
 * idle only once a statement's Sync is done.
 */
async function finished(application: string, name: string): Promise<boolean> {
  const [row] = await owner<Array<{ state: string; query: string }>>`select state, query from pg_catalog.pg_stat_activity where application_name = ${application}`
  return row?.state === 'idle' && row.query.includes(name)
}

type Operation = 'search' | 'resolve' | 'rejects'
const OPERATIONS: readonly Operation[] = ['search', 'resolve', 'rejects']

function ask(sql: Sql, operation: Operation, signal: LookupSignal): Promise<unknown> {
  const lookups = createPostgresLookups(sql)
  const muster = tokenOf('1', '1001')
  if (operation === 'search') return lookups.search(config, FIRST_PAGE, TENANT_1, signal)
  if (operation === 'resolve') return lookups.resolve(config, [muster], TENANT_1, signal)
  return lookups.rejects(config, [muster, tokenOf('2', '1001')], TENANT_1, signal)
}

describe('an aborted lookup is stopped in the database', () => {
  // An abort that only rejected the promise would leave the statement waiting
  // in the database until the lock went, and then scanning for nobody: what
  // docs/performance.md measured as "the database finishes every scan it
  // started". The answer after it, on the same backend, shows the cancel cost
  // no connection and left no setting behind.
  test.each(OPERATIONS)('a %s waiting on a lock stops waiting before the lock is released, and the next lookup on its connection answers', async (operation) => {
    const application = `limits-abort-${operation}`
    const sql = lookupClient(application)
    const expected = await ask(sql, operation, NEVER)
    const before = await backendOf(application)
    const blocked = await block()
    const controller = new AbortController()
    const pending = failure(ask(sql, operation, controller.signal))
    await until(async () => (await blocked.waiting()) === 1, `the ${operation} waited behind the lock`)
    const reason = new Error('the person typed on')
    controller.abort(reason)
    expect(await pending).toBe(reason)
    await until(async () => (await blocked.waiting()) === 0, `the ${operation} stopped waiting while the lock was held`)
    await release(blocked)
    expect(await ask(sql, operation, AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
    expect((await backendOf(application))?.pid).toBe(before?.pid)
    const [setting] = await sql<Array<{ timeout: string }>>`select current_setting('statement_timeout') as timeout`
    expect(setting?.timeout).toBe('0')
  })

  // The server tells a deadline from a database failure by `error ===
  // signal.reason`. Translated into the driver's 57014, a deadline would be
  // answered `unavailable`, which invites the retry that reads the same rows
  // again, instead of `lookup-timeout`.
  test("a deadline rejects with the signal's own TimeoutError, and the statement is gone", async () => {
    const sql = lookupClient('limits-deadline')
    await ask(sql, 'search', NEVER)
    const blocked = await block()
    const signal = AbortSignal.timeout(200)
    const error = await failure(ask(sql, 'search', signal))
    expect(error).toBe(signal.reason)
    expect(error).toMatchObject({ name: 'TimeoutError' })
    await until(async () => (await blocked.waiting()) === 0, 'the timed-out search stopped waiting while the lock was held')
  })
})

describe('an abort the driver could not yet act on', () => {
  // Sending a statement for a request already gone is the work 0061 removes.
  // The search before it, two round trips, shows the hop counts this client:
  // a limit that added a SET or a transaction to every lookup would show here
  // as more than two.
  test('an already-aborted signal sends nothing at all', async () => {
    const sql = lookupClient('limits-already')
    await ask(sql, 'search', NEVER)
    for (const operation of OPERATIONS) {
      const trips = hop.countRoundTrips()
      const controller = new AbortController()
      const reason = new Error('gone before it was asked')
      controller.abort(reason)
      expect(await failure(ask(sql, operation, controller.signal))).toBe(reason)
      expect(trips(), operation).toBe(0)
    }
    const trips = hop.countRoundTrips()
    await ask(sql, 'search', NEVER)
    expect(trips()).toBe(2)
  })

  // A resolve or a membership check with no token worth looking up sends
  // nothing anyway; it still owes a caller already gone the reason, not an
  // answer, or the server would read an empty list as what the database
  // said. The SQL Server adapter's suite holds the same case.
  test('an already aborted resolve or rejects with nothing to look up still rejects with the reason', async () => {
    const lookups = createPostgresLookups(lookupClient('limits-no-key'))
    const controller = new AbortController()
    controller.abort(new Error('gone before it was asked'))
    expect(await failure(lookups.resolve(config, ['not a token'], TENANT_1, controller.signal))).toBe(controller.signal.reason)
    expect(await failure(lookups.rejects(config, ['not a token'], TENANT_1, controller.signal))).toBe(controller.signal.reason)
  })

  // postgres.js sends a query when it is first awaited, one microtask later.
  // A cancel before that marks it cancelled, and the connection it is then
  // handed to never comes back: in the 2026-10-14 probe the next query on a
  // pool of one never answered.
  test('an abort in the same tick as the call leaves the connection usable', async () => {
    const sql = lookupClient('limits-same-tick')
    const expected = await ask(sql, 'search', NEVER)
    const controller = new AbortController()
    const pending = failure(ask(sql, 'search', controller.signal))
    const reason = new Error('aborted at once')
    controller.abort(reason)
    expect(await pending).toBe(reason)
    expect(await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
  })

  // A pool opens a connection with the first query it is handed. A cancel
  // while that connection is still being opened -- a deadline that passes
  // while the server is slow to accept one -- must not cost the pool that
  // connection, or a pool that loses one per such abort serves nobody.
  test('an abort while the connection is being opened leaves the pool usable', async () => {
    const sql = lookupClient('limits-connecting')
    const gate = hold()
    const controller = new AbortController()
    const pending = failure(ask(sql, 'search', controller.signal))
    const reason = new Error('aborted while connecting')
    // Long enough for the pool to have handed the query to the connection it opens.
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort(reason)
    expect(await pending).toBe(reason)
    gate.release()
    const page = await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))
    expect(page).toEqual(await ask(lookupClient('limits-connecting-reference'), 'search', NEVER))
  })

  // A lookup waiting for a pooled connection cannot be told by anything
  // public from one a connection is being opened for, so it is cancelled the
  // moment it is sent. Here its connection is freed while the lock is still
  // held, so a statement that was sent and not stopped would wait in the
  // database for as long as the lock: counted once by its text, which the
  // first page's statement does not hold, and never again.
  test('an abort while queued for a connection stops the statement once it is sent, and the queue moves on', async () => {
    const sql = lookupClient('limits-queued')
    const expected = await ask(sql, 'search', NEVER)
    const blocked = await block()
    const ahead = new AbortController()
    const first = failure(ask(sql, 'search', ahead.signal))
    await until(async () => (await blocked.waiting()) === 1, 'the first search held the one connection')
    const sent = hop.countSent(Buffer.from(SEARCHES))
    const controller = new AbortController()
    const queued = failure(createPostgresLookups(sql).search(config, { search: 'Muster', offset: 0, limit: 50 }, TENANT_1, controller.signal))
    await new Promise((resolve) => setImmediate(resolve))
    const reason = new Error('left the queue')
    controller.abort(reason)
    expect(await queued).toBe(reason)
    expect(sent()).toBe(0)
    ahead.abort(new Error('the first one left too'))
    await first
    await until(async () => sent() === 1, 'the queued search was handed the freed connection')
    await until(async () => (await blocked.waiting()) === 0, 'the queued search stopped waiting while the lock was held')
    await release(blocked)
    expect(await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
    expect(sent()).toBe(1)
  })
})

describe('a cancel that arrives late', () => {
  // PostgreSQL takes a cancel request on a connection of its own and stops
  // whatever the backend runs when it arrives. Held at the hop until the
  // next lookup waits on the same backend, it is made to land late on
  // purpose. Without the one retry, another person's search fails because
  // someone else typed.
  test("stops the next lookup on the backend, which runs once more and answers its page", async () => {
    const application = 'limits-late-cancel'
    const sql = lookupClient(application)
    await ask(sql, 'search', NEVER)
    const muster: LookupQuery = { search: 'Muster', offset: 0, limit: 50 }
    const expected = await createPostgresLookups(sql).search(config, muster, TENANT_1, NEVER)

    const first = await block()
    const controller = new AbortController()
    const abandoned = failure(ask(sql, 'search', controller.signal))
    await until(async () => (await first.waiting()) === 1, 'the first search waited behind the lock')
    const gate = hold()
    const reason = new Error('typed on')
    controller.abort(reason)
    expect(await abandoned).toBe(reason)
    await release(first)
    await until(async () => (await backendOf(application))?.state === 'idle', 'the first search finished, its cancel still held')

    const second = await block()
    const sent = hop.countSent(Buffer.from(SEARCHES))
    let refused: unknown
    const pending = createPostgresLookups(sql)
      .search(config, muster, TENANT_1, NEVER)
      .catch((error: unknown) => {
        refused = error
      })
    await until(async () => (await second.waiting()) === 1, 'the second search waited on the same backend')
    gate.release()
    await until(async () => sent() === 2 || refused !== undefined, 'the second search was stopped by the late cancel and sent again')
    expect(refused).toBeUndefined()
    await until(async () => (await second.waiting()) === 1, 'the second search waited again')
    await release(second)
    expect(await pending).toEqual(expected)
  })
})

describe('a connection that goes while a lookup runs on it', () => {
  // A lookup whose connection is lost must fail as the driver reports it and
  // cost the pool nothing: a design that gave a connection back by hand
  // after it closed put it in the pool again with no socket, and the next
  // lookup handed it threw from a timer, outside any promise, which ends the
  // server's process (2026-10-14, a reserved connection released after the
  // cut; the same TypeError the design probe saw after pg_terminate_backend
  // and release). Cut by the hop, so the server never says why.
  test("rejects with the driver's error, and the next lookup opens a connection and answers", async () => {
    const sql = lookupClient('limits-cut')
    const expected = await ask(sql, 'search', NEVER)
    const blocked = await block()
    const pending = failure(ask(sql, 'search', NEVER))
    await until(async () => (await blocked.waiting()) === 1, 'the search waited behind the lock')
    hop.cut()
    expect(await pending).toMatchObject({ code: 'CONNECTION_CLOSED' })
    await release(blocked)
    expect(await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
    expect(await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
  })

  // An operator's pg_terminate_backend: the server says FATAL and closes.
  // Characterised, because the driver does something no lookup decides:
  // postgres.js 3.4.9 reports the running statement as CONNECTION_CLOSED, as
  // no ReadyForQuery follows the FATAL, and keeps the FATAL, which it then
  // gives -- unsent -- to the first statement on the connection it opens
  // next. That lookup is refused, a record statement would be too, and the
  // pool lives on. A driver that stops doing it fails here by name.
  test('ended by the server, rejects as closed, hands its FATAL to the next statement, and the one after answers', async () => {
    const application = 'limits-terminated'
    const sql = lookupClient(application)
    const expected = await ask(sql, 'search', NEVER)
    const blocked = await block()
    const pending = failure(ask(sql, 'search', NEVER))
    await until(async () => (await blocked.waiting()) === 1, 'the search waited behind the lock')
    const backend = await backendOf(application)
    await owner`select pg_catalog.pg_terminate_backend(${backend?.pid ?? 0})`
    expect(await pending).toMatchObject({ code: 'CONNECTION_CLOSED' })
    await release(blocked)
    const searches = hop.countSent(Buffer.from('from "sales"."customer"'))
    expect(await failure(ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN)))).toMatchObject({ code: '57P01', severity: 'FATAL' })
    expect(searches()).toBe(0)
    expect(await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
  })
})

describe('an abort before PostgreSQL has described the statement', () => {
  // postgres.js has PostgreSQL parse and describe a statement with
  // parameters before it sends them and the execute: a round trip in which,
  // once the parse is done, the backend waits for the client. PostgreSQL
  // drops a cancel that arrives then. Every answer is held 100 ms at the hop,
  // as a long network path would, so a cancel sent the moment the statement
  // was sent -- a few milliseconds to open its connection, here -- arrives in
  // that wait, and the sleep it was meant to stop starts after it and runs
  // its 30 s. With answers held 20 ms the first-round-trip case once passed
  // without the second cancel: an abort noticed late in the wait sent a
  // cancel that arrived after the execute. A lookup aborted while it queued for a connection, in
  // the same tick as the call, or during that first round trip would scan on
  // for nobody, holding the connection: the load a deadline is meant to shed.
  // Each sleeps longer than the case waits, so a lost cancel fails the case.
  test('an abort while queued for a connection stops the statement once its execute is sent', async () => {
    const application = 'limits-queued-latency'
    const sql = lookupClient(application)
    await ask(sql, 'search', NEVER)
    hop.delayAnswers(100)
    const ahead = new AbortController()
    const first = failure(runLookup(sql, sleeping('limits_ahead'), ahead.signal))
    await until(async () => (await backendOf(application))?.state === 'active', 'the first sleep held the one connection')
    const controller = new AbortController()
    const queued = failure(runLookup(sql, sleeping('limits_queued'), controller.signal))
    await new Promise((resolve) => setImmediate(resolve))
    const reason = new Error('left the queue')
    controller.abort(reason)
    expect(await queued).toBe(reason)
    ahead.abort(new Error('the first one left too'))
    await first
    await until(() => finished(application, 'limits_queued'), 'the queued sleep was sent and stopped')
    expect(await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(await ask(lookupClient('limits-queued-reference'), 'search', NEVER))
  })

  test('an abort in the same tick as the call stops the statement once its execute is sent', async () => {
    const application = 'limits-same-tick-latency'
    const sql = lookupClient(application)
    const expected = await ask(sql, 'search', NEVER)
    hop.delayAnswers(100)
    const controller = new AbortController()
    const pending = failure(runLookup(sql, sleeping('limits_same_tick'), controller.signal))
    const reason = new Error('aborted at once')
    controller.abort(reason)
    expect(await pending).toBe(reason)
    await until(() => finished(application, 'limits_same_tick'), 'the sleep was sent and stopped')
    expect(await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
  })

  test('an abort during the first round trip stops the statement once its execute is sent', async () => {
    const application = 'limits-first-trip-latency'
    const sql = lookupClient(application)
    const expected = await ask(sql, 'search', NEVER)
    hop.delayAnswers(100)
    const sent = hop.countSent(Buffer.from('limits_first_trip'))
    const controller = new AbortController()
    const pending = failure(runLookup(sql, sleeping('limits_first_trip'), controller.signal))
    await until(async () => sent() === 1, 'the statement was sent')
    const reason = new Error('typed on')
    controller.abort(reason)
    expect(await pending).toBe(reason)
    await until(() => finished(application, 'limits_first_trip'), 'the sleep was stopped')
    expect(await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
  })
})

describe('a lookup stopped part-way through its answer', () => {
  // postgres.js 3.4.9 numbers the rows of a statement on its connection and
  // starts again from 0 only when a statement completes. One stopped after
  // some of its rows were sent left the count where it stopped, and the next
  // statement's rows were placed after that many empty slots (0078). A
  // search and a resolve read them as rows and threw a TypeError; a rejects
  // read them as no key and answered rightly. CI's "same tick" case met it
  // on 2026-10-17, and a probe the same day 6 and 7 times in 1,000 same-tick
  // aborts on PostgreSQL 17 and 18 (porsager/postgres#1253). The slots held
  // nothing: the next statement's own rows followed them. Here the stopped
  // statement has sent tenant 2's customer when its cancel lands, and the
  // next lookup, under tenant 1's filter, must answer as it would have --
  // no TypeError, and none of tenant 2's rows.
  test.each(OPERATIONS)("the next lookup on its connection, a %s, answers as it would have, and nothing of the stopped one's", async (operation) => {
    const application = `limits-part-way-${operation}`
    const sql = lookupClient(application)
    const expected = await ask(sql, operation, NEVER)
    const controller = new AbortController()
    const pending = failure(runLookup(sql, PART_WAY, controller.signal))
    await until(() => asleep(application), 'the statement sent its rows and slept')
    const reason = new Error('typed on')
    controller.abort(reason)
    expect(await pending).toBe(reason)
    await until(() => finished(application, 'limits_part_way'), 'the statement was stopped')
    expect(await ask(sql, operation, AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
  })
})

describe('a cancel request that cannot be delivered', () => {
  // postgres.js opens a connection for each cancel request and reports its
  // failure on a promise of its own. Left unhandled, Node ends the process:
  // the whole server, and with it every write in flight on either engine,
  // its outcome unknown (2026-10-15 review, reproduced with a database that
  // stopped accepting connections while its open one still answered, which
  // is when a deadline fires). A cancel that fails stops nothing, so the
  // lookup still rejects with its reason, the statement finishes as it would
  // have, and the pool answers the next lookup.
  test('a refused cancel is no unhandled rejection; the lookup rejects with its reason and the pool lives on', async () => {
    const unhandled: unknown[] = []
    const heard = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', heard)
    try {
      const sql = lookupClient('limits-cancel-refused')
      const expected = await ask(sql, 'search', NEVER)
      const blocked = await block()
      const controller = new AbortController()
      const pending = failure(ask(sql, 'search', controller.signal))
      await until(async () => (await blocked.waiting()) === 1, 'the search waited behind the lock')
      const refusal = hop.refuseNewConnections()
      gates.push(refusal)
      const reason = new Error('typed on while the database stopped accepting')
      controller.abort(reason)
      expect(await pending).toBe(reason)
      await until(async () => refusal.refused() === 1, 'the cancel request was refused')
      expect(await blocked.waiting()).toBe(1)
      await release(blocked)
      // The abandoned search finishes first on the one connection; this one
      // answers after it, several round trips after the refused cancel's
      // reset reached the driver, by when Node has reported any rejection
      // nobody handled.
      expect(await ask(sql, 'search', AbortSignal.timeout(ANSWERS_WITHIN))).toEqual(expected)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', heard)
    }
  })
})

describe('connectPostgres', () => {
  // The server opens the lookups' client with a name of its own, so a DBA
  // tells it from the records' in pg_stat_activity, and its suite finds a
  // lookup there. A name dropped on the way would leave both clients looking
  // alike; a default invented here would rename a client nobody asked to.
  test('names the client only when told to', async () => {
    const url = new URL(fixture.admin)
    const options = { host: url.hostname, port: Number(url.port), ...parts(), tls: { enabled: false, rejectUnauthorized: true } }
    const named = connectPostgres({ ...options, applicationName: 'formancy-data lookups' })
    const plain = connectPostgres(options)
    const driver = postgres(fixture.admin, { onnotice: () => {} })
    clients.push(named, plain, driver)
    const nameOf = async (sql: Sql) => (await sql<Array<{ name: string }>>`select current_setting('application_name') as name`)[0]?.name
    expect(await nameOf(named)).toBe('formancy-data lookups')
    expect(await nameOf(plain)).toBe(await nameOf(driver))
  })
})
