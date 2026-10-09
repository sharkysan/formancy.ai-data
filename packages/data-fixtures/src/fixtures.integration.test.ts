import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mssql from 'mssql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { PostgresFixture, SqlServerFixture } from './containers.js'
import { POSTGRES_IMAGE, SQLSERVER_IMAGE, startPostgresFixture, startSqlServerFixture, WRITER } from './containers.js'
import { FILTER_PARITY } from './parity.js'
import { EDGE_VALUES, FIRST_SHIPMENT, SECOND_SHIPMENT } from './values.js'

/**
 * The fixtures load on both engines, hold exactly the values `EDGE_VALUES`
 * names, and the reader really is restricted. Every adapter suite builds on
 * these three facts, so they are proved once, here, against real servers.
 *
 * Values are read back cast to text in SQL, so neither driver's own number
 * handling is on trial — that is the adapters' business.
 */
let pg: PostgresFixture
let ms: SqlServerFixture

beforeAll(async () => {
  // Both at once: the slow part is SQL Server, and nothing orders them.
  ;[pg, ms] = await Promise.all([startPostgresFixture(), startSqlServerFixture()])
})

afterAll(async () => {
  await Promise.all([pg?.stop(), ms?.stop()])
})

describe('the PostgreSQL fixture', () => {
  // A fixture value that is not what EDGE_VALUES says would make every codec
  // test compare against the wrong number.
  test('holds the edge values exactly', async () => {
    const sql = postgres(pg.admin)
    try {
      const [order] = await sql<{ id: string; amount: string; order_date: string }[]>`
        select id::text as id, amount::text as amount, order_date::text as order_date from sales."order"`
      expect(order).toEqual({ id: EDGE_VALUES.beyondSafeInteger, amount: EDGE_VALUES.largestAmount, order_date: EDGE_VALUES.orderDate })
      const limits = await sql<{ credit_limit: string }[]>`select credit_limit::text as credit_limit from sales.customer order by tenant_id`
      expect(limits.map((row) => row.credit_limit)).toEqual([EDGE_VALUES.largestCreditLimit, EDGE_VALUES.smallestCreditLimit])
      const [line] = await sql<{ line_total: string }[]>`select line_total::text as line_total from sales.order_line`
      expect(line?.line_total).toBe(EDGE_VALUES.computedLineTotal)
    } finally {
      await sql.end()
    }
  })

  // FIXTURE_MODEL says shipment.id is a by-default identity, its carrier check
  // unvalidated, and its first row holds the largest smallint, a fraction of a
  // second and a real of 0.1. If the SQL did not set those up, both adapters
  // would be held to facts the database does not have.
  test('sets up the shipment the model describes', async () => {
    const sql = postgres(pg.admin)
    try {
      const rows = await sql<{ id: string; carrier_code: string; dispatched_at: string; temperature_c: string | null }[]>`
        select id::text as id, carrier_code::text as carrier_code, dispatched_at::text as dispatched_at, temperature_c::text as temperature_c
        from sales.shipment order by id`
      expect(rows.map((row) => ({ ...row }))).toEqual([
        { id: FIRST_SHIPMENT.id, carrier_code: EDGE_VALUES.largestSmallint, dispatched_at: '2026-10-08 12:34:56.5', temperature_c: '0.1' },
        { id: SECOND_SHIPMENT.id, carrier_code: SECOND_SHIPMENT.carrier_code, dispatched_at: '2026-10-08 12:34:56', temperature_c: null },
      ])
      // The spelling both adapters must read is the stored text with a T.
      expect(rows.map((row) => row.dispatched_at.replace(' ', 'T'))).toEqual([EDGE_VALUES.localTimestamp, EDGE_VALUES.localTimestampWholeSecond])

      const [identity] = await sql<{ attidentity: string }[]>`
        select a.attidentity from pg_attribute a
        where a.attrelid = 'sales.shipment'::regclass and a.attname = 'id'`
      expect(identity?.attidentity).toBe('d')

      const checks = await sql<{ conname: string; convalidated: boolean }[]>`
        select conname, convalidated from pg_constraint
        where conrelid = 'sales.shipment'::regclass and contype = 'c' order by conname`
      expect(checks.map((row) => ({ ...row }))).toEqual([
        { conname: 'ck_shipment_carrier', convalidated: false },
        { conname: 'ck_shipment_reference', convalidated: true },
        { conname: 'ck_shipment_weight', convalidated: true },
      ])
    } finally {
      await sql.end()
    }
  })

  // The restricted-discovery tests mean nothing if the reader can in fact read
  // customer, or cannot connect at all.
  test('the reader may read sales.order and not sales.customer', async () => {
    const sql = postgres(pg.reader)
    try {
      const [count] = await sql<{ n: number }[]>`select count(*)::int as n from sales."order"`
      expect(count?.n).toBe(1)
      await expect(sql`select * from sales.customer`).rejects.toMatchObject({ code: '42501' })
    } finally {
      await sql.end()
    }
  })

  // The policy must bind the writer and nobody else. One that hid rows from
  // the owner would quietly change every owner suite's data (B1); one that
  // bound nobody would make every row-security test pass for no reason.
  test('the owner reads both tenants of sales.customer and the writer reads tenant 1 only', async () => {
    const owner = postgres(pg.admin)
    const writer = postgres(pg.writer)
    try {
      const tenants = async (sql: postgres.Sql) => (await sql<{ tenant_id: number }[]>`select tenant_id from sales.customer order by tenant_id`).map((row) => row.tenant_id)
      expect(await tenants(owner)).toEqual([1, 2])
      expect(await tenants(writer)).toEqual([1])
      const [who] = await writer<{ user: string }[]>`select current_user as "user"`
      expect(who?.user).toBe(WRITER.user)
    } finally {
      await Promise.all([owner.end(), writer.end()])
    }
  })

  // A filter policy hides rows; it does not check the foreign keys that point
  // at them (B11). Pinned, so a block or WITH CHECK policy added later is
  // noticed rather than discovered by a form that suddenly cannot save. The
  // insert is rolled back: other tests count the orders.
  test("the writer's insert of an order for tenant 2's customer is not refused by the policy", async () => {
    const writer = postgres(pg.writer)
    try {
      const rolledBack = new Error('rolled back')
      await expect(
        writer.begin(async (tx) => {
          const [row] = await tx<{ tenant_id: number }[]>`
            insert into sales."order" (tenant_id, customer_no, order_date, amount) values (2, 1001, '2026-10-09', 1) returning tenant_id`
          expect(row?.tenant_id).toBe(2)
          throw rolledBack
        }),
      ).rejects.toBe(rolledBack)
    } finally {
      await writer.end()
    }
  })
})

