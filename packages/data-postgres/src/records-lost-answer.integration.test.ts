import { findObject } from '@formancy/data-core'
import type { ApiValue, MetadataSnapshot, RecordColumn, RecordFailure, RecordOutcome, RecordTarget, RecordValue, RowFilters } from '@formancy/data-core'
import type { PostgresFixture, TcpHop } from '@formancy/data-fixtures'
import { answerBytes, defined, startPostgresFixture, startTcpHop } from '@formancy/data-fixtures'
import { randomUUID } from 'node:crypto'
import v8 from 'node:v8'
import vm from 'node:vm'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/**
 * Writes whose answer is lost after PostgreSQL committed them (0031), against
 * REAL PostgreSQL through a TCP hop from `@formancy/data-fixtures`. Every byte
 * that crosses the hop is postgres.js's and the server's own; only the
 * network fails, so this is not a mocked driver (0003).
 *
 * The hop watches the server's answers for a marker the write's RETURNING row
 * echoes, and from the read in which it completes drops everything the server
 * sends on that connection. A matched marker is not proof of a commit — the
 * deferred-constraint case below is PostgreSQL sending the row and then
 * refusing the commit — so every case polls a connection of its own until the
 * write is visible before it cuts.
 *
 * Not repeated here: a backend terminated while the write waits. The parity
 * suite (`parity.integration.test.ts`) terminates one mid-write and sees
 * CONNECTION_CLOSED and `unknown-outcome`, with nothing stored; terminating
 * one that waits on a lock was measured to answer the same.
 */
let fixture: PostgresFixture
let owner: Sql
let snapshot: MetadataSnapshot
let hop: TcpHop
let viaHop: Sql

const TENANT_1: RowFilters = { kind: 'restricted', equal: [{ column: 'tenant_id', type: { kind: 'integer', min: '-2147483648', max: '2147483647' }, value: '1' }] }
const ORDER_ID: RecordColumn = { name: 'id', type: { kind: 'integer', min: '-9223372036854775808', max: '9223372036854775807' } }
const ORDER = {
  table: { schema: 'sales', name: 'order' },
  identity: [ORDER_ID],
  concurrency: { kind: 'version-column', column: 'row_version' },
} as const satisfies RecordTarget

/** How long a marker may take to appear in an answer, and a write to become visible. Generous: a loaded CI runner, not a measurement. */
const PATIENCE_MS = 10_000

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  // A unique constraint checked at commit, not per row: the insert's row is
  // sent back, and only then does the commit fail.
  await owner.unsafe(`
    create schema lost;
    create table lost.deferred (
      id integer generated always as identity primary key,
      code text not null,
      note text,
      constraint uq_deferred_code unique (code) deferrable initially deferred
    );
  `)
  snapshot = await discoverPostgres(owner, { schemas: ['sales', 'lost'] })
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

beforeEach(async () => {
  const target = new URL(fixture.admin)
  hop = await startTcpHop({ host: target.hostname, port: Number(target.port) })
  // One connection, so the write and anything after it share the one the hop watches.
  viaHop = postgres({ ...connectionOf(fixture.admin), host: '127.0.0.1', port: hop.port, max: 1, onnotice: () => {} })
})

afterEach(async () => {
  // Bounded: postgres.js 3.4.9 keeps a statement that failed with its
  // connection as that connection's current one, and end() with no timeout
  // waits for it forever. The adapter's close() is bounded for the same reason.
  await viaHop.end({ timeout: 1 })
  await hop.close()
})

function col(schema: string, table: string, name: string): RecordColumn {
  const found = findObject(snapshot, { schema, name: table })?.columns.find((column) => column.name === name)
  if (found === undefined) throw new Error(`${schema}.${table} has no column ${name}`)
  return { name, type: found.type }
}

function orderValues(notes: string): RecordValue[] {
  return Object.entries({ tenant_id: '1', customer_no: '1001', order_date: '2026-10-09', amount: '1.0000', notes } satisfies Record<string, ApiValue>).map(([name, value]) => ({
    ...col('sales', 'order', name),
    value,
  }))
}

