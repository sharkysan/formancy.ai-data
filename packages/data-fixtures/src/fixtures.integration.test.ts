import mssql from 'mssql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { PostgresFixture, SqlServerFixture } from './containers.js'
import { startPostgresFixture, startSqlServerFixture } from './containers.js'
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
})
