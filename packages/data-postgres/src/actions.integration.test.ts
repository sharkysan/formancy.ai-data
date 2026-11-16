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
  plannedAction,
  startPostgresFixture,
} from '@formancy/data-fixtures'
import type { ActionBundle, ActionCase, ActionForms, PostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { connectPostgres, createPostgresActions, discoverPostgres } from './index.js'

/*
 * An action's run over the open record (0160) against REAL PostgreSQL
 * loaded with the actions schema (fixtures/postgres.actions.sql). Each
 * shared case's answer is written once in `@formancy/data-fixtures`
 * (`ACTION_PARITY`), and the SQL Server suite runs the same cases, each
 * declared with `covers()` (0035); the cases only PostgreSQL has, and the
 * engine facts a run rests on, follow them.
 *
 * Every run goes as formancy_writer, the account discovery reads the
 * schema as, so a grant taken from it is one the run meets. Every request
 * is the planner's (`plannedAction`: the root and the routine described by
 * the adapter, then `planAction`), planned before anything a case changes
 * in the database, as a route plans before it runs. The owner inserts what
 * a case starts from, and reads what is stored and which calls each
 * routine received: a routine "not called" is one that recorded no call,
 * which a rollback would also take away -- so each such case is a run the
 * adapter refused before its call, or whose answer says it rolled back.
 *
 * Each case says which failure it prevents and was watched failing on
 * postgres:17-alpine on 2026-11-16, its rule taken out and put back.
 */

let fixture: PostgresFixture
let owner: Sql
let writer: Sql
let actions: ActionAdapter
let forms: ActionForms

/** The deadline a case runs under unless it is about the deadline: long enough for any statement on a loaded runner. */
const DEADLINE = 10_000
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

/** A customer of `tenant`, as the owner inserts it; its id. */
async function customer(tenant: number): Promise<number> {
  const [row] = await owner<{ id: number }[]>`insert into actions.customer (tenant_id, name) values (${tenant}, 'Customer') returning id`
  return Number((row as { id: number }).id)
}

/** An order of a new customer of `tenant`, its amount 12.50; its id. */
async function order(tenant = 1): Promise<number> {
  const [row] = await owner<{ id: number }[]>`insert into actions."order" (customer_id, amount) values (${await customer(tenant)}, 12.50) returning id`
  return Number((row as { id: number }).id)
}

/** An order as the owner reads it. */
async function stored(id: number): Promise<{ status: string; note: string | null; version: number }> {
  const [row] = await owner<{ status: string; note: string | null; version: number }[]>`select status, note, version from actions."order" where id = ${id}`
  return row as { status: string; note: string | null; version: number }
}

/** Every call the order routines, or `routines`, recorded for `id`, as `routine:note:actor:amount:tenant`. */
async function calls(id: number, routines: readonly string[] = ['close_order', 'broken_order', 'overload']): Promise<string[]> {
  const rows = await owner<{ call: string }[]>`
    select concat_ws(':', routine, note, actor, amount::text, tenant::text) as call from actions.call
    where record_id = ${id} and routine = any(${routines as string[]}) order by id`
  return rows.map((row) => row.call)
}

/** The version a person read `id` at. */
async function versionOf(table: 'order' | 'price', id: number): Promise<string> {
  const [row] = await owner<{ version: string }[]>`select version::text as version from ${owner('actions')}.${owner(table)} where id = ${id}`
  return (row as { version: string }).version
}

/** `name` over `id` planned as the route will plan it, from the version the owner reads now. */
async function planned(name: string, id: number, answers: Record<string, unknown> = {}, bundle: ActionBundle = forms.orders): Promise<ActionRequest> {
  const version = await versionOf(bundle === forms.prices ? 'price' : 'order', id)
  return plannedAction(actions, bundle, name, { record: actionToken(id), version, answers })
}

/** `close` over `id` with this note, planned and run. */
async function closed(id: number, note: string, deadlineMs = DEADLINE): Promise<ActionOutcome> {
  return actions.run(await planned('close', id, { note }), deadlineMs)
}

/** Polls `read` until it holds. */
async function until(read: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  while (!(await read())) {
    if (Date.now() > deadline) throw new Error(`never ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Whether a backend other than the owner's is waiting for a lock while running `like`. */
async function waitingOnLock(like: string): Promise<boolean> {
  const [row] = await owner<{ n: number }[]>`
    select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like ${like} and pid <> pg_backend_pid()`
  return (row?.n ?? 0) > 0
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

/** The routine close_order's own CREATE, as the catalog spells it, to make it again. */
async function closeOrderDefinition(): Promise<string> {
  const [row] = await owner<{ text: string }[]>`select pg_get_functiondef('actions.close_order(bigint, text, text, numeric, int)'::regprocedure) as text`
  return (row as { text: string }).text
}

describe('a run over the open record', () => {
  // The run commits: the version moved by one in the run's own statement,
  // the order closed by the routine, which was given the key, the person's
  // answer, the actor's id, the amount read from the locked row -- never a
  // value the browser sent -- and the tenant from the context. Watched
  // failing with the lock setting the version to itself: "expected {
  // status: 'closed', …(2) } to deeply equal { status: 'closed', …(2) }",
  // the version still 1 -- a save read before the run would then
  // overwrite what it did.
  test('commits, moves the version, and gives the routine each value', covers('postgres', actionCase('done')), async () => {
    const id = await order()
    const outcome = await closed(id, 'shipped')
    expect(actionAnswer(outcome)).toBe(expected('done'))
    expect(outcome).toEqual({ ok: true, records: [{ id: String(id) }] })
    expect(await stored(id)).toEqual({ status: 'closed', note: 'shipped', version: 2 })
    expect(await calls(id)).toEqual(['close_order:shipped:clara:12.50:1'])
  })

  // Two runs from one read -- a second press, another replica -- run at
  // most once: the first moved the version, so the second finds none at the
  // version read, `stale`, and the routine was called once. Watched failing
  // with the version left out of the lock's WHERE: "expected 'done' to be
  // 'stale'".
  test('runs once from one read: the second is stale', covers('postgres', actionCase('second-run')), async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'once' })
    expect(actionAnswer(await actions.run(request, DEADLINE))).toBe('done')
    expect(actionAnswer(await actions.run(request, DEADLINE))).toBe(expected('second-run'))
    expect(await calls(id)).toEqual(['close_order:once:clara:12.50:1'])
  })

  // A token minted for another tenant's order -- the browser holds its key
  // -- addresses nothing: the customer it is scoped through is tenant 2's,
  // so the lock finds no row, the routine is never handed it, and the
  // answer does not say the order exists. Watched failing with the throughs
  // left out of the lock: "expected 'done' to be 'not-found'".
  test("is not-found for another tenant's record, and calls nothing", covers('postgres', actionCase('other-tenant')), async () => {
    const id = await order(2)
    expect(actionAnswer(await closed(id, 'theirs'))).toBe(expected('other-tenant'))
    expect(await calls(id)).toEqual([])
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // The customer the order is scoped through is held FOR SHARE until the
  // run commits: a move of the customer to another tenant, an UPDATE that
  // leaves its key alone, waits for the run rather than landing under it.
  // Watched failing with the through's locking clause taken out of the
  // lock: "never seen waiting on the run's lock".
  test("holds the record's parent: a move to another tenant waits for the run", covers('postgres', actionCase('parent-moved')), async () => {
    const id = await order()
    const [row] = await owner<{ customer_id: number }[]>`select customer_id from actions."order" where id = ${id}`
    const parent = Number((row as { customer_id: number }).customer_id)
    const running = closed(id, 'sleep 1.5')
    await until(async () => {
      const [found] = await owner<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where wait_event = 'PgSleep'`
      return (found?.n ?? 0) > 0
    }, 'seen the routine running')
    let movedAt = 0
    const moving = owner`update actions.customer set tenant_id = 2 where id = ${parent}`.then(() => (movedAt = performance.now()))
    await until(() => waitingOnLock('update actions.customer%'), "seen waiting on the run's lock")
    const outcome = await running
    const ranAt = performance.now()
    await moving
    expect(actionAnswer(outcome)).toBe(expected('parent-moved'))
    expect(movedAt).toBeGreaterThanOrEqual(ranAt)
  })

  // A form over versions (0113) runs over the open version alone: an
  // ended one, at the version its person read, is `version-ended`, and
  // `reprice` is not called. Watched failing with the open-version
  // condition taken out of the lock: "expected 'done' to be
  // 'version-ended'".
  test('is version-ended over a version that has ended, and calls nothing', covers('postgres', actionCase('version-ended')), async () => {
    const parent = await customer(1)
    const [ended] = await owner<{ id: number }[]>`
      insert into actions.price (customer_id, product_no, valid_from, valid_to, amount) values (${parent}, 7, '2026-01-01', '2026-06-01', 10) returning id`
    await owner`insert into actions.price (customer_id, product_no, valid_from, amount) values (${parent}, 7, '2026-06-01', 11)`
    const id = Number((ended as { id: number }).id)
    const outcome = await actions.run(await planned('reprice', id, {}, forms.prices), DEADLINE)
    expect(actionAnswer(outcome)).toBe(expected('version-ended'))
    expect(await calls(id, ['reprice'])).toEqual([])
  })
})

