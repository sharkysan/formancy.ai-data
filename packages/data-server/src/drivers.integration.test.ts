import type { ActionOutcome } from '@formancy/data-core'
import {
  ACTION_SCOPE,
  actionAnswer,
  actionForms,
  actionToken,
  plannedAction,
  POSTGRES_IMAGE,
  SQLSERVER_IMAGE,
  startPostgresFixture,
  startSqlServerFixture,
} from '@formancy/data-fixtures'
import type { ActionForms, PostgresFixture, SqlServerFixture } from '@formancy/data-fixtures'
import { connectPostgres } from '@formancy/data-postgres'
import { connectSqlServer } from '@formancy/data-sqlserver'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenConnection } from './connections.js'
import { DRIVER_FACTORIES, POSTGRES_ACTIONS_APPLICATION, SQLSERVER_ACTION_POOL, SQLSERVER_ACTIONS_APPLICATION } from './drivers.js'

/*
 * The connections `DRIVER_FACTORIES` opens, against REAL PostgreSQL and SQL
 * Server loaded with the actions schema (0003, 0160): a run goes on a
 * client of its own, which the database names as the actions' -- on the
 * records' pool, a handful of slow runs would stall every read and write of
 * every form on the database, and nothing else in the suites would notice.
 * One engine's fixture at a time, on its default image as every server
 * suite is (0067): each describe starts its own and stops it.
 * Every run goes as formancy_writer, the account the forms run as, planned
 * as the route will plan it (`plannedAction`). The owner reads the server
 * around them, through the adapter packages' own drivers, as the server
 * imports none.
 *
 * Each case says which failure it prevents and was watched failing on the
 * default images on 2026-11-16, its rule taken out and put back.
 */

/** How long a case waits for the database to reach a state it polls for. Generous: a loaded runner, not a measurement. */
const PATIENCE_MS = 15_000
const DEADLINE = 10_000

