import type { ActionAdapter, ActionOutcome, ActionRequest, PolicyContext } from '@formancy/data-core'
import {
  ACTION_CLERK,
  ACTION_DECLINED_REASON,
  ACTION_SCOPE,
  actionAnswer,
  actionCase,
  actionExpected,
  actionForms,
  actionToken,
  covers,
  plannedAction,
  startSqlServerFixture,
} from '@formancy/data-fixtures'
import type { ActionBundle, ActionCase, ActionForms, SqlServerFixture } from '@formancy/data-fixtures'
import mssql from 'mssql'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { connectSqlServer, createSqlServerActions, discoverSqlServer } from './index.js'

/*
 * An action's run over the open record (0160) against REAL SQL Server
 * loaded with the actions schema (fixtures/sqlserver.actions.sql). Each
 * shared case's answer is written once in `@formancy/data-fixtures`
 * (`ACTION_PARITY`), and the PostgreSQL suite runs the same cases, each
 * declared with `covers()` (0035); the cases only SQL Server has -- a
 * procedure's status, a procedure that ends the run's transaction, a
 * rowversion form, an argument whose code page lacks a character -- and the
 * engine facts a run rests on, follow them.
 *
 * Every run goes as formancy_writer, the account discovery reads the schema
 * as, but where a case says another. Every request is the planner's
 * (`plannedAction`), planned before anything a case changes in the
 * database. The owner inserts what a case starts from, and reads what is
 * stored, which calls each procedure kept, and how many began: each
 * procedure draws from the sequence actions.called as it begins, which no
 * rollback gives back, so a procedure "not called" is one that drew
 * nothing (`counted`), and one called and rolled back drew and kept
 * nothing. Every case that says "calls nothing" was watched failing on that
 * count, with the EXEC and its arguments moved before the lock: the answer
 * the same, the count one.
 *
 * Each case says which failure it prevents and was watched failing on
 * mcr.microsoft.com/mssql/server:2022-latest on 2026-11-16, its rule taken
 * out and put back.
 */

let fixture: SqlServerFixture
let owner: mssql.ConnectionPool
let writer: mssql.ConnectionPool
let actions: ActionAdapter
let forms: ActionForms

/** The deadline a case runs under unless it is about the deadline. */
const DEADLINE = 10_000
/** How long a case waits for the database to reach a state it polls for. Generous: a loaded runner, not a measurement. */
const PATIENCE_MS = 15_000

beforeAll(async () => {
  fixture = await startSqlServerFixture()
  owner = await new mssql.ConnectionPool(fixture.admin).connect()
  writer = await new mssql.ConnectionPool(fixture.writer).connect()
  forms = actionForms(await discoverSqlServer(writer, ACTION_SCOPE))
  actions = createSqlServerActions(writer)
})

afterAll(async () => {
  await writer?.close()
  await owner?.close()
  await fixture?.stop()
})

const expected = (name: ActionCase): string => actionExpected(name, 'sqlserver')

/** One statement as the owner, its values bound by name: its rows. */
async function query<Row>(sql: string, values: Record<string, number | string> = {}): Promise<Row[]> {
  const request = owner.request()
  for (const [name, value] of Object.entries(values)) request.input(name, typeof value === 'number' ? mssql.BigInt : mssql.NVarChar(mssql.MAX), value)
  const result = await request.query<Row>(sql)
  return [...(result.recordset ?? [])]
}

async function customer(tenant: number): Promise<number> {
  const [row] = await query<{ id: string }>("insert into actions.customer (tenant_id, name) output inserted.id values (@tenant, N'Customer')", { tenant })
  return Number((row as { id: string }).id)
}

/** An order of a new customer of `tenant`, its amount 12.50; its id. */
async function order(tenant = 1): Promise<number> {
  const [row] = await query<{ id: string }>('insert into actions.[order] (customer_id, amount) output inserted.id values (@customer, 12.50)', {
    customer: await customer(tenant),
  })
  return Number((row as { id: string }).id)
}

async function stored(id: number): Promise<{ status: string; note: string | null; version: number }> {
  const [row] = await query<{ status: string; note: string | null; version: number }>('select status, note, version from actions.[order] where id = @id', {
    id,
  })
  return { ...(row as { status: string; note: string | null; version: number }) }
}

/** Every call `routines` recorded for `id`, as `routine:note:actor:amount:tenant`. */
async function calls(id: number, routines: readonly string[] = ['close_order', 'broken_order']): Promise<string[]> {
  const rows = await query<{ call: string }>(
    `select concat_ws(':', routine, note, actor, convert(nvarchar(20), amount), convert(nvarchar(20), tenant)) as [call] from actions.call
     where record_id = @id and routine in (${routines.map((_, index) => `@r${String(index)}`).join(', ')}) order by id`,
    { id, ...Object.fromEntries(routines.map((routine, index) => [`r${String(index)}`, routine])) },
  )
  return rows.map((row) => row.call)
}