describe("a run the deployment's logic refuses", () => {
  // The routine's RAISE under `formancy: refused: ` reaches the person, its
  // words alone, and the run is rolled back: the version where it was and
  // the routine's own call record gone with it. Watched failing with a
  // RAISE inside the routine read as any other error there: "expected
  // 'refused' to be 'declined'".
  test('is declined with the routine’s words, and keeps nothing', covers('postgres', actionCase('declined')), async () => {
    const id = await order()
    const outcome = await closed(id, 'refuse')
    expect(actionAnswer(outcome)).toBe(expected('declined'))
    expect(outcome.ok ? undefined : outcome.reason).toBe(ACTION_DECLINED_REASON)
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    expect(await calls(id)).toEqual([])
  })

  // A RAISE without the prefix is the server's own words: `refused`, its
  // message never passed on. Watched failing with every RAISE inside the
  // routine read as worded for the person, its message the reason:
  // "expected 'declined' to be 'refused'".
  test('is refused for an error not worded for the person', covers('postgres', actionCase('refused')), async () => {
    const id = await order()
    const outcome = await closed(id, 'plain')
    expect(actionAnswer(outcome)).toBe(expected('refused'))
    expect(JSON.stringify(outcome)).not.toContain('not worded')
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // The routine's body sets a column no table has, 42703, which a write
  // answers `schema-changed`. Here it arose inside the routine, whose body
  // is not what the form was published over: `refused`, and never a 409
  // that sends an administrator to a drift review that shows nothing.
  // Watched failing with where it arose unasked: "expected 'schema-changed'
  // to be 'refused'".
  test('is refused when the routine’s body references a missing column', covers('postgres', actionCase('missing-column')), async () => {
    const id = await order()
    const outcome = await actions.run(await planned('broken', id), DEADLINE)
    expect(actionAnswer(outcome)).toBe(expected('missing-column'))
    expect(await calls(id)).toEqual([])
  })
})

describe('a run whose routine changed after it was described', () => {
  // Dropped and created again between the description and the run: the
  // same name, signature and body, another oid. The call's guard reads the
  // routine the signature resolves to now, whose digest is not the one
  // described, so the call returns no row and calls nothing. Watched
  // failing with the guard taken out of the call: "expected 'done' to be
  // 'schema-changed'".
  test('is schema-changed when the routine was dropped and created again, and calls nothing', covers('postgres', actionCase('recreated')), async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'recreated' })
    const definition = await closeOrderDefinition()
    await owner.begin(async (tx) => {
      await tx`drop function actions.close_order(bigint, text, text, numeric, int)`
      await tx.unsafe(definition)
      await tx`revoke execute on function actions.close_order(bigint, text, text, numeric, int) from public`
      await tx`grant execute on function actions.close_order(bigint, text, text, numeric, int) to formancy_writer`
    })
    expect(actionAnswer(await actions.run(request, DEADLINE))).toBe(expected('recreated'))
    expect(await calls(id)).toEqual([])
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // Made SECURITY DEFINER between the description and the run: the
  // routine would reach past the account's grants, which nobody reviewed.
  // The digest covers it, so nothing is called. Watched failing with
  // prosecdef left out of the routine's facts: "expected 'done' to be
  // 'schema-changed'".
  test('is schema-changed when the routine was made SECURITY DEFINER, and calls nothing', covers('postgres', actionCase('reach-changed')), async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'definer' })
    await owner`alter function actions.close_order(bigint, text, text, numeric, int) security definer`
    try {
      expect(actionAnswer(await actions.run(request, DEADLINE))).toBe(expected('reach-changed'))
      expect(await calls(id)).toEqual([])
    } finally {
      await owner`alter function actions.close_order(bigint, text, text, numeric, int) security invoker`
    }
  })

  // EXECUTE taken from the account: 42501 at the call, which is the
  // account's grant and not the routine's refusal. Watched failing with
  // every error at the call read as one inside the routine: "expected
  // 'refused' to be 'permission-denied'".
  test('is permission-denied when EXECUTE was revoked', covers('postgres', actionCase('execute-revoked')), async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'revoked' })
    await owner`revoke execute on function actions.close_order(bigint, text, text, numeric, int) from formancy_writer`
    try {
      expect(actionAnswer(await actions.run(request, DEADLINE))).toBe(expected('execute-revoked'))
      expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    } finally {
      await owner`grant execute on function actions.close_order(bigint, text, text, numeric, int) to formancy_writer`
    }
  })

  // An overload made after publication that would take the tenant as text:
  // every argument is cast to its bound parameter's type, so the bound
  // routine is the only exact match and the overload is never the better
  // one. Watched failing with a bound value cast to text alone: the
  // overload was called, "expected [ 'overload:overloaded' ] to deeply
  // equal [ Array(1) ]".
  test('never calls an overload created after publication', async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'overloaded' })
    await owner.unsafe(`create function actions.close_order(p_order bigint, p_note text, p_actor text, p_amount numeric, p_tenant text) returns void
      language plpgsql as $$ begin insert into actions.call (routine, record_id, note) values ('overload', p_order, p_note); end $$`)
    await owner`grant execute on function actions.close_order(bigint, text, text, numeric, text) to formancy_writer`
    try {
      expect(actionAnswer(await actions.run(request, DEADLINE))).toBe('done')
      expect(await calls(id)).toEqual(['close_order:overloaded:clara:12.50:1'])
    } finally {
      await owner`drop function actions.close_order(bigint, text, text, numeric, text)`
    }
  })
})

