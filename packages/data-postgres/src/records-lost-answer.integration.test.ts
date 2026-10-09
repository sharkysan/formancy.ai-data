import { findObject } from '@formancy/data-core'
import type { ApiValue, MetadataSnapshot, RecordColumn, RecordFailure, RecordOutcome, RecordTarget, RecordValue, RowFilters } from '@formancy/data-core'
import type { PostgresFixture, TcpHop } from '@formancy/data-fixtures'
import { answerBytes, startPostgresFixture, startTcpHop } from '@formancy/data-fixtures'
import { randomUUID } from 'node:crypto'
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
    const pending = createPostgresRecords(viaHop).insert({ target: ORDER, values: orderValues(notes), returning: [ORDER_ID, col('sales', 'order', 'notes')] })

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
    const created = await createPostgresRecords(owner).insert({ target: ORDER, values: orderValues(marker('before the update')), returning: [ORDER_ID] })
    if (!created.ok) throw new Error(created.message)
    const id = String(created.values.id)
    const version = String(created.version)
    const notes = marker('updated, answer lost')
    const bytes = answerBytes('postgres', notes)
    const sent = hop.countSent(bytes)
    const lost = hop.swallowAnswersFrom(bytes)
    const pending = createPostgresRecords(viaHop).update({
      target: ORDER,
      key: [{ ...ORDER_ID, value: id }],
      set: [{ ...col('sales', 'order', 'notes'), value: notes }],
      expectedVersion: version,
      filters: TENANT_1,
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

    const refused = failed(await createPostgresRecords(viaHop).insert(insert))
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
    const pending = createPostgresRecords(viaHop).insert({
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
        const outcome = await createPostgresRecords(timed).insert({ target: ORDER, values: orderValues(notes), returning: [ORDER_ID] })
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
