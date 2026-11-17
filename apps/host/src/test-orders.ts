import mssql from 'mssql'
import type postgres from 'postgres'
import type { Engine } from './test-plane.js'

/*
 * What a suite writes and reads of the sales schema as the database's
 * owner, beside the page, as another application would: customers, orders
 * by the page full, an order approved by an employee, a removable record's
 * reference, an order deleted, and how many orders hold some notes. The
 * plane's `db` (test-plane.ts), beside the saved orders' (test-saves.ts)
 * and the action orders' (test-actions.ts).
 */

export interface OrderDb {
  /** A customer of tenant 1, written through the database's owner, as another application would. */
  insertCustomer(connection: Engine['connection'], no: number, name: string): Promise<void>
  deleteCustomer(connection: Engine['connection'], no: number): Promise<void>
  /** How many orders have exactly these notes, asked of the database's owner. */
  countOrders(connection: Engine['connection'], notes: string): Promise<number>
  /** `count` orders of tenant 1's, for Muster AG, noted `<notes> <n>`, written by the owner in one statement: more than a page. */
  insertOrders(connection: Engine['connection'], count: number, notes: string): Promise<void>
  /** The order `record` names, with no lines, deleted by the owner, as another application would. */
  deleteOrder(connection: Engine['connection'], record: string): Promise<void>
  /** A row of `parity.removable_child` that refers to the removable record `record`, with NO ACTION: a delete of it is refused while this row is there. */
  referToRemovable(connection: Engine['connection'], record: string): Promise<void>
  /**
   * An order of tenant 1's approved by employee `approver` -- and created
   * by `creator`, where one is given -- written by the owner -- the clerk
   * may only read the form that names approvers -- and its token, which
   * spells its key.
   */
  insertApprovedOrder(connection: Engine['connection'], approver: number, creator?: number | null): Promise<string>
}

export function orderDb(pgAdmin: postgres.Sql, msAdmin: mssql.ConnectionPool): OrderDb {
  return {
    insertCustomer: async (connection, no, name) => {
      if (connection === 'pg') await pgAdmin`insert into sales.customer (tenant_id, customer_no, name) values (1, ${no}, ${name})`
      else
        await msAdmin
          .request()
          .input('no', mssql.Int, no)
          .input('name', mssql.NVarChar(200), name)
          .query('insert into sales.customer (tenant_id, customer_no, name) values (1, @no, @name)')
    },
    deleteCustomer: async (connection, no) => {
      if (connection === 'pg') await pgAdmin`delete from sales.customer where tenant_id = 1 and customer_no = ${no}`
      else await msAdmin.request().input('no', mssql.Int, no).query('delete from sales.customer where tenant_id = 1 and customer_no = @no')
    },
    insertOrders: async (connection, count, notes) => {
      if (connection === 'pg') {
        await pgAdmin`insert into sales."order" (tenant_id, customer_no, order_date, status, amount, notes) select 1, 1001, date '2026-10-08', 'placed', 1, ${notes} || ' ' || n from generate_series(1, ${count}) as n`
        return
      }
      await msAdmin
        .request()
        .input('count', mssql.Int, count)
        .input('notes', mssql.NVarChar(200), notes)
        .query(
          "insert into sales.[order] (tenant_id, customer_no, order_date, status, amount, notes) select 1, 1001, '2026-10-08', 'placed', 1, concat(@notes, ' ', value) from generate_series(1, @count)",
        )
    },
    insertApprovedOrder: async (connection, approver, creator = null) => {
      if (connection === 'pg') {
        const [row] = await pgAdmin<
          Array<{ id: string }>
        >`insert into sales."order" (tenant_id, customer_no, order_date, status, amount, approved_by, created_by) values (1, 1001, date '2026-10-08', 'placed', 1, ${approver}, ${creator}) returning id::text as id`
        return `k1:${String(row?.id)}`
      }
      const result = await msAdmin
        .request()
        .input('approver', mssql.Int, approver)
        .input('creator', mssql.Int, creator)
        // Into a table variable: SQL Server refuses an OUTPUT without INTO
        // on a table with an enabled trigger (334), and the run's setup adds
        // one to the orders (test-databases.ts, 0156).
        .query<{ id: string }>(
          "declare @made table (id bigint); insert into sales.[order] (tenant_id, customer_no, order_date, status, amount, approved_by, created_by) output inserted.id into @made values (1, 1001, '2026-10-08', 'placed', 1, @approver, @creator); select cast(id as nvarchar(40)) as id from @made",
        )
      return `k1:${String(result.recordset[0]?.id)}`
    },
    referToRemovable: async (connection, record) => {
      const id = Number(record.slice('k1:'.length))
      if (connection === 'pg') await pgAdmin`insert into parity.removable_child (removable_id, note) values (${id}, 'refers to it')`
      else await msAdmin.request().input('id', mssql.Int, id).query("insert into parity.removable_child (removable_id, note) values (@id, N'refers to it')")
    },
    deleteOrder: async (connection, record) => {
      const id = record.slice('k1:'.length)
      if (connection === 'pg') await pgAdmin`delete from sales."order" where id = ${id}::bigint`
      else await msAdmin.request().input('id', mssql.BigInt, id).query('delete from sales.[order] where id = @id')
    },
    countOrders: async (connection, notes) => {
      if (connection === 'pg') return (await pgAdmin<Array<{ n: number }>>`select count(*)::int as n from sales."order" where notes = ${notes}`)[0]?.n ?? 0
      const result = await msAdmin
        .request()
        .input('notes', mssql.NVarChar(mssql.MAX), notes)
        .query<{ n: number }>('select count(*) as n from sales.[order] where notes = @notes')
      return result.recordset[0]?.n ?? 0
    },
  }
}