describe("a run and its deadline, PostgreSQL's statement timeout", () => {
  // Another transaction holds the order's row past the deadline: the lock
  // waits no longer than the statement timeout, 57014, rolled back and
  // known to be. Watched failing with no statement timeout set: the run
  // waited for the holder to let go, "expected 2521.240500000001 to be
  // less than 2000", and was refused only then, by the adapter's own
  // clock.
  test('stops a lock held past the deadline', covers('postgres', actionCase('held-lock')), async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'waited' })
    const holder = await hold(id)
    const released = new Promise((resolve) => setTimeout(resolve, 2_500)).then(() => holder.release())
    const started = performance.now()
    const outcome = await actions.run(request, 1_000)
    const waited = performance.now() - started
    await released
    expect(actionAnswer(outcome)).toBe(expected('held-lock'))
    // Answered at its deadline, not when the holder let go at 2.5 s.
    expect(waited).toBeLessThan(2_000)
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // The routine runs past the deadline: the server stops it, 57014, and
  // the run is rolled back, its call record with it. Watched failing with
  // no statement timeout set: "expected 'done' to be 'action-timeout'".
  test('stops a routine that runs past the deadline', covers('postgres', actionCase('slow-routine')), async () => {
    const id = await order()
    expect(actionAnswer(await closed(id, 'sleep 2.5', 1_000))).toBe(expected('slow-routine'))
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    expect(await calls(id)).toEqual([])
  })

  // Each statement inside the deadline and the two together past it: the
  // lock waits 1.2 s of 2 s for a row another transaction holds, and the
  // routine then sleeps 1.2 s, under a statement timeout of what remains.
  // Watched failing with the second SET left out, the first's 2 s still in
  // force: "expected 'done' to be 'action-timeout'".
  test('stops a run whose two statements each fit the deadline and together do not', async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'sleep 1.2' })
    const holder = await hold(id)
    const released = new Promise((resolve) => setTimeout(resolve, 1_200)).then(() => holder.release())
    const outcome = await actions.run(request, 2_000)
    await released
    expect(actionAnswer(outcome)).toBe('action-timeout')
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    expect(await calls(id)).toEqual([])
  })
})

