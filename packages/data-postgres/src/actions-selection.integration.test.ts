import { LIST_PAGE_SIZE } from '@formancy/data-core'
import type { ActionAdapter, ActionOutcome, ActionRequest } from '@formancy/data-core'
import {
  ACTION_DECLINED_REASON,
  ACTION_SCOPE,
  actionAnswer,
  actionCase,
  actionExpected,
  actionForms,
  actionToken,
  covers,
  plannedSelection,
  startPostgresFixture,
} from '@formancy/data-fixtures'
import type { ActionCase, ActionForms, PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createPostgresActions, discoverPostgres } from './index.js'

/*
 * An action's run over a selection of records (0165) against REAL
 * PostgreSQL loaded with the actions schema (fixtures/postgres.actions.sql):
 * `close-all`, close_order over the orders chosen, in one transaction. Each
 * case's answer is written once in `@formancy/data-fixtures`
 * (`ACTION_PARITY`), and the SQL Server suite runs the same cases, each
 * declared with `covers()` (0035).
 *
 * As in actions.integration.test.ts, every run goes as formancy_writer and
 * is the planner's, planned before anything a case changes; the owner
 * inserts, reads what is stored and counts the calls that began by the
 * sequence each routine draws from as it begins, which no rollback gives
 * back.
 *
 * Written on 2026-11-17 on a machine without Docker: CI is these cases'
 * first run, and none has yet been watched failing. Each says the rule it
 * holds and the failure it prevents.
 */

let fixture: PostgresFixture
let owner: Sql
let writer: Sql
let actions: ActionAdapter
let forms: ActionForms

/** The deadline a case runs under: long enough for any statement on a loaded runner, and for a page of calls. */
const DEADLINE = 20_000
/** How long a case waits for the database to reach a state it polls for. Generous: a loaded runner, not a measurement. */
const PATIENCE_MS = 10_000

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
  writer = postgres(fixture.writer, { onnotice: () => {} })
  forms = actionForms(await discoverPostgres(writer, ACTION_SCOPE))
  actions = createPostgresActions(writer)
})

afterAll(async () => {
  await writer?.end()
  await owner?.end()
  await fixture?.stop()
})

const expected = (name: ActionCase): string => actionExpected(name, 'postgres')

/** `count` orders of one new customer of tenant 1, each of `amount`, as the owner inserts them; their ids, ascending. */
async function orders(count: number, amount = '12.50'): Promise<number[]> {
  const [customer] = await owner<{ id: string }[]>`insert into actions.customer (tenant_id, name) values (1, 'Customer') returning id::text as id`
  const rows = await owner<{ id: string }[]>`
    insert into actions."order" (customer_id, amount)
    select ${(customer as { id: string }).id}::bigint, ${amount}::numeric from pg_catalog.generate_series(1, ${count}::pg_catalog.int4) returning id::text as id`
  return rows.map((row) => Number(row.id)).sort((left, right) => left - right)
}

/** Each order's status and version, as the owner reads them, in the order of `ids`. */
async function stored(ids: readonly number[]): Promise<Array<{ status: string; version: number }>> {
  const rows = await owner<{ id: string; status: string; version: number }[]>`
    select id::text as id, status, version from actions."order" where id = any(${ids.map(String)}::bigint[])`
  return ids.map((id) => {
    const row = rows.find((candidate) => Number(candidate.id) === id)
    return { status: row?.status ?? 'gone', version: row?.version ?? 0 }
  })
}

/** Every call close_order recorded for any of `ids`, as `id:note`, by id. */
async function calls(ids: readonly number[]): Promise<string[]> {
  const rows = await owner<{ call: string }[]>`
    select concat_ws(':', record_id::text, note) as call from actions.call
    where routine = 'close_order' and record_id = any(${ids.map(String)}::bigint[]) order by record_id, id`
  return rows.map((row) => row.call)
}

/** How many calls of the actions schema's routines have begun, as the sequence each draws from as it begins counts them. */
async function begun(): Promise<number> {
  const [row] = await owner<{ n: string }[]>`select (case when is_called then last_value else 0 end)::text as n from actions.called`
  return Number((row as { n: string }).n)
}

