import type { PostgresFixture } from '@formancy/data-fixtures'
import { EDGE_VALUES, startPostgresFixture } from '@formancy/data-fixtures'
import postgres from 'postgres'
import type { PendingQuery, Row, Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * The PostgreSQL half of the phase-1 spike (plan, section 17): what the
 * driver does with the values a form must not lose, and whether an
 * application-maintained version column stops a lost update. Kept as tests,
 * so that a driver upgrade or a server release that changes either answer
 * fails here, against the fixture, rather than in somebody's ledger.
 *
 * Characterisation: each test states what the real driver and the real
 * engine do, including the answers that are inconvenient.
 */
let fixture: PostgresFixture
let owner: Sql

beforeAll(async () => {
  fixture = await startPostgresFixture()
  owner = postgres(fixture.admin, { onnotice: () => {} })
})

afterAll(async () => {
  await owner?.end()
  await fixture?.stop()
})

const ID = EDGE_VALUES.beyondSafeInteger

describe('reading sales.order through the postgres driver', () => {
  /** A driver set up the way a composition root may set it up: its choice, not the adapter's. */
  function configured(types: Record<string, postgres.PostgresType>): Sql<Record<string, unknown>> {
    return postgres(fixture.admin, { onnotice: () => {}, types }) as unknown as Sql<Record<string, unknown>>
  }

  // The default is what every query gets unless it asks for something else.
  // Were it numbers, 2^53 + 1 would be gone before any codec saw it.
  test('by default, bigint and numeric arrive as strings holding the exact digits', async () => {
    const [row] = await owner<{ id: unknown; amount: unknown }[]>`select id, amount from sales."order"`
    expect(row).toEqual({ id: ID, amount: EDGE_VALUES.largestAmount })
    expect(typeof row?.id).toBe('string')
    expect(typeof row?.amount).toBe('string')
  })

  // The adapter is handed a connected driver (CLAUDE.md, "Secrets and
  // identifiers"), so its parsers are the composition root's to choose. Asked
  // for BigInt, the id changes type; asked for Number -- the obvious thing to
  // want from a "number" -- both values are silently wrong.
  test("the driver's answer is whatever the composition root configured, and can lose both values", async () => {
    const asBigInt = configured({ bigint: postgres.BigInt })
    const asNumber = configured({
      int8: { to: 20, from: [20], parse: (raw: string) => Number(raw), serialize: (value: number) => String(value) },
      numeric: { to: 1700, from: [1700], parse: (raw: string) => Number(raw), serialize: (value: number) => String(value) },
    })
    try {
      const [big] = await asBigInt<{ id: unknown }[]>`select id from sales."order"`
      expect(big?.id).toBe(9007199254740993n)
      const [lossy] = await asNumber<{ id: unknown; amount: unknown }[]>`select id, amount from sales."order"`
      expect(lossy).toEqual({ id: 9007199254740992, amount: 100000000000000 })
    } finally {
      await Promise.all([asBigInt.end(), asNumber.end()])
    }
  })

  // The read path the adapter does control: the SQL it writes. A value cast
  // to text on the server reaches JavaScript as the server's own digits, and
  // no parser configuration can intervene, because no parser is registered
  // for text.
  test('a value cast to text in SQL arrives exact, however the driver is configured', async () => {
    const asNumber = configured({
      int8: { to: 20, from: [20], parse: (raw: string) => Number(raw), serialize: (value: number) => String(value) },
      numeric: { to: 1700, from: [1700], parse: (raw: string) => Number(raw), serialize: (value: number) => String(value) },
    })
    try {
      for (const sql of [owner, asNumber]) {
        const [row] = await sql<{ id: unknown; amount: unknown }[]>`select id::text as id, amount::text as amount from sales."order"`
        expect(row).toEqual({ id: EDGE_VALUES.beyondSafeInteger, amount: EDGE_VALUES.largestAmount })
      }
    } finally {
      await asNumber.end()
    }
  })

  // The other direction. A key that went through Number does not fail: it is
  // a different key, the statement matches no row, and an update would report
  // "nothing changed" -- or change the neighbouring row, if it exists.
  test('a bigint key bound as a JavaScript number addresses a different row', async () => {
    const [asNumber] = await owner<{ n: number }[]>`select count(*)::int as n from sales."order" where id = ${Number(ID)}`
    const [asString] = await owner<{ n: number }[]>`select count(*)::int as n from sales."order" where id = ${ID}`
    expect(asNumber?.n).toBe(0)
    expect(asString?.n).toBe(1)
  })
})

describe("the driver's identifier helper", () => {
  // ObjectRef keeps a schema and a name in two fields because a dotted
  // string is ambiguous (data-core, metadata.ts). The driver's sql(name)
  // helper makes it ambiguous again: it quotes `a.b` as "a"."b", schema a,
  // table b. A table whose name contains a dot -- legal, once quoted -- is
  // then addressed as a different object, so the adapter has to quote
  // identifiers itself, from the two fields, and never through this helper.
  test('splits a name at its dots, so a dotted table name addresses another object', async () => {
    await owner.unsafe('create table public."a.b" (id integer); insert into public."a.b" values (1)')
    const [byHand] = await owner<{ n: number }[]>`select count(*)::int as n from public."a.b"`
    expect(byHand?.n).toBe(1)
    await expect(owner`select count(*) from ${owner('a.b')}`).rejects.toMatchObject({ code: '42P01', message: 'relation "a.b" does not exist' })
  })
})

describe('optimistic concurrency with the application-maintained row_version', () => {
  let first: Sql
  let second: Sql

  beforeAll(() => {
    // Two independent connections, as two people's requests would be: one
    // backend each, so neither can see the other's uncommitted work.
    first = postgres(fixture.admin, { max: 1, onnotice: () => {} })
    second = postgres(fixture.admin, { max: 1, onnotice: () => {} })
  })

  afterAll(async () => {
    await Promise.all([first?.end(), second?.end()])
  })

  async function currentVersion(): Promise<string> {
    const [row] = await owner<{ row_version: string }[]>`select row_version::text as row_version from sales."order" where id = ${ID}`
    if (row === undefined) throw new Error('sales.order has lost its row')
    return row.row_version
  }

  function save(sql: Sql | postgres.TransactionSql, notes: string, version: string): PendingQuery<Row[]> {
    return sql`
      update sales."order" set notes = ${notes}, row_version = row_version + 1
      where id = ${ID} and row_version = ${version}`
  }

  // The plan's minimum for a writable form (section 12): two people load the
  // same order and both save. Without the version in the WHERE, the second
  // save silently overwrites the first.
  test('of two writers holding the same version, the first wins and the second changes nothing', async () => {
    const [seenByFirst] = await first<{ row_version: string }[]>`select row_version::text as row_version from sales."order" where id = ${ID}`
    const [seenBySecond] = await second<{ row_version: string }[]>`select row_version::text as row_version from sales."order" where id = ${ID}`
    if (seenByFirst === undefined || seenBySecond === undefined) throw new Error('sales.order has lost its row')
    expect(seenBySecond.row_version).toBe(seenByFirst.row_version)

    const won = await save(first, 'saved by the first', seenByFirst.row_version)
    const lost = await save(second, 'saved by the second', seenBySecond.row_version)

    expect(won.count).toBe(1)
    expect(lost.count).toBe(0)
    const [now] = await owner<{ notes: string; row_version: string }[]>`select notes, row_version::text as row_version from sales."order" where id = ${ID}`
    expect(now).toEqual({ notes: 'saved by the first', row_version: String(BigInt(seenByFirst.row_version) + 1n) })
  })

  // The race the sequential case does not show: the second UPDATE arrives
  // while the first is still inside its transaction. Under READ COMMITTED,
  // PostgreSQL makes it wait for the row lock, then re-reads the committed
  // row and re-checks the WHERE against it. If it reused the version it had
  // seen before waiting, both writers would "win" and the first save would
  // be lost.
  test('a writer arriving while the first is mid-transaction waits, then changes nothing', async () => {
    const version = await currentVersion()
    const [backend] = await second<{ pid: number }[]>`select pg_backend_pid() as pid`
    let pending: PendingQuery<Row[]> | undefined

    await first.begin(async (tx) => {
      expect((await save(tx, 'held by the first', version)).count).toBe(1)
      pending = save(second, 'queued behind it', version).execute()
      // Proved waiting on the first, not merely slow: PostgreSQL names who blocks it.
      for (let attempt = 0; ; attempt++) {
        const [state] = await owner<{ blocked: boolean }[]>`select cardinality(pg_blocking_pids(${backend?.pid ?? 0})) > 0 as blocked`
        if (state?.blocked === true) break
        if (attempt === 200) throw new Error('the second writer never waited for the first')
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    })

    expect((await pending)?.count).toBe(0)
    const [now] = await owner<{ notes: string }[]>`select notes from sales."order" where id = ${ID}`
    expect(now?.notes).toBe('held by the first')
  })

  // REPEATABLE READ answers the same race differently: not "0 rows" but an
  // error, SQLSTATE 40001. An adapter that ran a write at that level and
  // mapped only "0 rows" to a stale version would report a lost race as a
  // server failure.
  test('under REPEATABLE READ the stale writer is refused with 40001 instead', async () => {
    const version = await currentVersion()
    await expect(
      second.begin('isolation level repeatable read', async (tx) => {
        // The snapshot is taken by the first statement, before the other write commits.
        await tx`select row_version from sales."order" where id = ${ID}`
        expect((await save(first, 'committed meanwhile', version)).count).toBe(1)
        await save(tx, 'from a stale snapshot', version)
      }),
    ).rejects.toMatchObject({ code: '40001' })
  })
})
