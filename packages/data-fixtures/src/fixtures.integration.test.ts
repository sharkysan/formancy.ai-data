import mssql from 'mssql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { PostgresFixture, SqlServerFixture } from './containers.js'
import { startPostgresFixture, startSqlServerFixture } from './containers.js'
import { EDGE_VALUES } from './values.js'

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