/** `run`'s outcome, and how many routine calls began while it ran. */
async function counted<T>(run: () => Promise<T>): Promise<{ outcome: T; begun: number }> {
  const before = await begun()
  const outcome = await run()
  return { outcome, begun: (await begun()) - before }
}

/** `close-all` over `ids`, in that order, with this note, planned from the versions the owner reads now. */
async function planned(ids: readonly number[], note: string): Promise<ActionRequest> {
  const rows = await owner<{ id: string; version: string }[]>`
    select id::text as id, version::text as version from actions."order" where id = any(${ids.map(String)}::bigint[])`
  const version = (id: number) => rows.find((row) => Number(row.id) === id)?.version ?? '1'
  return plannedSelection(actions, forms.orders, 'close-all', {
    records: ids.map((id) => ({ record: actionToken(id), version: version(id) })),
    answers: { note },
  })
}

/** Polls `read` until it holds. */
async function until(read: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  while (!(await read())) {
    if (Date.now() > deadline) throw new Error(`never ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** How many backends wait for a lock while running a run's lock statement. */
async function lockWaiters(): Promise<number> {
  const [row] = await owner<{ n: number }[]>`
    select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like 'with "locked" as materialized%' and pid <> pg_backend_pid()`
  return row?.n ?? 0
}

/** Holds `id`'s row FOR UPDATE in a transaction of its own until `release` is called; resolves once it is held. */
async function hold(id: number): Promise<{ release: () => Promise<void> }> {
  const holder = postgres(fixture.admin, { max: 1, onnotice: () => {} })
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  let held!: () => void
  const holding = new Promise<void>((resolve) => (held = resolve))
  const done = holder.begin(async (tx) => {
    await tx`select id from actions."order" where id = ${id} for update`
    held()
    await released
  })
  await holding
  return {
    release: async () => {
      release()
      await done
      await holder.end()
    },
  }
}

describe('a run over a selection', () => {
  // Every record chosen commits in one run: each version moved by one, the
  // routine called once for each with its own amount read from its own
  // locked row, and each answered by its key in the order sent -- sent
  // here out of key order, which the lock takes in key order and the
  // answer does not. A selection run over its first record alone, or the
  // routine called once for all, would close one order of three.
  test('commits every record, each moved and called once, answered in the order sent', covers('postgres', actionCase('selection-done')), async () => {
    const [a, b, c] = (await orders(3)) as [number, number, number]
    const request = await planned([c, a, b], 'all')
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('selection-done'))
    expect(outcome).toEqual({ ok: true, records: [{ id: String(c) }, { id: String(a) }, { id: String(b) }] })
    expect(called).toBe(3)
    expect(await stored([a, b, c])).toEqual([
      { status: 'closed', version: 2 },
      { status: 'closed', version: 2 },
      { status: 'closed', version: 2 },
    ])
    expect(await calls([a, b, c])).toEqual([`${String(a)}:all`, `${String(b)}:all`, `${String(c)}:all`])
  })

  // Two runs over the same two orders, sent in opposite orders, while a
  // third transaction holds the lower key's row: each locks in key order,
  // so both wait on that row and neither holds the other's; once it is let
  // go one is done and the other finds both versions moved, `stale`,
  // naming both. Locked in the order sent, the second would hold the
  // higher row while waiting on the lower, the first the lower while
  // waiting on the higher, and PostgreSQL would end one as a deadlock,
  // 40P01, `unavailable`.
  test(
    'of two overlapping selections sent in opposite orders, one is done and one stale, never a deadlock',
    covers('postgres', actionCase('selection-crossed')),
    async () => {
      const [a, b] = (await orders(2)) as [number, number]
      const first = await planned([a, b], 'first')
      const second = await planned([b, a], 'second')
      const held = await hold(a)
      const running: Array<Promise<ActionOutcome>> = []
      try {
        running.push(actions.run(first, DEADLINE))
        await until(async () => (await lockWaiters()) >= 1, 'seen the first run waiting on the held row')
        running.push(actions.run(second, DEADLINE))
        await until(async () => (await lockWaiters()) >= 2, 'seen both runs waiting on the held row')
      } finally {
        await held.release()
      }
      const outcomes = await Promise.all(running)
      expect(outcomes.map(actionAnswer).sort().join(', ')).toBe(expected('selection-crossed'))
      const stale = outcomes.find((outcome) => !outcome.ok)
      expect(stale !== undefined && !stale.ok && [...(stale.records ?? [])].sort()).toEqual([0, 1])
      expect((await stored([a, b])).map((order) => order.version)).toEqual([2, 2])
    },
  )

  // One order of three changed since it was read: nothing is called and
  // nothing kept of any, and the answer names that order by its position,
  // so a page reads it again. A run that called the routine over the two
  // that were current would close part of what the person chose.
  test('is stale when one record changed since it was read, naming it, and keeps nothing', covers('postgres', actionCase('selection-stale')), async () => {
    const [a, b, c] = (await orders(3)) as [number, number, number]
    const request = await planned([a, b, c], 'all')
    await owner`update actions."order" set version = version + 1 where id = ${b}`
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('selection-stale'))
    expect(!outcome.ok && outcome.records).toEqual([1])
    expect(called).toBe(0)
    expect(await stored([a, b, c])).toEqual([
      { status: 'open', version: 1 },
      { status: 'open', version: 2 },
      { status: 'open', version: 1 },
    ])
  })

  // The routine refuses one order of three, its amount 66.60: the run is
  // declined in the routine's words, and every record is rolled back --
  // its version, and what the routine did to the others before it
  // refused. The order of the calls is not promised, so the count is at
  // least the one that refused and at most all three.
  test('rolls back every record when the routine refuses one', covers('postgres', actionCase('selection-declined')), async () => {
    const [a, c] = (await orders(2)) as [number, number]
    const [b] = (await orders(1, '66.60')) as [number]
    const request = await planned([a, b, c], 'all')
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('selection-declined'))
    expect(!outcome.ok && outcome.reason).toBe(ACTION_DECLINED_REASON)
    expect(called).toBeGreaterThanOrEqual(1)
    expect(called).toBeLessThanOrEqual(3)
    expect((await stored([a, b, c])).map((order) => [order.status, order.version])).toEqual([
      ['open', 1],
      ['open', 1],
      ['open', 1],
    ])
    expect(await calls([a, b, c])).toEqual([])
  })

  // A selection is rows of the one page a list shows: exactly a page
  // commits, each record called once, and one more is refused before any
  // statement -- by the planner, and by the adapter, which throws a
  // request no planner makes before anything is sent. Without the bound a
  // run's locks and calls would grow with whatever a client sent.
  test('commits a page of records, and refuses one more before any statement', covers('postgres', actionCase('selection-page')), async () => {
    const ids = await orders(LIST_PAGE_SIZE + 1)
    const page = ids.slice(0, LIST_PAGE_SIZE)
    const request = await planned(page, 'page')
    const { outcome, begun: called } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('selection-page'))
    expect(called).toBe(LIST_PAGE_SIZE)
    expect((await stored(page)).every((order) => order.version === 2)).toBe(true)
    const last = ids[LIST_PAGE_SIZE] as number
    await expect(planned(ids, 'one more')).rejects.toThrow(/invalid-request/)
    const tooMany: ActionRequest = {
      ...request,
      records: [
        ...request.records,
        { key: [{ ...(request.records[0]?.key[0] as ActionRequest['records'][number]['key'][number]), value: String(last) }], expectedVersion: '1' },
      ],
    }
    const refused = await counted(() => actions.run(tooMany, DEADLINE).catch((error: unknown) => (error as Error).message))
    expect(refused.outcome).toContain(`from 1 to ${String(LIST_PAGE_SIZE)} records`)
    expect(refused.begun).toBe(0)
    expect(await stored([last])).toEqual([{ status: 'open', version: 1 }])
  })
})
