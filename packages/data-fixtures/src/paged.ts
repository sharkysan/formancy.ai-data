import { DEFAULT_MAX_PAGE_SIZE, recordToken } from '@formancy/data-core'
import mssql from 'mssql'
import postgres from 'postgres'

/*
 * Tenant 3's customers (0085): one lookup page of them and ten more, so a
 * lookup's list goes on past its page, and exactly one page for one search.
 * The sized table (0034) has a million rows in tenants 1 and 2 and lives in
 * containers of its own; these sixty are inserted beside the fixture's own
 * rows by the suites that share one run's databases -- the client's and the
 * host page's -- and in the host's browser gate, once each.
 *
 * Tenant 3 is nobody else's: the fixture's rows are tenants 1 and 2, the
 * suites' clerks are tenants 1 and 2, and every lookup and list they read
 * is filtered by tenant. No row names a country, so no insert reads or
 * waits on `sales.country`, which the client's lookup suite holds locked.
 *
 * Pure but for `insertPaged`: the rows and every expectation the suites
 * compute come from `pagedCustomers`, and `paged.test.ts` holds them.
 */

/** The tenant the paged customers belong to. */
export const PAGED_TENANT = 3

/** How many customers come after the first page. */
export const PAGED_LATER = 10

/** One paged customer: its number within tenant 3, and its name. */
export interface PagedCustomer {
  customerNo: number
  name: string
}

/** Tenant 3's one order, for its first customer, so a record of it shows a label from the first page. */
export const PAGED_ORDER = { customerNo: 1, orderDate: '2026-03-01', status: 'placed', amount: '1', notes: 'paged' } as const

/**
 * `First 01` to `First P` and `Later 01` to `Later 10`, P being the page a
 * lookup allows by default, numbered from 1 in that order: names ordered
 * alike by code point and case-insensitively, and by number, because each
 * is one ASCII word in Title Case and a number padded to one width.
 */
export function pagedCustomers(): PagedCustomer[] {
  const width = String(Math.max(DEFAULT_MAX_PAGE_SIZE, PAGED_LATER)).length
  const named = (word: string, count: number, from: number): PagedCustomer[] =>
    Array.from({ length: count }, (_, index) => ({ customerNo: from + index, name: `${word} ${String(index + 1).padStart(width, '0')}` }))
  return [...named('First', DEFAULT_MAX_PAGE_SIZE, 1), ...named('Later', PAGED_LATER, DEFAULT_MAX_PAGE_SIZE + 1)]
}

/** A fixture database, reached as its owner: PostgreSQL's connection URI, or SQL Server's config. */
export type PagedTarget = { kind: 'postgres'; admin: string } | { kind: 'sqlserver'; admin: mssql.config }

/** The rows as one JSON document, the shape both engines read a set from. */
const rowsJson = (): string => JSON.stringify(pagedCustomers().map((customer) => ({ n: customer.customerNo, m: customer.name })))

async function insertPostgres(admin: string): Promise<string> {
  const sql = postgres(admin, { onnotice: () => {}, max: 1 })
  try {
    // Cast from text, as the sized load binds (0016): told jsonb, postgres.js would send the text as a JSON string.
    await sql.unsafe(
      `insert into sales.customer (tenant_id, customer_no, name)
       select $1::pg_catalog.text::pg_catalog.int4, r.n, r.m from pg_catalog.jsonb_to_recordset($2::pg_catalog.text::pg_catalog.jsonb) as r (n integer, m text)`,
      [String(PAGED_TENANT), rowsJson()],
    )
    const [order] = await sql<Array<{ id: string }>>`insert into sales."order" (tenant_id, customer_no, order_date, status, amount, notes)
      values (${PAGED_TENANT}, ${PAGED_ORDER.customerNo}, ${PAGED_ORDER.orderDate}::date, ${PAGED_ORDER.status}, ${PAGED_ORDER.amount}::numeric, ${PAGED_ORDER.notes})
      returning id::text as id`
    return String(order?.id)
  } finally {
    await sql.end()
  }
}

async function insertSqlServer(admin: mssql.config): Promise<string> {
  const pool = await new mssql.ConnectionPool(admin).connect()
  try {
    await pool
      .request()
      .input('tenant', mssql.Int, PAGED_TENANT)
      .input('rows', mssql.NVarChar(mssql.MAX), rowsJson())
      .query("insert into sales.customer (tenant_id, customer_no, name) select @tenant, r.n, r.m from openjson(@rows) with (n int '$.n', m nvarchar(200) '$.m') as r")
    const order = await pool
      .request()
      .input('tenant', mssql.Int, PAGED_TENANT)
      .input('customer', mssql.Int, PAGED_ORDER.customerNo)
      // The date and the amount as their canonical text, converted by the server, as the adapters bind them.
      .input('date', mssql.VarChar(10), PAGED_ORDER.orderDate)
      .input('status', mssql.VarChar(20), PAGED_ORDER.status)
      .input('amount', mssql.VarChar(40), PAGED_ORDER.amount)
      .input('notes', mssql.NVarChar(mssql.MAX), PAGED_ORDER.notes)
      .query<{ id: string }>(
        'insert into sales.[order] (tenant_id, customer_no, order_date, status, amount, notes) output cast(inserted.id as nvarchar(40)) as id values (@tenant, @customer, cast(@date as date), @status, cast(@amount as decimal(18, 4)), @notes)',
      )
    return String(order.recordset[0]?.id)
  } finally {
    await pool.close()
  }
}

/**
 * Inserts the paged customers and the tenant's order, as the owner, one
 * statement per table, and answers the order's record token. Insert only:
 * a database that already holds them refuses the customers' primary key.
 */
export async function insertPaged(target: PagedTarget): Promise<{ order: string }> {
  const id = target.kind === 'postgres' ? await insertPostgres(target.admin) : await insertSqlServer(target.admin)
  const token = recordToken(['id'], { id })
  if (!token.ok) throw new Error(`the paged order's id ${id} has no token: ${token.message}`)
  return { order: token.token }
}