/** How many calls of the actions schema's procedures have begun, as the sequence each draws from as it begins counts them. */
async function begun(): Promise<number> {
  const [row] = await query<{ n: string }>(
    "select convert(nvarchar(20), coalesce(convert(bigint, last_used_value), 0)) as n from sys.sequences where object_id = object_id(N'actions.called')",
  )
  return Number((row as { n: string }).n)
}

/** `run`'s outcome, and how many procedure calls began while it ran: a rollback takes back what a call kept, and never that it began. */
async function counted<T>(run: () => Promise<T>): Promise<{ outcome: T; begun: number }> {
  const before = await begun()
  const outcome = await run()
  return { outcome, begun: (await begun()) - before }
}

/** The version token a person read `id` at: a version column's decimal text, or a rowversion's hex. */
async function versionOf(table: 'order' | 'price' | 'ticket', id: number): Promise<string> {
  const column = table === 'ticket' ? 'lower(convert(nvarchar(16), convert(binary(8), row_version), 2))' : 'convert(nvarchar(20), version)'
  const [row] = await query<{ version: string }>(`select ${column} as version from actions.[${table}] where id = @id`, { id })
  return (row as { version: string }).version
}

/** SQL Server's rowversion form, which the actions schema has on this engine alone. */
function tickets(): ActionBundle {
  if (forms.tickets === undefined) throw new Error('the actions schema has no ticket form on SQL Server')
  return forms.tickets
}

const tableOf = (bundle: ActionBundle): 'order' | 'price' | 'ticket' => (bundle === forms.prices ? 'price' : bundle === forms.tickets ? 'ticket' : 'order')

async function planned(
  name: string,
  id: number,
  answers: Record<string, unknown> = {},
  bundle: ActionBundle = forms.orders,
  context?: PolicyContext,
): Promise<ActionRequest> {
  const version = await versionOf(tableOf(bundle), id)
  return plannedAction(actions, bundle, name, { record: actionToken(id), version, answers }, context)
}

async function closed(id: number, note: string, deadlineMs = DEADLINE): Promise<ActionOutcome> {
  return actions.run(await planned('close', id, { note }), deadlineMs)
}