describe('the SQL Server fixture', () => {
  // As above, on the other engine, through T-SQL's own conversions.
  test('holds the edge values exactly', async () => {
    const pool = await new mssql.ConnectionPool(ms.admin).connect()
    try {
      const order = await pool.request().query<{ id: string; amount: string; order_date: string }>(
        `select cast(id as varchar(40)) as id, cast(amount as varchar(40)) as amount, convert(varchar(10), order_date, 23) as order_date from sales.[order]`,
      )
      expect(order.recordset[0]).toEqual({ id: EDGE_VALUES.beyondSafeInteger, amount: EDGE_VALUES.largestAmount, order_date: EDGE_VALUES.orderDate })
      const limits = await pool.request().query<{ credit_limit: string }>(
        'select cast(credit_limit as varchar(40)) as credit_limit from sales.customer order by tenant_id',
      )
      expect(limits.recordset.map((row) => row.credit_limit)).toEqual([EDGE_VALUES.largestCreditLimit, EDGE_VALUES.smallestCreditLimit])
      const line = await pool.request().query<{ line_total: string }>('select cast(line_total as varchar(40)) as line_total from sales.order_line')
      expect(line.recordset[0]?.line_total).toBe(EDGE_VALUES.computedLineTotal)
    } finally {
      await pool.close()
    }
  })

  // As for PostgreSQL, through T-SQL's own conversions: the UTF-8 collation,
  // the sequence default, the disabled and the untrusted check, and a real
  // whose style-3 text is the float's exact value — which is why both adapters
  // read a real through canonicalFloat32 and not as the database prints it.
  test('sets up the shipment the model describes', async () => {
    const pool = await new mssql.ConnectionPool(ms.admin).connect()
    try {
      const rows = await pool.request().query<{ id: string; carrier_code: string; dispatched_at: string; temperature_c: string | null }>(
        `select cast(id as varchar(10)) as id, cast(carrier_code as varchar(10)) as carrier_code,
                convert(varchar(27), dispatched_at, 126) as dispatched_at, convert(nvarchar(30), temperature_c, 3) as temperature_c
         from sales.shipment order by id`,
      )
      expect(rows.recordset).toEqual([
        { id: FIRST_SHIPMENT.id, carrier_code: EDGE_VALUES.largestSmallint, dispatched_at: '2026-10-08T12:34:56.500', temperature_c: '1.0000000149011612e-001' },
        { id: SECOND_SHIPMENT.id, carrier_code: SECOND_SHIPMENT.carrier_code, dispatched_at: '2026-10-08T12:34:56', temperature_c: null },
      ])

      const unit = await pool.request().query<{ code_page: number }>(
        `select convert(int, collationproperty(c.collation_name, 'CodePage')) as code_page
         from sys.columns c where c.object_id = object_id(N'sales.shipment') and c.name = N'reference'`,
      )
      expect(unit.recordset[0]?.code_page).toBe(65001)

      // The id is numbered by a sequence default and is no IDENTITY: an
      // identity would number rows 1 and 2 just the same, and the model's
      // SQL Server facts for it (a default, by-default numbering) would go
      // unproved by the SQL that is meant to set them up.
      const id = await pool.request().query<{ is_identity: boolean; definition: string | null }>(
        `select c.is_identity, object_definition(c.default_object_id) as definition
         from sys.columns c where c.object_id = object_id(N'sales.shipment') and c.name = N'id'`,
      )
      expect(id.recordset).toEqual([{ is_identity: false, definition: '(NEXT VALUE FOR [sales].[shipment_id])' }])

      const checks = await pool.request().query<{ name: string; is_disabled: boolean; is_not_trusted: boolean }>(
        `select name, is_disabled, is_not_trusted from sys.check_constraints
         where parent_object_id = object_id(N'sales.shipment') order by name`,
      )
      expect(checks.recordset).toEqual([
        { name: 'ck_shipment_carrier', is_disabled: false, is_not_trusted: true },
        { name: 'ck_shipment_reference', is_disabled: true, is_not_trusted: true },
        { name: 'ck_shipment_weight', is_disabled: false, is_not_trusted: false },
      ])
    } finally {
      await pool.close()
    }
  })

  // Error 229 is SQL Server's "SELECT permission was denied".
  test('the reader may read sales.order and not sales.customer', async () => {
    const pool = await new mssql.ConnectionPool(ms.reader).connect()
    try {
      const count = await pool.request().query<{ n: number }>('select count(*) as n from sales.[order]')
      expect(count.recordset[0]?.n).toBe(1)
      await expect(pool.request().query('select * from sales.customer')).rejects.toMatchObject({ number: 229 })
    } finally {
      await pool.close()
    }
  })

  // As for PostgreSQL. SQL Server applies an enabled policy to dbo too, so the
  // predicate itself must pass every account but the writer (B11).
  test('the owner reads both tenants of sales.customer and the writer reads tenant 1 only', async () => {
    const owner = await new mssql.ConnectionPool(ms.admin).connect()
    const writer = await new mssql.ConnectionPool(ms.writer).connect()
    try {
      const tenants = async (pool: mssql.ConnectionPool) =>
        (await pool.request().query<{ tenant_id: number }>('select tenant_id from sales.customer order by tenant_id')).recordset.map((row) => row.tenant_id)
      expect(await tenants(owner)).toEqual([1, 2])
      expect(await tenants(writer)).toEqual([1])
      const who = await writer.request().query<{ user: string }>('select user_name() as [user]')
      expect(who.recordset[0]?.user).toBe(WRITER.user)
    } finally {
      await Promise.all([owner.close(), writer.close()])
    }
  })

  // A filter predicate does not stop an insert, and foreign-key checks are
  // not filtered (B11); pinned as on PostgreSQL, and rolled back.
  test("the writer's insert of an order for tenant 2's customer is not refused by the policy", async () => {
    const writer = await new mssql.ConnectionPool(ms.writer).connect()
    const transaction = new mssql.Transaction(writer)
    let begun = false
    try {
      await transaction.begin()
      begun = true
      const inserted = await new mssql.Request(transaction).query<{ tenant_id: number }>(
        "insert into sales.[order] (tenant_id, customer_no, order_date, amount) output inserted.tenant_id values (2, 1001, '2026-10-09', 1)",
      )
      expect(inserted.recordset[0]?.tenant_id).toBe(2)
    } finally {
      if (begun) await transaction.rollback()
      await writer.close()
    }
  })
})