function failed(outcome: RecordOutcome): RecordFailure {
  if (outcome.ok) throw new Error(`expected a failure, got ${JSON.stringify(outcome)}`)
  return outcome
}

/** A text no other test sends: what the hop matches, and what the owner counts. */
function marker(what: string): string {
  return `${what} ${randomUUID()}`
}

/** `promise`, or a rejection saying `what` never happened. Unarmed once it settles. */
async function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(what)), PATIENCE_MS)))
  try {
    return await Promise.race([promise, late])
  } finally {
    clearTimeout(timer)
  }
}

/** Polls `read` on the owner's own connection until it returns `expected`; the commit is the server's, on its schedule. */
async function until<T>(read: () => Promise<T>, expected: T): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  for (;;) {
    const seen = await read()
    if (JSON.stringify(seen) === JSON.stringify(expected)) return
    if (Date.now() > deadline) throw new Error(`still ${JSON.stringify(seen)}, never ${JSON.stringify(expected)}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function ordersNoted(notes: string): Promise<number> {
  const [row] = await owner<{ n: number }[]>`select count(*)::int as n from sales."order" where notes = ${notes}`
  return row?.n ?? 0
}

async function codesTaken(code: string): Promise<number> {
  const [row] = await owner<{ n: number }[]>`select count(*)::int as n from lost.deferred where code = ${code}`
  return row?.n ?? 0
}

function connectionOf(uri: string): { username: string; password: string; database: string } {
  const url = new URL(uri)
  return { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) }
}

describe('an answer lost after the write committed', () => {
  // Gate 6 at the adapter: the insert committed, its answer never arrived.
  // `unavailable` would tell the person nothing was saved and invite a second
  // order; this is unknown-outcome, the driver sent the insert exactly once,
  // and exactly one order exists. Without CONNECTION_CLOSED in the adapter's
  // in-flight codes the cut would be thrown as a programming error instead.
  test('an insert is unknown-outcome, was sent once, and exactly one row exists', async () => {
    const notes = marker('inserted, answer lost')
    const bytes = answerBytes('postgres', notes)
    const sent = hop.countSent(bytes)
    const lost = hop.swallowAnswersFrom(bytes)
    const pending = defined(createPostgresRecords(viaHop)).insert({ target: ORDER, values: orderValues(notes), returning: [ORDER_ID, col('sales', 'order', 'notes')] })

    await within(lost.matched, 'the marker never appeared in an answer')
    await until(() => ordersNoted(notes), 1)
    lost.cut()

    const outcome = failed(await pending)
    expect([outcome.code, outcome.message]).toEqual(['unknown-outcome', expect.stringMatching(/CONNECTION_CLOSED/)])
    expect(sent()).toBe(1)
    expect(await ordersNoted(notes)).toBe(1)
  })

  // An update carries its expected version, so a second attempt is harmless —
  // but only if the first moved it exactly once. The change is stored, the
  // version is the one sent plus one, and the adapter answered unknown, not
  // stale or unavailable.
  test('an update is unknown-outcome, its change is stored, and its version moved exactly once', async () => {
    const created = await defined(createPostgresRecords(owner)).insert({ target: ORDER, values: orderValues(marker('before the update')), returning: [ORDER_ID] })
    if (!created.ok) throw new Error(created.message)
    const id = String(created.values.id)
    const version = String(created.version)
    const notes = marker('updated, answer lost')
    const bytes = answerBytes('postgres', notes)
    const sent = hop.countSent(bytes)
    const lost = hop.swallowAnswersFrom(bytes)
    const pending = defined(createPostgresRecords(viaHop)).update({
      target: ORDER,
      key: [{ ...ORDER_ID, value: id }],
      set: [{ ...col('sales', 'order', 'notes'), value: notes }],
      expectedVersion: version,
      filters: TENANT_1, through: [],
      returning: [col('sales', 'order', 'notes')],
    })
    const stored = async (): Promise<unknown> => [...(await owner`select notes, row_version::text as version from sales."order" where id = ${id}`)]
    const after = [{ notes, version: String(BigInt(version) + 1n) }]

    await within(lost.matched, 'the marker never appeared in an answer')
    await until(stored, after)
    lost.cut()

    const outcome = failed(await pending)
    expect([outcome.code, outcome.message]).toEqual(['unknown-outcome', expect.stringMatching(/CONNECTION_CLOSED/)])
    expect(sent()).toBe(1)
    expect(await stored()).toEqual(after)
  })
})

describe('a refusal that follows the row', () => {
  // A deferred unique constraint is checked at commit. PostgreSQL sends the
  // insert's row and its command tag first, then the refusal (measured:
  // `1 t T 2 D C E Z`). The adapter must answer the refusal, not the row: an
  // insert reported saved would be a record that does not exist. And 23505
  // must name unique-violation; without its entry it falls to class 23's
  // check-violation, which sends the person to look for the wrong rule.
  test('a deferred unique constraint refused at commit is unique-violation, and nothing is stored', async () => {
    const code = marker('taken')
    await owner`insert into lost.deferred (code) values (${code})`
    const target: RecordTarget = { table: { schema: 'lost', name: 'deferred' }, identity: [col('lost', 'deferred', 'id')], concurrency: null }
    const insert = { target, values: [{ ...col('lost', 'deferred', 'code'), value: code }], returning: [col('lost', 'deferred', 'code')] }

    const refused = failed(await defined(createPostgresRecords(viaHop)).insert(insert))
    expect(refused).toMatchObject({ code: 'unique-violation', constraint: 'uq_deferred_code' })
    expect(refused.message).toMatch(/23505/)
    expect(await codesTaken(code)).toBe(1)
  })

  // Why every case above polls before it cuts. The same insert's answer is
  // swallowed from the row it sends back — a `note` the refusal's detail
  // never quotes, so the match is the DataRow's and not the ErrorResponse's.
  // The marker matches, and nothing was committed, then or later. A hop test
  // that cut on the match alone would call a rolled-back insert proof of a
  // lost commit. The adapter, which never saw the refusal, can only say
  // unknown-outcome.
  test('a matched marker is not a commit: the row came back and nothing was stored', async () => {
    const code = marker('taken, answer lost')
    const note = marker('sent back, then refused')
    await owner`insert into lost.deferred (code) values (${code})`
    const target: RecordTarget = { table: { schema: 'lost', name: 'deferred' }, identity: [col('lost', 'deferred', 'id')], concurrency: null }
    const lost = hop.swallowAnswersFrom(answerBytes('postgres', note))
    const pending = defined(createPostgresRecords(viaHop)).insert({
      target,
      values: [
        { ...col('lost', 'deferred', 'code'), value: code },
        { ...col('lost', 'deferred', 'note'), value: note },
      ],
      returning: [col('lost', 'deferred', 'note')],
    })

    await within(lost.matched, 'the marker never appeared in an answer')
    // The refusal is sent before the transaction is marked aborted, but an
    // uncommitted row is invisible to another connection either way, and
    // this one can never commit: one row, the seed, now and later.
    expect(await codesTaken(code)).toBe(1)
    lost.cut()

    expect(failed(await pending).code).toBe('unknown-outcome')
    expect(await codesTaken(code)).toBe(1)
  })
})

describe('a timeout the server answers', () => {
  // statement_timeout ends the statement on the server, which answers 57014
  // and rolls back: nothing was written and the answer was not lost, so it
  // is unavailable — try again later — and not unknown-outcome. Without
  // class 57 among what passes, it would be `refused`, telling the person a
  // timeout will be refused again. The parity suite times out a statement
  // that runs; this one waits on a lock, which is how a timeout usually meets a write.
  test('a statement timed out while waiting on a lock is unavailable, and nothing is stored', async () => {
    const timed = postgres(fixture.admin, { max: 1, onnotice: () => {}, connection: { statement_timeout: 500 } })
    const notes = marker('timed out waiting')
    try {
      const held = await owner.begin(async (tx) => {
        await tx`lock table sales."order" in share mode`
        const outcome = await defined(createPostgresRecords(timed)).insert({ target: ORDER, values: orderValues(notes), returning: [ORDER_ID] })
        return { outcome }
      })
      const outcome = failed(held.outcome)
      expect([outcome.code, outcome.message]).toEqual(['unavailable', expect.stringMatching(/57014/)])
      expect(await ordersNoted(notes)).toBe(0)
    } finally {
      await timed.end()
    }
  })
})

describe('the lock-first path, under a default isolation other than READ COMMITTED (0041)', () => {
  // A write decided over a REPEATABLE READ description runs in a transaction
  // that locks the table first, through `sql.begin`. On a reserved
  // connection instead, postgres.js 3.4.9 never answered a statement once
  // its backend was gone and then threw outside any promise, ending the
  // process (measured before 0041). Here the update's answer is lost before
  // its commit was sent: the server rolls the transaction back when the
  // connection goes, so this over-reports, but it is unknown-outcome as any
  // write sent and not answered is, and the same driver answers afterwards.
  test('an update whose answer is lost is unknown-outcome, and the driver answers the next request', async () => {
    const repeatable = postgres({ ...connectionOf(fixture.admin), host: '127.0.0.1', port: hop.port, max: 1, onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read' } })
    try {
      const records = createPostgresRecords(repeatable)
      const created = await defined(createPostgresRecords(owner)).insert({ target: ORDER, values: orderValues(marker('before the locked update')), returning: [ORDER_ID] })
      if (!created.ok) throw new Error(created.message)
      const key = [{ ...ORDER_ID, value: String(created.values.id) }]
      const read = await records.read({ target: ORDER, key, columns: [ORDER_ID], filters: TENANT_1, through: [] })
      if (!read.ok || read.record === null) throw new Error('the order was not read')
      expect(read.described.definition).toMatch(/@repeatable read$/)
      const notes = marker('locked update, answer lost')
      const lost = hop.swallowAnswersFrom(answerBytes('postgres', notes))
      const pending = records.update({ target: ORDER, key, set: [{ ...col('sales', 'order', 'notes'), value: notes }], expectedVersion: read.record.version as string, filters: TENANT_1, through: [], returning: [col('sales', 'order', 'notes')], definition: read.described.definition })
      await within(lost.matched, 'the marker never appeared in an answer')
      lost.cut()
      expect(failed(await within(pending, 'the update never answered'))).toMatchObject({ code: 'unknown-outcome', message: expect.stringMatching(/CONNECTION_CLOSED/) })
      expect(await within(records.read({ target: ORDER, key, columns: [ORDER_ID], filters: TENANT_1, through: [] }), 'the driver never answered again')).toMatchObject({ ok: true })
    } finally {
      await repeatable.end({ timeout: 1 })
    }
  })

  // Cut while it waits for the table's lock, the write was never sent:
  // unavailable, nothing written, and the driver answers again.
  test('a write whose connection is lost while it waits for the lock is unavailable, and nothing is written', async () => {
    const server = new URL(fixture.admin)
    const repeatable = postgres({ ...connectionOf(fixture.admin), host: server.hostname, port: Number(server.port), max: 1, onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read', application_name: 'locked-and-cut' } })
    try {
      const records = createPostgresRecords(repeatable)
      const described = await records.describe(ORDER.table)
      if (!described.ok) throw new Error(described.message)
      const notes = marker('never sent')
      let release = (): void => {}
      let locked = (): void => {}
      const holding = owner.begin(async (tx) => {
        await tx.unsafe('lock table sales."order" in access exclusive mode')
        locked()
        await new Promise<void>((resolve) => (release = resolve))
      })
      await new Promise<void>((resolve) => (locked = resolve))
      const pending = records.insert({ target: ORDER, values: orderValues(notes), returning: [], definition: described.described.definition })
      await until(async () => [...(await owner`select count(*)::int as n from pg_catalog.pg_stat_activity where application_name = 'locked-and-cut' and wait_event_type = 'Lock'`)][0]?.n, 1)
      await owner`select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name = 'locked-and-cut'`
      expect(failed(await within(pending, 'the insert never answered'))).toMatchObject({ code: 'unavailable', message: expect.stringMatching(/CONNECTION_CLOSED/) })
      release()
      await holding
      expect(await ordersNoted(notes)).toBe(0)
      // The server's own word for the termination, 57P01, reaches the next
      // statement on that connection, which is unavailable; the one after
      // reconnects. Neither waits forever, as both did before.
      const next = await within(records.describe(ORDER.table), 'the driver never answered again')
      expect(next.ok ? 'answered' : next.code).toMatch(/^(answered|unavailable)$/)
      expect(await within(records.describe(ORDER.table), 'the driver never answered a second time')).toMatchObject({ ok: true })
    } finally {
      await repeatable.end({ timeout: 1 })
    }
  })

  // A step kept from settling once its connection is lost keeps its
  // transaction's frame -- the statement, and the values a person wrote --
  // for as long as anything reachable holds the promise it waits on. One
  // promise shared by every lost step is held by the module, so every lost
  // transaction's values were kept for the life of the process: measured
  // (2026-10-10), 64 MB still held after four lost writes of 16 MB each and
  // two collections, and 0.3 MB with a promise of its own for each step.
  test('what a write lost while it waits for the lock held is collected, while its driver lives on', async () => {
    v8.setFlagsFromString('--expose-gc')
    const collect = vm.runInNewContext('gc') as () => void
    // A large string made from a buffer is external to V8's heap, so both are counted.
    const heap = (): number => {
      collect()
      collect()
      const used = process.memoryUsage()
      return used.heapUsed + used.external
    }
    const server = new URL(fixture.admin)
    const repeatable = postgres({ ...connectionOf(fixture.admin), host: server.hostname, port: Number(server.port), max: 1, onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read', application_name: 'locked-and-kept' } })
    const LOST = 4
    const SIZE = 16 * 1024 * 1024
    try {
      const records = createPostgresRecords(repeatable)
      const described = await records.describe(ORDER.table)
      if (!described.ok) throw new Error(described.message)
      const before = heap()
      for (let lost = 0; lost < LOST; lost += 1) {
        let release = (): void => {}
        let locked = (): void => {}
        const holding = owner.begin(async (tx) => {
          await tx.unsafe('lock table sales."order" in access exclusive mode')
          locked()
          await new Promise<void>((resolve) => (release = resolve))
        })
        await new Promise<void>((resolve) => (locked = resolve))
        // A value of its own each time, never sent: the lock is all the server
        // hears of this write. Flat, as a typed value is: a repeated string
        // is a few nodes until something flattens it, and would weigh nothing.
        const pending = records.insert({ target: ORDER, values: orderValues(Buffer.alloc(SIZE, 0x61 + lost).toString('latin1')), returning: [], definition: described.described.definition })
        await until(async () => [...(await owner`select count(*)::int as n from pg_catalog.pg_stat_activity where application_name = 'locked-and-kept' and wait_event_type = 'Lock'`)][0]?.n, 1)
        await owner`select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name = 'locked-and-kept'`
        expect(failed(await within(pending, 'the insert never answered'))).toMatchObject({ code: 'unavailable' })
        release()
        await holding
        // The terminated backend's 57P01 on the next statement, then a new connection.
        await within(records.describe(ORDER.table), 'the driver never answered again')
        expect(await within(records.describe(ORDER.table), 'the driver never answered a second time')).toMatchObject({ ok: true })
      }
      // Less than one lost write's values, where all of them were kept.
      const grown = heap() - before
      expect(grown, `${String(Math.round(grown / 1024 / 1024))} MB kept`).toBeLessThan(SIZE)
    } finally {
      await repeatable.end({ timeout: 1 })
    }
  })
})
