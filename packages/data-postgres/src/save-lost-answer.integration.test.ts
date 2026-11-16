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
  startPostgresFixture,
  startTcpHop,
} from '@formancy/data-fixtures'
import type { PostgresFixture, SavedForms, TcpHop } from '@formancy/data-fixtures'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createPostgresRecords, discoverPostgres } from './index.js'

/*
 * A save of a record with its rows whose answer is lost, or whose COMMIT is
 * refused (0155, 0031), against REAL PostgreSQL loaded with the parity
 * schema, through the TCP hop from `@formancy/data-fixtures`: every byte
 * that crosses it is postgres.js's and the server's own, and only the
 * network fails (0003).
 *
 * PostgreSQL commits only when postgres.js sends COMMIT, after the save's
 * last statement answered; an answer lost before that leaves the
 * transaction open on a connection that is gone, and PostgreSQL rolls it
 * back. So the adapter cannot tell a lost save from one never committed
 * once the record's step was sent, and answers `unknown-outcome`, sent
 * once, never again -- the record's version is what makes a resend safe.
 */

let fixture: PostgresFixture
let owner: Sql
let records: RecordAdapter
let forms: SavedForms
let hop: TcpHop
let viaHop: Sql

/** How long a marker may take to appear in an answer, and a rollback to be seen. Generous: a loaded CI runner, not a measurement. */
const PATIENCE_MS = 10_000
const DEADLINE = 10_000

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  forms = savedForms(await discoverPostgres(owner, PARITY_SCOPE))
  records = createPostgresRecords(owner)
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

beforeEach(async () => {
  const target = new URL(fixture.admin)
  hop = await startTcpHop({ kind: 'postgres', host: target.hostname, port: Number(target.port) })
  const url = new URL(fixture.admin)
  // One connection, so the save and anything after it share the one the hop watches.
  viaHop = postgres({
    host: '127.0.0.1',
    port: hop.port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    max: 1,
    onnotice: () => {},
  })
})