/*
 * What PostgreSQL does that a run rests on, and that no document of the
 * adapter's could otherwise claim: measured with plain statements on the
 * fixture's tables, no product code, as the spike's file is. Each was
 * watched failing with the opposite asserted, on postgres:17-alpine on
 * 2026-11-16; its comment quotes what that run said.
 */
describe('what a run rests on', () => {
  /** A client of one connection, so a transaction on it is a session of its own. */
  const session = (): Sql => postgres(fixture.admin, { max: 1, onnotice: () => {} })

  // A run's lock is `order by key … for no key update`, and two runs over
  // overlapping records wait rather than deadlock only if PostgreSQL locks
  // each row as the sort hands it on. A session holding the second of two
  // orders: a lock in key order has taken the first before it waits, and a
  // third session cannot take it; in descending order it waits on the
  // second first and has not. Watched failing with the descending case
  // asserted to hold the first too: "promise resolved "[ { id: … } ]"
  // instead of rejecting".
  test('locks the rows of an ordered locking SELECT in the order of its sort', async () => {
    const first = await order()
    const second = await order()
    for (const direction of ['asc', 'desc'] as const) {
      const holder = await hold(second)
      const locker = session()
      const probe = session()
      const locking = locker.begin(async (tx) => {
        await tx.unsafe(`select id from actions."order" where id in (${String(first)}, ${String(second)}) order by id ${direction} for no key update`)
      })
      try {
        await until(() => waitingOnLock('select id from actions."order" where id in%'), 'seen waiting on the held row')
        const nowait = probe`select id from actions."order" where id = ${first} for update nowait`
        if (direction === 'asc') await expect(nowait).rejects.toMatchObject({ code: '55P03' })
        else await expect(nowait).resolves.toHaveLength(1)
      } finally {
        await holder.release()
        await locking
        await Promise.all([locker.end(), probe.end()])
      }
    }
  })

  // A run tells an error inside the routine from one in its own statement
  // by the context field alone (actions/errors.ts). PostgreSQL fills it for
  // an error in a PL/pgSQL function and in a SQL function -- a void one is
  // never inlined -- and sends none for an error in the statement sent.
  // Watched failing with the SQL function's asserted empty: "expected
  // 'SQL function \"fail_sql\" statement 1' to be undefined".
  test('fills the context field for an error inside a function, and only there', async () => {
    await owner.unsafe(`create function actions.fail_sql(p bigint) returns void language sql as $$ select (1 / (p - p))::text $$`)
    try {
      const where = async (statement: Promise<unknown>): Promise<unknown> =>
        statement.then(
          () => 'no error',
          (error: unknown) => (error as { where?: unknown }).where,
        )
      expect(await where(owner`select actions.broken_order(0)`)).toMatch(/^PL\/pgSQL function actions\.broken_order\(bigint\) line \d+ at SQL statement$/)
      expect(await where(owner`select actions.fail_sql(1)`)).toMatch(/^SQL function "fail_sql" statement 1$/)
      expect(await where(owner`select (1 / (${1}::int - 1))::text`)).toBeUndefined()
    } finally {
      await owner`drop function actions.fail_sql(bigint)`
    }
  })

  // A run spells each through as an EXISTS with `for share of "p"` inside
  // it. PostgreSQL takes a locking clause there, and locks the parent row:
  // a third session cannot take the customer FOR UPDATE NOWAIT. And only an
  // account that may UPDATE the parent may: one with SELECT alone is
  // refused, 42501, the cost a through puts on a run. Watched failing with
  // the reading account asserted to lock: "promise rejected
  // "PostgresError: permission denied for tabl… { …(9) }" instead of
  // resolving".
  test('takes a locking clause inside EXISTS, and asks UPDATE on the parent for it', async () => {
    const id = await order()
    const [row] = await owner<{ customer_id: number }[]>`select customer_id from actions."order" where id = ${id}`
    const parent = Number((row as { customer_id: number }).customer_id)
    const exists = `select r.id from actions."order" as r where r.id = ${String(id)}
      and exists (select from actions.customer as p where p.id = r.customer_id for share of p)`
    const locker = session()
    const probe = session()
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let held!: () => void
    const holding = new Promise<void>((resolve) => (held = resolve))
    try {
      const locking = locker.begin(async (tx) => {
        expect(await tx.unsafe(exists)).toHaveLength(1)
        held()
        await released
      })
      await holding
      await expect(probe`select id from actions.customer where id = ${parent} for update nowait`).rejects.toMatchObject({ code: '55P03' })
      release()
      await locking
    } finally {
      await Promise.all([locker.end(), probe.end()])
    }
    await owner.unsafe(`create role action_viewer login password 'viewer-fixture-password'`)
    await owner.unsafe(`grant usage on schema actions to action_viewer; grant select on actions."order", actions.customer to action_viewer`)
    const url = new URL(fixture.admin)
    url.username = 'action_viewer'
    url.password = 'viewer-fixture-password'
    const viewer = postgres(url.toString(), { max: 1, onnotice: () => {} })
    try {
      await expect(viewer.begin((tx) => tx.unsafe(exists))).rejects.toMatchObject({ code: '42501' })
    } finally {
      await viewer.end()
    }
  })

  // A run's pool is the driver's default size, and the route will count
  // runs against it (0160): postgres.js reports it, as `options.max`, so
  // drivers.ts sets none. Watched failing with 5 asserted: "expected 10 to
  // be 5".
  test("reports its pool's size, the driver's default", async () => {
    const url = new URL(fixture.writer)
    const client = connectPostgres({
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      tls: { enabled: false, rejectUnauthorized: false },
    })
    try {
      expect(client.options.max).toBe(10)
    } finally {
      await client.end()
    }
  })
})
