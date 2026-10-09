import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { DatabaseAdapter } from '@formancy/data-core'
import { startTcpHop } from '@formancy/data-fixtures'
import type { TcpHop } from '@formancy/data-fixtures'
import type { Sql } from 'postgres'
import { createPostgresAdapter } from './adapter.js'
import { connectPostgres } from './connect.js'

/**
 * Against REAL PostgreSQL. There is no mocked driver here and there is not
 * going to be one (0003): what an adapter gets wrong, it gets wrong under real
 * SQL semantics, and a suite that passed without a server would be proving the
 * mock.
 */
let container: StartedPostgreSqlContainer
let adapter: DatabaseAdapter

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start()
  adapter = createPostgresAdapter(postgres(container.getConnectionUri()))
})

afterAll(async () => {
  await adapter.close()
  await container.stop()
})

describe('the PostgreSQL adapter', () => {
  // A ping that answered from the driver's configuration would pass against a
  // server that is not there. The version asserted is the one the container
  // runs, so the answer has to have come from it.
  test('ping reports the server that answered', async () => {
    const identity = await adapter.ping()
    expect(identity.kind).toBe('postgres')
    expect(identity.version).toMatch(/^17\./)
  })

  // A composition root closes on shutdown and again on an error path. The
  // second call must not throw, or the error path hides the original error.
  // Last, because nothing can ping after it.
  test('close is safe to call twice', async () => {
    await adapter.close()
    await expect(adapter.close()).resolves.toBeUndefined()
  })
})

describe('closing a pool', () => {
  let owner: Sql
  let hop: TcpHop

  beforeAll(async () => {
    owner = postgres(container.getConnectionUri(), { onnotice: () => {} })
    hop = await startTcpHop({ host: container.getHost(), port: container.getPort() })
  })

  afterAll(async () => {
    await hop.close()
    await owner.end()
  })

  /** A one-connection pool through the hop, as the adapter's composition root would hand it over. */
  function throughHop(): Sql {
    return postgres({
      host: '127.0.0.1',
      port: hop.port,
      database: container.getDatabase(),
      username: container.getUsername(),
      password: container.getPassword(),
      max: 1,
      onnotice: () => {},
    })
  }

  /** The backend behind `sql`'s one connection. */
  async function backendOf(sql: Sql): Promise<number> {
    const [row] = await sql<{ pid: number }[]>`select pg_catalog.pg_backend_pid() as pid`
    if (row === undefined) throw new Error('no backend answered')
    return row.pid
  }

  /** Waits until backend `pid` is inside pg_sleep: the statement was sent and is running. */
  async function sleeping(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const [row] = await owner<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where pid = ${pid} and wait_event = 'PgSleep'`
      if ((row?.n ?? 0) > 0) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`backend ${String(pid)} never reached pg_sleep`)
  }

  /** `closing`, or 'still waiting' when it has not settled within `ms`. */
  async function settledWithin(closing: Promise<void>, ms: number): Promise<'closed' | 'still waiting'> {
    let timer: NodeJS.Timeout | undefined
    const waited = new Promise<'still waiting'>((resolve) => (timer = setTimeout(() => resolve('still waiting'), ms)))
    try {
      return await Promise.race([closing.then(() => 'closed' as const), waited])
    } finally {
      clearTimeout(timer)
    }
  }

  // On postgres.js 3.4.9 a statement that failed with its connection stays
  // that connection's current statement, and `end()` without a timeout waits
  // for it forever. Shutdown calls close() on every adapter after a lost
  // answer as on any other day; without a bound, a server that lost one
  // answer never exits. The bound is CLOSE_GRACE (adapter.ts); this waits
  // twice that.
  test('returns after a connection was cut in the middle of a statement', async () => {
    const sql = throughHop()
    const cut = createPostgresAdapter(sql)
    const pid = await backendOf(sql)
    const running = sql`select pg_catalog.pg_sleep(30)`.then(
      () => 'answered',
      (error: unknown) => (error as { code?: unknown }).code,
    )
    try {
      await sleeping(pid)
      hop.cut()
      expect(await running).toBe('CONNECTION_CLOSED')
      expect(await settledWithin(cut.close(), 10_000)).toBe('closed')
    } finally {
      // The orphan sleeps on until it next writes to the socket; not for 30 s here.
      await owner`select pg_catalog.pg_terminate_backend(${pid})`
    }
  })

  // The bound is a grace, not a guillotine: close() on a pool with a
  // statement still running lets it finish and answer. A close that
  // destroyed its connections at once would turn a write that was about to
  // be answered into an unknown outcome on every ordinary shutdown.
  test('lets a statement that is still running finish first', async () => {
    const sql = throughHop()
    const closing = createPostgresAdapter(sql)
    const pid = await backendOf(sql)
    // A postgres.js query is sent when it is awaited; execute() sends it now.
    const running = sql<{ done: string }[]>`select pg_catalog.pg_sleep(0.5)::text as done`.execute()
    await sleeping(pid)
    await closing.close()
    await expect(running).resolves.toEqual([{ done: '' }])
  })
})

describe('connectPostgres', () => {
  // The client this package opens is the one its adapters run on; a
  // discovery through it proves the options reach the server as given.
  test('opens a client its own adapters can discover through', async () => {
    const { startPostgresFixture } = await import('@formancy/data-fixtures')
    const fixture = await startPostgresFixture()
    const url = new URL(fixture.admin)
    const sql = connectPostgres({
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      tls: { enabled: false, rejectUnauthorized: true },
    })
    try {
      const snapshot = await createPostgresAdapter(sql).discover({ schemas: ['sales'] })
      expect(snapshot.objects.length).toBeGreaterThan(0)
    } finally {
      await sql.end()
      await fixture.stop()
    }
  })
})
