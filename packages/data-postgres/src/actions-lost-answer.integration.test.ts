import {
  ACTION_SCOPE,
  actionAnswer,
  actionCase,
  actionExpected,
  actionForms,
  actionToken,
  answerBytes,
  covers,
  plannedAction,
  startPostgresFixture,
  startTcpHop,
} from '@formancy/data-fixtures'
import type { ActionForms, PostgresFixture, TcpHop } from '@formancy/data-fixtures'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createPostgresActions, discoverPostgres } from './index.js'

/*
 * An action's run whose answer is lost (0160, 0031), against REAL
 * PostgreSQL loaded with the actions schema, through the TCP hop from
 * `@formancy/data-fixtures`: every byte that crosses it is postgres.js's and
 * the server's own, and only the network fails (0003).
 *
 * The routine raises a notice carrying the person's answer, which crosses
 * the wire with the call's answer, before postgres.js sends COMMIT; the hop
 * drops everything from it on. The run was sent, and its answer lost:
 * `unknown-outcome`, sent once and never again. PostgreSQL commits only on
 * the COMMIT that never left, and rolls the run back once it sees the
 * connection gone -- which the adapter does not tell apart from a COMMIT
 * lost, as a save's does not (0155): its version is what makes a run sent
 * again safe.
 */

let fixture: PostgresFixture
let owner: Sql
let forms: ActionForms
let hop: TcpHop
let viaHop: Sql

/** How long a marker may take to appear in an answer, and a rollback to be seen. Generous: a loaded CI runner, not a measurement. */
const PATIENCE_MS = 10_000
const DEADLINE = 10_000

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  const writer = postgres(fixture.writer, { onnotice: () => {} })
  try {
    forms = actionForms(await discoverPostgres(writer, ACTION_SCOPE))
  } finally {
    await writer.end()
  }
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

beforeEach(async () => {
  const target = new URL(fixture.writer)
  hop = await startTcpHop({ kind: 'postgres', host: target.hostname, port: Number(target.port) })
  // One connection, so the run and anything after it share the one the hop watches.
  viaHop = postgres({
    host: '127.0.0.1',
    port: hop.port,
    username: decodeURIComponent(target.username),
    password: decodeURIComponent(target.password),
    database: target.pathname.slice(1),
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

/** Polls until no backend is idle in a transaction: the lost run's, rolled back once PostgreSQL saw its connection go. */
async function rolledBack(): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  for (;;) {
    const [row] = await owner<
      { n: number }[]
    >`select count(*)::int as n from pg_stat_activity where state like 'idle in transaction%' and pid <> pg_backend_pid()`
    if ((row?.n ?? 0) === 0) return
    if (Date.now() > deadline) throw new Error('the lost run never rolled back')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** An order of tenant 1, as the owner inserts it; its id. */
async function order(): Promise<number> {
  const [customer] = await owner<{ id: number }[]>`insert into actions.customer (tenant_id, name) values (1, 'Customer') returning id`
  const [row] = await owner<{ id: number }[]>`insert into actions."order" (customer_id, amount) values (${(customer as { id: number }).id}, 12.50) returning id`
  return Number((row as { id: number }).id)
}

/** An order's status and version, and the calls recorded for it, as the owner reads them. */
async function stored(id: number): Promise<{ status: string; version: number; calls: number }> {
  const [row] = await owner<{ status: string; version: number; calls: number }[]>`
    select status, version, (select count(*)::int from actions.call where record_id = ${id} and routine = 'close_order') as calls
    from actions."order" where id = ${id}`
  return row as { status: string; version: number; calls: number }
}

describe('a run whose answer is lost', () => {
  // The call was sent and its answer -- the notice the routine raised with
  // the person's answer, then the call's row -- never arrived: unknown to
  // the adapter, sent once and never again, and nothing kept, since COMMIT
  // was never sent. Watched failing on postgres:17-alpine on 2026-11-16
  // with a connection lost read as one before anything was sent: "expected
  // 'unavailable' to be 'unknown-outcome'".
  test('is unknown-outcome once the call was sent, sent once, and rolled back', covers('postgres', actionCase('lost-answer')), async () => {
    const id = await order()
    const note = `lost ${randomUUID().slice(0, 8)}`
    const actions = createPostgresActions(viaHop)
    const request = await plannedAction(actions, forms.orders, 'close', { record: actionToken(id), version: '1', answers: { note } })
    const bytes = answerBytes('postgres', note)
    const sent = hop.countSent(bytes)
    const lost = hop.swallowAnswersFrom(bytes)
    const pending = actions.run(request, DEADLINE)
    await within(lost.matched, 'the routine never raised its notice')
    lost.cut()
    const outcome = await within(pending, 'the run never answered')
    expect(actionAnswer(outcome)).toBe(actionExpected('lost-answer', 'postgres'))
    expect(sent()).toBe(1)
    await rolledBack()
    expect(await stored(id)).toEqual({ status: 'open', version: 1, calls: 0 })
  })

  // What a run costs in round trips, measured here because the hop counts
  // them (0034): a turn is the client speaking again after it heard the
  // server. 0061 measured one statement under SET LOCAL statement_timeout
  // at 5 or 6 where 2 would do; a run sets it twice, before each of its two
  // statements, and costs 8 from BEGIN to COMMIT, on a connection's first
  // run and on the next alike: each SET's text is new, since it spells the
  // milliseconds that remain. The round trips are outside the deadline,
  // which bounds the statements alone. Measured on postgres:17-alpine on
  // 2026-11-16; watched failing with the second run asserted to cost
  // none: "expected [ 8, 8 ] to deeply equal [ 8, +0 ]".
  test('costs its round trips from BEGIN to COMMIT', async () => {
    const actions = createPostgresActions(viaHop)
    const runs: number[] = []
    for (const note of ['counted first', 'counted again']) {
      const id = await order()
      const request = await plannedAction(actions, forms.orders, 'close', { record: actionToken(id), version: '1', answers: { note } })
      const turns = hop.countRoundTrips()
      expect(actionAnswer(await actions.run(request, DEADLINE))).toBe('done')
      runs.push(turns())
    }
    expect(runs).toEqual([8, 8])
  })
})