async function until(read: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  while (!(await read())) {
    if (Date.now() > deadline) throw new Error(`never ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** A pool of one connection: every request on it is one session. */
const session = (): Promise<mssql.ConnectionPool> => new mssql.ConnectionPool({ ...fixture.admin, pool: { min: 0, max: 1 } }).connect()

async function spidOf(pool: mssql.ConnectionPool): Promise<number> {
  const result = await pool.request().query<{ spid: number }>('select @@spid as spid')
  return (result.recordset[0] as { spid: number }).spid
}

/** Whether `spid` is waiting on another session's lock. */
async function blocked(spid: number): Promise<boolean> {
  const result = await owner
    .request()
    .input('spid', mssql.Int, spid)
    .query<{ blocker: number }>('select blocking_session_id as blocker from sys.dm_exec_requests where session_id = @spid')
  return (result.recordset[0]?.blocker ?? 0) > 0
}

/** Holds `id`'s order row, X-locked, in a transaction of its own until `release` is called. */
async function hold(id: number): Promise<{ release: () => Promise<void> }> {
  const pool = await session()
  const transaction = new mssql.Transaction(pool)
  await transaction.begin()
  await new mssql.Request(transaction).input('id', mssql.BigInt, id).query('update actions.[order] set note = note where id = @id')
  let released = false
  return {
    release: async () => {
      if (released) return
      released = true
      await transaction.rollback()
      await pool.close()
    },
  }
}

/** close_order's own CREATE, as the catalog holds it. */
async function closeOrderDefinition(): Promise<string> {
  const [row] = await query<{ text: string }>("select object_definition(object_id(N'actions.close_order')) as [text]")
  return (row as { text: string }).text
}

describe('a run over the open record', () => {
  // The run commits: the version moved by one in the run's own UPDATE, the
  // order closed by the procedure, which was given the key, the answer, the
  // actor's id, the amount read from the locked row and the tenant. Watched
  // failing with the version set to itself: "expected { status: 'closed',
  // …(2) } to deeply equal { status: 'closed', …(2) }", the version 1.
  test('commits, moves the version, and gives the routine each value', covers('sqlserver', actionCase('done')), async () => {
    const id = await order()
    const { outcome, begun } = await counted(() => closed(id, 'shipped'))
    expect(begun).toBe(1)
    expect(actionAnswer(outcome)).toBe(expected('done'))
    expect(outcome).toEqual({ ok: true, records: [{ id: String(id) }] })
    expect(await stored(id)).toEqual({ status: 'closed', note: 'shipped', version: 2 })
    expect(await calls(id)).toEqual(['close_order:shipped:clara:12.50:1'])
  })

  // Two runs from one read: the second is `stale`, the procedure called
  // once. Watched failing with the version left out of the lock's WHERE:
  // "expected 'done' to be 'stale'".
  test('runs once from one read: the second is stale', covers('sqlserver', actionCase('second-run')), async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'once' })
    expect(actionAnswer(await actions.run(request, DEADLINE))).toBe('done')
    const second = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(second.outcome)).toBe(expected('second-run'))
    expect(second.begun).toBe(0)
    expect(await calls(id)).toEqual(['close_order:once:clara:12.50:1'])
  })

  // A token minted for another tenant's order addresses nothing, and the
  // procedure is never handed it. Watched failing with the throughs left out
  // of the lock: "expected 'done' to be 'not-found'".
  test("is not-found for another tenant's record, and calls nothing", covers('sqlserver', actionCase('other-tenant')), async () => {
    const id = await order(2)
    const { outcome, begun } = await counted(() => closed(id, 'theirs'))
    expect(actionAnswer(outcome)).toBe(expected('other-tenant'))
    expect(begun).toBe(0)
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // The customer the order is scoped through is read WITH (HOLDLOCK), held
  // to the run's COMMIT: a move of it to another tenant waits for the run.
  // Watched failing with the hint taken out of the through: "never seen
  // waiting on the run's lock".
  test("holds the record's parent: a move to another tenant waits for the run", covers('sqlserver', actionCase('parent-moved')), async () => {
    const id = await order()
    const [row] = await query<{ customer_id: string }>('select customer_id from actions.[order] where id = @id', { id })
    const parent = Number((row as { customer_id: string }).customer_id)
    const running = closed(id, 'sleep 1.5')
    await until(
      async () => (await query<{ n: number }>("select count(*) as n from sys.dm_exec_requests where wait_type = 'WAITFOR'"))[0]?.n !== 0,
      'seen the procedure running',
    )
    const mover = await session()
    try {
      const spid = await spidOf(mover)
      const moving = mover.request().input('id', mssql.BigInt, parent).query('update actions.customer set tenant_id = 2 where id = @id')
      // Seen blocked while the run still holds the parent: the run's COMMIT
      // releases it before the run's answer arrives, so which answer reaches
      // this process first says nothing.
      await until(() => blocked(spid), "seen waiting on the run's lock")
      const outcome = await running
      await moving
      expect(actionAnswer(outcome)).toBe(expected('parent-moved'))
    } finally {
      await mover.close()
    }
  })

  // The open version alone: an ended one is `version-ended`, `reprice` not
  // called. Watched failing with the open-version condition taken out of the
  // lock: "expected 'done' to be 'version-ended'".
  test('is version-ended over a version that has ended, and calls nothing', covers('sqlserver', actionCase('version-ended')), async () => {
    const parent = await customer(1)
    const [ended] = await query<{ id: string }>(
      "insert into actions.price (customer_id, product_no, valid_from, valid_to, amount) output inserted.id values (@parent, 7, '2026-01-01', '2026-06-01', 10)",
      { parent },
    )
    await query("insert into actions.price (customer_id, product_no, valid_from, amount) values (@parent, 7, '2026-06-01', 11)", { parent })
    const id = Number((ended as { id: string }).id)
    const request = await planned('reprice', id, {}, forms.prices)
    const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('version-ended'))
    expect(begun).toBe(0)
  })
})

describe("a run the deployment's logic refuses", () => {
  // The procedure's THROW under `formancy: refused: ` reaches the person, its
  // words alone, and the run is rolled back. Watched failing with an error
  // inside the procedure never read as worded for the person: "expected
  // 'refused' to be 'declined'".
  test('is declined with the routine’s words, and keeps nothing', covers('sqlserver', actionCase('declined')), async () => {
    const id = await order()
    const { outcome, begun } = await counted(() => closed(id, 'refuse'))
    expect(actionAnswer(outcome)).toBe(expected('declined'))
    expect(outcome.ok ? undefined : outcome.reason).toBe(ACTION_DECLINED_REASON)
    expect(begun).toBe(1)
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    expect(await calls(id)).toEqual([])
  })

  // A THROW without the prefix is the server's own words: `refused`, its
  // message never passed on. Watched failing with every error inside the
  // procedure declined, its message the reason: "expected 'declined' to be
  // 'refused'".
  test('is refused for an error not worded for the person', covers('sqlserver', actionCase('refused')), async () => {
    const id = await order()
    const outcome = await closed(id, 'plain')
    expect(actionAnswer(outcome)).toBe(expected('refused'))
    expect(JSON.stringify(outcome)).not.toContain('not worded')
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // The procedure's body sets a column dropped after it was created, 207,
  // which a write answers `schema-changed`: inside the procedure it is the
  // deployment's, `refused`. Watched failing with ERROR_PROCEDURE() unasked:
  // "expected 'schema-changed' to be 'refused'".
  test('is refused when the routine’s body references a missing column', covers('sqlserver', actionCase('missing-column')), async () => {
    const id = await order()
    const request = await planned('broken', id)
    const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('missing-column'))
    expect(begun).toBe(0)
    expect(await calls(id)).toEqual([])
  })

  // A status other than 0 is how a T-SQL procedure reports failure without
  // an error (0159): it refuses the run, which is rolled back, its call
  // record with it. Watched failing with the status unasked: "expected
  // 'done' to be 'refused'".
  test('is refused, and rolled back, when the procedure returns a status other than 0', async () => {
    const id = await order()
    const { outcome, begun } = await counted(() => closed(id, 'status'))
    expect(actionAnswer(outcome)).toBe('refused')
    expect(begun).toBe(1)
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    expect(await calls(id)).toEqual([])
  })

  // A procedure that COMMITs the run's transaction has stored what came
  // before it -- the version moved, its call recorded -- and SQL Server
  // raises 266 as it returns: what happened is not the run's to tell, so it
  // is `unknown-outcome`, and here it did commit. Watched failing with
  // CATCH not asking whether the transaction was still the batch's:
  // "expected 'refused' to be 'unknown-outcome'".
  test('is unknown-outcome when the procedure commits the transaction', async () => {
    const id = await order()
    expect(actionAnswer(await closed(id, 'commit'))).toBe('unknown-outcome')
    expect(await stored(id)).toMatchObject({ status: 'closed', version: 2 })
    expect(await calls(id)).toEqual(['close_order:commit:clara:12.50:1'])
  })

  // A procedure that ROLLs BACK and raises: the transaction the batch began
  // is gone before CATCH reads it, which it cannot tell from a COMMIT
  // (0031 P8). `unknown-outcome`, over-reported: here nothing was kept.
  // Watched failing the same way: "expected 'refused' to be
  // 'unknown-outcome'".
  test('is unknown-outcome when the procedure rolls back and raises', async () => {
    const id = await order()
    expect(actionAnswer(await closed(id, 'rollback'))).toBe('unknown-outcome')
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    expect(await calls(id)).toEqual([])
  })
})

describe('a run whose routine changed after it was described', () => {
  // Dropped and created again: another object_id, so the guard just before
  // the EXEC refuses it, and nothing is called. Watched failing with the
  // guard taken out: "expected 'done' to be 'schema-changed'".
  test('is schema-changed when the routine was dropped and created again, and calls nothing', covers('sqlserver', actionCase('recreated')), async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'recreated' })
    const definition = await closeOrderDefinition()
    await owner.request().batch('drop procedure actions.close_order')
    await owner.request().batch(definition)
    const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(outcome)).toBe(expected('recreated'))
    expect(begun).toBe(0)
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // Made to EXECUTE AS OWNER: SQL Server's SECURITY DEFINER. Ownership
  // chaining reaches the owner's tables whatever the procedure says
  // (0158), and stops at dynamic SQL, another owner's objects and another
  // database, which EXECUTE AS OWNER reaches as the owner: the procedure is
  // not the one the run was decided over, as on PostgreSQL. Watched failing
  // with EXECUTE AS left out of the procedure's facts: "expected 'done' to
  // be 'schema-changed'".
  test('is schema-changed when the routine was made to EXECUTE AS OWNER, and calls nothing', covers('sqlserver', actionCase('reach-changed')), async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'definer' })
    const definition = await closeOrderDefinition()
    const altered = definition.replace('create procedure', 'alter procedure')
    await owner.request().batch(altered.replace('@p_tenant int as', '@p_tenant int with execute as owner as'))
    try {
      const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
      expect(actionAnswer(outcome)).toBe(expected('reach-changed'))
      expect(begun).toBe(0)
    } finally {
      await owner.request().batch(altered)
    }
  })

  // EXECUTE denied where the schema grants it: the procedure stays in
  // sight, VIEW DEFINITION and EXECUTE on the schema both reach it, and
  // HAS_PERMS_BY_NAME is asked before the EXEC, the account's grant and not
  // the procedure's refusal. Watched failing with the question taken out,
  // the EXEC's own 229 naming the procedure: "expected 'refused' to be
  // 'permission-denied'".
  test('is permission-denied when EXECUTE was denied', async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'revoked' })
    await owner.request().batch('deny execute on actions.close_order to formancy_writer')
    try {
      const { outcome, begun } = await counted(() => actions.run(request, DEADLINE))
      expect(actionAnswer(outcome)).toBe('permission-denied')
      expect(begun).toBe(0)
      expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    } finally {
      await owner.request().batch('revoke execute on actions.close_order from formancy_writer')
    }
  })
})

/*
 * An account whose only permission on the procedure is EXECUTE on it, the
 * grant a deployment usually makes, beside SELECT, UPDATE and VIEW
 * DEFINITION on the two tables a run reads, so that it describes the root
 * as the writer does. SQL Server shows an account only what it holds some
 * permission on: once that EXECUTE is revoked, the procedure is out of its
 * sight, as one dropped would be.
 */
describe('a run as an account whose only permission on the procedure is EXECUTE', () => {
  const RUNNER = 'action_runner'
  const RUNNER_PASSWORD = 'Runner-fixture-password-1'
  let runner: mssql.ConnectionPool
  let running: ActionAdapter

  beforeAll(async () => {
    await owner
      .request()
      .batch(
        `create login ${RUNNER} with password = N'${RUNNER_PASSWORD}', check_policy = off; create user ${RUNNER} for login ${RUNNER}; ` +
          `grant select, update, view definition on actions.[order] to ${RUNNER}; grant select, update, view definition on actions.customer to ${RUNNER}; ` +
          `grant execute on actions.close_order to ${RUNNER};`,
      )
    runner = await new mssql.ConnectionPool({ ...fixture.admin, user: RUNNER, password: RUNNER_PASSWORD }).connect()
    running = createSqlServerActions(runner)
  })

  afterAll(async () => {
    await runner?.close()
    await owner.request().batch(`drop user ${RUNNER}; drop login ${RUNNER};`)
  })

  /** What the runner sees of close_order, and of a procedure that does not exist, by the name a run binds. */
  async function sight(): Promise<{ id: number | null; perms: number | null; missing: number | null }> {
    const result = await runner.request().query<{
      id: number | null
      perms: number | null
      missing: number | null
    }>("select object_id(N'[actions].[close_order]') as [id], has_perms_by_name(N'[actions].[close_order]', N'OBJECT', N'EXECUTE') as [perms], has_perms_by_name(N'[actions].[no_such_procedure]', N'OBJECT', N'EXECUTE') as [missing]")
    return result.recordset[0] as { id: number | null; perms: number | null; missing: number | null }
  }

  // EXECUTE revoked, the only permission the account held on the
  // procedure: OBJECT_ID no longer finds it, as for one dropped, and
  // HAS_PERMS_BY_NAME answers 0 for it as it does for a name nothing holds.
  // So nothing the account can ask tells a procedure out of its sight from
  // one gone, and a run answers both as gone. Measured on
  // mcr.microsoft.com/mssql/server:2022-latest on 2026-11-16, where NULL for
  // the name nothing holds, as the documentation's "the securable is not
  // valid" suggests, was asserted and 0 came back.
  test('loses sight of the procedure once its only EXECUTE is revoked, and cannot tell that from one that is not there', async () => {
    const before = await sight()
    await owner.request().batch(`revoke execute on actions.close_order from ${RUNNER}`)
    try {
      expect({ before, after: await sight() }).toEqual({
        before: { id: expect.any(Number), perms: 1, missing: 0 },
        after: { id: null, perms: 0, missing: 0 },
      })
    } finally {
      await owner.request().batch(`grant execute on actions.close_order to ${RUNNER}`)
    }
  })

  // The shared case, in the grant shape a deployment makes: EXECUTE taken
  // from the account leaves the procedure out of its sight, so the run and
  // a description made after the revoke, as the route will make one, find
  // it gone, `schema-changed`, where PostgreSQL, whose pg_proc the account
  // still reads, is `permission-denied`: the engines' difference
  // ACTION_PARITY names. Nothing is called either way. Watched failing
  // with PostgreSQL's answer asserted: "expected { run: 'schema-changed',
  // …(1) } to deeply equal { run: 'permission-denied', …(1) }".
  test('is permission-denied when EXECUTE was revoked', covers('sqlserver', actionCase('execute-revoked')), async () => {
    const id = await order()
    const request = await plannedAction(running, forms.orders, 'close', {
      record: actionToken(id),
      version: await versionOf('order', id),
      answers: { note: 'revoked' },
    })
    await owner.request().batch(`revoke execute on actions.close_order from ${RUNNER}`)
    try {
      const { outcome, begun } = await counted(() => running.run(request, DEADLINE))
      const described = await running.describe(request.target.table, request.routine.ref)
      expect({ run: actionAnswer(outcome), described: described.ok ? 'done' : described.code }).toEqual({
        run: expected('execute-revoked'),
        described: expected('execute-revoked'),
      })
      expect(begun).toBe(0)
      expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
    } finally {
      await owner.request().batch(`grant execute on actions.close_order to ${RUNNER}`)
    }
  })
})

describe("a run and its deadline, SQL Server's lock timeout and request timeout", () => {
  // Another transaction holds the order's row: the lock waits LOCK_TIMEOUT,
  // half the deadline, and 1222 is a known rollback, `unavailable`. Watched
  // failing with no LOCK_TIMEOUT set, the request timeout ending the wait:
  // "expected 'unknown-outcome' to be 'unavailable'".
  test('ends a lock wait past LOCK_TIMEOUT', covers('sqlserver', actionCase('held-lock')), async () => {
    const id = await order()
    const request = await planned('close', id, { note: 'waited' })
    const holder = await hold(id)
    try {
      const started = performance.now()
      const { outcome, begun } = await counted(() => actions.run(request, 2_000))
      const waited = performance.now() - started
      expect(actionAnswer(outcome)).toBe(expected('held-lock'))
      expect(waited).toBeLessThan(2_000)
      expect(begun).toBe(0)
    } finally {
      await holder.release()
    }
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })

  // The procedure runs past the deadline: mssql sends an attention, and the
  // client's ETIMEOUT may follow a COMMIT (0031 P3), so the answer is
  // `unknown-outcome`. xact_abort rolls the run back on the attention: here
  // nothing was kept, which the answer cannot claim. Watched failing with
  // mssql's own 15 s in place of the deadline: "expected 'done' to be
  // 'unknown-outcome'".
  test('is unknown-outcome past the deadline, and rolled back', covers('sqlserver', actionCase('slow-routine')), async () => {
    const id = await order()
    const { outcome, begun } = await counted(() => closed(id, 'sleep 2.5', 1_000))
    expect(actionAnswer(outcome)).toBe(expected('slow-routine'))
    expect(begun).toBe(1)
    await until(async () => (await calls(id)).length === 0 && (await stored(id)).version === 1, 'seen the run rolled back')
    expect(await stored(id)).toMatchObject({ status: 'open', version: 1 })
  })
})

describe("a run on SQL Server's own ground", () => {
  /** A ticket labelled `label`, inserted as the owner; its id. */
  async function ticket(label: string): Promise<number> {
    const [row] = await query<{ id: string }>('insert into actions.ticket (label) output inserted.id values (@label)', { label })
    return Number((row as { id: string }).id)
  }

  /** `label` over `id` with this remark, as `actor`. */
  async function labelled(id: number, remark: string, actor = 'clara'): Promise<ActionOutcome> {
    const context: PolicyContext = { ...ACTION_CLERK, actor: { ...ACTION_CLERK.actor, id: actor } }
    return actions.run(await planned('label', id, { remark }, tickets(), context), DEADLINE)
  }

  // A rowversion form's run moves the rowversion by setting its confirmed
  // touch column to itself (0155, 0159), so a second run from the same read
  // is `stale`. Watched failing with the version left out of the lock's
  // WHERE: "expected 'done' to be 'stale'".
  test('moves a rowversion through its touch column', async () => {
    const id = await ticket('Alpha')
    const before = await versionOf('ticket', id)
    const request = await planned('label', id, { remark: 'once' }, tickets())
    expect(actionAnswer(await actions.run(request, DEADLINE))).toBe('done')
    expect(await versionOf('ticket', id)).not.toBe(before)
    const second = await counted(() => actions.run(request, DEADLINE))
    expect(actionAnswer(second.outcome)).toBe('stale')
    expect(second.begun).toBe(0)
    expect(await calls(id, ['label_ticket'])).toEqual(['label_ticket:Alpha|once:clara'])
  })

  // Every argument of a parameter that counts code-page bytes reads back as
  // it was given, or the run is refused and nothing called: SQL Server
  // writes a character the page lacks as `?` without an error (0159,
  // Decision 3). The label is a column under Greek_CI_AS, code page 1253;
  // the parameters take the database's, 1252. A character 1252 has passes.
  // Watched failing with the read-back checks taken out: "expected 'done'
  // to be 'refused'".
  test('refuses an argument its parameter’s code page cannot hold, whatever its source, and calls nothing', async () => {
    const answered = async (id: number, remark: string, actor?: string) => {
      const { outcome, begun } = await counted(() => labelled(id, remark, actor))
      return { answer: actionAnswer(outcome), begun }
    }
    const column = await ticket('Ωμέγα')
    expect(await answered(column, 'plain')).toEqual({ answer: 'refused', begun: 0 })
    const answer = await ticket('Alpha')
    expect(await answered(answer, 'Ω')).toEqual({ answer: 'refused', begun: 0 })
    const context = await ticket('Alpha')
    expect(await answered(context, 'plain', 'Ωmega')).toEqual({ answer: 'refused', begun: 0 })
    const held = await ticket('Alpha')
    expect(await answered(held, 'Zoë', 'Zoë')).toEqual({ answer: 'done', begun: 1 })
    expect(await calls(held, ['label_ticket'])).toEqual(['label_ticket:Alpha|Zoë:Zoë'])
  })
})

/*
 * What SQL Server does that a run rests on, measured with plain statements
 * through mssql, each `query` sent as `sp_executesql` as the adapter's are,
 * no product code, as save-facts' are. Each was watched failing with the
 * opposite asserted, on mcr.microsoft.com/mssql/server:2022-latest on
 * 2026-11-16.
 */
describe('what a run rests on', () => {
  /** The number and ERROR_PROCEDURE() of the error `body` raises, read in CATCH as the run's batch reads them, as the owner. */
  const procedureOf = async (body: string): Promise<{ number: number; procedure: string | null }> => {
    const [row] = await query<{ number: number; procedure: string | null }>(
      `declare @n int, @p nvarchar(128); begin try ${body} end try begin catch select @n = error_number(), @p = error_procedure() end catch; select @n as number, @p as [procedure]`,
    )
    return row as { number: number; procedure: string | null }
  }

  // The run tells an error inside a procedure or a trigger from one in its
  // own batch by ERROR_PROCEDURE() (actions/errors.ts): in CATCH it names
  // the procedure, schema and all, for a 207 at its recompilation; the
  // trigger by its name alone; and nothing for the batch's own statement.
  // And it names the procedure for a 229 at an EXEC the account may not
  // run, as for an error inside it: so the batch asks HAS_PERMS_BY_NAME
  // before the EXEC rather than read where a 229 arose. Watched failing
  // with the trigger asserted schema-qualified, as the procedure is:
  // expected "actions.refuse_customer", received "refuse_customer".
  test('names the procedure or the trigger an error arose in, and nothing for the batch’s own', async () => {
    await owner.request().batch("create trigger actions.refuse_customer on actions.customer after update as throw 50010, N'from a trigger', 1;")
    try {
      expect(await procedureOf('exec actions.broken_order 0;')).toEqual({ number: 207, procedure: 'actions.broken_order' })
      expect(await procedureOf('update actions.customer set name = name where id = 0;')).toEqual({ number: 50010, procedure: 'refuse_customer' })
      expect(await procedureOf("throw 50011, N'from the batch', 1;")).toEqual({ number: 50011, procedure: null })
      await owner.request().batch('deny execute on actions.reprice to formancy_writer')
      const [denied] = (
        await writer
          .request()
          .query<{ number: number; procedure: string | null }>(
            'declare @n int, @p nvarchar(128); begin try exec actions.reprice 0; end try begin catch select @n = error_number(), @p = error_procedure() end catch; select @n as number, @p as [procedure]',
          )
      ).recordset
      expect(denied).toEqual({ number: 229, procedure: 'actions.reprice' })
    } finally {
      await owner.request().batch('drop trigger actions.refuse_customer; revoke execute on actions.reprice from formancy_writer;')
    }
  })

  // A run sets LOCK_TIMEOUT inside its batch, and its request may end in an
  // attention at the deadline. The setting ends with the request even then:
  // the next request on the same session waits as long as it would have.
  // Watched failing with the setting asserted to outlive it: "expected {
  // timeout: -1, spid: 91 } to deeply equal { timeout: 200, spid: 91 }".
  test('ends a SET LOCK_TIMEOUT with its request, an attention included', async () => {
    const pool = await new mssql.ConnectionPool({ ...fixture.admin, requestTimeout: 500, pool: { min: 0, max: 1 } }).connect()
    try {
      const spid = await spidOf(pool)
      await expect(pool.request().query("set lock_timeout 200; waitfor delay '00:00:02'")).rejects.toMatchObject({ code: 'ETIMEOUT' })
      const after = await pool.request().query<{ timeout: number; spid: number }>('select @@lock_timeout as timeout, @@spid as spid')
      expect(after.recordset[0]).toEqual({ timeout: -1, spid })
    } finally {
      await pool.close()
    }
  })

  // An EXEC that does not fit the procedure's parameters -- one it lacks
  // (201), a parameter renamed among them, one it does not have where none
  // is lacking (8145), too many, by position or by name (8144), any to one
  // that takes none (8146) -- fails in the procedure's
  // own context, so ERROR_PROCEDURE() names the procedure called, as it
  // would an error inside it, and a procedure that calls another badly
  // names the one it called; an EXEC of no such procedure (2812) names
  // none, and one inside a procedure names the procedure it is in. So a run
  // reads where an EXEC failed to resolve by the procedure named and the
  // step, ahead of where an error arose (actions/errors.ts, errors.test.ts).
  // Watched failing with 8145 asserted for too many named arguments, and
  // for a name it does not have beside one it lacks, which SQL Server
  // answers 8144 and 201: "- "number": 8145, + "number": 8144", then "+
  // "number": 201".
  test('names the procedure an EXEC does not fit, the one called, and none for one there is not', async () => {
    await owner.request().batch('create procedure actions.no_parameters as begin set nocount on; end')
    await owner.request().batch('create procedure actions.optional_parameter @p int = 0 as begin set nocount on; end')
    await owner.request().batch('create procedure actions.calls_badly as begin set nocount on; exec actions.reprice; end')
    await owner.request().batch('create procedure actions.calls_missing as begin set nocount on; exec actions.no_such_procedure; end')
    try {
      expect({
        missing: await procedureOf('exec actions.no_such_procedure;'),
        lacks: await procedureOf('exec actions.reprice;'),
        renamed: await procedureOf('exec actions.reprice @p_other = 0;'),
        unknown: await procedureOf('exec actions.optional_parameter @q = 1;'),
        many: await procedureOf('exec actions.reprice 0, 1;'),
        manyNamed: await procedureOf('exec actions.reprice @p_price = 0, @p_other = 1;'),
        none: await procedureOf('exec actions.no_parameters @p = 1;'),
        nested: await procedureOf('exec actions.calls_badly;'),
        nestedMissing: await procedureOf('exec actions.calls_missing;'),
      }).toEqual({
        missing: { number: 2812, procedure: null },
        lacks: { number: 201, procedure: 'actions.reprice' },
        renamed: { number: 201, procedure: 'actions.reprice' },
        unknown: { number: 8145, procedure: 'actions.optional_parameter' },
        many: { number: 8144, procedure: 'actions.reprice' },
        manyNamed: { number: 8144, procedure: 'actions.reprice' },
        none: { number: 8146, procedure: 'actions.no_parameters' },
        nested: { number: 201, procedure: 'actions.reprice' },
        nestedMissing: { number: 2812, procedure: 'actions.calls_missing' },
      })
    } finally {
      await owner
        .request()
        .batch(
          'drop procedure actions.no_parameters; drop procedure actions.optional_parameter; drop procedure actions.calls_badly; drop procedure actions.calls_missing;',
        )
    }
  })

  // A procedure's result set reaches the client whatever the run makes of
  // it. Read as a query, mssql holds every row of it until the batch ends;
  // the run streams the batch, and a procedure that returns 20,000 rows of
  // 500 characters is run, and answered, as any other. That the rows are
  // dropped as they arrive is results.test.ts's. Watched failing with mssql
  // asserted to hold none: "expected [ …(20000) ] to have a length of +0
  // but got 20000".
  test('holds a whole result set when a batch is read as a query, and a run over a procedure that returns one is answered', async () => {
    const result = await owner.request().query("select top (20000) replicate(N'x', 500) as filler from sys.all_objects as a cross join sys.all_objects as b")
    expect(result.recordset).toHaveLength(20_000)
    const id = await order()
    expect(actionAnswer(await closed(id, 'rows 20000'))).toBe('done')
    expect(await stored(id)).toMatchObject({ status: 'closed', version: 2 })
  })

  // An action's pool is counted against its bound (0160). mssql reports no
  // bound: `size` is how many connections the pool holds now, and its
  // configuration names none unless one is given -- so drivers.ts gives
  // one, mssql's own default of 10. Watched failing with a bound asserted
  // of the pool given none: "expected undefined to be 10".
  test('reports no bound for a pool unless one is given', async () => {
    const options = {
      host: fixture.admin.server,
      port: fixture.admin.port ?? 1433,
      database: fixture.admin.database as string,
      encrypt: false,
      trustServerCertificate: true,
      user: fixture.admin.user as string,
      password: fixture.admin.password as string,
    }
    const unbound = await connectSqlServer(options)
    const bound = await connectSqlServer({ ...options, poolMax: 10 })
    // The configuration a pool was made with: mssql's own property, which its types do not declare.
    const configured = (pool: mssql.ConnectionPool): mssql.config => (pool as unknown as { config: mssql.config }).config
    try {
      expect(unbound.size).toBe(0)
      expect(configured(unbound).pool?.max).toBeUndefined()
      expect(configured(bound).pool?.max).toBe(10)
    } finally {
      await Promise.all([unbound.close(), bound.close()])
    }
  })
})