/*
 * The parity schema (0028): both adapters' parity suites hold the two engines
 * to one expectation per case, and that means nothing unless the schema they
 * run against is one dataset on both. Read back as text built in SQL, so
 * neither driver is on trial; floats as their IEEE 754 bits, which is exact
 * where any decimal spelling is one engine's choice.
 */
describe('the parity schema', () => {
  const NAMED = ['acme|1', 'ACME|2', 'acme |3', 'Acmé|4']
  const KINDS = {
    t: 'Text',
    fixed: 'AB',
    i: '9007199254740993',
    d: '12.50',
    b: 'true',
    f: '3fd3333333333334',
    r: '4996b43f',
    dt: '2026-10-08',
    tm: '10:34:56.789',
    ts: '2026-10-08T08:34:56.789Z',
    tz: '2026-10-08T10:34:56.789',
    u: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  }

  /**
   * The keys each FILTER_PARITY case should select, worked out from the rows
   * as they are stored — exact comparison in JavaScript, of the canonical
   * text — so the expectations both adapter suites run are the data's, not
   * a guess written beside it. A refused case selects nothing to compare.
   */
  type NamedRow = { tenant_code: string; item_no: string; fixed_code: string }
  const selectedBy = (rows: readonly NamedRow[]) =>
    FILTER_PARITY.map((entry) => ('keys' in entry ? rows.filter((row) => row[entry.column] === entry.value).map((row) => [row.tenant_code, row.item_no]) : 'refused'))
  const expected = FILTER_PARITY.map((entry) => ('keys' in entry ? entry.keys.map((key) => [...key]) : 'refused'))

  // The four named tenants differ by case, a trailing space and an accent;
  // a trailing space lost on load would make 'acme ' the same tenant as
  // 'acme' and the case that caught SQL Server's leak (C2-table) vacuous.
  // The fillers are the size the plans were read at (C4, C5).
  test('loads on PostgreSQL: the four named tenants, the fillers, the rows each filter case selects, and one value of every label kind', async () => {
    const sql = postgres(pg.admin)
    try {
      const named = await sql<{ row: string }[]>`select tenant_code || '|' || item_no as row from parity.tenant_item where item_no < 10 order by item_no`
      expect(named.map((entry) => entry.row)).toEqual(NAMED)
      const rows = await sql<NamedRow[]>`select tenant_code::text as tenant_code, item_no::text as item_no, fixed_code::text as fixed_code from parity.tenant_item order by item_no`
      expect(selectedBy(rows)).toEqual(expected)
      const [fillers] = await sql<{ n: number }[]>`select count(*)::int as n from parity.tenant_item where label = 'Filler'`
      expect(fillers?.n).toBe(20_000)
      const [kinds] = await sql<Record<string, string>[]>`
        select t, fixed::text as fixed, i::text as i, d::text as d, b::text as b,
               pg_catalog.encode(pg_catalog.float8send(f), 'hex') as f, pg_catalog.encode(pg_catalog.float4send(r), 'hex') as r,
               pg_catalog.to_char(dt, 'YYYY-MM-DD') as dt, tm::text as tm,
               pg_catalog.to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ts,
               pg_catalog.to_char(tz, 'YYYY-MM-DD"T"HH24:MI:SS.MS') as tz, u::text as u
        from parity.display_kinds`
      expect({ ...kinds }).toEqual(KINDS)
    } finally {
      await sql.end()
    }
  })

  // As on PostgreSQL, through T-SQL's own conversions.
  test('loads on SQL Server: the same tenants, fillers and values', async () => {
    const pool = await new mssql.ConnectionPool(ms.admin).connect()
    try {
      const named = await pool.request().query<{ row: string }>(
        `select tenant_code + N'|' + convert(nvarchar(10), item_no) as row from parity.tenant_item where item_no < 10 order by item_no`,
      )
      expect(named.recordset.map((entry) => entry.row)).toEqual(NAMED)
      // rtrim: SQL Server keeps a char column's padding when it converts it (C1); its canonical value does not.
      const rows = await pool.request().query<NamedRow>(
        `select tenant_code, convert(nvarchar(10), item_no) as item_no, rtrim(fixed_code) as fixed_code from parity.tenant_item order by item_no`,
      )
      expect(selectedBy(rows.recordset)).toEqual(expected)
      const fillers = await pool.request().query<{ n: number }>(`select count(*) as n from parity.tenant_item where label = N'Filler'`)
      expect(fillers.recordset[0]?.n).toBe(20_000)
      const kinds = await pool.request().query<Record<string, string>>(
        `select t, rtrim(fixed) as fixed, convert(varchar(20), i) as i, convert(varchar(20), d) as d,
                case b when 1 then 'true' else 'false' end as b,
                lower(convert(varchar(16), convert(binary(8), f), 2)) as f, lower(convert(varchar(8), convert(binary(4), r), 2)) as r,
                convert(varchar(10), dt, 23) as dt, convert(varchar(12), tm) as tm,
                convert(varchar(23), switchoffset(ts, '+00:00'), 126) + 'Z' as ts,
                convert(varchar(23), tz, 126) as tz, lower(convert(varchar(36), u)) as u
         from parity.display_kinds`,
      )
      expect(kinds.recordset[0]).toEqual(KINDS)
    } finally {
      await pool.close()
    }
  })
})