afterEach(async () => {
  // Bounded: postgres.js 3.4.9 keeps a statement that failed with its
  // connection as that connection's current one (records-lost-answer).
  await viaHop.end({ timeout: 1 })
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

/** Polls until no backend is idle in a transaction: the lost save's, rolled back once PostgreSQL saw its connection go. */
async function rolledBack(): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  for (;;) {
    const [row] = await owner<
      { n: number }[]
    >`select count(*)::int as n from pg_stat_activity where state like 'idle in transaction%' and pid <> pg_backend_pid()`
    if ((row?.n ?? 0) === 0) return
    if (Date.now() > deadline) throw new Error('the lost save never rolled back')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** An order of tenant 1 with one line, as the owner inserts it; its id. */
async function order(): Promise<number> {
  const [row] = await owner<{ id: number }[]>`insert into parity.saved_order (tenant_id) values (1) returning id`
  const id = (row as { id: number }).id
  await owner`insert into parity.saved_line (order_id, line_no, quantity) values (${id}, 1, 1)`
  return id
}

/** An order's note, version, lines and marks as the owner reads them. */
async function stored(id: number): Promise<{ note: string | null; version: number; lines: number; marks: number }> {
  const [row] = await owner<{ note: string | null; version: number; lines: number; marks: number }[]>`
    select note, version,
      (select count(*)::int from parity.saved_line where order_id = ${id}) as lines,
      (select count(*)::int from parity.saved_mark where order_id = ${id}) as marks
    from parity.saved_order where id = ${id}`
  return row as { note: string | null; version: number; lines: number; marks: number }
}

/** A save of `id` that notes the order `note` and creates the rows given through `form`. */
async function body(id: number, note: string, form: 'saved-line' | 'saved-mark', changes: SaveBody['rows'][number]['changes']): Promise<SaveBody> {
  const [row] = await owner<{ version: string }[]>`select version::text as version from parity.saved_order where id = ${id}`
  return {
    record: { update: { record: savedToken(['id'], { id }), version: (row as { version: string }).version, answers: { note } } },
    rows: [{ form, field: 'saved_order', changes }],
  }
}

describe('a save whose answer is lost', () => {
  // The record's step was sent and its answer -- the order's RETURNING,
  // which echoes the note -- never arrived: unknown to the adapter, which
  // cannot tell that from a commit lost, sent once and never again, and
  // nothing stored, since COMMIT was never sent. Watched failing on
  // postgres:17-alpine with the adapter sending the save again on a lost
  // connection: "expected 'saved' to be 'save: unknown-outcome'".
  test('is unknown-outcome once the record was sent, sent once, and rolled back', covers('postgres', saveCase('lost-answer')), async () => {
    const id = await order()
    const before = await stored(id)
    const note = `lost ${randomUUID().slice(0, 8)}`
    const plan = await plannedSave(
      records,
      forms.orders,
      [forms.lines],
      await body(id, note, 'saved-line', [{ create: { ref: 'n', answers: { line_no: 2, quantity: 1 } } }]),
      DEADLINE,
    )
    const bytes = answerBytes('postgres', note)
    const sent = hop.countSent(bytes)
    const lost = hop.swallowAnswersFrom(bytes)
    const pending = createPostgresRecords(viaHop).save(plan.request)
    await within(lost.matched, 'the order never answered with its note')
    lost.cut()
    const outcome: SaveOutcome = await within(pending, 'the save never answered')
    expect(saveAnswer(outcome)).toBe(saveExpected('lost-answer', 'postgres'))
    expect(sent()).toBe(1)
    await rolledBack()
    expect(await stored(id)).toEqual(before)
  })

  // A save stored, sent again with the version its order was read at --
  // the browser's resend, or a person's second press: the first moved the
  // order's version, so the second is `stale`, and the line the first
  // created is there once. Watched failing on postgres:17-alpine with the
  // touch's version guard taken out: "expected 'child 0 create 0:
  // unique-violation' to be 'record: stale'".
  test('is stored at most once when it is sent again', covers('postgres', saveCase('resend')), async () => {
    const id = await order()
    const save = await body(id, 'resent', 'saved-line', [{ create: { ref: 'n', answers: { line_no: 2, quantity: 1 } } }])
    const touch: SaveBody = { ...save, record: { update: { ...(save.record as { update: { record: string; version: string } }).update, answers: {} } } }
    const plan = await plannedSave(records, forms.orders, [forms.lines], touch, DEADLINE)
    const adapter = createPostgresRecords(viaHop)
    expect(saveAnswer(await adapter.save(plan.request))).toBe('saved')
    expect(saveAnswer(await adapter.save(plan.request))).toBe(saveExpected('resend', 'postgres'))
    expect(await stored(id)).toMatchObject({ lines: 2 })
  })
})

describe('a save whose COMMIT is refused', () => {
  // Two marks numbered alike, which PostgreSQL checks at COMMIT (the
  // fixture's deferred key): every step answered, and COMMIT refused. The
  // transaction rolled back and the server said so, so that refusal is the
  // answer, at the save, with nothing stored -- never unknown-outcome, which
  // would send a person to reconcile a save that is certainly not there.
  // Watched failing on postgres:17-alpine with every error that is not a
  // step's answered as a lost connection: "expected 'save:
  // unknown-outcome' to be 'save: unique-violation'".
  test('is that refusal, at the save, with nothing stored', async () => {
    const id = await order()
    const before = await stored(id)
    const twice = [1, 2].map((ref) => ({ create: { ref: String(ref), answers: { mark_no: 7 } } }))
    const plan = await plannedSave(records, forms.orders, [forms.marks], await body(id, 'deferred', 'saved-mark', twice), DEADLINE)
    const outcome = await createPostgresRecords(viaHop).save(plan.request)
    expect(saveAnswer(outcome)).toBe('save: unique-violation')
    expect(outcome.ok ? undefined : 'failure' in outcome ? outcome.failure.constraint : undefined).toBe('uq_saved_mark_no')
    expect(await stored(id)).toEqual(before)
  })
})
