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
 * a case starts from, and reads what is stored, which calls each routine
 * kept, and how many began: each routine draws from the sequence
 * actions.called as it begins, which no rollback gives back, so a routine
 * "not called" is one that drew nothing (`counted`), and one called and
 * rolled back drew and kept nothing. Every case that says "calls nothing"
 * was watched failing on that count, with an unguarded call of the routine
 * sent before the lock: the answer the same, the count one.
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

/** How many calls of the actions schema's routines have begun, as the sequence each draws from as it begins counts them. */
async function begun(): Promise<number> {
  const [row] = await owner<{ n: string }[]>`select (case when is_called then last_value else 0 end)::text as n from actions.called`
  return Number((row as { n: string }).n)
}

/** `run`'s outcome, and how many routine calls began while it ran: a rollback takes back what a call kept, and never that it began. */
async function counted<T>(run: () => Promise<T>): Promise<{ outcome: T; begun: number }> {
  const before = await begun()
  const outcome = await run()
  return { outcome, begun: (await begun()) - before }
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

/**
 * The routine close_order's own CREATE, as the catalog spells it, to make it
 * again. Found by `to_regprocedure` of a bound signature, which runs each
 * time: a `'…'::regprocedure` literal is the oid it named when postgres.js
 * prepared the statement on that connection, which a case that made the
 * routine again has since dropped.
 */
async function closeOrderDefinition(): Promise<string> {
  const signature = 'actions.close_order(bigint, text, text, numeric, int)'
  const [row] = await owner<{ text: string | null }[]>`select pg_get_functiondef(to_regprocedure(${signature})) as text`
  const text = row?.text
  if (typeof text !== 'string') throw new Error('close_order is not there to read')
  return text
}

/** close_order dropped and made again from `create`, with the fixture's grants, in one transaction. */
async function remakeCloseOrder(create: string): Promise<void> {
  await owner.begin(async (tx) => {
    await tx`drop function actions.close_order(bigint, text, text, numeric, int)`
    await tx.unsafe(create)
    await tx`revoke execute on function actions.close_order(bigint, text, text, numeric, int) from public`
    await tx`grant execute on function actions.close_order(bigint, text, text, numeric, int) to formancy_writer`
  })
}

/** `request` with one argument's source replaced, as a binding that gave that parameter another source would plan it. */
function sourced(request: ActionRequest, parameter: string, from: ActionRequest['routine']['arguments'][number]['from']): ActionRequest {
  if (!request.routine.arguments.some((argument) => argument.parameter === parameter)) throw new Error(`the request passes no ${parameter}`)
  const args = request.routine.arguments.map((argument) => (argument.parameter === parameter ? { ...argument, from } : argument))
  return { ...request, routine: { ...request.routine, arguments: args } }
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
    const { outcome, begun } = await counted(() => closed(id, 'shipped'))
    expect(begun).toBe(1)
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
    const second = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(second.outcome)).toBe(expected('second-run'))
    expect(second.begun).toBe(0)
    expect(await calls(id)).toEqual(['close_order:once:clara:12.50:1'])
  })

  // A token minted for another tenant's order -- the browser holds its key
  // -- addresses nothing: the customer it is scoped through is tenant 2's,
  // so the lock finds no row, the routine is never handed it, and the
  // answer does not say the order exists. Watched failing with the throughs
  // left out of the lock: "expected 'done' to be 'not-found'".
  test("is not-found for another tenant's record, and calls nothing", covers('postgres', actionCase('other-tenant')), async () => {
    const id = await order(2)
    const { outcome, begun } = await counted(() => closed(id, 'theirs'))
    expect(actionAnswer(outcome)).toBe(expected('other-tenant'))
    expect(begun).toBe(0)
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
    // Sent now: postgres.js sends a query when it is first awaited.
    const moving = owner`update actions.customer set tenant_id = 2 where id = ${parent}`.then(() => undefined)
    // Seen waiting while the run still holds the parent: the run's COMMIT
    // releases it before the run's answer arrives, so which answer reaches
    // this process first says nothing.
    await until(() => waitingOnLock('update actions.customer%'), "seen waiting on the run's lock")
    const outcome = await running
    await moving
    expect(actionAnswer(outcome)).toBe(expected('parent-moved'))
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
    const request = await planned('reprice', id, {}, forms.prices)
    const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('version-ended'))
    expect(begun).toBe(0)
  })
})