describe('what each start records for the release report', () => {
  /** The records this process wrote, as the report's collect step reads them: from the files. */
  function written(): unknown[] {
    const folder = join(process.cwd(), 'test-results', 'servers')
    return readdirSync(folder).map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')) as unknown)
  }

  // The report says what every run was tested on from these records (0035).
  // A version that was not the server's would name a build nobody ran, and a
  // caller that was not this file -- both started inside one Promise.all, the
  // way the host's and the client's suites start theirs -- would name a test
  // that never ran on it.
  test('is the server that answered, started by this file, and is on disk', async () => {
    const here = fileURLToPath(import.meta.url)
    const sql = postgres(pg.admin)
    try {
      const [row] = await sql<{ version: string }[]>`select current_setting('server_version') as version`
      expect(pg.server).toMatchObject({ engine: 'postgres', image: POSTGRES_IMAGE, version: row?.version, updateLevel: null, edition: null, caller: here })
    } finally {
      await sql.end()
    }
    const pool = await new mssql.ConnectionPool(ms.admin).connect()
    try {
      const result = await pool.request().query<{ version: string; edition: string }>(
        "select cast(serverproperty('ProductVersion') as nvarchar(128)) as version, cast(serverproperty('Edition') as nvarchar(128)) as edition",
      )
      const [row] = result.recordset
      expect(ms.server).toMatchObject({ engine: 'sqlserver', image: SQLSERVER_IMAGE, version: row?.version, edition: row?.edition, caller: here })
    } finally {
      await pool.close()
    }
    expect(written()).toEqual(expect.arrayContaining([pg.server, ms.server]))
  })
})