async function until(read: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  while (!(await read())) {
    if (Date.now() > deadline) throw new Error(`never ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('a PostgreSQL connection', () => {
  let fixture: PostgresFixture
  let owner: ReturnType<typeof connectPostgres>
  let opened: OpenConnection
  let forms: ActionForms

  beforeAll(async () => {
    fixture = await startPostgresFixture(POSTGRES_IMAGE)
    const admin = new URL(fixture.admin)
    owner = connectPostgres({
      host: admin.hostname,
      port: Number(admin.port),
      database: admin.pathname.slice(1),
      user: decodeURIComponent(admin.username),
      password: decodeURIComponent(admin.password),
      tls: { enabled: false, rejectUnauthorized: false },
    })
    const url = new URL(fixture.writer)
    opened = await DRIVER_FACTORIES.postgres(
      {
        id: 'pg',
        kind: 'postgres',
        host: url.hostname,
        port: Number(url.port),
        database: url.pathname.slice(1),
        user: decodeURIComponent(url.username),
        schemas: ['actions'],
        tls: { enabled: false },
      },
      decodeURIComponent(url.password),
    )
    forms = actionForms(await opened.adapter.discover(ACTION_SCOPE))
  })

  afterAll(async () => {
    await opened?.adapter.close()
    await owner?.end({ timeout: 5 })
    await fixture?.stop()
  })

  /** An order of tenant 1, as the owner inserts it; its id. */
  async function order(): Promise<number> {
    const [customer] = await owner<{ id: number }[]>`insert into actions.customer (tenant_id, name) values (1, 'Customer') returning id`
    const [row] = await owner<
      { id: number }[]
    >`insert into actions."order" (customer_id, amount) values (${(customer as { id: number }).id}, 12.50) returning id`
    return Number((row as { id: number }).id)
  }

  // The backend a run's routine sleeps on is the actions' client's, named
  // as drivers.ts names it, and none of the records' or the lookups'.
  // Watched failing with the actions' port made on the records' client:
  // "expected [ 'postgres.js' ] to deeply equal [ 'formancy-data actions'
  // ]".
  test('runs an action on a client of its own, named in pg_stat_activity', async () => {
    const id = await order()
    const request = await plannedAction(opened.actions, forms.orders, 'close', { record: actionToken(id), version: '1', answers: { note: 'sleep 1' } })
    const running = opened.actions.run(request, DEADLINE)
    const sleeping = async () =>
      (await owner<{ application: string }[]>`select application_name as application from pg_stat_activity where wait_event = 'PgSleep'`).map(
        (row) => row.application,
      )
    await until(async () => (await sleeping()).length > 0, 'seen the routine running')
    expect(await sleeping()).toEqual([POSTGRES_ACTIONS_APPLICATION])
    expect(actionAnswer(await running)).toBe('done')
  })
})

describe('a SQL Server connection', () => {
  let fixture: SqlServerFixture
  let owner: Awaited<ReturnType<typeof connectSqlServer>>
  let opened: OpenConnection
  let forms: ActionForms

  beforeAll(async () => {
    fixture = await startSqlServerFixture(SQLSERVER_IMAGE)
    owner = await connectSqlServer({
      host: String(fixture.admin.server),
      port: Number(fixture.admin.port),
      database: String(fixture.admin.database),
      user: String(fixture.admin.user),
      password: String(fixture.admin.password),
      encrypt: false,
      trustServerCertificate: true,
    })
    opened = await DRIVER_FACTORIES.sqlserver(
      {
        id: 'ms',
        kind: 'sqlserver',
        host: String(fixture.writer.server),
        port: Number(fixture.writer.port),
        database: String(fixture.writer.database),
        user: String(fixture.writer.user),
        schemas: ['actions'],
        tls: { enabled: false, trustServerCertificate: true },
      },
      String(fixture.writer.password),
    )
    forms = actionForms(await opened.adapter.discover(ACTION_SCOPE))
  })

  afterAll(async () => {
    await opened?.adapter.close()
    await owner?.close()
    await fixture?.stop()
  })

  /** An order of tenant 1, as the owner inserts it; its id. */
  async function order(): Promise<number> {
    const customer = await owner.request().query<{ id: string }>("insert into actions.customer (tenant_id, name) output inserted.id values (1, N'Customer')")
    const row = await owner
      .request()
      .input('customer', Number(customer.recordset[0]?.id))
      .query<{ id: string }>('insert into actions.[order] (customer_id, amount) output inserted.id values (@customer, 12.50)')
    return Number(row.recordset[0]?.id)
  }

  /** The program name of every session whose procedure is waiting in WAITFOR, as the owner reads them. */
  async function waiting(): Promise<string[]> {
    const result = await owner
      .request()
      .query<{ program: string }>(
        "select s.program_name as program from sys.dm_exec_requests as r join sys.dm_exec_sessions as s on s.session_id = r.session_id where r.wait_type = 'WAITFOR'",
      )
    return result.recordset.map((row) => row.program)
  }

  /** `close` over a new order, planned, and running: its procedure sleeps for `seconds`. */
  async function sleeper(seconds: number): Promise<{ running: Promise<ActionOutcome> }> {
    const id = await order()
    const request = await plannedAction(opened.actions, forms.orders, 'close', {
      record: actionToken(id),
      version: '1',
      answers: { note: `sleep ${String(seconds)}` },
    })
    return { running: opened.actions.run(request, DEADLINE) }
  }

  // The session a run's procedure waits on is the actions' pool's, named as
  // drivers.ts names it, and not the records' pool's. Watched failing with
  // the actions' port made on the records' pool: "expected [ 'node-mssql' ]
  // to deeply equal [ 'formancy-data actions' ]".
  test('runs an action on a pool of its own, named in sys.dm_exec_sessions', async () => {
    const { running } = await sleeper(1)
    await until(async () => (await waiting()).length > 0, 'seen the procedure running')
    expect(await waiting()).toEqual([SQLSERVER_ACTIONS_APPLICATION])
    expect(actionAnswer(await running)).toBe('done')
  })

  // The route will count runs against SQLSERVER_ACTION_POOL (0160), which
  // holds only while the pool opens no more than that: one run more than
  // the bound waits for a connection, and the bound's runs run. Watched
  // failing with the pool opened at 5: "never seen 10 runs in their
  // procedures".
  test(`runs at most SQLSERVER_ACTION_POOL actions at once, ${String(SQLSERVER_ACTION_POOL)}`, async () => {
    const runs = await Promise.all(Array.from({ length: SQLSERVER_ACTION_POOL + 1 }, () => sleeper(1.5)))
    const ours = async () => (await waiting()).filter((program) => program === SQLSERVER_ACTIONS_APPLICATION).length
    await until(async () => (await ours()) === SQLSERVER_ACTION_POOL, `seen ${String(SQLSERVER_ACTION_POOL)} runs in their procedures`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await ours()).toBe(SQLSERVER_ACTION_POOL)
    expect((await Promise.all(runs.map((run) => run.running))).map(actionAnswer)).toEqual(Array.from({ length: SQLSERVER_ACTION_POOL + 1 }, () => 'done'))
  })
})
