import mssql from 'mssql'
import postgres from 'postgres'
import { SIZED_CUSTOMERS, sizedChunk, sizedReadBack } from './sized.js'
import type { SizedReadBack, SizedRow } from './sized.js'

/*
 * Loads the sized `sales.customer` (0034) into a fixture database, as its
 * owner, and proves it holds exactly what the generator says.
 *
 * Opt-in: `startPostgresFixture` and `startSqlServerFixture` never call it,
 * so a suite that does not ask for a million customers never waits for them.
 * A suite that asks loads them into containers of its own.
 *
 * Both engines are fed the same JSON text per chunk, from `sizedChunk`, and
 * read back and compared row by row against `sizedTableRows`: one generator,
 * not one SQL generator per engine that only a read-back would ever notice
 * disagreeing.
 */

/** A fixture database to load, reached as its owner: PostgreSQL's connection URI, or SQL Server's config. */
export type SizedTarget = { kind: 'postgres'; admin: string } | { kind: 'sqlserver'; admin: mssql.config }

/** What a load holds and how long each part took, in seconds. */
export interface SizedLoad {
  /** Rows in `sales.customer` after the load: the generated ones and the fixture's own. */
  rows: number
  perTenant: Record<number, number>
  /** `sizedDigest` of every row read back, in key order. */
  digest: string
  /** Wall-clock seconds for the whole load, and per part: inserting, maintaining statistics and checkpointing, reading back. */
  seconds: number
  phases: { insert: number; maintain: number; verify: number }
}

/**
 * Rows per insert statement: one JSON document per chunk, about 2.9 MB of
 * it. Measured (0034, P11; 2026-10-09, a Docker Sandbox VM on a Windows 11
 * workstation, beside other work, load average about 4.4): inserting the
 * million took 42.0, 39.5, 37.7, 38.3 and 40.1 s on PostgreSQL and 15.3,
 * 13.6, 12.1, 12.5 and 11.6 s on SQL Server at 10,000, 25,000, 50,000,
 * 100,000 and 200,000 rows a chunk. Past 25,000 the differences are within
 * what the machine did on its own, so the chunk stays at a size neither
 * engine is slower at.
 */
export const SIZED_CHUNK_ROWS = 50_000

/**
 * Rows per read-back page. The same size as a chunk, for the same reason:
 * few round trips, and a page that fits easily in the test process.
 */
const READ_PAGE_ROWS = 50_000

/**
 * SQL Server statements here run longer than mssql's default 15-second
 * request timeout can be relied on to allow on a shared CI runner: a 50,000
 * row insert and a full-scan statistics update. Ten minutes is a ceiling, not
 * a measurement; the load's own phases are measured and returned.
 */
const SQLSERVER_LOAD_TIMEOUT_MS = 600_000

const seconds = (since: bigint): number => Number(process.hrtime.bigint() - since) / 1e9

async function readBackPostgres(sql: postgres.Sql): Promise<SizedReadBack> {
  const compare = sizedReadBack()
  let after: SizedRow | undefined
  for (;;) {
    const page: Array<{ t: number; n: number; m: string }> =
      after === undefined
        ? await sql`select tenant_id as t, customer_no as n, name as m from sales.customer order by tenant_id, customer_no limit ${READ_PAGE_ROWS}`
        : await sql`select tenant_id as t, customer_no as n, name as m from sales.customer
            where (tenant_id, customer_no) > (${after.tenantId}::int, ${after.customerNo}::int)
            order by tenant_id, customer_no limit ${READ_PAGE_ROWS}`
    for (const row of page) {
      after = { tenantId: row.t, customerNo: row.n, name: row.m }
      compare.take(after)
    }
    if (page.length < READ_PAGE_ROWS) return compare.finish()
  }
}

async function readBackSqlServer(pool: mssql.ConnectionPool): Promise<SizedReadBack> {
  const compare = sizedReadBack()
  let after: SizedRow | undefined
  for (;;) {
    const request = pool.request().input('size', mssql.Int, READ_PAGE_ROWS)
    const where = after === undefined ? '' : 'where tenant_id > @t or (tenant_id = @t and customer_no > @n)'
    if (after !== undefined) request.input('t', mssql.Int, after.tenantId).input('n', mssql.Int, after.customerNo)
    const page = (await request.query<{ t: number; n: number; m: string }>(`select top (@size) tenant_id as t, customer_no as n, name as m from sales.customer ${where} order by tenant_id, customer_no`)).recordset
    for (const row of page) {
      after = { tenantId: row.t, customerNo: row.n, name: row.m }
      compare.take(after)
    }
    if (page.length < READ_PAGE_ROWS) return compare.finish()
  }
}