describe("a run the deployment's logic refuses", () => {
  // The routine's RAISE under `formancy: refused: ` reaches the person, its
  // words alone, and the run is rolled back: the routine called, and the
  // version where it was and the routine's own call record gone with it.
  // Watched failing with a RAISE inside the routine read as any other error
  // there: "expected 'refused' to be 'declined'".
  test('is declined with the routine’s words, and keeps nothing', covers('postgres', actionCase('declined')), async () => {
    const id = await order()
    const { outcome, begun } = await counted(() => closed(id, 'refuse'))
    expect(actionAnswer(outcome)).toBe(expected('declined'))
    expect(outcome.ok ? undefined : outcome.reason).toBe(ACTION_DECLINED_REASON)
    expect(begun).toBe(1)
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
    const request = await planned('broken', id)
    const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('missing-column'))
    // PL/pgSQL plans each statement as it reaches it: the routine began, and what it did was rolled back.
    expect(begun).toBe(1)
    expect(await calls(id)).toEqual([])
  })

  // The server's own "statement completion unknown", 40003, raised inside
  // the routine: what the transaction did comes first wherever it arose,
  // and a write answers 40003 `unknown-outcome` (records/errors.ts), so a
  // run must too, and never "rolled back" by its class, 40, which passes.
  // Watched failing with what passes asked first: "expected 'unavailable'
  // to be 'unknown-outcome'".
  test('is unknown-outcome when the server says a statement’s completion is unknown', async () => {
    const id = await order()
    expect(actionAnswer(await closed(id, 'unknown'))).toBe('unknown-outcome')
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
    await remakeCloseOrder(await closeOrderDefinition())
    const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('recreated'))
    expect(begun).toBe(0)
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
      const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
      expect(actionAnswer(outcome)).toBe(expected('reach-changed'))
      expect(begun).toBe(0)
    } finally {
      await owner`alter function actions.close_order(bigint, text, text, numeric, int) security invoker`
    }
  })

  // PostgreSQL does not call a STRICT function given a NULL argument, and
  // answers NULL for it: a run over an order whose note is NULL would move
  // the version, commit and answer done for a call that never ran. So no
  // run calls a STRICT routine, and the description says so. Watched
  // failing with STRICT read as nothing in the description: "expected
  // 'done' to be 'refused'".
  test('describes a STRICT routine as one no run calls', async () => {
    const routine = (forms.orders.bindings.actions ?? []).find((action) => action.name === 'close')?.routine
    if (routine === undefined) throw new Error('the order form binds no close')
    await owner`alter function actions.close_order(bigint, text, text, numeric, int) strict`
    try {
      const described = await actions.describe(forms.orders.bindings.root, routine)
      expect(described.ok ? 'done' : described.code).toBe('refused')
    } finally {
      await owner`alter function actions.close_order(bigint, text, text, numeric, int) called on null input`
    }
  })

  // Made STRICT after the description, it is not the routine the run was
  // decided over. Here the note reaches the routine from the order's own
  // column, NULL, as a binding of p_note to the note field would plan it.
  // Watched failing with STRICT left out of the routine's facts: "expected
  // 'done' to be 'schema-changed'".
  test('never calls a routine made STRICT after it was described', async () => {
    const id = await order()
    const request = sourced(await planned('close', id, { note: 'unused' }), 'p_note', { kind: 'column', column: 'note' })
    await owner`alter function actions.close_order(bigint, text, text, numeric, int) strict`
    try {
      const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
      expect(actionAnswer(outcome)).toBe('schema-changed')
      expect(begun).toBe(0)
      expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    } finally {
      await owner`alter function actions.close_order(bigint, text, text, numeric, int) called on null input`
    }
  })

  // PostgreSQL evaluates an IMMUTABLE function whose arguments are all
  // constants while it plans the statement, before any condition of it is
  // read, and a custom plan -- postgres.js's first five of a statement --
  // makes a bound value a constant. A routine whose every argument is a
  // value, dropped and made again IMMUTABLE between the description and the
  // run, would run unreviewed and say what it likes to the person, though
  // its guard then refuses it. The call reads every value from a derived
  // table the planner keeps, so nothing is evaluated before the guard.
  // Here close_order is given the key and the amount as values, as a
  // binding that passed them from the dialog would plan it. Watched failing
  // with the values bound where they stand: "expected 'declined' to be
  // 'schema-changed'".
  test('never runs a routine made IMMUTABLE in its place while the call is planned', async () => {
    const id = await order()
    const planning = await planned('close', id, { note: 'folded' })
    const request = sourced(sourced(planning, 'p_order', { kind: 'value', value: String(id) }), 'p_amount', { kind: 'value', value: '12.50' })
    const definition = await closeOrderDefinition()
    await remakeCloseOrder(`create function actions.close_order(p_order bigint, p_note text, p_actor text, p_amount numeric, p_tenant int) returns void
      language plpgsql immutable as $$ begin perform pg_catalog.nextval('actions.called'); raise exception 'formancy: refused: Never reviewed.'; end $$`)
    try {
      const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
      expect(actionAnswer(outcome)).toBe('schema-changed')
      expect(begun).toBe(0)
    } finally {
      await remakeCloseOrder(definition)
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
      const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
      expect(actionAnswer(outcome)).toBe(expected('execute-revoked'))
      expect(begun).toBe(0)
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
      const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
      expect(actionAnswer(outcome)).toBe('done')
      expect(begun).toBe(1)
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
    const { outcome, begun } = await counted(() => actions.run(request, 1_000))
    const waited = performance.now() - started
    await released
    expect(actionAnswer(outcome)).toBe(expected('held-lock'))
    // Answered at its deadline, not when the holder let go at 2.5 s.
    expect(waited).toBeLessThan(2_000)
    expect(begun).toBe(0)
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // The routine runs past the deadline: the server stops it, 57014, and
  // the run is rolled back, its call record with it. Watched failing with
  // no statement timeout set: "expected 'done' to be 'action-timeout'".
  test('stops a routine that runs past the deadline', covers('postgres', actionCase('slow-routine')), async () => {
    const id = await order()
    const { outcome, begun } = await counted(() => closed(id, 'sleep 2.5', 1_000))
    expect(actionAnswer(outcome)).toBe(expected('slow-routine'))
    expect(begun).toBe(1)
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
 * The locked path (0041): a connection whose transactions are REPEATABLE
 * READ, which a composition root may make the default, takes the root's
 * table lock before the lock statement, whose snapshot is then the
 * transaction's for the call too. The deadline cases again, a wait for the
 * table, and a routine changed while the lock waited.
 */
describe('a run on the locked path, under REPEATABLE READ', () => {
  let repeatable: Sql
  let locked: ActionAdapter

  beforeAll(() => {
    repeatable = postgres(fixture.writer, { onnotice: () => {}, connection: { default_transaction_isolation: 'repeatable read' } })
    locked = createPostgresActions(repeatable)
  })

  afterAll(async () => {
    await repeatable?.end()
  })

  /** `close` over `id` with this note, planned on the locked path. */
  async function plannedLocked(id: number, note: string): Promise<ActionRequest> {
    return plannedAction(locked, forms.orders, 'close', { record: actionToken(id), version: await versionOf('order', id), answers: { note } })
  }

  /** Holds the order table in SHARE mode, which a write's ROW EXCLUSIVE waits for, until `release` is called. */
  async function holdTable(): Promise<{ release: () => Promise<void> }> {
    const holder = postgres(fixture.admin, { max: 1, onnotice: () => {} })
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let held!: () => void
    const holding = new Promise<void>((resolve) => (held = resolve))
    const done = holder.begin(async (tx) => {
      await tx`lock table actions."order" in share mode`
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

  // The description was read under REPEATABLE READ, so the run takes the
  // locked path, and its statements stop at the deadline there as well.
  // Watched failing, as the next two were, with no statement timeout set on
  // the locked path: "expected 2512.0608999999986 to be less than 2000".
  test('stops a lock held past the deadline', async () => {
    const id = await order()
    const request = await plannedLocked(id, 'waited')
    const holder = await hold(id)
    const released = new Promise((resolve) => setTimeout(resolve, 2_500)).then(() => holder.release())
    const started = performance.now()
    const { outcome, begun } = await counted(() => locked.run(request, 1_000))
    const waited = performance.now() - started
    await released
    expect(actionAnswer(outcome)).toBe('action-timeout')
    expect(waited).toBeLessThan(2_000)
    expect(begun).toBe(0)
  })

  // Watched failing: "expected 'done' to be 'action-timeout'".
  test('stops a routine that runs past the deadline', async () => {
    const id = await order()
    const request = await plannedLocked(id, 'sleep 2.5')
    const { outcome, begun } = await counted(() => locked.run(request, 1_000))
    expect(actionAnswer(outcome)).toBe('action-timeout')
    expect(begun).toBe(1)
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // Watched failing: "expected 'done' to be 'action-timeout'".
  test('stops a run whose statements each fit the deadline and together do not', async () => {
    const id = await order()
    const request = await plannedLocked(id, 'sleep 1.2')
    const holder = await hold(id)
    const released = new Promise((resolve) => setTimeout(resolve, 1_200)).then(() => holder.release())
    const outcome = await locked.run(request, 2_000)
    await released
    expect(actionAnswer(outcome)).toBe('action-timeout')
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // The table lock waits behind a SHARE lock as DDL takes it, a second,
  // and the lock statement then waits for a row held past the deadline:
  // each is set to what remains, so the run stops at its deadline, where
  // one SET for both let each wait the whole of it. Watched failing with
  // the SET after the table lock left out: "expected 3012.673600000002 to
  // be less than 2700".
  test('stops at the deadline a wait for the table followed by a wait for the row', async () => {
    const id = await order()
    const request = await plannedLocked(id, 'waited')
    const row = await hold(id)
    const table = await holdTable()
    const tableReleased = new Promise((resolve) => setTimeout(resolve, 1_000)).then(() => table.release())
    // Let go at 4 s whatever the run does, so a run nothing stops ends too.
    const rowReleased = new Promise((resolve) => setTimeout(resolve, 4_000)).then(() => row.release())
    const started = performance.now()
    const outcome = await locked.run(request, 2_000)
    const waited = performance.now() - started
    await Promise.all([tableReleased, rowReleased])
    expect(actionAnswer(outcome)).toBe('action-timeout')
    expect(waited).toBeLessThan(2_700)
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // The lock statement waits for a row another transaction holds and does
  // not change, which REPEATABLE READ lets through, while close_order is
  // made SECURITY DEFINER: committed after the transaction's snapshot was
  // taken, so pg_proc read under it shows the routine as described, while
  // the call finds the routine through the catalog cache, as it now is.
  // The call is guarded on this path by the routine's whole definition as
  // the cache holds it, so nothing is called. Watched failing with that
  // guard left out: "expected 'done' to be 'schema-changed'".
  test('never calls a routine changed in place while its lock waited', async () => {
    const id = await order()
    const request = await plannedLocked(id, 'definer')
    const holder = await hold(id)
    let released = false
    try {
      const { outcome, begun } = await counted(async () => {
        const running = locked.run(request, DEADLINE)
        await until(() => waitingOnLock('with "locked" as materialized%'), 'seen the lock waiting on the held row')
        await owner`alter function actions.close_order(bigint, text, text, numeric, int) security definer`
        released = true
        await holder.release()
        return running
      })
      expect(actionAnswer(outcome)).toBe('schema-changed')
      expect(begun).toBe(0)
      expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    } finally {
      if (!released) await holder.release()
      await owner`alter function actions.close_order(bigint, text, text, numeric, int) security invoker`
    }
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