/**
 * Reads every customer back as the owner, in key order, and compares each
 * with the generator and `FIXTURE_CUSTOMERS`: throws at the first difference,
 * naming the key. A count alone would pass a table with one name changed.
 */
export async function verifySizedCustomers(target: SizedTarget): Promise<SizedReadBack> {
  if (target.kind === 'postgres') {
    const sql = postgres(target.admin, { onnotice: () => {}, max: 1 })
    try {
      return await readBackPostgres(sql)
    } finally {
      await sql.end()
    }
  }
  const pool = await new mssql.ConnectionPool({ ...target.admin, requestTimeout: SQLSERVER_LOAD_TIMEOUT_MS }).connect()
  try {
    return await readBackSqlServer(pool)
  } finally {
    await pool.close()
  }
}

async function insertPostgres(admin: string): Promise<{ insert: number; maintain: number }> {
  const sql = postgres(admin, { onnotice: () => {}, max: 1 })
  try {
    const started = process.hrtime.bigint()
    for (let from = 0; from < SIZED_CUSTOMERS.rows; from += SIZED_CHUNK_ROWS) {
      const to = Math.min(from + SIZED_CHUNK_ROWS, SIZED_CUSTOMERS.rows)
      // Both parameters cast from text, as the adapters bind (0016): told the
      // first is jsonb, postgres.js would serialise the JSON text as a JSON string.
      await sql.unsafe(
        `insert into sales.customer (tenant_id, customer_no, name, country_code, credit_limit, active, created_at)
         select r.t, r.n, r.m, r.c, null, true, $2::pg_catalog.text::pg_catalog.timestamptz
         from pg_catalog.jsonb_to_recordset($1::pg_catalog.text::pg_catalog.jsonb) as r (t integer, n integer, m text, c text)
         order by r.t, r.n`,
        [sizedChunk(from, to), SIZED_CUSTOMERS.createdAt],
      )
    }
    const insert = seconds(started)
    const maintaining = process.hrtime.bigint()
    // Each on its own: VACUUM refuses to run inside the transaction a multi-statement string is.
    await sql.unsafe('vacuum (analyze) sales.customer')
    await sql.unsafe('checkpoint')
    return { insert, maintain: seconds(maintaining) }
  } finally {
    await sql.end()
  }
}

async function insertSqlServer(admin: mssql.config): Promise<{ insert: number; maintain: number }> {
  const pool = await new mssql.ConnectionPool({ ...admin, requestTimeout: SQLSERVER_LOAD_TIMEOUT_MS }).connect()
  try {
    const started = process.hrtime.bigint()
    for (let from = 0; from < SIZED_CUSTOMERS.rows; from += SIZED_CHUNK_ROWS) {
      const to = Math.min(from + SIZED_CHUNK_ROWS, SIZED_CUSTOMERS.rows)
      await pool
        .request()
        .input('rows', mssql.NVarChar(mssql.MAX), sizedChunk(from, to))
        .input('created', mssql.DateTimeOffset(0), new Date(SIZED_CUSTOMERS.createdAt))
        .query(
          `insert into sales.customer (tenant_id, customer_no, name, country_code, credit_limit, active, created_at)
           select r.t, r.n, r.m, r.c, null, 1, @created
           from openjson(@rows) with (t int '$.t', n int '$.n', m nvarchar(200) '$.m', c char(2) '$.c') as r
           order by r.t, r.n`,
        )
    }
    const insert = seconds(started)
    const maintaining = process.hrtime.bigint()
    await pool.request().batch('update statistics sales.customer with fullscan')
    await pool.request().batch('checkpoint')
    return { insert, maintain: seconds(maintaining) }
  } finally {
    await pool.close()
  }
}

/**
 * Loads the generated customers into `sales.customer` beside the fixture's
 * two, in key order, tenant 1 first -- the order SQL Server's clustered key
 * stores them in anyway, and on PostgreSQL a heap loaded in key order (0034
 * says an interleaved heap is not measured). Then maintains statistics and
 * checkpoints, so neither a pending autovacuum nor dirty pages fall inside a
 * measurement, and reads every row back.
 */
export async function loadSizedCustomers(target: SizedTarget): Promise<SizedLoad> {
  const started = process.hrtime.bigint()
  const { insert, maintain } = target.kind === 'postgres' ? await insertPostgres(target.admin) : await insertSqlServer(target.admin)
  const verifying = process.hrtime.bigint()
  const verified = await verifySizedCustomers(target)
  return { ...verified, seconds: seconds(started), phases: { insert, maintain, verify: seconds(verifying) } }
}
